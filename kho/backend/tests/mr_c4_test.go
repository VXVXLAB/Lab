package tests

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"kho/internal/docs"
)

func expectLocked(t *testing.T, c *Client, method, path string, body any) {
	t.Helper()
	r := c.Expect(422, "PERIOD_LOCKED", method, path, body)
	if !strings.Contains(string(r.Body), "31/01/2026") || !strings.Contains(string(r.Body), "khóa sổ") {
		t.Fatalf("thông báo khóa sổ: %s", r.Body)
	}
}

// C4 — khóa sổ: không tạo / sửa / ghi sổ / bỏ ghi sổ / xóa chứng từ và phiếu thu chi có ngày ≤ ngày khóa; không dời ngày
// vào/ra kỳ khóa; phiếu tạm trong kỳ khóa sửa/xóa được nhưng không ghi sổ được; nhập tồn đầu kỳ vào kỳ khóa bị chặn.
func TestMR_C4_KhoaSo(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "100", nil))
	janPosted := e.Admin.Posted(DocBody("sale", "2026-01-15", cus, e.WH["KHO1"], Line(p, "1", "100")))
	janDraft := e.Admin.CreateDoc(DocBody("sale", "2026-01-20", cus, e.WH["KHO1"], Line(p, "1", "100")))
	janDraft2 := e.Admin.CreateDoc(DocBody("sale", "2026-01-21", cus, e.WH["KHO1"], Line(p, "1", "100")))
	febPosted := e.Admin.Posted(DocBody("sale", "2026-02-10", cus, e.WH["KHO1"], Line(p, "1", "100")))
	febDraft := e.Admin.CreateDoc(DocBody("sale", "2026-02-11", cus, e.WH["KHO1"], Line(p, "1", "100")))
	janV := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "voucher_date": "2026-01-10", "account_id": e.TM, "partner_id": cus, "lines": []any{map[string]any{"amount": 10}}})
	febV := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "voucher_date": "2026-02-10", "account_id": e.TM, "partner_id": cus, "lines": []any{map[string]any{"amount": 10}}})

	// Đặt ngày khóa khi tính năng tắt ⇒ 404; bật lên.
	e.Admin.Expect(404, "FEATURE_OFF", "PUT", "/api/period-lock", map[string]any{"lock_date": "2026-01-31"})
	mrEnable(e, "period_lock", "permissions", "import_excel")
	kt := e.NewUser("kt", "Kế toán")
	kt.Expect(403, "FORBIDDEN", "PUT", "/api/period-lock", map[string]any{"lock_date": "2026-01-31"})
	e.Admin.Expect(400, "VALIDATION", "PUT", "/api/period-lock", map[string]any{"lock_date": "2099-01-01"})
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": "2026-01-31", "reason": "Chốt sổ tháng 1"}, nil)
	var pl struct {
		LockDate string `json:"lock_date"`
	}
	kt.OK("GET", "/api/period-lock", nil, &pl)
	if pl.LockDate != "2026-01-31" {
		t.Fatalf("ngày khóa: %+v", pl)
	}
	var reason string
	if err := e.Pool.QueryRow(context.Background(), `SELECT after->>'reason' FROM audit_log WHERE entity='period_lock' ORDER BY id DESC LIMIT 1`).Scan(&reason); err != nil || reason != "Chốt sổ tháng 1" {
		t.Fatalf("audit khóa sổ: %q %v", reason, err)
	}

	upd := func(d *docs.Document, date string) map[string]any {
		return map[string]any{"version": d.Version, "doc_date": date, "partner_id": cus, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(p, "2", "100")}}
	}
	// Chứng từ đã ghi sổ trong kỳ khóa: không sửa, không bỏ ghi sổ, không dời ra ngoài.
	expectLocked(t, kt, "PUT", fmt.Sprintf("/api/documents/%d", janPosted.ID), upd(janPosted, "2026-01-15"))
	expectLocked(t, kt, "PUT", fmt.Sprintf("/api/documents/%d", janPosted.ID), upd(janPosted, "2026-02-15"))
	expectLocked(t, kt, "POST", fmt.Sprintf("/api/documents/%d/unpost", janPosted.ID), map[string]any{"version": janPosted.Version})
	// Không tạo chứng từ trong kỳ khóa (kể cả đúng ngày khóa).
	expectLocked(t, kt, "POST", "/api/documents", DocBody("sale", "2026-01-31", cus, e.WH["KHO1"], Line(p, "1", "100")))
	kt.OK("POST", "/api/documents", DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "1", "100")), nil)
	// Chứng từ ngoài kỳ: không dời ngày vào kỳ khóa.
	expectLocked(t, kt, "PUT", fmt.Sprintf("/api/documents/%d", febPosted.ID), upd(febPosted, "2026-01-20"))
	kt.OK("PUT", fmt.Sprintf("/api/documents/%d", febPosted.ID), upd(febPosted, "2026-02-12"), nil)
	expectLocked(t, kt, "PUT", fmt.Sprintf("/api/documents/%d", febDraft.ID), upd(febDraft, "2026-01-25"))
	// Phiếu tạm trong kỳ khóa: sửa được, không ghi sổ được; dời ra ngoài kỳ rồi ghi sổ được; xóa được.
	var jd docs.Document
	kt.OK("PUT", fmt.Sprintf("/api/documents/%d", janDraft.ID), upd(janDraft, "2026-01-20"), &jd)
	expectLocked(t, kt, "POST", fmt.Sprintf("/api/documents/%d/post", jd.ID), map[string]any{"version": jd.Version})
	kt.OK("PUT", fmt.Sprintf("/api/documents/%d", jd.ID), map[string]any{"version": jd.Version, "doc_date": "2026-02-05", "partner_id": cus, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(p, "1", "100")}}, &jd)
	kt.PostDoc(&jd)
	kt.OK("DELETE", fmt.Sprintf("/api/documents/%d?version=%d", janDraft2.ID, janDraft2.Version), nil, nil)
	// Phiếu thu chi.
	vb := func(date string, version int) map[string]any {
		return map[string]any{"version": version, "voucher_type": "receipt", "voucher_date": date, "account_id": e.TM, "partner_id": cus, "lines": []any{map[string]any{"amount": 20}}}
	}
	expectLocked(t, kt, "POST", "/api/vouchers", vb("2026-01-31", 0))
	expectLocked(t, kt, "PUT", fmt.Sprintf("/api/vouchers/%d", janV.ID), vb("2026-01-10", janV.Version))
	expectLocked(t, kt, "PUT", fmt.Sprintf("/api/vouchers/%d", janV.ID), vb("2026-02-10", janV.Version))
	expectLocked(t, kt, "DELETE", fmt.Sprintf("/api/vouchers/%d", janV.ID), nil)
	expectLocked(t, kt, "PUT", fmt.Sprintf("/api/vouchers/%d", febV.ID), vb("2026-01-10", febV.Version))
	kt.OK("PUT", fmt.Sprintf("/api/vouchers/%d", febV.ID), vb("2026-02-20", febV.Version), nil)
	// Nhập tồn đầu kỳ vào kỳ khóa ⇒ chặn (cả thử lẫn nhập thật).
	file := xlsxFile(t, [][]string{{"Mã hàng", "Mã kho", "Số lượng"}, {"P", "KHO2", "#5"}})
	for _, q := range []string{"?dry_run=1&date=2026-01-15", "?date=2026-01-15"} {
		r := kt.upload("/api/import/opening_stock"+q, file)
		if r.Status != 422 || r.ErrCode() != "PERIOD_LOCKED" {
			t.Fatalf("nhập tồn đầu vào kỳ khóa: %d %s", r.Status, r.Body)
		}
	}
	if r := kt.upload("/api/import/opening_stock?dry_run=1&date=2026-02-01", file); r.Status != 200 || !strings.Contains(string(r.Body), `"errors":[]`) {
		t.Fatalf("ngoài kỳ khóa nhập được: %d %s", r.Status, r.Body)
	}
	// Số liệu không đổi: phiếu tháng 1 nguyên vẹn.
	if g := e.Admin.GetDoc(janPosted.ID); g.Version != janPosted.Version || g.Status != "posted" {
		t.Fatal("phiếu trong kỳ khóa bị thay đổi")
	}
	// Lùi ngày khóa / bỏ khóa ⇒ thao tác lại được; tắt tính năng ⇒ không áp dụng khóa.
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": "2026-01-14"}, nil)
	kt.OK("PUT", fmt.Sprintf("/api/documents/%d", janPosted.ID), upd(janPosted, "2026-01-15"), nil)
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": "2026-01-31"}, nil)
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"period_lock": false}}, nil)
	kt.OK("POST", "/api/documents", DocBody("sale", "2026-01-31", cus, e.WH["KHO1"], Line(p, "1", "100")), nil)
	kt.OK("DELETE", fmt.Sprintf("/api/vouchers/%d", janV.ID), nil, nil)
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"period_lock": true}}, nil)
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": nil}, nil)
	kt.OK("POST", "/api/documents", DocBody("sale", "2026-01-02", cus, e.WH["KHO1"], Line(p, "1", "100")), nil)
}
