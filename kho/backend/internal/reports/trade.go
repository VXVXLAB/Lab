package reports

import (
	"context"
	"strconv"
	"time"

	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/debt"
	"kho/internal/util"
)

// ---------- Báo cáo bán hàng / mua hàng (REQ-021/066/067) ----------

// TradeParams là tham số báo cáo mua/bán.
type TradeParams struct {
	From, To       util.Date
	PartnerID      *int64
	ProductID      *int64
	GroupID        *int64
	WarehouseID    *int64
	Q              string
	IncludeReturns bool
}

// TradeRow là một dòng hàng trên phiếu mua/bán đã ghi sổ.
type TradeRow struct {
	Date        util.Date        `json:"date"`
	DocNo       string           `json:"doc_no"`
	DocumentID  int64            `json:"document_id"`
	DocType     string           `json:"doc_type"`
	PartnerID   *int64           `json:"partner_id"`
	PartnerCode *string          `json:"partner_code"`
	PartnerName *string          `json:"partner_name"`
	WarehouseID int64            `json:"warehouse_id"`
	Warehouse   string           `json:"warehouse_name"`
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
}

// Trade là báo cáo mua/bán.
type Trade struct {
	Kind        string          `json:"kind"` // sales | purchases
	From        util.Date       `json:"from"`
	To          util.Date       `json:"to"`
	Rows        []TradeRow      `json:"rows"`
	TotalQty    decimal.Decimal `json:"total_qty"`
	TotalAmount decimal.Decimal `json:"total_amount"`
	DocCount    int             `json:"document_count"`
}

