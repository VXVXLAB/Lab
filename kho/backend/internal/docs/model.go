// Package docs: chứng từ kho (mua, bán, trả hàng, chuyển kho, tồn đầu kỳ) — phiếu tạm, ghi sổ,
// sửa chứng từ quá khứ, kiểm tra tồn (R3, R5, R6), cảnh báo bán lỗ (R4), mã dịch vụ (R7).
package docs

import (
	"time"

	"github.com/shopspring/decimal"

	"kho/internal/stock"
	"kho/internal/util"
)

// Loại chứng từ.
const (
	TypePurchase       = "purchase"
	TypeSale           = "sale"
	TypeSaleReturn     = "sale_return"
	TypePurchaseReturn = "purchase_return"
	TypeTransfer       = "transfer"
	TypeOpening        = "opening"
	TypeStocktake      = "stocktake" // bản mở rộng C9

	StatusDraft  = "draft"
	StatusPosted = "posted"
)

// TypeNames là tên tiếng Việt của loại chứng từ.
var TypeNames = map[string]string{
	TypePurchase:       "Phiếu nhập mua hàng",
	TypeSale:           "Phiếu bán hàng",
	TypeSaleReturn:     "Phiếu nhập hàng bán bị trả lại",
	TypePurchaseReturn: "Phiếu xuất trả hàng nhà cung cấp",
	TypeTransfer:       "Phiếu chuyển kho nội bộ",
	TypeOpening:        "Phiếu nhập tồn đầu kỳ",
	TypeStocktake:      "Phiếu kiểm kê",
}

// NumberPrefix là tiền tố số chứng từ chính thức theo loại.
var NumberPrefix = map[string]string{
	TypePurchase:       "NK",
	TypeSaleReturn:     "NK",
	TypeSale:           "XK",
	TypePurchaseReturn: "XK",
	TypeTransfer:       "CK",
	TypeOpening:        "TDK",
	TypeStocktake:      "KK",
}

// needsCustomer / needsSupplier / allowsService.
func needsCustomer(t string) bool { return t == TypeSale || t == TypeSaleReturn }
func needsSupplier(t string) bool { return t == TypePurchase || t == TypePurchaseReturn }

// AllowsService cho biết loại chứng từ có cho dòng dịch vụ hay không.
func AllowsService(t string) bool { return needsCustomer(t) || needsSupplier(t) }

// isInbound: chứng từ làm tăng tồn kho tại warehouse_id.
func isInbound(t string) bool {
	return t == TypePurchase || t == TypeSaleReturn || t == TypeOpening
}

// Line là một dòng chứng từ.
type Line struct {
	ID          int64            `json:"id"`
	LineNo      int              `json:"line_no"`
	ProductID   int64            `json:"product_id"`
	ProductCode string           `json:"product_code"`
	ProductName string           `json:"product_name"`
	IsService   bool             `json:"is_service"`
	Description string           `json:"description"`
	Unit        string           `json:"unit"`
	Qty         decimal.Decimal  `json:"qty"`
	UnitPrice   *decimal.Decimal `json:"unit_price"`
	Amount      decimal.Decimal  `json:"amount"`
	Note        string           `json:"note"`
	// Bản mở rộng (chỉ có trong JSON khi tính năng bật hoặc dữ liệu có giá trị khác mặc định):
	*LineUnit  // C10 quy đổi đơn vị
	*LineVAT   // C11 thuế GTGT
	*LineCount // C9 kiểm kê

	factor   decimal.Decimal  // hệ số quy đổi đã lưu (1 nếu không quy đổi)
	baseQty  decimal.Decimal  // SL quy về đơn vị gốc
	vatRate  *decimal.Decimal // thuế suất đã lưu
	tax      decimal.Decimal  // tiền thuế dòng
	bookQty  *decimal.Decimal // tồn sổ sách đã lưu khi ghi sổ (kiểm kê)
	baseUnit string           // đơn vị gốc của mặt hàng
}

// LineUnit: SL / đơn giá của dòng theo đơn vị đã chọn; 1 đơn vị đó = factor đơn vị gốc.
type LineUnit struct {
	Factor   decimal.Decimal `json:"factor"`
	BaseQty  decimal.Decimal `json:"base_qty"`
	BaseUnit string          `json:"base_unit"`
}

