package tests

import (
	"fmt"
	"testing"

	"github.com/shopspring/decimal"
)

type partnerList struct {
	Items []struct {
		ID   int64  `json:"id"`
		Code string `json:"code"`
		Name string `json:"name"`
	} `json:"items"`
	Total int `json:"total"`
}

func (e *Env) partnerCodes(q string) []string {
	var l partnerList
	e.Admin.OK("GET", "/api/partners?page_size=50&q="+q, nil, &l)
	out := []string{}
	for _, it := range l.Items {
		out = append(out, it.Code)
	}
	return out
}

// F-07 — tìm đối tác: nhiều từ thứ tự bất kỳ, không dấu, bỏ dấu câu ("–"); xếp hạng trùng mã > tên bắt đầu bằng
// cụm từ > tên chứa cụm từ > đủ từ nguyên trong tên > mã bắt đầu > còn lại.
// REQ: 060, 061, 025, 052
func TestREQ060_TimDoiTacNhieuTuXepHang(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.Partner("TANTHANH", "Công ty TNHH Thép Tân Thành", true, true)
	e.Partner("THANHCONG", "Xưởng cơ khí Thành Công", true, false)
	e.Partner("XUONG2", "Xưởng Thành Công 2", true, false)
	e.Partner("ANBINH", "Công ty TNHH An Bình", true, false)
	e.Partner("HANVIET", "Thiết bị hàn Việt – Hàn", false, true)
	e.Partner("TC2", "Thành Công Group", true, false)
	e.Partner("KH01", "Nguyễn Văn Đông", true, false)
	e.Partner("XYZ", "Cơ sở Thanh Công Mỹ", true, false)
	got := e.partnerCodes("thanh%20cong")
	// THANHCONG trùng mã ("thanhcong"); TC2 tên bắt đầu bằng cụm từ; XYZ tên chứa cụm từ;
	// TANTHANH chỉ khớp rời ("công ty", "thành") nên đứng cuối.
	want := []string{"THANHCONG", "TC2", "XYZ", "XUONG2", "TANTHANH"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("thanh cong: %v, muốn %v", got, want)
	}
	if g := e.partnerCodes("viet%20han"); fmt.Sprint(g) != "[HANVIET]" {
		t.Fatalf("viet han: %v", g)
	}
	if g := e.partnerCodes("han%20viet"); fmt.Sprint(g) != "[HANVIET]" {
		t.Fatalf("thứ tự bất kỳ: %v", g)
	}
	if g := e.partnerCodes("vi%E1%BB%87t%20%E2%80%93%20h%C3%A0n"); fmt.Sprint(g) != "[HANVIET]" { // "việt – hàn"
		t.Fatalf("có dấu và gạch ngang: %v", g)
	}
	if g := e.partnerCodes("an%20binh%20xyz"); len(g) != 0 {
		t.Fatalf("mọi từ phải có mặt: %v", g)
	}
	// Trùng mã đứng đầu dù tên khớp ở đối tác khác.
	e.Partner("AN", "Cửa hàng Bình An", true, false)
	if g := e.partnerCodes("an"); len(g) == 0 || g[0] != "AN" {
		t.Fatalf("trùng mã phải đứng đầu: %v", g)
	}
	// Mã + tên trộn: "kh01 dong".
	if g := e.partnerCodes("kh01%20dong"); fmt.Sprint(g) != "[KH01]" {
		t.Fatalf("mã + tên: %v", g)
	}
	// Mã bắt đầu đứng trên khớp một phần.
	if g := e.partnerCodes("tanth"); fmt.Sprint(g) != "[TANTHANH]" {
		t.Fatalf("tiền tố mã: %v", g)
	}
	// Dấu câu thuần ⇒ không lọc; type vẫn lọc.
	var l partnerList
	e.Admin.OK("GET", "/api/partners?q=%E2%80%93&type=supplier", nil, &l)
	if l.Total != 2 {
		t.Fatalf("q chỉ có dấu câu: %d", l.Total)
	}
	// Danh sách phiếu thu chi / chứng từ / tổng hợp công nợ cũng tìm đối tác theo từ.
	var hvID int64
	e.Admin.OK("GET", "/api/partners?q=HANVIET", nil, &l)
	hvID = l.Items[0].ID
	e.Admin.Voucher(map[string]any{"voucher_type": "payment", "account_id": e.TM, "partner_id": hvID, "lines": []any{map[string]any{"amount": 1000}}})
	var vl struct {
		Total int `json:"total"`
	}
	e.Admin.OK("GET", "/api/vouchers?q=han%20viet", nil, &vl)
	if vl.Total != 1 {
		t.Fatalf("tìm phiếu theo đối tác nhiều từ: %d", vl.Total)
	}
	var ds struct {
		Items []struct {
			PartnerCode string `json:"partner_code"`
		} `json:"items"`
	}
	e.Admin.OK("GET", "/api/reports/debt-summary?side=payable&q=viet%20han", nil, &ds)
	if len(ds.Items) != 1 || ds.Items[0].PartnerCode != "HANVIET" {
		t.Fatalf("tổng hợp công nợ tìm đối tác: %+v", ds.Items)
	}
}

