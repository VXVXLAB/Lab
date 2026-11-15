package reports

// Báo cáo của bản mở rộng đợt M2: hàng dưới tồn tối thiểu (C5), tuổi nợ phải thu (C8), lãi gộp (C7).

import (
	"context"
	"sort"
	"time"

	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/debt"
	"kho/internal/util"
)

// ---------- C5 tồn tối thiểu ----------

// LowStockRow là một mã có tồn tổng ≤ tồn tối thiểu.
type LowStockRow struct {
	ProductID  int64           `json:"product_id"`
	Code       string          `json:"code"`
	Name       string          `json:"name"`
	Unit       string          `json:"unit"`
	GroupName  *string         `json:"group_name"`
	MinStock   decimal.Decimal `json:"min_stock"`
	TotalStock decimal.Decimal `json:"total_stock"`
	Need       decimal.Decimal `json:"need"` // min_stock − tồn (≥ 0)
}

const lowStockSQL = `
SELECT p.id, p.code, p.name, p.unit, g.name, p.min_stock, COALESCE(m.q, 0)
  FROM products p LEFT JOIN product_groups g ON g.id = p.group_id
  LEFT JOIN (SELECT product_id, sum(qty_in - qty_out) AS q FROM stock_movements GROUP BY product_id) m ON m.product_id = p.id
 WHERE p.active AND NOT p.is_service AND p.min_stock IS NOT NULL AND COALESCE(m.q, 0) <= p.min_stock`

// LowStock trả các mã (đang dùng, đã đặt tồn tối thiểu) có tồn tổng 4 kho hiện tại ≤ tồn tối thiểu.
func (s *Service) LowStock(ctx context.Context) ([]LowStockRow, error) {
	rows, err := s.Pool.Query(ctx, lowStockSQL+` ORDER BY p.code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LowStockRow{}
	for rows.Next() {
		var r LowStockRow
		if err := rows.Scan(&r.ProductID, &r.Code, &r.Name, &r.Unit, &r.GroupName, &r.MinStock, &r.TotalStock); err != nil {
			return nil, err
		}
		r.Need = r.MinStock.Sub(r.TotalStock)
		out = append(out, r)
	}
	return out, rows.Err()
}

// LowStockCountMin đếm số mã dưới tồn tối thiểu (dùng cho dashboard khi tính năng bật).
func (s *Service) LowStockCountMin(ctx context.Context) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM (`+lowStockSQL+`) x`).Scan(&n)
	return n, err
}

