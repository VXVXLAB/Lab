// Package export: xuất bảng ra .xlsx (excelize) và .docx (tự sinh bằng archive/zip + XML).
// File là file thường: bảng thật, không ảnh, không khóa sheet ⇒ người dùng thêm/bớt dòng, cột được (R10).
package export

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"strings"

	"github.com/shopspring/decimal"
	"github.com/xuri/excelize/v2"

	"kho/internal/util"
)

// Kind là kiểu dữ liệu cột.
type Kind int

// Các kiểu cột.
const (
	Text Kind = iota
	Qty
	Money
	Date
)

// Column là một cột của bảng.
type Column struct {
	Header string
	Width  float64
	Kind   Kind
}

// Table là dữ liệu một bảng xuất file.
type Table struct {
	// Company: các dòng thông tin công ty in trên cùng (tên, địa chỉ, ĐT/MST) — rỗng thì không in.
	Company   []string
	SheetName string
	Title     string
	Subtitle  string
	Info      []string // các dòng thông tin dưới tiêu đề
	Columns   []Column
	Rows      [][]any // giá trị: string, decimal.Decimal, *decimal.Decimal (nil ⇒ ô trống), util.Date, int, nil
	Footer    [][]any // dòng tổng (in đậm)
	// SumColumns: chỉ số cột (0-based) có công thức SUM ở dòng Footer đầu tiên (tự cộng lại khi thêm dòng).
	SumColumns []int
	// Summary: các dòng "nhãn + số" sau bảng (Nợ cũ, Tổng nợ, Tổng số tiền…). Trong Excel nhãn và số nằm ở hai ô,
	// số là ô số thật; Formula (tùy chọn) là công thức Excel với ký hiệu {total} = ô Cộng của cột SumColumns[0]
	// và {s0}, {s1}… = ô số của dòng Summary thứ 0, 1…; giá trị lưu sẵn (cached) = Value.
	Summary    []SummaryRow
	After      []string // các dòng văn bản sau bảng
	Signatures []string // tiêu đề các ô ký tên
}

// SummaryRow là một dòng "nhãn: số" sau bảng.
type SummaryRow struct {
	Label   string
	Value   decimal.Decimal
	Formula string
}

func cellText(v any, k Kind) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case decimal.Decimal:
		return fmtNum(x, k)
	case *decimal.Decimal:
		if x == nil {
			return ""
		}
		return fmtNum(*x, k)
	case util.Date:
		if x.Empty() {
			return ""
		}
		return x.VN()
	case *util.Date:
		if x == nil || x.Empty() {
			return ""
		}
		return x.VN()
	case int:
		return fmt.Sprint(x)
	case int64:
		return fmt.Sprint(x)
	default:
		return fmt.Sprint(x)
	}
}

func fmtNum(d decimal.Decimal, k Kind) string {
	if k == Qty {
		s := util.FormatVND(d)
		if !strings.Contains(s, ",") {
			s += ",0"
		}
		return s
	}
	return util.FormatVND(d)
}

// ---------- XLSX ----------

func colName(i int) string {
	n, _ := excelize.ColumnNumberToName(i + 1)
	return n
}

