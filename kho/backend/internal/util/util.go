// Package util chứa các kiểu và hàm tiện ích dùng chung: kiểu ngày, chuẩn hóa chuỗi tìm kiếm,
// số thập phân.
package util

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/shopspring/decimal"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

func init() {
	// JSON trả số (number) chứ không phải chuỗi — SPEC §2 "JSON trả number".
	decimal.MarshalJSONWithoutQuotes = true
}

// DateLayout là định dạng ngày trong JSON và tham số truy vấn.
const DateLayout = "2006-01-02"

// Date là một ngày (không có giờ), JSON dạng "YYYY-MM-DD".
type Date struct{ time.Time }

// NewDate tạo Date từ năm/tháng/ngày.
func NewDate(y int, m time.Month, d int) Date {
	return Date{time.Date(y, m, d, 0, 0, 0, 0, time.UTC)}
}

// Today trả về ngày hôm nay theo giờ Việt Nam (UTC+7).
func Today() Date {
	now := time.Now().In(VNZone)
	return NewDate(now.Year(), now.Month(), now.Day())
}

// VNZone là múi giờ Việt Nam.
var VNZone = time.FixedZone("ICT", 7*3600)

// ParseDate đọc chuỗi "YYYY-MM-DD" (chấp nhận cả "DD/MM/YYYY").
func ParseDate(s string) (Date, error) {
	s = strings.TrimSpace(s)
	if t, err := time.Parse(DateLayout, s); err == nil {
		return Date{t}, nil
	}
	if t, err := time.Parse("02/01/2006", s); err == nil {
		return Date{t}, nil
	}
	return Date{}, fmt.Errorf("ngày không hợp lệ: %q (định dạng YYYY-MM-DD)", s)
}

// String trả về "YYYY-MM-DD".
func (d Date) String() string { return d.Format(DateLayout) }

// VN trả về "DD/MM/YYYY".
func (d Date) VN() string { return d.Format("02/01/2006") }

// MarshalJSON ghi ngày dạng chuỗi.
func (d Date) MarshalJSON() ([]byte, error) {
	if d.IsZero() {
		return []byte("null"), nil
	}
	return json.Marshal(d.String())
}

// UnmarshalJSON đọc ngày dạng chuỗi.
func (d *Date) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		if string(b) == "null" {
			*d = Date{}
			return nil
		}
		return fmt.Errorf("ngày phải là chuỗi YYYY-MM-DD")
	}
	if s == "" {
		*d = Date{}
		return nil
	}
	v, err := ParseDate(s)
	if err != nil {
		return err
	}
	*d = v
	return nil
}

// Scan đọc giá trị DATE từ PostgreSQL.
func (d *Date) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*d = Date{}
	case time.Time:
		*d = NewDate(v.Year(), v.Month(), v.Day())
	case string:
		p, err := ParseDate(v)
		if err != nil {
			return err
		}
		*d = p
	default:
		return fmt.Errorf("không đọc được kiểu ngày %T", src)
	}
	return nil
}

// Value ghi giá trị DATE vào PostgreSQL.
func (d Date) Value() (driver.Value, error) {
	if d.IsZero() {
		return nil, nil
	}
	return d.String(), nil
}

// StripAccents bỏ dấu tiếng Việt (giữ hoa/thường), Đ → D, đ → d.
func StripAccents(s string) string {
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	out, _, err := transform.String(t, s)
	if err != nil {
		out = s
	}
	return strings.NewReplacer("đ", "d", "Đ", "D").Replace(out)
}

// Fold chuẩn hóa chuỗi để tìm kiếm: chữ thường, bỏ dấu tiếng Việt, đ → d.
func Fold(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(StripAccents(s))), " ")
}

// LikePattern tạo mẫu ILIKE '%...%' an toàn từ chuỗi đã Fold.
func LikePattern(q string) string {
	q = Fold(q)
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(q) + "%"
}

// RoundVND làm tròn tiền về đồng (0 chữ số thập phân), nửa lên xa 0.
func RoundVND(d decimal.Decimal) decimal.Decimal { return d.Round(0) }

// Dec tạo decimal từ chuỗi; panic nếu sai (chỉ dùng cho hằng số).
func Dec(s string) decimal.Decimal { return decimal.RequireFromString(s) }

// FormatVND định dạng số kiểu Việt Nam: 3.990.000 ; 1,5
func FormatVND(d decimal.Decimal) string {
	neg := d.IsNegative()
	d = d.Abs()
	intPart := d.Truncate(0)
	frac := d.Sub(intPart)
	s := intPart.String()
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	res := b.String()
	if !frac.IsZero() {
		fs := frac.String() // "0.5"
		res += "," + strings.TrimPrefix(fs, "0.")
	}
	if neg {
		res = "-" + res
	}
	return res
}
