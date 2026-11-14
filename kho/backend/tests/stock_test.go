package tests

import (
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/shopspring/decimal"

	"kho/internal/reports"
)

type stockSummary struct {
	Warehouses []struct {
		ID   int64  `json:"id"`
		Code string `json:"code"`
	} `json:"warehouses"`
	Items []struct {
		ProductID   int64                      `json:"product_id"`
		Code        string                     `json:"code"`
		Name        string                     `json:"name"`
		GroupName   *string                    `json:"group_name"`
		ByWarehouse map[string]decimal.Decimal `json:"by_warehouse"`
		Total       decimal.Decimal            `json:"total"`
	} `json:"items"`
	Totals   map[string]decimal.Decimal `json:"totals_by_warehouse"`
	TotalQty decimal.Decimal            `json:"total_qty"`
}

// REQ: 009, 010, 076, 001
// Kịch bản đủ 4 kho: tồn từng kho và tồn tổng 4 kho đối chiếu khớp nhau.
func TestREQ009_010_076_TonTong4KhoVaTungKho(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sup := e.Partner("NCC01", "Công ty Kiswel Việt Nam", false, true)
	cus := e.Partner("KH01", "Cơ khí Tân Phú", true, false)
	a := e.Product("K701832", "Que hàn Kiswel K7018-3.2 (20kg)", "Thùng", 1090000, 950000, 0)
	b := e.Product("CN249SS08", "Béc CO2 Sunshine 0.8 mm", "Cái", 13000, 9000, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "10", nil), Line(b, "100", nil))
	e.Opening("2026-01-01", e.WH["KHO2"], Line(a, "5", nil))
	e.Admin.Posted(DocBody("purchase", "2026-02-01", sup, e.WH["KHO3"], Line(a, "7", "950000"), Line(b, "40", "9000")))
	e.Admin.Posted(DocBody("purchase", "2026-02-02", sup, e.WH["KHO4"], Line(a, "3", "950000")))
	e.Admin.Posted(DocBody("sale", "2026-03-01", cus, e.WH["KHO1"], Line(a, "4", "1090000"), Line(b, "25", "13000")))
	e.Admin.Posted(DocBody("sale", "2026-03-02", cus, e.WH["KHO3"], Line(a, "2", "1090000")))

	var r stockSummary
	e.Admin.OK("GET", "/api/reports/stock-summary?as_of=2026-12-31", nil, &r)
	if len(r.Warehouses) != 4 {
		t.Fatalf("báo cáo phải có 4 kho, có %d", len(r.Warehouses))
	}
	id := func(code string) string { return strconv.FormatInt(e.WH[code], 10) }
	want := map[string]map[string]string{
		"K701832":   {"KHO1": "6", "KHO2": "5", "KHO3": "5", "KHO4": "3", "total": "19"},
		"CN249SS08": {"KHO1": "75", "KHO2": "0", "KHO3": "40", "KHO4": "0", "total": "115"},
	}
	found := 0
	for _, it := range r.Items {
		w, ok := want[it.Code]
		if !ok {
			continue
		}
		found++
		sum := decimal.Zero
		for _, k := range []string{"KHO1", "KHO2", "KHO3", "KHO4"} {
			eqDec(t, it.ByWarehouse[id(k)], w[k], it.Code+" tồn "+k)
			sum = sum.Add(it.ByWarehouse[id(k)])
		}
		eqDec(t, it.Total, w["total"], it.Code+" tồn tổng")
		if !sum.Equal(it.Total) {
			t.Fatalf("%s: tổng các kho %s ≠ tồn tổng %s", it.Code, sum, it.Total)
		}
	}
	if found != 2 {
		t.Fatalf("thiếu mã hàng trong báo cáo tồn: %+v", r.Items)
	}
	// Mã DV (dịch vụ) không có trong báo cáo tồn.
	for _, it := range r.Items {
		if it.Code == "DV" {
			t.Fatal("mã dịch vụ không được xuất hiện trong báo cáo tồn")
		}
	}
	// Lọc một kho (REQ-010).
	var r3 stockSummary
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-summary?warehouse_id=%d&as_of=2026-12-31", e.WH["KHO3"]), nil, &r3)
	if len(r3.Warehouses) != 1 || len(r3.Items) != 2 {
		t.Fatalf("lọc KHO3: %+v", r3)
	}
	for _, it := range r3.Items {
		if it.Code == "K701832" {
			eqDec(t, it.Total, "5", "KHO3 K701832")
		}
	}
	// price-info cũng trả tồn từng kho + tồn tổng.
	total, by := e.TotalStock(a)
	eqDec(t, total, "19", "price-info tồn tổng")
	eqDec(t, by["KHO4"], "3", "price-info KHO4")
	// Tồn tại ngày quá khứ (as_of).
	var past stockSummary
	e.Admin.OK("GET", "/api/reports/stock-summary?as_of=2026-01-31", nil, &past)
	for _, it := range past.Items {
		if it.Code == "K701832" {
			eqDec(t, it.Total, "15", "tồn tổng đến 31/01")
		}
	}
}

