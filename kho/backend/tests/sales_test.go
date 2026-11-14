package tests

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/shopspring/decimal"

	"kho/internal/docs"
	"kho/internal/reports"
	"kho/internal/stock"
)

// REQ: 023, 024
// Phiếu nhập mua nhiều mặt hàng gắn NCC; ghi sổ mới tăng tồn và phát sinh phải trả.
func TestREQ023_024_PhieuNhapMuaVaGhiSo(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sup := e.Partner("KSW", "Công ty Kiswel", false, true)
	a := e.Product("K701832", "Que hàn Kiswel K7018-3.2 (20kg)", "Thùng", 1090000, 950000, 0)
	b := e.Product("K601326", "Que hàn Kiswel K6013-2.6", "Thùng", 800000, 650000, 0)
	doc := e.Admin.CreateDoc(DocBody("purchase", "2026-01-15", sup, e.WH["KHO1"], Line(a, "10", "950000"), Line(b, "5.5", "650000")))
	if doc.Status != "draft" || !strings.HasPrefix(doc.DraftNo, "TAM") || doc.DocNo != nil {
		t.Fatalf("phiếu mới phải là phiếu tạm số TAM...: %+v", doc)
	}
	if len(doc.Lines) != 2 || *doc.PartnerName != "Công ty Kiswel" {
		t.Fatalf("phiếu phải có 2 dòng và NCC: %+v", doc)
	}
	eqDec(t, doc.TotalAmount, "13075000", "tổng tiền (10×950.000 + 5,5×650.000)")
	total, _ := e.TotalStock(a)
	eqDec(t, total, "0", "phiếu tạm chưa tăng tồn")
	eqDec(t, e.Debt("payable", sup), "0", "phiếu tạm chưa phát sinh công nợ")
	posted := e.Admin.PostDoc(doc)
	if posted.Status != "posted" || posted.DocNo == nil || *posted.DocNo != "NK00001" || posted.DisplayNo != "NK00001" {
		t.Fatalf("ghi sổ phải cấp số NK00001: %+v", posted)
	}
	if posted.PostedByName == nil || posted.PostedAt == nil {
		t.Fatal("thiếu người/thời điểm ghi sổ")
	}
	total, by := e.TotalStock(a)
	eqDec(t, total, "10", "tồn sau ghi sổ")
	eqDec(t, by["KHO1"], "10", "tồn KHO1")
	tb, _ := e.TotalStock(b)
	eqDec(t, tb, "5.5", "tồn số lẻ")
	eqDec(t, e.Debt("payable", sup), "13075000", "phải trả NCC")
	// Ghi sổ lần hai bị từ chối.
	e.Admin.Expect(400, "VALIDATION", "POST", fmt.Sprintf("/api/documents/%d/post", doc.ID), map[string]any{"version": posted.Version})
	// Mua phải gắn NCC; khách hàng thuần không được.
	cus := e.Partner("KH", "Khách thuần", true, false)
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("purchase", "2026-01-15", cus, e.WH["KHO1"], Line(a, "1", "1")))
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("purchase", "2026-01-15", 0, e.WH["KHO1"], Line(a, "1", "1")))
}

