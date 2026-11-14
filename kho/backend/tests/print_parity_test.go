package tests

import (
	"fmt"
	"strings"
	"testing"
)

// F-02 — file Excel/Word phiếu thu/chi có dòng "Bằng chữ" (giống bản in), ô ký và nhãn như bản in.
// REQ: 085, 087, 056, 057
func TestREQ085_087_PhieuThuChiBangChu(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Anh Tuấn Đạt", true, false)
	pt := e.Voucher2(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": cus, "note": "Thu nợ",
		"lines": []any{map[string]any{"description": "Đợt 1", "amount": 8000000}, map[string]any{"description": "Đợt 2", "amount": 455000}}})
	rows := xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/vouchers/%d/export?format=xlsx", pt), nil, nil).Body)
	all := fmt.Sprint(rows)
	for _, want := range []string{"Bằng chữ: Tám triệu bốn trăm năm mươi lăm nghìn đồng", "Họ tên người nộp tiền: Anh Tuấn Đạt", "Lý do nộp: Thu nợ",
		"Kèm theo: ……… chứng từ gốc.", "Giám đốc", "Kế toán trưởng", "Người nộp tiền", "Người lập phiếu", "Thủ quỹ", "(Ký, họ tên)", "Ngày …… tháng …… năm ………"} {
		if !strings.Contains(all, want) {
			t.Fatalf("xlsx phiếu thu thiếu %q: %v", want, rows)
		}
	}
	if r := findRow(rows, 0, "Tổng số tiền"); r == nil || r[3] != "8455000" {
		t.Fatalf("dòng tổng: %q", r)
	}
	x := docxXML(t, e.Admin.OK("GET", fmt.Sprintf("/api/vouchers/%d/export?format=docx", pt), nil, nil).Body)
	if !strings.Contains(x, "Bằng chữ: Tám triệu bốn trăm năm mươi lăm nghìn đồng") {
		t.Fatal("docx phiếu thu thiếu Bằng chữ")
	}
	pc := e.Voucher2(map[string]any{"voucher_type": "payment", "account_id": e.NH, "lines": []any{map[string]any{"description": "Chi mua máy", "amount": 34000000}}})
	x = docxXML(t, e.Admin.OK("GET", fmt.Sprintf("/api/vouchers/%d/export?format=docx", pc), nil, nil).Body)
	for _, want := range []string{"GIẤY BÁO NỢ (CHI QUA NGÂN HÀNG)", "Bằng chữ: Ba mươi bốn triệu đồng", "Họ tên người nhận tiền: ……………………………………", "Lý do chi: Chi mua máy", "Người nhận tiền"} {
		if !strings.Contains(x, want) {
			t.Fatalf("docx phiếu chi thiếu %q", want)
		}
	}
}

// Voucher2 tạo phiếu thu/chi, trả id.
func (e *Env) Voucher2(body map[string]any) int64 {
	return e.Admin.Voucher(body).ID
}