// REQ: 011, 077, 001
// Chuyển kho nội bộ: kho nguồn giảm, kho nhận tăng, tổng tồn không đổi, không ảnh hưởng công nợ.
func TestREQ011_077_ChuyenKhoNoiBo(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	p := e.Product("WW829HT107k", "Dây hàn lõi thuốc 1.2mm", "Cuộn", 500000, 400000, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "27", nil))
	before, _ := e.TotalStock(p)

	tr := e.Admin.CreateDoc(map[string]any{"doc_type": "transfer", "doc_date": "2026-02-10", "warehouse_id": e.WH["KHO1"], "to_warehouse_id": e.WH["KHO3"],
		"note": "Chuyển cho chi nhánh", "lines": []any{Line(p, "10", nil)}})
	if tr.Status != "draft" {
		t.Fatalf("phiếu chuyển kho mới tạo phải là phiếu tạm")
	}
	// Phiếu tạm chưa làm thay đổi tồn.
	_, by := e.TotalStock(p)
	eqDec(t, by["KHO1"], "27", "KHO1 trước ghi sổ")
	tr = e.Admin.PostDoc(tr)
	if tr.DocNo == nil || !strings.HasPrefix(*tr.DocNo, "CK") {
		t.Fatalf("số phiếu chuyển kho phải bắt đầu bằng CK: %v", tr.DocNo)
	}
	total, by := e.TotalStock(p)
	eqDec(t, by["KHO1"], "17", "kho nguồn giảm")
	eqDec(t, by["KHO3"], "10", "kho nhận tăng")
	if !total.Equal(before) {
		t.Fatalf("tổng tồn phải không đổi: trước %s sau %s", before, total)
	}
	// Thẻ kho từng kho thể hiện dòng chuyển kho; xem tất cả kho thì ẩn.
	var l1, lall reports.Ledger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d&warehouse_id=%d", p, e.WH["KHO1"]), nil, &l1)
	if len(l1.Rows) != 2 || !l1.Rows[1].QtyOut.Equal(d("10")) || !strings.Contains(l1.Rows[1].Description, "Chuyển kho Kho 1 → Kho 3") {
		t.Fatalf("thẻ kho KHO1 phải có dòng chuyển kho xuất 10: %+v", l1.Rows)
	}
	var l3 reports.Ledger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d&warehouse_id=%d", p, e.WH["KHO3"]), nil, &l3)
	if len(l3.Rows) != 1 || !l3.Rows[0].QtyIn.Equal(d("10")) || !l3.Closing.Equal(d("10")) {
		t.Fatalf("thẻ kho KHO3 phải có dòng nhận 10: %+v", l3.Rows)
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d", p), nil, &lall)
	for _, r := range lall.Rows {
		if r.DocType == "transfer" {
			t.Fatal("xem tất cả kho phải ẩn dòng chuyển kho")
		}
	}
	eqDec(t, lall.Closing, "27", "tồn tất cả kho")
	// Không chuyển quá tồn kho nguồn.
	tr2 := e.Admin.CreateDoc(map[string]any{"doc_type": "transfer", "doc_date": "2026-02-11", "warehouse_id": e.WH["KHO3"], "to_warehouse_id": e.WH["KHO2"], "lines": []any{Line(p, "11", nil)}})
	e.Admin.Expect(422, "INSUFFICIENT_STOCK", "POST", fmt.Sprintf("/api/documents/%d/post", tr2.ID), map[string]any{"version": tr2.Version})
	// Kho nhận phải khác kho xuất.
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", map[string]any{"doc_type": "transfer", "doc_date": "2026-02-11", "warehouse_id": e.WH["KHO1"], "to_warehouse_id": e.WH["KHO1"], "lines": []any{Line(p, "1", nil)}})
	// Chuyển kho không ảnh hưởng công nợ (không có đối tác).
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", map[string]any{"doc_type": "transfer", "doc_date": "2026-02-11", "warehouse_id": e.WH["KHO1"], "to_warehouse_id": e.WH["KHO2"], "partner_id": e.Partner("KH9", "Khách X", true, false), "lines": []any{Line(p, "1", nil)}})
}

