// Package reports: báo cáo tồn kho, NXT, thẻ kho, mua/bán, công nợ, sổ quỹ, hàng cần đặt, tổng quan.
// Mọi con số tính trực tiếp từ stock_movements / chứng từ (không lưu sẵn).
package reports

import (
	"context"
	"fmt"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/util"
)

// Service chạy báo cáo.
type Service struct {
	Pool *pgxpool.Pool
}

// WarehouseRef là thông tin kho trong báo cáo.
type WarehouseRef struct {
	ID   int64  `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

func (s *Service) warehouses(ctx context.Context, only *int64) ([]WarehouseRef, error) {
	q := `SELECT id, code, name FROM warehouses`
	var args []any
	if only != nil {
		q += ` WHERE id=$1`
		args = append(args, *only)
	}
	rows, err := s.Pool.Query(ctx, q+` ORDER BY code`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[WarehouseRef])
}

func (s *Service) checkWarehouse(ctx context.Context, id *int64) error {
	if id == nil {
		return nil
	}
	var ok bool
	if err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM warehouses WHERE id=$1)`, *id).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return apperr.ValidationField("warehouse_id", "Kho không tồn tại")
	}
	return nil
}

// ---------- Tồn kho tổng hợp (REQ-009/010/020/022/063/075) ----------

// StockSummaryParams là tham số báo cáo tồn kho.
type StockSummaryParams struct {
	AsOf         util.Date
	GroupID      *int64
	Q            string
	WarehouseID  *int64
	OnlyWithData bool
}

// StockSummaryRow là tồn của một mã hàng.
type StockSummaryRow struct {
	ProductID   int64                      `json:"product_id"`
	Code        string                     `json:"code"`
	Name        string                     `json:"name"`
	Unit        string                     `json:"unit"`
	GroupID     *int64                     `json:"group_id"`
	GroupName   *string                    `json:"group_name"`
	ByWarehouse map[string]decimal.Decimal `json:"by_warehouse"`
	Total       decimal.Decimal            `json:"total"`
}

// StockSummary là báo cáo tồn kho tại một ngày.
type StockSummary struct {
	AsOf       util.Date                  `json:"as_of"`
	Warehouses []WarehouseRef             `json:"warehouses"`
	Items      []StockSummaryRow          `json:"items"`
	Totals     map[string]decimal.Decimal `json:"totals_by_warehouse"`
	TotalQty   decimal.Decimal            `json:"total_qty"`
}

