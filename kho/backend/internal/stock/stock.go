// Package stock: tồn kho tính từ stock_movements, kiểm tra không âm kho (R6), giá vốn so sánh (R4).
package stock

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"kho/internal/db"
	"kho/internal/util"
)

// Mov là một bút toán kho giả định (chưa ghi) dùng để kiểm tra tồn.
type Mov struct {
	ProductID   int64
	WarehouseID int64
	Date        util.Date
	In          decimal.Decimal
	Out         decimal.Decimal
}

// Pair là cặp (mặt hàng, kho) bị ảnh hưởng, kiểm tra từ ngày From trở đi.
type Pair struct {
	ProductID   int64
	WarehouseID int64
	From        util.Date
}

// Shortage mô tả một vi phạm tồn kho (R6).
type Shortage struct {
	ProductID     int64           `json:"product_id"`
	ProductCode   string          `json:"product_code"`
	ProductName   string          `json:"product_name"`
	Unit          string          `json:"unit"`
	WarehouseID   int64           `json:"warehouse_id"`
	WarehouseCode string          `json:"warehouse_code"`
	WarehouseName string          `json:"warehouse_name"`
	Date          util.Date       `json:"date"`
	Available     decimal.Decimal `json:"available"`
	Required      decimal.Decimal `json:"required"`
	Shortage      decimal.Decimal `json:"shortage"`
	Balance       decimal.Decimal `json:"balance"`
	Message       string          `json:"message"`
}

// MergePairs gộp các cặp bị ảnh hưởng, giữ ngày nhỏ nhất.
func MergePairs(lists ...[]Pair) []Pair {
	m := map[[2]int64]util.Date{}
	for _, l := range lists {
		for _, p := range l {
			k := [2]int64{p.ProductID, p.WarehouseID}
			if d, ok := m[k]; !ok || p.From.Before(d.Time) {
				m[k] = p.From
			}
		}
	}
	out := make([]Pair, 0, len(m))
	for k, d := range m {
		out = append(out, Pair{ProductID: k[0], WarehouseID: k[1], From: d})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ProductID != out[j].ProductID {
			return out[i].ProductID < out[j].ProductID
		}
		return out[i].WarehouseID < out[j].WarehouseID
	})
	return out
}

// PairsOf trả các cặp của danh sách bút toán.
func PairsOf(movs []Mov) []Pair {
	ps := make([]Pair, 0, len(movs))
	for _, m := range movs {
		ps = append(ps, Pair{ProductID: m.ProductID, WarehouseID: m.WarehouseID, From: m.Date})
	}
	return MergePairs(ps)
}

