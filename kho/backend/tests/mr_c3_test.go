package tests

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/xuri/excelize/v2"

	"kho/internal/importx"
	"kho/internal/util"
)

type importRes struct {
	Rows      int                `json:"rows"`
	Creates   int                `json:"creates"`
	Updates   int                `json:"updates"`
	Errors    []importx.RowError `json:"errors"`
	Documents []importx.DocRef   `json:"documents"`
	Notes     []string           `json:"notes"`
}

func (c *Client) importOK(t *testing.T, path string, file []byte) importRes {
	t.Helper()
	r := c.upload(path, file)
	if r.Status != 200 {
		t.Fatalf("POST %s: %d %s", path, r.Status, r.Body)
	}
	var x importRes
	r.JSON(t, &x)
	return x
}

func snapshotCounts(e *Env) string {
	var parts []string
	for _, tb := range []string{"products", "product_groups", "partners", "documents", "document_lines", "stock_movements", "audit_log", "counters"} {
		parts = append(parts, fmt.Sprintf("%s=%d", tb, e.count(tb)))
	}
	var rec, pay decimal.Decimal
	_ = e.Pool.QueryRow(t0ctx(), `SELECT COALESCE(sum(opening_receivable),0), COALESCE(sum(opening_payable),0) FROM partners`).Scan(&rec, &pay)
	var cs int
	_ = e.Pool.QueryRow(t0ctx(), `SELECT COALESCE(sum(value),0) FROM counters`).Scan(&cs)
	return strings.Join(parts, " ") + fmt.Sprintf(" rec=%s pay=%s counters=%d", rec, pay, cs)
}

// C3 — tải file mẫu về, gửi lại nguyên vẹn ⇒ thử OK với 2 dòng ví dụ (cả 4 loại); file mẫu có sheet "Hướng dẫn".
func TestMR_C3_FileMauNhapLaiNgay(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.Product("A1", "Hàng A1", "Cái", 1, 1, 0)
	e.Product("A2", "Hàng A2", "Cái", 1, 1, 0)
	e.Partner("K1", "Khách 1", true, false)
	e.Partner("K2", "Khách 2", true, false)
	mrEnable(e, "import_excel")
	for _, kind := range []string{"products", "partners", "opening_stock", "opening_debt"} {
		r := e.Admin.OK("GET", "/api/import/"+kind+"/template", nil, nil)
		f := openXLSX(t, r.Body)
		sheets := f.GetSheetList()
		f.Close()
		if len(sheets) != 2 || sheets[1] != "Hướng dẫn" {
			t.Fatalf("%s: sheet %v", kind, sheets)
		}
		before := snapshotCounts(e)
		res := e.Admin.importOK(t, "/api/import/"+kind+"?dry_run=1", r.Body)
		if res.Rows != 2 || len(res.Errors) != 0 || res.Creates+res.Updates != 2 {
			t.Fatalf("%s: thử file mẫu: %+v", kind, res)
		}
		if snapshotCounts(e) != before {
			t.Fatalf("%s: thử không được ghi gì", kind)
		}
	}
}