// LineVAT là thuế GTGT của dòng (vat_rate null = không thuế).
type LineVAT struct {
	VatRate       *decimal.Decimal `json:"vat_rate"`
	TaxAmount     decimal.Decimal  `json:"tax_amount"`
	AmountWithTax decimal.Decimal  `json:"amount_with_tax"`
}

// LineCount là số liệu kiểm kê của dòng (đơn vị gốc).
type LineCount struct {
	// BookQty: tồn sổ sách cuối ngày phiếu tại kho — phiếu tạm: tính lúc xem; đã ghi sổ: số đã dùng khi ghi sổ.
	BookQty    decimal.Decimal `json:"book_qty"`
	CountedQty decimal.Decimal `json:"counted_qty"`
	DiffQty    decimal.Decimal `json:"diff_qty"` // thực tế − sổ sách (> 0 thừa, < 0 thiếu)
	// Phiếu đã ghi sổ: tồn sổ sách tính lại theo sổ hiện tại (không gồm chính phiếu này); BookChanged = khác BookQty
	// (có chứng từ lùi ngày sửa lịch sử sau khi kiểm kê — điều chỉnh của phiếu giữ nguyên như lúc ghi sổ).
	CurrentBookQty *decimal.Decimal `json:"current_book_qty"`
	BookChanged    bool             `json:"book_changed"`
}

// DocVAT là tổng tiền của phiếu có thuế: tiền hàng, tiền thuế, tổng thanh toán (= total_amount) bằng chữ.
type DocVAT struct {
	GoodsAmount   decimal.Decimal `json:"goods_amount"`
	TaxAmount     decimal.Decimal `json:"tax_amount"`
	AmountInWords string          `json:"amount_in_words"`
}

// Warning là cảnh báo trên chứng từ.
type Warning struct {
	Type        string          `json:"type"` // "loss"
	LineNo      int             `json:"line_no"`
	ProductID   int64           `json:"product_id"`
	ProductCode string          `json:"product_code"`
	ProductName string          `json:"product_name"`
	UnitPrice   decimal.Decimal `json:"unit_price"`
	CostPrice   decimal.Decimal `json:"cost_price"`
	CostSource  string          `json:"cost_source"`
	Message     string          `json:"message"`
}

