package util

import (
	"strings"

	"github.com/shopspring/decimal"
)

// Đọc số tiền thành chữ tiếng Việt cho dòng "Bằng chữ" (cùng quy tắc với frontend/src/lib/numberWords.ts):
// linh (105 = một trăm linh năm), mười/mươi, mốt (21), lăm (15, 25), "bốn" sau mươi (34 = ba mươi bốn —
// quyết định của controller, không dùng "tư"), nhóm giữa đọc đủ "không trăm" (1.005 = một nghìn không trăm linh năm),
// nhóm 000 bỏ qua, tỷ đọc lặp (1.000.000.000.000 = một nghìn tỷ). Làm tròn về đồng.

var vnDigits = [...]string{"không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"}

// readGroup đọc nhóm 3 chữ số; full = không phải nhóm đứng đầu ⇒ đọc đủ "không trăm", "linh".
func readGroup(n int64, full bool) []string {
	h, t, u := n/100, (n%100)/10, n%10
	var w []string
	if h > 0 || full {
		w = append(w, vnDigits[h], "trăm")
	}
	switch {
	case t == 0:
		if u > 0 && (h > 0 || full) {
			w = append(w, "linh")
		}
	case t == 1:
		w = append(w, "mười")
	default:
		w = append(w, vnDigits[t], "mươi")
	}
	if u > 0 {
		switch {
		case u == 1 && t > 1:
			w = append(w, "mốt")
		case u == 5 && t > 0:
			w = append(w, "lăm")
		default:
			w = append(w, vnDigits[u])
		}
	}
	return w
}

func readBelowBillion(n int64, leading bool) []string {
	units := [...]string{"", "nghìn", "triệu"}
	groups := [...]int64{n % 1000, (n / 1000) % 1000, n / 1_000_000}
	top := 2
	for top > 0 && groups[top] == 0 {
		top--
	}
	var w []string
	for i := top; i >= 0; i-- {
		if groups[i] == 0 {
			continue
		}
		w = append(w, readGroup(groups[i], !(leading && i == top))...)
		if units[i] != "" {
			w = append(w, units[i])
		}
	}
	return w
}

func readInt(n int64, leading bool) []string {
	if n >= 1_000_000_000 {
		w := append(readInt(n/1_000_000_000, leading), "tỷ")
		if low := n % 1_000_000_000; low > 0 {
			w = append(w, readBelowBillion(low, false)...)
		}
		return w
	}
	return readBelowBillion(n, leading)
}

// NumberToWords đọc số (làm tròn về số nguyên, nửa xa 0) thành chữ thường: 2590000 ⇒ "hai triệu năm trăm chín mươi nghìn".
func NumberToWords(d decimal.Decimal) string {
	n := d.Abs().Round(0).IntPart()
	if n == 0 {
		return "không"
	}
	words := strings.Join(readInt(n, true), " ")
	if d.IsNegative() {
		return "âm " + words
	}
	return words
}

// MoneyInWords: "Hai triệu năm trăm chín mươi nghìn đồng" (viết hoa chữ đầu, kết thúc "đồng"; số âm ⇒ "Âm …").
func MoneyInWords(d decimal.Decimal) string {
	w := []rune(NumberToWords(d))
	return strings.ToUpper(string(w[0])) + string(w[1:]) + " đồng"
}