// C3 — thử (dry-run) không ghi gì; nhập thật là tất cả hoặc không gì; số kiểu Việt; nhận cột theo tiêu đề;
// trùng mã trong file; dòng trống bỏ qua; cập nhật theo mã (ô trống giữ nguyên).
func TestMR_C3_NhapHangHoaTatCaHoacKhongGi(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	old := e.Product("CU01", "Hàng cũ", "Cái", 5000, 3000, 0)
	e.Group("QH", "Que hàn")
	mrEnable(e, "import_excel")
	// Tiêu đề không ở dòng 1, cột đảo thứ tự, có cột lạ, tiêu đề có dấu "*".
	good := [][]string{
		{"DANH SÁCH HÀNG HÓA CẦN NHẬP"},
		{""},
		{"Ghi chú nội bộ", "Giá bán", "ĐVT *", "Tên hàng *", "Mã hàng *", "Nhóm VTHH", "Giá mua"},
		{"x", "1.500.000", "Hộp", "Que hàn 3.2", "  QH32  ", "Que hàn", "1.200.000,5"},
		{"", "2,5", "Cái", "Béc 0.8", "BEC08", "qh", "#2.5"},
		{"", "#1.234", "Cuộn", "Dây hàn", "DAY12", "Nhóm mới tinh", ""},
		{"", "", "", "", "", "", ""},
		{"", "", "", "Hàng cũ đổi tên", "cu01", "", ""},
	}
	file := xlsxFile(t, good)
	before := snapshotCounts(e)
	res := e.Admin.importOK(t, "/api/import/products?dry_run=1", file)
	if res.Rows != 4 || res.Creates != 3 || res.Updates != 1 || len(res.Errors) != 0 {
		t.Fatalf("thử: %+v", res)
	}
	if snapshotCounts(e) != before {
		t.Fatal("thử không được ghi gì")
	}
	// Thêm một dòng lỗi + trùng mã ⇒ nhập thật bị từ chối, không ghi gì.
	bad := append([][]string{}, good...)
	bad = append(bad, []string{"", "abc", "Cái", "Lỗi giá", "LOI01", "", ""}, []string{"", "1", "Cái", "Trùng", "qh32", "", ""}, []string{"", "1", "", "Thiếu ĐVT", "MOI99", "", ""})
	r := e.Admin.upload("/api/import/products", xlsxFile(t, bad))
	if r.Status != 422 || r.ErrCode() != "IMPORT_INVALID" {
		t.Fatalf("nhập file lỗi: %d %s", r.Status, r.Body)
	}
	var er struct {
		Error struct {
			Details importRes `json:"details"`
		} `json:"error"`
	}
	r.JSON(t, &er)
	errs := er.Error.Details.Errors
	if len(errs) != 3 || errs[0].Row != 9 || errs[0].Column != "Giá bán" || !strings.Contains(errs[1].Message, "trùng với dòng 4") || errs[2].Column != "ĐVT" {
		t.Fatalf("danh sách lỗi: %+v", errs)
	}
	if snapshotCounts(e) != before {
		t.Fatal("có lỗi thì không được ghi gì")
	}
	// Nhập thật file đúng.
	res = e.Admin.importOK(t, "/api/import/products", file)
	if res.Creates != 3 || res.Updates != 1 {
		t.Fatalf("nhập: %+v", res)
	}
	type prod struct {
		Code          string          `json:"code"`
		Name          string          `json:"name"`
		Unit          string          `json:"unit"`
		GroupName     *string         `json:"group_name"`
		SalePrice     decimal.Decimal `json:"sale_price"`
		PurchasePrice decimal.Decimal `json:"purchase_price"`
	}
	get := func(code string) prod {
		var p prod
		e.Admin.OK("GET", "/api/products/lookup?code="+code, nil, &p)
		return p
	}
	q := get("QH32")
	eqDec(t, q.SalePrice, "1500000", "1.500.000")
	eqDec(t, q.PurchasePrice, "1200000.5", "1.200.000,5")
	if q.Name != "Que hàn 3.2" || *q.GroupName != "Que hàn" || q.Code != "QH32" {
		t.Fatalf("QH32: %+v", q)
	}
	b := get("BEC08")
	eqDec(t, b.SalePrice, "2.5", "2,5")
	eqDec(t, b.PurchasePrice, "2.5", "ô số 2.5")
	if b.GroupName == nil || *b.GroupName != "Que hàn" {
		t.Fatalf("nhóm theo mã không phân biệt hoa thường: %+v", b)
	}
	dd := get("DAY12")
	eqDec(t, dd.SalePrice, "1.23", "ô số 1.234 (không phải 1234), giá làm tròn 2 chữ số")
	if dd.GroupName == nil || *dd.GroupName != "Nhóm mới tinh" {
		t.Fatalf("tự tạo nhóm: %+v", dd)
	}
	c := get("CU01")
	if c.Name != "Hàng cũ đổi tên" || c.Unit != "Cái" {
		t.Fatalf("cập nhật theo mã: %+v", c)
	}
	eqDec(t, c.SalePrice, "5000", "ô trống giữ giá cũ")
	eqDec(t, c.PurchasePrice, "3000", "ô trống giữ giá mua cũ")
	_ = old
	var lst struct {
		Total int `json:"total"`
	}
	e.Admin.OK("GET", "/api/products?q=que%20han%203.2", nil, &lst)
	if lst.Total != 1 {
		t.Fatal("search_key của mã mới phải tìm được")
	}
	// Không có dòng tiêu đề ⇒ 400; file không phải xlsx ⇒ 400; quá 10 MB ⇒ 400.
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/import/products?dry_run=1", nil)
	if r := e.Admin.upload("/api/import/products?dry_run=1", xlsxFile(t, [][]string{{"a", "b"}, {"1", "2"}})); r.Status != 400 || !strings.Contains(string(r.Body), "tiêu đề") {
		t.Fatalf("thiếu tiêu đề: %d %s", r.Status, r.Body)
	}
	if r := e.Admin.upload("/api/import/products?dry_run=1", []byte("không phải excel")); r.Status != 400 {
		t.Fatalf("không phải xlsx: %d", r.Status)
	}
	if r := e.Admin.upload("/api/import/products?dry_run=1", make([]byte, 11<<20)); r.Status != 400 || !strings.Contains(string(r.Body), "10 MB") {
		t.Fatalf("quá 10 MB: %d %s", r.Status, r.Body)
	}
	e.Admin.Expect(404, "NOT_FOUND", "GET", "/api/import/khac/template", nil)
}