// DraftDemandMin như DraftDemand, thêm tồn tối thiểu và SL cần đặt thêm; thêm cả các mã dưới tồn tối thiểu dù không
// có trên phiếu tạm. Cần đặt thêm = max(0, tồn tối thiểu − (tồn − SL trên phiếu tạm)).
func (s *Service) DraftDemandMin(ctx context.Context, onlyShortage bool) ([]DemandRow, error) {
	base, err := s.DraftDemand(ctx, false)
	if err != nil {
		return nil, err
	}
	idx := map[int64]int{}
	for i, r := range base {
		idx[r.ProductID] = i
	}
	rows, err := s.Pool.Query(ctx, `
SELECT p.id, p.code, p.name, p.unit, p.min_stock, COALESCE(m.q, 0)
  FROM products p
  LEFT JOIN (SELECT product_id, sum(qty_in - qty_out) AS q FROM stock_movements GROUP BY product_id) m ON m.product_id = p.id
 WHERE p.active AND NOT p.is_service AND p.min_stock IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var pr LedgerProduct
		var min, stock decimal.Decimal
		if err := rows.Scan(&pr.ID, &pr.Code, &pr.Name, &pr.Unit, &min, &stock); err != nil {
			return nil, err
		}
		i, ok := idx[pr.ID]
		if !ok {
			if stock.GreaterThan(min) {
				continue
			}
			base = append(base, DemandRow{Product: pr, ProductID: pr.ID, ProductCode: pr.Code, ProductName: pr.Name, ProductUnit: pr.Unit,
				QtyInDrafts: decimal.Zero, TotalStock: stock, Shortage: decimal.Zero, Drafts: []DemandDraft{}})
			i = len(base) - 1
			idx[pr.ID] = i
		}
		m := min
		base[i].MinStock = &m
		more := min.Sub(base[i].TotalStock.Sub(base[i].QtyInDrafts))
		if more.IsNegative() {
			more = decimal.Zero
		}
		base[i].OrderMore = &more
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []DemandRow{}
	for _, r := range base {
		if onlyShortage && !r.Shortage.IsPositive() && (r.OrderMore == nil || !r.OrderMore.IsPositive()) {
			continue
		}
		out = append(out, r)
	}
	om := func(r DemandRow) decimal.Decimal {
		if r.OrderMore == nil {
			return decimal.Zero
		}
		return *r.OrderMore
	}
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].Shortage.Equal(out[j].Shortage) {
			return out[i].Shortage.GreaterThan(out[j].Shortage)
		}
		return om(out[i]).GreaterThan(om(out[j]))
	})
	return out, nil
}

// ---------- C8 tuổi nợ phải thu ----------

// AgingItem là một khoản nợ còn mở (sau khi trừ FIFO) của khách.
type AgingItem struct {
	Date        util.Date       `json:"date"`
	DueDate     util.Date       `json:"due_date"`
	RefNo       string          `json:"ref_no"`
	RefType     string          `json:"ref_type"`
	DocumentID  *int64          `json:"document_id"`
	VoucherID   *int64          `json:"voucher_id"`
	Amount      decimal.Decimal `json:"amount"`    // số phát sinh ban đầu
	Remaining   decimal.Decimal `json:"remaining"` // còn nợ sau FIFO
	DaysOverdue int             `json:"days_overdue"`
	Bucket      string          `json:"bucket"`
}

// AgingRow là tuổi nợ của một khách.
type AgingRow struct {
	PartnerID   int64           `json:"partner_id"`
	PartnerCode string          `json:"partner_code"`
	PartnerName string          `json:"partner_name"`
	PaymentDays *int            `json:"payment_days"`
	InTerm      decimal.Decimal `json:"in_term"`
	D1to30      decimal.Decimal `json:"d1_30"`
	D31to60     decimal.Decimal `json:"d31_60"`
	D61to90     decimal.Decimal `json:"d61_90"`
	Over90      decimal.Decimal `json:"over_90"`
	Opening     decimal.Decimal `json:"opening"` // nợ đầu kỳ (không có ngày) còn lại
	Prepaid     decimal.Decimal `json:"prepaid"` // khách trả trước / trả thừa (≤ 0)
	Total       decimal.Decimal `json:"total"`
	Items       []AgingItem     `json:"items"`
}

// Aging là báo cáo tuổi nợ phải thu.
type Aging struct {
	AsOf   util.Date  `json:"as_of"`
	Items  []AgingRow `json:"items"`
	Totals AgingRow   `json:"totals"`
}

// AgingParams là tham số báo cáo tuổi nợ.
type AgingParams struct {
	AsOf      util.Date
	PartnerID *int64
	Q         string
}

func bucketOf(days int) string {
	switch {
	case days <= 0:
		return "in_term"
	case days <= 30:
		return "d1_30"
	case days <= 60:
		return "d31_60"
	case days <= 90:
		return "d61_90"
	}
	return "over_90"
}

func (r *AgingRow) add(bucket string, v decimal.Decimal) {
	switch bucket {
	case "in_term":
		r.InTerm = r.InTerm.Add(v)
	case "d1_30":
		r.D1to30 = r.D1to30.Add(v)
	case "d31_60":
		r.D31to60 = r.D31to60.Add(v)
	case "d61_90":
		r.D61to90 = r.D61to90.Add(v)
	case "over_90":
		r.Over90 = r.Over90.Add(v)
	case "opening":
		r.Opening = r.Opening.Add(v)
	case "prepaid":
		r.Prepaid = r.Prepaid.Add(v)
	}
	r.Total = r.Total.Add(v)
}

func zeroAging() AgingRow {
	z := decimal.Zero
	return AgingRow{InTerm: z, D1to30: z, D31to60: z, D61to90: z, Over90: z, Opening: z, Prepaid: z, Total: z, Items: []AgingItem{}}
}

type agingEntry struct {
	partnerID  int64
	kind       string
	refID      int64
	date       util.Date
	refNo, typ string
	inc, dec   decimal.Decimal
}

// DebtAging tính tuổi nợ phải thu đến hết ngày as_of. Các khoản giảm nợ (khách trả hàng, phiếu thu) trừ vào khoản tăng
// nợ cũ nhất trước (FIFO; nợ đầu kỳ coi là cũ nhất); hạn = ngày phát sinh + payment_days (không đặt ⇒ 0).
// Trả thừa ⇒ cột "Trả trước" (âm), bù vào khoản tăng nợ phát sinh sau. Tổng các cột = số dư sổ công nợ cùng ngày.
func (s *Service) DebtAging(ctx context.Context, p AgingParams) (*Aging, error) {
	if p.AsOf.Empty() {
		p.AsOf = util.Today()
	}
	var w util.Where
	w.Add(`TRUE`)
	if p.PartnerID != nil {
		w.Add(`pa.id = ?`, *p.PartnerID)
	}
	if tokens := util.SearchTokens(p.Q); len(tokens) > 0 {
		w.Add(util.PartnerMatchSQL(&w, "pa", tokens))
	}
	type partner struct {
		id          int64
		code, name  string
		opening     decimal.Decimal
		paymentDays *int
	}
	prow, err := s.Pool.Query(ctx, `SELECT pa.id, pa.code, pa.name, pa.opening_receivable, pa.payment_days FROM partners pa`+w.SQL()+` ORDER BY pa.code`, w.Args...)
	if err != nil {
		return nil, err
	}
	var partners []partner
	pids := []int64{}
	for prow.Next() {
		var x partner
		if err := prow.Scan(&x.id, &x.code, &x.name, &x.opening, &x.paymentDays); err != nil {
			prow.Close()
			return nil, err
		}
		partners = append(partners, x)
		pids = append(pids, x.id)
	}
	prow.Close()
	if err := prow.Err(); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT e.partner_id, e.kind, e.ref_id, e.date, e.ref_no, e.ref_type, e.increase, e.decrease
		FROM (`+debt.EntriesSQL(debt.Receivable)+`) e WHERE e.date <= $1 AND e.partner_id = ANY($2)
		ORDER BY e.partner_id, e.date, e.ts, e.kind, e.ref_id`, p.AsOf, pids)
	if err != nil {
		return nil, err
	}
	entries := map[int64][]agingEntry{}
	for rows.Next() {
		var e agingEntry
		if err := rows.Scan(&e.partnerID, &e.kind, &e.refID, &e.date, &e.refNo, &e.typ, &e.inc, &e.dec); err != nil {
			rows.Close()
			return nil, err
		}
		entries[e.partnerID] = append(entries[e.partnerID], e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := &Aging{AsOf: p.AsOf, Items: []AgingRow{}, Totals: zeroAging()}
	asOf := p.AsOf.Time
	for _, pa := range partners {
		row := zeroAging()
		row.PartnerID, row.PartnerCode, row.PartnerName, row.PaymentDays = pa.id, pa.code, pa.name, pa.paymentDays
		days := 0
		if pa.paymentDays != nil {
			days = *pa.paymentDays
		}
		type open struct {
			item    AgingItem
			opening bool
		}
		var queue []open
		credit := decimal.Zero // khách đang trả thừa (dương)
		if pa.opening.IsPositive() {
			queue = append(queue, open{item: AgingItem{Amount: pa.opening, Remaining: pa.opening, RefNo: "Nợ đầu kỳ", RefType: "opening", Bucket: "opening"}, opening: true})
		} else if pa.opening.IsNegative() {
			credit = pa.opening.Neg()
		}
		for _, e := range entries[pa.id] {
			net := e.inc.Sub(e.dec)
			if net.IsPositive() {
				if credit.IsPositive() {
					use := decimal.Min(credit, net)
					credit, net = credit.Sub(use), net.Sub(use)
				}
				if net.IsPositive() {
					it := AgingItem{Date: e.date, RefNo: e.refNo, RefType: e.typ, Amount: e.inc.Sub(e.dec), Remaining: net}
					id := e.refID
					if e.kind == "document" {
						it.DocumentID = &id
					} else {
						it.VoucherID = &id
					}
					queue = append(queue, open{item: it})
				}
				continue
			}
			d := net.Neg()
			for d.IsPositive() && len(queue) > 0 {
				use := decimal.Min(d, queue[0].item.Remaining)
				queue[0].item.Remaining = queue[0].item.Remaining.Sub(use)
				d = d.Sub(use)
				if queue[0].item.Remaining.IsZero() {
					queue = queue[1:]
				}
			}
			credit = credit.Add(d)
		}
		for _, o := range queue {
			it := o.item
			if !o.opening {
				due := it.Date.AddDate(0, 0, days)
				it.DueDate = util.NewDate(due.Year(), due.Month(), due.Day())
				it.DaysOverdue = int(asOf.Sub(due) / (24 * time.Hour))
				it.Bucket = bucketOf(it.DaysOverdue)
			}
			row.add(it.Bucket, it.Remaining)
			row.Items = append(row.Items, it)
		}
		if credit.IsPositive() {
			row.add("prepaid", credit.Neg())
		}
		if row.Total.IsZero() && len(row.Items) == 0 && row.Prepaid.IsZero() {
			continue
		}
		out.Items = append(out.Items, row)
		for _, b := range []struct {
			k string
			v decimal.Decimal
		}{{"in_term", row.InTerm}, {"d1_30", row.D1to30}, {"d31_60", row.D31to60}, {"d61_90", row.D61to90}, {"over_90", row.Over90}, {"opening", row.Opening}, {"prepaid", row.Prepaid}} {
			out.Totals.add(b.k, b.v)
		}
	}
	out.Totals.Items = nil
	return out, nil
}

// ---------- C7 lãi gộp ----------

// ProfitParams là tham số báo cáo lãi gộp.
type ProfitParams struct {
	From, To  util.Date
	GroupBy   string // document | product | customer
	PartnerID *int64
	ProductID *int64
}

// ProfitRow là một dòng báo cáo lãi gộp (các trường khóa tùy cách nhóm).
type ProfitRow struct {
	DocumentID  *int64           `json:"document_id,omitempty"`
	DocNo       *string          `json:"doc_no,omitempty"`
	DocDate     *util.Date       `json:"doc_date,omitempty"`
	DocType     *string          `json:"doc_type,omitempty"`
	PartnerID   *int64           `json:"partner_id,omitempty"`
	PartnerCode *string          `json:"partner_code,omitempty"`
	PartnerName *string          `json:"partner_name,omitempty"`
	ProductID   *int64           `json:"product_id,omitempty"`
	ProductCode *string          `json:"product_code,omitempty"`
	ProductName *string          `json:"product_name,omitempty"`
	Unit        *string          `json:"unit,omitempty"`
	Qty         *decimal.Decimal `json:"qty,omitempty"`
	Revenue     decimal.Decimal  `json:"revenue"`
	Cost        decimal.Decimal  `json:"cost"`
	Profit      decimal.Decimal  `json:"profit"`
	Margin      *decimal.Decimal `json:"margin"` // % lãi gộp / doanh thu (null khi doanh thu 0)
	Estimated   bool             `json:"estimated"`
}

// Profit là báo cáo lãi gộp.
type Profit struct {
	From           util.Date   `json:"from"`
	To             util.Date   `json:"to"`
	GroupBy        string      `json:"group_by"`
	Items          []ProfitRow `json:"items"`
	Totals         ProfitRow   `json:"totals"`
	EstimatedLines int         `json:"estimated_lines"`
}

type profitLine struct {
	lineID               int64
	docID                int64
	docNo                string
	docDate              util.Date
	docType              string
	partnerID            *int64
	partnerCode, partner *string
	productID            int64
	code, name, unit     string
	isService            bool
	defaultCost          decimal.Decimal
	qty, amount          decimal.Decimal
	revenue, cost        decimal.Decimal
	estimated            bool
}

// costEvent là một dòng sổ kho (đã ghi sổ) của một mã, theo thứ tự xử lý của bình quân gia quyền liên hoàn.
type costEvent struct {
	lineID  int64
	docType string
	qty     decimal.Decimal
	amount  decimal.Decimal // thành tiền dòng (nhập mua, tồn đầu, trả NCC)
}

// costResult là giá vốn đơn vị của một dòng bán / khách trả hàng.
type costResult struct {
	unit      decimal.Decimal
	estimated bool
}

// movingAverage chạy bình quân gia quyền liên hoàn (sau mỗi lần nhập) trên các dòng sổ kho của MỘT mã, đã sắp theo
// ngày, nhập trước xuất sau trong ngày, rồi thứ tự ghi sổ. Trả giá vốn đơn vị của mỗi dòng bán / khách trả hàng.
//   - nhập mua / tồn đầu kỳ: cộng SL và giá trị (thành tiền); tồn trước đó ≤ 0 ⇒ giá bình quân = đơn giá nhập;
//   - bán: giá vốn = giá bình quân hiện tại; trừ SL và giá trị tương ứng;
//   - khách trả hàng: nhập lại theo giá bình quân hiện tại;
//   - trả hàng NCC: trừ SL và trừ giá trị theo thành tiền của phiếu trả (giá trị không xuống dưới 0);
//   - chưa từng có lượng nhập (mua / tồn đầu) ⇒ giá mua mặc định, đánh dấu ước tính.
func movingAverage(events []costEvent, defaultCost decimal.Decimal) map[int64]costResult {
	out := make(map[int64]costResult)
	var qty, val, avg decimal.Decimal
	seen := false
	for _, e := range events {
		switch e.docType {
		case "purchase", "opening":
			if !e.qty.IsPositive() {
				continue
			}
			unit := e.amount.DivRound(e.qty, 10)
			if !qty.IsPositive() {
				qty = qty.Add(e.qty)
				avg = unit
				val = decimal.Zero
				if qty.IsPositive() {
					val = qty.Mul(avg)
				}
			} else {
				qty = qty.Add(e.qty)
				val = val.Add(e.amount)
				avg = val.DivRound(qty, 10)
			}
			seen = true
		case "sale":
			r := costResult{unit: avg}
			if !seen {
				r = costResult{unit: defaultCost, estimated: true}
			}
			out[e.lineID] = r
			qty = qty.Sub(e.qty)
			val = val.Sub(e.qty.Mul(r.unit))
			if !qty.IsPositive() || val.IsNegative() {
				val = decimal.Zero
			}
		case "sale_return":
			r := costResult{unit: avg}
			if !seen {
				r = costResult{unit: defaultCost, estimated: true}
			}
			out[e.lineID] = r
			wasEmpty := !qty.IsPositive()
			qty = qty.Add(e.qty)
			switch {
			case !qty.IsPositive():
				val = decimal.Zero
			case wasEmpty:
				val = qty.Mul(r.unit)
			default:
				val = val.Add(e.qty.Mul(r.unit))
			}
			if seen && qty.IsPositive() {
				avg = val.DivRound(qty, 10)
			}
		case "stocktake":
			// Kiểm kê thừa nhập theo giá bình quân hiện tại (chưa từng nhập ⇒ giá mua mặc định), thiếu xuất theo bình
			// quân hiện tại — không sinh dòng giá vốn, chỉ đổi SL và giá trị tồn.
			unit := avg
			if !seen {
				unit = defaultCost
			}
			wasEmpty := !qty.IsPositive()
			qty = qty.Add(e.qty)
			switch {
			case !qty.IsPositive():
				val = decimal.Zero
			case e.qty.IsPositive() && wasEmpty:
				val = qty.Mul(unit)
			default:
				val = val.Add(e.qty.Mul(unit))
				if val.IsNegative() {
					val = decimal.Zero
				}
			}
			if seen && qty.IsPositive() && e.qty.IsPositive() {
				avg = val.DivRound(qty, 10)
			}
		case "purchase_return":
			qty = qty.Sub(e.qty)
			val = val.Sub(e.amount)
			if val.IsNegative() {
				val = decimal.Zero
			}
			if qty.IsPositive() {
				avg = val.DivRound(qty, 10)
			} else {
				val = decimal.Zero
			}
		}
	}
	return out
}

func margin(rev, profit decimal.Decimal) *decimal.Decimal {
	if rev.IsZero() {
		return nil
	}
	m := profit.Div(rev).Mul(decimal.NewFromInt(100)).Round(2)
	return &m
}

// ProfitReport tính lãi gộp. Giá vốn = bình quân gia quyền liên hoàn (sau mỗi lần nhập), tính chung mọi kho, tính lại
// mỗi lần xem: xem movingAverage. Dịch vụ: giá vốn 0. Khách trả hàng: doanh thu và giá vốn âm. Giá vốn từng dòng làm tròn
// đồng; mọi cách nhóm cộng từ cùng các dòng.
func (s *Service) ProfitReport(ctx context.Context, p ProfitParams) (*Profit, error) {
	if p.To.Before(p.From.Time) {
		return nil, apperr.ValidationField("to", "Ngày kết thúc phải sau ngày bắt đầu")
	}
	switch p.GroupBy {
	case "", "document":
		p.GroupBy = "document"
	case "product", "customer":
	default:
		return nil, apperr.ValidationField("group_by", "group_by phải là document, product hoặc customer")
	}
	var w util.Where
	w.Add(`d.status = 'posted'`)
	w.Add(`d.doc_type IN ('sale', 'sale_return')`)
	w.Add(`d.doc_date BETWEEN ? AND ?`, p.From, p.To)
	if p.PartnerID != nil {
		w.Add(`d.partner_id = ?`, *p.PartnerID)
	}
	if p.ProductID != nil {
		w.Add(`l.product_id = ?`, *p.ProductID)
	}
	rows, err := s.Pool.Query(ctx, `SELECT l.id, d.id, COALESCE(d.doc_no, d.draft_no), d.doc_date, d.doc_type, d.partner_id, pa.code, pa.name,
			l.product_id, pr.code, pr.name, pr.unit, pr.is_service, pr.purchase_price, l.base_qty, l.amount
		FROM document_lines l JOIN documents d ON d.id = l.document_id JOIN products pr ON pr.id = l.product_id
		LEFT JOIN partners pa ON pa.id = d.partner_id`+w.SQL()+` ORDER BY d.doc_date, d.id, l.line_no`, w.Args...)
	if err != nil {
		return nil, err
	}
	var lines []profitLine
	prodSet := map[int64]bool{}
	for rows.Next() {
		var l profitLine
		if err := rows.Scan(&l.lineID, &l.docID, &l.docNo, &l.docDate, &l.docType, &l.partnerID, &l.partnerCode, &l.partner,
			&l.productID, &l.code, &l.name, &l.unit, &l.isService, &l.defaultCost, &l.qty, &l.amount); err != nil {
			rows.Close()
			return nil, err
		}
		if !l.isService {
			prodSet[l.productID] = true
		}
		lines = append(lines, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Bình quân gia quyền liên hoàn cho từng mã: mọi dòng sổ kho liên quan đến hết ngày "to".
	ids := make([]int64, 0, len(prodSet))
	defCost := map[int64]decimal.Decimal{}
	for _, l := range lines {
		if prodSet[l.productID] {
			defCost[l.productID] = l.defaultCost
		}
	}
	for id := range prodSet {
		ids = append(ids, id)
	}
	costs := map[int64]costResult{}
	if len(ids) > 0 {
		// Kiểm kê (C9): chênh lệch thực tế − sổ sách (SL có dấu); thừa là nhập, thiếu là xuất trong cùng ngày.
		crow, err := s.Pool.Query(ctx, `SELECT l.product_id, l.id, d.doc_type,
				CASE WHEN d.doc_type = 'stocktake' THEN l.base_qty - COALESCE(l.book_qty, l.base_qty) ELSE l.base_qty END, l.amount
			FROM document_lines l JOIN documents d ON d.id = l.document_id
			WHERE d.status = 'posted' AND d.doc_type IN ('purchase', 'opening', 'sale_return', 'sale', 'purchase_return', 'stocktake')
			  AND l.product_id = ANY($1) AND d.doc_date <= $2
			ORDER BY l.product_id, d.doc_date,
			  CASE WHEN d.doc_type IN ('purchase', 'opening', 'sale_return') THEN 0
			       WHEN d.doc_type = 'stocktake' AND l.base_qty > COALESCE(l.book_qty, l.base_qty) THEN 0 ELSE 1 END,
			  d.posted_at NULLS LAST, d.id, l.line_no`, ids, p.To)
		if err != nil {
			return nil, err
		}
		var cur int64
		var evs []costEvent
		flush := func() {
			if len(evs) > 0 {
				for k, v := range movingAverage(evs, defCost[cur]) {
					costs[k] = v
				}
			}
			evs = evs[:0]
		}
		for crow.Next() {
			var pid int64
			var e costEvent
			if err := crow.Scan(&pid, &e.lineID, &e.docType, &e.qty, &e.amount); err != nil {
				crow.Close()
				return nil, err
			}
			if pid != cur {
				flush()
				cur = pid
			}
			evs = append(evs, e)
		}
		flush()
		crow.Close()
		if err := crow.Err(); err != nil {
			return nil, err
		}
	}
	out := &Profit{From: p.From, To: p.To, GroupBy: p.GroupBy, Items: []ProfitRow{}}
	for i := range lines {
		l := &lines[i]
		sign := decimal.NewFromInt(1)
		if l.docType == "sale_return" {
			sign = decimal.NewFromInt(-1)
		}
		l.revenue = l.amount.Mul(sign)
		l.cost = decimal.Zero
		if l.isService {
			continue
		}
		c, ok := costs[l.lineID]
		if !ok { // không xảy ra (dòng trong kỳ luôn nằm trong chuỗi); phòng xa
			c = costResult{unit: l.defaultCost, estimated: true}
		}
		if c.estimated {
			l.estimated = true
			out.EstimatedLines++
		}
		l.cost = util.RoundVND(l.qty.Mul(c.unit)).Mul(sign)
	}
	type acc struct {
		row   ProfitRow
		order int
	}
	groups := map[string]*acc{}
	var order []string
	tot := ProfitRow{Revenue: decimal.Zero, Cost: decimal.Zero}
	for _, l := range lines {
		var key string
		switch p.GroupBy {
		case "document":
			key = "d" + decimal.NewFromInt(l.docID).String()
		case "product":
			key = "p" + decimal.NewFromInt(l.productID).String()
		default:
			key = "c"
			if l.partnerID != nil {
				key += decimal.NewFromInt(*l.partnerID).String()
			}
		}
		a, ok := groups[key]
		if !ok {
			a = &acc{row: ProfitRow{Revenue: decimal.Zero, Cost: decimal.Zero}}
			switch p.GroupBy {
			case "document":
				id, no, dt, ty := l.docID, l.docNo, l.docDate, l.docType
				a.row.DocumentID, a.row.DocNo, a.row.DocDate, a.row.DocType = &id, &no, &dt, &ty
				a.row.PartnerID, a.row.PartnerCode, a.row.PartnerName = l.partnerID, l.partnerCode, l.partner
			case "product":
				id, code, name, unit := l.productID, l.code, l.name, l.unit
				q := decimal.Zero
				a.row.ProductID, a.row.ProductCode, a.row.ProductName, a.row.Unit, a.row.Qty = &id, &code, &name, &unit, &q
			default:
				a.row.PartnerID, a.row.PartnerCode, a.row.PartnerName = l.partnerID, l.partnerCode, l.partner
			}
			groups[key] = a
			order = append(order, key)
		}
		a.row.Revenue = a.row.Revenue.Add(l.revenue)
		a.row.Cost = a.row.Cost.Add(l.cost)
		if a.row.Qty != nil {
			q := l.qty
			if l.docType == "sale_return" {
				q = q.Neg()
			}
			v := a.row.Qty.Add(q)
			a.row.Qty = &v
		}
		if l.estimated {
			a.row.Estimated = true
			tot.Estimated = true
		}
		tot.Revenue = tot.Revenue.Add(l.revenue)
		tot.Cost = tot.Cost.Add(l.cost)
	}
	for _, k := range order {
		r := groups[k].row
		r.Profit = r.Revenue.Sub(r.Cost)
		r.Margin = margin(r.Revenue, r.Profit)
		out.Items = append(out.Items, r)
	}
	switch p.GroupBy {
	case "product":
		sort.SliceStable(out.Items, func(i, j int) bool { return *out.Items[i].ProductCode < *out.Items[j].ProductCode })
	case "customer":
		sort.SliceStable(out.Items, func(i, j int) bool { return out.Items[i].Profit.GreaterThan(out.Items[j].Profit) })
	}
	tot.Profit = tot.Revenue.Sub(tot.Cost)
	tot.Margin = margin(tot.Revenue, tot.Profit)
	out.Totals = tot
	return out, nil
}