// Document là chứng từ đầy đủ.
type Document struct {
	ID              int64            `json:"id"`
	DocType         string           `json:"doc_type"`
	DocTypeName     string           `json:"doc_type_name"`
	DocNo           *string          `json:"doc_no"`
	DraftNo         string           `json:"draft_no"`
	DisplayNo       string           `json:"display_no"`
	DocDate         util.Date        `json:"doc_date"`
	Status          string           `json:"status"`
	PartnerID       *int64           `json:"partner_id"`
	PartnerCode     *string          `json:"partner_code"`
	PartnerName     *string          `json:"partner_name"`
	PartnerAddress  *string          `json:"partner_address"`
	PartnerPhone    *string          `json:"partner_phone"`
	WarehouseID     int64            `json:"warehouse_id"`
	WarehouseCode   string           `json:"warehouse_code"`
	WarehouseName   string           `json:"warehouse_name"`
	ToWarehouseID   *int64           `json:"to_warehouse_id"`
	ToWarehouseCode *string          `json:"to_warehouse_code"`
	ToWarehouseName *string          `json:"to_warehouse_name"`
	Note            string           `json:"note"`
	TotalAmount     decimal.Decimal  `json:"total_amount"`
	Version         int              `json:"version"`
	CreatedBy       *int64           `json:"created_by"`
	CreatedByName   *string          `json:"created_by_name"`
	UpdatedBy       *int64           `json:"updated_by"`
	UpdatedByName   *string          `json:"updated_by_name"`
	PostedBy        *int64           `json:"posted_by"`
	PostedByName    *string          `json:"posted_by_name"`
	PostedAt        *time.Time       `json:"posted_at"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
	Lines           []Line           `json:"lines"`
	Warnings        []Warning        `json:"warnings"`
	OldDebt         *decimal.Decimal `json:"old_debt"`
	TotalDebt       *decimal.Decimal `json:"total_debt"`
	*DocVAT                          // C11: chỉ khi có thuế / tính năng vat bật (phiếu mua, bán, trả hàng)
	// BookChangedLines (C9, phiếu kiểm kê đã ghi sổ): số dòng có tồn sổ sách hiện tại khác lúc ghi sổ.
	BookChangedLines *int `json:"book_changed_lines,omitempty"`

	taxAmount decimal.Decimal
}

// Summary là một dòng trong danh sách chứng từ.
type Summary struct {
	ID            int64           `json:"id"`
	DocType       string          `json:"doc_type"`
	DocTypeName   string          `json:"doc_type_name"`
	DocNo         *string         `json:"doc_no"`
	DraftNo       string          `json:"draft_no"`
	DisplayNo     string          `json:"display_no"`
	DocDate       util.Date       `json:"doc_date"`
	Status        string          `json:"status"`
	PartnerID     *int64          `json:"partner_id"`
	PartnerName   *string         `json:"partner_name"`
	WarehouseID   int64           `json:"warehouse_id"`
	WarehouseName string          `json:"warehouse_name"`
	ToWarehouseID *int64          `json:"to_warehouse_id"`
	ToWarehouse   *string         `json:"to_warehouse_name"`
	Note          string          `json:"note"`
	TotalAmount   decimal.Decimal `json:"total_amount"`
	LineCount     int             `json:"line_count"`
	Version       int             `json:"version"`
	CreatedByName *string         `json:"created_by_name"`
	UpdatedByName *string         `json:"updated_by_name"`
	PostedAt      *time.Time      `json:"posted_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

// LineInput là dòng chứng từ do client gửi.
type LineInput struct {
	// ID (tùy chọn, khi sửa): id của dòng đang có của CHÍNH phiếu này ⇒ giữ nguyên id dòng.
	// Không gửi / id không thuộc phiếu / id lặp lại ⇒ dòng mới (id mới).
	ID          int64            `json:"id"`
	ProductID   int64            `json:"product_id"`
	ProductCode string           `json:"product_code"`
	Description string           `json:"description"`
	Unit        *string          `json:"unit"`
	Qty         *decimal.Decimal `json:"qty"`
	UnitPrice   *decimal.Decimal `json:"unit_price"`
	Note        string           `json:"note"`
	// VatRate (C11): không gửi ⇒ dòng có id giữ thuế suất đang lưu, dòng mới lấy mặc định; null ⇒ không thuế.
	VatRate util.OptDec `json:"vat_rate"`
}

// Input là dữ liệu tạo/sửa chứng từ.
type Input struct {
	DocType       string      `json:"doc_type"`
	DocDate       util.Date   `json:"doc_date"`
	PartnerID     *int64      `json:"partner_id"`
	WarehouseID   int64       `json:"warehouse_id"`
	ToWarehouseID *int64      `json:"to_warehouse_id"`
	Note          string      `json:"note"`
	Lines         []LineInput `json:"lines"`
	Version       int         `json:"version"`
	ConfirmLoss   bool        `json:"confirm_loss"`
	// ConfirmCredit (bản mở rộng C8): xác nhận vượt hạn mức công nợ.
	ConfirmCredit bool `json:"confirm_credit"`
	// lenient (chỉ dùng cho kiểm tra phiếu đang gõ): bỏ qua dòng chưa chọn mặt hàng / chưa có SL hàng hóa.
	lenient bool
}

// CheckResult là kết quả kiểm tra chứng từ (không đổi dữ liệu).
type CheckResult struct {
	StockShortages []stock.Shortage `json:"stock_shortages"`
	LossLines      []Warning        `json:"loss_lines"`
	CanPost        bool             `json:"can_post"`
}

// HistoryEntry là một dòng nhật ký thay đổi.
type HistoryEntry struct {
	ID       int64     `json:"id"`
	At       time.Time `json:"at"`
	UserID   *int64    `json:"user_id"`
	UserName *string   `json:"user_name"`
	Action   string    `json:"action"`
	Before   any       `json:"before"`
	After    any       `json:"after"`
}