// F-03 — file xuất chứng từ khớp bản in: mã DICHVU, nhãn kho theo loại phiếu, đối tác kèm mã, ô ký theo loại phiếu,
// phiếu chuyển kho không có cột giá, diễn giải dòng thay tên hàng.
// REQ: 047, 073, 071, 072, 011
func TestREQ047_073_FileXuatKhopBanIn(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("THANHCONG", "Xưởng cơ khí Thành Công", true, false)
	sup := e.Partner("KSW", "Kiswel", false, true)
	p := e.Product("K701832", "Que hàn Kiswel K7018-3.2", "Thùng", 1090000, 950000, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "20", nil))
	ln := Line(p, "1", "1090000")
	ln["description"] = "Que hàn K7018 hàng mới"
	s := e.Admin.Posted(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], ln, map[string]any{"product_code": "DV", "description": "PHÍ SỬA XE", "unit_price": 400000}))
	type exp struct {
		id      int64
		wants   []string
		signers []string
	}
	pur := e.Admin.Posted(DocBody("purchase", "2026-02-02", sup, e.WH["KHO2"], Line(p, "3", "950000")))
	tr := e.Admin.Posted(map[string]any{"doc_type": "transfer", "doc_date": "2026-02-03", "warehouse_id": e.WH["KHO1"], "to_warehouse_id": e.WH["KHO3"], "lines": []any{Line(p, "2", nil), Line(p, "1.5", nil)}})
	ret := e.Admin.Posted(DocBody("sale_return", "2026-02-04", cus, e.WH["KHO1"], Line(p, "1", "1090000")))
	dr := e.Admin.CreateDoc(DocBody("sale", "2026-02-05", cus, e.WH["KHO1"], Line(p, "1", nil)))
	cases := []exp{
		{s.ID, []string{"Số: " + *s.DocNo, "Khách hàng: Xưởng cơ khí Thành Công (THANHCONG)", "Xuất từ kho: Kho 1", "DICHVU", "PHÍ SỬA XE", "Que hàn K7018 hàng mới", "Nợ cũ:", "Ghi sổ bởi Quản trị"},
			[]string{"Người lập phiếu", "Người giao hàng", "Khách hàng", "Thủ kho"}},
		{pur.ID, []string{"Nhà cung cấp: Kiswel (KSW)", "Nhập vào kho: Kho 2", "Tổng nợ (đến ngày 02/02/2026):"}, []string{"Người lập phiếu", "Người giao hàng", "Thủ kho"}},
		{tr.ID, []string{"Kho xuất: Kho 1 → Kho nhận: Kho 3"}, []string{"Người lập phiếu", "Thủ kho xuất", "Thủ kho nhận"}},
		{ret.ID, []string{"Nhập vào kho: Kho 1"}, []string{"Người lập phiếu", "Khách hàng", "Thủ kho"}},
		{dr.ID, []string{"PHIẾU TẠM (chưa ghi sổ)", "Phiếu bán hàng — chưa ghi sổ, chưa trừ/cộng kho, chưa vào công nợ", "Số: " + dr.DraftNo, "Phiếu tạm"},
			[]string{"Người lập phiếu", "Người giao hàng", "Khách hàng", "Thủ kho"}},
	}
	for _, c := range cases {
		rows := xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", c.id), nil, nil).Body)
		all := fmt.Sprint(rows)
		for _, w := range c.wants {
			if !strings.Contains(all, w) {
				t.Fatalf("phiếu %d xlsx thiếu %q: %v", c.id, w, rows)
			}
		}
		sig := findRow(rows, 0, "Người lập phiếu")
		var got []string
		for _, v := range sig {
			if v != "" {
				got = append(got, v)
			}
		}
		if strings.Join(got, "|") != strings.Join(c.signers, "|") {
			t.Fatalf("phiếu %d ô ký xlsx: %q, muốn %q", c.id, got, c.signers)
		}
		x := docxXML(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=docx", c.id), nil, nil).Body)
		for _, w := range append(c.wants, c.signers...) {
			if !strings.Contains(x, w) {
				t.Fatalf("phiếu %d docx thiếu %q", c.id, w)
			}
		}
	}
	// Mã DV không xuất hiện ở cột mã hàng; phiếu chuyển kho không có cột giá, dòng Cộng là tổng SL.
	rows := xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", s.ID), nil, nil).Body)
	if findRow(rows, 1, "DV") != nil {
		t.Fatal("dòng dịch vụ phải ghi DICHVU")
	}
	rows = xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", tr.ID), nil, nil).Body)
	if h := findRow(rows, 0, "STT"); strings.Join(h, "|") != "STT|Mã hàng|Tên hàng|ĐVT|Số lượng" {
		t.Fatalf("chuyển kho không có cột giá: %q", h)
	}
	if r := findRow(rows, 0, "Cộng"); r == nil || r[4] != "3.5" {
		t.Fatalf("Cộng SL chuyển kho: %q", r)
	}
}
