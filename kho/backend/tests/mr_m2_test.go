package tests

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/shopspring/decimal"

	"kho/internal/docs"
	"kho/internal/reports"
)

func (e *Env) setProduct(id int64, body map[string]any) {
	e.t.Helper()
	e.Admin.OK("PUT", fmt.Sprintf("/api/products/%d", id), body, nil)
}

// C5 — tồn tối thiểu: tắt ⇒ quy tắc ≤ 5 như cũ, JSON không có min_stock; bật ⇒ "sắp hết" theo từng mã (NULL ⇒ không
// cảnh báo), báo cáo hàng dưới tồn tối thiểu, Hàng cần đặt thêm cột; mẫu nhập Excel có cột Tồn tối thiểu chỉ khi bật.
func TestMR_C5_TonToiThieu(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	a := e.Product("A", "Hàng A", "Cái", 100, 50, 0)
	b := e.Product("B", "Hàng B", "Cái", 100, 50, 0)
	c := e.Product("C", "Hàng C", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "10", nil), Line(b, "3", nil), Line(c, "3", nil))
	cus := e.Partner("KH", "Khách", true, false)
	e.Admin.CreateDoc(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(c, "5", nil)))
	// Tắt: y như bản chuẩn.
	r := e.Admin.OK("GET", fmt.Sprintf("/api/products/%d", a), nil, nil)
	if strings.Contains(string(r.Body), "min_stock") {
		t.Fatalf("tắt ⇒ không có min_stock: %s", r.Body)
	}
	e.setProduct(a, map[string]any{"code": "A", "name": "Hàng A", "unit": "Cái", "sale_price": 100, "purchase_price": 50, "min_stock": 20})
	var dash reports.Dashboard
	r = e.Admin.OK("GET", "/api/dashboard", nil, &dash)
	if dash.LowStockCount != 2 || strings.Contains(string(r.Body), "low_stock_rule") {
		t.Fatalf("tắt ⇒ quy tắc ≤ 5 (B, C): %d %s", dash.LowStockCount, r.Body)
	}
	dd := e.Admin.OK("GET", "/api/reports/draft-demand", nil, nil)
	if strings.Contains(string(dd.Body), "min_stock") || strings.Contains(string(dd.Body), "order_more") {
		t.Fatalf("tắt ⇒ hàng cần đặt như cũ: %s", dd.Body)
	}
	e.Admin.Expect(404, "FEATURE_OFF", "GET", "/api/reports/low-stock", nil)
	// Bật.
	mrEnable(e, "min_stock", "import_excel")
	var pa struct {
		MinStock *decimal.Decimal `json:"min_stock"`
	}
	r = e.Admin.OK("GET", fmt.Sprintf("/api/products/%d", a), nil, &pa)
	if !strings.Contains(string(r.Body), `"min_stock":null`) {
		t.Fatalf("PUT khi tắt không được ghi min_stock: %s", r.Body)
	}
	e.setProduct(a, map[string]any{"code": "A", "name": "Hàng A", "unit": "Cái", "sale_price": 100, "purchase_price": 50, "min_stock": 20})
	e.setProduct(c, map[string]any{"code": "C", "name": "Hàng C", "unit": "Cái", "sale_price": 100, "purchase_price": 50, "min_stock": 2})
	e.Admin.Expect(400, "VALIDATION", "PUT", fmt.Sprintf("/api/products/%d", b), map[string]any{"code": "B", "name": "Hàng B", "unit": "Cái", "min_stock": -1})
	e.Admin.OK("GET", fmt.Sprintf("/api/products/%d", a), nil, &pa)
	eqDec(t, *pa.MinStock, "20", "min_stock")
	r = e.Admin.OK("GET", "/api/dashboard", nil, &dash)
	if dash.LowStockCount != 1 || !strings.Contains(string(r.Body), `"low_stock_rule":"min_stock"`) {
		t.Fatalf("bật ⇒ chỉ A (10 ≤ 20); B không đặt; C 3 > 2: %d %s", dash.LowStockCount, r.Body)
	}
	var low struct {
		Items []reports.LowStockRow `json:"items"`
	}
	e.Admin.OK("GET", "/api/reports/low-stock", nil, &low)
	if len(low.Items) != 1 || low.Items[0].ProductID != a {
		t.Fatalf("hàng dưới tồn tối thiểu: %+v", low.Items)
	}
	eqDec(t, low.Items[0].Need, "10", "cần bổ sung")
	if row := findRow(xlsxRows(t, e.Admin.OK("GET", "/api/reports/low-stock?format=xlsx", nil, nil).Body), 1, "A"); row == nil || row[7] != "10" {
		t.Fatalf("xlsx: %q", row)
	}
	var dem struct {
		Items []reports.DemandRow `json:"items"`
	}
	e.Admin.OK("GET", "/api/reports/draft-demand", nil, &dem)
	got := map[string]reports.DemandRow{}
	for _, x := range dem.Items {
		got[x.ProductCode] = x
	}
	if len(dem.Items) != 2 || got["C"].OrderMore == nil || got["A"].OrderMore == nil {
		t.Fatalf("hàng cần đặt: %+v", dem.Items)
	}
	eqDec(t, got["C"].Shortage, "2", "C thiếu cho phiếu tạm")
	eqDec(t, *got["C"].OrderMore, "4", "C cần đặt thêm = 2 − (3 − 5)")
	eqDec(t, *got["A"].OrderMore, "10", "A không có phiếu tạm nhưng dưới tồn tối thiểu")
	rows := xlsxRows(t, e.Admin.OK("GET", "/api/reports/draft-demand?format=xlsx", nil, nil).Body)
	if h := findRow(rows, 0, "STT"); h == nil || h[7] != "Tồn tối thiểu" || h[8] != "Cần đặt thêm" {
		t.Fatalf("xlsx hàng cần đặt: %q", h)
	}
	// Mẫu nhập Excel có cột Tồn tối thiểu; nhập được.
	tpl := xlsxRows(t, e.Admin.OK("GET", "/api/import/products/template", nil, nil).Body)
	if !strings.Contains(strings.Join(tpl[0], "|"), "Tồn tối thiểu") {
		t.Fatalf("mẫu thiếu cột: %v", tpl[0])
	}
	e.Admin.importOK(t, "/api/import/products", xlsxFile(t, [][]string{{"Mã hàng", "Tồn tối thiểu"}, {"B", "4"}}))
	e.Admin.OK("GET", "/api/dashboard", nil, &dash)
	if dash.LowStockCount != 2 {
		t.Fatalf("B (3 ≤ 4) thêm vào: %d", dash.LowStockCount)
	}
	// Tắt lại: số liệu đã đặt giữ nguyên, hành vi về như cũ.
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"min_stock": false}}, nil)
	tpl = xlsxRows(t, e.Admin.OK("GET", "/api/import/products/template", nil, nil).Body)
	if strings.Contains(strings.Join(tpl[0], "|"), "Tồn tối thiểu") {
		t.Fatal("tắt ⇒ mẫu không có cột Tồn tối thiểu")
	}
	e.setProduct(a, map[string]any{"code": "A", "name": "Hàng A", "unit": "Cái", "sale_price": 100, "purchase_price": 50})
	var ms *decimal.Decimal
	_ = e.Pool.QueryRow(context.Background(), `SELECT min_stock FROM products WHERE id=$1`, a).Scan(&ms)
	if ms == nil || !ms.Equal(d("20")) {
		t.Fatalf("tắt ⇒ giữ nguyên min_stock: %v", ms)
	}
}