// XLSX tạo file Excel từ bảng.
func XLSX(t Table) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()
	sheet := t.SheetName
	if sheet == "" {
		sheet = "Sheet1"
	}
	sheet = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`:\/?*[]`, r) {
			return '-'
		}
		return r
	}, sheet)
	if len([]rune(sheet)) > 31 {
		sheet = string([]rune(sheet)[:31])
	}
	if err := f.SetSheetName("Sheet1", sheet); err != nil {
		return nil, err
	}
	ncol := len(t.Columns)
	if ncol == 0 {
		ncol = 1
	}
	last := colName(ncol - 1)
	titleStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 14, Family: "Times New Roman"},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"}})
	subStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Italic: true, Family: "Times New Roman"},
		Alignment: &excelize.Alignment{Horizontal: "center"}})
	infoStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Family: "Times New Roman"}})
	border := []excelize.Border{{Type: "left", Color: "000000", Style: 1}, {Type: "right", Color: "000000", Style: 1},
		{Type: "top", Color: "000000", Style: 1}, {Type: "bottom", Color: "000000", Style: 1}}
	headStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Family: "Times New Roman"}, Border: border,
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"D9E1F2"}, Pattern: 1},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center", WrapText: true}})
	moneyFmt, qtyFmt := "#,##0", "#,##0.0##"
	styles := map[Kind]int{}
	boldStyles := map[Kind]int{}
	for _, k := range []Kind{Text, Qty, Money, Date} {
		st := &excelize.Style{Font: &excelize.Font{Family: "Times New Roman"}, Border: border, Alignment: &excelize.Alignment{Vertical: "top", WrapText: k == Text}}
		switch k {
		case Money:
			st.CustomNumFmt = &moneyFmt
		case Qty:
			st.CustomNumFmt = &qtyFmt
		case Date:
			st.Alignment.Horizontal = "center"
		}
		styles[k], _ = f.NewStyle(st)
		bst := *st
		bst.Font = &excelize.Font{Family: "Times New Roman", Bold: true}
		boldStyles[k], _ = f.NewStyle(&bst)
	}
	// Tiền/đơn giá có phần lẻ (vd. 13.001,5) dùng định dạng có số lẻ để không làm tròn khi hiển thị.
	moneyFracFmt := "#,##0.0#"
	mfs := &excelize.Style{Font: &excelize.Font{Family: "Times New Roman"}, Border: border, Alignment: &excelize.Alignment{Vertical: "top"}, CustomNumFmt: &moneyFracFmt}
	moneyFrac, _ := f.NewStyle(mfs)
	mfb := *mfs
	mfb.Font = &excelize.Font{Family: "Times New Roman", Bold: true}
	moneyFracBold, _ := f.NewStyle(&mfb)
	row := 1
	set := func(cell string, v any) error { return f.SetCellValue(sheet, cell, v) }
	if len(t.Company) > 0 {
		compStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Family: "Times New Roman"}})
		for i, line := range t.Company {
			cell := fmt.Sprintf("A%d", row)
			_ = f.SetCellStr(sheet, cell, line)
			if i == 0 {
				_ = f.SetCellStyle(sheet, cell, cell, compStyle)
			} else {
				_ = f.SetCellStyle(sheet, cell, cell, infoStyle)
			}
			row++
		}
	}
	titleCell := fmt.Sprintf("A%d", row)
	if err := set(titleCell, t.Title); err != nil {
		return nil, err
	}
	if ncol > 1 {
		_ = f.MergeCell(sheet, titleCell, fmt.Sprintf("%s%d", last, row))
	}
	_ = f.SetCellStyle(sheet, titleCell, fmt.Sprintf("%s%d", last, row), titleStyle)
	_ = f.SetRowHeight(sheet, row, 24)
	row++
	if t.Subtitle != "" {
		_ = set(fmt.Sprintf("A%d", row), t.Subtitle)
		if ncol > 1 {
			_ = f.MergeCell(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("%s%d", last, row))
		}
		_ = f.SetCellStyle(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("%s%d", last, row), subStyle)
		row++
	}
	for _, line := range t.Info {
		_ = set(fmt.Sprintf("A%d", row), line)
		_ = f.SetCellStyle(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("A%d", row), infoStyle)
		row++
	}
	row++ // dòng trống
	headRow := row
	for i, c := range t.Columns {
		cell := fmt.Sprintf("%s%d", colName(i), row)
		_ = set(cell, c.Header)
		w := c.Width
		if w == 0 {
			w = 14
		}
		_ = f.SetColWidth(sheet, colName(i), colName(i), w)
	}
	if len(t.Columns) > 0 {
		_ = f.SetCellStyle(sheet, fmt.Sprintf("A%d", headRow), fmt.Sprintf("%s%d", last, headRow), headStyle)
	}
	row++
	firstData := row
	writeRow := func(vals []any, bold bool) error {
		for i := range t.Columns {
			var v any
			if i < len(vals) {
				v = vals[i]
			}
			cell := fmt.Sprintf("%s%d", colName(i), row)
			k := t.Columns[i].Kind
			if err := writeCell(f, sheet, cell, v, k); err != nil {
				return err
			}
			st := styles[k]
			if bold {
				st = boldStyles[k]
			}
			if k == Money && hasFraction(v) {
				st = moneyFrac
				if bold {
					st = moneyFracBold
				}
			}
			_ = f.SetCellStyle(sheet, cell, cell, st)
		}
		row++
		return nil
	}
	for _, r := range t.Rows {
		if err := writeRow(r, false); err != nil {
			return nil, err
		}
	}
	lastData := row - 1
	totalCell := ""
	for fi, r := range t.Footer {
		footRow := row
		if err := writeRow(r, true); err != nil {
			return nil, err
		}
		if fi == 0 {
			for i, ci := range t.SumColumns {
				cell := fmt.Sprintf("%s%d", colName(ci), footRow)
				if i == 0 {
					totalCell = cell
				}
				if lastData >= firstData {
					// Giá trị số đã ghi ở trên được giữ làm kết quả lưu sẵn của công thức.
					_ = f.SetCellFormula(sheet, cell, fmt.Sprintf("SUM(%s%d:%s%d)", colName(ci), firstData, colName(ci), lastData))
				}
			}
		}
	}
	row++
	if len(t.Summary) > 0 {
		valCol := ncol - 1
		if len(t.SumColumns) > 0 {
			valCol = t.SumColumns[0]
		}
		labelCol := 0
		if valCol >= 3 {
			labelCol = 2
		}
		labelStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Family: "Times New Roman"}, Alignment: &excelize.Alignment{Horizontal: "right"}})
		valFmt := "#,##0"
		valStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Family: "Times New Roman"}, CustomNumFmt: &valFmt})
		valFracFmt := "#,##0.0#"
		valFracStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Family: "Times New Roman"}, CustomNumFmt: &valFracFmt})
		cells := make([]string, len(t.Summary))
		for i := range t.Summary {
			cells[i] = fmt.Sprintf("%s%d", colName(valCol), row+i)
		}
		for i, sr := range t.Summary {
			lc := fmt.Sprintf("%s%d", colName(labelCol), row)
			_ = f.SetCellStr(sheet, lc, sr.Label)
			_ = f.SetCellStyle(sheet, lc, lc, labelStyle)
			vc := cells[i]
			_ = f.SetCellDefault(sheet, vc, sr.Value.String())
			st := valStyle
			if hasFraction(sr.Value) {
				st = valFracStyle
			}
			_ = f.SetCellStyle(sheet, vc, vc, st)
			if sr.Formula != "" && (totalCell != "" || !strings.Contains(sr.Formula, "{total}")) {
				expr := strings.ReplaceAll(sr.Formula, "{total}", totalCell)
				for j := len(cells) - 1; j >= 0; j-- {
					expr = strings.ReplaceAll(expr, fmt.Sprintf("{s%d}", j), cells[j])
				}
				_ = f.SetCellFormula(sheet, vc, expr)
			}
			row++
		}
		row++
	}
	for _, line := range t.After {
		_ = set(fmt.Sprintf("A%d", row), line)
		_ = f.SetCellStyle(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("A%d", row), infoStyle)
		row++
	}
	if len(t.Signatures) > 0 {
		row++
		sigStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Family: "Times New Roman"}, Alignment: &excelize.Alignment{Horizontal: "center"}})
		step := ncol / len(t.Signatures)
		if step < 1 {
			step = 1
		}
		for i, sig := range t.Signatures {
			cell := fmt.Sprintf("%s%d", colName(i*step), row)
			_ = set(cell, sig)
			_ = f.SetCellStyle(sheet, cell, cell, sigStyle)
			cell2 := fmt.Sprintf("%s%d", colName(i*step), row+1)
			_ = set(cell2, "(Ký, ghi rõ họ tên)")
		}
	}
	_ = f.SetPanes(sheet, &excelize.Panes{Freeze: true, YSplit: headRow, TopLeftCell: fmt.Sprintf("A%d", headRow+1), ActivePane: "bottomLeft"})
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return numericFormulaCells(buf.Bytes())
}

