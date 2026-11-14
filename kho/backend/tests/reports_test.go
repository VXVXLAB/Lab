package tests

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"kho/internal/reports"
)

// REQ: 022, 063, 075, 087
// Xuất toàn bộ mã hàng và tồn ra Excel (mặc định chỉ mã có phát sinh — đã thống nhất), đủ 4 kho + tổng.
func TestREQ022_063_075_XuatTonKhoExcel(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	g := e.Group("QH", "Que hàn")
	codes := []string{}
	for i := 1; i <= 25; i++ {
		code := fmt.Sprintf("MA%03d", i)
		p := e.Product(code, "Mặt hàng số "+code, "Cái", 1000, 500, g)
		e.Opening("2026-01-01", e.WH[fmt.Sprintf("KHO%d", (i%4)+1)], Line(p, fmt.Sprint(i), nil))
		codes = append(codes, code)
	}
	e.Product("CHUAPS", "Mã chưa phát sinh", "Cái", 1, 1, 0)
	body := e.Admin.OK("GET", "/api/reports/stock-summary?format=xlsx", nil, nil)
	if ct := body.Header.Get("Content-Type"); !strings.Contains(ct, "spreadsheetml") {
		t.Fatalf("Content-Type: %s", ct)
	}
	if cd := body.Header.Get("Content-Disposition"); !strings.Contains(cd, "attachment") || !strings.Contains(cd, ".xlsx") {
		t.Fatalf("Content-Disposition: %s", cd)
	}
	rows := xlsxRows(t, body.Body)
	if rows[0][0] != "BÁO CÁO TỒN KHO" {
		t.Fatalf("tiêu đề: %v", rows[0])
	}
	header := findRow(rows, 0, "STT")
	if header == nil || strings.Join(header, "|") != "STT|Mã hàng|Tên hàng|ĐVT|Nhóm VTHH|Kho 1|Kho 2|Kho 3|Kho 4|Tổng tồn" {
		t.Fatalf("dòng tiêu đề cột: %q", header)
	}
	for i, c := range codes {
		r := findRow(rows, 1, c)
		if r == nil {
			t.Fatalf("thiếu mã %s trong Excel", c)
		}
		if r[9] != fmt.Sprint(i+1) || r[4] != "Que hàn" {
			t.Fatalf("mã %s: %q", c, r)
		}
	}
	if findRow(rows, 1, "CHUAPS") != nil || findRow(rows, 1, "DV") != nil {
		t.Fatal("mặc định không xuất mã chưa phát sinh / mã dịch vụ")
	}
	if tot := findRow(rows, 0, "Cộng"); tot == nil || tot[9] != "325" {
		t.Fatalf("dòng Cộng: %q", tot)
	}
	// only_with_data=false ⇒ xuất cả mã chưa phát sinh.
	rows = xlsxRows(t, e.Admin.OK("GET", "/api/reports/stock-summary?format=xlsx&only_with_data=false", nil, nil).Body)
	if r := findRow(rows, 1, "CHUAPS"); r == nil || r[9] != "0" {
		t.Fatalf("only_with_data=false phải có mã chưa phát sinh: %q", r)
	}
	// Mọi báo cáo đều xuất xlsx được.
	p := e.Product("LEDG", "Thẻ kho", "Cái", 1, 1, 0)
	kh := e.Partner("KH", "Khách", true, false)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "5", nil))
	e.Admin.Posted(DocBody("sale", "2026-02-01", kh, e.WH["KHO1"], Line(p, "1", "1")))
	for _, path := range []string{
		"/api/reports/stock-nxt?from=2026-01-01&to=2026-12-31",
		fmt.Sprintf("/api/reports/stock-ledger?product_id=%d", p),
		"/api/reports/sales?from=2026-01-01&to=2026-12-31",
		"/api/reports/purchases?from=2026-01-01&to=2026-12-31",
		"/api/reports/debt-summary?side=receivable",
		"/api/reports/debt-summary?side=payable",
		fmt.Sprintf("/api/reports/debt-ledger?side=receivable&partner_id=%d", kh),
		fmt.Sprintf("/api/reports/cash-book?account_id=%d", e.TM),
		"/api/reports/draft-demand",
	} {
		sep := "?"
		if strings.Contains(path, "?") {
			sep = "&"
		}
		r := e.Admin.OK("GET", path+sep+"format=xlsx", nil, nil)
		f := openXLSX(t, r.Body)
		f.Close()
		r2 := e.Admin.OK("GET", path+sep+"format=docx", nil, nil)
		if !strings.Contains(docxXML(t, r2.Body), "<w:tbl>") {
			t.Fatalf("%s docx không có bảng", path)
		}
	}
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/reports/stock-summary?format=pdf", nil)
}

