package tests

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/shopspring/decimal"

	"kho/internal/docs"
)

// Đợt M3: C10 quy đổi đơn vị, C11 thuế GTGT, tương tác với C6 / C8 / R4 / C7.

// UL tạo dòng có đơn vị (và tùy chọn đơn giá / thuế suất).
func UL(productID int64, unit, qty string, price any, extra ...any) map[string]any {
	l := Line(productID, qty, price)
	if unit != "" {
		l["unit"] = unit
	}
	for i := 0; i+1 < len(extra); i += 2 {
		l[extra[i].(string)] = extra[i+1]
	}
	return l
}

func (e *Env) setUnits(product int64, units ...any) {
	e.t.Helper()
	var items []any
	for i := 0; i+1 < len(units); i += 2 {
		items = append(items, map[string]any{"unit": units[i], "factor": units[i+1]})
	}
	e.Admin.OK("PUT", fmt.Sprintf("/api/products/%d/units", product), map[string]any{"items": items}, nil)
}

func lineOf(d *docs.Document, i int) docs.Line { return d.Lines[i] }

// patchProduct đọc mặt hàng, đổi vài trường rồi lưu lại.
func (e *Env) patchProduct(id int64, change map[string]any) {
	e.t.Helper()
	var m map[string]any
	e.Admin.OK("GET", fmt.Sprintf("/api/products/%d", id), nil, &m)
	delete(m, "units")
	for k, v := range change {
		m[k] = v
	}
	e.Admin.OK("PUT", fmt.Sprintf("/api/products/%d", id), m, nil)
}

