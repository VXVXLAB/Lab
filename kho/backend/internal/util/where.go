package util

import (
	"fmt"
	"strings"
)

// Where xây mệnh đề WHERE với tham số đánh số $n.
type Where struct {
	conds []string
	Args  []any
}

// Add thêm điều kiện; dùng "?" làm chỗ giữ tham số (mỗi "?" ứng với một arg theo thứ tự).
func (w *Where) Add(cond string, args ...any) {
	for _, a := range args {
		w.Args = append(w.Args, a)
		cond = strings.Replace(cond, "?", fmt.Sprintf("$%d", len(w.Args)), 1)
	}
	w.conds = append(w.conds, cond)
}

// Arg thêm một tham số và trả chỗ giữ "$n".
func (w *Where) Arg(a any) string {
	w.Args = append(w.Args, a)
	return fmt.Sprintf("$%d", len(w.Args))
}

// SQL trả " WHERE ..." hoặc "".
func (w *Where) SQL() string {
	if len(w.conds) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(w.conds, " AND ")
}

// And trả các điều kiện nối bằng AND, có tiền tố " AND " (hoặc "" nếu rỗng).
func (w *Where) And() string {
	if len(w.conds) == 0 {
		return ""
	}
	return " AND " + strings.Join(w.conds, " AND ")
}

// SearchTokens tách chuỗi tìm kiếm thành các từ đã chuẩn hóa (chữ thường, bỏ dấu, bỏ dấu câu như "–", ",", ".").
// "Việt – Hàn" ⇒ ["viet", "han"].
func SearchTokens(q string) []string {
	f := Fold(q)
	return strings.FieldsFunc(f, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9')
	})
}

// partnerKeys trả biểu thức SQL (đã chuẩn hóa như SearchTokens) cho tên và mã đối tác của bí danh alias:
// tên được đệm khoảng trắng hai đầu để so khớp nguyên từ ("% thanh %").
func partnerKeys(alias string) (name, code, extra string) {
	name = `(' ' || btrim(regexp_replace(kho_fold(` + alias + `.name), '[^a-z0-9]+', ' ', 'g')) || ' ')`
	code = `regexp_replace(kho_fold(` + alias + `.code), '[^a-z0-9]+', '', 'g')`
	extra = `regexp_replace(kho_fold(` + alias + `.phone || ' ' || ` + alias + `.tax_code), '[^a-z0-9]+', '', 'g')`
	return
}

// PartnerMatchSQL trả điều kiện SQL "mọi từ đều có mặt" (thứ tự bất kỳ, không dấu, bỏ dấu câu) trong tên, mã,
// điện thoại hoặc MST của đối tác alias. Trả "" nếu không có từ nào.
func PartnerMatchSQL(w *Where, alias string, tokens []string) string {
	if len(tokens) == 0 {
		return ""
	}
	name, code, extra := partnerKeys(alias)
	conds := make([]string, 0, len(tokens))
	for _, t := range tokens {
		p := w.Arg("%" + t + "%")
		conds = append(conds, "("+name+" LIKE "+p+" OR "+code+" LIKE "+p+" OR "+extra+" LIKE "+p+")")
	}
	return "(" + strings.Join(conds, " AND ") + ")"
}

// PartnerRankSQL trả biểu thức xếp hạng (số nhỏ = khớp tốt hơn) cho tìm đối tác:
// 0 trùng mã; 1 tên bắt đầu bằng cụm từ; 2 tên chứa cụm từ (đầu từ); 3 mọi từ là từ nguyên trong tên;
// 4 mã bắt đầu bằng chuỗi gõ; 5 mọi từ nằm trong tên (một phần từ); 6 còn lại (khớp qua mã/ĐT/MST).
func PartnerRankSQL(w *Where, alias string, tokens []string) string {
	if len(tokens) == 0 {
		return "0"
	}
	name, code, _ := partnerKeys(alias)
	phrase := strings.Join(tokens, " ")
	joined := strings.Join(tokens, "")
	whole := make([]string, len(tokens))
	part := make([]string, len(tokens))
	for i, t := range tokens {
		whole[i] = name + " LIKE " + w.Arg("% "+t+" %")
		part[i] = name + " LIKE " + w.Arg("%"+t+"%")
	}
	return `(CASE WHEN ` + code + ` = ` + w.Arg(joined) + ` THEN 0
		WHEN ` + name + ` LIKE ` + w.Arg(" "+phrase+"%") + ` THEN 1
		WHEN ` + name + ` LIKE ` + w.Arg("% "+phrase+"%") + ` THEN 2
		WHEN ` + strings.Join(whole, " AND ") + ` THEN 3
		WHEN ` + code + ` LIKE ` + w.Arg(joined+"%") + ` THEN 4
		WHEN ` + strings.Join(part, " AND ") + ` THEN 5
		ELSE 6 END)`
}
