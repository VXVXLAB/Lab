// Package pricing: giá theo khách (bản mở rộng C6) — bảng giá riêng của khách và quy tắc chọn giá tự điền
// khi lập phiếu bán: (1) giá riêng của khách; (2) giá bán gần nhất của mã này cho khách này trên phiếu bán đã ghi sổ;
// (3) giá bán mặc định của mặt hàng.
package pricing

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/db"
	"kho/internal/util"
)

// Nguồn giá.
const (
	SourceCustomer = "customer"  // giá riêng của khách
	SourceLastSale = "last_sale" // giá bán gần nhất cho khách
	SourceDefault  = "default"   // giá bán mặc định
)

// SourceNames là tên tiếng Việt của nguồn giá.
var SourceNames = map[string]string{
	SourceCustomer: "Giá riêng của khách",
	SourceLastSale: "Giá bán gần nhất cho khách",
	SourceDefault:  "Giá bán mặc định",
}

// Quote là giá tự điền của một mặt hàng cho một khách.
type Quote struct {
	ProductID    int64           `json:"product_id"`
	Price        decimal.Decimal `json:"price"`
	Source       string          `json:"source"`
	SourceName   string          `json:"source_name"`
	DefaultPrice decimal.Decimal `json:"default_price"`
	// Khi source = last_sale: phiếu bán đã dùng giá đó.
	DocumentID *int64     `json:"document_id"`
	DocNo      *string    `json:"doc_no"`
	DocDate    *util.Date `json:"doc_date"`
	Note       *string    `json:"note"` // ghi chú của giá riêng

	// Bản mở rộng C10: mọi giá ở trên là theo ĐƠN VỊ GỐC. Giá bán gần nhất lấy từ dòng có đơn vị quy đổi được giữ
	// nguyên đơn giá + hệ số của dòng đó để không lệch khi lập lại đúng đơn vị đó (PriceFor).
	srcPrice, srcFactor decimal.Decimal
}

// PriceFor trả giá tự điền cho đơn vị có hệ số factor: cùng hệ số với dòng bán gần nhất ⇒ đúng đơn giá dòng đó;
// ngược lại giá theo đơn vị gốc × hệ số, làm tròn 2 chữ số.
func (q Quote) PriceFor(factor decimal.Decimal) decimal.Decimal {
	if q.Source == SourceLastSale && !q.srcFactor.IsZero() {
		if q.srcFactor.Equal(factor) {
			return q.srcPrice
		}
		return q.srcPrice.Div(q.srcFactor).Mul(factor).Round(2)
	}
	if factor.Equal(decimal.NewFromInt(1)) {
		return q.Price
	}
	return q.Price.Mul(factor).Round(2)
}