func hasFraction(v any) bool {
	switch x := v.(type) {
	case decimal.Decimal:
		return !x.Equal(x.Truncate(0))
	case *decimal.Decimal:
		return x != nil && !x.Equal(x.Truncate(0))
	}
	return false
}

// numericFormulaCells sửa kiểu ô công thức: excelize ghi ô công thức với t="str" (kết quả lưu sẵn là chuỗi).
// Mọi công thức của ta (SUM, cộng ô) đều ra số, nên bỏ t="str" để kết quả lưu sẵn là SỐ — trình xem không tính lại
// công thức (xem trước trên điện thoại, LibreOffice không recalc) vẫn hiển thị đúng con số.
func numericFormulaCells(b []byte) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, zf := range zr.File {
		rc, err := zf.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, err
		}
		if strings.HasPrefix(zf.Name, "xl/worksheets/") && strings.HasSuffix(zf.Name, ".xml") {
			data = bytes.ReplaceAll(data, []byte(` t="str"><f>`), []byte(`><f>`))
		}
		w, err := zw.CreateHeader(&zip.FileHeader{Name: zf.Name, Method: zip.Deflate, Modified: zf.Modified})
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(data); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func writeCell(f *excelize.File, sheet, cell string, v any, k Kind) error {
	switch x := v.(type) {
	case nil:
		return nil
	case decimal.Decimal:
		// Ghi số dạng chuỗi số chuẩn (không qua float) — Excel đọc là ô số.
		return f.SetCellDefault(sheet, cell, x.String())
	case *decimal.Decimal:
		if x == nil {
			return nil
		}
		return f.SetCellDefault(sheet, cell, x.String())
	case util.Date:
		if x.Empty() {
			return nil
		}
		return f.SetCellValue(sheet, cell, x.VN())
	case *util.Date:
		if x == nil || x.Empty() {
			return nil
		}
		return f.SetCellValue(sheet, cell, x.VN())
	case int:
		return f.SetCellInt(sheet, cell, x)
	case int64:
		return f.SetCellInt(sheet, cell, int(x))
	case string:
		return f.SetCellStr(sheet, cell, x)
	default:
		return f.SetCellValue(sheet, cell, fmt.Sprint(x))
	}
}

