package util

import (
	"bytes"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/shopspring/decimal"
)

// OptDec là trường số tùy chọn trong body JSON: phân biệt "không gửi" (Set=false ⇒ giữ nguyên)
// với "gửi null" (Set=true, Val=nil ⇒ xóa) và "gửi số".
type OptDec struct {
	Set bool
	Val *decimal.Decimal
}

// UnmarshalJSON đọc số / chuỗi số / null.
func (o *OptDec) UnmarshalJSON(b []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		o.Val = nil
		return nil
	}
	var d decimal.Decimal
	if err := d.UnmarshalJSON(b); err != nil {
		return err
	}
	o.Val = &d
	return nil
}

// OptInt là trường số nguyên tùy chọn (như OptDec).
type OptInt struct {
	Set bool
	Val *int64
}

// UnmarshalJSON đọc số nguyên / null.
func (o *OptInt) UnmarshalJSON(b []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		o.Val = nil
		return nil
	}
	var n int64
	if err := json.Unmarshal(b, &n); err != nil {
		return fmt.Errorf("phải là số nguyên")
	}
	o.Val = &n
	return nil
}

// NullInt là số nguyên có thể NULL (đọc từ CSDL, ghi JSON null/số).
type NullInt struct {
	Int   int64
	Valid bool
}

// Scan đọc từ CSDL.
func (n *NullInt) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		n.Valid = false
	case int64:
		n.Int, n.Valid = v, true
	case int32:
		n.Int, n.Valid = int64(v), true
	default:
		return fmt.Errorf("không đọc được số nguyên %T", src)
	}
	return nil
}

// Value ghi vào CSDL.
func (n NullInt) Value() (driver.Value, error) {
	if !n.Valid {
		return nil, nil
	}
	return n.Int, nil
}

// MarshalJSON ghi null hoặc số.
func (n NullInt) MarshalJSON() ([]byte, error) {
	if !n.Valid {
		return []byte("null"), nil
	}
	return []byte(strconv.FormatInt(n.Int, 10)), nil
}

// OptDate là trường ngày tùy chọn: Set=false ⇒ không gửi; Set=true và Val rỗng ⇒ gửi null / "".
type OptDate struct {
	Set bool
	Val Date
}

// UnmarshalJSON đọc chuỗi YYYY-MM-DD / null.
func (o *OptDate) UnmarshalJSON(b []byte) error {
	o.Set = true
	return o.Val.UnmarshalJSON(b)
}

// OptStr là trường chuỗi tùy chọn (như OptDec): Set=false ⇒ không gửi; Val=nil ⇒ gửi null.
type OptStr struct {
	Set bool
	Val *string
}

// UnmarshalJSON đọc chuỗi / số / null (số được đổi thành chuỗi, vd. thuế suất 10 ⇒ "10").
func (o *OptStr) UnmarshalJSON(b []byte) error {
	o.Set = true
	t := bytes.TrimSpace(b)
	if bytes.Equal(t, []byte("null")) {
		o.Val = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(t, &s); err != nil {
		var n json.Number
		if err2 := json.Unmarshal(t, &n); err2 != nil {
			return fmt.Errorf("phải là chuỗi")
		}
		s = n.String()
	}
	o.Val = &s
	return nil
}

// NullStr là chuỗi có thể NULL (đọc từ CSDL, ghi JSON null/chuỗi).
type NullStr struct {
	S     string
	Valid bool
}

// Scan đọc từ CSDL.
func (n *NullStr) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		n.Valid = false
	case string:
		n.S, n.Valid = v, true
	case []byte:
		n.S, n.Valid = string(v), true
	default:
		return fmt.Errorf("không đọc được chuỗi %T", src)
	}
	return nil
}

// Value ghi vào CSDL.
func (n NullStr) Value() (driver.Value, error) {
	if !n.Valid {
		return nil, nil
	}
	return n.S, nil
}

// MarshalJSON ghi null hoặc chuỗi.
func (n NullStr) MarshalJSON() ([]byte, error) {
	if !n.Valid {
		return []byte("null"), nil
	}
	return json.Marshal(n.S)
}
