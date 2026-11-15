// Package vat: thuế GTGT trên phiếu (bản mở rộng C11) — mã thuế suất, tính tiền thuế dòng.
package vat

import (
	"context"

	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/db"
)

// Codes là các mã thuế suất của mặt hàng / mặc định chung: "KCT" (không chịu thuế), "0", "5", "8", "10".
var Codes = []string{"KCT", "0", "5", "8", "10"}

// ValidCode kiểm tra mã thuế suất.
func ValidCode(c string) bool {
	for _, x := range Codes {
		if x == c {
			return true
		}
	}
	return false
}

// CheckCode trả lỗi 400 nếu mã không hợp lệ.
func CheckCode(field string, c *string) error {
	if c != nil && !ValidCode(*c) {
		return apperr.ValidationField(field, "Thuế suất phải là KCT, 0, 5, 8 hoặc 10")
	}
	return nil
}

// RateOf đổi mã thành thuế suất trên dòng (nil = không thuế).
func RateOf(code string) *decimal.Decimal {
	if code == "" || code == "KCT" {
		return nil
	}
	d, err := decimal.NewFromString(code)
	if err != nil {
		return nil
	}
	return &d
}

// ValidRate kiểm tra thuế suất dòng (0, 5, 8, 10).
func ValidRate(r decimal.Decimal) bool {
	for _, x := range []int64{0, 5, 8, 10} {
		if r.Equal(decimal.NewFromInt(x)) {
			return true
		}
	}
	return false
}

// Tax = round(thành tiền × thuế suất / 100) đến đồng (dòng âm ⇒ thuế âm).
func Tax(amount decimal.Decimal, rate *decimal.Decimal) decimal.Decimal {
	if rate == nil {
		return decimal.Zero
	}
	return amount.Mul(*rate).Div(decimal.NewFromInt(100)).Round(0)
}

// DefaultCode đọc thuế suất mặc định chung ("" = không đặt).
func DefaultCode(ctx context.Context, q db.Q) (string, error) {
	var c *string
	if err := q.QueryRow(ctx, `SELECT default_vat FROM settings WHERE id=1`).Scan(&c); err != nil {
		return "", err
	}
	if c == nil {
		return "", nil
	}
	return *c, nil
}
