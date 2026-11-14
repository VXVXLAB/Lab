package tests

import (
	"fmt"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"kho/internal/cash"
	"kho/internal/docs"
	"kho/internal/reports"
)

// B1 — ký tự NUL trong dữ liệu nhập / tham số truy vấn phải trả 400 VALIDATION (không bao giờ 500).
// REQ: 023, 056, 025
func TestREQ023_056_KyTuNULTra400(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	cases := []struct {
		method, path string
		body         any
	}{
		{"POST", "/api/products", `{"code":"X1","name":"Tên có NUL\u0000","unit":"Cái"}`},
		{"POST", "/api/partners", `{"code":"X2\u0000","name":"Đối tác","is_customer":true}`},
		{"POST", "/api/documents", fmt.Sprintf(`{"doc_type":"sale","doc_date":"2026-01-01","partner_id":%d,"warehouse_id":%d,"note":"ghi chú\u0000","lines":[{"product_id":%d,"qty":1}]}`, cus, e.WH["KHO1"], p)},
		{"POST", "/api/vouchers", fmt.Sprintf(`{"voucher_type":"receipt","account_id":%d,"lines":[{"description":"a\u0000b","amount":1}]}`, e.TM)},
		{"POST", "/api/auth/login", "{\"username\":\"admin\x00\",\"password\":\"x\"}"},
		{"GET", "/api/products?q=a%00b", nil},
		{"GET", "/api/documents?q=%00", nil},
		{"GET", "/api/reports/stock-summary?q=x%00", nil},
		{"GET", "/api/partners?type=customer&a%00=1", nil},
	}
	for _, c := range cases {
		r := e.Admin.Do(c.method, c.path, c.body)
		if r.Status != 400 || r.ErrCode() != "VALIDATION" || !strings.Contains(string(r.Body), "NUL") {
			t.Errorf("%s %s: muốn 400 VALIDATION có nhắc NUL, nhận %d %s", c.method, c.path, r.Status, r.Body)
		}
	}
	// Chuỗi văn bản "\u0000" (dấu \ được thoát) là dữ liệu hợp lệ, không bị chặn nhầm.
	var x struct {
		Name string `json:"name"`
	}
	e.Admin.OK("POST", "/api/products", `{"code":"X3","name":"a\\u0000b","unit":"Cái"}`, &x)
	if x.Name != `a\u0000b` {
		t.Fatalf("tên chứa chữ \\u0000: %q", x.Name)
	}
}

// B2 — đổi cờ Khách hàng/NCC của đối tác đã phát sinh: chứng từ cũ vẫn sửa / ghi sổ được; chỉ kiểm cờ khi đặt/đổi đối tác.
// REQ: 038, 036, 003
func TestREQ038_DoiCoDoiTacVanSuaPhieuCu(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	kh := e.Partner("KH", "Khách rồi thành NCC", true, false)
	other := e.Partner("KH2", "Khách khác", true, false)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "100", nil))
	s := e.Admin.Posted(DocBody("sale", "2026-02-01", kh, e.WH["KHO1"], Line(p, "5", "100")))
	dr := e.Admin.CreateDoc(DocBody("sale", "2026-02-02", kh, e.WH["KHO1"], Line(p, "1", "100")))
	// Đối tác đổi thành chỉ-là-NCC.
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", kh), map[string]any{"code": "KH", "name": "Khách rồi thành NCC", "is_supplier": true}, nil)
	// Sửa phiếu bán cũ (giữ đối tác) vẫn được.
	var upd docs.Document
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", s.ID), map[string]any{"version": s.Version, "doc_date": "2026-02-01", "partner_id": kh, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(p, "6", "100")}}, &upd)
	eqDec(t, upd.TotalAmount, "600", "sửa phiếu cũ")
	// Ghi sổ phiếu tạm cũ của đối tác đó vẫn được.
	e.Admin.PostDoc(dr)
	// Nhưng lập phiếu bán MỚI cho đối tác này thì không; đổi đối tác của phiếu sang người không phải KH cũng không.
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("sale", "2026-02-03", kh, e.WH["KHO1"], Line(p, "1", "100")))
	s2 := e.Admin.Posted(DocBody("sale", "2026-02-03", other, e.WH["KHO1"], Line(p, "1", "100")))
	e.Admin.Expect(400, "VALIDATION", "PUT", fmt.Sprintf("/api/documents/%d", s2.ID), map[string]any{"version": s2.Version, "doc_date": "2026-02-03", "partner_id": kh, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(p, "1", "100")}})
}

