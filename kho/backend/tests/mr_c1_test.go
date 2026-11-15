package tests

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"kho/internal/docs"
)

var mrRoleDefaults = map[string][]string{
	"ketoan":  {"sale.write", "purchase.write", "stock.write", "cash.write", "catalog.write", "posted.edit", "cost.view", "debt.view", "cash.view", "report.view"},
	"banhang": {"sale.write", "cash.write", "debt.view", "report.view"},
	"muahang": {"purchase.write", "stock.write", "cash.write", "cost.view", "debt.view", "report.view"},
	"thukho":  {"stock.write"},
}

func hasAll(have []string, need []string) bool {
	m := map[string]bool{}
	for _, p := range have {
		m[p] = true
	}
	for _, p := range need {
		if !m[p] {
			return false
		}
	}
	return true
}

// routes trả các mẫu đường dẫn đã đăng ký theo phương thức (bỏ "/" cuối).
func routes(t *testing.T, e *Env, want func(method string) bool) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	err := chi.Walk(e.Srv.Handler().(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if want(method) && strings.HasPrefix(route, "/api/") {
			out[method+" "+strings.TrimSuffix(route, "/")] = true
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

type mrFixture struct {
	cus, sup, prod int64
	drafts, posted map[string]*docs.Document
	voucher        int64
}

func mrSeed(e *Env, sfx string) mrFixture {
	f := mrFixture{drafts: map[string]*docs.Document{}, posted: map[string]*docs.Document{}}
	f.cus = e.Partner("KH"+sfx, "Khách", true, false)
	f.sup = e.Partner("NCC"+sfx, "NCC", false, true)
	f.prod = e.Product("P"+sfx, "Hàng P", "Cái", 1000, 500, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(f.prod, "1000", nil))
	for _, typ := range []string{"sale", "sale_return", "purchase", "purchase_return", "transfer", "opening"} {
		for _, posted := range []bool{false, true} {
			var body map[string]any
			switch typ {
			case "sale", "sale_return":
				body = DocBody(typ, "2026-02-01", f.cus, e.WH["KHO1"], Line(f.prod, "1", "1000"))
			case "purchase", "purchase_return":
				body = DocBody(typ, "2026-02-01", f.sup, e.WH["KHO1"], Line(f.prod, "1", "500"))
			case "transfer":
				body = map[string]any{"doc_type": "transfer", "doc_date": "2026-02-01", "warehouse_id": e.WH["KHO1"], "to_warehouse_id": e.WH["KHO2"], "lines": []any{Line(f.prod, "1", nil)}}
			default:
				body = DocBody(typ, "2026-02-01", 0, e.WH["KHO1"], Line(f.prod, "1", "500"))
			}
			if posted {
				f.posted[typ] = e.Admin.Posted(body)
			} else {
				f.drafts[typ] = e.Admin.CreateDoc(body)
			}
		}
	}
	f.voucher = e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": f.cus, "lines": []any{map[string]any{"amount": 10}}}).ID
	return f
}

type mrMut struct {
	pattern string // "METHOD /api/..." như chi đăng ký
	method  string
	path    string
	body    any
	upload  bool
	perms   []string
	admin   bool // chỉ quản trị
	skip    bool // chỉ đánh dấu đã xét (không gọi, vd. đăng xuất)
}

func mrMutations(e *Env, f mrFixture, tag string) []mrMut {
	var ms []mrMut
	for _, base := range []string{"warehouses", "product-groups", "products", "partners", "cash-accounts"} {
		body := map[string]any{"code": "X" + tag + base[:3], "name": "Mới", "unit": "Cái", "is_customer": true, "kind": "cash"}
		ms = append(ms,
			mrMut{pattern: "POST /api/" + base, method: "POST", path: "/api/" + base, body: body, perms: []string{"catalog.write"}},
			mrMut{pattern: "PUT /api/" + base + "/{id}", method: "PUT", path: "/api/" + base + "/999999", body: body, perms: []string{"catalog.write"}},
			mrMut{pattern: "DELETE /api/" + base + "/{id}", method: "DELETE", path: "/api/" + base + "/999999", perms: []string{"catalog.write"}},
		)
	}
	perm := map[string]string{"sale": "sale.write", "sale_return": "sale.write", "purchase": "purchase.write", "purchase_return": "purchase.write", "transfer": "stock.write", "opening": "stock.write"}
	for typ, p := range perm {
		d, ps := f.drafts[typ], f.posted[typ]
		partner := f.cus
		if p == "purchase.write" {
			partner = f.sup
		}
		body := DocBody(typ, "2026-02-02", partner, e.WH["KHO1"], Line(f.prod, "1", "1"))
		if typ == "transfer" || typ == "opening" {
			body = DocBody(typ, "2026-02-02", 0, e.WH["KHO1"], Line(f.prod, "1", nil))
			if typ == "transfer" {
				body["to_warehouse_id"] = e.WH["KHO2"]
			}
		}
		stale := map[string]any{"version": 999, "doc_date": "2026-02-01", "warehouse_id": e.WH["KHO1"]}
		ms = append(ms,
			mrMut{pattern: "POST /api/documents", method: "POST", path: "/api/documents", body: body, perms: []string{p}},
			mrMut{pattern: "POST /api/documents/check", method: "POST", path: "/api/documents/check", body: body, perms: []string{p}},
			mrMut{pattern: "PUT /api/documents/{id}", method: "PUT", path: fmt.Sprintf("/api/documents/%d", d.ID), body: stale, perms: []string{p}},
			mrMut{pattern: "PUT /api/documents/{id}", method: "PUT", path: fmt.Sprintf("/api/documents/%d", ps.ID), body: stale, perms: []string{p, "posted.edit"}},
			mrMut{pattern: "POST /api/documents/{id}/post", method: "POST", path: fmt.Sprintf("/api/documents/%d/post", d.ID), body: map[string]any{"version": 999}, perms: []string{p}},
			mrMut{pattern: "POST /api/documents/{id}/unpost", method: "POST", path: fmt.Sprintf("/api/documents/%d/unpost", ps.ID), body: map[string]any{"version": 999}, perms: []string{p, "posted.edit"}},
			mrMut{pattern: "DELETE /api/documents/{id}", method: "DELETE", path: fmt.Sprintf("/api/documents/%d?version=999", d.ID), perms: []string{p}},
			mrMut{pattern: "DELETE /api/documents/{id}", method: "DELETE", path: fmt.Sprintf("/api/documents/%d?version=999", ps.ID), perms: []string{p, "posted.edit"}},
		)
	}
	vbody := map[string]any{"voucher_type": "payment", "account_id": e.TM, "lines": []any{map[string]any{"amount": 1}}}
	ms = append(ms,
		mrMut{pattern: "POST /api/vouchers", method: "POST", path: "/api/vouchers", body: vbody, perms: []string{"cash.write"}},
		mrMut{pattern: "PUT /api/vouchers/{id}", method: "PUT", path: fmt.Sprintf("/api/vouchers/%d", f.voucher), body: map[string]any{"version": 999, "voucher_type": "receipt", "account_id": e.TM, "lines": []any{map[string]any{"amount": 1}}}, perms: []string{"cash.write"}},
		mrMut{pattern: "DELETE /api/vouchers/{id}", method: "DELETE", path: fmt.Sprintf("/api/vouchers/%d?version=999", f.voucher), perms: []string{"cash.write"}},
		mrMut{pattern: "POST /api/users", method: "POST", path: "/api/users", body: map[string]any{"username": "u" + tag, "password": "123456", "full_name": "U"}, admin: true},
		mrMut{pattern: "PUT /api/users/{id}", method: "PUT", path: "/api/users/1", body: map[string]any{}, admin: true},
		mrMut{pattern: "PUT /api/settings", method: "PUT", path: "/api/settings", body: map[string]any{"company_name": "X"}, admin: true},
		mrMut{pattern: "PUT /api/features", method: "PUT", path: "/api/features", body: map[string]any{"features": map[string]bool{}}, admin: true},
		mrMut{pattern: "PUT /api/role-permissions", method: "PUT", path: "/api/role-permissions", body: map[string]any{"matrix": map[string][]string{}}, admin: true},
		mrMut{pattern: "PUT /api/period-lock", method: "PUT", path: "/api/period-lock", body: map[string]any{"lock_date": nil}, admin: true},
		mrMut{pattern: "POST /api/import/{kind}", method: "POST", path: "/api/import/products?dry_run=1", upload: true, perms: []string{"catalog.write"}},
		mrMut{pattern: "POST /api/import/{kind}", method: "POST", path: "/api/import/partners?dry_run=1", upload: true, perms: []string{"catalog.write"}},
		mrMut{pattern: "POST /api/import/{kind}", method: "POST", path: "/api/import/opening_stock?dry_run=1", upload: true, perms: []string{"stock.write"}},
		mrMut{pattern: "POST /api/import/{kind}", method: "POST", path: "/api/import/opening_debt?dry_run=1", upload: true, admin: true},
		mrMut{pattern: "POST /api/import/{kind}", method: "POST", path: "/api/import/partner_prices?dry_run=1", upload: true, perms: []string{"sale.write"}},
		mrMut{pattern: "PUT /api/partners/{id}/prices", method: "PUT", path: fmt.Sprintf("/api/partners/%d/prices", f.cus),
			body: map[string]any{"items": []any{map[string]any{"product_id": f.prod, "price": 900}}}, perms: []string{"sale.write"}},
		mrMut{pattern: "DELETE /api/partners/{id}/prices/{product_id}", method: "DELETE", path: fmt.Sprintf("/api/partners/%d/prices/999999", f.cus), perms: []string{"sale.write"}},
		// Đợt M3.
		mrMut{pattern: "POST /api/documents", method: "POST", path: "/api/documents",
			body: DocBody("stocktake", "2026-02-02", 0, e.WH["KHO1"], Line(f.prod, "1", nil)), perms: []string{"stock.write"}},
		mrMut{pattern: "PUT /api/products/{id}/units", method: "PUT", path: fmt.Sprintf("/api/products/%d/units", f.prod),
			body: map[string]any{"items": []any{map[string]any{"unit": "Thùng" + tag, "factor": 12}}}, perms: []string{"catalog.write"}},
		mrMut{pattern: "POST /api/import/{kind}", method: "POST", path: "/api/import/product_units?dry_run=1", upload: true, perms: []string{"catalog.write"}},
		mrMut{pattern: "PUT /api/settings/vat", method: "PUT", path: "/api/settings/vat", body: map[string]any{"default_vat_rate": nil}, admin: true},
		mrMut{pattern: "PUT /api/print-template", method: "PUT", path: "/api/print-template", body: map[string]any{"paper_size_document": "A4", "paper_size_voucher": "A5"}, admin: true},
		mrMut{pattern: "PUT /api/print-template/logo", method: "PUT", path: "/api/print-template/logo", body: map[string]any{}, admin: true},
		mrMut{pattern: "POST /api/print-template/logo", method: "POST", path: "/api/print-template/logo", body: map[string]any{}, admin: true},
		mrMut{pattern: "DELETE /api/print-template/logo", method: "DELETE", path: "/api/print-template/logo", admin: true},
		mrMut{pattern: "POST /api/auth/change-password", method: "POST", path: "/api/auth/change-password", body: map[string]any{"old_password": "sai", "new_password": "1234567"}},
		mrMut{pattern: "POST /api/auth/login", skip: true},
		mrMut{pattern: "POST /api/auth/logout", skip: true},
	)
	return ms
}

func runMatrix(t *testing.T, e *Env, clients map[string]*Client, perms map[string][]string, ms []mrMut) {
	t.Helper()
	empty := xlsxFile(t, [][]string{{"x"}})
	roles := make([]string, 0, len(clients))
	for r := range clients {
		roles = append(roles, r)
	}
	sort.Strings(roles)
	for _, role := range roles {
		c := clients[role]
		for _, m := range ms {
			if m.skip {
				continue
			}
			allowed := !m.admin && hasAll(perms[role], m.perms)
			var r *Resp
			if m.upload {
				r = c.upload(m.path, empty)
			} else {
				r = c.Do(m.method, m.path, m.body)
			}
			if allowed && r.Status == 403 {
				t.Errorf("%s: %s %s phải được phép, nhận 403: %s", role, m.method, m.path, r.Body)
			}
			if !allowed && r.Status != 403 {
				t.Errorf("%s: %s %s phải bị 403, nhận %d: %s", role, m.method, m.path, r.Status, r.Body)
			}
			if !allowed && r.Status == 403 && !strings.Contains(string(r.Body), "quyền") {
				t.Errorf("%s: 403 phải nêu tên quyền tiếng Việt: %s", role, r.Body)
			}
			if r.Status >= 500 {
				t.Errorf("%s: %s %s ⇒ %d", role, m.method, m.path, r.Status)
			}
		}
	}
}

// C1 — mọi endpoint ghi, mỗi vai trò: 403 đúng theo ma trận quyền mặc định; quản trị đủ quyền;
// tắt tính năng ⇒ vai trò mới như kế toán. Danh sách endpoint được đối chiếu với router (không sót endpoint ghi nào).
func TestMR_C1_MaTranQuyenMoiEndpointGhi(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "permissions", "import_excel", "period_lock", "price_list", "min_stock", "credit_limit", "profit_report",
		"stocktake", "unit_conversion", "vat", "print_template")
	f := mrSeed(e, "")
	clients := map[string]*Client{}
	for role := range mrRoleDefaults {
		clients[role] = mrUser(e, "u_"+role, role)
	}
	ms := mrMutations(e, f, "a")
	covered := map[string]bool{}
	for _, m := range ms {
		covered[m.pattern] = true
	}
	for r := range routes(t, e, func(m string) bool { return m != "GET" && m != "HEAD" && m != "OPTIONS" }) {
		if !covered[r] {
			t.Errorf("endpoint ghi chưa có trong ma trận kiểm tra: %s", r)
		}
	}
	runMatrix(t, e, clients, mrRoleDefaults, ms)
	// Quản trị: không 403 ở đâu (kể cả chỉ-quản-trị).
	for _, m := range ms {
		if m.skip || m.upload {
			continue
		}
		if m.pattern == "PUT /api/users/{id}" || m.pattern == "PUT /api/features" || m.pattern == "PUT /api/role-permissions" {
			continue // không đụng dữ liệu cấu hình của chính bài test
		}
		if r := e.Admin.Do(m.method, m.path, m.body); r.Status == 403 {
			t.Errorf("admin: %s %s ⇒ 403", m.method, m.path)
		}
	}
	// Quyền đọc: báo cáo bán/mua, công nợ, sổ quỹ, phiếu thu chi.
	reads := []struct {
		path  string
		perms []string
		any   []string
	}{
		{"/api/reports/sales", []string{"report.view"}, nil},
		{"/api/reports/purchases", []string{"report.view", "cost.view"}, nil},
		{"/api/reports/debt-summary?side=receivable", []string{"debt.view"}, nil},
		{"/api/reports/debt-summary?side=payable", []string{"debt.view", "cost.view"}, nil},
		{fmt.Sprintf("/api/reports/debt-ledger?side=receivable&partner_id=%d", f.cus), []string{"debt.view"}, nil},
		{fmt.Sprintf("/api/reports/debt-ledger?side=payable&partner_id=%d", f.sup), []string{"debt.view", "cost.view"}, nil},
		{fmt.Sprintf("/api/partners/%d/balance", f.cus), []string{"debt.view"}, nil},
		{"/api/reports/cash-book", []string{"cash.view"}, nil},
		{"/api/vouchers", nil, []string{"cash.view", "cash.write"}},
		{fmt.Sprintf("/api/vouchers/%d", f.voucher), nil, []string{"cash.view", "cash.write"}},
		{"/api/reports/stock-summary", nil, nil},
		{"/api/reports/debt-aging", []string{"debt.view"}, nil},
		{"/api/reports/profit", []string{"report.view", "cost.view"}, nil},
		{"/api/reports/low-stock", nil, nil},
		{"/api/reports/vat-summary", []string{"report.view"}, nil},
		{fmt.Sprintf("/api/documents/stocktake-load?warehouse_id=%d", e.WH["KHO1"]), nil, nil},
		{fmt.Sprintf("/api/products/%d/units", f.prod), nil, nil},
		{"/api/settings/vat", nil, nil},
		{"/api/print-template", nil, nil},
		{fmt.Sprintf("/api/partners/%d/prices", f.cus), nil, nil},
		{fmt.Sprintf("/api/products/sale-price?partner_id=%d&ids=%d", f.cus, f.prod), nil, nil},
		{"/api/documents", nil, nil},
	}
	for role, c := range clients {
		for _, rd := range reads {
			allowed := hasAll(mrRoleDefaults[role], rd.perms)
			if rd.any != nil {
				allowed = false
				for _, p := range rd.any {
					if hasAll(mrRoleDefaults[role], []string{p}) {
						allowed = true
					}
				}
			}
			st := c.Do("GET", rd.path, nil).Status
			if allowed != (st != 403) {
				t.Errorf("%s GET %s: được phép=%v, nhận %d", role, rd.path, allowed, st)
			}
		}
	}
	// Quản trị sửa ma trận: cho thủ kho quyền bán ⇒ thủ kho lập phiếu bán được.
	var rp struct {
		Matrix map[string][]string `json:"matrix"`
	}
	e.Admin.OK("PUT", "/api/role-permissions", map[string]any{"matrix": map[string][]string{"thukho": {"stock.write", "sale.write"}}}, &rp)
	if !hasAll(rp.Matrix["thukho"], []string{"sale.write", "stock.write"}) || len(rp.Matrix["banhang"]) != 4 || len(rp.Matrix["admin"]) != 10 {
		t.Fatalf("ma trận sau sửa: %+v", rp.Matrix)
	}
	clients["thukho"].OK("POST", "/api/documents", DocBody("sale", "2026-02-03", f.cus, e.WH["KHO1"], Line(f.prod, "1", "1000")), nil)
	e.Admin.Expect(400, "VALIDATION", "PUT", "/api/role-permissions", map[string]any{"matrix": map[string][]string{"admin": {}}})
	e.Admin.Expect(400, "VALIDATION", "PUT", "/api/role-permissions", map[string]any{"matrix": map[string][]string{"thukho": {"bay.ba"}}})
	var me struct {
		Permissions []string `json:"permissions"`
	}
	clients["banhang"].OK("GET", "/api/auth/me", nil, &me)
	if strings.Join(me.Permissions, ",") != "sale.write,cash.write,debt.view,report.view" {
		t.Fatalf("/auth/me permissions: %v", me.Permissions)
	}

	// Tắt phân quyền ⇒ mọi vai trò như kế toán (chỉ còn các thao tác của quản trị bị chặn).
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"permissions": false}, "confirm": true}, nil)
	all := map[string][]string{}
	for role := range clients {
		all[role] = mrRoleDefaults["ketoan"]
	}
	f2 := mrSeed2(e, f)
	runMatrix(t, e, clients, all, mrMutations(e, f2, "b"))
}

// mrSeed2 tạo bộ phiếu mới (phiếu vòng trước có thể đã đổi trạng thái).
func mrSeed2(e *Env, _ mrFixture) mrFixture { return mrSeed(e, "2") }
