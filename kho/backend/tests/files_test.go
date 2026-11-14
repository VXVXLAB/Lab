package tests

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

// openXLSX mở file xlsx từ bytes.
func openXLSX(t *testing.T, b []byte) *excelize.File {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("không mở được xlsx: %v", err)
	}
	return f
}

// xlsxCell đọc giá trị thô một ô của sheet đầu tiên.
func xlsxCell(t *testing.T, b []byte, cell string) string {
	t.Helper()
	f := openXLSX(t, b)
	defer f.Close()
	v, err := f.GetCellValue(f.GetSheetList()[0], cell, excelize.Options{RawCellValue: true})
	if err != nil {
		t.Fatalf("đọc ô %s: %v", cell, err)
	}
	return v
}

// xlsxRows đọc toàn bộ ô (giá trị thô) của sheet đầu tiên.
func xlsxRows(t *testing.T, b []byte) [][]string {
	t.Helper()
	f := openXLSX(t, b)
	defer f.Close()
	rows, err := f.GetRows(f.GetSheetList()[0], excelize.Options{RawCellValue: true})
	if err != nil {
		t.Fatalf("đọc dòng: %v", err)
	}
	return rows
}

// findRow tìm dòng có ô đầu (hoặc bất kỳ ô) bằng giá trị.
func findRow(rows [][]string, col int, val string) []string {
	for _, r := range rows {
		if col < len(r) && r[col] == val {
			return r
		}
	}
	return nil
}

// zipFiles giải nén vào map tên → nội dung.
func zipFiles(t *testing.T, b []byte) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("không giải nén được: %v", err)
	}
	out := map[string]string{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		c, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = string(c)
	}
	return out
}

// docxXML trả word/document.xml của file docx.
func docxXML(t *testing.T, b []byte) string {
	t.Helper()
	files := zipFiles(t, b)
	x, ok := files["word/document.xml"]
	if !ok {
		t.Fatal("docx thiếu word/document.xml")
	}
	if _, ok := files["[Content_Types].xml"]; !ok {
		t.Fatal("docx thiếu [Content_Types].xml")
	}
	return x
}

// docxCellTexts trả văn bản từng ô của bảng đầu tiên (theo dòng).
func docxCellTexts(xml string) [][]string {
	var rows [][]string
	tbl := xml
	if i := strings.Index(tbl, "<w:tbl>"); i >= 0 {
		tbl = tbl[i:]
	}
	if j := strings.Index(tbl, "</w:tbl>"); j >= 0 {
		tbl = tbl[:j]
	}
	for _, tr := range strings.Split(tbl, "<w:tr>")[1:] {
		var cells []string
		for _, tc := range strings.Split(tr, "<w:tc>")[1:] {
			var sb strings.Builder
			for _, part := range strings.Split(tc, `<w:t xml:space="preserve">`)[1:] {
				if k := strings.Index(part, "</w:t>"); k >= 0 {
					sb.WriteString(part[:k])
				}
			}
			cells = append(cells, sb.String())
		}
		rows = append(rows, cells)
	}
	return rows
}