// REQ: 071, 072, 073, 074, 087, 008
// Xuất phiếu nhập/xuất ra Excel và Word: bảng thật, đúng dữ liệu, mở lại và thêm/bớt dòng, cột được.
func TestREQ071_074_087_XuatPhieuExcelWordChinhSuaDuoc(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sup := e.Partner("KSW", "Công ty Kiswel <&> \"VN\"", false, true)
	cus := e.Partner("TP", "Cơ khí Tân Phú", true, false)
	a := e.Product("K701832", "Que hàn Kiswel K7018-3.2 (20kg)", "Thùng", 1090000, 950000, 0)
	b := e.Product("CN249SS08", "Béc CO2 Sunshine 0.8 mm", "Cái", 13000, 9000, 0)
	pur := e.Admin.Posted(DocBody("purchase", "2026-01-15", sup, e.WH["KHO1"], Line(a, "10", "950000"), Line(b, "100.5", "9000")))
	sale := e.Admin.Posted(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(a, "2", "1090000")))

	// Phiếu nhập → Excel (REQ-071).
	res := e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", pur.ID), nil, nil)
	if !strings.Contains(res.Header.Get("Content-Disposition"), "NK00001.xlsx") {
		t.Fatalf("tên file: %s", res.Header.Get("Content-Disposition"))
	}
	rows := xlsxRows(t, res.Body)
	if rows[0][0] != "PHIẾU NHẬP KHO MUA HÀNG" {
		t.Fatalf("tiêu đề phiếu nhập: %q", rows[0])
	}
	all := fmt.Sprint(rows)
	if !strings.Contains(all, "Nhà cung cấp: Công ty Kiswel <&> \"VN\"") || !strings.Contains(all, "Số phiếu: NK00001") {
		t.Fatalf("thông tin phiếu: %v", rows)
	}
	r1 := findRow(rows, 1, "K701832")
	r2 := findRow(rows, 1, "CN249SS08")
	if r1 == nil || r1[4] != "10" || r1[5] != "950000" || r1[6] != "9500000" || r2 == nil || r2[4] != "100.5" || r2[6] != "904500" {
		t.Fatalf("dòng hàng: %q %q", r1, r2)
	}
	// Không khóa sheet, không ảnh; mở lại thêm dòng + cột rồi lưu được (REQ-074).
	files := zipFiles(t, res.Body)
	for name, c := range files {
		if strings.Contains(c, "sheetProtection") || strings.Contains(c, "workbookProtection") {
			t.Fatalf("%s bị khóa", name)
		}
		if strings.HasPrefix(name, "xl/media/") || strings.HasPrefix(name, "xl/drawings/") {
			t.Fatalf("file có ảnh: %s", name)
		}
	}
	f := openXLSX(t, res.Body)
	sh := f.GetSheetList()[0]
	hdr := 0
	for i, r := range rows {
		if len(r) > 0 && r[0] == "STT" {
			hdr = i + 1
		}
	}
	if err := f.InsertRows(sh, hdr+2, 1); err != nil {
		t.Fatalf("thêm dòng: %v", err)
	}
	if err := f.SetCellValue(sh, fmt.Sprintf("B%d", hdr+2), "MAMOI"); err != nil {
		t.Fatal(err)
	}
	if err := f.InsertCols(sh, "I", 1); err != nil {
		t.Fatalf("thêm cột: %v", err)
	}
	if err := f.RemoveRow(sh, hdr+1); err != nil {
		t.Fatalf("bớt dòng: %v", err)
	}
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatalf("lưu lại: %v", err)
	}
	f.Close()
	rows2 := xlsxRows(t, buf.Bytes())
	if findRow(rows2, 1, "MAMOI") == nil || findRow(rows2, 1, "K701832") != nil {
		t.Fatal("sau khi thêm/bớt dòng, dữ liệu phải phản ánh chỉnh sửa")
	}
	// Ô Cộng là công thức SUM ⇒ tự cộng lại khi thêm dòng.
	f2 := openXLSX(t, res.Body)
	for i, r := range rows {
		if len(r) > 0 && r[0] == "Cộng" {
			formula, _ := f2.GetCellFormula(f2.GetSheetList()[0], fmt.Sprintf("G%d", i+1))
			if !strings.HasPrefix(formula, "SUM(G") {
				t.Fatalf("ô Cộng phải là công thức SUM: %q", formula)
			}
		}
	}
	f2.Close()

	// Phiếu xuất → Excel (REQ-072).
	rows = xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", sale.ID), nil, nil).Body)
	if rows[0][0] != "PHIẾU XUẤT KHO BÁN HÀNG" || findRow(rows, 1, "K701832")[6] != "2180000" {
		t.Fatalf("phiếu xuất Excel: %v", rows)
	}
	// Phiếu → Word (REQ-073): bảng thật <w:tbl> chứa dữ liệu.
	wres := e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=docx", pur.ID), nil, nil)
	if !strings.Contains(wres.Header.Get("Content-Type"), "wordprocessingml") {
		t.Fatalf("Content-Type docx: %s", wres.Header.Get("Content-Type"))
	}
	wf := zipFiles(t, wres.Body)
	x := wf["word/document.xml"]
	if !strings.Contains(x, "<w:tbl>") || !strings.Contains(x, "<w:tr>") || !strings.Contains(x, "<w:tc>") {
		t.Fatal("docx phải có bảng thật")
	}
	cells := docxCellTexts(x)
	if strings.Join(cells[0], "|") != "STT|Mã hàng|Tên hàng|ĐVT|Số lượng|Đơn giá|Thành tiền" { // không dòng nào có ghi chú ⇒ không có cột Ghi chú
		t.Fatalf("tiêu đề bảng Word: %q", cells[0])
	}
	if cells[1][1] != "K701832" || cells[1][4] != "10,0" || cells[1][6] != "9.500.000" || cells[2][4] != "100,5" || cells[3][0] != "Cộng" || cells[3][6] != "10.404.500" {
		t.Fatalf("dữ liệu bảng Word: %q", cells)
	}
	if !strings.Contains(x, "Công ty Kiswel &lt;&amp;&gt; &quot;VN&quot;") {
		t.Fatal("ký tự đặc biệt phải được escape trong XML")
	}
	for name, c := range wf {
		if strings.Contains(c, "documentProtection") || strings.Contains(c, "<w:drawing") || strings.HasPrefix(name, "word/media/") {
			t.Fatalf("docx bị khóa hoặc có ảnh: %s", name)
		}
	}
	if _, ok := wf["word/styles.xml"]; !ok {
		t.Fatal("docx thiếu styles.xml")
	}
	// Phiếu xuất → Word.
	x2 := docxXML(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=docx", sale.ID), nil, nil).Body)
	if !strings.Contains(x2, "PHIẾU XUẤT KHO BÁN HÀNG") || !strings.Contains(x2, "2.180.000") || !strings.Contains(x2, "Nợ cũ: 0") {
		t.Fatal("phiếu xuất Word")
	}
	e.Admin.Expect(400, "VALIDATION", "GET", fmt.Sprintf("/api/documents/%d/export?format=pdf", sale.ID), nil)
	e.Admin.Expect(404, "NOT_FOUND", "GET", "/api/documents/999999/export?format=xlsx", nil)
}