// LockPairs khóa (advisory, theo transaction) từng cặp mặt hàng+kho theo thứ tự cố định,
// để hai máy cùng ghi sổ không bán vượt tồn (SPEC §5).
func LockPairs(ctx context.Context, tx pgx.Tx, pairs []Pair) error {
	sorted := MergePairs(pairs)
	for _, p := range sorted {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1::int4, $2::int4)`, int32(p.ProductID), int32(p.WarehouseID)); err != nil {
			return err
		}
	}
	return nil
}

// CheckShortages tính tồn cuối mỗi ngày cho các cặp bị ảnh hưởng, giả định bút toán của chứng từ
// excludeDocID được thay bằng hyp. Trả các vi phạm (tồn < 0) — mỗi cặp một dòng, ngày vi phạm đầu tiên.
func CheckShortages(ctx context.Context, q db.Q, excludeDocID int64, hyp []Mov, pairs []Pair) ([]Shortage, error) {
	if len(pairs) == 0 {
		return []Shortage{}, nil
	}
	var hp, hw []int64
	var hd []time.Time
	var hdelta []decimal.Decimal
	for _, m := range hyp {
		hp = append(hp, m.ProductID)
		hw = append(hw, m.WarehouseID)
		hd = append(hd, m.Date.Time)
		hdelta = append(hdelta, m.In.Sub(m.Out))
	}
	var pp, pw []int64
	var pd []time.Time
	for _, p := range pairs {
		pp = append(pp, p.ProductID)
		pw = append(pw, p.WarehouseID)
		pd = append(pd, p.From.Time)
	}
	rows, err := q.Query(ctx, `
WITH hyp AS (
  SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::date[], $4::numeric[]) AS h(product_id, warehouse_id, doc_date, delta)
), pairs AS (
  SELECT * FROM unnest($5::bigint[], $6::bigint[], $7::date[]) AS p(product_id, warehouse_id, from_date)
), mv AS (
  SELECT m.product_id, m.warehouse_id, m.doc_date, m.qty_in - m.qty_out AS delta
    FROM stock_movements m JOIN pairs p ON p.product_id=m.product_id AND p.warehouse_id=m.warehouse_id
   WHERE m.document_id <> $8
  UNION ALL
  SELECT h.product_id, h.warehouse_id, h.doc_date, h.delta FROM hyp h
), daily AS (
  SELECT product_id, warehouse_id, doc_date, sum(delta) AS d FROM mv GROUP BY 1,2,3
), run AS (
  SELECT product_id, warehouse_id, doc_date,
         sum(d) OVER (PARTITION BY product_id, warehouse_id ORDER BY doc_date) AS bal
    FROM daily
), bad AS (
  SELECT DISTINCT ON (r.product_id, r.warehouse_id) r.product_id, r.warehouse_id, r.doc_date, r.bal
    FROM run r JOIN pairs p ON p.product_id=r.product_id AND p.warehouse_id=r.warehouse_id
   WHERE r.doc_date >= p.from_date AND r.bal < 0
   ORDER BY r.product_id, r.warehouse_id, r.doc_date
)
SELECT b.product_id, pr.code, pr.name, pr.unit, b.warehouse_id, w.code, w.name, b.doc_date, b.bal,
       COALESCE((SELECT sum(h.delta) FROM hyp h WHERE h.product_id=b.product_id AND h.warehouse_id=b.warehouse_id AND h.doc_date<=b.doc_date), 0) AS doc_net
  FROM bad b JOIN products pr ON pr.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id
 ORDER BY pr.code, w.code`, hp, hw, hd, hdelta, pp, pw, pd, excludeDocID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Shortage{}
	for rows.Next() {
		var s Shortage
		var docNet decimal.Decimal
		if err := rows.Scan(&s.ProductID, &s.ProductCode, &s.ProductName, &s.Unit, &s.WarehouseID, &s.WarehouseCode, &s.WarehouseName, &s.Date, &s.Balance, &docNet); err != nil {
			return nil, err
		}
		s.Shortage = s.Balance.Neg()
		s.Available = s.Balance.Sub(docNet)
		if docNet.IsNegative() {
			s.Required = docNet.Neg()
		} else {
			s.Required = decimal.Zero
		}
		if s.Required.IsPositive() {
			s.Message = fmt.Sprintf("Mặt hàng %s - %s tại %s ngày %s: tồn %s, cần %s, thiếu %s",
				s.ProductCode, s.ProductName, s.WarehouseName, s.Date.VN(),
				util.FormatVND(maxZero(s.Available)), util.FormatVND(s.Required), util.FormatVND(s.Shortage))
		} else {
			s.Message = fmt.Sprintf("Mặt hàng %s - %s tại %s ngày %s sẽ bị âm kho %s (đã có phiếu xuất phía sau dùng số hàng này)",
				s.ProductCode, s.ProductName, s.WarehouseName, s.Date.VN(), util.FormatVND(s.Shortage))
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func maxZero(d decimal.Decimal) decimal.Decimal {
	if d.IsNegative() {
		return decimal.Zero
	}
	return d
}

// WarehouseQty là tồn của một mặt hàng tại một kho.
type WarehouseQty struct {
	WarehouseID int64           `json:"warehouse_id"`
	Code        string          `json:"code"`
	Name        string          `json:"name"`
	Qty         decimal.Decimal `json:"qty"`
}

// ByWarehouse trả tồn từng kho (mọi kho đang dùng hoặc có tồn) của mặt hàng tính đến hết ngày asOf.
func ByWarehouse(ctx context.Context, q db.Q, productID int64, asOf util.Date) ([]WarehouseQty, decimal.Decimal, error) {
	rows, err := q.Query(ctx, `SELECT w.id, w.code, w.name, COALESCE(sum(m.qty_in - m.qty_out), 0)
		FROM warehouses w LEFT JOIN stock_movements m ON m.warehouse_id=w.id AND m.product_id=$1 AND m.doc_date <= $2
		GROUP BY w.id, w.code, w.name, w.active
		HAVING w.active OR COALESCE(sum(m.qty_in - m.qty_out), 0) <> 0
		ORDER BY w.code`, productID, asOf)
	if err != nil {
		return nil, decimal.Zero, err
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByPos[WarehouseQty])
	if err != nil {
		return nil, decimal.Zero, err
	}
	total := decimal.Zero
	for _, x := range list {
		total = total.Add(x.Qty)
	}
	return list, total, nil
}

// CostInfo là giá vốn so sánh (R4).
type CostInfo struct {
	Price  decimal.Decimal
	Source string // last_purchase | default | none
}

// CostPrices trả giá vốn so sánh cho nhiều mặt hàng tại ngày date: đơn giá nhập mua gần nhất
// (phiếu mua đã ghi sổ, ngày ≤ date, mọi kho); nếu chưa mua thì giá mua mặc định; nếu = 0 thì none.
func CostPrices(ctx context.Context, q db.Q, productIDs []int64, date util.Date) (map[int64]CostInfo, error) {
	out := map[int64]CostInfo{}
	if len(productIDs) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `
SELECT p.id, p.purchase_price, lp.unit_price
  FROM products p
  LEFT JOIN LATERAL (
    SELECT l.unit_price FROM document_lines l JOIN documents d ON d.id=l.document_id
     WHERE l.product_id=p.id AND d.doc_type='purchase' AND d.status='posted' AND d.doc_date <= $2 AND l.unit_price IS NOT NULL
     ORDER BY d.doc_date DESC, d.posted_at DESC NULLS LAST, d.id DESC, l.line_no DESC
     LIMIT 1) lp ON TRUE
 WHERE p.id = ANY($1)`, productIDs, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var def decimal.Decimal
		var last decimal.NullDecimal
		if err := rows.Scan(&id, &def, &last); err != nil {
			return nil, err
		}
		switch {
		case last.Valid:
			out[id] = CostInfo{Price: last.Decimal, Source: "last_purchase"}
		case def.IsPositive():
			out[id] = CostInfo{Price: def, Source: "default"}
		default:
			out[id] = CostInfo{Price: decimal.Zero, Source: "none"}
		}
	}
	return out, rows.Err()
}

// PriceInfo là thông tin giá & tồn của một mặt hàng tại một ngày (dùng khi nhập dòng phiếu).
type PriceInfo struct {
	ProductID        int64            `json:"product_id"`
	Code             string           `json:"code"`
	Name             string           `json:"name"`
	Unit             string           `json:"unit"`
	IsService        bool             `json:"is_service"`
	Date             util.Date        `json:"date"`
	SalePrice        decimal.Decimal  `json:"sale_price"`
	PurchasePrice    decimal.Decimal  `json:"purchase_price"`
	CostPrice        decimal.Decimal  `json:"cost_price"`
	CostSource       string           `json:"cost_source"`
	TotalStock       decimal.Decimal  `json:"total_stock"`
	StockByWarehouse []WarehouseQty   `json:"stock_by_warehouse"`
	WarehouseQty     *decimal.Decimal `json:"warehouse_qty,omitempty"`
}

// PriceInfos trả thông tin giá & tồn cho nhiều mặt hàng (theo thứ tự ids) bằng vài truy vấn gộp.
// Trả thêm danh sách id không tồn tại. warehouseID (tùy chọn) ⇒ điền warehouse_qty.
func PriceInfos(ctx context.Context, q db.Q, ids []int64, date util.Date, warehouseID *int64) ([]PriceInfo, []int64, error) {
	rows, err := q.Query(ctx, `SELECT id, code, name, unit, is_service, sale_price, purchase_price FROM products WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, nil, err
	}
	byID := map[int64]*PriceInfo{}
	for rows.Next() {
		var p PriceInfo
		if err := rows.Scan(&p.ProductID, &p.Code, &p.Name, &p.Unit, &p.IsService, &p.SalePrice, &p.PurchasePrice); err != nil {
			rows.Close()
			return nil, nil, err
		}
		p.Date = date
		p.TotalStock = decimal.Zero
		p.StockByWarehouse = []WarehouseQty{}
		byID[p.ProductID] = &p
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	var missing, found []int64
	for _, id := range ids {
		if _, ok := byID[id]; ok {
			found = append(found, id)
		} else {
			missing = append(missing, id)
		}
	}
	costs, err := CostPrices(ctx, q, found, date)
	if err != nil {
		return nil, nil, err
	}
	// Tồn từng (mặt hàng, kho) đến hết ngày date; kho đang dùng luôn có mặt, kho ngừng dùng chỉ khi còn tồn.
	srows, err := q.Query(ctx, `SELECT p.id, w.id, w.code, w.name, w.active, COALESCE(m.qty, 0)
		FROM unnest($1::bigint[]) AS p(id) CROSS JOIN warehouses w
		LEFT JOIN (SELECT product_id, warehouse_id, sum(qty_in - qty_out) AS qty FROM stock_movements
		           WHERE product_id = ANY($1) AND doc_date <= $2 GROUP BY 1, 2) m ON m.product_id=p.id AND m.warehouse_id=w.id
		ORDER BY p.id, w.code`, found, date)
	if err != nil {
		return nil, nil, err
	}
	defer srows.Close()
	for srows.Next() {
		var pid int64
		var wq WarehouseQty
		var active bool
		if err := srows.Scan(&pid, &wq.WarehouseID, &wq.Code, &wq.Name, &active, &wq.Qty); err != nil {
			return nil, nil, err
		}
		p := byID[pid]
		p.TotalStock = p.TotalStock.Add(wq.Qty)
		if warehouseID != nil && *warehouseID == wq.WarehouseID {
			v := wq.Qty
			p.WarehouseQty = &v
		}
		if active || !wq.Qty.IsZero() {
			p.StockByWarehouse = append(p.StockByWarehouse, wq)
		}
	}
	if err := srows.Err(); err != nil {
		return nil, nil, err
	}
	out := make([]PriceInfo, 0, len(found))
	for _, id := range found {
		p := byID[id]
		c := costs[id]
		p.CostPrice, p.CostSource = c.Price, c.Source
		if p.IsService || p.CostSource == "" {
			p.CostSource = "none"
			p.CostPrice = decimal.Zero
		}
		if warehouseID != nil && p.WarehouseQty == nil {
			z := decimal.Zero
			p.WarehouseQty = &z
		}
		out = append(out, *p)
	}
	return out, missing, nil
}

// StockTotals trả tồn tổng (và tồn tại một kho nếu có) đến hết ngày date của nhiều mặt hàng — một truy vấn gộp.
func StockTotals(ctx context.Context, q db.Q, ids []int64, date util.Date, warehouseID *int64) (map[int64][2]decimal.Decimal, error) {
	out := map[int64][2]decimal.Decimal{}
	if len(ids) == 0 {
		return out, nil
	}
	var wh any
	if warehouseID != nil {
		wh = *warehouseID
	}
	rows, err := q.Query(ctx, `SELECT product_id, sum(qty_in - qty_out),
		COALESCE(sum(qty_in - qty_out) FILTER (WHERE warehouse_id = $3::bigint), 0)
		FROM stock_movements WHERE product_id = ANY($1) AND doc_date <= $2 GROUP BY product_id`, ids, date, wh)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var t, w decimal.Decimal
		if err := rows.Scan(&id, &t, &w); err != nil {
			return nil, err
		}
		out[id] = [2]decimal.Decimal{t, w}
	}
	return out, rows.Err()
}
