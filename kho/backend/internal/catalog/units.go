package catalog

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/db"
)

// ProductUnit là một đơn vị quy đổi của mặt hàng (bản mở rộng C10): 1 unit = factor đơn vị gốc.
type ProductUnit struct {
	Unit   string          `json:"unit"`
	Factor decimal.Decimal `json:"factor"`
	InUse  bool            `json:"in_use"`
}

// MaxFactor là hệ số quy đổi lớn nhất.
var MaxFactor = decimal.New(1, 9)

// ListUnits trả các đơn vị quy đổi của mặt hàng (theo tên); in_use = đã có dòng chứng từ dùng đơn vị này với hệ số này.
func ListUnits(ctx context.Context, q db.Q, productID int64) ([]ProductUnit, error) {
	rows, err := q.Query(ctx, `SELECT u.unit, u.factor, EXISTS(SELECT 1 FROM document_lines l
			WHERE l.product_id = u.product_id AND lower(l.unit) = lower(u.unit) AND l.unit_factor = u.factor)
		FROM product_units u WHERE u.product_id = $1 ORDER BY u.factor, lower(u.unit)`, productID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[ProductUnit])
	if out == nil {
		out = []ProductUnit{}
	}
	return out, err
}

// FindUnit tìm đơn vị quy đổi (không phân biệt hoa thường) ⇒ tên chuẩn, hệ số; không có ⇒ found = false.
func FindUnit(ctx context.Context, q db.Q, productID int64, unit string) (string, decimal.Decimal, bool, error) {
	var name string
	var f decimal.Decimal
	err := q.QueryRow(ctx, `SELECT unit, factor FROM product_units WHERE product_id=$1 AND lower(unit)=lower($2)`, productID, strings.TrimSpace(unit)).Scan(&name, &f)
	if err == pgx.ErrNoRows {
		return "", decimal.Zero, false, nil
	}
	if err != nil {
		return "", decimal.Zero, false, err
	}
	return name, f, true, nil
}

// UnitInput là một đơn vị gửi lên khi lưu.
type UnitInput struct {
	Unit   string           `json:"unit"`
	Factor *decimal.Decimal `json:"factor"`
}

// SaveUnits thay toàn bộ danh sách đơn vị quy đổi của mặt hàng. Đơn vị đang dùng trên chứng từ không xóa / đổi hệ số được
// (409 IN_USE). Hệ số > 0, tối đa 6 chữ số thập phân; không trùng tên đơn vị gốc; tên không lặp.
func (s *Service) SaveUnits(ctx context.Context, userID, productID int64, items []UnitInput) ([]ProductUnit, error) {
	if len(items) > 50 {
		return nil, apperr.ValidationField("items", "Tối đa 50 đơn vị quy đổi cho một mặt hàng")
	}
	var out []ProductUnit
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		p, err := s.GetProduct(ctx, tx, productID)
		if err != nil {
			return err
		}
		if p.IsService {
			return apperr.Validation("Mã dịch vụ không có đơn vị quy đổi")
		}
		if _, err := tx.Exec(ctx, `SELECT 1 FROM products WHERE id=$1 FOR UPDATE`, productID); err != nil {
			return err
		}
		before, err := ListUnits(ctx, tx, productID)
		if err != nil {
			return err
		}
		seen := map[string]bool{}
		next := map[string]decimal.Decimal{}
		names := map[string]string{}
		for i, it := range items {
			u := strings.TrimSpace(it.Unit)
			k := strings.ToLower(u)
			bad := func(field, msg string) error {
				return apperr.New(http.StatusBadRequest, apperr.CodeValidation, fmt.Sprintf("Dòng %d: %s", i+1, msg), map[string]any{"line_no": i + 1, "field": field})
			}
			switch {
			case u == "":
				return bad("unit", "vui lòng nhập tên đơn vị")
			case len([]rune(u)) > 50:
				return bad("unit", "tên đơn vị quá dài")
			case strings.EqualFold(u, p.Unit):
				return bad("unit", "trùng đơn vị gốc "+p.Unit+" (hệ số luôn là 1)")
			case seen[k]:
				return bad("unit", "đơn vị "+u+" bị lặp")
			case it.Factor == nil || !it.Factor.IsPositive():
				return bad("factor", "hệ số phải lớn hơn 0")
			case !it.Factor.Equal(it.Factor.Round(6)):
				return bad("factor", "hệ số tối đa 6 chữ số thập phân")
			case it.Factor.GreaterThanOrEqual(MaxFactor):
				return bad("factor", "hệ số quá lớn")
			}
			seen[k] = true
			next[k], names[k] = *it.Factor, u
		}
		for _, b := range before {
			k := strings.ToLower(b.Unit)
			f, keep := next[k]
			if b.InUse && (!keep || !f.Equal(b.Factor)) {
				return apperr.New(http.StatusConflict, apperr.CodeInUse,
					fmt.Sprintf("Đơn vị %s (hệ số %s) đã dùng trên chứng từ, không xóa hay đổi hệ số được", b.Unit, b.Factor.String()),
					map[string]any{"unit": b.Unit})
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM product_units WHERE product_id=$1`, productID); err != nil {
			return err
		}
		for k, f := range next {
			if _, err := tx.Exec(ctx, `INSERT INTO product_units(product_id, unit, factor, updated_by) VALUES ($1,$2,$3,$4)`, productID, names[k], f, userID); err != nil {
				return err
			}
		}
		out, err = ListUnits(ctx, tx, productID)
		if err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "product_units", productID, "updated", before, out)
	})
	return out, err
}
