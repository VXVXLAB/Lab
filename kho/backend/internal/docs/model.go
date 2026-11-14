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
}

// NumberPrefix là tiền tố số chứng từ chính thức theo loại.
var NumberPrefix = map[string]string{
	TypePurchase:       "NK",
	TypeSaleReturn:     "NK",
	TypeSale:           "XK",
	TypePurchaseReturn: "XK",
	TypeTransfer:       "CK",
	TypeOpening:        "TDK",
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
	ProductID   int64            `json:"product_id"`
	ProductCode string           `json:"product_code"`
	Description string           `json:"description"`
	Unit        *string          `json:"unit"`
	Qty         *decimal.Decimal `json:"qty"`
	UnitPrice   *decimal.Decimal `json:"unit_price"`
	Note        string           `json:"note"`
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