// B3 — ngày nhập tường minh không bao giờ bị thay bằng hôm nay: chứng từ/phiếu ngoài khoảng ⇒ 400; báo cáo tôn trọng mọi ngày hợp lệ.
// REQ: 019, 013, 056
func TestREQ019_NgayTuongMinhKhongBiThay(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "7", nil))
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("sale", "0001-01-01", cus, e.WH["KHO1"], Line(p, "1", nil)))
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/vouchers", map[string]any{"voucher_type": "receipt", "voucher_date": "0001-01-01", "account_id": e.TM, "lines": []any{map[string]any{"amount": 1}}})
	// Bỏ trống ⇒ hôm nay (vẫn như cũ).
	dd0 := e.Admin.CreateDoc(map[string]any{"doc_type": "sale", "partner_id": cus, "warehouse_id": e.WH["KHO1"]})
	var dash reports.Dashboard
	e.Admin.OK("GET", "/api/dashboard", nil, &dash)
	if dd0.DocDate.String() != dash.Today.String() {
		t.Fatalf("bỏ trống ngày ⇒ hôm nay: %s", dd0.DocDate)
	}
	// Báo cáo: as_of=0001-01-01 ⇒ tồn 0; from=0001-01-01 ⇒ thấy mọi giao dịch.
	var ss stockSummary
	e.Admin.OK("GET", "/api/reports/stock-summary?as_of=0001-01-01&only_with_data=false", nil, &ss)
	for _, it := range ss.Items {
		eqDec(t, it.Total, "0", "tồn tại 0001-01-01")
	}
	var raw struct {
		AsOf string `json:"as_of"`
	}
	e.Admin.OK("GET", "/api/reports/stock-summary?as_of=0001-01-01", nil, &raw)
	if raw.AsOf != "0001-01-01" {
		t.Fatalf("as_of phải giữ nguyên: %s", raw.AsOf)
	}
	var l reports.Ledger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d&from=0001-01-01", p), nil, &l)
	if len(l.Rows) != 1 {
		t.Fatalf("from=0001-01-01 phải thấy giao dịch: %+v", l.Rows)
	}
	eqDec(t, l.Closing, "7", "tồn cuối")
	var nxt reports.NXT
	e.Admin.OK("GET", "/api/reports/stock-nxt?from=0001-01-01&to=9999-12-31", nil, &nxt)
	if len(nxt.Items) != 1 || !nxt.Items[0].QtyIn.Equal(d("7")) {
		t.Fatalf("NXT khoảng cực rộng: %+v", nxt.Items)
	}
}

// B4 — số tiền / số lượng phải > 0 SAU khi làm tròn (0,001 đồng ⇒ 0 ⇒ từ chối, không lưu âm thầm thành 0).
// REQ: 056, 057, 023
func TestREQ056_SoTienSoLuongQuaNhoBiTuChoi(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	for _, amt := range []string{"0.001", "0.004", "1e-9"} {
		r := e.Admin.Expect(400, "VALIDATION", "POST", "/api/vouchers", fmt.Sprintf(`{"voucher_type":"receipt","account_id":%d,"partner_id":%d,"lines":[{"description":"x","amount":%s}]}`, e.TM, cus, amt))
		if !strings.Contains(string(r.Body), "lớn hơn 0") {
			t.Fatalf("thông báo: %s", r.Body)
		}
	}
	v := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": cus, "lines": []any{map[string]any{"amount": "0.005"}}})
	eqDec(t, v.TotalAmount, "0.01", "0,005 làm tròn 0,01")
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("sale", "2026-01-01", cus, e.WH["KHO1"], Line(p, "0.0004", nil)))
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("sale", "2026-01-01", cus, e.WH["KHO1"], map[string]any{"product_id": e.DV, "qty": "0.0004", "unit_price": 5}))
	dd := e.Admin.CreateDoc(DocBody("sale", "2026-01-01", cus, e.WH["KHO1"], Line(p, "0.0005", nil)))
	eqDec(t, dd.Lines[0].Qty, "0.001", "0,0005 làm tròn 0,001")
}

