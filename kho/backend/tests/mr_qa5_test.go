package tests

import (
	"fmt"
	"testing"

	"kho/internal/docs"
)

// Quy tắc id dòng (QA vòng 4, M-17 / M-18) — một quy tắc, mọi nhánh, tính năng bật / tắt, phiếu đã ghi sổ và phiếu tạm.

type lineOpt struct{ id, unit, vat bool }

// lineBody dựng một dòng gửi lên từ dòng đang lưu: kèm id / khóa unit / khóa vat_rate tùy chọn.
func lineBody(l docs.Line, o lineOpt) map[string]any {
	m := map[string]any{"product_id": l.ProductID, "qty": l.Qty, "description": l.Description}
	if l.UnitPrice != nil {
		m["unit_price"] = l.UnitPrice
	}
	if o.id {
		m["id"] = l.ID
	}
	if o.unit {
		m["unit"] = l.Unit
	}
	if o.vat {
		if l.LineVAT != nil && l.VatRate != nil {
			m["vat_rate"] = l.VatRate
		} else {
			m["vat_rate"] = nil
		}
	}
	return m
}

func docBodyLines(d *docs.Document, note string, lines ...map[string]any) map[string]any {
	b := map[string]any{"version": d.Version, "doc_date": d.DocDate.String(), "warehouse_id": d.WarehouseID, "note": note, "lines": lines, "confirm_loss": true}
	if d.PartnerID != nil {
		b["partner_id"] = *d.PartnerID
	}
	return b
}