// setupLedgerExample dựng đúng ví dụ thẻ kho trong file yêu cầu của khách.
func setupLedgerExample(e *Env) (product int64, docsNo []string) {
	p := e.Product("WW829HT107k", "Dây hàn WW829 HT 1.07kg", "Cuộn", 500000, 300000, 0)
	vinhPhong := e.Partner("VP", "CTY TNHH TM DV VĨNH PHONG", true, false)
	ngocMinh := e.Partner("NM", "CHÚ NGỌC MINH", true, false)
	phamGia := e.Partner("PG", "CÔNG TY TNHH NHỰA PHẠM GIA - Phường Bình Hưng Hòa B", true, false)
	e.Opening("2026-03-15", e.WH["KHO1"], Line(p, "27", nil))
	x1 := e.Admin.Posted(DocBody("sale", "2026-04-03", vinhPhong, e.WH["KHO1"], Line(p, "4", "500000")))
	x2 := e.Admin.Posted(DocBody("sale", "2026-04-14", vinhPhong, e.WH["KHO1"], Line(p, "3", "500000")))
	n1 := e.Admin.Posted(DocBody("sale_return", "2026-04-17", ngocMinh, e.WH["KHO1"], Line(p, "1", "500000")))
	x3 := e.Admin.Posted(DocBody("sale", "2026-05-26", phamGia, e.WH["KHO1"], Line(p, "1", "500000")))
	return p, []string{*x1.DocNo, *x2.DocNo, *n1.DocNo, *x3.DocNo}
}

// REQ: 012, 013, 014, 015, 017, 018, 078, 002
// Đúng ví dụ thẻ kho của khách: WW829HT107k tồn đầu 27, bán 4 và 3 cho VĨNH PHONG, CHÚ NGỌC MINH trả 1,
// bán 1 cho NHỰA PHẠM GIA ⇒ tồn 23, 20, 21, 20; cộng nhập 1, xuất 8, tồn 20; diễn giải có tên đối tượng.
func TestREQ012_078_TheKhoViDuKhachHang(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	p, nos := setupLedgerExample(e)
	var l reports.Ledger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d&from=2026-04-01&to=2026-05-31", p), nil, &l)
	eqDec(t, l.Opening, "27", "Số dư đầu kỳ")
	if l.Product.Code != "WW829HT107k" || l.Product.Unit != "Cuộn" {
		t.Fatalf("thông tin mã hàng sai: %+v", l.Product)
	}
	if len(l.Rows) != 4 {
		t.Fatalf("phải có 4 dòng, có %d: %+v", len(l.Rows), l.Rows)
	}
	type exp struct {
		date, no, desc, in, out, bal, typ string
	}
	want := []exp{
		{"2026-04-03", nos[0], "Xuất kho bán hàng CTY TNHH TM DV VĨNH PHONG", "0", "4", "23", "sale"},
		{"2026-04-14", nos[1], "Xuất kho bán hàng CTY TNHH TM DV VĨNH PHONG", "0", "3", "20", "sale"},
		{"2026-04-17", nos[2], "CHÚ NGỌC MINH - trả hàng", "1", "0", "21", "sale_return"},
		{"2026-05-26", nos[3], "Xuất kho bán hàng CÔNG TY TNHH NHỰA PHẠM GIA - Phường Bình Hưng Hòa B", "0", "1", "20", "sale"},
	}
	for i, w := range want {
		r := l.Rows[i]
		if r.Date.String() != w.date || r.DocNo != w.no || r.Description != w.desc || r.DocType != w.typ {
			t.Fatalf("dòng %d: muốn %+v, nhận %+v", i+1, w, r)
		}
		eqDec(t, r.QtyIn, w.in, fmt.Sprintf("dòng %d nhập", i+1))
		eqDec(t, r.QtyOut, w.out, fmt.Sprintf("dòng %d xuất", i+1))
		eqDec(t, r.Balance, w.bal, fmt.Sprintf("dòng %d tồn", i+1))
		if r.Unit != "Cuộn" || r.ProductCode != "WW829HT107k" {
			t.Fatalf("dòng %d: ĐVT/mã sai %+v", i+1, r)
		}
		if r.PartnerName == nil || !strings.Contains(r.Description, *r.PartnerName) {
			t.Fatalf("dòng %d: diễn giải phải có tên đối tượng: %+v", i+1, r)
		}
		if r.DocumentID == 0 {
			t.Fatalf("dòng %d thiếu document_id để mở chi tiết", i+1)
		}
	}
	eqDec(t, l.TotalIn, "1", "Cộng nhập")
	eqDec(t, l.TotalOut, "8", "Cộng xuất")
	eqDec(t, l.Closing, "20", "Tồn cuối")
	// Số chứng từ: bán XK, khách trả NK.
	if !strings.HasPrefix(nos[0], "XK") || !strings.HasPrefix(nos[2], "NK") {
		t.Fatalf("số chứng từ sai tiền tố: %v", nos)
	}
}

