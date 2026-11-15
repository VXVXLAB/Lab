package tests

import (
	"fmt"
	"strings"
	"testing"

	"kho/internal/docs"
)

// Sửa sau QA lần 3 (M-13 … M-16).

// M-13 — trường không thuộc loại phiếu ⇒ 400 (không âm thầm bỏ qua), mọi loại phiếu.
func TestMR_QA_M13_TruongKhongThuocLoaiPhieu(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "stocktake", "vat")
	k := e.Partner("K", "Khách", true, false)
	s := e.Partner("S", "NCC", false, true)
	p := e.Product("P", "Hàng", "Cái", 10, 5, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "10", "5"))
	with := func(b map[string]any, k string, v any) map[string]any { b[k] = v; return b }
	for _, c := range []struct {
		name string
		body map[string]any
	}{
		{"stocktake + to_warehouse_id", with(DocBody("stocktake", "2026-01-05", 0, e.WH["KHO1"], Line(p, "1", nil)), "to_warehouse_id", e.WH["KHO2"])},
		{"stocktake + partner", DocBody("stocktake", "2026-01-05", k, e.WH["KHO1"], Line(p, "1", nil))},
		{"stocktake + unit_price", DocBody("stocktake", "2026-01-05", 0, e.WH["KHO1"], Line(p, "1", "5"))},
		{"stocktake + vat_rate", DocBody("stocktake", "2026-01-05", 0, e.WH["KHO1"], UL(p, "", "1", nil, "vat_rate", 10))},
		{"opening + to_warehouse_id", with(DocBody("opening", "2026-01-05", 0, e.WH["KHO1"], Line(p, "1", "5")), "to_warehouse_id", e.WH["KHO2"])},
		{"opening + partner", DocBody("opening", "2026-01-05", s, e.WH["KHO1"], Line(p, "1", "5"))},
		{"sale + to_warehouse_id", with(DocBody("sale", "2026-01-05", k, e.WH["KHO1"], Line(p, "1", "10")), "to_warehouse_id", e.WH["KHO2"])},
		{"purchase + to_warehouse_id", with(DocBody("purchase", "2026-01-05", s, e.WH["KHO1"], Line(p, "1", "5")), "to_warehouse_id", e.WH["KHO2"])},
		{"transfer + partner", with(DocBody("transfer", "2026-01-05", k, e.WH["KHO1"], Line(p, "1", nil)), "to_warehouse_id", e.WH["KHO2"])},
		{"transfer + vat_rate", with(DocBody("transfer", "2026-01-05", 0, e.WH["KHO1"], UL(p, "", "1", nil, "vat_rate", 10)), "to_warehouse_id", e.WH["KHO2"])},
	} {
		r := e.Admin.Do("POST", "/api/documents", c.body)
		if r.Status != 400 || r.ErrCode() != "VALIDATION" {
			t.Errorf("%s ⇒ %d %s", c.name, r.Status, r.Body)
		}
	}
	// null / 0 vẫn được (máy khách gửi trường rỗng).
	e.Admin.CreateDoc(with(DocBody("sale", "2026-01-05", k, e.WH["KHO1"], Line(p, "1", "10")), "to_warehouse_id", nil))
	e.Admin.CreateDoc(with(DocBody("stocktake", "2026-01-05", 0, e.WH["KHO1"], Line(p, "1", nil)), "to_warehouse_id", 0))
}

