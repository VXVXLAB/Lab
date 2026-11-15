package export

import (
	"fmt"
	"strings"
	"time"

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

// docPrint là cấu hình hiển thị theo loại phiếu — khớp bản in trên màn hình
// (frontend/src/pages/documents/docTypes.ts + PrintSheet.tsx, theo mẫu phiếu của khách).
type docPrint struct {
	name           string   // tên phiếu (phụ đề phiếu tạm)
	partnerLabel   string   // "" = không có đối tác
	warehouseLabel string   // nhãn dòng kho
	hasPrice       bool     // có cột Đơn giá / Thành tiền
	hasDebt        bool     // in Nợ cũ / Tổng nợ
	signers        []string // ô ký
}

var docPrints = map[string]docPrint{
	docs.TypeSale:           {"Phiếu bán hàng", "Khách hàng", "Xuất từ kho", true, true, []string{"Người lập phiếu", "Người giao hàng", "Khách hàng", "Thủ kho"}},
	docs.TypeSaleReturn:     {"Phiếu khách trả hàng", "Khách hàng", "Nhập vào kho", true, false, []string{"Người lập phiếu", "Khách hàng", "Thủ kho"}},
	docs.TypePurchase:       {"Phiếu nhập mua hàng", "Nhà cung cấp", "Nhập vào kho", true, true, []string{"Người lập phiếu", "Người giao hàng", "Thủ kho"}},
	docs.TypePurchaseReturn: {"Phiếu trả hàng nhà cung cấp", "Nhà cung cấp", "Xuất từ kho", true, false, []string{"Người lập phiếu", "Người nhận hàng", "Thủ kho"}},
	docs.TypeTransfer:       {"Phiếu chuyển kho", "", "Kho xuất", false, false, []string{"Người lập phiếu", "Thủ kho xuất", "Thủ kho nhận"}},
	docs.TypeOpening:        {"Phiếu nhập tồn đầu kỳ", "", "Nhập vào kho", true, false, []string{"Người lập phiếu", "Thủ kho"}},
}

// ServiceCodeOnPrint là mã hiển thị của dòng dịch vụ trên bản in / file xuất (đúng mẫu khách: "DICHVU").
const ServiceCodeOnPrint = "DICHVU"

const signDateLine = "Ngày …… tháng …… năm ………"

func exportStamp() string {
	return "Xuất file lúc " + time.Now().In(util.VNZone).Format("15:04 02/01/2006")
}

// DocumentTable dựng bảng xuất file cho một chứng từ — cùng nội dung, nhãn, ô ký với bản in.
func DocumentTable(d *docs.Document) Table { return DocumentTableMasked(d, false, false) }

// DocumentTableMasked như DocumentTable; hideCost (người xem không có quyền xem giá mua) bỏ cột đơn giá/thành tiền
// và Nợ cũ/Tổng nợ của phiếu mua, trả NCC, tồn đầu kỳ; hideDebt bỏ Nợ cũ/Tổng nợ.
func DocumentTableMasked(d *docs.Document, hideCost, hideDebt bool) Table {
	cfg := docPrints[d.DocType]
	if hideCost && (d.DocType == docs.TypePurchase || d.DocType == docs.TypePurchaseReturn || d.DocType == docs.TypeOpening) {
		cfg.hasPrice, cfg.hasDebt = false, false
	}
	if hideDebt {
		cfg.hasDebt = false
	}
	draft := d.Status != docs.StatusPosted
	t := Table{SheetName: d.DisplayNo}
	no := d.DisplayNo
	if draft {
		t.Title = DraftTitle
		t.Subtitle = cfg.name + " — chưa ghi sổ, chưa trừ/cộng kho, chưa vào công nợ"
		no = d.DraftNo
	} else {
		t.Title = docTitles[d.DocType]
		if d.DocNo != nil {
			no = *d.DocNo
		}
	}
	t.Info = append(t.Info, "Số: "+no+"    Ngày: "+d.DocDate.VN())
	if cfg.partnerLabel != "" {
		line := cfg.partnerLabel + ": " + str(d.PartnerName)
		if str(d.PartnerCode) != "" {
			line += " (" + str(d.PartnerCode) + ")"
		}
		t.Info = append(t.Info, line)
		// Bỏ phần trống: chỉ địa chỉ ⇒ "Địa chỉ: X"; chỉ ĐT ⇒ "ĐT: Y"; không có cả hai ⇒ không in dòng.
		var parts []string
		if a := str(d.PartnerAddress); a != "" {
			parts = append(parts, "Địa chỉ: "+a)
		}
		if ph := str(d.PartnerPhone); ph != "" {
			parts = append(parts, "ĐT: "+ph)
		}
		if len(parts) > 0 {
			t.Info = append(t.Info, strings.Join(parts, " · "))
		}
	}
	wh := cfg.warehouseLabel + ": " + d.WarehouseName
	if d.DocType == docs.TypeTransfer {
		wh += " → Kho nhận: " + str(d.ToWarehouseName)
	}
	t.Info = append(t.Info, wh)
	if d.Note != "" {
		t.Info = append(t.Info, "Ghi chú: "+d.Note)
	}
	// Cột "Ghi chú" chỉ có khi ít nhất một dòng có ghi chú; phiếu chuyển kho không có cột giá.
	hasNote := false
	for _, l := range d.Lines {
		if l.Note != "" {
			hasNote = true
		}
	}
	t.Columns = []Column{{"STT", 6, Text}, {"Mã hàng", 14, Text}, {"Tên hàng", 34, Text}, {"ĐVT", 8, Text}, {"Số lượng", 11, Qty}}
	if cfg.hasPrice {
		t.Columns = append(t.Columns, Column{"Đơn giá", 13, Money}, Column{"Thành tiền", 15, Money})
	}
	if hasNote {
		t.Columns = append(t.Columns, Column{"Ghi chú", 20, Text})
	}
	goodsQty := decimal.Zero
	for i, l := range d.Lines {
		code, name := l.ProductCode, l.ProductName
		if l.IsService {
			code, name = ServiceCodeOnPrint, l.Description
		} else {
			goodsQty = goodsQty.Add(l.Qty)
			if l.Description != "" {
				name = l.Description
			}
		}
		row := []any{i + 1, code, name, l.Unit, l.Qty}
		if cfg.hasPrice {
			var amount any = l.Amount
			if l.UnitPrice == nil {
				amount = nil
			}
			row = append(row, l.UnitPrice, amount)
		}
		if hasNote {
			row = append(row, l.Note)
		}
		t.Rows = append(t.Rows, row)
	}
	if cfg.hasPrice {
		t.Footer = [][]any{{"Cộng", nil, nil, nil, nil, nil, d.TotalAmount}}
		t.SumColumns = []int{6}
	} else {
		t.Footer = [][]any{{"Cộng", nil, nil, nil, goodsQty}}
		t.SumColumns = []int{4}
	}
	if cfg.hasDebt && d.OldDebt != nil && d.TotalDebt != nil {
		// Nhãn và số ở hai ô; Tổng nợ = công thức (Nợ cũ + Cộng) để thêm dòng sau khi xuất vẫn tự đúng.
		t.Summary = []SummaryRow{
			{Label: "Nợ cũ:", Value: *d.OldDebt},
			{Label: "Tổng nợ (đến ngày " + d.DocDate.VN() + "):", Value: *d.TotalDebt, Formula: "{s0}+{total}"},
		}
	}
	t.SignDate = signDateLine
	t.Signatures = cfg.signers
	t.SignHint = "(Ký, ghi rõ họ tên)"
	if draft {
		t.FootNote = exportStamp() + " · Phiếu tạm"
	} else {
		t.FootNote = exportStamp() + " · Ghi sổ bởi " + str(d.PostedByName)
	}
	return t
}

// VoucherTable dựng bảng xuất file cho phiếu thu/chi — cùng nội dung với bản in (có dòng "Bằng chữ").
func VoucherTable(v *cash.Voucher) Table {
	title := map[string]string{"PT": "PHIẾU THU", "PC": "PHIẾU CHI", "BC": "GIẤY BÁO CÓ (THU QUA NGÂN HÀNG)", "BN": "GIẤY BÁO NỢ (CHI QUA NGÂN HÀNG)"}[cash.Prefix(v.VoucherType, v.AccountKind)]
	receipt := v.VoucherType == cash.TypeReceipt
	t := Table{SheetName: v.VoucherNo, Title: title}
	t.Info = append(t.Info, "Số: "+v.VoucherNo+"    Ngày: "+v.VoucherDate.VN()+"    "+v.AccountName)
	who, why := "Họ tên người nhận tiền: ", "Lý do chi: "
	if receipt {
		who, why = "Họ tên người nộp tiền: ", "Lý do nộp: "
	}
	if v.PartnerName != nil {
		t.Info = append(t.Info, who+*v.PartnerName)
	} else {
		t.Info = append(t.Info, who+"……………………………………")
	}
	if str(v.PartnerAddress) != "" {
		t.Info = append(t.Info, "Địa chỉ: "+str(v.PartnerAddress))
	}
	reason := v.Note
	if reason == "" && len(v.Lines) == 1 {
		reason = v.Lines[0].Description
	}
	t.Info = append(t.Info, why+reason)
	t.Columns = []Column{{"STT", 6, Text}, {"Diễn giải", 50, Text}, {"Chứng từ liên quan", 18, Text}, {"Số tiền", 18, Money}}
	for i, l := range v.Lines {
		t.Rows = append(t.Rows, []any{i + 1, l.Description, str(l.DocumentNo), l.Amount})
	}
	t.Footer = [][]any{{"Tổng số tiền", nil, nil, v.TotalAmount}}
	t.SumColumns = []int{3}
	t.After = []string{"Bằng chữ: " + util.MoneyInWords(v.TotalAmount), "Kèm theo: ……… chứng từ gốc."}
	t.SignDate = signDateLine
	if receipt {
		t.Signatures = []string{"Giám đốc", "Kế toán trưởng", "Người nộp tiền", "Người lập phiếu", "Thủ quỹ"}
	} else {
		t.Signatures = []string{"Giám đốc", "Kế toán trưởng", "Thủ quỹ", "Người lập phiếu", "Người nhận tiền"}
	}
	t.SignHint = "(Ký, họ tên)"
	t.FootNote = exportStamp() + " · Lập bởi " + str(v.CreatedByName)
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
	// Bản mở rộng C5: có tồn tối thiểu ⇒ thêm cột Tồn tối thiểu, Cần đặt thêm.
	withMin := false
	for _, r := range rows {
		if r.MinStock != nil {
			withMin = true
		}
	}
	t.Columns = []Column{{"STT", 6, Text}, {"Mã hàng", 16, Text}, {"Tên hàng", 36, Text}, {"ĐVT", 8, Text}, {"SL trên phiếu tạm", 14, Qty},
		{"Tồn tổng", 12, Qty}, {"Thiếu", 12, Qty}}
	if withMin {
		t.Columns = append(t.Columns, Column{"Tồn tối thiểu", 12, Qty}, Column{"Cần đặt thêm", 12, Qty})
	}
	t.Columns = append(t.Columns, Column{"Phiếu tạm", 40, Text})
	for i, r := range rows {
		var ds []string
		for _, d := range r.Drafts {
			ds = append(ds, fmt.Sprintf("%s %s: %s", d.DraftNo, str(d.PartnerName), util.FormatVND(d.Qty)))
		}
		var sh any
		if r.Shortage.GreaterThan(decimal.Zero) {
			sh = r.Shortage
		}
		row := []any{i + 1, r.ProductCode, r.ProductName, r.ProductUnit, r.QtyInDrafts, r.TotalStock, sh}
		if withMin {
			row = append(row, r.MinStock, r.OrderMore)
		}
		t.Rows = append(t.Rows, append(row, strings.Join(ds, "; ")))
	}
	return t
}

// LowStockTable: hàng dưới tồn tối thiểu (bản mở rộng C5).
func LowStockTable(rows []reports.LowStockRow) Table {
	t := Table{SheetName: "Duoi ton toi thieu", Title: "HÀNG DƯỚI TỒN TỐI THIỂU", Subtitle: "Tồn tổng 4 kho tính đến thời điểm xuất báo cáo"}
	t.Columns = []Column{{"STT", 6, Text}, {"Mã hàng", 16, Text}, {"Tên hàng", 36, Text}, {"ĐVT", 8, Text}, {"Nhóm VTHH", 16, Text},
		{"Tồn tối thiểu", 12, Qty}, {"Tồn tổng", 12, Qty}, {"Cần bổ sung", 12, Qty}}
	for i, r := range rows {
		t.Rows = append(t.Rows, []any{i + 1, r.Code, r.Name, r.Unit, str(r.GroupName), r.MinStock, r.TotalStock, r.Need})
	}
	return t
}

// AgingTable: tuổi nợ phải thu (bản mở rộng C8).
func AgingTable(r *reports.Aging) Table {
	t := Table{SheetName: "Tuoi no", Title: "TUỔI NỢ PHẢI THU KHÁCH HÀNG", Subtitle: "Đến hết ngày " + r.AsOf.VN()}
	t.Columns = []Column{{"STT", 6, Text}, {"Mã KH", 12, Text}, {"Khách hàng", 34, Text}, {"Số ngày được nợ", 10, Text},
		{"Trong hạn", 14, Money}, {"Quá hạn 1–30 ngày", 14, Money}, {"31–60 ngày", 14, Money}, {"61–90 ngày", 14, Money}, {"Trên 90 ngày", 14, Money},
		{"Nợ đầu kỳ (không ngày)", 14, Money}, {"Trả trước", 14, Money}, {"Tổng nợ", 15, Money}}
	for i, x := range r.Items {
		pd := ""
		if x.PaymentDays != nil {
			pd = fmt.Sprint(*x.PaymentDays)
		}
		t.Rows = append(t.Rows, []any{i + 1, x.PartnerCode, x.PartnerName, pd, x.InTerm, x.D1to30, x.D31to60, x.D61to90, x.Over90, x.Opening, x.Prepaid, x.Total})
	}
	tt := r.Totals
	t.Footer = [][]any{{"Cộng", nil, nil, nil, tt.InTerm, tt.D1to30, tt.D31to60, tt.D61to90, tt.Over90, tt.Opening, tt.Prepaid, tt.Total}}
	t.SumColumns = []int{4, 5, 6, 7, 8, 9, 10, 11}
	return t
}

// ProfitTable: lãi gộp (bản mở rộng C7).
func ProfitTable(r *reports.Profit) Table {
	by := map[string]string{"document": "theo phiếu", "product": "theo mặt hàng", "customer": "theo khách hàng"}[r.GroupBy]
	t := Table{SheetName: "Lai gop", Title: "BÁO CÁO LÃI GỘP " + strings.ToUpper(by), Subtitle: rangeText(&r.From, &r.To)}
	var lead []Column
	switch r.GroupBy {
	case "document":
		lead = []Column{{"Ngày", 12, Date}, {"Số phiếu", 12, Text}, {"Khách hàng", 30, Text}}
	case "product":
		lead = []Column{{"Mã hàng", 14, Text}, {"Tên hàng", 32, Text}, {"ĐVT", 8, Text}, {"SL bán", 11, Qty}}
	default:
		lead = []Column{{"Mã KH", 12, Text}, {"Khách hàng", 34, Text}}
	}
	t.Columns = append([]Column{{"STT", 6, Text}}, lead...)
	t.Columns = append(t.Columns, Column{"Doanh thu", 15, Money}, Column{"Giá vốn", 15, Money}, Column{"Lãi gộp", 15, Money},
		Column{"Tỷ lệ lãi (%)", 10, Money}, Column{"Ước tính", 8, Text})
	pct := func(m *decimal.Decimal) any {
		if m == nil {
			return nil
		}
		return *m
	}
	est := func(b bool) string {
		if b {
			return "x"
		}
		return ""
	}
	for i, x := range r.Items {
		row := []any{i + 1}
		switch r.GroupBy {
		case "document":
			row = append(row, x.DocDate, str(x.DocNo), str(x.PartnerName))
		case "product":
			row = append(row, str(x.ProductCode), str(x.ProductName), str(x.Unit), x.Qty)
		default:
			row = append(row, str(x.PartnerCode), str(x.PartnerName))
		}
		t.Rows = append(t.Rows, append(row, x.Revenue, x.Cost, x.Profit, pct(x.Margin), est(x.Estimated)))
	}
	n := len(t.Columns)
	foot := make([]any, n)
	foot[0] = "Cộng"
	foot[n-5], foot[n-4], foot[n-3], foot[n-2] = r.Totals.Revenue, r.Totals.Cost, r.Totals.Profit, pct(r.Totals.Margin)
	t.Footer = [][]any{foot}
	t.SumColumns = []int{n - 5, n - 4, n - 3}
	return t
}
