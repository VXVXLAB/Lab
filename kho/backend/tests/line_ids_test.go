package tests

import (
	"fmt"
	"testing"

	"kho/internal/cash"
	"kho/internal/docs"
	"kho/internal/reports"
)

// Id dòng ổn định khi sửa phiếu: gửi id ⇒ giữ id; dòng mới ⇒ id mới; dòng bỏ ⇒ xóa; đổi thứ tự giữ id;
// id của phiếu khác / id lặp ⇒ coi là dòng mới; bút toán kho dựng lại đúng.
// REQ: 044, 082, 036, 038, 039
func TestREQ044_IdDongOnDinhKhiSua(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	a := e.Product("A", "Hàng A", "Cái", 100, 50, 0)
	b := e.Product("B", "Hàng B", "Cái", 200, 50, 0)
	c := e.Product("C", "Hàng C", "Cái", 300, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "50", nil), Line(b, "50", nil), Line(c, "50", nil))
	other := e.Admin.CreateDoc(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(a, "1", nil)))
	doc := e.Admin.Posted(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(a, "1", nil), Line(b, "2", nil), Line(c, "3", nil)))
	ia, ib, ic := doc.Lines[0].ID, doc.Lines[1].ID, doc.Lines[2].ID
	withID := func(id, product int64, qty string) map[string]any {
		l := Line(product, qty, nil)
		if id != 0 {
			l["id"] = id
		}
		return l
	}
	// Đổi thứ tự (C, A), sửa SL A, bỏ B, thêm dòng mới A, thêm dòng mang id của phiếu khác, và id lặp.
	var u docs.Document
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", doc.ID), map[string]any{"version": doc.Version, "doc_date": "2026-02-01", "partner_id": cus, "warehouse_id": e.WH["KHO1"],
		"lines": []any{withID(ic, c, "3"), withID(ia, a, "5"), withID(0, a, "1"), withID(other.Lines[0].ID, b, "4"), withID(ic, c, "2")}}, &u)
	if len(u.Lines) != 5 {
		t.Fatalf("số dòng: %+v", u.Lines)
	}
	if u.Lines[0].ID != ic || u.Lines[1].ID != ia || u.Lines[0].LineNo != 1 || u.Lines[1].LineNo != 2 {
		t.Fatalf("giữ id và theo thứ tự yêu cầu: %+v", u.Lines)
	}
	eqDec(t, u.Lines[1].Qty, "5", "sửa SL tại chỗ")
	seen := map[int64]bool{ia: true, ic: true, ib: true, other.Lines[0].ID: true}
	for _, l := range u.Lines[2:] {
		if seen[l.ID] {
			t.Fatalf("dòng mới / id lạ / id lặp phải nhận id mới: %+v", u.Lines)
		}
		seen[l.ID] = true
	}
	// Dòng của phiếu khác không bị đụng tới; dòng B đã xóa.
	if o := e.Admin.GetDoc(other.ID); len(o.Lines) != 1 || o.Lines[0].ID != other.Lines[0].ID || !o.Lines[0].Qty.Equal(d("1")) {
		t.Fatalf("phiếu khác bị ảnh hưởng: %+v", o.Lines)
	}
	for _, l := range u.Lines {
		if l.ID == ib {
			t.Fatal("dòng B phải bị xóa")
		}
	}
	// Bút toán kho dựng lại đúng: A 50 − 5 − 1 = 44, B 50 − 4 = 46, C 50 − 3 − 2 = 45.
	for p, want := range map[int64]string{a: "44", b: "46", c: "45"} {
		tp, _ := e.TotalStock(p)
		eqDec(t, tp, want, fmt.Sprintf("tồn mặt hàng %d", p))
	}
	var l reports.Ledger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d", a), nil, &l)
	if len(l.Rows) != 3 { // tồn đầu + 2 dòng của phiếu (phiếu khác vẫn là phiếu tạm)
		t.Fatalf("thẻ kho A: %+v", l.Rows)
	}
	// Không gửi id (máy khách cũ) ⇒ mọi dòng id mới, vẫn chạy như trước.
	var u2 docs.Document
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", doc.ID), map[string]any{"version": u.Version, "doc_date": "2026-02-01", "partner_id": cus, "warehouse_id": e.WH["KHO1"],
		"lines": []any{Line(a, "1", nil)}}, &u2)
	if len(u2.Lines) != 1 || seen[u2.Lines[0].ID] {
		t.Fatalf("không gửi id ⇒ id mới: %+v", u2.Lines)
	}
	tp, _ := e.TotalStock(b)
	eqDec(t, tp, "50", "dòng B bỏ ⇒ tồn hoàn")
	// Phiếu tạm cũng giữ id; lịch sử vẫn ghi đủ.
	var o2 docs.Document
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", other.ID), map[string]any{"version": other.Version, "doc_date": "2026-02-01", "partner_id": cus, "warehouse_id": e.WH["KHO1"],
		"lines": []any{withID(other.Lines[0].ID, a, "7")}}, &o2)
	if o2.Lines[0].ID != other.Lines[0].ID {
		t.Fatal("phiếu tạm giữ id dòng")
	}
	var hist struct {
		Items []docs.HistoryEntry `json:"items"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/history", doc.ID), nil, &hist)
	if len(hist.Items) != 4 { // created, posted, updated, updated
		t.Fatalf("lịch sử: %d", len(hist.Items))
	}
}

// Phiếu thu/chi: id dòng tiền ổn định khi sửa, liên kết chứng từ giữ đúng.
// REQ: 060, 085, 062
func TestREQ060_IdDongPhieuThuOnDinh(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "10", nil))
	s := e.Admin.Posted(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "5", "100")))
	v := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": cus, "lines": []any{
		map[string]any{"description": "Đợt 1", "amount": 100, "document_id": s.ID},
		map[string]any{"description": "Đợt 2", "amount": 200},
		map[string]any{"description": "Đợt 3", "amount": 50},
	}})
	other := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": cus, "lines": []any{map[string]any{"amount": 1}}})
	l1, l2, l3 := v.Lines[0].ID, v.Lines[1].ID, v.Lines[2].ID
	var u cash.Voucher
	e.Admin.OK("PUT", fmt.Sprintf("/api/vouchers/%d", v.ID), map[string]any{"version": v.Version, "voucher_type": "receipt", "account_id": e.TM, "partner_id": cus, "lines": []any{
		map[string]any{"id": l3, "description": "Đợt 3 sửa", "amount": 60},
		map[string]any{"id": l1, "description": "Đợt 1", "amount": 100, "document_id": s.ID},
		map[string]any{"description": "Mới", "amount": 5},
		map[string]any{"id": other.Lines[0].ID, "description": "id lạ", "amount": 7},
	}}, &u)
	if len(u.Lines) != 4 || u.Lines[0].ID != l3 || u.Lines[1].ID != l1 || u.Lines[0].LineNo != 1 {
		t.Fatalf("giữ id + thứ tự: %+v", u.Lines)
	}
	if u.Lines[0].Description != "Đợt 3 sửa" || !u.Lines[0].Amount.Equal(d("60")) || u.Lines[1].DocumentID == nil || *u.Lines[1].DocumentID != s.ID {
		t.Fatalf("nội dung dòng giữ id: %+v", u.Lines)
	}
	for _, l := range u.Lines[2:] {
		if l.ID == l1 || l.ID == l2 || l.ID == l3 || l.ID == other.Lines[0].ID {
			t.Fatalf("dòng mới / id lạ phải có id mới: %+v", u.Lines)
		}
	}
	eqDec(t, u.TotalAmount, "172", "tổng")
	var ov cash.Voucher
	e.Admin.OK("GET", fmt.Sprintf("/api/vouchers/%d", other.ID), nil, &ov)
	if len(ov.Lines) != 1 || ov.Lines[0].ID != other.Lines[0].ID {
		t.Fatal("phiếu khác không bị ảnh hưởng")
	}
	eqDec(t, e.Debt("receivable", cus), "327", "công nợ = 500 − 172 − 1")
	// Dòng có liên kết chứng từ vẫn chặn xóa phiếu đó (sau bỏ ghi sổ).
	var un docs.Document
	e.Admin.OK("POST", fmt.Sprintf("/api/documents/%d/unpost", s.ID), map[string]any{"version": s.Version}, &un)
	e.Admin.Expect(409, "IN_USE", "DELETE", fmt.Sprintf("/api/documents/%d", s.ID), nil)
}
