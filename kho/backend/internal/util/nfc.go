package util

import (
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// NFC chuẩn hóa chuỗi về dạng Unicode NFC (chữ tiếng Việt dựng sẵn). Chuỗi ASCII trả nguyên (nhanh).
func NFC(s string) string {
	for i := 0; i < len(s); i++ {
		if s[i] >= utf8.RuneSelf {
			return norm.NFC.String(s)
		}
	}
	return s
}
