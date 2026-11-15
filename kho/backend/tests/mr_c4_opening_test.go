package tests

import (
	"fmt"
	"strings"
	"testing"
)

// C4 (N10) — khi đã khóa sổ, số dư đầu kỳ không có ngày (công nợ đầu kỳ đối tác, số dư đầu tài khoản tiền, nhập công
// nợ đầu kỳ từ Excel) không được thay đổi ⇒ 422 PERIOD_LOCKED, bảo quản trị bỏ khóa trước. Tạo mới với số 0 vẫn được.
func TestMR_C4_KhoaSoChanSoDuDauKy(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	var kh struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": "KH", "name": "Khách", "is_customer": true, "is_supplier": true, "opening_receivable": 1000, "opening_payable": 500}, &kh)
	var acc struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/cash-accounts", map[string]any{"code": "ACB", "name": "ACB", "kind": "bank", "opening_balance": 7000}, &acc)
	mrEnable(e, "period_lock", "import_excel")
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": "2026-01-31"}, nil)
	locked := func(method, path string, body any) {
		t.Helper()
		r := e.Admin.Expect(422, "PERIOD_LOCKED", method, path, body)
		if !strings.Contains(string(r.Body), "31/01/2026") || !strings.Contains(string(r.Body), "bỏ khóa sổ") {
			t.Fatalf("thông báo: %s", r.Body)
		}
	}
	pb := func(rec, pay int) map[string]any {
		return map[string]any{"code": "KH", "name": "Khách đổi tên", "is_customer": true, "is_supplier": true, "opening_receivable": rec, "opening_payable": pay}
	}
	locked("PUT", fmt.Sprintf("/api/partners/%d", kh.ID), pb(2000, 500))
	locked("PUT", fmt.Sprintf("/api/partners/%d", kh.ID), pb(1000, 0))
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", kh.ID), pb(1000, 500), nil) // sửa tên, giữ số dư ⇒ được
	locked("POST", "/api/partners", map[string]any{"code": "KH2", "name": "Mới", "is_customer": true, "opening_receivable": 1})
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": "KH3", "name": "Mới số 0", "is_customer": true}, nil)
	ab := func(ob int) map[string]any {
		return map[string]any{"code": "ACB", "name": "ACB đổi tên", "kind": "bank", "opening_balance": ob}
	}
	locked("PUT", fmt.Sprintf("/api/cash-accounts/%d", acc.ID), ab(8000))
	e.Admin.OK("PUT", fmt.Sprintf("/api/cash-accounts/%d", acc.ID), ab(7000), nil)
	locked("POST", "/api/cash-accounts", map[string]any{"code": "VCB", "name": "VCB", "kind": "bank", "opening_balance": 1})
	e.Admin.OK("POST", "/api/cash-accounts", map[string]any{"code": "TCB", "name": "TCB", "kind": "bank"}, nil)
	file := xlsxFile(t, [][]string{{"Mã đối tác", "Phải thu"}, {"KH", "5"}})
	for _, q := range []string{"?dry_run=1", ""} {
		if r := e.Admin.upload("/api/import/opening_debt"+q, file); r.Status != 422 || r.ErrCode() != "PERIOD_LOCKED" {
			t.Fatalf("nhập công nợ đầu kỳ khi khóa sổ: %d %s", r.Status, r.Body)
		}
	}
	eqDec(t, e.Debt("receivable", kh.ID), "1000", "số dư không đổi")
	// Bỏ khóa ⇒ sửa được; tắt tính năng khóa sổ ⇒ không chặn.
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": nil}, nil)
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", kh.ID), pb(2000, 500), nil)
	e.Admin.importOK(t, "/api/import/opening_debt", file)
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": "2026-01-31"}, nil)
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"period_lock": false}}, nil)
	e.Admin.OK("PUT", fmt.Sprintf("/api/cash-accounts/%d", acc.ID), ab(9000), nil)
}