// C3 — đối tác (cờ x/có), tồn đầu kỳ (phiếu TẠM mỗi kho, ghi sổ được), công nợ đầu kỳ (thay thế số cũ; chỉ quản trị).
func TestMR_C3_DoiTacTonDauCongNoDau(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "import_excel", "permissions")
	res := e.Admin.importOK(t, "/api/import/partners", xlsxFile(t, [][]string{
		{"Mã đối tác", "Tên đối tác", "Là KH", "Là NCC", "Địa chỉ", "Điện thoại", "MST"},
		{"KH01", "Cơ khí Tân Phú", "x", "", "Q. Tân Phú", "0909", ""},
		{"NCC01", "Kiswel", "", "có", "", "", "0300"},
		{"HAI01", "Hai vai", "1", "x", "", "", ""},
	}))
	if res.Creates != 3 || len(res.Errors) != 0 {
		t.Fatalf("đối tác: %+v", res)
	}
	r := e.Admin.upload("/api/import/partners?dry_run=1", xlsxFile(t, [][]string{{"Mã đối tác", "Tên đối tác", "Là KH"}, {"X1", "Không vai", ""}, {"X2", "Sai cờ", "maybe"}}))
	var x importRes
	r.JSON(t, &x)
	if len(x.Errors) != 2 {
		t.Fatalf("lỗi cờ: %+v", x)
	}
	p1 := e.Product("A", "Hàng A", "Cái", 100, 40, 0)
	_ = p1
	e.Product("B", "Hàng B", "Cái", 100, 60, 0)
	// Tồn đầu kỳ: 2 kho ⇒ 2 phiếu tạm; đơn giá trống ⇒ giá mua mặc định.
	stockFile := xlsxFile(t, [][]string{
		{"Mã hàng", "Mã kho", "Số lượng", "Đơn giá"},
		{"A", "KHO1", "10", "45.000"},
		{"B", "kho1", "2,5", ""},
		{"A", "KHO2", "#3", "#41"},
	})
	res = e.Admin.importOK(t, "/api/import/opening_stock?date=2026-01-01", stockFile)
	if len(res.Documents) != 2 || res.Creates != 3 {
		t.Fatalf("tồn đầu: %+v", res)
	}
	d1 := e.Admin.GetDoc(res.Documents[0].ID)
	if d1.DocType != "opening" || d1.Status != "draft" || d1.DocDate.String() != "2026-01-01" || len(d1.Lines) != 2 {
		t.Fatalf("phiếu tồn đầu tạm: %+v", d1)
	}
	eqDec(t, *d1.Lines[1].UnitPrice, "60", "đơn giá trống ⇒ giá mua mặc định")
	eqDec(t, d1.Lines[1].Qty, "2.5", "2,5")
	tp, _ := e.TotalStock(p1)
	eqDec(t, tp, "0", "phiếu tạm chưa vào tồn")
	e.Admin.PostDoc(d1)
	tp, _ = e.TotalStock(p1)
	eqDec(t, tp, "10", "ghi sổ xong mới có tồn")
	r = e.Admin.upload("/api/import/opening_stock?dry_run=1", xlsxFile(t, [][]string{
		{"Mã hàng", "Mã kho", "Số lượng"}, {"KHONGCO", "KHO1", "1"}, {"A", "KHO9", "1"}, {"A", "KHO1", "0"}, {"DV", "KHO1", "1"}, {"A", "KHO3", "1"}, {"a", "kho3", "2"},
	}))
	r.JSON(t, &x)
	if len(x.Errors) != 5 {
		t.Fatalf("lỗi tồn đầu: %+v", x.Errors)
	}
	// Công nợ đầu kỳ: chỉ quản trị; thay thế số cũ; cột vắng ⇒ giữ; ô trống ⇒ 0.
	kt := e.NewUser("kt", "Kế toán")
	if r := kt.upload("/api/import/opening_debt?dry_run=1", xlsxFile(t, [][]string{{"Mã đối tác", "Phải thu"}})); r.Status != 403 {
		t.Fatalf("công nợ đầu kỳ chỉ quản trị: %d", r.Status)
	}
	e.Admin.importOK(t, "/api/import/opening_debt", xlsxFile(t, [][]string{{"Mã đối tác", "Phải thu", "Phải trả"}, {"KH01", "1.000.000", ""}, {"HAI01", "500.000", "-200.000"}}))
	e.Admin.importOK(t, "/api/import/opening_debt", xlsxFile(t, [][]string{{"Mã đối tác", "Phải thu"}, {"KH01", "2.000.000"}}))
	var parts struct {
		Items []struct {
			Code string          `json:"code"`
			Rec  decimal.Decimal `json:"opening_receivable"`
			Pay  decimal.Decimal `json:"opening_payable"`
		} `json:"items"`
	}
	e.Admin.OK("GET", "/api/partners", nil, &parts)
	got := map[string]string{}
	for _, p := range parts.Items {
		got[p.Code] = p.Rec.String() + "/" + p.Pay.String()
	}
	if got["KH01"] != "2000000/0" || got["HAI01"] != "500000/-200000" || got["NCC01"] != "0/0" {
		t.Fatalf("công nợ đầu kỳ: %v", got)
	}
	eqDec(t, e.Debt("receivable", mustPartnerID(e, "KH01")), "2000000", "công nợ chạy lại thay thế")
	// Nhập danh mục cần quyền catalog.write; tồn đầu cần stock.write.
	tk := mrUser(e, "tk", "thukho")
	if r := tk.upload("/api/import/products?dry_run=1", stockFile); r.Status != 403 {
		t.Fatalf("thủ kho không nhập danh mục: %d", r.Status)
	}
	if r := tk.upload("/api/import/opening_stock?dry_run=1&date=2026-01-02", stockFile); r.Status != 200 {
		t.Fatalf("thủ kho nhập tồn đầu: %d %s", r.Status, r.Body)
	}
}

