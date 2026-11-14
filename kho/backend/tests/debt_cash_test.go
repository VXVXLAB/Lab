package tests

import (
	"fmt"
	"strings"
	"testing"

	"kho/internal/cash"
	"kho/internal/docs"
	"kho/internal/reports"
)

// REQ: 052, 053, 034, 062, 084, 008
// Công nợ khách hàng: số dư đầu + phát sinh (bán, trả hàng, thu tiền) = số dư; sổ chi tiết mở được từng chứng từ.
func TestREQ052_053_084_CongNoKhachHang(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Admin
	var kh struct {
		ID int64 `json:"id"`
	}
	cus.OK("POST", "/api/partners", map[string]any{"code": "TP", "name": "Cơ khí Tân Phú", "is_customer": true, "opening_receivable": 1000000, "phone": "0909123456"}, &kh)
	p := e.Product("P", "Hàng P", "Cái", 100000, 50000, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "100", nil))
	s1 := e.Admin.Posted(DocBody("sale", "2026-02-01", kh.ID, e.WH["KHO1"], Line(p, "10", "100000")))
	s2 := e.Admin.Posted(DocBody("sale", "2026-03-01", kh.ID, e.WH["KHO1"], Line(p, "5", "100000")))
	ret := e.Admin.Posted(DocBody("sale_return", "2026-03-05", kh.ID, e.WH["KHO1"], Line(p, "2", "100000")))
	v := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "voucher_date": "2026-03-10", "account_id": e.TM, "partner_id": kh.ID,
		"lines": []any{map[string]any{"description": "Thu tiền phiếu " + *s1.DocNo, "amount": 800000, "document_id": s1.ID}}})
	// Phiếu tạm không vào công nợ.
	e.Admin.CreateDoc(DocBody("sale", "2026-03-11", kh.ID, e.WH["KHO1"], Line(p, "1", nil)))

	var l reports.DebtLedger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/debt-ledger?side=receivable&partner_id=%d", kh.ID), nil, &l)
	eqDec(t, l.Opening, "1000000", "đầu kỳ")
	if len(l.Rows) != 4 {
		t.Fatalf("sổ công nợ: %+v", l.Rows)
	}
	want := []struct{ no, inc, dec, bal string }{
		{*s1.DocNo, "1000000", "0", "2000000"},
		{*s2.DocNo, "500000", "0", "2500000"},
		{*ret.DocNo, "0", "200000", "2300000"},
		{v.VoucherNo, "0", "800000", "1500000"},
	}
	for i, w := range want {
		r := l.Rows[i]
		if r.RefNo != w.no {
			t.Fatalf("dòng %d số chứng từ %s ≠ %s", i+1, r.RefNo, w.no)
		}
		eqDec(t, r.Increase, w.inc, "tăng")
		eqDec(t, r.Decrease, w.dec, "giảm")
		eqDec(t, r.Balance, w.bal, "số dư")
	}
	// Mở chi tiết từ sổ công nợ (REQ-053): document_id/voucher_id trỏ đúng chứng từ.
	if l.Rows[0].DocumentID == nil || *l.Rows[0].DocumentID != s1.ID || l.Rows[3].VoucherID == nil || *l.Rows[3].VoucherID != v.ID {
		t.Fatalf("liên kết chứng từ: %+v", l.Rows)
	}
	opened := e.Admin.GetDoc(*l.Rows[2].DocumentID)
	if opened.DocType != "sale_return" || len(opened.Lines) != 1 {
		t.Fatalf("mở chứng từ trả hàng: %+v", opened)
	}
	if !strings.Contains(l.Rows[2].Description, "Khách trả hàng") || !strings.Contains(l.Rows[3].Description, "Thu tiền mặt") {
		t.Fatalf("diễn giải: %+v", l.Rows)
	}
	eqDec(t, l.Closing, "1500000", "cuối kỳ")
	// Tổng hợp theo kỳ (REQ-052/065): đầu kỳ tính đến trước from.
	var sm reports.DebtSummary
	e.Admin.OK("GET", "/api/reports/debt-summary?side=receivable&from=2026-03-01&to=2026-03-31", nil, &sm)
	if len(sm.Items) != 1 {
		t.Fatalf("tổng hợp: %+v", sm.Items)
	}
	it := sm.Items[0]
	eqDec(t, it.Opening, "2000000", "đầu kỳ tháng 3")
	eqDec(t, it.Increase, "500000", "tăng tháng 3")
	eqDec(t, it.Decrease, "1000000", "giảm tháng 3 (trả 200.000 + thu 800.000)")
	eqDec(t, it.Closing, "1500000", "cuối kỳ tháng 3")
	if !it.Closing.Equal(l.Closing) || it.PartnerID != kh.ID {
		t.Fatal("tổng hợp và sổ chi tiết phải khớp")
	}
	// Nợ cũ của phiếu bán thứ hai = số dư trước nó.
	g2 := e.Admin.GetDoc(s2.ID)
	eqDec(t, *g2.OldDebt, "2000000", "nợ cũ phiếu 2")
	eqDec(t, *g2.TotalDebt, "2500000", "tổng nợ phiếu 2")
	// Lọc khoảng thời gian sổ chi tiết.
	var l3 reports.DebtLedger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/debt-ledger?side=receivable&partner_id=%d&from=2026-03-02&to=2026-03-31", kh.ID), nil, &l3)
	eqDec(t, l3.Opening, "2500000", "đầu kỳ 02/03")
	if len(l3.Rows) != 2 {
		t.Fatalf("sổ lọc kỳ: %+v", l3.Rows)
	}
	// Sửa phiếu bán cũ ⇒ công nợ tự cập nhật (REQ-039/062).
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", s1.ID), map[string]any{"version": s1.Version, "doc_date": "2026-02-01", "partner_id": kh.ID, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(p, "10", "90000")}}, nil)
	eqDec(t, e.Debt("receivable", kh.ID), "1400000", "công nợ sau sửa giá")
	// Dashboard tổng phải thu khớp.
	var dash reports.Dashboard
	e.Admin.OK("GET", "/api/dashboard", nil, &dash)
	eqDec(t, dash.TotalReceivable, "1400000", "dashboard phải thu")
	if dash.DraftCount != 1 {
		t.Fatalf("dashboard số phiếu tạm: %d", dash.DraftCount)
	}
}