// Resolve tính giá tự điền cho nhiều mặt hàng (theo thứ tự ids; id không tồn tại bị bỏ qua) tại ngày date.
// "Giá bán gần nhất" = dòng của phiếu bán (không tính khách trả hàng) đã ghi sổ cho khách, ngày ≤ date, mới nhất theo
// ngày rồi thứ tự ghi sổ; dòng không có đơn giá bị bỏ qua.
func Resolve(ctx context.Context, q db.Q, partnerID int64, ids []int64, date util.Date) ([]Quote, error) {
	out := make([]Quote, 0, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `
SELECT p.id, p.sale_price, pp.price, pp.note, ls.unit_price, ls.unit_factor, ls.doc_id, ls.doc_no, ls.doc_date
  FROM products p
  LEFT JOIN partner_prices pp ON pp.product_id = p.id AND pp.partner_id = $1
  LEFT JOIN LATERAL (
    SELECT l.unit_price, l.unit_factor, d.id AS doc_id, d.doc_no, d.doc_date
      FROM document_lines l JOIN documents d ON d.id = l.document_id
     WHERE l.product_id = p.id AND d.partner_id = $1 AND d.doc_type = 'sale' AND d.status = 'posted'
       AND d.doc_date <= $3 AND l.unit_price IS NOT NULL
     ORDER BY d.doc_date DESC, d.posted_at DESC NULLS LAST, d.id DESC, l.line_no DESC
     LIMIT 1) ls ON TRUE
 WHERE p.id = ANY($2)`, partnerID, ids, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byID := map[int64]Quote{}
	for rows.Next() {
		var qt Quote
		var cust, last, lastF decimal.NullDecimal
		var note *string
		var docID *int64
		var docNo *string
		var docDate *time.Time
		if err := rows.Scan(&qt.ProductID, &qt.DefaultPrice, &cust, &note, &last, &lastF, &docID, &docNo, &docDate); err != nil {
			return nil, err
		}
		switch {
		case cust.Valid:
			qt.Price, qt.Source, qt.Note = cust.Decimal, SourceCustomer, note
		case last.Valid:
			qt.Price, qt.Source, qt.DocumentID, qt.DocNo = last.Decimal, SourceLastSale, docID, docNo
			if lastF.Valid && !lastF.Decimal.Equal(decimal.NewFromInt(1)) {
				qt.srcPrice, qt.srcFactor = last.Decimal, lastF.Decimal
				qt.Price = last.Decimal.Div(lastF.Decimal).Round(2)
			}
			if docDate != nil {
				d := util.NewDate(docDate.Year(), docDate.Month(), docDate.Day())
				qt.DocDate = &d
			}
		default:
			qt.Price, qt.Source = qt.DefaultPrice, SourceDefault
		}
		qt.SourceName = SourceNames[qt.Source]
		byID[qt.ProductID] = qt
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, id := range ids {
		if qt, ok := byID[id]; ok {
			out = append(out, qt)
		}
	}
	return out, nil
}

// PriceRow là một dòng bảng giá riêng.
type PriceRow struct {
	ProductID     int64           `json:"product_id"`
	ProductCode   string          `json:"product_code"`
	ProductName   string          `json:"product_name"`
	Unit          string          `json:"unit"`
	Price         decimal.Decimal `json:"price"`
	DefaultPrice  decimal.Decimal `json:"default_price"`
	Note          string          `json:"note"`
	UpdatedByName *string         `json:"updated_by_name"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

// List trả bảng giá riêng của khách (theo mã hàng).
func List(ctx context.Context, q db.Q, partnerID int64) ([]PriceRow, error) {
	rows, err := q.Query(ctx, `SELECT pp.product_id, p.code, p.name, p.unit, pp.price, p.sale_price, pp.note, u.full_name, pp.updated_at
		FROM partner_prices pp JOIN products p ON p.id = pp.product_id LEFT JOIN users u ON u.id = pp.updated_by
		WHERE pp.partner_id = $1 ORDER BY p.code`, partnerID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[PriceRow])
	if out == nil {
		out = []PriceRow{}
	}
	return out, err
}

// Item là một dòng gửi lên khi lưu bảng giá.
type Item struct {
	ProductID   int64            `json:"product_id"`
	ProductCode string           `json:"product_code"`
	Price       *decimal.Decimal `json:"price"`
	Note        string           `json:"note"`
}

// CheckPartner: đối tác phải tồn tại và là khách hàng.
func CheckPartner(ctx context.Context, q db.Q, partnerID int64) error {
	var isCus bool
	err := q.QueryRow(ctx, `SELECT is_customer FROM partners WHERE id=$1`, partnerID).Scan(&isCus)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.NotFound("đối tác")
	}
	if err != nil {
		return err
	}
	if !isCus {
		return apperr.ValidationField("partner_id", "Đối tác không phải là khách hàng, không có bảng giá bán riêng")
	}
	return nil
}

// Save thêm/sửa (upsert) giá riêng; replace = true ⇒ xóa các giá riêng không có trong danh sách.
func Save(ctx context.Context, pool *pgxpool.Pool, userID, partnerID int64, items []Item, replace bool) ([]PriceRow, error) {
	if len(items) > 5000 {
		return nil, apperr.ValidationField("items", "Tối đa 5000 dòng mỗi lần")
	}
	var out []PriceRow
	err := db.InTx(ctx, pool, func(tx pgx.Tx) error {
		if err := CheckPartner(ctx, tx, partnerID); err != nil {
			return err
		}
		before, err := List(ctx, tx, partnerID)
		if err != nil {
			return err
		}
		seen := map[int64]bool{}
		keep := []int64{}
		for i, it := range items {
			pid := it.ProductID
			if pid == 0 && strings.TrimSpace(it.ProductCode) != "" {
				if err := tx.QueryRow(ctx, `SELECT id FROM products WHERE upper(code)=upper($1)`, strings.TrimSpace(it.ProductCode)).Scan(&pid); err != nil {
					return apperr.New(400, apperr.CodeValidation, "Dòng "+itoa(i+1)+": không tìm thấy mã hàng "+it.ProductCode, map[string]any{"line_no": i + 1, "field": "product_code"})
				}
			}
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM products WHERE id=$1)`, pid).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return apperr.New(400, apperr.CodeValidation, "Dòng "+itoa(i+1)+": mặt hàng không tồn tại", map[string]any{"line_no": i + 1, "field": "product_id"})
			}
			if seen[pid] {
				return apperr.New(400, apperr.CodeValidation, "Dòng "+itoa(i+1)+": mặt hàng bị lặp", map[string]any{"line_no": i + 1, "field": "product_id"})
			}
			seen[pid] = true
			if it.Price == nil || it.Price.IsNegative() || it.Price.GreaterThanOrEqual(decimal.New(1, 14)) {
				return apperr.New(400, apperr.CodeValidation, "Dòng "+itoa(i+1)+": giá phải là số từ 0 trở lên", map[string]any{"line_no": i + 1, "field": "price"})
			}
			if _, err := tx.Exec(ctx, `INSERT INTO partner_prices(partner_id, product_id, price, note, updated_by, updated_at)
				VALUES ($1,$2,$3,$4,$5,now())
				ON CONFLICT (partner_id, product_id) DO UPDATE SET price=EXCLUDED.price, note=EXCLUDED.note, updated_by=EXCLUDED.updated_by, updated_at=now()`,
				partnerID, pid, it.Price.Round(2), strings.TrimSpace(it.Note), userID); err != nil {
				return err
			}
			keep = append(keep, pid)
		}
		if replace {
			if _, err := tx.Exec(ctx, `DELETE FROM partner_prices WHERE partner_id=$1 AND NOT (product_id = ANY($2))`, partnerID, keep); err != nil {
				return err
			}
		}
		out, err = List(ctx, tx, partnerID)
		if err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "partner_prices", partnerID, "updated", before, out)
	})
	return out, err
}

// Delete xóa giá riêng của một mặt hàng.
func Delete(ctx context.Context, pool *pgxpool.Pool, userID, partnerID, productID int64) error {
	return db.InTx(ctx, pool, func(tx pgx.Tx) error {
		var price decimal.Decimal
		err := tx.QueryRow(ctx, `DELETE FROM partner_prices WHERE partner_id=$1 AND product_id=$2 RETURNING price`, partnerID, productID).Scan(&price)
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.NotFound("giá riêng của mặt hàng này")
		}
		if err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "partner_prices", partnerID, "deleted", map[string]any{"product_id": productID, "price": price}, nil)
	})
}

func itoa(i int) string { return decimal.NewFromInt(int64(i)).String() }
