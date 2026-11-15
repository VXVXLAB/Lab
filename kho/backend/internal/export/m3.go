package export

import (
	"github.com/shopspring/decimal"

	"kho/internal/docs"
	"kho/internal/reports"
	"kho/internal/util"
)

// PrintOpts là mẫu in (bản mở rộng C12) áp vào file xuất: tên ô ký (nil ⇒ mặc định), dòng chân trang, ẩn cột.
type PrintOpts struct {
	Signatures []string
	Footer     string
	HideUnit   bool
	HideCode   bool
}

// DefaultSignatures trả tên các ô ký mặc định theo loại phiếu (doc_type, "receipt", "payment").
func DefaultSignatures() map[string][]string {
	out := map[string][]string{}
	for k, v := range docPrints {
		out[k] = append([]string(nil), v.signers...)
	}
	out["receipt"] = []string{"Giám đốc", "Kế toán trưởng", "Người nộp tiền", "Người lập phiếu", "Thủ quỹ"}
	out["payment"] = []string{"Giám đốc", "Kế toán trưởng", "Thủ quỹ", "Người lập phiếu", "Người nhận tiền"}
	return out
}

// DocumentTableOpts như DocumentTableMasked, áp thêm mẫu in.
func DocumentTableOpts(d *docs.Document, hideCost, hideDebt bool, o *PrintOpts) Table {
	t := DocumentTableMasked(d, hideCost, hideDebt)
	applyOpts(&t, o, true)
	return t
}

// VoucherTableOpts như VoucherTable, áp thêm mẫu in (tên ô ký, chân trang).
func VoucherTableOpts(t Table, o *PrintOpts) Table {
	applyOpts(&t, o, false)
	return t
}

func applyOpts(t *Table, o *PrintOpts, doc bool) {
	if o == nil {
		return
	}
	if o.Signatures != nil {
		t.Signatures = o.Signatures
	}
	if o.Footer != "" {
		t.FootNote = o.Footer + " · " + t.FootNote
	}
	if doc {
		if o.HideUnit {
			dropColumn(t, "ĐVT")
		}
		if o.HideCode {
			dropColumn(t, "Mã hàng")
		}
	}
}

// dropColumn bỏ một cột (theo tiêu đề) khỏi bảng, dời chỉ số cột tổng.
func dropColumn(t *Table, header string) {
	idx := -1
	for i, c := range t.Columns {
		if c.Header == header {
			idx = i
		}
	}
	if idx < 0 {
		return
	}
	cut := func(r []any) []any {
		if idx >= len(r) {
			return r
		}
		return append(append([]any{}, r[:idx]...), r[idx+1:]...)
	}
	t.Columns = append(append([]Column{}, t.Columns[:idx]...), t.Columns[idx+1:]...)
	for i := range t.Rows {
		t.Rows[i] = cut(t.Rows[i])
	}
	for i := range t.Footer {
		t.Footer[i] = cut(t.Footer[i])
	}
	for i, c := range t.SumColumns {
		if c > idx {
			t.SumColumns[i] = c - 1
		}
	}
}

// stocktakeTable: biên bản kiểm kê (đơn vị gốc): tồn sổ sách, thực tế, chênh lệch.
func stocktakeTable(d *docs.Document, t Table) Table {
	t.Columns = []Column{{"STT", 6, Text}, {"Mã hàng", 14, Text}, {"Tên hàng", 34, Text}, {"ĐVT", 8, Text},
		{"Tồn sổ sách", 13, Qty}, {"Thực tế", 13, Qty}, {"Chênh lệch", 13, Qty}, {"Ghi chú", 20, Text}}
	t.Rows = nil
	for i, l := range d.Lines {
		var book, counted, diff any
		unit := l.Unit
		if l.LineCount != nil {
			book, counted, diff = l.BookQty, l.CountedQty, l.DiffQty
		}
		if l.LineUnit != nil {
			unit = l.BaseUnit
		}
		t.Rows = append(t.Rows, []any{i + 1, l.ProductCode, l.ProductName, unit, book, counted, diff, l.Note})
	}
	t.Footer = nil
	t.SumColumns = nil
	t.Summary = nil
	return t
}

// vatSummary: phiếu có thuế ⇒ cột Thuế suất / Tiền thuế và ba dòng tổng; Nợ cũ / Tổng nợ không dùng công thức.
func vatColumns(d *docs.Document, t *Table, priceCols bool) {
	if d.DocVAT == nil || !priceCols {
		return
	}
	t.Columns = append(t.Columns[:7:7], append([]Column{{"Thuế suất", 9, Text}, {"Tiền thuế", 13, Money}}, t.Columns[7:]...)...)
	for i, l := range d.Lines {
		rate, tax := "", any(nil)
		if l.LineVAT != nil {
			rate = reports.VatLabel(l.VatRate)
			if l.VatRate == nil {
				rate = "KCT"
			}
			tax = l.TaxAmount
		}
		r := t.Rows[i]
		t.Rows[i] = append(r[:7:7], append([]any{rate, tax}, r[7:]...)...)
	}
	if len(t.Footer) > 0 {
		f := t.Footer[0]
		for len(f) < 7 {
			f = append(f, nil)
		}
		t.Footer[0] = append(f[:7:7], nil, d.TaxAmount)
		t.SumColumns = []int{6, 8}
	}
	vs := []SummaryRow{
		{Label: "Cộng tiền hàng:", Value: d.GoodsAmount},
		{Label: "Tiền thuế GTGT:", Value: d.TaxAmount},
		{Label: "Tổng thanh toán:", Value: d.TotalAmount},
	}
	for _, s := range t.Summary {
		s.Formula = ""
		vs = append(vs, s)
	}
	t.Summary = vs
	t.After = append(t.After, "Bằng chữ: "+util.MoneyInWords(d.TotalAmount))
}

// mixedUnits: phiếu có dòng dùng đơn vị quy đổi (cộng SL các dòng không còn ý nghĩa).
func mixedUnits(d *docs.Document) bool {
	for _, l := range d.Lines {
		if l.LineUnit != nil && !l.Factor.Equal(decimal.NewFromInt(1)) {
			return true
		}
	}
	return false
}

// VatTable: bảng kê thuế GTGT theo thuế suất (bán ra, mua vào nếu được xem).
func VatTable(r *reports.VatReport) Table {
	t := Table{SheetName: "Thue GTGT", Title: "BẢNG KÊ THUẾ GTGT THEO THUẾ SUẤT", Subtitle: "Từ ngày " + r.From.VN() + " đến ngày " + r.To.VN()}
	t.Columns = []Column{{"Phần", 14, Text}, {"Thuế suất", 18, Text}, {"Tiền hàng", 16, Money}, {"Tiền thuế", 16, Money}, {"Tổng thanh toán", 18, Money}}
	add := func(name string, s *reports.VatSide) {
		if s == nil {
			return
		}
		for _, x := range s.Rows {
			t.Rows = append(t.Rows, []any{name, x.Label, x.GoodsAmount, x.TaxAmount, x.Total})
		}
		t.Rows = append(t.Rows, []any{name, "Cộng " + name, s.Totals.GoodsAmount, s.Totals.TaxAmount, s.Totals.Total})
	}
	add("Bán ra", r.Sales)
	add("Mua vào", r.Purchases)
	t.FootNote = exportStamp()
	return t
}