func TestMR_QA_QuyTacIDDong(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "unit_conversion", "vat")
	k := e.Partner("K", "Khách", true, false)
	p := e.Product("P", "Nước", "Lon", 1000, 500, 0)
	q := e.Product("Q", "Cốc", "Cái", 500, 100, 0)
	e.setUnits(p, "Thùng", 24)
	e.Opening("2026-01-01", e.WH["KHO1"], UL(p, "Thùng", "100", nil), Line(q, "1000", "100"))
	mk := func(post bool) *docs.Document {
		body := DocBody("sale", "2026-01-05", k, e.WH["KHO1"], UL(p, "Thùng", "2", 24000, "vat_rate", 10), UL(q, "", "3", 500, "vat_rate", nil), UL(p, "", "5", 1000, "vat_rate", nil))
		if post {
			return e.Admin.Posted(body)
		}
		return e.Admin.CreateDoc(body)
	}
	figures := func(id int64) string {
		tot, by := e.TotalStock(p)
		x := e.Admin.GetDoc(id)
		var ls []string
		for _, l := range x.Lines {
			u, v := "", ""
			if l.LineUnit != nil {
				u = fmt.Sprintf("%+v", *l.LineUnit)
			}
			if l.LineVAT != nil {
				v = fmt.Sprintf("%v %v", l.VatRate, l.TaxAmount)
			}
			ls = append(ls, fmt.Sprint(l.ID, l.Unit, l.Qty, *l.UnitPrice, l.Amount, u, v))
		}
		return fmt.Sprint(tot, by, e.Debt("receivable", k), x.TotalAmount, ls)
	}
	refused := func(d *docs.Document, body map[string]any, what string) {
		t.Helper()
		before := figures(d.ID)
		v := e.Admin.GetDoc(d.ID).Version
		e.Admin.Expect(400, "LINE_IDS_REQUIRED", "PUT", fmt.Sprintf("/api/documents/%d", d.ID), body)
		if after := figures(d.ID); after != before || e.Admin.GetDoc(d.ID).Version != v {
			t.Fatalf("%s: 400 phải không đổi gì\n%s\n%s", what, before, after)
		}
	}
	states := []map[string]bool{{}, {"vat": false}, {"unit_conversion": false}, {"vat": false, "unit_conversion": false}}
	for _, post := range []bool{true, false} {
		for _, st := range states {
			name := fmt.Sprintf("ghi sổ=%v tắt=%v", post, st)
			mrEnable(e, "unit_conversion", "vat")
			d := mk(post)
			eqDec(t, d.TotalAmount, "59300", name+": 48.000 + 4.800 + 1.500 + 5.000")
			if len(st) > 0 {
				e.Admin.OK("PUT", "/api/features", map[string]any{"features": st}, nil)
			}
			base := figures(d.ID)
			put := func(note string, lines ...map[string]any) {
				t.Helper()
				cur := e.Admin.GetDoc(d.ID)
				e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", d.ID), docBodyLines(cur, note, lines...), nil)
				if got := figures(d.ID); got != base {
					t.Fatalf("%s %s: số liệu đổi\n%s\n%s", name, note, base, got)
				}
			}
			L := e.Admin.GetDoc(d.ID).Lines
			// Quy tắc 1: có id, không gửi unit / vat_rate ⇒ giữ.
			put("1: có id", lineBody(L[0], lineOpt{id: true}), lineBody(L[1], lineOpt{id: true}), lineBody(L[2], lineOpt{id: true}))
			// Quy tắc 2: không id, cùng dãy, đơn vị trùng (có / không gửi unit) ⇒ ghép theo vị trí.
			put("2: không id, có unit", lineBody(L[0], lineOpt{unit: true}), lineBody(L[1], lineOpt{unit: true}), lineBody(L[2], lineOpt{unit: true}))
			put("2: không id, không unit", lineBody(L[0], lineOpt{}), lineBody(L[1], lineOpt{}), lineBody(L[2], lineOpt{}))
			cur := e.Admin.GetDoc(d.ID)
			L = cur.Lines
			// M-18: cùng dãy mặt hàng (P, Q, P) nhưng đảo ⇒ đơn vị khác ở vị trí ⇒ 400.
			refused(d, docBodyLines(cur, "đảo", lineBody(L[2], lineOpt{unit: true}), lineBody(L[1], lineOpt{unit: true}), lineBody(L[0], lineOpt{unit: true})), name+" M-18")
			// M-17: trộn id — Q có id, hai dòng P không id, có unit, không vat_rate ⇒ 400.
			refused(d, docBodyLines(cur, "trộn", lineBody(L[0], lineOpt{unit: true}), lineBody(L[1], lineOpt{id: true}), lineBody(L[2], lineOpt{unit: true})), name+" M-17 thiếu vat_rate")
			// Trộn id, dòng P Thùng không id có vat_rate nhưng KHÔNG có unit (dòng bỏ có hệ số 24) ⇒ 400.
			refused(d, docBodyLines(cur, "trộn 2", lineBody(L[0], lineOpt{vat: true}), lineBody(L[1], lineOpt{id: true}), lineBody(L[2], lineOpt{id: true})), name+" thiếu unit")
			// Khác dãy (thêm dòng) không id, thiếu khóa ⇒ 400.
			refused(d, docBodyLines(cur, "thêm", lineBody(L[0], lineOpt{unit: true}), lineBody(L[1], lineOpt{}), lineBody(L[2], lineOpt{}), Line(q, "1", "500")), name+" khác dãy")
		}
	}
	mrEnable(e, "unit_conversion", "vat")
	sd := mk(true)
	L := sd.Lines
	dec24 := d("24")
	// Đầu ra gộp xung đột của giao diện hiện tại: dòng cũ mang id, dòng mới mang khóa unit / vat_rate tường minh ⇒ nhận.
	nl := UL(p, "Thùng", "1", 24000, "vat_rate", 10)
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", sd.ID), docBodyLines(e.Admin.GetDoc(sd.ID), "giao diện",
		lineBody(L[0], lineOpt{id: true, unit: true, vat: true}), lineBody(L[1], lineOpt{id: true, unit: true, vat: true}),
		lineBody(L[2], lineOpt{id: true, unit: true, vat: true}), nl), nil)
	eqDec(t, e.Admin.GetDoc(sd.ID).TotalAmount, "85700", "59.300 + 24.000 + 2.400")
	// Bỏ dòng đặc biệt rồi gửi dòng không id cùng mặt hàng với khóa TƯỜNG MINH ⇒ ý người dùng ⇒ nhận (kể cả vat_rate null).
	cur := e.Admin.GetDoc(sd.ID)
	L = cur.Lines
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", sd.ID), docBodyLines(cur, "chép lại dòng, bỏ thuế",
		map[string]any{"product_id": p, "unit": "Thùng", "qty": 2, "unit_price": 24000, "vat_rate": nil},
		lineBody(L[1], lineOpt{id: true}), lineBody(L[2], lineOpt{id: true})), nil)
	x := e.Admin.GetDoc(sd.ID)
	if x.Lines[0].ID == L[0].ID || x.Lines[0].VatRate != nil || !x.Lines[0].Factor.Equal(dec24) || !x.TotalAmount.Equal(d("54500")) {
		t.Fatalf("khóa tường minh ⇒ nhận đúng ý: %+v %s", x.Lines[0], x.TotalAmount)
	}
	// Bỏ hẳn một dòng đặc biệt (không có dòng không id cùng mặt hàng) ⇒ nhận.
	cur = e.Admin.GetDoc(sd.ID)
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", sd.ID), docBodyLines(cur, "bỏ dòng", lineBody(cur.Lines[1], lineOpt{id: true})), nil)
	eqDec(t, e.Admin.GetDoc(sd.ID).TotalAmount, "1500", "chỉ còn Q")
	// Phiếu thường (không quy đổi, không thuế): dòng không id = dòng mới, mọi hình dạng như bản chuẩn.
	pl := e.Admin.Posted(DocBody("sale", "2026-01-06", k, e.WH["KHO1"], UL(q, "", "1", 500, "vat_rate", nil), UL(p, "", "1", 1000, "vat_rate", nil)))
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", pl.ID), docBodyLines(pl, "thường", lineBody(pl.Lines[1], lineOpt{}), lineBody(pl.Lines[0], lineOpt{id: true})), nil)
}