// Số dư một đối tác (phải thu, phải trả) tại một ngày, có thể loại trừ một chứng từ / phiếu ("nợ trước phiếu này").
// REQ: 052, 054, 034
func TestREQ052_SoDuMotDoiTac(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	var both struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": "HAI", "name": "Hai vai", "is_customer": true, "is_supplier": true, "opening_receivable": 1000, "opening_payable": 500}, &both)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "100", nil))
	s1 := e.Admin.Posted(DocBody("sale", "2026-02-01", both.ID, e.WH["KHO1"], Line(p, "10", "100")))
	s2 := e.Admin.Posted(DocBody("sale", "2026-03-01", both.ID, e.WH["KHO1"], Line(p, "5", "100")))
	e.Admin.Posted(DocBody("purchase", "2026-02-15", both.ID, e.WH["KHO1"], Line(p, "4", "50")))
	v := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "voucher_date": "2026-03-10", "account_id": e.TM, "partner_id": both.ID, "lines": []any{map[string]any{"amount": 300}}})
	type bal struct {
		Receivable decimal.Decimal `json:"receivable"`
		Payable    decimal.Decimal `json:"payable"`
	}
	get := func(qs string) bal {
		var b bal
		e.Admin.OK("GET", fmt.Sprintf("/api/partners/%d/balance%s", both.ID, qs), nil, &b)
		return b
	}
	b := get("")
	eqDec(t, b.Receivable, "2200", "phải thu = 1.000 + 1.000 + 500 − 300")
	eqDec(t, b.Payable, "700", "phải trả = 500 + 200")
	if !b.Receivable.Equal(e.Debt("receivable", both.ID)) {
		t.Fatal("khớp sổ chi tiết")
	}
	eqDec(t, get("?date=2026-02-20").Receivable, "2000", "đến 20/02")
	eqDec(t, get("?date=2026-02-10").Payable, "500", "phải trả trước phiếu mua")
	eqDec(t, get(fmt.Sprintf("?date=2026-03-01&exclude_document_id=%d", s2.ID)).Receivable, "2000", "nợ trước phiếu s2")
	g2 := e.Admin.GetDoc(s2.ID)
	eqDec(t, *g2.OldDebt, "2000", "khớp old_debt của phiếu")
	eqDec(t, get(fmt.Sprintf("?exclude_voucher_id=%d", v.ID)).Receivable, "2500", "loại trừ phiếu thu")
	eqDec(t, get(fmt.Sprintf("?exclude_document_id=%d", s1.ID)).Receivable, "1200", "loại trừ phiếu s1")
	e.Admin.Expect(404, "NOT_FOUND", "GET", "/api/partners/999999/balance", nil)
	e.Admin.Expect(400, "VALIDATION", "GET", fmt.Sprintf("/api/partners/%d/balance?date=abc", both.ID), nil)
	e.Admin.Expect(400, "VALIDATION", "GET", fmt.Sprintf("/api/partners/%d/balance?exclude_document_id=x", both.ID), nil)
}