// M-14 — hệ số < 1 bị từ chối (đơn vị gốc là đơn vị nhỏ nhất); SL × hệ số lẻ quá 3 số thập phân ⇒ 400 (không làm tròn âm
// thầm) ⇒ bán lẻ từng đơn vị hết đúng một thùng.
func TestMR_QA_M14_HeSoVaSoLe(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "unit_conversion", "import_excel")
	k := e.Partner("K", "Khách", true, false)
	a := e.Product("A", "Nước", "Lon", 10000, 6000, 0)
	b := e.Product("B", "Bia thùng", "Thùng", 240000, 200000, 0)
	r := e.Admin.Expect(400, "VALIDATION", "PUT", fmt.Sprintf("/api/products/%d/units", b), map[string]any{"items": []any{map[string]any{"unit": "Lon", "factor": "0.041667"}}})
	if !strings.Contains(string(r.Body), "Đơn vị gốc phải là đơn vị nhỏ nhất") {
		t.Fatalf("thông báo: %s", r.Body)
	}
	res := e.Admin.importOK(t, "/api/import/product_units?dry_run=1", xlsxFile(t, [][]string{{"Mã hàng", "Đơn vị", "Hệ số"}, {"B", "Lon", "#0.041667"}, {"A", "Thùng", "#24"}}))
	if len(res.Errors) != 1 || res.Errors[0].Row != 2 || !strings.Contains(res.Errors[0].Message, "nhỏ nhất") {
		t.Fatalf("nhập hệ số < 1: %+v", res)
	}
	e.setUnits(a, "Thùng", 24, "Két", "1.5")
	e.Opening("2026-01-01", e.WH["KHO1"], UL(a, "Thùng", "1", nil))
	for i := 0; i < 24; i++ {
		e.Admin.Posted(DocBody("sale", "2026-01-02", k, e.WH["KHO1"], UL(a, "", "1", nil)))
	}
	tot, _ := e.TotalStock(a)
	eqDec(t, tot, "0", "bán 24 Lon lẻ hết đúng một Thùng")
	if r := e.Admin.OK("POST", "/api/documents/check", DocBody("sale", "2026-01-02", k, e.WH["KHO1"], UL(a, "", "1", nil)), nil); !strings.Contains(string(r.Body), `"can_post":false`) {
		t.Fatalf("lon thứ 25 phải thiếu hàng: %s", r.Body)
	}
	// 0,333 Két × 1,5 = 0,4995 ⇒ lẻ quá 3 số ⇒ 400; 0,002 Két = 0,003 ⇒ được.
	r = e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("sale", "2026-01-03", k, e.WH["KHO1"], UL(a, "Két", "0.333", 1)))
	if !strings.Contains(string(r.Body), "lẻ quá 3 số thập phân") {
		t.Fatalf("thông báo: %s", r.Body)
	}
	d := e.Admin.CreateDoc(DocBody("sale", "2026-01-03", k, e.WH["KHO1"], UL(a, "Két", "0.002", 1)))
	eqDec(t, d.Lines[0].BaseQty, "0.003", "SL quy đổi chính xác")
}

// noIDBody dựng body PUT như máy khách cũ: các dòng KHÔNG có id (và không gửi vat_rate), chỉ đổi ghi chú.
func noIDBody(d *docs.Document, withUnit bool, note string) map[string]any {
	var ls []any
	for _, l := range d.Lines {
		m := map[string]any{"product_id": l.ProductID, "qty": l.Qty, "description": l.Description, "note": l.Note}
		if l.UnitPrice != nil {
			m["unit_price"] = l.UnitPrice
		}
		if withUnit {
			m["unit"] = l.Unit
		}
		ls = append(ls, m)
	}
	b := map[string]any{"version": d.Version, "doc_date": d.DocDate.String(), "warehouse_id": d.WarehouseID, "note": note, "lines": ls, "confirm_loss": true}
	if d.PartnerID != nil {
		b["partner_id"] = *d.PartnerID
	}
	return b
}