// ---------- DOCX ----------

func xmlEsc(s string) string {
	var b bytes.Buffer
	for _, r := range s {
		switch r {
		case '&':
			b.WriteString("&amp;")
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		case '"':
			b.WriteString("&quot;")
		case '\'':
			b.WriteString("&apos;")
		default:
			if r < 0x20 && r != '\t' && r != '\n' && r != '\r' {
				continue
			}
			b.WriteRune(r)
		}
	}
	return b.String()
}

func para(text string, bold, italic bool, align string, size int) string {
	var b strings.Builder
	b.WriteString("<w:p><w:pPr>")
	if align != "" {
		b.WriteString(`<w:jc w:val="` + align + `"/>`)
	}
	b.WriteString(`<w:spacing w:after="40"/></w:pPr>`)
	b.WriteString(run(text, bold, italic, size))
	b.WriteString("</w:p>")
	return b.String()
}

func run(text string, bold, italic bool, size int) string {
	var b strings.Builder
	b.WriteString("<w:r><w:rPr>")
	if bold {
		b.WriteString("<w:b/>")
	}
	if italic {
		b.WriteString("<w:i/>")
	}
	if size > 0 {
		fmt.Fprintf(&b, `<w:sz w:val="%d"/><w:szCs w:val="%d"/>`, size, size)
	}
	b.WriteString(`</w:rPr><w:t xml:space="preserve">`)
	b.WriteString(xmlEsc(text))
	b.WriteString("</w:t></w:r>")
	return b.String()
}