// B5 — Excel: ô Cộng / Tổng nợ / tổng báo cáo là công thức có kết quả lưu sẵn dạng SỐ; đơn giá có số lẻ hiển thị đủ số lẻ.
// REQ: 071, 072, 074, 087, 063
func TestREQ071_087_ExcelCongThucSoVaDonGiaLe(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	var pa struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/products", map[string]any{"code": "A", "name": "Hàng A", "unit": "Cái", "sale_price": 13001.5, "purchase_price": 9000}, &pa)
	a := pa.ID
	b := e.Product("B", "Hàng B", "Cái", 20000, 9000, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "10", nil), Line(b, "10", nil))
	s := e.Admin.Posted(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(a, "2", "13001.5"), Line(b, "1", nil)))
	eqDec(t, s.TotalAmount, "46003", "tổng = 26.003 + 20.000")
	body := e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", s.ID), nil, nil).Body
	checkNumericFormulas(t, body, map[string]string{"SUM(G": "46003", "+G": "46003"})
	f := openXLSX(t, body)
	defer f.Close()
	sh := f.GetSheetList()[0]
	rows, _ := f.GetRows(sh, excelize.Options{RawCellValue: true})
	for i, r := range rows {
		if len(r) > 5 && r[1] == "A" {
			cell := fmt.Sprintf("F%d", i+1)
			if r[5] != "13001.5" {
				t.Fatalf("đơn giá thô: %q", r[5])
			}
			shown, _ := f.GetCellValue(sh, cell)
			if !strings.Contains(shown, "13,001.5") {
				t.Fatalf("đơn giá 13001,5 phải hiển thị số lẻ, hiện %q", shown)
			}
		}
		if len(r) > 6 && r[1] == "B" {
			shown, _ := f.GetCellValue(sh, fmt.Sprintf("F%d", i+1))
			if shown != "20,000" {
				t.Fatalf("đơn giá chẵn không hiện số lẻ: %q", shown)
			}
		}
	}
	// Phiếu thu: tổng số tiền là công thức ra số.
	v := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": cus, "lines": []any{map[string]any{"amount": 1000}, map[string]any{"amount": 2500}}})
	vb := e.Admin.OK("GET", fmt.Sprintf("/api/vouchers/%d/export?format=xlsx", v.ID), nil, nil).Body
	checkNumericFormulas(t, vb, map[string]string{"SUM(D": "3500"})
	if r := findRow(xlsxRows(t, vb), 2, "Tổng số tiền (đồng):"); r == nil || r[3] != "3500" {
		t.Fatalf("phiếu thu tổng số tiền: %q", r)
	}
	// Báo cáo: dòng Cộng là công thức SUM ra số.
	rb := e.Admin.OK("GET", "/api/reports/debt-summary?side=receivable&format=xlsx", nil, nil).Body
	checkNumericFormulas(t, rb, map[string]string{"SUM(F": "46003", "SUM(G": "3500"})
	sb := e.Admin.OK("GET", "/api/reports/stock-summary?format=xlsx", nil, nil).Body
	checkNumericFormulas(t, sb, map[string]string{"SUM(J": "17"})
}