// REQ: 019, 012
// Lọc theo khoảng thời gian: số dư đầu kỳ tính từ trước kỳ, chỉ hiện giao dịch trong kỳ.
func TestREQ019_LocThoiGianTheKho(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	p, nos := setupLedgerExample(e)
	var l reports.Ledger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d&from=2026-04-15&to=2026-04-30", p), nil, &l)
	eqDec(t, l.Opening, "20", "đầu kỳ 15/04")
	if len(l.Rows) != 1 || l.Rows[0].DocNo != nos[2] {
		t.Fatalf("kỳ 15–30/04 chỉ có phiếu trả hàng: %+v", l.Rows)
	}
	eqDec(t, l.Closing, "21", "cuối kỳ 30/04")
	// Không lọc: thấy cả dòng nhập tồn đầu kỳ, thời gian dài.
	var all reports.Ledger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d", p), nil, &all)
	if len(all.Rows) != 5 || all.Rows[0].Description != "Nhập tồn đầu kỳ" {
		t.Fatalf("toàn bộ lịch sử phải có 5 dòng bắt đầu bằng tồn đầu kỳ: %+v", all.Rows)
	}
	eqDec(t, all.Opening, "0", "đầu kỳ khi không lọc")
	eqDec(t, all.Closing, "20", "cuối kỳ")
	// Ngày kết thúc trước ngày bắt đầu ⇒ lỗi nhập liệu, không phải 500.
	e.Admin.Expect(400, "VALIDATION", "GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d&from=2026-05-01&to=2026-04-01", p), nil)
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/reports/stock-ledger?product_id=abc", nil)
	e.Admin.Expect(404, "NOT_FOUND", "GET", "/api/reports/stock-ledger?product_id=999999", nil)
}

// REQ: 016, 002
// Dòng nhập mua thể hiện nhà cung cấp; trả hàng NCC thể hiện NCC; ghi chú phiếu được nối vào diễn giải.
func TestREQ016_NhapMuaCuaAi(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	p := e.Product("CN249SS10", "Béc CO2 Sunshine 1.0 mm", "Cái", 13000, 9000, 0)
	sup := e.Partner("SUN", "CÔNG TY SUNSHINE WELDING", false, true)
	body := DocBody("purchase", "2026-02-01", sup, e.WH["KHO2"], Line(p, "200", "9000"))
	body["note"] = "Hóa đơn 0001234"
	e.Admin.Posted(body)
	e.Admin.Posted(DocBody("purchase_return", "2026-02-05", sup, e.WH["KHO2"], Line(p, "20", "9000")))
	var l reports.Ledger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d", p), nil, &l)
	if l.Rows[0].Description != "Nhập kho mua hàng CÔNG TY SUNSHINE WELDING - Hóa đơn 0001234" {
		t.Fatalf("diễn giải nhập mua sai: %q", l.Rows[0].Description)
	}
	if l.Rows[1].Description != "Trả hàng CÔNG TY SUNSHINE WELDING" || !l.Rows[1].QtyOut.Equal(d("20")) {
		t.Fatalf("diễn giải trả NCC sai: %+v", l.Rows[1])
	}
	eqDec(t, l.Closing, "180", "tồn")
}