// C6 — giá theo khách: nguồn giá (giá riêng > giá bán gần nhất cho khách trên phiếu bán đã ghi sổ theo ngày rồi thứ tự
// ghi sổ > giá mặc định); không tính khách trả hàng, phiếu tạm, khách khác, phiếu sau ngày xét; phiếu bán tự điền theo đó.
func TestMR_C6_GiaTheoKhach(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	k := e.Partner("K", "Khách K", true, false)
	k2 := e.Partner("K2", "Khách khác", true, false)
	sup := e.Partner("NCC", "NCC", false, true)
	a := e.Product("A", "Hàng A", "Cái", 1000, 1, 0)
	b := e.Product("B", "Hàng B", "Cái", 2000, 1, 0)
	c := e.Product("C", "Hàng C", "Cái", 3000, 1, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "100", nil), Line(b, "100", nil), Line(c, "100", nil))
	e.Admin.Expect(404, "FEATURE_OFF", "GET", fmt.Sprintf("/api/partners/%d/prices", k), nil)
	e.Admin.Expect(404, "FEATURE_OFF", "GET", fmt.Sprintf("/api/products/sale-price?partner_id=%d&ids=%d", k, a), nil)
	mrEnable(e, "price_list", "permissions", "import_excel")
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d/prices", k), map[string]any{"items": []any{map[string]any{"product_code": "a", "price": 900, "note": "Hợp đồng"}}}, nil)
	e.Admin.Posted(DocBody("sale", "2026-02-01", k, e.WH["KHO1"], Line(b, "1", "1800")))
	e.Admin.Posted(DocBody("sale", "2026-01-15", k, e.WH["KHO1"], Line(b, "1", "1750"))) // ngày sớm hơn, ghi sổ sau
	last := e.Admin.Posted(DocBody("sale", "2026-02-01", k, e.WH["KHO1"], Line(b, "1", "1850")))
	e.Admin.Posted(DocBody("sale_return", "2026-03-01", k, e.WH["KHO1"], Line(b, "1", "1500")))
	e.Admin.CreateDoc(DocBody("sale", "2026-03-02", k, e.WH["KHO1"], Line(b, "1", "1")))
	e.Admin.Posted(DocBody("sale", "2026-04-01", k2, e.WH["KHO1"], Line(b, "1", "1600")))
	var q struct {
		Items []struct {
			ProductID    int64           `json:"product_id"`
			Price        decimal.Decimal `json:"price"`
			Source       string          `json:"source"`
			SourceName   string          `json:"source_name"`
			DefaultPrice decimal.Decimal `json:"default_price"`
			DocumentID   *int64          `json:"document_id"`
			DocNo        *string         `json:"doc_no"`
			Note         *string         `json:"note"`
		} `json:"items"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products/sale-price?partner_id=%d&ids=%d,%d,%d&date=2026-12-31", k, a, b, c), nil, &q)
	if len(q.Items) != 3 {
		t.Fatalf("báo giá: %+v", q.Items)
	}
	if q.Items[0].Source != "customer" || !q.Items[0].Price.Equal(d("900")) || *q.Items[0].Note != "Hợp đồng" {
		t.Fatalf("A giá riêng: %+v", q.Items[0])
	}
	if q.Items[1].Source != "last_sale" || !q.Items[1].Price.Equal(d("1850")) || *q.Items[1].DocumentID != last.ID || *q.Items[1].DocNo != *last.DocNo {
		t.Fatalf("B giá bán gần nhất (cùng ngày ⇒ ghi sổ sau): %+v", q.Items[1])
	}
	if q.Items[2].Source != "default" || !q.Items[2].Price.Equal(d("3000")) || q.Items[2].SourceName == "" {
		t.Fatalf("C mặc định: %+v", q.Items[2])
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products/sale-price?partner_id=%d&ids=%d&date=2026-01-20", k, b), nil, &q)
	if !q.Items[0].Price.Equal(d("1750")) {
		t.Fatalf("chỉ tính phiếu đến ngày xét: %+v", q.Items[0])
	}
	// Phiếu bán không gửi đơn giá ⇒ tự điền theo nguồn giá; gửi giá ⇒ giữ.
	doc := e.Admin.CreateDoc(DocBody("sale", "2026-05-01", k, e.WH["KHO1"], Line(a, "1", nil), Line(b, "1", nil), Line(c, "1", nil), Line(c, "1", "2500")))
	for i, want := range []string{"900", "1850", "3000", "2500"} {
		eqDec(t, *doc.Lines[i].UnitPrice, want, fmt.Sprintf("dòng %d", i+1))
	}
	// Phiếu trả hàng / phiếu mua vẫn dùng giá mặc định.
	ret := e.Admin.CreateDoc(DocBody("sale_return", "2026-05-01", k, e.WH["KHO1"], Line(a, "1", nil)))
	eqDec(t, *ret.Lines[0].UnitPrice, "1000", "khách trả hàng dùng giá mặc định")
	_ = sup
	// Bảng giá: thay toàn bộ, xóa một dòng, khách không phải KH ⇒ 400, quyền sale.write.
	var lst struct {
		Items []struct {
			ProductCode string          `json:"product_code"`
			Price       decimal.Decimal `json:"price"`
		} `json:"items"`
	}
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d/prices", k), map[string]any{"replace": true, "items": []any{
		map[string]any{"product_id": b, "price": 1999}, map[string]any{"product_id": c, "price": "2999.5"}}}, &lst)
	if len(lst.Items) != 2 || lst.Items[0].ProductCode != "B" {
		t.Fatalf("thay toàn bộ: %+v", lst.Items)
	}
	e.Admin.OK("DELETE", fmt.Sprintf("/api/partners/%d/prices/%d", k, b), nil, nil)
	e.Admin.Expect(404, "NOT_FOUND", "DELETE", fmt.Sprintf("/api/partners/%d/prices/%d", k, b), nil)
	e.Admin.Expect(400, "VALIDATION", "PUT", fmt.Sprintf("/api/partners/%d/prices", sup), map[string]any{"items": []any{}})
	e.Admin.Expect(400, "VALIDATION", "PUT", fmt.Sprintf("/api/partners/%d/prices", k), map[string]any{"items": []any{map[string]any{"product_id": a, "price": -1}}})
	tk := mrUser(e, "tk", "thukho")
	tk.Expect(403, "FORBIDDEN", "PUT", fmt.Sprintf("/api/partners/%d/prices", k), map[string]any{"items": []any{}})
	tk.OK("GET", fmt.Sprintf("/api/partners/%d/prices", k), nil, nil)
	// Xóa mặt hàng / đối tác chưa phát sinh chứng từ ⇒ xóa luôn giá riêng (giá riêng là cấu hình).
	z := e.Product("Z", "Hàng Z", "Cái", 1, 1, 0)
	kz := e.Partner("KZ", "Khách Z", true, false)
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d/prices", kz), map[string]any{"items": []any{map[string]any{"product_id": z, "price": 5}}}, nil)
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d/prices", k), map[string]any{"items": []any{map[string]any{"product_id": z, "price": 6}}}, nil)
	e.Admin.OK("DELETE", fmt.Sprintf("/api/products/%d", z), nil, nil)
	e.Admin.OK("DELETE", fmt.Sprintf("/api/partners/%d", kz), nil, nil)
	if n := e.count("partner_prices WHERE product_id=" + fmt.Sprint(z)); n != 0 {
		t.Fatalf("giá riêng còn sót: %d", n)
	}
	// Nhập bảng giá từ Excel (mẫu tải về nhập thử được; nhập thật cập nhật).
	tpl := e.Admin.OK("GET", "/api/import/partner_prices/template", nil, nil).Body
	if res := e.Admin.importOK(t, "/api/import/partner_prices?dry_run=1", tpl); res.Rows != 2 || len(res.Errors) != 0 {
		t.Fatalf("mẫu bảng giá: %+v", res)
	}
	res := e.Admin.importOK(t, "/api/import/partner_prices", xlsxFile(t, [][]string{{"Mã khách hàng", "Mã hàng", "Giá"}, {"K", "A", "950"}, {"K", "C", "2.800"}, {"NCC", "A", "1"}, {"K", "A", "1"}}[:3]))
	if res.Creates != 1 || res.Updates != 1 {
		t.Fatalf("nhập bảng giá: %+v", res)
	}
	r := e.Admin.upload("/api/import/partner_prices?dry_run=1", xlsxFile(t, [][]string{{"Mã khách hàng", "Mã hàng", "Giá"}, {"NCC", "A", "1"}, {"K", "A", "1"}, {"k", "a", "2"}}))
	var bad importRes
	r.JSON(t, &bad)
	if len(bad.Errors) != 2 {
		t.Fatalf("lỗi nhập bảng giá (NCC không phải KH, trùng): %+v", bad.Errors)
	}
	tk.upload("/api/import/partner_prices?dry_run=1", tpl) // không cần kiểm: ma trận quyền đã phủ
	// Tắt tính năng ⇒ phiếu bán lại dùng giá mặc định (dữ liệu giá riêng vẫn còn).
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"price_list": false}}, nil)
	doc = e.Admin.CreateDoc(DocBody("sale", "2026-05-02", k, e.WH["KHO1"], Line(a, "1", nil)))
	eqDec(t, *doc.Lines[0].UnitPrice, "1000", "tắt ⇒ giá mặc định")
}

func creditBody(cus int64, date string, lines ...map[string]any) map[string]any {
	return DocBody("sale", date, cus, 0, lines...)
}

// C8 — hạn mức công nợ: cảnh báo khi ghi sổ (và khi sửa phiếu bán đã ghi sổ làm tăng tiền); thiếu hàng chặn trước;
// cảnh báo hạn mức và bán lỗ trả cùng lúc để xác nhận một lần; hai cờ xác nhận độc lập; có audit người xác nhận.
func TestMR_C8_HanMucCongNo(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	var k struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": "K", "name": "Khách hạn mức", "is_customer": true, "opening_receivable": 600}, &k)
	sup := e.Partner("NCC", "NCC", false, true)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	e.Admin.Posted(DocBody("purchase", "2026-01-01", sup, e.WH["KHO1"], Line(p, "20", "80")))
	pb := func(limit any) map[string]any {
		return map[string]any{"code": "K", "name": "Khách hạn mức", "is_customer": true, "opening_receivable": 600, "credit_limit": limit, "payment_days": 30}
	}
	// Tắt: không có trường, không cảnh báo.
	r := e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", k.ID), pb(1000), nil)
	if strings.Contains(string(r.Body), "credit_limit") {
		t.Fatalf("tắt ⇒ không có credit_limit: %s", r.Body)
	}
	e.Admin.Posted(DocBody("sale", "2026-02-01", k.ID, e.WH["KHO1"], Line(p, "1", "100")))
	mrEnable(e, "credit_limit")
	r = e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", k.ID), pb(1000), nil)
	if !strings.Contains(string(r.Body), `"credit_limit":1000`) || !strings.Contains(string(r.Body), `"payment_days":30`) {
		t.Fatalf("bật ⇒ có hạn mức: %s", r.Body)
	}
	// Nợ hiện tại 700. Phiếu 400 ⇒ 1100 > 1000.
	d1 := e.Admin.CreateDoc(DocBody("sale", "2026-02-02", k.ID, e.WH["KHO1"], Line(p, "4", "100")))
	r = e.Admin.Expect(409, "CREDIT_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", d1.ID), map[string]any{"version": d1.Version})
	var cw struct {
		Error struct {
			Message string `json:"message"`
			Details struct {
				Credit    docs.CreditInfo `json:"credit"`
				LossLines []docs.Warning  `json:"loss_lines"`
				Confirm   []string        `json:"confirm"`
			} `json:"details"`
		} `json:"error"`
	}
	r.JSON(t, &cw)
	c := cw.Error.Details.Credit
	if !c.Receivable.Equal(d("700")) || !c.DocumentAmount.Equal(d("400")) || !c.TotalAfter.Equal(d("1100")) || !c.CreditLimit.Equal(d("1000")) || !c.Over.Equal(d("100")) ||
		len(cw.Error.Details.LossLines) != 0 || strings.Join(cw.Error.Details.Confirm, ",") != "confirm_credit" || !strings.Contains(cw.Error.Message, "vượt") {
		t.Fatalf("chi tiết cảnh báo hạn mức: %s", r.Body)
	}
	e.Admin.Expect(409, "CREDIT_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", d1.ID), map[string]any{"version": d1.Version, "confirm_loss": true})
	var posted docs.Document
	kt := e.NewUser("kt", "Kế toán Lan")
	kt.OK("POST", fmt.Sprintf("/api/documents/%d/post", d1.ID), map[string]any{"version": d1.Version, "confirm_credit": true}, &posted)
	var who string
	if err := e.Pool.QueryRow(context.Background(), `SELECT u.full_name FROM audit_log a JOIN users u ON u.id=a.user_id WHERE a.entity='document' AND a.entity_id=$1 AND a.action='credit_confirmed'`, d1.ID).Scan(&who); err != nil || who != "Kế toán Lan" {
		t.Fatalf("audit người xác nhận: %q %v", who, err)
	}
	// Bán lỗ + vượt hạn mức ⇒ một lần cảnh báo gộp; xác nhận từng phần ⇒ còn cảnh báo kia.
	d2 := e.Admin.CreateDoc(DocBody("sale", "2026-02-03", k.ID, e.WH["KHO1"], Line(p, "2", "60")))
	r = e.Admin.Expect(409, "CREDIT_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", d2.ID), map[string]any{"version": d2.Version})
	r.JSON(t, &cw)
	if len(cw.Error.Details.LossLines) != 1 || strings.Join(cw.Error.Details.Confirm, ",") != "confirm_credit,confirm_loss" || !strings.Contains(cw.Error.Message, "bán lỗ") {
		t.Fatalf("cảnh báo gộp: %s", r.Body)
	}
	e.Admin.Expect(409, "LOSS_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", d2.ID), map[string]any{"version": d2.Version, "confirm_credit": true})
	e.Admin.Expect(409, "CREDIT_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", d2.ID), map[string]any{"version": d2.Version, "confirm_loss": true})
	e.Admin.OK("POST", fmt.Sprintf("/api/documents/%d/post", d2.ID), map[string]any{"version": d2.Version, "confirm_loss": true, "confirm_credit": true}, nil)
	// Thiếu hàng chặn trước mọi cảnh báo.
	d3 := e.Admin.CreateDoc(DocBody("sale", "2026-02-04", k.ID, e.WH["KHO1"], Line(p, "999", "1")))
	e.Admin.Expect(422, "INSUFFICIENT_STOCK", "POST", fmt.Sprintf("/api/documents/%d/post", d3.ID), map[string]any{"version": d3.Version})
	// Sửa phiếu đã ghi sổ: tăng tiền ⇒ cảnh báo; giảm tiền ⇒ không.
	cur := e.Admin.GetDoc(d1.ID)
	up := func(qty string, ver int) map[string]any {
		return map[string]any{"version": ver, "doc_date": "2026-02-02", "partner_id": k.ID, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(p, qty, "100")}}
	}
	e.Admin.Expect(409, "CREDIT_WARNING", "PUT", fmt.Sprintf("/api/documents/%d", d1.ID), up("5", cur.Version))
	var u docs.Document
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", d1.ID), up("3", cur.Version), &u)
	b := up("5", u.Version)
	b["confirm_credit"] = true
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", d1.ID), b, nil)
	// Không có hạn mức ⇒ không kiểm.
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", k.ID), pb(nil), nil)
	d4 := e.Admin.CreateDoc(DocBody("sale", "2026-02-05", k.ID, e.WH["KHO1"], Line(p, "1", "100")))
	e.Admin.PostDoc(d4)
	// Người không có quyền xem công nợ không thấy số nợ trong cảnh báo.
	mrEnable(e, "permissions")
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", k.ID), pb(100), nil)
	e.Admin.OK("PUT", "/api/role-permissions", map[string]any{"matrix": map[string][]string{"thukho": {"stock.write", "sale.write"}}}, nil)
	tk := mrUser(e, "tk", "thukho")
	d5 := tk.CreateDoc(DocBody("sale", "2026-02-06", k.ID, e.WH["KHO1"], Line(p, "1", "100")))
	r = tk.Expect(409, "CREDIT_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", d5.ID), map[string]any{"version": d5.Version})
	if !strings.Contains(string(r.Body), `"receivable":null`) || !strings.Contains(string(r.Body), `"total_after":null`) || !strings.Contains(string(r.Body), `"credit_limit":null`) {
		t.Fatalf("che số nợ với người không có debt.view: %s", r.Body)
	}
}

type agingResp struct {
	AsOf   string             `json:"as_of"`
	Items  []reports.AgingRow `json:"items"`
	Totals reports.AgingRow   `json:"totals"`
}

// C8 — tuổi nợ: FIFO (giảm nợ trừ khoản cũ nhất, nợ đầu kỳ cũ nhất), hạn = ngày + payment_days, cột trả trước; tổng khớp sổ.
func TestMR_C8_TuoiNoFIFO(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	var k struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": "K", "name": "Khách", "is_customer": true, "opening_receivable": 100}, &k)
	k2 := e.Partner("K2", "Khách trả trước", true, false)
	e.Admin.Expect(404, "FEATURE_OFF", "GET", "/api/reports/debt-aging", nil)
	mrEnable(e, "credit_limit", "permissions")
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", k.ID), map[string]any{"code": "K", "name": "Khách", "is_customer": true, "opening_receivable": 100, "payment_days": 10}, nil)
	svc := func(amount int) map[string]any {
		return map[string]any{"product_id": e.DV, "description": "Dịch vụ", "unit_price": amount}
	}
	s1 := e.Admin.Posted(DocBody("sale", "2026-01-01", k.ID, e.WH["KHO1"], svc(1000)))
	s2 := e.Admin.Posted(DocBody("sale", "2026-03-01", k.ID, e.WH["KHO1"], svc(2000)))
	s3 := e.Admin.Posted(DocBody("sale", "2026-04-20", k.ID, e.WH["KHO1"], svc(500)))
	e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "voucher_date": "2026-03-15", "account_id": e.TM, "partner_id": k.ID, "lines": []any{map[string]any{"amount": 600}}})
	// K2 trả trước 300, rồi mua 100.
	e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "voucher_date": "2026-04-01", "account_id": e.TM, "partner_id": k2, "lines": []any{map[string]any{"amount": 300}}})
	e.Admin.Posted(DocBody("sale", "2026-04-02", k2, e.WH["KHO1"], svc(100)))
	var a agingResp
	e.Admin.OK("GET", "/api/reports/debt-aging?as_of=2026-04-30", nil, &a)
	byCode := map[string]reports.AgingRow{}
	for _, x := range a.Items {
		byCode[x.PartnerCode] = x
	}
	kr := byCode["K"]
	// Thu 600 trừ: nợ đầu kỳ 100, rồi 500 của s1 (còn 500). Đến 30/04: s1 hạn 11/01 (quá 109 ngày) 500; s2 hạn 11/03 (quá 50) 2000;
	// s3 hạn 30/04 (trong hạn) 500.
	eqDec(t, kr.Over90, "500", ">90")
	eqDec(t, kr.D31to60, "2000", "31–60")
	eqDec(t, kr.InTerm, "500", "trong hạn")
	eqDec(t, kr.Opening, "0", "nợ đầu kỳ đã trả")
	eqDec(t, kr.Total, "3000", "tổng")
	if len(kr.Items) != 3 || *kr.Items[0].DocumentID != s1.ID || *kr.Items[1].DocumentID != s2.ID || *kr.Items[2].DocumentID != s3.ID || kr.Items[0].DaysOverdue != 109 || kr.Items[0].DueDate.String() != "2026-01-11" {
		t.Fatalf("khoản mở: %+v", kr.Items)
	}
	k2r := byCode["K2"]
	eqDec(t, k2r.Prepaid, "-200", "trả trước")
	eqDec(t, k2r.Total, "-200", "tổng âm = khách trả thừa")
	for _, x := range a.Items {
		if !x.Total.Equal(e.debtAt(x.PartnerID, "2026-04-30")) {
			t.Fatalf("tổng tuổi nợ %s ≠ sổ công nợ", x.PartnerCode)
		}
	}
	eqDec(t, a.Totals.Total, "2800", "tổng cộng")
	rows := xlsxRows(t, e.Admin.OK("GET", "/api/reports/debt-aging?as_of=2026-04-30&format=xlsx", nil, nil).Body)
	if r := findRow(rows, 1, "K"); r == nil || r[11] != "3000" {
		t.Fatalf("xlsx tuổi nợ: %q", r)
	}
	tk := mrUser(e, "tk", "thukho")
	tk.Expect(403, "FORBIDDEN", "GET", "/api/reports/debt-aging", nil)
}

func (e *Env) debtAt(partner int64, date string) decimal.Decimal {
	e.t.Helper()
	var l struct {
		Closing decimal.Decimal `json:"closing"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/debt-ledger?side=receivable&partner_id=%d&to=%s", partner, date), nil, &l)
	return l.Closing
}