// TradeReport chạy báo cáo bán hàng (kind=sales) hoặc mua hàng (kind=purchases).
// Khi include_returns=true, dòng trả hàng được đưa vào với SL và thành tiền âm.
func (s *Service) TradeReport(ctx context.Context, kind string, p TradeParams) (*Trade, error) {
	if p.To.Before(p.From.Time) {
		return nil, apperr.ValidationField("to", "Ngày kết thúc phải sau ngày bắt đầu")
	}
	main, ret := "sale", "sale_return"
	if kind == "purchases" {
		main, ret = "purchase", "purchase_return"
	}
	types := []string{main}
	if p.IncludeReturns {
		types = append(types, ret)
	}
	var w util.Where
	w.Add(`d.status='posted'`)
	w.Add(`d.doc_type = ANY(?)`, types)
	w.Add(`d.doc_date BETWEEN ? AND ?`, p.From, p.To)
	if p.PartnerID != nil {
		w.Add(`d.partner_id = ?`, *p.PartnerID)
	}
	if p.ProductID != nil {
		w.Add(`l.product_id = ?`, *p.ProductID)
	}
	if p.GroupID != nil {
		w.Add(`pr.group_id = ?`, *p.GroupID)
	}
	if p.WarehouseID != nil {
		w.Add(`d.warehouse_id = ?`, *p.WarehouseID)
	}
	if p.Q != "" {
		w.Add(`(pr.search_key LIKE ? OR COALESCE(pa.search_key,'') LIKE ? OR upper(d.doc_no) LIKE upper(?))`, util.LikePattern(p.Q), util.LikePattern(p.Q), "%"+p.Q+"%")
	}
	rows, err := s.Pool.Query(ctx, `SELECT d.doc_date, d.doc_no, d.id, d.doc_type, d.partner_id, pa.code, pa.name, d.warehouse_id, w.name,
			l.line_no, l.product_id, pr.code, pr.name, pr.is_service, l.description, l.unit,
			CASE WHEN d.doc_type=$`+itoa(len(w.Args)+1)+` THEN l.qty ELSE -l.qty END, l.unit_price,
			CASE WHEN d.doc_type=$`+itoa(len(w.Args)+1)+` THEN l.amount ELSE -l.amount END
		FROM document_lines l JOIN documents d ON d.id=l.document_id JOIN products pr ON pr.id=l.product_id
		JOIN warehouses w ON w.id=d.warehouse_id LEFT JOIN partners pa ON pa.id=d.partner_id`+w.SQL()+`
		ORDER BY d.doc_date, d.doc_no, l.line_no`, append(w.Args, main)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &Trade{Kind: kind, From: p.From, To: p.To, Rows: []TradeRow{}, TotalQty: decimal.Zero, TotalAmount: decimal.Zero}
	docs := map[int64]bool{}
	for rows.Next() {
		var r TradeRow
		if err := rows.Scan(&r.Date, &r.DocNo, &r.DocumentID, &r.DocType, &r.PartnerID, &r.PartnerCode, &r.PartnerName, &r.WarehouseID, &r.Warehouse,
			&r.LineNo, &r.ProductID, &r.ProductCode, &r.ProductName, &r.IsService, &r.Description, &r.Unit, &r.Qty, &r.UnitPrice, &r.Amount); err != nil {
			return nil, err
		}
		if r.Description == "" {
			r.Description = r.ProductName
		}
		if !r.IsService {
			out.TotalQty = out.TotalQty.Add(r.Qty)
		}
		out.TotalAmount = out.TotalAmount.Add(r.Amount)
		docs[r.DocumentID] = true
		out.Rows = append(out.Rows, r)
	}
	out.DocCount = len(docs)
	return out, rows.Err()
}

func itoa(i int) string { return strconv.Itoa(i) }

// ---------- Công nợ (REQ-052…055, 065) ----------

// DebtParams là tham số báo cáo công nợ.
type DebtParams struct {
	Side        string
	From, To    *util.Date
	Q           string
	PartnerID   int64
	IncludeZero bool
}

// DebtSummaryRow là công nợ một đối tác.
type DebtSummaryRow struct {
	PartnerID   int64           `json:"partner_id"`
	PartnerCode string          `json:"partner_code"`
	PartnerName string          `json:"partner_name"`
	Phone       string          `json:"phone"`
	Opening     decimal.Decimal `json:"opening"`
	Increase    decimal.Decimal `json:"increase"`
	Decrease    decimal.Decimal `json:"decrease"`
	Closing     decimal.Decimal `json:"closing"`
}

// DebtSummary là báo cáo tổng hợp công nợ.
type DebtSummary struct {
	Side   string           `json:"side"`
	From   *util.Date       `json:"from"`
	To     *util.Date       `json:"to"`
	Items  []DebtSummaryRow `json:"items"`
	Totals DebtSummaryRow   `json:"totals"`
}

func dateArg(d *util.Date) any {
	if d == nil {
		return nil
	}
	return *d
}

// DebtSummary tính đầu kỳ, tăng, giảm, cuối kỳ của từng đối tác.
func (s *Service) DebtSummary(ctx context.Context, p DebtParams) (*DebtSummary, error) {
	if err := debt.ValidSide(p.Side); err != nil {
		return nil, err
	}
	if p.From != nil && p.To != nil && p.To.Before(p.From.Time) {
		return nil, apperr.ValidationField("to", "Ngày kết thúc phải sau ngày bắt đầu")
	}
	flag, open := "is_customer", "opening_receivable"
	if p.Side == debt.Payable {
		flag, open = "is_supplier", "opening_payable"
	}
	args := []any{dateArg(p.From), dateArg(p.To)}
	qf := ""
	if tokens := util.SearchTokens(p.Q); len(tokens) > 0 {
		// Tìm đối tác: mọi từ có mặt, thứ tự bất kỳ, không dấu (như ô tìm đối tác).
		w := util.Where{Args: args}
		qf = ` AND ` + util.PartnerMatchSQL(&w, "pa", tokens)
		args = w.Args
	}
	rows, err := s.Pool.Query(ctx, `
WITH e AS (`+debt.EntriesSQL(p.Side)+`)
SELECT pa.id, pa.code, pa.name, pa.phone,
  pa.`+open+` + COALESCE(sum(e.increase - e.decrease) FILTER (WHERE $1::date IS NOT NULL AND e.date < $1::date), 0),
  COALESCE(sum(e.increase) FILTER (WHERE ($1::date IS NULL OR e.date >= $1::date) AND ($2::date IS NULL OR e.date <= $2::date)), 0),
  COALESCE(sum(e.decrease) FILTER (WHERE ($1::date IS NULL OR e.date >= $1::date) AND ($2::date IS NULL OR e.date <= $2::date)), 0)
FROM partners pa LEFT JOIN e ON e.partner_id = pa.id
WHERE (pa.`+flag+` OR e.partner_id IS NOT NULL OR pa.`+open+` <> 0)`+qf+`
GROUP BY pa.id, pa.code, pa.name, pa.phone, pa.`+open+`
ORDER BY pa.code`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &DebtSummary{Side: p.Side, From: p.From, To: p.To, Items: []DebtSummaryRow{}}
	out.Totals = DebtSummaryRow{Opening: decimal.Zero, Increase: decimal.Zero, Decrease: decimal.Zero, Closing: decimal.Zero}
	for rows.Next() {
		var r DebtSummaryRow
		if err := rows.Scan(&r.PartnerID, &r.PartnerCode, &r.PartnerName, &r.Phone, &r.Opening, &r.Increase, &r.Decrease); err != nil {
			return nil, err
		}
		r.Closing = r.Opening.Add(r.Increase).Sub(r.Decrease)
		if !p.IncludeZero && r.Opening.IsZero() && r.Increase.IsZero() && r.Decrease.IsZero() && r.Closing.IsZero() {
			continue
		}
		out.Items = append(out.Items, r)
		out.Totals.Opening = out.Totals.Opening.Add(r.Opening)
		out.Totals.Increase = out.Totals.Increase.Add(r.Increase)
		out.Totals.Decrease = out.Totals.Decrease.Add(r.Decrease)
		out.Totals.Closing = out.Totals.Closing.Add(r.Closing)
	}
	return out, rows.Err()
}

// DebtLedgerRow là một dòng sổ chi tiết công nợ.
type DebtLedgerRow struct {
	Date        util.Date       `json:"date"`
	RefNo       string          `json:"ref_no"`
	RefType     string          `json:"ref_type"`
	DocumentID  *int64          `json:"document_id"`
	VoucherID   *int64          `json:"voucher_id"`
	Description string          `json:"description"`
	Increase    decimal.Decimal `json:"increase"`
	Decrease    decimal.Decimal `json:"decrease"`
	Balance     decimal.Decimal `json:"balance"`
}

// DebtLedger là sổ chi tiết công nợ một đối tác.
type DebtLedger struct {
	Side          string          `json:"side"`
	Partner       DebtPartner     `json:"partner"`
	From          *util.Date      `json:"from"`
	To            *util.Date      `json:"to"`
	Opening       decimal.Decimal `json:"opening"`
	Rows          []DebtLedgerRow `json:"rows"`
	TotalIncrease decimal.Decimal `json:"total_increase"`
	TotalDecrease decimal.Decimal `json:"total_decrease"`
	Closing       decimal.Decimal `json:"closing"`
}

// DebtPartner là thông tin đối tác trên sổ công nợ.
type DebtPartner struct {
	ID      int64  `json:"id"`
	Code    string `json:"code"`
	Name    string `json:"name"`
	Address string `json:"address"`
	Phone   string `json:"phone"`
}

// DebtLedger trả sổ chi tiết công nợ: đầu kỳ, từng chứng từ / phiếu thu chi, số dư lũy kế, cuối kỳ.
func (s *Service) DebtLedger(ctx context.Context, p DebtParams) (*DebtLedger, error) {
	if err := debt.ValidSide(p.Side); err != nil {
		return nil, err
	}
	if p.PartnerID == 0 {
		return nil, apperr.ValidationField("partner_id", "Vui lòng chọn đối tác")
	}
	if p.From != nil && p.To != nil && p.To.Before(p.From.Time) {
		return nil, apperr.ValidationField("to", "Ngày kết thúc phải sau ngày bắt đầu")
	}
	out := &DebtLedger{Side: p.Side, From: p.From, To: p.To, Rows: []DebtLedgerRow{}}
	open := "opening_receivable"
	if p.Side == debt.Payable {
		open = "opening_payable"
	}
	err := s.Pool.QueryRow(ctx, `SELECT id, code, name, address, phone, `+open+` FROM partners WHERE id=$1`, p.PartnerID).
		Scan(&out.Partner.ID, &out.Partner.Code, &out.Partner.Name, &out.Partner.Address, &out.Partner.Phone, &out.Opening)
	if err != nil {
		return nil, apperr.NotFound("đối tác")
	}
	if p.From != nil {
		var before decimal.Decimal
		if err := s.Pool.QueryRow(ctx, `SELECT COALESCE(sum(e.increase - e.decrease),0) FROM (`+debt.EntriesSQL(p.Side)+`) e
			WHERE e.partner_id=$1 AND e.date < $2`, p.PartnerID, *p.From).Scan(&before); err != nil {
			return nil, err
		}
		out.Opening = out.Opening.Add(before)
	}
	rows, err := s.Pool.Query(ctx, `SELECT e.date, e.ref_no, e.ref_type, e.kind, e.ref_id, e.description, e.increase, e.decrease
		FROM (`+debt.EntriesSQL(p.Side)+`) e
		WHERE e.partner_id=$1 AND ($2::date IS NULL OR e.date >= $2::date) AND ($3::date IS NULL OR e.date <= $3::date)
		ORDER BY e.date, e.ts, e.kind, e.ref_id`, p.PartnerID, dateArg(p.From), dateArg(p.To))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bal := out.Opening
	out.TotalIncrease, out.TotalDecrease = decimal.Zero, decimal.Zero
	for rows.Next() {
		var r DebtLedgerRow
		var kind string
		var id int64
		if err := rows.Scan(&r.Date, &r.RefNo, &r.RefType, &kind, &id, &r.Description, &r.Increase, &r.Decrease); err != nil {
			return nil, err
		}
		if kind == "document" {
			r.DocumentID = &id
		} else {
			r.VoucherID = &id
		}
		bal = bal.Add(r.Increase).Sub(r.Decrease)
		r.Balance = bal
		out.TotalIncrease = out.TotalIncrease.Add(r.Increase)
		out.TotalDecrease = out.TotalDecrease.Add(r.Decrease)
		out.Rows = append(out.Rows, r)
	}
	out.Closing = bal
	return out, rows.Err()
}

// ---------- Sổ quỹ / sổ ngân hàng (REQ-056…059) ----------

// CashBookRow là một dòng sổ quỹ (mỗi dòng tiền của phiếu).
type CashBookRow struct {
	Date        util.Date       `json:"date"`
	VoucherNo   string          `json:"voucher_no"`
	VoucherID   int64           `json:"voucher_id"`
	VoucherType string          `json:"voucher_type"`
	AccountID   int64           `json:"account_id"`
	AccountCode string          `json:"account_code"`
	PartnerID   *int64          `json:"partner_id"`
	PartnerName *string         `json:"partner_name"`
	LineNo      int             `json:"line_no"`
	Description string          `json:"description"`
	DocumentID  *int64          `json:"document_id"`
	Receipt     decimal.Decimal `json:"receipt"`
	Payment     decimal.Decimal `json:"payment"`
	Balance     decimal.Decimal `json:"balance"`
}

// CashBook là sổ quỹ tiền mặt / sổ tiền gửi ngân hàng.
type CashBook struct {
	AccountID    *int64          `json:"account_id"`
	AccountName  string          `json:"account_name"`
	From         *util.Date      `json:"from"`
	To           *util.Date      `json:"to"`
	Opening      decimal.Decimal `json:"opening"`
	Rows         []CashBookRow   `json:"rows"`
	TotalReceipt decimal.Decimal `json:"total_receipt"`
	TotalPayment decimal.Decimal `json:"total_payment"`
	Closing      decimal.Decimal `json:"closing"`
}

// CashBookParams là tham số sổ quỹ.
type CashBookParams struct {
	AccountID *int64
	Kind      string
	From, To  *util.Date
}

// CashBook trả sổ quỹ có số dư lũy kế. Không chọn tài khoản ⇒ gộp mọi tài khoản (lọc theo kind nếu có).
func (s *Service) CashBook(ctx context.Context, p CashBookParams) (*CashBook, error) {
	if p.Kind != "" && p.Kind != "cash" && p.Kind != "bank" {
		return nil, apperr.ValidationField("kind", "kind phải là cash hoặc bank")
	}
	out := &CashBook{AccountID: p.AccountID, From: p.From, To: p.To, Rows: []CashBookRow{}, AccountName: "Tất cả tài khoản"}
	var acc any
	if p.AccountID != nil {
		acc = *p.AccountID
		if err := s.Pool.QueryRow(ctx, `SELECT name FROM cash_accounts WHERE id=$1`, *p.AccountID).Scan(&out.AccountName); err != nil {
			return nil, apperr.NotFound("tài khoản tiền")
		}
	} else if p.Kind == "cash" {
		out.AccountName = "Tất cả quỹ tiền mặt"
	} else if p.Kind == "bank" {
		out.AccountName = "Tất cả tài khoản ngân hàng"
	}
	var kind any
	if p.Kind != "" {
		kind = p.Kind
	}
	accFilter := `($1::bigint IS NULL OR a.id = $1::bigint) AND ($2::text IS NULL OR a.kind = $2::text)`
	if err := s.Pool.QueryRow(ctx, `SELECT COALESCE(sum(a.opening_balance),0)
		+ COALESCE((SELECT sum(CASE WHEN v.voucher_type='receipt' THEN v.total_amount ELSE -v.total_amount END)
			FROM cash_vouchers v JOIN cash_accounts a ON a.id=v.account_id WHERE `+accFilter+` AND $3::date IS NOT NULL AND v.voucher_date < $3::date),0)
		FROM cash_accounts a WHERE `+accFilter, acc, kind, dateArg(p.From)).Scan(&out.Opening); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT v.voucher_date, v.voucher_no, v.id, v.voucher_type, a.id, a.code, v.partner_id, pa.name,
			l.line_no, COALESCE(NULLIF(l.description,''), v.note), l.document_id,
			CASE WHEN v.voucher_type='receipt' THEN l.amount ELSE 0 END,
			CASE WHEN v.voucher_type='payment' THEN l.amount ELSE 0 END
		FROM cash_vouchers v JOIN cash_voucher_lines l ON l.voucher_id=v.id JOIN cash_accounts a ON a.id=v.account_id
		LEFT JOIN partners pa ON pa.id=v.partner_id
		WHERE `+accFilter+` AND ($3::date IS NULL OR v.voucher_date >= $3::date) AND ($4::date IS NULL OR v.voucher_date <= $4::date)
		ORDER BY v.voucher_date, (v.voucher_type='receipt') DESC, v.created_at, v.id, l.line_no`, acc, kind, dateArg(p.From), dateArg(p.To))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bal := out.Opening
	out.TotalReceipt, out.TotalPayment = decimal.Zero, decimal.Zero
	for rows.Next() {
		var r CashBookRow
		if err := rows.Scan(&r.Date, &r.VoucherNo, &r.VoucherID, &r.VoucherType, &r.AccountID, &r.AccountCode, &r.PartnerID, &r.PartnerName,
			&r.LineNo, &r.Description, &r.DocumentID, &r.Receipt, &r.Payment); err != nil {
			return nil, err
		}
		bal = bal.Add(r.Receipt).Sub(r.Payment)
		r.Balance = bal
		out.TotalReceipt = out.TotalReceipt.Add(r.Receipt)
		out.TotalPayment = out.TotalPayment.Add(r.Payment)
		out.Rows = append(out.Rows, r)
	}
	out.Closing = bal
	return out, rows.Err()
}

// ---------- Tổng quan (dashboard) ----------

// Dashboard là số liệu màn hình tổng quan.
type Dashboard struct {
	Today            util.Date       `json:"today"`
	DraftCount       int             `json:"draft_count"`
	DraftSaleCount   int             `json:"draft_sale_count"`
	RevenueToday     decimal.Decimal `json:"revenue_today"`
	RevenueMonth     decimal.Decimal `json:"revenue_month"`
	TotalReceivable  decimal.Decimal `json:"total_receivable"`
	TotalPayable     decimal.Decimal `json:"total_payable"`
	LowStockCount    int             `json:"low_stock_count"`
	OutOfStockCount  int             `json:"out_of_stock_count"`
	LowStockThresh   decimal.Decimal `json:"low_stock_threshold"`
	CashBalance      decimal.Decimal `json:"cash_balance"`
	BankBalance      decimal.Decimal `json:"bank_balance"`
	RecentDrafts     []RecentDraft   `json:"recent_drafts"`
	GeneratedAt      time.Time       `json:"generated_at"`
	ShortageInDrafts int             `json:"draft_shortage_count"`
}

// RecentDraft là phiếu tạm đang treo.
type RecentDraft struct {
	DocumentID    int64           `json:"document_id"`
	DocType       string          `json:"doc_type"`
	DraftNo       string          `json:"draft_no"`
	DocDate       util.Date       `json:"doc_date"`
	PartnerName   *string         `json:"partner_name"`
	TotalAmount   decimal.Decimal `json:"total_amount"`
	UpdatedByName *string         `json:"updated_by_name"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

// Dashboard tính số liệu tổng quan. "Sắp hết" = mã hàng đã từng có phát sinh và tồn tổng ≤ ngưỡng.
func (s *Service) Dashboard(ctx context.Context, threshold decimal.Decimal) (*Dashboard, error) {
	t := util.Today()
	month := util.NewDate(t.Year(), t.Month(), 1)
	d := &Dashboard{Today: t, LowStockThresh: threshold, GeneratedAt: time.Now(), RecentDrafts: []RecentDraft{}}
	err := s.Pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM documents WHERE status='draft')::int,
		(SELECT count(*) FROM documents WHERE status='draft' AND doc_type='sale')::int,
		COALESCE((SELECT sum(CASE WHEN doc_type='sale' THEN total_amount ELSE -total_amount END) FROM documents
			WHERE status='posted' AND doc_type IN ('sale','sale_return') AND doc_date=$1),0),
		COALESCE((SELECT sum(CASE WHEN doc_type='sale' THEN total_amount ELSE -total_amount END) FROM documents
			WHERE status='posted' AND doc_type IN ('sale','sale_return') AND doc_date BETWEEN $2 AND $1),0)`, t, month).
		Scan(&d.DraftCount, &d.DraftSaleCount, &d.RevenueToday, &d.RevenueMonth)
	if err != nil {
		return nil, err
	}
	if d.TotalReceivable, err = debt.Total(ctx, s.Pool, debt.Receivable); err != nil {
		return nil, err
	}
	if d.TotalPayable, err = debt.Total(ctx, s.Pool, debt.Payable); err != nil {
		return nil, err
	}
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE q <= $1)::int, count(*) FILTER (WHERE q <= 0)::int FROM (
		SELECT m.product_id, sum(m.qty_in - m.qty_out) q FROM stock_movements m JOIN products p ON p.id=m.product_id
		WHERE p.active GROUP BY m.product_id) x`, threshold).Scan(&d.LowStockCount, &d.OutOfStockCount); err != nil {
		return nil, err
	}
	if err := s.Pool.QueryRow(ctx, `SELECT
		COALESCE((SELECT sum(opening_balance) FROM cash_accounts WHERE kind='cash'),0) + COALESCE((SELECT sum(CASE WHEN v.voucher_type='receipt' THEN v.total_amount ELSE -v.total_amount END) FROM cash_vouchers v JOIN cash_accounts a ON a.id=v.account_id WHERE a.kind='cash'),0),
		COALESCE((SELECT sum(opening_balance) FROM cash_accounts WHERE kind='bank'),0) + COALESCE((SELECT sum(CASE WHEN v.voucher_type='receipt' THEN v.total_amount ELSE -v.total_amount END) FROM cash_vouchers v JOIN cash_accounts a ON a.id=v.account_id WHERE a.kind='bank'),0)`).
		Scan(&d.CashBalance, &d.BankBalance); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT d.id, d.doc_type, d.draft_no, d.doc_date, p.name, d.total_amount, u.full_name, d.updated_at
		FROM documents d LEFT JOIN partners p ON p.id=d.partner_id LEFT JOIN users u ON u.id=d.updated_by
		WHERE d.status='draft' ORDER BY d.updated_at DESC LIMIT 10`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r RecentDraft
		if err := rows.Scan(&r.DocumentID, &r.DocType, &r.DraftNo, &r.DocDate, &r.PartnerName, &r.TotalAmount, &r.UpdatedByName, &r.UpdatedAt); err != nil {
			return nil, err
		}
		d.RecentDrafts = append(d.RecentDrafts, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	dem, err := s.DraftDemand(ctx, true)
	if err != nil {
		return nil, err
	}
	d.ShortageInDrafts = len(dem)
	return d, nil
}
