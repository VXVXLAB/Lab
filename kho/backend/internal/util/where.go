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