// REQ: 054, 055, 065, 084
// Công nợ nhà cung cấp: phải trả = đầu kỳ + mua − trả hàng NCC − chi tiền; đối tác vừa là KH vừa là NCC có hai sổ riêng.
func TestREQ054_055_CongNoNhaCungCap(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	var both struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": "HN", "name": "Công ty Hàn Nhiệt", "is_customer": true, "is_supplier": true, "opening_payable": 300000, "opening_receivable": 50000}, &both)
	p := e.Product("P", "Hàng P", "Cái", 20000, 10000, 0)
	pur := e.Admin.Posted(DocBody("purchase", "2026-02-01", both.ID, e.WH["KHO1"], Line(p, "100", "10000")))
	pr := e.Admin.Posted(DocBody("purchase_return", "2026-02-05", both.ID, e.WH["KHO1"], Line(p, "10", "10000")))
	pay := e.Admin.Voucher(map[string]any{"voucher_type": "payment", "voucher_date": "2026-02-10", "account_id": e.NH, "partner_id": both.ID,
		"lines": []any{map[string]any{"description": "Trả tiền hàng", "amount": 500000, "document_id": pur.ID}}})
	e.Admin.Posted(DocBody("sale", "2026-02-11", both.ID, e.WH["KHO1"], Line(p, "1", "20000")))
	var l reports.DebtLedger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/debt-ledger?side=payable&partner_id=%d", both.ID), nil, &l)
	eqDec(t, l.Opening, "300000", "phải trả đầu kỳ")
	if len(l.Rows) != 3 || l.Rows[0].RefNo != *pur.DocNo || l.Rows[1].RefNo != *pr.DocNo || l.Rows[2].RefNo != pay.VoucherNo {
		t.Fatalf("sổ phải trả: %+v", l.Rows)
	}
	if !strings.HasPrefix(pay.VoucherNo, "BN") {
		t.Fatalf("chi ngân hàng phải số BN: %s", pay.VoucherNo)
	}
	eqDec(t, l.Closing, "700000", "phải trả = 300.000 + 1.000.000 − 100.000 − 500.000")
	eqDec(t, e.Debt("receivable", both.ID), "70000", "sổ phải thu riêng = 50.000 + 20.000")
	var sm reports.DebtSummary
	e.Admin.OK("GET", "/api/reports/debt-summary?side=payable", nil, &sm)
	if len(sm.Items) != 1 {
		t.Fatalf("tổng hợp phải trả: %+v", sm.Items)
	}
	eqDec(t, sm.Items[0].Increase, "1000000", "tăng")
	eqDec(t, sm.Items[0].Decrease, "600000", "giảm")
	eqDec(t, sm.Totals.Closing, "700000", "tổng cuối kỳ")
	// Mở chứng từ từ sổ NCC.
	if g := e.Admin.GetDoc(*l.Rows[1].DocumentID); g.DocType != "purchase_return" {
		t.Fatalf("mở chứng từ: %+v", g)
	}
	var vv cash.Voucher
	e.Admin.OK("GET", fmt.Sprintf("/api/vouchers/%d", *l.Rows[2].VoucherID), nil, &vv)
	if vv.Lines[0].DocumentNo == nil || *vv.Lines[0].DocumentNo != *pur.DocNo {
		t.Fatalf("phiếu chi liên kết chứng từ: %+v", vv.Lines)
	}
	// Phiếu mua có nợ cũ / tổng nợ phải trả.
	g := e.Admin.GetDoc(pur.ID)
	eqDec(t, *g.OldDebt, "300000", "nợ cũ phiếu mua")
	eqDec(t, *g.TotalDebt, "1300000", "tổng nợ phiếu mua")
}