// REQ: 025, 026, 027, 033, 034
// Phiếu bán nhiều mặt hàng gắn khách; đơn giá mặc định theo danh mục, sửa được; ghi sổ trừ tồn, phát sinh công nợ.
func TestREQ025_026_027_033_034_PhieuBanHang(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH01", "Cơ khí Tân Phú", true, false)
	a := e.Product("A", "Mặt hàng A", "Cái", 6500, 4000, 0)
	b := e.Product("B", "Mặt hàng B", "Cái", 10000, 7000, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "100", nil), Line(b, "100", nil))
	// price-info trả giá bán mặc định để giao diện tự điền.
	var pi struct {
		SalePrice decimal.Decimal `json:"sale_price"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products/%d/price-info", a), nil, &pi)
	eqDec(t, pi.SalePrice, "6500", "giá bán mặc định")
	// Dòng không gửi đơn giá ⇒ tự lấy 6.500; dòng B gõ giá khác (cao hơn) ⇒ giữ giá gõ.
	doc := e.Admin.CreateDoc(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(a, "5", nil), Line(b, "3", "12000")))
	eqDec(t, *doc.Lines[0].UnitPrice, "6500", "đơn giá mặc định nhảy theo danh mục")
	eqDec(t, *doc.Lines[1].UnitPrice, "12000", "đơn giá kế toán gõ lại")
	eqDec(t, doc.TotalAmount, "68500", "tổng phiếu")
	// Sửa giá thấp hơn mặc định (vẫn trên giá mua) được phép.
	upd := map[string]any{"version": doc.Version, "doc_date": "2026-02-01", "partner_id": cus, "warehouse_id": e.WH["KHO1"],
		"lines": []any{Line(a, "5", "6000"), Line(b, "3", "12000")}}
	var doc2 docs.Document
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", doc.ID), upd, &doc2)
	eqDec(t, *doc2.Lines[0].UnitPrice, "6000", "giá thấp hơn mặc định")
	if len(doc2.Warnings) != 0 {
		t.Fatalf("6.000 > giá mua 4.000 nên không cảnh báo: %+v", doc2.Warnings)
	}
	posted := e.Admin.PostDoc(&doc2)
	if *posted.DocNo != "XK00001" {
		t.Fatalf("số phiếu bán: %v", *posted.DocNo)
	}
	ta, _ := e.TotalStock(a)
	eqDec(t, ta, "95", "tồn A sau bán")
	eqDec(t, e.Debt("receivable", cus), "66000", "công nợ khách = 5×6.000 + 3×12.000")
	// Bán phải gắn khách hàng.
	sup := e.Partner("NCC", "NCC thuần", false, true)
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("sale", "2026-02-01", sup, e.WH["KHO1"], Line(a, "1", nil)))
}

// REQ: 004, 028, 029, 080
// Cảnh báo bán lỗ: giá vốn = đơn giá nhập mua gần nhất (≤ ngày bán, mọi kho); không chặn nhưng phải xác nhận khi ghi sổ.
func TestREQ028_029_080_CanhBaoBanLo(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách A", true, false)
	sup := e.Partner("NCC", "NCC A", false, true)
	p := e.Product("SUNG200", "Súng hàn CO2 200A", "Bộ", 600000, 450000, 0)
	e.Admin.Posted(DocBody("purchase", "2026-03-01", sup, e.WH["KHO2"], Line(p, "5", "500000")))
	// Lần mua sau ngày bán không được tính cho phiếu bán trước đó.
	e.Admin.Posted(DocBody("purchase", "2026-03-20", sup, e.WH["KHO2"], Line(p, "5", "300000")))
	var pi struct {
		CostPrice  decimal.Decimal `json:"cost_price"`
		CostSource string          `json:"cost_source"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products/%d/price-info?date=2026-03-10", p), nil, &pi)
	eqDec(t, pi.CostPrice, "500000", "giá vốn tại 10/03 = giá mua gần nhất 500.000")
	if pi.CostSource != "last_purchase" {
		t.Fatalf("cost_source: %s", pi.CostSource)
	}
	doc := e.Admin.CreateDoc(DocBody("sale", "2026-03-10", cus, e.WH["KHO2"], Line(p, "1", "480000"), map[string]any{"product_id": e.DV, "description": "Phí giao hàng", "unit_price": -50000}))
	if len(doc.Warnings) != 1 || doc.Warnings[0].Type != "loss" || doc.Warnings[0].LineNo != 1 {
		t.Fatalf("phải có đúng 1 cảnh báo lỗ cho dòng 1 (dịch vụ không xét): %+v", doc.Warnings)
	}
	eqDec(t, doc.Warnings[0].CostPrice, "500000", "cost_price trong cảnh báo")
	eqDec(t, doc.Warnings[0].UnitPrice, "480000", "unit_price trong cảnh báo")
	// Kiểm tra trước khi ghi sổ.
	var chk docs.CheckResult
	e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/check", doc.ID), nil, &chk)
	if len(chk.LossLines) != 1 || len(chk.StockShortages) != 0 {
		t.Fatalf("check: %+v", chk)
	}
	// Ghi sổ không xác nhận ⇒ 409 LOSS_WARNING, dữ liệu không đổi.
	r := e.Admin.Expect(409, "LOSS_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", doc.ID), map[string]any{"version": doc.Version})
	var le struct {
		Error struct {
			Message string         `json:"message"`
			Details []docs.Warning `json:"details"`
		} `json:"error"`
	}
	r.JSON(t, &le)
	if len(le.Error.Details) != 1 || !strings.Contains(le.Error.Message, "lỗ") {
		t.Fatalf("chi tiết cảnh báo lỗ: %+v", le)
	}
	if e.Admin.GetDoc(doc.ID).Status != "draft" {
		t.Fatal("không xác nhận thì phiếu vẫn là phiếu tạm")
	}
	// Xác nhận ⇒ ghi sổ được.
	var posted docs.Document
	e.Admin.OK("POST", fmt.Sprintf("/api/documents/%d/post", doc.ID), map[string]any{"version": doc.Version, "confirm_loss": true}, &posted)
	if posted.Status != "posted" || len(posted.Warnings) != 1 {
		t.Fatalf("ghi sổ sau xác nhận: %+v", posted)
	}
	// Bán sau 20/03 ⇒ giá vốn = 300.000 ⇒ 480.000 không lỗ.
	d2 := e.Admin.CreateDoc(DocBody("sale", "2026-03-25", cus, e.WH["KHO2"], Line(p, "1", "480000")))
	if len(d2.Warnings) != 0 {
		t.Fatalf("sau lần mua 300.000 thì không lỗ: %+v", d2.Warnings)
	}
	// Chưa từng mua ⇒ dùng giá mua mặc định; = 0 thì không cảnh báo.
	q := e.Product("Q1", "Hàng chưa mua", "Cái", 100, 200, 0)
	z := e.Product("Q0", "Hàng chưa có giá mua", "Cái", 100, 0, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(q, "10", "0"), Line(z, "10", "0"))
	d3 := e.Admin.CreateDoc(DocBody("sale", "2026-03-25", cus, e.WH["KHO1"], Line(q, "1", nil), Line(z, "1", "1")))
	if len(d3.Warnings) != 1 || d3.Warnings[0].ProductCode != "Q1" || d3.Warnings[0].CostSource != "default" {
		t.Fatalf("giá mặc định: %+v", d3.Warnings)
	}
	// Sửa phiếu đã ghi sổ còn dòng lỗ cũng cần xác nhận.
	upd := map[string]any{"version": posted.Version, "doc_date": "2026-03-10", "partner_id": cus, "warehouse_id": e.WH["KHO2"], "lines": []any{Line(p, "1", "470000")}}
	e.Admin.Expect(409, "LOSS_WARNING", "PUT", fmt.Sprintf("/api/documents/%d", doc.ID), upd)
	upd["confirm_loss"] = true
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", doc.ID), upd, nil)
}