// C10 — quy đổi đơn vị: SL / đơn giá theo đơn vị đã chọn, sổ kho theo đơn vị gốc; tồn, thiếu hàng, giá mặc định, cảnh báo
// lỗ (so theo đơn vị gốc), giá bán gần nhất / giá riêng (quy đổi), hàng cần đặt, lãi gộp; đơn vị đang dùng không xóa /
// đổi hệ số được; máy khách cũ lưu lại phiếu không mất đơn vị; tắt tính năng ⇒ như bản chuẩn.
func TestMR_C10_QuyDoiDonVi(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	k := e.Partner("K", "Khách", true, false)
	a := e.Product("A", "Nước ngọt", "Lon", 10000, 6000, 0)
	e.Admin.Expect(404, "FEATURE_OFF", "GET", fmt.Sprintf("/api/products/%d/units", a), nil)
	// Tắt: đơn vị là chữ tự do, hệ số 1, JSON không có trường mới (như bản chuẩn).
	off := e.Admin.CreateDoc(DocBody("sale", "2026-01-02", k, e.WH["KHO1"], UL(a, "Thùng", "1", 10000)))
	if lineOf(off, 0).LineUnit != nil || lineOf(off, 0).Unit != "Thùng" {
		t.Fatalf("tắt ⇒ như bản chuẩn: %+v", off.Lines[0])
	}
	raw := e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d", off.ID), nil, nil).Body
	for _, key := range []string{"factor", "base_qty", "vat_rate", "tax_amount", "goods_amount", "book_qty"} {
		if strings.Contains(string(raw), `"`+key+`"`) {
			t.Fatalf("tắt ⇒ không có %s: %s", key, raw)
		}
	}
	e.Admin.OK("DELETE", fmt.Sprintf("/api/documents/%d", off.ID), nil, nil)

	mrEnable(e, "unit_conversion", "price_list", "min_stock", "profit_report", "stocktake")
	e.setUnits(a, "Thùng", 24, "Lốc", 6)
	var pu struct {
		BaseUnit string `json:"base_unit"`
		Items    []struct {
			Unit   string          `json:"unit"`
			Factor decimal.Decimal `json:"factor"`
			InUse  bool            `json:"in_use"`
		} `json:"items"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products/%d/units", a), nil, &pu)
	if pu.BaseUnit != "Lon" || len(pu.Items) != 2 || pu.Items[0].Unit != "Lốc" || pu.Items[1].InUse {
		t.Fatalf("đơn vị: %+v", pu)
	}
	if !strings.Contains(string(e.Admin.OK("GET", fmt.Sprintf("/api/products/%d", a), nil, nil).Body), `"units":[`) {
		t.Fatal("GET mặt hàng kèm units")
	}
	bad := func(items ...any) {
		t.Helper()
		e.Admin.Expect(400, "VALIDATION", "PUT", fmt.Sprintf("/api/products/%d/units", a), map[string]any{"items": items})
	}
	bad(map[string]any{"unit": "lon", "factor": 2})                                             // trùng đơn vị gốc
	bad(map[string]any{"unit": "Hộp", "factor": 0})                                             // hệ số 0
	bad(map[string]any{"unit": "Hộp", "factor": "0.0000001"})                                   // quá 6 chữ số
	bad(map[string]any{"unit": "Hộp", "factor": 2}, map[string]any{"unit": "hộp", "factor": 3}) // lặp

	// Tồn đầu 2 Thùng: đơn giá mặc định = 6.000 × 24; sổ kho 48 Lon, giá theo đơn vị gốc 6.000.
	op := e.Opening("2026-01-01", e.WH["KHO1"], UL(a, "thùng", "2", nil))
	l0 := lineOf(op, 0)
	if l0.Unit != "Thùng" || !l0.Factor.Equal(d("24")) || !l0.BaseQty.Equal(d("48")) || !l0.UnitPrice.Equal(d("144000")) || !l0.Amount.Equal(d("288000")) {
		t.Fatalf("tồn đầu theo Thùng: %+v %+v", l0, l0.LineUnit)
	}
	tot, _ := e.TotalStock(a)
	eqDec(t, tot, "48", "tồn theo đơn vị gốc")
	var led struct {
		Rows []struct {
			Unit      string          `json:"unit"`
			QtyIn     decimal.Decimal `json:"qty_in"`
			UnitPrice decimal.Decimal `json:"unit_price"`
		} `json:"rows"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d", a), nil, &led)
	if led.Rows[0].Unit != "Lon" || !led.Rows[0].QtyIn.Equal(d("48")) || !led.Rows[0].UnitPrice.Equal(d("6000")) {
		t.Fatalf("thẻ kho theo đơn vị gốc: %+v", led.Rows)
	}

	// Bán 1 Thùng không đơn giá ⇒ 10.000 × 24; thiếu hàng báo theo đơn vị gốc.
	s1 := e.Admin.Posted(DocBody("sale", "2026-01-05", k, e.WH["KHO1"], UL(a, "Thùng", "1", 250000)))
	eqDec(t, *lineOf(s1, 0).UnitPrice, "250000", "đơn giá theo Thùng nhập tay")
	r := e.Admin.Do("POST", "/api/documents/check", DocBody("sale", "2026-01-06", k, e.WH["KHO1"], UL(a, "Thùng", "2", nil)))
	if !strings.Contains(string(r.Body), "tồn 24, cần 48, thiếu 24") {
		t.Fatalf("thiếu hàng theo đơn vị gốc: %s", r.Body)
	}
	// Giá bán gần nhất cho khách quy đổi: cùng đơn vị ⇒ đúng đơn giá đó; đơn vị khác ⇒ theo đơn vị gốc × hệ số.
	nd := e.Admin.CreateDoc(DocBody("sale", "2026-01-07", k, e.WH["KHO1"], UL(a, "Thùng", "1", nil), UL(a, "Lốc", "1", nil), UL(a, "", "1", nil)))
	for i, want := range []string{"250000", "62500", "10416.67"} {
		eqDec(t, *lineOf(nd, i).UnitPrice, want, fmt.Sprintf("giá gần nhất dòng %d", i+1))
	}
	var sp struct {
		Items []struct {
			Price  decimal.Decimal `json:"price"`
			Source string          `json:"source"`
		} `json:"items"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products/sale-price?partner_id=%d&ids=%d&date=2026-01-07", k, a), nil, &sp)
	if sp.Items[0].Source != "last_sale" || !sp.Items[0].Price.Equal(d("10416.67")) {
		t.Fatalf("sale-price theo đơn vị gốc: %+v", sp)
	}
	// Giá riêng của khách là theo đơn vị gốc.
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d/prices", k), map[string]any{"items": []any{map[string]any{"product_id": a, "price": 9000}}}, nil)
	nd2 := e.Admin.CreateDoc(DocBody("sale", "2026-01-07", k, e.WH["KHO1"], UL(a, "Thùng", "1", nil)))
	eqDec(t, *lineOf(nd2, 0).UnitPrice, "216000", "giá riêng × hệ số")
	// Cảnh báo lỗ so theo đơn vị gốc: 1 Lốc @30.000 ⇒ 5.000/Lon < 6.000; giá vốn hiển thị theo Lốc = 36.000.
	ld := e.Admin.CreateDoc(DocBody("sale", "2026-01-07", k, e.WH["KHO1"], UL(a, "Lốc", "1", 30000), UL(a, "Lốc", "1", 37000)))
	if len(ld.Warnings) != 1 || ld.Warnings[0].LineNo != 1 || !ld.Warnings[0].CostPrice.Equal(d("36000")) {
		t.Fatalf("cảnh báo lỗ theo đơn vị gốc: %+v", ld.Warnings)
	}
	// Hàng cần đặt (SL trên phiếu tạm theo đơn vị gốc).
	var dem struct {
		Items []struct {
			QtyInDrafts decimal.Decimal `json:"qty_in_drafts"`
			ProductID   int64           `json:"product_id"`
		} `json:"items"`
	}
	e.Admin.OK("GET", "/api/reports/draft-demand", nil, &dem)
	if len(dem.Items) != 1 {
		t.Fatalf("hàng cần đặt: %+v", dem.Items)
	}
	eqDec(t, dem.Items[0].QtyInDrafts, "67", "24 + 6 + 1 + 24 + 6 + 6 (Lon)")
	for _, x := range []*docs.Document{nd, nd2, ld} {
		e.Admin.OK("DELETE", fmt.Sprintf("/api/documents/%d", x.ID), nil, nil)
	}

	// Đơn vị đang dùng: không xóa / đổi hệ số được; thêm đơn vị mới được.
	e.Admin.Expect(409, "IN_USE", "PUT", fmt.Sprintf("/api/products/%d/units", a), map[string]any{"items": []any{map[string]any{"unit": "Lốc", "factor": 6}}})
	e.Admin.Expect(409, "IN_USE", "PUT", fmt.Sprintf("/api/products/%d/units", a), map[string]any{"items": []any{
		map[string]any{"unit": "Thùng", "factor": 12}, map[string]any{"unit": "Lốc", "factor": 6}}})
	e.setUnits(a, "Thùng", 24, "Lốc", 6, "Két", "20.5")
	// Đổi đơn vị gốc khi đã có dòng quy đổi ⇒ 400.
	e.Admin.Expect(400, "VALIDATION", "PUT", fmt.Sprintf("/api/products/%d", a), map[string]any{"code": "A", "name": "Nước ngọt", "unit": "Chai", "sale_price": 10000, "purchase_price": 6000})
	// Đơn vị chưa khai báo ⇒ 400.
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("sale", "2026-01-07", k, e.WH["KHO1"], UL(a, "Bao", "1", 1)))

	// Máy khách cũ: lưu lại phiếu đã ghi sổ không gửi unit / vat_rate ⇒ giữ đơn vị + hệ số của dòng có id.
	cur := e.Admin.GetDoc(s1.ID)
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", s1.ID), map[string]any{"version": cur.Version, "doc_date": "2026-01-05", "partner_id": k,
		"warehouse_id": e.WH["KHO1"], "lines": []any{map[string]any{"id": cur.Lines[0].ID, "product_id": a, "qty": 1, "unit_price": 250000}}}, nil)
	if x := e.Admin.GetDoc(s1.ID); x.Lines[0].Unit != "Thùng" || !x.Lines[0].BaseQty.Equal(d("24")) || x.Lines[0].ID != cur.Lines[0].ID {
		t.Fatalf("máy khách cũ làm mất đơn vị: %+v %+v", x.Lines[0], x.Lines[0].LineUnit)
	}
	tot, _ = e.TotalStock(a)
	eqDec(t, tot, "24", "48 − 24")

	// Chuyển kho và kiểm kê theo đơn vị quy đổi.
	e.Admin.Posted(map[string]any{"doc_type": "transfer", "doc_date": "2026-01-08", "warehouse_id": e.WH["KHO1"], "to_warehouse_id": e.WH["KHO2"],
		"lines": []any{UL(a, "Lốc", "2", nil)}})
	_, by := e.TotalStock(a)
	if !by["KHO1"].Equal(d("12")) || !by["KHO2"].Equal(d("12")) {
		t.Fatalf("chuyển 2 Lốc = 12 Lon: %+v", by)
	}
	st := e.Admin.Posted(DocBody("stocktake", "2026-01-09", 0, e.WH["KHO2"], UL(a, "Lốc", "1", nil)))
	if c := lineOf(st, 0).LineCount; c == nil || !c.BookQty.Equal(d("12")) || !c.CountedQty.Equal(d("6")) || !c.DiffQty.Equal(d("-6")) {
		t.Fatalf("kiểm kê theo Lốc: %+v", st.Lines[0])
	}
	_, by = e.TotalStock(a)
	eqDec(t, by["KHO2"], "6", "kiểm kê thiếu 6 Lon")

	// Lãi gộp theo đơn vị gốc: bán 1 Thùng = 24 Lon × giá vốn 6.000.
	var pr profitResp
	e.Admin.OK("GET", "/api/reports/profit?from=2026-01-01&to=2026-01-31&group_by=product", nil, &pr)
	if len(pr.Items) != 1 || !pr.Items[0].Cost.Equal(d("144000")) || !pr.Items[0].Qty.Equal(d("24")) {
		t.Fatalf("lãi gộp theo đơn vị gốc: %+v", pr.Items)
	}
	// Báo cáo bán: SL dòng theo Thùng, kèm base_qty; tổng SL theo đơn vị gốc.
	var sr struct {
		TotalQty decimal.Decimal `json:"total_qty"`
		Rows     []struct {
			Unit    string           `json:"unit"`
			Qty     decimal.Decimal  `json:"qty"`
			BaseQty *decimal.Decimal `json:"base_qty"`
		} `json:"rows"`
	}
	e.Admin.OK("GET", "/api/reports/sales?from=2026-01-01&to=2026-01-31", nil, &sr)
	if len(sr.Rows) != 1 || sr.Rows[0].Unit != "Thùng" || !sr.Rows[0].Qty.Equal(d("1")) || sr.Rows[0].BaseQty == nil || !sr.TotalQty.Equal(d("24")) {
		t.Fatalf("báo cáo bán: %+v", sr)
	}
	// File xuất ghi đơn vị đã chọn.
	rows := xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", s1.ID), nil, nil).Body)
	if row := findRow(rows, 1, "A"); row == nil || row[3] != "Thùng" || row[4] != "1" {
		t.Fatalf("xuất phiếu theo Thùng: %q", row)
	}

	// Nhập Excel đơn vị quy đổi.
	mrEnable(e, "import_excel")
	res := e.Admin.importOK(t, "/api/import/product_units?dry_run=1", xlsxFile(t, [][]string{{"Mã hàng", "Đơn vị", "Hệ số"},
		{"A", "Bao", "#50"}, {"A", "Thùng", "#12"}, {"A", "Lon", "#2"}, {"A", "Két", "#20.25"}, {"KHONG", "X", "#1"}}))
	if len(res.Errors) != 3 || res.Creates != 1 || res.Updates != 1 {
		t.Fatalf("nhập đơn vị: %+v", res)
	}
	e.Admin.importOK(t, "/api/import/product_units", xlsxFile(t, [][]string{{"Mã hàng", "Đơn vị", "Hệ số"}, {"A", "Bao", "#50"}}))
	e.Admin.OK("GET", fmt.Sprintf("/api/products/%d/units", a), nil, &pu)
	if len(pu.Items) != 4 {
		t.Fatalf("sau nhập: %+v", pu.Items)
	}

	// Tắt tính năng: dữ liệu quy đổi cũ vẫn đúng (phiếu hiện hệ số, tồn không đổi); dòng mới chữ tự do hệ số 1.
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"unit_conversion": false}}, nil)
	if x := e.Admin.GetDoc(s1.ID); x.Lines[0].LineUnit == nil || !x.Lines[0].Factor.Equal(d("24")) {
		t.Fatalf("tắt ⇒ phiếu cũ vẫn hiện hệ số: %+v", x.Lines[0])
	}
	cur = e.Admin.GetDoc(s1.ID)
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", s1.ID), map[string]any{"version": cur.Version, "doc_date": "2026-01-05", "partner_id": k,
		"warehouse_id": e.WH["KHO1"], "confirm_loss": true, "lines": []any{map[string]any{"id": cur.Lines[0].ID, "product_id": a, "unit": "Thùng", "qty": 1, "unit_price": 250000},
			UL(a, "Thùng", "1", 1)}}, nil)
	x := e.Admin.GetDoc(s1.ID)
	if !x.Lines[0].BaseQty.Equal(d("24")) || !x.Lines[1].BaseQty.Equal(d("1")) {
		t.Fatalf("tắt: dòng cũ giữ hệ số, dòng mới hệ số 1: %+v / %+v", x.Lines[0].LineUnit, x.Lines[1].LineUnit)
	}
	tot, _ = e.TotalStock(a)
	eqDec(t, tot, "17", "KHO1: 48 − 25 − 12 = 11; KHO2: 12 − 6 (kiểm kê thiếu) = 6")
}

// C11 — thuế GTGT: thuế suất mặc định (mặt hàng → mặc định chung), tiền thuế từng dòng làm tròn đồng, ba tổng tiền;
// công nợ / Nợ cũ – Tổng nợ / hạn mức dùng tổng thanh toán; cảnh báo lỗ và lãi gộp dùng giá trước thuế; báo cáo bán có
// cột thuế + bảng kê theo thuế suất; tắt tính năng ⇒ phiếu đã có thuế giữ nguyên, không đặt được thuế suất mới.
func TestMR_C11_ThueGTGT(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	k := e.Partner("K", "Khách", true, false)
	sup := e.Partner("NCC", "NCC", false, true)
	v := e.Product("V", "Hàng thuế 10", "Cái", 40000, 30000, 0)
	w := e.Product("W", "Hàng thuế mặc định", "Cái", 15000, 9000, 0)
	kc := e.Product("KC", "Hàng KCT", "Cái", 5000, 1000, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(v, "100", "30000"), Line(w, "100", "9000"), Line(kc, "100", "1000"))
	// Phiếu trước khi bật thuế: tổng giữ nguyên.
	old := e.Admin.Posted(DocBody("sale", "2026-01-02", k, e.WH["KHO1"], Line(v, "1", "40000")))
	e.Admin.Expect(404, "FEATURE_OFF", "GET", "/api/settings/vat", nil)
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("sale", "2026-01-03", k, e.WH["KHO1"], UL(v, "", "1", 1, "vat_rate", 10)))

	mrEnable(e, "vat", "permissions", "credit_limit", "profit_report")
	e.Admin.Expect(400, "VALIDATION", "PUT", "/api/settings/vat", map[string]any{"default_vat_rate": "7"})
	e.Admin.OK("PUT", "/api/settings/vat", map[string]any{"default_vat_rate": "8"}, nil)
	e.patchProduct(v, map[string]any{"vat_rate": 10})
	e.patchProduct(kc, map[string]any{"vat_rate": "KCT"})
	var pv struct {
		VatRate *string `json:"vat_rate"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products/%d", v), nil, &pv)
	if pv.VatRate == nil || *pv.VatRate != "10" {
		t.Fatalf("thuế suất mặt hàng: %+v", pv)
	}
	if o := e.Admin.GetDoc(old.ID); o.DocVAT == nil || !o.TotalAmount.Equal(d("40000")) || !o.TaxAmount.IsZero() || o.Lines[0].VatRate != nil {
		t.Fatalf("phiếu cũ giữ nguyên tổng, không thuế: %+v", o)
	}
	// 3 × 33.333 = 99.999 ⇒ thuế 10% = 9.999,9 → 10.000; 12.345 × 8% = 987,6 → 988; KCT 5.000; DV −10.000 thuế 10% = −1.000.
	s := e.Admin.Posted(DocBody("sale", "2026-01-10", k, e.WH["KHO1"], Line(v, "3", "33333"), Line(w, "1", "12345"), Line(kc, "1", "5000"),
		map[string]any{"product_id": e.DV, "description": "Chiết khấu", "unit_price": -10000, "vat_rate": 10}))
	want := []struct {
		rate any
		tax  string
	}{{"10", "10000"}, {"8", "988"}, {nil, "0"}, {"10", "-1000"}}
	for i, x := range want {
		l := s.Lines[i]
		if (x.rate == nil) != (l.VatRate == nil) || (l.VatRate != nil && !l.VatRate.Equal(d(x.rate.(string)))) || !l.TaxAmount.Equal(d(x.tax)) {
			t.Fatalf("dòng %d: %+v %+v", i+1, l, l.LineVAT)
		}
	}
	if !s.GoodsAmount.Equal(d("107344")) || !s.TaxAmount.Equal(d("9988")) || !s.TotalAmount.Equal(d("117332")) || !strings.Contains(s.AmountInWords, "trăm mười bảy nghìn") {
		t.Fatalf("tổng phiếu: %+v %+v", s.TotalAmount, s.DocVAT)
	}
	eqDec(t, *s.TotalDebt, "157332", "Tổng nợ = Nợ cũ 40.000 + tổng thanh toán")
	eqDec(t, e.Debt("receivable", k), "157332", "công nợ theo tổng thanh toán")

	// Báo cáo bán: tiền trước thuế, thuế, sau thuế, bảng kê theo thuế suất; lãi gộp = trước thuế.
	var sr struct {
		TotalAmount  decimal.Decimal `json:"total_amount"`
		TotalTax     decimal.Decimal `json:"total_tax"`
		TotalWithTax decimal.Decimal `json:"total_with_tax"`
		VatSummary   []struct {
			Label       string          `json:"label"`
			GoodsAmount decimal.Decimal `json:"goods_amount"`
			TaxAmount   decimal.Decimal `json:"tax_amount"`
		} `json:"vat_summary"`
	}
	e.Admin.OK("GET", "/api/reports/sales?from=2026-01-10&to=2026-01-10", nil, &sr)
	if !sr.TotalAmount.Equal(d("107344")) || !sr.TotalTax.Equal(d("9988")) || !sr.TotalWithTax.Equal(d("117332")) || len(sr.VatSummary) != 3 ||
		sr.VatSummary[0].Label != "Không thuế / KCT" || !sr.VatSummary[2].TaxAmount.Equal(d("9000")) || !sr.VatSummary[1].GoodsAmount.Equal(d("12345")) {
		t.Fatalf("báo cáo bán có thuế: %+v", sr)
	}
	var pr profitResp
	e.Admin.OK("GET", "/api/reports/profit?from=2026-01-10&to=2026-01-10", nil, &pr)
	eqDec(t, pr.Totals.Revenue, "107344", "lãi gộp: doanh thu trước thuế = báo cáo bán")
	eqDec(t, pr.Totals.Cost, "100000", "3 × 30.000 + 9.000 + 1.000 + DV 0")
	var dash struct {
		RevenueMonth decimal.Decimal `json:"revenue_month"`
	}
	e.Admin.OK("GET", "/api/dashboard", nil, &dash)
	_ = dash

	// Phiếu mua có thuế + bảng kê; người không có cost.view: thuế của phiếu mua bị che, phần mua vào null.
	pu := e.Admin.Posted(DocBody("purchase", "2026-01-11", sup, e.WH["KHO1"], UL(v, "", "2", 30000, "vat_rate", 5)))
	eqDec(t, pu.TotalAmount, "63000", "60.000 + 5%")
	eqDec(t, e.Debt("payable", sup), "63000", "phải trả theo tổng thanh toán")
	var vs struct {
		Sales struct {
			Totals struct {
				TaxAmount decimal.Decimal `json:"tax_amount"`
			} `json:"totals"`
		} `json:"sales"`
		Purchases *struct {
			Totals struct {
				TaxAmount decimal.Decimal `json:"tax_amount"`
			} `json:"totals"`
		} `json:"purchases"`
	}
	e.Admin.OK("GET", "/api/reports/vat-summary?from=2026-01-01&to=2026-01-31", nil, &vs)
	if !vs.Sales.Totals.TaxAmount.Equal(d("9988")) || vs.Purchases == nil || !vs.Purchases.Totals.TaxAmount.Equal(d("3000")) {
		t.Fatalf("bảng kê thuế: %+v", vs)
	}
	bh := mrUser(e, "bh", "banhang")
	bh.OK("GET", "/api/reports/vat-summary?from=2026-01-01&to=2026-01-31", nil, &vs)
	if vs.Purchases != nil {
		t.Fatal("bán hàng không thấy phần mua vào")
	}
	rb := bh.OK("GET", fmt.Sprintf("/api/documents/%d", pu.ID), nil, nil).Body
	for _, secret := range []string{"63000", "60000", "sáu mươi ba"} {
		if strings.Contains(string(rb), secret) {
			t.Fatalf("lộ giá mua qua thuế: %s", rb)
		}
	}
	xs := xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", s.ID), nil, nil).Body)
	if all := fmt.Sprint(xs); !strings.Contains(all, "Tổng thanh toán:") || !strings.Contains(all, "Tiền thuế GTGT:") || !strings.Contains(all, "Bằng chữ:") {
		t.Fatalf("xuất phiếu có ba tổng: %v", xs)
	}

	// Cảnh báo lỗ dùng giá trước thuế: 29.000 + 10% = 31.900 > 30.000 nhưng 29.000 < 30.000 ⇒ vẫn lỗ.
	ld := e.Admin.CreateDoc(DocBody("sale", "2026-01-12", k, e.WH["KHO1"], Line(v, "1", "29000")))
	if len(ld.Warnings) != 1 {
		t.Fatalf("lỗ theo giá trước thuế: %+v", ld.Warnings)
	}
	e.Admin.OK("DELETE", fmt.Sprintf("/api/documents/%d", ld.ID), nil, nil)

	// Hạn mức theo tổng thanh toán: tiền hàng 100.000 ≤ hạn mức nhưng có thuế 110.000 > (nợ hiện tại 157.332 + …).
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", k), map[string]any{"code": "K", "name": "Khách", "is_customer": true, "credit_limit": 257332}, nil)
	cd := e.Admin.CreateDoc(DocBody("sale", "2026-01-12", k, e.WH["KHO1"], Line(v, "2", "50000")))
	r := e.Admin.Expect(409, "CREDIT_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", cd.ID), map[string]any{"version": cd.Version})
	if !strings.Contains(string(r.Body), `"document_amount":110000`) {
		t.Fatalf("hạn mức dùng tổng thanh toán: %s", r.Body)
	}
	e.Admin.OK("DELETE", fmt.Sprintf("/api/documents/%d", cd.ID), nil, nil)

	// Tắt thuế: công nợ không đổi; phiếu có thuế vẫn hiện thuế; sửa (máy khách cũ) giữ thuế suất; dòng mới không thuế;
	// gửi thuế suất mới ⇒ 400. Bật lại: công nợ vẫn vậy.
	debtBefore := e.Debt("receivable", k)
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"vat": false}}, nil)
	eqDec(t, e.Debt("receivable", k), debtBefore.String(), "tắt thuế không đổi công nợ")
	cur := e.Admin.GetDoc(s.ID)
	if cur.DocVAT == nil || !cur.TaxAmount.Equal(d("9988")) {
		t.Fatalf("tắt ⇒ phiếu có thuế vẫn hiện thuế: %+v", cur.DocVAT)
	}
	var ls []any
	for _, l := range cur.Lines {
		m := map[string]any{"id": l.ID, "product_id": l.ProductID, "qty": l.Qty, "unit_price": l.UnitPrice, "description": l.Description}
		ls = append(ls, m)
	}
	body := map[string]any{"version": cur.Version, "doc_date": "2026-01-10", "partner_id": k, "warehouse_id": e.WH["KHO1"], "lines": ls, "confirm_loss": true}
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", s.ID), body, nil)
	eqDec(t, e.Admin.GetDoc(s.ID).TotalAmount, "117332", "lưu lại khi tắt giữ thuế")
	cur = e.Admin.GetDoc(s.ID)
	body["version"] = cur.Version
	body["lines"] = append(ls, Line(w, "1", "1000"))
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", s.ID), body, nil)
	eqDec(t, e.Admin.GetDoc(s.ID).TotalAmount, "118332", "dòng mới khi tắt: không thuế")
	cur = e.Admin.GetDoc(s.ID)
	body["version"] = cur.Version
	body["lines"] = append(ls, UL(w, "", "1", 1000, "vat_rate", 8))
	e.Admin.Expect(400, "VALIDATION", "PUT", fmt.Sprintf("/api/documents/%d", s.ID), body)
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"vat": true}}, nil)
	eqDec(t, e.Debt("receivable", k), debtBefore.Add(d("1000")).String(), "bật lại: không tính lại thuế")
	// Phiếu chuyển kho / tồn đầu không có thuế.
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("opening", "2026-01-13", 0, e.WH["KHO1"], UL(v, "", "1", 1, "vat_rate", 10)))
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("sale", "2026-01-13", k, e.WH["KHO1"], UL(v, "", "1", 1, "vat_rate", 7)))
}