// REQ: 065, 066, 067, 070
// Báo cáo công nợ, mua hàng, bán hàng: số liệu đúng và mỗi dòng mở được đơn hàng ngay.
func TestREQ065_066_067_070_BaoCaoMuaBanCongNo(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sup := e.Partner("NCC", "NCC Hàn Việt", false, true)
	k1 := e.Partner("K1", "Khách Một", true, false)
	k2 := e.Partner("K2", "Khách Hai", true, false)
	p := e.Product("P", "Hàng P", "Cái", 20000, 10000, 0)
	q := e.Product("Q", "Hàng Q", "Bộ", 50000, 30000, 0)
	pu := e.Admin.Posted(DocBody("purchase", "2026-03-01", sup, e.WH["KHO1"], Line(p, "100", "10000"), Line(q, "10", "30000")))
	s1 := e.Admin.Posted(DocBody("sale", "2026-03-05", k1, e.WH["KHO1"], Line(p, "10", "20000"), Line(q, "1", "50000")))
	s2 := e.Admin.Posted(DocBody("sale", "2026-03-06", k2, e.WH["KHO1"], Line(p, "5", "21000")))
	e.Admin.Posted(DocBody("sale_return", "2026-03-07", k2, e.WH["KHO1"], Line(p, "1", "21000")))
	e.Admin.Posted(DocBody("sale", "2026-04-01", k1, e.WH["KHO1"], Line(p, "1", "20000")))

	var sr reports.Trade
	e.Admin.OK("GET", "/api/reports/sales?from=2026-03-01&to=2026-03-31", nil, &sr)
	if len(sr.Rows) != 3 || sr.DocCount != 2 {
		t.Fatalf("báo cáo bán tháng 3: %+v", sr)
	}
	eqDec(t, sr.TotalAmount, "355000", "tổng bán tháng 3")
	// Mở chi tiết đơn hàng từ dòng báo cáo (REQ-070).
	opened := e.Admin.GetDoc(sr.Rows[2].DocumentID)
	if opened.ID != s2.ID || *opened.PartnerName != "Khách Hai" || len(opened.Lines) != 1 {
		t.Fatalf("mở đơn từ báo cáo bán: %+v", opened)
	}
	// Lọc theo khách, kèm trả hàng.
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/sales?from=2026-03-01&to=2026-03-31&partner_id=%d&include_returns=true", k2), nil, &sr)
	if len(sr.Rows) != 2 || !sr.Rows[1].Qty.Equal(d("-1")) {
		t.Fatalf("bán kèm trả hàng: %+v", sr.Rows)
	}
	eqDec(t, sr.TotalAmount, "84000", "bán ròng khách hai")
	var pr reports.Trade
	e.Admin.OK("GET", "/api/reports/purchases?from=2026-03-01&to=2026-03-31", nil, &pr)
	eqDec(t, pr.TotalAmount, "1300000", "tổng mua")
	if pr.Rows[0].DocumentID != pu.ID || *pr.Rows[0].PartnerName != "NCC Hàn Việt" {
		t.Fatalf("báo cáo mua: %+v", pr.Rows[0])
	}
	var ds reports.DebtSummary
	e.Admin.OK("GET", "/api/reports/debt-summary?side=receivable&from=2026-03-01&to=2026-03-31", nil, &ds)
	if len(ds.Items) != 2 {
		t.Fatalf("công nợ phải thu: %+v", ds.Items)
	}
	eqDec(t, ds.Totals.Increase, "355000", "tăng")
	eqDec(t, ds.Totals.Decrease, "21000", "giảm")
	eqDec(t, ds.Totals.Closing, "334000", "cuối kỳ")
	// Mở sổ chi tiết từ dòng tổng hợp (REQ-069) và mở chứng từ từ sổ.
	var dl reports.DebtLedger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/debt-ledger?side=receivable&partner_id=%d&from=2026-03-01&to=2026-03-31", ds.Items[0].PartnerID), nil, &dl)
	if len(dl.Rows) != 1 || *dl.Rows[0].DocumentID != s1.ID {
		t.Fatalf("sổ chi tiết khách một: %+v", dl.Rows)
	}
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/reports/debt-summary?side=abc", nil)
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/reports/debt-ledger?side=receivable", nil)
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/reports/sales?from=2026-13-45", nil)
}