func tcell(text string, width int, bold bool, align string, shade bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, `<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>`, width)
	if shade {
		b.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="D9E1F2"/>`)
	}
	b.WriteString(`</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/>`)
	if align != "" {
		b.WriteString(`<w:jc w:val="` + align + `"/>`)
	}
	b.WriteString(`</w:pPr>`)
	b.WriteString(run(text, bold, false, 0))
	b.WriteString(`</w:p></w:tc>`)
	return b.String()
}

// DOCX tạo file Word (.docx) có bảng thật (<w:tbl>) từ bảng.
func DOCX(t Table) ([]byte, error) {
	var body strings.Builder
	for i, line := range t.Company {
		body.WriteString(para(line, i == 0, false, "", 0))
	}
	body.WriteString(para(t.Title, true, false, "center", 32))
	if t.Subtitle != "" {
		body.WriteString(para(t.Subtitle, false, true, "center", 0))
	}
	for _, line := range t.Info {
		body.WriteString(para(line, false, false, "", 0))
	}
	// Bảng: tổng độ rộng ~ 9600 dxa (A4 dọc trừ lề) hoặc theo tỉ lệ Width.
	total := 0.0
	for _, c := range t.Columns {
		w := c.Width
		if w == 0 {
			w = 14
		}
		total += w
	}
	pageW := 9638.0
	landscape := len(t.Columns) > 8
	if landscape {
		pageW = 14570
	}
	widths := make([]int, len(t.Columns))
	for i, c := range t.Columns {
		w := c.Width
		if w == 0 {
			w = 14
		}
		widths[i] = int(pageW * w / total)
	}
	if len(t.Columns) > 0 {
		body.WriteString(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
			`<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
			`<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
			`<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
			`</w:tblBorders><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>`)
		for _, w := range widths {
			fmt.Fprintf(&body, `<w:gridCol w:w="%d"/>`, w)
		}
		body.WriteString(`</w:tblGrid>`)
		body.WriteString(`<w:tr><w:trPr><w:tblHeader/></w:trPr>`)
		for i, c := range t.Columns {
			body.WriteString(tcell(c.Header, widths[i], true, "center", true))
		}
		body.WriteString(`</w:tr>`)
		writeRows := func(rows [][]any, bold bool) {
			for _, r := range rows {
				body.WriteString(`<w:tr>`)
				for i, c := range t.Columns {
					var v any
					if i < len(r) {
						v = r[i]
					}
					align := ""
					switch c.Kind {
					case Qty, Money:
						align = "right"
					case Date:
						align = "center"
					}
					body.WriteString(tcell(cellText(v, c.Kind), widths[i], bold, align, false))
				}
				body.WriteString(`</w:tr>`)
			}
		}
		writeRows(t.Rows, false)
		writeRows(t.Footer, true)
		body.WriteString(`</w:tbl>`)
	}
	body.WriteString(para("", false, false, "", 0))
	for _, sr := range t.Summary {
		body.WriteString(para(sr.Label+" "+util.FormatVND(sr.Value), true, false, "", 0))
	}
	for _, line := range t.After {
		body.WriteString(para(line, true, false, "", 0))
	}
	if len(t.Signatures) > 0 {
		body.WriteString(para("", false, false, "", 0))
		w := int(pageW) / len(t.Signatures)
		body.WriteString(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid>`)
		for range t.Signatures {
			fmt.Fprintf(&body, `<w:gridCol w:w="%d"/>`, w)
		}
		body.WriteString(`</w:tblGrid><w:tr>`)
		for _, s := range t.Signatures {
			body.WriteString(tcell(s, w, true, "center", false))
		}
		body.WriteString(`</w:tr><w:tr>`)
		for range t.Signatures {
			body.WriteString(tcell("(Ký, ghi rõ họ tên)", w, false, "center", false))
		}
		body.WriteString(`</w:tr></w:tbl>`)
	}
	sect := `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`
	if landscape {
		sect = `<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`
	}
	doc := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
		`<w:body>` + body.String() + sect + `</w:body></w:document>`

	files := []struct{ name, body string }{
		{"[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
			`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
			`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
			`<Default Extension="xml" ContentType="application/xml"/>` +
			`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
			`<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
			`<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
			`</Types>`},
		{"_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
			`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
			`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
			`</Relationships>`},
		{"docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
			`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
			`<dc:title>` + xmlEsc(t.Title) + `</dc:title><dc:creator>Phần mềm quản lý kho</dc:creator></cp:coreProperties>`},
		{"word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
			`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
			`</Relationships>`},
		{"word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
			`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
			`<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>` +
			`<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault>` +
			`<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
			`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
			`<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>` +
			`<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
			`<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>` +
			`<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
			`<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
			`<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
			`</w:tblBorders></w:tblPr></w:style></w:styles>`},
		{"word/document.xml", doc},
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range files {
		w, err := zw.Create(f.name)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write([]byte(f.body)); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// MIME types.
const (
	MimeXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	MimeDOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)