// REQ: 020
// Xem tồn nhiều mặt hàng cùng nhóm VTHH.
func TestREQ020_TonTheoNhomVTHH(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	qh := e.Group("QH", "Que hàn")
	bec := e.Group("BEC", "Béc hàn")
	a := e.Product("K701832", "Que hàn Kiswel K7018-3.2", "Thùng", 1090000, 950000, qh)
	b := e.Product("KT4226", "Que hàn Kim Tín KT-421 2.6", "Thùng", 700000, 600000, qh)
	c := e.Product("CN249SS08", "Béc CO2 0.8", "Cái", 13000, 9000, bec)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "3", nil), Line(b, "4", nil), Line(c, "50", nil))
	var r stockSummary
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-summary?group_id=%d", qh), nil, &r)
	if len(r.Items) != 2 {
		t.Fatalf("nhóm Que hàn phải có 2 mã: %+v", r.Items)
	}
	for _, it := range r.Items {
		if it.GroupName == nil || *it.GroupName != "Que hàn" {
			t.Fatalf("sai nhóm: %+v", it)
		}
	}
	eqDec(t, r.TotalQty, "7", "tổng tồn nhóm")
	// Danh sách mặt hàng lọc theo nhóm.
	var pl struct {
		Total int `json:"total"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products?group_id=%d", qh), nil, &pl)
	if pl.Total != 2 {
		t.Fatalf("lọc mặt hàng theo nhóm: %d", pl.Total)
	}
	// Tìm không dấu.
	var q stockSummary
	e.Admin.OK("GET", "/api/reports/stock-summary?q=que%20han", nil, &q)
	if len(q.Items) != 2 {
		t.Fatalf("tìm không dấu 'que han' phải ra 2 mã: %d", len(q.Items))
	}
}

// REQ: 021
// Lịch sử bán của từng mặt hàng.
func TestREQ021_LichSuBanTungMatHang(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	p, _ := setupLedgerExample(e)
	other := e.Product("OTHER", "Hàng khác", "Cái", 1000, 500, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(other, "5", nil))
	e.Admin.Posted(DocBody("sale", "2026-04-20", e.Partner("K2", "Khách lẻ", true, false), e.WH["KHO1"], Line(other, "1", "1000")))
	var r reports.Trade
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/sales?product_id=%d&from=2026-01-01&to=2026-12-31", p), nil, &r)
	if len(r.Rows) != 3 {
		t.Fatalf("mã WW829HT107k có 3 lần bán: %+v", r.Rows)
	}
	names := []string{}
	for _, x := range r.Rows {
		if x.ProductID != p {
			t.Fatalf("lẫn mã khác: %+v", x)
		}
		names = append(names, *x.PartnerName)
	}
	if names[0] != "CTY TNHH TM DV VĨNH PHONG" || !strings.Contains(names[2], "NHỰA PHẠM GIA") {
		t.Fatalf("lịch sử bán phải hiện khách: %v", names)
	}
	eqDec(t, r.TotalQty, "8", "tổng SL bán")
	eqDec(t, r.TotalAmount, "4000000", "tổng tiền bán")
	// Danh sách chứng từ lọc theo mặt hàng cũng tra được.
	var dl struct {
		Total int `json:"total"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/documents?type=sale&status=posted&product_id=%d", p), nil, &dl)
	if dl.Total != 3 {
		t.Fatalf("danh sách phiếu bán có mã này: %d", dl.Total)
	}
}

// REQ: 064
// Báo cáo tổng hợp NXT: tồn đầu, nhập, xuất, tồn cuối từng mã; chuyển kho chỉ tính khi xem từng kho.
func TestREQ064_BaoCaoNXT(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	p, _ := setupLedgerExample(e)
	e.Admin.Posted(map[string]any{"doc_type": "transfer", "doc_date": "2026-04-20", "warehouse_id": e.WH["KHO1"], "to_warehouse_id": e.WH["KHO2"], "lines": []any{Line(p, "5", nil)}})
	var all reports.NXT
	e.Admin.OK("GET", "/api/reports/stock-nxt?from=2026-04-01&to=2026-05-31", nil, &all)
	if len(all.Items) != 1 {
		t.Fatalf("NXT: %+v", all.Items)
	}
	r := all.Items[0]
	eqDec(t, r.Opening, "27", "tồn đầu")
	eqDec(t, r.QtyIn, "1", "nhập (không tính chuyển kho)")
	eqDec(t, r.QtyOut, "8", "xuất (không tính chuyển kho)")
	eqDec(t, r.Closing, "20", "tồn cuối")
	var k1 reports.NXT
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-nxt?from=2026-04-01&to=2026-05-31&warehouse_id=%d", e.WH["KHO1"]), nil, &k1)
	eqDec(t, k1.Items[0].QtyOut, "13", "KHO1 xuất gồm chuyển kho")
	eqDec(t, k1.Items[0].Closing, "15", "KHO1 tồn cuối")
	var k2 reports.NXT
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-nxt?from=2026-04-01&to=2026-05-31&warehouse_id=%d", e.WH["KHO2"]), nil, &k2)
	eqDec(t, k2.Items[0].QtyIn, "5", "KHO2 nhập chuyển kho")
	eqDec(t, k2.Items[0].Opening, "0", "KHO2 tồn đầu")
}