// Tương tác trên MỘT phiếu bán: đơn vị quy đổi × thuế GTGT × dòng dịch vụ × giá riêng của khách × vượt hạn mức × bán lỗ.
func TestMR_M3_TuongTacMotPhieuBan(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e)
	var k struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": "K", "name": "Khách", "is_customer": true, "credit_limit": 1000000}, &k)
	a := e.Product("A", "Nước", "Lon", 10000, 6000, 0)
	e.setUnits(a, "Thùng", 24)
	e.patchProduct(a, map[string]any{"vat_rate": "10"})
	e.Opening("2026-01-01", e.WH["KHO1"], UL(a, "Thùng", "10", nil))
	// Giá riêng 5.500/Lon < giá vốn 6.000 ⇒ 1 Thùng tự điền 132.000 (lỗ); Thùng thứ hai giá tay 300.000.
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d/prices", k.ID), map[string]any{"items": []any{map[string]any{"product_id": a, "price": 5500}}}, nil)
	dd := e.Admin.CreateDoc(DocBody("sale", "2026-01-05", k.ID, e.WH["KHO1"], UL(a, "Thùng", "4", nil), UL(a, "Thùng", "1", 300000),
		map[string]any{"product_id": e.DV, "description": "Vận chuyển", "unit_price": 50000}))
	l0, l1, l2 := dd.Lines[0], dd.Lines[1], dd.Lines[2]
	if !l0.UnitPrice.Equal(d("132000")) || !l0.Amount.Equal(d("528000")) || !l0.TaxAmount.Equal(d("52800")) || !l1.TaxAmount.Equal(d("30000")) || l2.VatRate != nil {
		t.Fatalf("dòng: %+v %+v %+v", l0.LineVAT, l1.LineVAT, l2.LineVAT)
	}
	// Tổng: 528.000 + 300.000 + 50.000 = 878.000 tiền hàng; thuế 82.800; tổng 960.800 ≤ 1.000.000? có ⇒ chỉ lỗ.
	// Hạ hạn mức xuống 900.000 ⇒ CREDIT_WARNING gộp cả dòng lỗ, xác nhận một lần.
	if !dd.TotalAmount.Equal(d("960800")) || len(dd.Warnings) != 1 || dd.Warnings[0].LineNo != 1 || !dd.Warnings[0].CostPrice.Equal(d("144000")) {
		t.Fatalf("tổng / lỗ: %s %+v", dd.TotalAmount, dd.Warnings)
	}
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", k.ID), map[string]any{"code": "K", "name": "Khách", "is_customer": true, "credit_limit": 900000}, nil)
	r := e.Admin.Expect(409, "CREDIT_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", dd.ID), map[string]any{"version": dd.Version})
	var er struct {
		Error struct {
			Details struct {
				Credit struct {
					DocumentAmount decimal.Decimal `json:"document_amount"`
				} `json:"credit"`
				LossLines []json.RawMessage `json:"loss_lines"`
				Confirm   []string          `json:"confirm"`
			} `json:"details"`
		} `json:"error"`
	}
	r.JSON(t, &er)
	if !er.Error.Details.Credit.DocumentAmount.Equal(d("960800")) || len(er.Error.Details.LossLines) != 1 || len(er.Error.Details.Confirm) != 2 {
		t.Fatalf("cảnh báo gộp: %s", r.Body)
	}
	e.Admin.Expect(409, "CREDIT_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", dd.ID), map[string]any{"version": dd.Version, "confirm_loss": true})
	e.Admin.Expect(409, "LOSS_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", dd.ID), map[string]any{"version": dd.Version, "confirm_credit": true})
	e.Admin.OK("POST", fmt.Sprintf("/api/documents/%d/post", dd.ID), map[string]any{"version": dd.Version, "confirm_credit": true, "confirm_loss": true}, nil)
	eqDec(t, e.Debt("receivable", k.ID), "960800", "công nợ = tổng thanh toán")
	tot, _ := e.TotalStock(a)
	eqDec(t, tot, "120", "240 − 5 Thùng")
	// Lãi gộp: doanh thu trước thuế 878.000; giá vốn 120 Lon × 6.000 + DV 0.
	var pr profitResp
	e.Admin.OK("GET", "/api/reports/profit?from=2026-01-05&to=2026-01-05", nil, &pr)
	if !pr.Totals.Revenue.Equal(d("878000")) || !pr.Totals.Cost.Equal(d("720000")) {
		t.Fatalf("lãi gộp: %+v", pr.Totals)
	}
	// Giá bán gần nhất cho khách bây giờ: giá riêng vẫn ưu tiên.
	nd := e.Admin.CreateDoc(DocBody("sale", "2026-01-06", k.ID, e.WH["KHO1"], UL(a, "", "1", nil)))
	eqDec(t, *nd.Lines[0].UnitPrice, "5500", "giá riêng theo Lon")
}