// M-15 / M-16 — lưu lại phiếu mà các dòng không có id (máy khách cũ) không bao giờ làm mất đơn vị / hệ số / thuế suất /
// giá bị che: cùng dãy mặt hàng ⇒ ghép theo vị trí; khác dãy ⇒ 400 LINE_IDS_REQUIRED; phiếu thường (không có dữ liệu
// như vậy) giữ hành vi bản chuẩn. Tồn và công nợ không đổi một đồng sau khi lưu lại chỉ đổi ghi chú.
func TestMR_QA_M15_M16_LuuLaiKhongIDDong(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "unit_conversion", "vat", "stocktake", "permissions")
	k := e.Partner("K", "Khách", true, false)
	sup := e.Partner("S", "NCC", false, true)
	a := e.Product("A", "Nước", "Lon", 10000, 6000, 0)
	v := e.Product("V", "Hàng thuế", "Cái", 100, 50, 0)
	e.setUnits(a, "Thùng", 24, "Lốc", 6)
	e.patchProduct(v, map[string]any{"vat_rate": "10"})
	e.Opening("2026-01-01", e.WH["KHO1"], UL(a, "Thùng", "5", nil), Line(v, "100", "50"))
	s := e.Admin.Posted(DocBody("sale", "2026-01-05", k, e.WH["KHO1"], UL(a, "Thùng", "1", 240000), Line(v, "2", "100")))
	eqDec(t, s.TotalAmount, "240220", "1 Thùng + 2 × 100 + thuế 10% của dòng V")
	snapshot := func() string {
		tot, by := e.TotalStock(a)
		return fmt.Sprint(tot, by, e.Debt("receivable", k))
	}
	base := snapshot()
	check := func(what string) {
		t.Helper()
		if got := snapshot(); got != base {
			t.Fatalf("%s: tồn / công nợ đổi: %s ⇒ %s", what, base, got)
		}
		x := e.Admin.GetDoc(s.ID)
		if !x.TotalAmount.Equal(d("240220")) || x.Lines[0].Unit != "Thùng" || !x.Lines[0].Factor.Equal(d("24")) || x.Lines[1].VatRate == nil ||
			x.Lines[0].ID != s.Lines[0].ID || x.Lines[1].ID != s.Lines[1].ID {
			t.Fatalf("%s: phiếu đổi: %+v %+v %+v", what, x.TotalAmount, x.Lines[0], x.Lines[1].LineVAT)
		}
	}
	resave := func(withUnit bool, note string) {
		t.Helper()
		e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", s.ID), noIDBody(e.Admin.GetDoc(s.ID), withUnit, note), nil)
	}
	resave(true, "bật cả hai, có unit")
	check("bật, máy khách cũ có unit")
	resave(false, "bật, không unit")
	check("bật, máy khách cũ không unit")
	// Bật thuế, máy khách cũ, mặc định đổi (mặt hàng 5%, chung 8%) ⇒ vẫn giữ 10% đã lưu.
	e.Admin.OK("PUT", "/api/settings/vat", map[string]any{"default_vat_rate": "8"}, nil)
	e.patchProduct(v, map[string]any{"vat_rate": "5"})
	resave(false, "đổi mặc định")
	check("bật thuế, mặc định đổi")
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"unit_conversion": false}}, nil)
	resave(true, "tắt quy đổi")
	check("tắt quy đổi (M-15)")
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"vat": false}}, nil)
	resave(true, "tắt thuế")
	check("tắt thuế (M-16)")
	resave(false, "tắt cả hai, không unit")
	check("tắt cả hai")
	// Khác dãy mặt hàng ⇒ 400 LINE_IDS_REQUIRED, không đổi gì.
	cur := e.Admin.GetDoc(s.ID)
	body := noIDBody(cur, true, "đảo dòng")
	ls := body["lines"].([]any)
	body["lines"] = []any{ls[1], ls[0]}
	e.Admin.Expect(400, "LINE_IDS_REQUIRED", "PUT", fmt.Sprintf("/api/documents/%d", s.ID), body)
	// Bỏ dòng V (có thuế) và gửi lại dòng A không id nhưng KHÔNG có khóa unit (dòng A cũ hệ số 24) ⇒ 400.
	noUnit := map[string]any{}
	for k, v := range ls[0].(map[string]any) {
		if k != "unit" {
			noUnit[k] = v
		}
	}
	body["lines"] = []any{noUnit}
	e.Admin.Expect(400, "LINE_IDS_REQUIRED", "PUT", fmt.Sprintf("/api/documents/%d", s.ID), body)
	check("khác dãy bị từ chối")
	mrEnable(e, "unit_conversion", "vat")

	// Phiếu thường (không quy đổi, không thuế): hành vi bản chuẩn — dòng không id là dòng mới.
	e.Admin.OK("PUT", "/api/settings/vat", map[string]any{"default_vat_rate": nil}, nil)
	plain := e.Admin.Posted(DocBody("sale", "2026-01-06", k, e.WH["KHO1"], Line(a, "2", "10000")))
	b := noIDBody(plain, false, "đổi ghi chú")
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", plain.ID), b, nil)
	if x := e.Admin.GetDoc(plain.ID); x.Lines[0].ID == plain.Lines[0].ID || !x.TotalAmount.Equal(plain.TotalAmount) {
		t.Fatalf("phiếu thường: %+v", x.Lines[0])
	}
	b = noIDBody(e.Admin.GetDoc(plain.ID), false, "thêm dòng")
	b["lines"] = append(b["lines"].([]any), Line(a, "1", "10000"))
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", plain.ID), b, nil)

	// Người bị che giá (phiếu tạm mua): cùng dãy ⇒ giữ đơn giá đang lưu; khác dãy ⇒ 400.
	e.Admin.OK("PUT", "/api/role-permissions", map[string]any{"matrix": map[string][]string{"thukho": {"stock.write", "purchase.write"}}}, nil)
	tk := mrUser(e, "tk", "thukho")
	pd := e.Admin.CreateDoc(DocBody("purchase", "2026-01-07", sup, e.WH["KHO1"], Line(a, "3", "6100")))
	tb := noIDBody(tk.GetDoc(pd.ID), false, "thủ kho sửa ghi chú")
	tk.OK("PUT", fmt.Sprintf("/api/documents/%d", pd.ID), tb, nil)
	if x := e.Admin.GetDoc(pd.ID); !x.Lines[0].UnitPrice.Equal(d("6100")) || x.Lines[0].ID != pd.Lines[0].ID {
		t.Fatalf("giá bị che phải giữ: %+v", x.Lines[0])
	}
	// Khác dãy (thêm dòng), dòng A gửi lại "unit_price": null (giá bị che họ thấy) ⇒ 400, phiếu không đổi.
	tb = noIDBody(tk.GetDoc(pd.ID), false, "thêm dòng")
	tb["lines"].([]any)[0].(map[string]any)["unit_price"] = nil
	tb["lines"] = append(tb["lines"].([]any), Line(v, "1", nil))
	tk.Expect(400, "LINE_IDS_REQUIRED", "PUT", fmt.Sprintf("/api/documents/%d", pd.ID), tb)
	if x := e.Admin.GetDoc(pd.ID); len(x.Lines) != 1 || !x.Lines[0].UnitPrice.Equal(d("6100")) {
		t.Fatalf("400 không đổi phiếu: %+v", x.Lines)
	}
	// Không có khóa unit_price ⇒ dòng mới bình thường: giá mua mặc định (hành vi Q-02 / Q-14, không lộ giá cũ).
	tb = noIDBody(tk.GetDoc(pd.ID), false, "thêm dòng, không khóa giá")
	tb["lines"] = append(tb["lines"].([]any), Line(v, "1", nil))
	tk.OK("PUT", fmt.Sprintf("/api/documents/%d", pd.ID), tb, nil)
	if x := e.Admin.GetDoc(pd.ID); len(x.Lines) != 2 || !x.Lines[0].UnitPrice.Equal(d("6000")) {
		t.Fatalf("dòng mới ⇒ giá mặc định: %+v", x.Lines)
	}

	// Kiểm kê theo Lốc: lưu lại không id ⇒ SL thực tế (quy về đơn vị gốc) không đổi.
	st := e.Admin.CreateDoc(DocBody("stocktake", "2026-01-08", 0, e.WH["KHO1"], UL(a, "Lốc", "3", nil)))
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", st.ID), noIDBody(st, false, "ghi chú kiểm kê"), nil)
	if x := e.Admin.GetDoc(st.ID); !x.Lines[0].CountedQty.Equal(d("18")) || x.Lines[0].Unit != "Lốc" {
		t.Fatalf("kiểm kê: %+v", x.Lines[0].LineCount)
	}
}