// Q1 — hoàn tiền không làm sai công nợ: NCC hoàn tiền (phiếu thu) và trả lại tiền khách (phiếu chi) đưa cả hai sổ về 0.
// REQ: 062, 007, 084, 085, 052, 054
func TestREQ062_HoanTienKhongLamSaiCongNo(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	p := e.Product("P", "Hàng P", "Cái", 200000, 100000, 0)
	sup := e.Partner("NCC", "NCC hoàn tiền", false, true)
	e.Admin.Posted(DocBody("purchase", "2026-06-01", sup, e.WH["KHO1"], Line(p, "10", "100000")))
	e.Admin.Voucher(map[string]any{"voucher_type": "payment", "voucher_date": "2026-06-02", "account_id": e.TM, "partner_id": sup, "lines": []any{map[string]any{"description": "Trả đủ", "amount": 1000000}}})
	e.Admin.Posted(DocBody("purchase_return", "2026-06-03", sup, e.WH["KHO1"], Line(p, "5", "100000")))
	eqDec(t, e.Debt("payable", sup), "-500000", "NCC nợ lại mình")
	r := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "voucher_date": "2026-06-04", "account_id": e.TM, "partner_id": sup, "lines": []any{map[string]any{"description": "NCC hoàn tiền", "amount": 500000}}})
	if r.DebtSide != "payable" {
		t.Fatalf("phiếu thu từ NCC thuần mặc định debt_side=payable: %q", r.DebtSide)
	}
	eqDec(t, e.Debt("payable", sup), "0", "phải trả sau khi NCC hoàn tiền")
	eqDec(t, e.Debt("receivable", sup), "0", "NCC không có phải thu")

	c := e.Partner("KH", "Khách nhận lại tiền", true, false)
	s := e.Admin.Posted(DocBody("sale", "2026-06-01", c, e.WH["KHO1"], Line(p, "3", "200000")))
	_ = s
	e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "voucher_date": "2026-06-02", "account_id": e.TM, "partner_id": c, "lines": []any{map[string]any{"amount": 600000}}})
	e.Admin.Posted(DocBody("sale_return", "2026-06-03", c, e.WH["KHO1"], Line(p, "1", "200000")))
	eqDec(t, e.Debt("receivable", c), "-200000", "mình nợ khách")
	pay := e.Admin.Voucher(map[string]any{"voucher_type": "payment", "voucher_date": "2026-06-04", "account_id": e.NH, "partner_id": c, "lines": []any{map[string]any{"description": "Trả lại tiền khách", "amount": 200000}}})
	if pay.DebtSide != "receivable" {
		t.Fatalf("phiếu chi cho KH thuần mặc định debt_side=receivable: %q", pay.DebtSide)
	}
	eqDec(t, e.Debt("receivable", c), "0", "phải thu sau khi trả lại tiền khách")
	eqDec(t, e.Debt("payable", c), "0", "khách không có phải trả")
	// Sổ chi tiết: phiếu chi nằm bên TĂNG của sổ phải thu, có nhãn rõ ràng, mở được phiếu.
	var l reports.DebtLedger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/debt-ledger?side=receivable&partner_id=%d", c), nil, &l)
	last := l.Rows[len(l.Rows)-1]
	if last.VoucherID == nil || *last.VoucherID != pay.ID || !last.Increase.Equal(d("200000")) || !strings.Contains(last.Description, "trả lại tiền khách") {
		t.Fatalf("dòng trả lại tiền khách: %+v", last)
	}
	// Tổng hợp & dashboard đều về 0.
	var dash reports.Dashboard
	e.Admin.OK("GET", "/api/dashboard", nil, &dash)
	eqDec(t, dash.TotalReceivable, "0", "dashboard phải thu")
	eqDec(t, dash.TotalPayable, "0", "dashboard phải trả")
	// Nợ cũ của phiếu bán sau đó tính cả phiếu chi trả lại tiền.
	s3 := e.Admin.Posted(DocBody("sale", "2026-06-05", c, e.WH["KHO1"], Line(p, "1", "200000")))
	eqDec(t, *s3.OldDebt, "0", "nợ cũ sau hoàn tiền")
	// Chỉ định tường minh: đối tác vừa KH vừa NCC, phiếu thu ghi vào phía phải trả.
	both := e.Partner("HAI", "Vừa KH vừa NCC", true, true)
	v := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": both, "debt_side": "payable", "lines": []any{map[string]any{"amount": 1000}}})
	if v.DebtSide != "payable" {
		t.Fatalf("debt_side tường minh: %q", v.DebtSide)
	}
	eqDec(t, e.Debt("payable", both), "1000", "thu hoàn tiền làm tăng phải trả")
	eqDec(t, e.Debt("receivable", both), "0", "không chạm phải thu")
	v2 := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": both, "lines": []any{map[string]any{"amount": 300}}})
	if v2.DebtSide != "receivable" {
		t.Fatalf("mặc định với đối tác hai vai: %q", v2.DebtSide)
	}
	// Sửa phiếu đổi phía.
	var v3 cash.Voucher
	e.Admin.OK("PUT", fmt.Sprintf("/api/vouchers/%d", v.ID), map[string]any{"version": v.Version, "voucher_type": "receipt", "account_id": e.TM, "partner_id": both, "debt_side": "receivable", "lines": []any{map[string]any{"amount": 1000}}}, &v3)
	eqDec(t, e.Debt("payable", both), "0", "sau khi đổi phía")
	eqDec(t, e.Debt("receivable", both), "-1300", "phiếu thu giảm phải thu")
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/vouchers", map[string]any{"voucher_type": "receipt", "account_id": e.TM, "debt_side": "xyz", "lines": []any{map[string]any{"amount": 1}}})
	var vl struct {
		Items []cash.Summary `json:"items"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/vouchers?partner_id=%d", sup), nil, &vl)
	if len(vl.Items) != 2 || vl.Items[0].DebtSide != "payable" {
		t.Fatalf("danh sách có debt_side: %+v", vl.Items)
	}
}

// Q2 — xóa phiếu tạm đang được phiếu thu/chi tham chiếu ⇒ 409 IN_USE nêu số phiếu; bỏ ghi sổ vẫn được.
// REQ: 062, 039
func TestREQ062_XoaPhieuDangDuocPhieuThuThamChieu(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "10", nil))
	s := e.Admin.Posted(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "1", "100")))
	v := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": cus, "lines": []any{map[string]any{"description": "Thu tiền " + *s.DocNo, "amount": 100, "document_id": s.ID}}})
	var un docs.Document
	e.Admin.OK("POST", fmt.Sprintf("/api/documents/%d/unpost", s.ID), map[string]any{"version": s.Version}, &un)
	r := e.Admin.Expect(409, "IN_USE", "DELETE", fmt.Sprintf("/api/documents/%d?version=%d", s.ID, un.Version), nil)
	if !strings.Contains(string(r.Body), v.VoucherNo) {
		t.Fatalf("thông báo phải nêu số phiếu thu %s: %s", v.VoucherNo, r.Body)
	}
	var vv cash.Voucher
	e.Admin.OK("GET", fmt.Sprintf("/api/vouchers/%d", v.ID), nil, &vv)
	if vv.Lines[0].DocumentID == nil || *vv.Lines[0].DocumentID != s.ID {
		t.Fatal("liên kết phiếu thu phải còn nguyên")
	}
	// Bỏ liên kết ở phiếu thu rồi xóa được.
	e.Admin.OK("PUT", fmt.Sprintf("/api/vouchers/%d", v.ID), map[string]any{"version": v.Version, "voucher_type": "receipt", "account_id": e.TM, "partner_id": cus, "lines": []any{map[string]any{"description": "Thu tiền", "amount": 100}}}, nil)
	e.Admin.OK("DELETE", fmt.Sprintf("/api/documents/%d?version=%d", s.ID, un.Version), nil, nil)
}

// Q3 — tìm không dấu ở mọi danh sách: ghi chú chứng từ, phiếu thu chi, kho, nhóm VTHH, tài khoản tiền.
// REQ: 012, 020, 035, 037
func TestREQ035_TimKhongDauMoiDanhSach(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	body := DocBody("sale", "2026-01-02", cus, e.WH["KHO1"], Line(p, "1", nil))
	body["note"] = "Giao hàng Thủ Đức"
	dr := e.Admin.CreateDoc(body)
	e.Admin.OK("POST", "/api/warehouses", map[string]any{"code": "KHO5", "name": "Kho Bình Dương"}, nil)
	e.Group("QH", "Que hàn điện")
	e.Admin.OK("POST", "/api/cash-accounts", map[string]any{"code": "ACB", "name": "Tài khoản Á Châu", "kind": "bank"}, nil)
	e.Admin.Voucher(map[string]any{"voucher_type": "payment", "account_id": e.TM, "note": "Chi tiền điện", "lines": []any{map[string]any{"description": "Điện tháng 9", "amount": 1}}})
	check := func(path string, want int) {
		t.Helper()
		var r struct {
			Total int `json:"total"`
		}
		e.Admin.OK("GET", path, nil, &r)
		if r.Total != want {
			t.Fatalf("%s: muốn %d kết quả, nhận %d", path, want, r.Total)
		}
	}
	check("/api/documents?q=thu%20duc", 1)
	check("/api/documents?q=TH%E1%BB%A6%20%C4%90%E1%BB%A8C", 1) // "THỦ ĐỨC"
	check("/api/warehouses?q=binh%20duong", 1)
	check("/api/product-groups?q=que%20han", 1)
	check("/api/cash-accounts?q=a%20chau", 1)
	check("/api/vouchers?q=tien%20dien", 1)
	check("/api/vouchers?q=dien%20thang", 1)
	_ = dr
}