// REQ: 068, 069, 086
// Bấm số liệu trong báo cáo tồn / thẻ kho / công nợ mở đúng chứng từ (có id để mở Drawer ngay tại báo cáo).
func TestREQ068_069_086_MoChiTietTuBaoCao(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	p, nos := setupLedgerExample(e)
	// Từ báo cáo tồn: dòng có product_id ⇒ mở thẻ kho.
	var ss stockSummary
	e.Admin.OK("GET", "/api/reports/stock-summary", nil, &ss)
	if len(ss.Items) != 1 || ss.Items[0].ProductID != p {
		t.Fatalf("báo cáo tồn: %+v", ss.Items)
	}
	var l reports.Ledger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d&from=2026-04-01", ss.Items[0].ProductID), nil, &l)
	// Từ thẻ kho: mỗi dòng mở đúng chứng từ (REQ-068).
	for i, r := range l.Rows {
		doc := e.Admin.GetDoc(r.DocumentID)
		if doc.DisplayNo != nos[i] || doc.DocType != r.DocType || doc.PartnerID == nil || *doc.PartnerID != *r.PartnerID {
			t.Fatalf("dòng %d mở sai chứng từ: %+v vs %+v", i+1, r, doc)
		}
	}
	// Từ công nợ: dòng tổng hợp → sổ chi tiết → chứng từ (REQ-069).
	var ds reports.DebtSummary
	e.Admin.OK("GET", "/api/reports/debt-summary?side=receivable", nil, &ds)
	if len(ds.Items) != 3 {
		t.Fatalf("tổng hợp công nợ: %+v", ds.Items)
	}
	for _, it := range ds.Items {
		var dl reports.DebtLedger
		e.Admin.OK("GET", fmt.Sprintf("/api/reports/debt-ledger?side=receivable&partner_id=%d", it.PartnerID), nil, &dl)
		if !dl.Closing.Equal(it.Closing) {
			t.Fatalf("sổ chi tiết %s lệch tổng hợp", it.PartnerName)
		}
		for _, r := range dl.Rows {
			doc := e.Admin.GetDoc(*r.DocumentID)
			if doc.DisplayNo != r.RefNo || !doc.TotalAmount.Equal(r.Increase.Add(r.Decrease)) {
				t.Fatalf("mở chứng từ từ sổ công nợ sai: %+v", r)
			}
		}
	}
}