// REQ: 056, 057, 058, 059, 060, 061, 062, 085, 007
// Thu/chi quỹ và ngân hàng, nhiều dòng tiền cho cùng một KH/NCC trong một phiếu; công nợ và sổ quỹ cập nhật;
// sửa/xóa phiếu có version.
func TestREQ056_061_085_ThuChiNhieuDong(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	kh := e.Partner("KH", "Khách thu chi", true, false)
	ncc := e.Partner("NCC", "NCC thu chi", false, true)
	p := e.Product("P", "Hàng P", "Cái", 1000000, 500000, 0)
	e.Admin.Posted(DocBody("purchase", "2026-01-05", ncc, e.WH["KHO1"], Line(p, "20", "500000")))
	s := e.Admin.Posted(DocBody("sale", "2026-01-10", kh, e.WH["KHO1"], Line(p, "10", "1000000")))
	eqDec(t, e.Debt("receivable", kh), "10000000", "phải thu ban đầu")
	eqDec(t, e.Debt("payable", ncc), "10000000", "phải trả ban đầu")

	// Thu tiền mặt nhiều dòng cùng 1 khách (REQ-056/060).
	pt := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "voucher_date": "2026-01-15", "account_id": e.TM, "partner_id": kh, "note": "Khách trả nợ",
		"lines": []any{
			map[string]any{"description": "Trả tiền phiếu " + *s.DocNo + " đợt 1", "amount": 2000000, "document_id": s.ID},
			map[string]any{"description": "Trả tiền phiếu " + *s.DocNo + " đợt 2", "amount": 1500000, "document_id": s.ID},
			map[string]any{"description": "Tiền cước", "amount": 500000},
		}})
	if pt.VoucherNo != "PT00001" || len(pt.Lines) != 3 || pt.VoucherTypeName != "Phiếu thu tiền mặt" {
		t.Fatalf("phiếu thu tiền mặt: %+v", pt)
	}
	eqDec(t, pt.TotalAmount, "4000000", "tổng phiếu thu")
	// Thu ngân hàng nhiều dòng (REQ-058).
	bc := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "voucher_date": "2026-01-20", "account_id": e.NH, "partner_id": kh,
		"lines": []any{map[string]any{"description": "CK Vietcombank 1", "amount": 1000000}, map[string]any{"description": "CK Vietcombank 2", "amount": 1000000}}})
	if bc.VoucherNo != "BC00001" {
		t.Fatalf("thu ngân hàng số BC: %s", bc.VoucherNo)
	}
	eqDec(t, e.Debt("receivable", kh), "4000000", "phải thu sau thu tiền = 10tr − 4tr − 2tr")
	// Chi tiền mặt nhiều dòng cùng 1 NCC (REQ-057/061).
	pc := e.Admin.Voucher(map[string]any{"voucher_type": "payment", "voucher_date": "2026-01-16", "account_id": e.TM, "partner_id": ncc,
		"lines": []any{map[string]any{"description": "Trả tiền hàng đợt 1", "amount": 1000000}, map[string]any{"description": "Trả tiền hàng đợt 2", "amount": 2000000}}})
	if pc.VoucherNo != "PC00001" {
		t.Fatalf("chi tiền mặt số PC: %s", pc.VoucherNo)
	}
	// Chi ngân hàng nhiều dòng (REQ-059).
	bn := e.Admin.Voucher(map[string]any{"voucher_type": "payment", "voucher_date": "2026-01-21", "account_id": e.NH, "partner_id": ncc,
		"lines": []any{map[string]any{"description": "UNC 1", "amount": 3000000}, map[string]any{"description": "UNC 2", "amount": 1000000}, map[string]any{"description": "Phí chuyển", "amount": 11000}}})
	if bn.VoucherNo != "BN00001" {
		t.Fatalf("chi ngân hàng số BN: %s", bn.VoucherNo)
	}
	eqDec(t, e.Debt("payable", ncc), "2989000", "phải trả = 10tr − 3tr − 4.011.000")
	// Chi khác không gắn đối tác.
	e.Admin.Voucher(map[string]any{"voucher_type": "payment", "voucher_date": "2026-01-22", "account_id": e.TM, "note": "Chi tiền điện",
		"lines": []any{map[string]any{"description": "Tiền điện tháng 1", "amount": 300000}}})

	// Sổ quỹ tiền mặt: thu 4tr, chi 3tr + 0,3tr.
	var cb reports.CashBook
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/cash-book?account_id=%d", e.TM), nil, &cb)
	if len(cb.Rows) != 6 {
		t.Fatalf("sổ quỹ (mỗi dòng tiền một dòng): %+v", cb.Rows)
	}
	eqDec(t, cb.TotalReceipt, "4000000", "tổng thu quỹ")
	eqDec(t, cb.TotalPayment, "3300000", "tổng chi quỹ")
	eqDec(t, cb.Closing, "700000", "tồn quỹ")
	eqDec(t, cb.Rows[2].Balance, "4000000", "số dư lũy kế sau phiếu thu")
	var nb reports.CashBook
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/cash-book?account_id=%d&from=2026-01-21", e.NH), nil, &nb)
	eqDec(t, nb.Opening, "2000000", "đầu kỳ ngân hàng")
	eqDec(t, nb.Closing, "-2011000", "cuối kỳ ngân hàng")

	// Danh sách phiếu thu chi lọc theo đối tác / loại.
	var vl struct {
		Items []cash.Summary `json:"items"`
		Total int            `json:"total"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/vouchers?partner_id=%d", kh), nil, &vl)
	if vl.Total != 2 {
		t.Fatalf("phiếu của khách: %d", vl.Total)
	}
	e.Admin.OK("GET", "/api/vouchers?type=payment&q=UNC", nil, &vl)
	if vl.Total != 1 || vl.Items[0].LineCount != 3 {
		t.Fatalf("tìm phiếu chi theo diễn giải: %+v", vl)
	}

	// Sửa phiếu thu: bỏ dòng tiền cước ⇒ công nợ tăng lại; version cũ bị từ chối.
	upd := map[string]any{"version": pt.Version, "voucher_type": "receipt", "voucher_date": "2026-01-15", "account_id": e.TM, "partner_id": kh,
		"lines": []any{map[string]any{"description": "Đợt 1", "amount": 2000000}, map[string]any{"description": "Đợt 2", "amount": 1500000}}}
	var pt2 cash.Voucher
	e.Admin.OK("PUT", fmt.Sprintf("/api/vouchers/%d", pt.ID), upd, &pt2)
	if pt2.VoucherNo != "PT00001" || pt2.Version != pt.Version+1 {
		t.Fatalf("sửa phiếu thu: %+v", pt2)
	}
	eqDec(t, e.Debt("receivable", kh), "4500000", "phải thu sau sửa phiếu thu")
	e.Admin.Expect(409, "VERSION_CONFLICT", "PUT", fmt.Sprintf("/api/vouchers/%d", pt.ID), upd)
	// Đổi sang ngân hàng ⇒ số phiếu theo dãy BC.
	upd["version"] = pt2.Version
	upd["account_id"] = e.NH
	var pt3 cash.Voucher
	e.Admin.OK("PUT", fmt.Sprintf("/api/vouchers/%d", pt.ID), upd, &pt3)
	if pt3.VoucherNo != "BC00002" {
		t.Fatalf("đổi tài khoản ngân hàng: %s", pt3.VoucherNo)
	}
	// Xóa phiếu chi ⇒ phải trả tăng lại.
	e.Admin.OK("DELETE", fmt.Sprintf("/api/vouchers/%d?version=%d", bn.ID, bn.Version), nil, nil)
	eqDec(t, e.Debt("payable", ncc), "7000000", "phải trả sau xóa phiếu chi")
	var hist struct {
		Items []docs.HistoryEntry `json:"items"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/vouchers/%d/history", bn.ID), nil, &hist)
	if len(hist.Items) != 2 || hist.Items[1].Action != "deleted" {
		t.Fatalf("lịch sử phiếu chi: %+v", hist.Items)
	}
	// Kiểm tra dữ liệu nhập.
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/vouchers", map[string]any{"voucher_type": "receipt", "account_id": e.TM, "lines": []any{}})
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/vouchers", map[string]any{"voucher_type": "receipt", "account_id": e.TM, "lines": []any{map[string]any{"amount": -5}}})
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/vouchers", map[string]any{"voucher_type": "xyz", "account_id": e.TM, "lines": []any{map[string]any{"amount": 5}}})
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/vouchers", map[string]any{"voucher_type": "receipt", "account_id": 99999, "lines": []any{map[string]any{"amount": 5}}})
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/vouchers", map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": ncc, "lines": []any{map[string]any{"amount": 5, "document_id": s.ID}}})
	// Xuất phiếu thu/chi.
	rows := xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/vouchers/%d/export?format=xlsx", pc.ID), nil, nil).Body)
	if rows[0][0] != "PHIẾU CHI" || findRow(rows, 1, "Trả tiền hàng đợt 2") == nil || findRow(rows, 0, "Tổng số tiền")[3] != "3000000" {
		t.Fatalf("xuất phiếu chi: %v", rows)
	}
	x := docxXML(t, e.Admin.OK("GET", fmt.Sprintf("/api/vouchers/%d/export?format=docx", pc.ID), nil, nil).Body)
	if !strings.Contains(x, "<w:tbl>") || !strings.Contains(x, "Trả tiền hàng đợt 1") || !strings.Contains(x, "3.000.000") {
		t.Fatal("docx phiếu chi")
	}
}
