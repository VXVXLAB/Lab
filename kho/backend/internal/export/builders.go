package export

import (
	"fmt"
	"strings"

	"github.com/shopspring/decimal"

	"kho/internal/cash"
	"kho/internal/docs"
	"kho/internal/reports"
	"kho/internal/util"
)

// DraftTitle là tiêu đề bắt buộc của phiếu tạm khi in/xuất (R5).
const DraftTitle = "PHIẾU TẠM (chưa ghi sổ)"

var docTitles = map[string]string{
	docs.TypeSale:           "PHIẾU XUẤT KHO BÁN HÀNG",
	docs.TypePurchase:       "PHIẾU NHẬP KHO MUA HÀNG",
	docs.TypeSaleReturn:     "PHIẾU NHẬP HÀNG BÁN BỊ TRẢ LẠI",
	docs.TypePurchaseReturn: "PHIẾU XUẤT TRẢ HÀNG NHÀ CUNG CẤP",
	docs.TypeTransfer:       "PHIẾU CHUYỂN KHO NỘI BỘ",
	docs.TypeOpening:        "PHIẾU NHẬP TỒN ĐẦU KỲ",
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// DocumentTable dựng bảng xuất file cho một chứng từ.
func DocumentTable(d *docs.Document) Table {
	t := Table{SheetName: d.DisplayNo}
	if d.Status == docs.StatusPosted {
		t.Title = docTitles[d.DocType]
	} else {
		t.Title = DraftTitle
		t.Subtitle = d.DocTypeName + " — chưa ghi sổ, chỉ để khách hàng xem / đặt hàng"
	}
	no := "Số phiếu: " + d.DisplayNo
	if d.Status != docs.StatusPosted {
		no = "Số phiếu tạm: " + d.DraftNo
	}
	t.Info = append(t.Info, no+"    Ngày: "+d.DocDate.VN())
	switch d.DocType {
	case docs.TypeSale, docs.TypeSaleReturn:
		t.Info = append(t.Info, "Khách hàng: "+str(d.PartnerName))
	case docs.TypePurchase, docs.TypePurchaseReturn:
		t.Info = append(t.Info, "Nhà cung cấp: "+str(d.PartnerName))
	}
	if d.PartnerID != nil {
		if str(d.PartnerAddress) != "" {
			t.Info = append(t.Info, "Địa chỉ: "+str(d.PartnerAddress))
		}
		if str(d.PartnerPhone) != "" {
			t.Info = append(t.Info, "Điện thoại: "+str(d.PartnerPhone))
		}
	}
	if d.DocType == docs.TypeTransfer {
		t.Info = append(t.Info, "Kho xuất: "+d.WarehouseName+"    Kho nhận: "+str(d.ToWarehouseName))
	} else {
		t.Info = append(t.Info, "Kho: "+d.WarehouseName)
	}
	if d.Note != "" {
		t.Info = append(t.Info, "Ghi chú: "+d.Note)
	}
	t.Columns = []Column{{"STT", 6, Text}, {"Mã hàng", 14, Text}, {"Tên hàng", 34, Text}, {"ĐVT", 8, Text},
		{"Số lượng", 11, Qty}, {"Đơn giá", 13, Money}, {"Thành tiền", 15, Money}, {"Ghi chú", 16, Text}}
	for i, l := range d.Lines {
		name := l.ProductName
		if l.IsService {
			if l.Description != "" {
				name = l.Description
			}
		} else if l.Description != "" && l.Description != l.ProductName {
			name = l.ProductName + " - " + l.Description
		}
		var amount any = l.Amount
		if l.UnitPrice == nil {
			amount = nil
		}
		t.Rows = append(t.Rows, []any{i + 1, l.ProductCode, name, l.Unit, l.Qty, l.UnitPrice, amount, l.Note})
	}
	t.Footer = [][]any{{"Cộng", nil, nil, nil, nil, nil, d.TotalAmount, nil}}
	t.SumColumns = []int{6}
	if d.OldDebt != nil && d.TotalDebt != nil {
		// Nhãn và số ở hai ô; Tổng nợ = công thức (Nợ cũ + Cộng) để thêm dòng sau khi xuất vẫn tự đúng.
		t.Summary = []SummaryRow{
			{Label: "Nợ cũ:", Value: *d.OldDebt},
			{Label: "Tổng nợ (đến ngày " + d.DocDate.VN() + "):", Value: *d.TotalDebt, Formula: "{s0}+{total}"},
		}
	}
	switch d.DocType {
	case docs.TypeSale:
		t.Signatures = []string{"Người lập phiếu", "Thủ kho", "Khách hàng"}
	case docs.TypePurchase:
		t.Signatures = []string{"Người lập phiếu", "Thủ kho", "Người giao hàng"}
	default:
		t.Signatures = []string{"Người lập phiếu", "Thủ kho"}
	}
	return t
}

// VoucherTable dựng bảng xuất file cho phiếu thu/chi.
func VoucherTable(v *cash.Voucher) Table {
	title := map[string]string{"PT": "PHIẾU THU", "PC": "PHIẾU CHI", "BC": "GIẤY BÁO CÓ (THU QUA NGÂN HÀNG)", "BN": "GIẤY BÁO NỢ (CHI QUA NGÂN HÀNG)"}[cash.Prefix(v.VoucherType, v.AccountKind)]
	t := Table{SheetName: v.VoucherNo, Title: title}
	t.Info = append(t.Info, "Số: "+v.VoucherNo+"    Ngày: "+v.VoucherDate.VN())
	t.Info = append(t.Info, "Tài khoản: "+v.AccountName)
	label := "Người nộp tiền / đối tượng: "
	if v.VoucherType == cash.TypePayment {
		label = "Người nhận tiền / đối tượng: "
	}
	if v.PartnerName != nil {
		t.Info = append(t.Info, label+*v.PartnerName)
		if str(v.PartnerAddress) != "" {
			t.Info = append(t.Info, "Địa chỉ: "+str(v.PartnerAddress))
		}
	}
	if v.Note != "" {
		t.Info = append(t.Info, "Lý do: "+v.Note)
	}
	t.Columns = []Column{{"STT", 6, Text}, {"Diễn giải", 50, Text}, {"Chứng từ liên quan", 18, Text}, {"Số tiền", 18, Money}}
	for i, l := range v.Lines {
		t.Rows = append(t.Rows, []any{i + 1, l.Description, str(l.DocumentNo), l.Amount})
	}
	t.Footer = [][]any{{"Cộng", nil, nil, v.TotalAmount}}
	t.SumColumns = []int{3}
	t.Summary = []SummaryRow{{Label: "Tổng số tiền (đồng):", Value: v.TotalAmount, Formula: "{total}"}}
	if v.VoucherType == cash.TypeReceipt {
		t.Signatures = []string{"Người lập phiếu", "Người nộp tiền", "Thủ quỹ"}
	} else {
		t.Signatures = []string{"Người lập phiếu", "Người nhận tiền", "Thủ quỹ"}
	}
	return t
}

func rangeText(from, to *util.Date) string {
	switch {
	case from != nil && to != nil:
		return "Từ ngày " + from.VN() + " đến ngày " + to.VN()
	case from != nil:
		return "Từ ngày " + from.VN()
	case to != nil:
		return "Đến ngày " + to.VN()
	}
	return "Toàn bộ thời gian"
}

// StockSummaryTable: báo cáo tồn kho (tổng 4 kho và từng kho).
func StockSummaryTable(r *reports.StockSummary) Table {
	t := Table{SheetName: "Ton kho", Title: "BÁO CÁO TỒN KHO", Subtitle: "Đến hết ngày " + r.AsOf.VN()}
	t.Columns = []Column{{"STT", 6, Text}, {"Mã hàng", 16, Text}, {"Tên hàng", 36, Text}, {"ĐVT", 8, Text}, {"Nhóm VTHH", 18, Text}}
	for _, w := range r.Warehouses {
		t.Columns = append(t.Columns, Column{w.Name, 12, Qty})
	}
	t.Columns = append(t.Columns, Column{"Tổng tồn", 13, Qty})
	for i, it := range r.Items {
		row := []any{i + 1, it.Code, it.Name, it.Unit, str(it.GroupName)}
		for _, w := range r.Warehouses {
			row = append(row, it.ByWarehouse[fmt.Sprint(w.ID)])
		}
		row = append(row, it.Total)
		t.Rows = append(t.Rows, row)
	}
	foot := []any{"Cộng", nil, fmt.Sprintf("%d mã hàng", len(r.Items)), nil, nil}
	for _, w := range r.Warehouses {
		foot = append(foot, r.Totals[fmt.Sprint(w.ID)])
	}
	foot = append(foot, r.TotalQty)
	t.Footer = [][]any{foot}
	for i := 5; i < len(t.Columns); i++ {
		t.SumColumns = append(t.SumColumns, i)
	}
	return t
}

// NXTTable: tổng hợp nhập xuất tồn.
func NXTTable(r *reports.NXT, warehouseName string) Table {
	t := Table{SheetName: "NXT", Title: "BÁO CÁO TỔNG HỢP NHẬP - XUẤT - TỒN", Subtitle: rangeText(&r.From, &r.To) + " — " + warehouseName}
	t.Columns = []Column{{"STT", 6, Text}, {"Mã hàng", 16, Text}, {"Tên hàng", 36, Text}, {"ĐVT", 8, Text}, {"Nhóm VTHH", 16, Text},
		{"Tồn đầu kỳ", 12, Qty}, {"Nhập", 12, Qty}, {"Xuất", 12, Qty}, {"Tồn cuối kỳ", 12, Qty}}
	for i, it := range r.Items {
		t.Rows = append(t.Rows, []any{i + 1, it.Code, it.Name, it.Unit, str(it.GroupName), it.Opening, it.QtyIn, it.QtyOut, it.Closing})
	}
	t.Footer = [][]any{{"Cộng", nil, nil, nil, nil, r.Totals.Opening, r.Totals.QtyIn, r.Totals.QtyOut, r.Totals.Closing}}
	t.SumColumns = []int{5, 6, 7, 8}
	return t
}

// LedgerTable: thẻ kho / chi tiết NXT một mã (đúng mẫu của khách).
func LedgerTable(r *reports.Ledger, warehouseName string) Table {
	t := Table{SheetName: "The kho " + r.Product.Code, Title: "CHI TIẾT NHẬP - XUẤT - TỒN",
		Subtitle: "Mã hàng: " + r.Product.Code + " - " + r.Product.Name + " — " + rangeText(r.From, r.To) + " — " + warehouseName}
	t.Columns = []Column{{"Mã hàng", 14, Text}, {"Ngày hạch toán", 13, Date}, {"Số chứng từ", 12, Text}, {"Diễn giải", 44, Text},
		{"ĐVT", 8, Text}, {"Nhập", 10, Qty}, {"Xuất", 10, Qty}, {"Tồn", 10, Qty}}
	t.Rows = append(t.Rows, []any{r.Product.Code, nil, nil, "Số dư đầu kỳ", r.Product.Unit, nil, nil, r.Opening})
	for _, x := range r.Rows {
		var in, out any
		if !x.QtyIn.IsZero() {
			in = x.QtyIn
		}
		if !x.QtyOut.IsZero() {
			out = x.QtyOut
		}
		t.Rows = append(t.Rows, []any{x.ProductCode, x.Date, x.DocNo, x.Description, x.Unit, in, out, x.Balance})
	}
	t.Footer = [][]any{{"Cộng", nil, nil, nil, nil, r.TotalIn, r.TotalOut, r.Closing}}
	t.SumColumns = []int{5, 6}
	return t
}

// TradeTable: báo cáo bán hàng / mua hàng.
func TradeTable(r *reports.Trade) Table {
	title, who := "BÁO CÁO CHI TIẾT BÁN HÀNG", "Khách hàng"
	if r.Kind == "purchases" {
		title, who = "BÁO CÁO CHI TIẾT MUA HÀNG", "Nhà cung cấp"
	}
	t := Table{SheetName: "Chi tiet", Title: title, Subtitle: rangeText(&r.From, &r.To)}
	t.Columns = []Column{{"Ngày", 12, Date}, {"Số phiếu", 11, Text}, {who, 30, Text}, {"Mã hàng", 14, Text}, {"Tên hàng", 32, Text},
		{"ĐVT", 8, Text}, {"Số lượng", 11, Qty}, {"Đơn giá", 13, Money}, {"Thành tiền", 15, Money}}
	for _, x := range r.Rows {
		name := x.ProductName
		if x.IsService && x.Description != "" {
			name = x.Description
		}
		var amt any = x.Amount
		if x.UnitPrice == nil {
			amt = nil
		}
		t.Rows = append(t.Rows, []any{x.Date, x.DocNo, str(x.PartnerName), x.ProductCode, name, x.Unit, x.Qty, x.UnitPrice, amt})
	}
	t.Footer = [][]any{{"Cộng", nil, fmt.Sprintf("%d phiếu", r.DocCount), nil, nil, nil, r.TotalQty, nil, r.TotalAmount}}
	t.SumColumns = []int{8} // cột SL gồm cả dòng dịch vụ nên tổng SL (chỉ hàng hóa) giữ dạng số
	return t
}

// DebtSummaryTable: tổng hợp công nợ.
func DebtSummaryTable(r *reports.DebtSummary) Table {
	title, who := "TỔNG HỢP CÔNG NỢ PHẢI THU KHÁCH HÀNG", "Khách hàng"
	if r.Side == "payable" {
		title, who = "TỔNG HỢP CÔNG NỢ PHẢI TRẢ NHÀ CUNG CẤP", "Nhà cung cấp"
	}
	t := Table{SheetName: "Cong no", Title: title, Subtitle: rangeText(r.From, r.To)}
	t.Columns = []Column{{"STT", 6, Text}, {"Mã", 12, Text}, {who, 36, Text}, {"Điện thoại", 14, Text},
		{"Đầu kỳ", 15, Money}, {"Phát sinh tăng", 15, Money}, {"Phát sinh giảm", 15, Money}, {"Cuối kỳ", 15, Money}}
	for i, x := range r.Items {
		t.Rows = append(t.Rows, []any{i + 1, x.PartnerCode, x.PartnerName, x.Phone, x.Opening, x.Increase, x.Decrease, x.Closing})
	}
	t.Footer = [][]any{{"Cộng", nil, nil, nil, r.Totals.Opening, r.Totals.Increase, r.Totals.Decrease, r.Totals.Closing}}
	t.SumColumns = []int{4, 5, 6, 7}
	return t
}

// DebtLedgerTable: sổ chi tiết công nợ một đối tác.
func DebtLedgerTable(r *reports.DebtLedger) Table {
	title := "SỔ CHI TIẾT CÔNG NỢ PHẢI THU"
	if r.Side == "payable" {
		title = "SỔ CHI TIẾT CÔNG NỢ PHẢI TRẢ"
	}
	t := Table{SheetName: "So cong no", Title: title, Subtitle: r.Partner.Code + " - " + r.Partner.Name + " — " + rangeText(r.From, r.To)}
	t.Columns = []Column{{"Ngày", 12, Date}, {"Số chứng từ", 12, Text}, {"Diễn giải", 44, Text}, {"Phát sinh tăng", 15, Money}, {"Phát sinh giảm", 15, Money}, {"Số dư", 15, Money}}
	t.Rows = append(t.Rows, []any{nil, nil, "Số dư đầu kỳ", nil, nil, r.Opening})
	for _, x := range r.Rows {
		var inc, dec any
		if !x.Increase.IsZero() {
			inc = x.Increase
		}
		if !x.Decrease.IsZero() {
			dec = x.Decrease
		}
		t.Rows = append(t.Rows, []any{x.Date, x.RefNo, x.Description, inc, dec, x.Balance})
	}
	t.Footer = [][]any{{"Cộng", nil, nil, r.TotalIncrease, r.TotalDecrease, r.Closing}}
	t.SumColumns = []int{3, 4}
	return t
}

// CashBookTable: sổ quỹ / sổ ngân hàng.
func CashBookTable(r *reports.CashBook) Table {
	t := Table{SheetName: "So quy", Title: "SỔ QUỸ / SỔ TIỀN GỬI NGÂN HÀNG", Subtitle: r.AccountName + " — " + rangeText(r.From, r.To)}
	t.Columns = []Column{{"Ngày", 12, Date}, {"Số phiếu", 11, Text}, {"Đối tượng", 28, Text}, {"Diễn giải", 36, Text}, {"Thu", 15, Money}, {"Chi", 15, Money}, {"Tồn", 15, Money}}
	t.Rows = append(t.Rows, []any{nil, nil, nil, "Số dư đầu kỳ", nil, nil, r.Opening})
	for _, x := range r.Rows {
		var rc, pm any
		if !x.Receipt.IsZero() {
			rc = x.Receipt
		}
		if !x.Payment.IsZero() {
			pm = x.Payment
		}
		t.Rows = append(t.Rows, []any{x.Date, x.VoucherNo, str(x.PartnerName), x.Description, rc, pm, x.Balance})
	}
	t.Footer = [][]any{{"Cộng", nil, nil, nil, r.TotalReceipt, r.TotalPayment, r.Closing}}
	t.SumColumns = []int{4, 5}
	return t
}

// DemandTable: hàng cần đặt từ phiếu bán tạm.
func DemandTable(rows []reports.DemandRow) Table {
	t := Table{SheetName: "Hang can dat", Title: "HÀNG CẦN ĐẶT (TỪ PHIẾU BÁN TẠM)", Subtitle: "Tồn tính đến thời điểm xuất báo cáo"}
	t.Columns = []Column{{"STT", 6, Text}, {"Mã hàng", 16, Text}, {"Tên hàng", 36, Text}, {"ĐVT", 8, Text}, {"SL trên phiếu tạm", 14, Qty},
		{"Tồn tổng", 12, Qty}, {"Thiếu", 12, Qty}, {"Phiếu tạm", 40, Text}}
	for i, r := range rows {
		var ds []string
		for _, d := range r.Drafts {
			ds = append(ds, fmt.Sprintf("%s %s: %s", d.DraftNo, str(d.PartnerName), util.FormatVND(d.Qty)))
		}
		var sh any
		if r.Shortage.GreaterThan(decimal.Zero) {
			sh = r.Shortage
		}
		t.Rows = append(t.Rows, []any{i + 1, r.ProductCode, r.ProductName, r.ProductUnit, r.QtyInDrafts, r.TotalStock, sh, strings.Join(ds, "; ")})
	}
	return t
}