func mustPartnerID(e *Env, code string) int64 {
	var l struct {
		Items []struct {
			ID   int64  `json:"id"`
			Code string `json:"code"`
		} `json:"items"`
	}
	e.Admin.OK("GET", "/api/partners?q="+code, nil, &l)
	for _, it := range l.Items {
		if it.Code == code {
			return it.ID
		}
	}
	e.t.Fatalf("không có đối tác %s", code)
	return 0
}

// C3 — file 20.000 dòng: thử và nhập thật xong trong thời gian hợp lý; 20.001 dòng ⇒ 400.
func TestMR_C3_File20000Dong(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "import_excel")
	build := func(n int) []byte {
		f := excelize.NewFile()
		defer f.Close()
		sw, _ := f.NewStreamWriter("Sheet1")
		_ = sw.SetRow("A1", []any{"Mã hàng", "Tên hàng", "ĐVT", "Nhóm VTHH", "Giá bán", "Giá mua"})
		for i := 1; i <= n; i++ {
			cell, _ := excelize.CoordinatesToCellName(1, i+1)
			_ = sw.SetRow(cell, []any{fmt.Sprintf("SP%05d", i), fmt.Sprintf("Sản phẩm số %d", i), "Cái", fmt.Sprintf("Nhóm %d", i%20), i * 1000, util.FormatVND(decimal.NewFromInt(int64(i) * 100))})
		}
		_ = sw.Flush()
		b, _ := f.WriteToBuffer()
		return b.Bytes()
	}
	file := build(20000)
	start := time.Now()
	res := e.Admin.importOK(t, "/api/import/products?dry_run=1", file)
	dry := time.Since(start)
	if res.Rows != 20000 || res.Creates != 20000 || len(res.Errors) != 0 {
		t.Fatalf("thử 20.000 dòng: rows=%d creates=%d errors=%d", res.Rows, res.Creates, len(res.Errors))
	}
	start = time.Now()
	res = e.Admin.importOK(t, "/api/import/products", file)
	commit := time.Since(start)
	t.Logf("20.000 dòng: file %d KB, thử %v, nhập thật %v", len(file)/1024, dry.Round(time.Millisecond), commit.Round(time.Millisecond))
	if n := e.count("products"); n != 20001 {
		t.Fatalf("số mặt hàng: %d", n)
	}
	if dry > 60*time.Second || commit > 120*time.Second {
		t.Fatalf("quá chậm: thử %v, nhập %v", dry, commit)
	}
	var p struct {
		PurchasePrice decimal.Decimal `json:"purchase_price"`
	}
	e.Admin.OK("GET", "/api/products/lookup?code=SP12345", nil, &p)
	eqDec(t, p.PurchasePrice, "1234500", "\"1.234.500\" = 1234500")
	// Chạy lại ⇒ cập nhật 20.000.
	res = e.Admin.importOK(t, "/api/import/products?dry_run=1", file)
	if res.Updates != 20000 || res.Creates != 0 {
		t.Fatalf("chạy lại: %+v", res.Updates)
	}
	if r := e.Admin.upload("/api/import/products?dry_run=1", build(20001)); r.Status != 400 || !strings.Contains(string(r.Body), "20000") {
		t.Fatalf("quá 20.000 dòng: %d %s", r.Status, r.Body)
	}
	_ = json.Valid
}