// REQ: 030, 031, 032, 041, 079, 005
// Hết tồn: phiếu tạm vẫn lập được (không giữ hàng), xuất được dưới tiêu đề "PHIẾU TẠM (chưa ghi sổ)",
// nhưng ghi sổ bị chặn ⇒ không có phiếu chính thức để in; nhập hàng về thì ghi sổ được.
func TestREQ030_031_032_079_HetTonChanGhiSoVaIn(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách B", true, false)
	sup := e.Partner("NCC", "NCC B", false, true)
	p := e.Product("COS10", "Đầu cos (khoen đồng) 10mm (50c/bao)", "Cái", 6000, 4000, 0)
	draft := e.Admin.CreateDoc(DocBody("sale", "2026-04-01", cus, e.WH["KHO1"], Line(p, "100", nil)))
	if draft.Status != "draft" {
		t.Fatal("phiếu tạm hàng chưa có tồn vẫn phải tạo được")
	}
	var chk docs.CheckResult
	e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/check", draft.ID), nil, &chk)
	if chk.CanPost || len(chk.StockShortages) != 1 {
		t.Fatalf("check phải báo thiếu hàng: %+v", chk)
	}
	sh := chk.StockShortages[0]
	if sh.ProductCode != "COS10" || sh.WarehouseCode != "KHO1" || !sh.Required.Equal(d("100")) || !sh.Shortage.Equal(d("100")) || !sh.Available.Equal(d("0")) {
		t.Fatalf("chi tiết thiếu hàng sai: %+v", sh)
	}
	// Ghi sổ bị chặn.
	r := e.Admin.Expect(422, "INSUFFICIENT_STOCK", "POST", fmt.Sprintf("/api/documents/%d/post", draft.ID), map[string]any{"version": draft.Version, "confirm_loss": true})
	var ie struct {
		Error struct {
			Message string           `json:"message"`
			Details []stock.Shortage `json:"details"`
		} `json:"error"`
	}
	r.JSON(t, &ie)
	if len(ie.Error.Details) != 1 || ie.Error.Details[0].ProductCode != "COS10" || !strings.Contains(ie.Error.Message, "thiếu 100") {
		t.Fatalf("lỗi thiếu hàng: %s", r.Body)
	}
	got := e.Admin.GetDoc(draft.ID)
	if got.Status != "draft" || got.DocNo != nil {
		t.Fatal("phiếu bị chặn phải giữ nguyên phiếu tạm, không cấp số")
	}
	// In/xuất phiếu khi chưa ghi sổ: chỉ là PHIẾU TẠM.
	title := xlsxCell(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", draft.ID), nil, nil).Body, "A1")
	if title != "PHIẾU TẠM (chưa ghi sổ)" {
		t.Fatalf("tiêu đề phiếu tạm: %q", title)
	}
	docx := docxXML(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=docx", draft.ID), nil, nil).Body)
	if !strings.Contains(docx, "PHIẾU TẠM (chưa ghi sổ)") || strings.Contains(docx, "PHIẾU XUẤT KHO BÁN HÀNG") {
		t.Fatal("docx phiếu tạm phải ghi PHIẾU TẠM (chưa ghi sổ)")
	}
	// Tồn = 0 sau khi bán hết cũng bị chặn.
	e.Admin.Posted(DocBody("purchase", "2026-03-30", sup, e.WH["KHO1"], Line(p, "60", "4000")))
	e.Admin.Expect(422, "INSUFFICIENT_STOCK", "POST", fmt.Sprintf("/api/documents/%d/post", draft.ID), map[string]any{"version": draft.Version})
	// Hàng ở kho khác không tính cho kho xuất.
	e.Admin.Posted(DocBody("purchase", "2026-03-30", sup, e.WH["KHO2"], Line(p, "40", "4000")))
	e.Admin.Expect(422, "INSUFFICIENT_STOCK", "POST", fmt.Sprintf("/api/documents/%d/post", draft.ID), map[string]any{"version": draft.Version})
	// Nhập đủ về KHO1 ⇒ ghi sổ được, in phiếu chính thức.
	e.Admin.Posted(DocBody("purchase", "2026-03-30", sup, e.WH["KHO1"], Line(p, "40", "4000")))
	posted := e.Admin.PostDoc(draft)
	if posted.Status != "posted" {
		t.Fatal("đủ hàng phải ghi sổ được")
	}
	title = xlsxCell(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", draft.ID), nil, nil).Body, "A1")
	if title != "PHIẾU XUẤT KHO BÁN HÀNG" {
		t.Fatalf("tiêu đề phiếu chính thức: %q", title)
	}
	_, by := e.TotalStock(p)
	eqDec(t, by["KHO1"], "0", "KHO1 về 0")
	// Thêm một phiếu bán nữa khi KHO1 = 0 ⇒ chặn.
	d2 := e.Admin.CreateDoc(DocBody("sale", "2026-04-03", cus, e.WH["KHO1"], Line(p, "1", nil)))
	e.Admin.Expect(422, "INSUFFICIENT_STOCK", "POST", fmt.Sprintf("/api/documents/%d/post", d2.ID), map[string]any{"version": d2.Version})
	// Gộp SL các dòng cùng mã trong một phiếu trước khi so (KHO2 có 40: 25 + 20 = 45 > 40).
	d3 := e.Admin.CreateDoc(DocBody("sale", "2026-04-03", cus, e.WH["KHO2"], Line(p, "25", nil), Line(p, "20", nil)))
	r = e.Admin.Expect(422, "INSUFFICIENT_STOCK", "POST", fmt.Sprintf("/api/documents/%d/post", d3.ID), map[string]any{"version": d3.Version})
	r.JSON(t, &ie)
	if !ie.Error.Details[0].Required.Equal(d("45")) || !ie.Error.Details[0].Shortage.Equal(d("5")) {
		t.Fatalf("phải gộp 2 dòng cùng mã: %+v", ie.Error.Details)
	}
}

// REQ: 035, 036, 037, 038, 039, 081, 003
// Đúng ví dụ của khách: tháng 1 mua nhiều mặt hàng, tháng 9 mới bán và phát hiện nhập sai ⇒ mở lại phiếu cũ
// sửa SL/đơn giá; tồn kho, công nợ, báo cáo tự cập nhật; số chứng từ không đổi; có lịch sử sửa.
func TestREQ035_039_081_SuaPhieuNhapThang1VaoThang9(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sup := e.Partner("KSW", "Công ty Kiswel", false, true)
	cus := e.Partner("TP", "Cơ khí Tân Phú", true, false)
	a := e.Product("K701832", "Que hàn Kiswel K7018-3.2", "Thùng", 15000, 10000, 0)
	b := e.Product("K601326", "Que hàn Kiswel K6013-2.6", "Thùng", 30000, 20000, 0)
	pur := e.Admin.Posted(DocBody("purchase", "2026-01-15", sup, e.WH["KHO1"], Line(a, "100", "10000"), Line(b, "50", "20000")))
	e.Admin.Posted(DocBody("purchase", "2026-02-15", sup, e.WH["KHO1"], Line(b, "1", "20000")))
	sale := e.Admin.Posted(DocBody("sale", "2026-09-10", cus, e.WH["KHO1"], Line(a, "30", "15000")))
	eqDec(t, e.Debt("payable", sup), "2020000", "phải trả trước khi sửa")

	// Tháng 9: tìm phiếu nhập tháng 1 (REQ-035).
	var list struct {
		Items []docs.Summary `json:"items"`
		Total int            `json:"total"`
	}
	e.Admin.OK("GET", "/api/documents?type=purchase&status=posted&from=2026-01-01&to=2026-01-31&q=kiswel", nil, &list)
	if list.Total != 1 || list.Items[0].ID != pur.ID {
		t.Fatalf("tìm phiếu nhập tháng 1: %+v", list)
	}
	old := e.Admin.GetDoc(list.Items[0].ID)
	// Sửa SL A 100 → 80, đơn giá B 20.000 → 22.000, thêm ghi chú (REQ-036).
	upd := map[string]any{"version": old.Version, "doc_date": "2026-01-15", "partner_id": sup, "warehouse_id": e.WH["KHO1"], "note": "Sửa lại theo hóa đơn",
		"lines": []any{Line(a, "80", "10000"), Line(b, "50", "22000")}}
	var edited docs.Document
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", pur.ID), upd, &edited)
	if *edited.DocNo != *pur.DocNo || edited.Status != "posted" || edited.Version != old.Version+1 {
		t.Fatalf("số chứng từ không đổi, vẫn đã ghi sổ, version tăng: %+v", edited)
	}
	// Tồn kho, công nợ, báo cáo cập nhật (REQ-039).
	ta, _ := e.TotalStock(a)
	eqDec(t, ta, "50", "tồn A = 80 − 30")
	eqDec(t, e.Debt("payable", sup), "1920000", "phải trả = 80×10.000 + 50×22.000 + 20.000")
	var l reports.Ledger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d", a), nil, &l)
	if !l.Rows[0].QtyIn.Equal(d("80")) || !strings.HasSuffix(l.Rows[0].Description, " - Sửa lại theo hóa đơn") || !l.Rows[1].Balance.Equal(d("50")) {
		t.Fatalf("thẻ kho sau sửa: %+v", l.Rows)
	}
	var pr reports.Trade
	e.Admin.OK("GET", "/api/reports/purchases?from=2026-01-01&to=2026-12-31", nil, &pr)
	eqDec(t, pr.TotalAmount, "1920000", "báo cáo mua hàng sau sửa")
	var nxt reports.NXT
	e.Admin.OK("GET", "/api/reports/stock-nxt?from=2026-01-01&to=2026-12-31&q=K701832", nil, &nxt)
	eqDec(t, nxt.Items[0].QtyIn, "80", "NXT nhập sau sửa")
	// Lịch sử sửa có trước/sau.
	var hist struct {
		Items []docs.HistoryEntry `json:"items"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/history", pur.ID), nil, &hist)
	actions := []string{}
	for _, h := range hist.Items {
		actions = append(actions, h.Action)
	}
	if strings.Join(actions, ",") != "created,posted,updated" {
		t.Fatalf("lịch sử: %v", actions)
	}
	last := hist.Items[2]
	bj, _ := json.Marshal(last.Before)
	aj, _ := json.Marshal(last.After)
	if !strings.Contains(string(bj), `"qty":100`) || !strings.Contains(string(aj), `"qty":80`) || last.UserName == nil {
		t.Fatalf("audit trước/sau: %s → %s", bj, aj)
	}

	// Sửa phiếu bán cũ: SL/đơn giá (REQ-037/038).
	sOld := e.Admin.GetDoc(sale.ID)
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", sale.ID), map[string]any{"version": sOld.Version, "doc_date": "2026-09-10", "partner_id": cus, "warehouse_id": e.WH["KHO1"],
		"lines": []any{Line(a, "35", "16000")}}, nil)
	ta, _ = e.TotalStock(a)
	eqDec(t, ta, "45", "tồn A sau sửa phiếu bán")
	eqDec(t, e.Debt("receivable", cus), "560000", "công nợ khách sau sửa = 35×16.000")

	// R6: sửa lùi làm âm kho trong quá khứ ⇒ từ chối, dữ liệu giữ nguyên.
	cur := e.Admin.GetDoc(pur.ID)
	bad := map[string]any{"version": cur.Version, "doc_date": "2026-01-15", "partner_id": sup, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(a, "20", "10000"), Line(b, "50", "22000")}}
	r := e.Admin.Expect(422, "INSUFFICIENT_STOCK", "PUT", fmt.Sprintf("/api/documents/%d", pur.ID), bad)
	var ie struct {
		Error struct {
			Details []stock.Shortage `json:"details"`
		} `json:"error"`
	}
	r.JSON(t, &ie)
	if len(ie.Error.Details) != 1 || ie.Error.Details[0].Date.String() != "2026-09-10" || !ie.Error.Details[0].Shortage.Equal(d("15")) {
		t.Fatalf("vi phạm phải ở ngày bán 10/09, thiếu 15: %+v", ie.Error.Details)
	}
	ta, _ = e.TotalStock(a)
	eqDec(t, ta, "45", "tồn không đổi khi sửa bị từ chối")
	// Đổi kho của phiếu nhập cũ cũng làm KHO1 âm ⇒ từ chối.
	bad2 := map[string]any{"version": cur.Version, "doc_date": "2026-01-15", "partner_id": sup, "warehouse_id": e.WH["KHO2"], "lines": []any{Line(a, "80", "10000"), Line(b, "50", "22000")}}
	e.Admin.Expect(422, "INSUFFICIENT_STOCK", "PUT", fmt.Sprintf("/api/documents/%d", pur.ID), bad2)
	// Dời ngày phiếu bán về trước ngày nhập ⇒ từ chối.
	sCur := e.Admin.GetDoc(sale.ID)
	e.Admin.Expect(422, "INSUFFICIENT_STOCK", "PUT", fmt.Sprintf("/api/documents/%d", sale.ID), map[string]any{"version": sCur.Version, "doc_date": "2026-01-10", "partner_id": cus, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(a, "35", "16000")}})
	// Dời ngày phiếu nhập sang sau ngày bán ⇒ từ chối (ngày 10/09 sẽ âm).
	e.Admin.Expect(422, "INSUFFICIENT_STOCK", "PUT", fmt.Sprintf("/api/documents/%d", pur.ID), map[string]any{"version": cur.Version, "doc_date": "2026-09-20", "partner_id": sup, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(a, "80", "10000"), Line(b, "50", "22000")}})
	// Bỏ ghi sổ phiếu nhập đã có hàng bán ra ⇒ từ chối.
	e.Admin.Expect(422, "INSUFFICIENT_STOCK", "POST", fmt.Sprintf("/api/documents/%d/unpost", pur.ID), map[string]any{"version": cur.Version})
	// Dời ngày nhập sớm hơn thì hợp lệ.
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", pur.ID), map[string]any{"version": cur.Version, "doc_date": "2026-01-05", "partner_id": sup, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(a, "80", "10000"), Line(b, "50", "22000")}}, nil)
	// Phiếu đã ghi sổ không xóa được trực tiếp.
	e.Admin.Expect(400, "VALIDATION", "DELETE", fmt.Sprintf("/api/documents/%d", pur.ID), nil)
}

// REQ: 003, 039, 045
// Bỏ ghi sổ ⇒ về phiếu tạm, tồn/công nợ hoàn lại; ghi sổ lại giữ số cũ; xóa phiếu tạm.
func TestREQ039_BoGhiSoVaXoaPhieuTam(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách C", true, false)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "10", nil))
	s := e.Admin.Posted(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "4", "100")))
	eqDec(t, e.Debt("receivable", cus), "400", "công nợ")
	var un docs.Document
	e.Admin.OK("POST", fmt.Sprintf("/api/documents/%d/unpost", s.ID), map[string]any{"version": s.Version}, &un)
	if un.Status != "draft" || un.DisplayNo != un.DraftNo {
		t.Fatalf("bỏ ghi sổ: %+v", un)
	}
	tp, _ := e.TotalStock(p)
	eqDec(t, tp, "10", "tồn hoàn lại")
	eqDec(t, e.Debt("receivable", cus), "0", "công nợ hoàn lại")
	re := e.Admin.PostDoc(&un)
	if *re.DocNo != *s.DocNo {
		t.Fatalf("ghi sổ lại phải giữ số %s, nhận %s", *s.DocNo, *re.DocNo)
	}
	// Xóa: chỉ phiếu tạm.
	dr := e.Admin.CreateDoc(DocBody("sale", "2026-02-02", cus, e.WH["KHO1"], Line(p, "1", nil)))
	e.Admin.Expect(409, "VERSION_CONFLICT", "DELETE", fmt.Sprintf("/api/documents/%d?version=99", dr.ID), nil)
	e.Admin.OK("DELETE", fmt.Sprintf("/api/documents/%d?version=%d", dr.ID, dr.Version), nil, nil)
	e.Admin.Expect(404, "NOT_FOUND", "GET", fmt.Sprintf("/api/documents/%d", dr.ID), nil)
	var hist struct {
		Items []docs.HistoryEntry `json:"items"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/history", dr.ID), nil, &hist)
	if len(hist.Items) != 2 || hist.Items[1].Action != "deleted" {
		t.Fatalf("phiếu đã xóa vẫn còn lịch sử: %+v", hist.Items)
	}
}