// StockSummary tính tồn từng mã tại từng kho và tổng các kho.
func (s *Service) StockSummary(ctx context.Context, p StockSummaryParams) (*StockSummary, error) {
	if p.AsOf.Empty() {
		p.AsOf = util.Today()
	}
	if err := s.checkWarehouse(ctx, p.WarehouseID); err != nil {
		return nil, err
	}
	whs, err := s.warehouses(ctx, p.WarehouseID)
	if err != nil {
		return nil, err
	}
	var w util.Where
	asOf := w.Arg(p.AsOf)
	join := `LEFT JOIN stock_movements m ON m.product_id=p.id AND m.doc_date <= ` + asOf
	if p.WarehouseID != nil {
		join += ` AND m.warehouse_id = ` + w.Arg(*p.WarehouseID)
	}
	w.Add(`NOT p.is_service`)
	if p.GroupID != nil {
		w.Add(`p.group_id = ?`, *p.GroupID)
	}
	if p.Q != "" {
		if c := util.ProductMatchSQL(&w, "p", util.ProductTokens(p.Q)); c != "" {
			w.Add(c)
		}
	}
	if !p.OnlyWithData {
		w.Add(`(p.active OR m.id IS NOT NULL)`)
	}
	rows, err := s.Pool.Query(ctx, `SELECT p.id, p.code, p.name, p.unit, p.group_id, g.name, m.warehouse_id,
			COALESCE(sum(m.qty_in - m.qty_out), 0), count(m.id)
		FROM products p LEFT JOIN product_groups g ON g.id=p.group_id `+join+w.SQL()+`
		GROUP BY p.id, p.code, p.name, p.unit, p.group_id, g.name, m.warehouse_id
		ORDER BY p.code`, w.Args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &StockSummary{AsOf: p.AsOf, Warehouses: whs, Items: []StockSummaryRow{}, Totals: map[string]decimal.Decimal{}, TotalQty: decimal.Zero}
	for _, wh := range whs {
		out.Totals[strconv.FormatInt(wh.ID, 10)] = decimal.Zero
	}
	idx := map[int64]int{}
	hasData := map[int64]bool{}
	for rows.Next() {
		var r StockSummaryRow
		var wid *int64
		var qty decimal.Decimal
		var cnt int
		if err := rows.Scan(&r.ProductID, &r.Code, &r.Name, &r.Unit, &r.GroupID, &r.GroupName, &wid, &qty, &cnt); err != nil {
			return nil, err
		}
		i, ok := idx[r.ProductID]
		if !ok {
			r.ByWarehouse = map[string]decimal.Decimal{}
			for _, wh := range whs {
				r.ByWarehouse[strconv.FormatInt(wh.ID, 10)] = decimal.Zero
			}
			r.Total = decimal.Zero
			out.Items = append(out.Items, r)
			i = len(out.Items) - 1
			idx[r.ProductID] = i
		}
		if wid != nil && cnt > 0 {
			hasData[r.ProductID] = true
			k := strconv.FormatInt(*wid, 10)
			it := &out.Items[i]
			it.ByWarehouse[k] = it.ByWarehouse[k].Add(qty)
			it.Total = it.Total.Add(qty)
			out.Totals[k] = out.Totals[k].Add(qty)
			out.TotalQty = out.TotalQty.Add(qty)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if p.OnlyWithData {
		filtered := out.Items[:0]
		for _, it := range out.Items {
			if hasData[it.ProductID] {
				filtered = append(filtered, it)
			}
		}
		out.Items = filtered
	}
	return out, nil
}

// ---------- Tổng hợp Nhập - Xuất - Tồn (REQ-064) ----------

// NXTParams là tham số báo cáo NXT.
type NXTParams struct {
	From, To    util.Date
	WarehouseID *int64
	GroupID     *int64
	Q           string
}

// NXTRow là một dòng NXT.
type NXTRow struct {
	ProductID int64           `json:"product_id"`
	Code      string          `json:"code"`
	Name      string          `json:"name"`
	Unit      string          `json:"unit"`
	GroupName *string         `json:"group_name"`
	Opening   decimal.Decimal `json:"opening"`
	QtyIn     decimal.Decimal `json:"qty_in"`
	QtyOut    decimal.Decimal `json:"qty_out"`
	Closing   decimal.Decimal `json:"closing"`
}

// NXT là báo cáo tổng hợp nhập xuất tồn.
type NXT struct {
	From        util.Date `json:"from"`
	To          util.Date `json:"to"`
	WarehouseID *int64    `json:"warehouse_id"`
	Items       []NXTRow  `json:"items"`
	Totals      NXTTotals `json:"totals"`
}

// NXTTotals là dòng cộng của báo cáo NXT.
type NXTTotals struct {
	Opening decimal.Decimal `json:"opening"`
	QtyIn   decimal.Decimal `json:"qty_in"`
	QtyOut  decimal.Decimal `json:"qty_out"`
	Closing decimal.Decimal `json:"closing"`
}

// DefaultRange trả from/to mặc định: đầu tháng hiện tại → hôm nay.
func DefaultRange(from, to *util.Date) (util.Date, util.Date) {
	t := util.Today()
	f := util.NewDate(t.Year(), t.Month(), 1)
	if from != nil {
		f = *from
	}
	if to != nil {
		t = *to
	}
	return f, t
}

// StockNXT tính tồn đầu, nhập, xuất, tồn cuối từng mã trong kỳ. Khi xem tất cả kho, chuyển kho
// nội bộ không tính vào nhập/xuất (tự triệt tiêu).
func (s *Service) StockNXT(ctx context.Context, p NXTParams) (*NXT, error) {
	if p.To.Before(p.From.Time) {
		return nil, apperr.ValidationField("to", "Ngày kết thúc phải sau ngày bắt đầu")
	}
	if err := s.checkWarehouse(ctx, p.WarehouseID); err != nil {
		return nil, err
	}
	var w util.Where
	from, to := w.Arg(p.From), w.Arg(p.To)
	movFilter := ``
	if p.WarehouseID != nil {
		movFilter = ` AND m.warehouse_id = ` + w.Arg(*p.WarehouseID)
	}
	excludeTransfer := `TRUE`
	if p.WarehouseID == nil {
		excludeTransfer = `d.doc_type <> 'transfer'`
	}
	w.Add(`NOT p.is_service`)
	if p.GroupID != nil {
		w.Add(`p.group_id = ?`, *p.GroupID)
	}
	if p.Q != "" {
		if c := util.ProductMatchSQL(&w, "p", util.ProductTokens(p.Q)); c != "" {
			w.Add(c)
		}
	}
	rows, err := s.Pool.Query(ctx, `SELECT p.id, p.code, p.name, p.unit, g.name,
		COALESCE(sum(m.qty_in - m.qty_out) FILTER (WHERE m.doc_date < `+from+`), 0),
		COALESCE(sum(m.qty_in) FILTER (WHERE m.doc_date BETWEEN `+from+` AND `+to+` AND `+excludeTransfer+`), 0),
		COALESCE(sum(m.qty_out) FILTER (WHERE m.doc_date BETWEEN `+from+` AND `+to+` AND `+excludeTransfer+`), 0),
		COALESCE(sum(m.qty_in - m.qty_out) FILTER (WHERE m.doc_date <= `+to+`), 0)
		FROM products p LEFT JOIN product_groups g ON g.id=p.group_id
		JOIN stock_movements m ON m.product_id=p.id`+movFilter+`
		JOIN documents d ON d.id=m.document_id`+w.SQL()+`
		GROUP BY p.id, p.code, p.name, p.unit, g.name ORDER BY p.code`, w.Args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &NXT{From: p.From, To: p.To, WarehouseID: p.WarehouseID, Items: []NXTRow{}}
	out.Totals = NXTTotals{Opening: decimal.Zero, QtyIn: decimal.Zero, QtyOut: decimal.Zero, Closing: decimal.Zero}
	for rows.Next() {
		var r NXTRow
		if err := rows.Scan(&r.ProductID, &r.Code, &r.Name, &r.Unit, &r.GroupName, &r.Opening, &r.QtyIn, &r.QtyOut, &r.Closing); err != nil {
			return nil, err
		}
		if r.Opening.IsZero() && r.QtyIn.IsZero() && r.QtyOut.IsZero() && r.Closing.IsZero() {
			continue
		}
		out.Items = append(out.Items, r)
		out.Totals.Opening = out.Totals.Opening.Add(r.Opening)
		out.Totals.QtyIn = out.Totals.QtyIn.Add(r.QtyIn)
		out.Totals.QtyOut = out.Totals.QtyOut.Add(r.QtyOut)
		out.Totals.Closing = out.Totals.Closing.Add(r.Closing)
	}
	return out, rows.Err()
}

// ---------- Thẻ kho / chi tiết NXT một mã (REQ-012…019) ----------

// LedgerParams là tham số thẻ kho.
type LedgerParams struct {
	ProductID   int64
	From, To    *util.Date
	WarehouseID *int64
}

// LedgerProduct là thông tin mã hàng trên thẻ kho.
type LedgerProduct struct {
	ID   int64  `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
	Unit string `json:"unit"`
}

// LedgerRow là một dòng thẻ kho.
type LedgerRow struct {
	Date          util.Date       `json:"date"`
	DocNo         string          `json:"doc_no"`
	DocumentID    int64           `json:"document_id"`
	DocType       string          `json:"doc_type"`
	Description   string          `json:"description"`
	PartnerID     *int64          `json:"partner_id"`
	PartnerName   *string         `json:"partner_name"`
	WarehouseID   int64           `json:"warehouse_id"`
	WarehouseCode string          `json:"warehouse_code"`
	ProductCode   string          `json:"product_code"`
	Unit          string          `json:"unit"`
	QtyIn         decimal.Decimal `json:"qty_in"`
	QtyOut        decimal.Decimal `json:"qty_out"`
	Balance       decimal.Decimal `json:"balance"`
	UnitPrice     decimal.Decimal `json:"unit_price"`
}

// Ledger là thẻ kho.
type Ledger struct {
	Product     LedgerProduct   `json:"product"`
	From        *util.Date      `json:"from"`
	To          *util.Date      `json:"to"`
	WarehouseID *int64          `json:"warehouse_id"`
	Opening     decimal.Decimal `json:"opening"`
	Rows        []LedgerRow     `json:"rows"`
	TotalIn     decimal.Decimal `json:"total_in"`
	TotalOut    decimal.Decimal `json:"total_out"`
	Closing     decimal.Decimal `json:"closing"`
}

// Describe tạo diễn giải dòng thẻ kho theo R2 (luôn có tên đối tượng).
func Describe(docType string, partner, fromWh, toWh *string, note string) string {
	name := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	var s string
	switch docType {
	case "sale":
		s = "Xuất kho bán hàng " + name(partner)
	case "purchase":
		s = "Nhập kho mua hàng " + name(partner)
	case "sale_return":
		s = name(partner) + " - trả hàng"
	case "purchase_return":
		s = "Trả hàng " + name(partner)
	case "transfer":
		s = fmt.Sprintf("Chuyển kho %s → %s", name(fromWh), name(toWh))
	case "opening":
		s = "Nhập tồn đầu kỳ"
	}
	if note != "" {
		s += " - " + note
	}
	return s
}

// StockLedger trả thẻ kho của một mã: số dư đầu kỳ, từng giao dịch, tồn lũy kế, tổng cộng.
func (s *Service) StockLedger(ctx context.Context, p LedgerParams) (*Ledger, error) {
	if p.ProductID == 0 {
		return nil, apperr.ValidationField("product_id", "Vui lòng chọn mặt hàng")
	}
	if p.From != nil && p.To != nil && p.To.Before(p.From.Time) {
		return nil, apperr.ValidationField("to", "Ngày kết thúc phải sau ngày bắt đầu")
	}
	if err := s.checkWarehouse(ctx, p.WarehouseID); err != nil {
		return nil, err
	}
	out := &Ledger{From: p.From, To: p.To, WarehouseID: p.WarehouseID, Rows: []LedgerRow{}}
	var isService bool
	err := s.Pool.QueryRow(ctx, `SELECT id, code, name, unit, is_service FROM products WHERE id=$1`, p.ProductID).
		Scan(&out.Product.ID, &out.Product.Code, &out.Product.Name, &out.Product.Unit, &isService)
	if err == pgx.ErrNoRows {
		return nil, apperr.NotFound("mặt hàng")
	}
	if err != nil {
		return nil, err
	}
	var w util.Where
	w.Add(`m.product_id = ?`, p.ProductID)
	if p.WarehouseID != nil {
		w.Add(`m.warehouse_id = ?`, *p.WarehouseID)
	}
	// Số dư đầu kỳ.
	out.Opening = decimal.Zero
	if p.From != nil {
		if err := s.Pool.QueryRow(ctx, `SELECT COALESCE(sum(m.qty_in - m.qty_out),0) FROM stock_movements m`+w.SQL()+` AND m.doc_date < `+w.Arg(*p.From), w.Args...).Scan(&out.Opening); err != nil {
			return nil, err
		}
		w.Args = w.Args[:len(w.Args)-1]
		w.Add(`m.doc_date >= ?`, *p.From)
	}
	if p.To != nil {
		w.Add(`m.doc_date <= ?`, *p.To)
	}
	if p.WarehouseID == nil {
		// Xem tất cả kho: ẩn dòng chuyển kho (tự triệt tiêu) — R2.
		w.Add(`d.doc_type <> 'transfer'`)
	}
	rows, err := s.Pool.Query(ctx, `SELECT m.doc_date, COALESCE(d.doc_no, d.draft_no), d.id, d.doc_type, d.partner_id, pa.name,
			fw.name, tw.name, d.note, m.warehouse_id, w.code, COALESCE(NULLIF(l.unit,''), pr.unit), m.qty_in, m.qty_out, m.unit_cost
		FROM stock_movements m
		JOIN documents d ON d.id=m.document_id
		JOIN document_lines l ON l.id=m.line_id
		JOIN products pr ON pr.id=m.product_id
		JOIN warehouses w ON w.id=m.warehouse_id
		JOIN warehouses fw ON fw.id=d.warehouse_id
		LEFT JOIN warehouses tw ON tw.id=d.to_warehouse_id
		LEFT JOIN partners pa ON pa.id=d.partner_id`+w.SQL()+`
		ORDER BY m.doc_date, (m.qty_in > 0) DESC, COALESCE(d.doc_no, d.draft_no), m.id`, w.Args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bal := out.Opening
	out.TotalIn, out.TotalOut = decimal.Zero, decimal.Zero
	for rows.Next() {
		var r LedgerRow
		var fw string
		var tw *string
		var note string
		if err := rows.Scan(&r.Date, &r.DocNo, &r.DocumentID, &r.DocType, &r.PartnerID, &r.PartnerName, &fw, &tw, &note,
			&r.WarehouseID, &r.WarehouseCode, &r.Unit, &r.QtyIn, &r.QtyOut, &r.UnitPrice); err != nil {
			return nil, err
		}
		r.ProductCode = out.Product.Code
		r.Description = Describe(r.DocType, r.PartnerName, &fw, tw, note)
		bal = bal.Add(r.QtyIn).Sub(r.QtyOut)
		r.Balance = bal
		out.TotalIn = out.TotalIn.Add(r.QtyIn)
		out.TotalOut = out.TotalOut.Add(r.QtyOut)
		out.Rows = append(out.Rows, r)
	}
	out.Closing = bal
	return out, rows.Err()
}

// ---------- Hàng cần đặt từ phiếu bán tạm (REQ-046) ----------

// DemandDraft là phiếu tạm chứa mặt hàng.
type DemandDraft struct {
	DocumentID  int64           `json:"document_id"`
	DraftNo     string          `json:"draft_no"`
	DocDate     util.Date       `json:"doc_date"`
	PartnerID   *int64          `json:"partner_id"`
	PartnerName *string         `json:"partner_name"`
	Qty         decimal.Decimal `json:"qty"`
}

// DemandRow là nhu cầu một mặt hàng.
type DemandRow struct {
	Product     LedgerProduct   `json:"product"`
	QtyInDrafts decimal.Decimal `json:"qty_in_drafts"`
	TotalStock  decimal.Decimal `json:"total_stock"`
	Shortage    decimal.Decimal `json:"shortage"`
	Drafts      []DemandDraft   `json:"drafts"`
	ProductID   int64           `json:"product_id"`
	ProductCode string          `json:"product_code"`
	ProductName string          `json:"product_name"`
	ProductUnit string          `json:"unit"`
	// Bản mở rộng C5 (min_stock bật): tồn tối thiểu và SL cần đặt thêm; tắt ⇒ không có trong JSON.
	MinStock  *decimal.Decimal `json:"min_stock,omitempty"`
	OrderMore *decimal.Decimal `json:"order_more,omitempty"`
}

// DraftDemand tổng hợp SL trên phiếu bán tạm so với tồn tổng hiện tại.
func (s *Service) DraftDemand(ctx context.Context, onlyShortage bool) ([]DemandRow, error) {
	rows, err := s.Pool.Query(ctx, `SELECT p.id, p.code, p.name, p.unit, d.id, d.draft_no, d.doc_date, d.partner_id, pa.name, sum(l.qty)
		FROM document_lines l JOIN documents d ON d.id=l.document_id JOIN products p ON p.id=l.product_id
		LEFT JOIN partners pa ON pa.id=d.partner_id
		WHERE d.status='draft' AND d.doc_type='sale' AND NOT p.is_service
		GROUP BY p.id, p.code, p.name, p.unit, d.id, d.draft_no, d.doc_date, d.partner_id, pa.name
		ORDER BY p.code, d.doc_date, d.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DemandRow{}
	idx := map[int64]int{}
	for rows.Next() {
		var pr LedgerProduct
		var dd DemandDraft
		if err := rows.Scan(&pr.ID, &pr.Code, &pr.Name, &pr.Unit, &dd.DocumentID, &dd.DraftNo, &dd.DocDate, &dd.PartnerID, &dd.PartnerName, &dd.Qty); err != nil {
			return nil, err
		}
		i, ok := idx[pr.ID]
		if !ok {
			out = append(out, DemandRow{Product: pr, ProductID: pr.ID, ProductCode: pr.Code, ProductName: pr.Name, ProductUnit: pr.Unit,
				QtyInDrafts: decimal.Zero, TotalStock: decimal.Zero, Shortage: decimal.Zero, Drafts: []DemandDraft{}})
			i = len(out) - 1
			idx[pr.ID] = i
		}
		out[i].Drafts = append(out[i].Drafts, dd)
		out[i].QtyInDrafts = out[i].QtyInDrafts.Add(dd.Qty)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	ids := make([]int64, 0, len(out))
	for _, r := range out {
		ids = append(ids, r.ProductID)
	}
	if len(ids) > 0 {
		srows, err := s.Pool.Query(ctx, `SELECT product_id, sum(qty_in - qty_out) FROM stock_movements WHERE product_id = ANY($1) GROUP BY product_id`, ids)
		if err != nil {
			return nil, err
		}
		for srows.Next() {
			var id int64
			var q decimal.Decimal
			if err := srows.Scan(&id, &q); err != nil {
				srows.Close()
				return nil, err
			}
			out[idx[id]].TotalStock = q
		}
		srows.Close()
		if err := srows.Err(); err != nil {
			return nil, err
		}
	}
	res := []DemandRow{}
	for _, r := range out {
		sh := r.QtyInDrafts.Sub(r.TotalStock)
		if sh.IsPositive() {
			r.Shortage = sh
		}
		if onlyShortage && !r.Shortage.IsPositive() {
			continue
		}
		res = append(res, r)
	}
	sort.SliceStable(res, func(i, j int) bool { return res[i].Shortage.GreaterThan(res[j].Shortage) })
	return res, nil
}
