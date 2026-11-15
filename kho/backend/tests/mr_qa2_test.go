package tests

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/xuri/excelize/v2"
	"golang.org/x/text/unicode/norm"
)

// Sửa lỗi sau QA hộp đen bản mở rộng M1 + M2 (qa/BAO_CAO_QA_MO_RONG.md).

// C7 (viết lại sau QA Q-01) — bình quân gia quyền liên hoàn qua API: ví dụ trong spec (lãi 20), cùng ngày nhập trước xuất
// sau dù phiếu bán ghi sổ trước, nhập lùi ngày tính lại, khách trả hàng nhập lại theo bình quân, trả NCC theo giá phiếu trả;
// ba cách nhóm cùng tổng, doanh thu = báo cáo bán hàng.
func TestMR_C7_BinhQuanLienHoan(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "profit_report")
	k := e.Partner("K", "Khách", true, false)
	sup := e.Partner("NCC", "NCC", false, true)
	get := func(from, to string) map[int64]profitRowT {
		var p profitResp
		e.Admin.OK("GET", "/api/reports/profit?group_by=document&from="+from+"&to="+to, nil, &p)
		out := map[int64]profitRowT{}
		for _, x := range p.Items {
			out[*x.DocumentID] = profitRowT{x.Revenue.String(), x.Cost.String(), x.Profit.String(), x.Estimated}
		}
		return out
	}
	// 1. Ví dụ spec: mua 100 @10, bán hết, mua 1 @100, bán 1 @120 ⇒ giá vốn 100, lãi 20.
	b := e.Product("B", "Hàng B", "Cái", 120, 10, 0)
	e.Admin.Posted(DocBody("purchase", "2026-03-01", sup, e.WH["KHO1"], Line(b, "100", "10")))
	s1 := e.Admin.Posted(DocBody("sale", "2026-03-02", k, e.WH["KHO1"], Line(b, "100", "12")))
	e.Admin.Posted(DocBody("purchase", "2026-03-03", sup, e.WH["KHO2"], Line(b, "1", "100")))
	s2 := e.Admin.Posted(DocBody("sale", "2026-03-04", k, e.WH["KHO2"], Line(b, "1", "120")))
	r := get("2026-03-01", "2026-03-31")
	if r[s1.ID] != (profitRowT{"1200", "1000", "200", false}) || r[s2.ID] != (profitRowT{"120", "100", "20", false}) {
		t.Fatalf("ví dụ spec: %+v / %+v", r[s1.ID], r[s2.ID])
	}

	// 2. Cùng ngày: phiếu bán ghi sổ TRƯỚC phiếu mua, vẫn xử lý nhập trước xuất sau: 10 @50 + 10 @80 ⇒ 65; bán 2 ⇒ 130.
	c := e.Product("C", "Hàng C", "Cái", 100, 999, 0)
	e.Opening("2026-04-01", e.WH["KHO1"], Line(c, "10", "50"))
	sc := e.Admin.Posted(DocBody("sale", "2026-04-05", k, e.WH["KHO1"], Line(c, "2", "100")))
	e.Admin.Posted(DocBody("purchase", "2026-04-05", sup, e.WH["KHO1"], Line(c, "10", "80")))
	if got := get("2026-04-01", "2026-04-30")[sc.ID]; got.cost != "130" {
		t.Fatalf("cùng ngày nhập trước xuất sau: %+v", got)
	}
	// 3. Nhập lùi ngày 03/04 (10 @20): 500 + 200 = 700 / 20; + 800 ⇒ 1.500 / 30 = 50 ⇒ bán 2 = 100.
	e.Admin.Posted(DocBody("purchase", "2026-04-03", sup, e.WH["KHO3"], Line(c, "10", "20")))
	if got := get("2026-04-01", "2026-04-30")[sc.ID]; got.cost != "100" || got.profit != "100" {
		t.Fatalf("nhập lùi ngày phải tính lại: %+v", got)
	}

	// 4. Nhiều bước có khách trả hàng và trả NCC (tính tay):
	//    mua 10 @100 (1.000); bán 4 ⇒ 400, còn 6 / 600; mua 6 @160 ⇒ 12 / 1.560 = 130; khách trả 2 ⇒ −260, 14 / 1.820;
	//    trả NCC 4 @175 (700) ⇒ 10 / 1.120 = 112; bán 5 ⇒ 560.
	dd := e.Product("D", "Hàng D", "Cái", 200, 999, 0)
	e.Admin.Posted(DocBody("purchase", "2026-05-01", sup, e.WH["KHO1"], Line(dd, "10", "100")))
	d1 := e.Admin.Posted(DocBody("sale", "2026-05-02", k, e.WH["KHO1"], Line(dd, "4", "200")))
	e.Admin.Posted(DocBody("purchase", "2026-05-03", sup, e.WH["KHO2"], Line(dd, "6", "160")))
	d2 := e.Admin.Posted(DocBody("sale_return", "2026-05-04", k, e.WH["KHO1"], Line(dd, "2", "200")))
	e.Admin.Posted(DocBody("purchase_return", "2026-05-05", sup, e.WH["KHO2"], Line(dd, "4", "175")))
	d3 := e.Admin.Posted(DocBody("sale", "2026-05-06", k, e.WH["KHO1"], Line(dd, "5", "200")))
	r = get("2026-05-01", "2026-05-31")
	if r[d1.ID].cost != "400" || r[d2.ID] != (profitRowT{"-400", "-260", "-140", false}) || r[d3.ID] != (profitRowT{"1000", "560", "440", false}) {
		t.Fatalf("nhiều bước: %+v %+v %+v", r[d1.ID], r[d2.ID], r[d3.ID])
	}
	// Kỳ chỉ gồm 06/05: giá vốn vẫn dùng chuỗi từ đầu (không bắt đầu lại từ kỳ xem).
	if got := get("2026-05-06", "2026-05-06")[d3.ID]; got.cost != "560" {
		t.Fatalf("kỳ một ngày: %+v", got)
	}

	// Ba cách nhóm cùng tổng; doanh thu = báo cáo bán hàng.
	var byDoc, byProd, byCus profitResp
	e.Admin.OK("GET", "/api/reports/profit?group_by=document&from=2026-01-01&to=2026-12-31", nil, &byDoc)
	e.Admin.OK("GET", "/api/reports/profit?group_by=product&from=2026-01-01&to=2026-12-31", nil, &byProd)
	e.Admin.OK("GET", "/api/reports/profit?group_by=customer&from=2026-01-01&to=2026-12-31", nil, &byCus)
	for _, g := range []profitResp{byProd, byCus} {
		if !g.Totals.Cost.Equal(byDoc.Totals.Cost) || !g.Totals.Revenue.Equal(byDoc.Totals.Revenue) {
			t.Fatalf("%s: tổng khác: %+v vs %+v", g.GroupBy, g.Totals, byDoc.Totals)
		}
	}
	eqDec(t, byDoc.Totals.Cost, "1900", "tổng giá vốn = 1.000 + 100 + 100 + 400 − 260 + 560")
	var sr struct {
		TotalAmount json.Number `json:"total_amount"`
	}
	e.Admin.OK("GET", "/api/reports/sales?from=2026-01-01&to=2026-12-31&include_returns=true", nil, &sr)
	eqDec(t, byDoc.Totals.Revenue, string(sr.TotalAmount), "doanh thu = báo cáo bán hàng")
}

type profitRowT struct {
	revenue, cost, profit string
	estimated             bool
}

// Sửa lỗi QA M-01…M-07, M-10, Q-04, Q-07, Q-12; thêm lịch sử khóa sổ, /api/audit, quyền trong phản hồi đăng nhập.
func TestMR_QA_SuaLoiM1M2(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e)

	// M-06: giá trị công tắc không phải boolean (kể cả null) ⇒ 400, không tắt gì.
	for _, v := range []string{`null`, `"có"`, `1`, `{}`} {
		r := e.Admin.Do("PUT", "/api/features", json.RawMessage(`{"features":{"permissions":`+v+`},"confirm":true}`))
		if r.Status != 400 || r.ErrCode() != "VALIDATION" {
			t.Fatalf("permissions=%s ⇒ %d %s", v, r.Status, r.Body)
		}
	}
	var fs struct {
		Features map[string]bool `json:"features"`
	}
	e.Admin.OK("GET", "/api/features", nil, &fs)
	if !fs.Features["permissions"] {
		t.Fatal("permissions vẫn phải bật")
	}

	// (c) Đăng nhập trả kèm permissions và features như /auth/me.
	bh := mrUser(e, "bh", "banhang")
	r := bh.Do("POST", "/api/auth/login", map[string]any{"username": "bh", "password": "matkhau123"})
	var lg struct {
		User        map[string]any  `json:"user"`
		Permissions []string        `json:"permissions"`
		Features    map[string]bool `json:"features"`
	}
	r.JSON(t, &lg)
	if r.Status != 200 || lg.User["username"] != "bh" || !strings.Contains(strings.Join(lg.Permissions, ","), "sale.write") || !lg.Features["credit_limit"] {
		t.Fatalf("login: %d %s", r.Status, r.Body)
	}

	// M-05: thiếu quyền ⇒ 403 dù JSON sai kiểu (kể cả sửa / ghi sổ / kiểm tra).
	bh.Expect(403, "FORBIDDEN", "POST", "/api/documents", json.RawMessage(`{"doc_type":"purchase","warehouse_id":"xx","lines":"x"}`))
	bh.Expect(403, "FORBIDDEN", "POST", "/api/documents/check", json.RawMessage(`{"doc_type":"purchase","warehouse_id":"xx"}`))
	sup := e.Partner("NCC", "NCC", false, true)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	pd := e.Admin.CreateDoc(DocBody("purchase", "2026-01-05", sup, e.WH["KHO1"], Line(p, "5", "40")))
	bh.Expect(403, "FORBIDDEN", "PUT", fmt.Sprintf("/api/documents/%d", pd.ID), json.RawMessage(`{"lines":"x"}`))
	bh.Expect(403, "FORBIDDEN", "POST", fmt.Sprintf("/api/documents/%d/post", pd.ID), json.RawMessage(`{"version":"x"}`))
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", json.RawMessage(`{"doc_type":"purchase","warehouse_id":"xx"}`))

	// M-01: CREDIT_WARNING không in số nợ / hạn mức trong message cho người thiếu debt.view.
	var cus struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": "KH", "name": "Khách hạn mức", "is_customer": true, "opening_receivable": 2345, "credit_limit": 1789}, &cus)
	e.Admin.Posted(DocBody("purchase", "2026-01-01", sup, e.WH["KHO1"], Line(p, "50", "40")))
	e.Admin.OK("PUT", "/api/role-permissions", map[string]any{"matrix": map[string][]string{"thukho": {"stock.write", "sale.write"}}}, nil)
	tk := mrUser(e, "tk", "thukho")
	sd := tk.CreateDoc(DocBody("sale", "2026-02-01", cus.ID, e.WH["KHO1"], Line(p, "1", "9876")))
	r = tk.Expect(409, "CREDIT_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", sd.ID), map[string]any{"version": sd.Version})
	for _, secret := range []string{"2.345", "1.789", "12.221", "10.432", "2345", "1789"} {
		if strings.Contains(string(r.Body), secret) {
			t.Fatalf("lộ số nợ %s: %s", secret, r.Body)
		}
	}
	if !strings.Contains(string(r.Body), "Khách hạn mức") {
		t.Fatalf("message vẫn nêu tên khách: %s", r.Body)
	}
	r = e.Admin.Expect(409, "CREDIT_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", sd.ID), map[string]any{"version": sd.Version})
	if !strings.Contains(string(r.Body), "2.345") {
		t.Fatalf("quản trị vẫn thấy số nợ: %s", r.Body)
	}

	// Q-12: cost_source bị che với người thiếu cost.view.
	r = bh.OK("GET", fmt.Sprintf("/api/products/price-info?ids=%d", p), nil, nil)
	if !strings.Contains(string(r.Body), `"cost_source":null`) {
		t.Fatalf("cost_source phải bị che: %s", r.Body)
	}

	// M-04: replace=true với danh sách rỗng xóa hết giá riêng.
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d/prices", cus.ID), map[string]any{"items": []any{map[string]any{"product_id": p, "price": 7}}}, nil)
	var pl struct {
		Items []any `json:"items"`
	}
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d/prices", cus.ID), map[string]any{"items": []any{}, "replace": true}, &pl)
	if len(pl.Items) != 0 {
		t.Fatalf("replace rỗng phải xóa hết: %+v", pl.Items)
	}

	// M-10: sale-price với id không tồn tại ⇒ 404 missing_ids.
	r = e.Admin.Expect(404, "NOT_FOUND", "GET", fmt.Sprintf("/api/products/sale-price?partner_id=%d&ids=%d,9999999", cus.ID, p), nil)
	if !strings.Contains(string(r.Body), `"missing_ids":[9999999]`) {
		t.Fatalf("missing_ids: %s", r.Body)
	}

	// Q-04: PUT /period-lock thiếu lock_date ⇒ 400; null ⇒ bỏ khóa.
	e.Admin.Expect(400, "VALIDATION", "PUT", "/api/period-lock", map[string]any{"reason": "không có ngày"})
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": "2024-06-30", "reason": "Chốt sổ 6/2024"}, nil)

	// M-02 / M-03 / M-07: đang khóa sổ.
	var pa struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": "DK", "name": "Có nợ đầu", "is_customer": true, "is_supplier": true}, nil)
	e.Admin.Expect(422, "PERIOD_LOCKED", "POST", "/api/partners", map[string]any{"code": "DK2", "name": "x", "is_customer": true, "opening_receivable": 5})
	// Tạo đối tác / tài khoản có số dư đầu trước khi khóa: bỏ khóa tạm.
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": nil, "reason": "mở để khai báo"}, nil)
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": "ND", "name": "Nợ đầu", "is_customer": true, "opening_receivable": 1000, "opening_payable": 500}, &pa)
	var acc, acc2, acc0 struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/cash-accounts", map[string]any{"code": "TM9", "name": "Quỹ 9", "kind": "cash", "opening_balance": 4321}, &acc)
	e.Admin.OK("POST", "/api/cash-accounts", map[string]any{"code": "TM8", "name": "Quỹ 8", "kind": "cash", "opening_balance": 999}, &acc2)
	e.Admin.OK("POST", "/api/cash-accounts", map[string]any{"code": "TM0", "name": "Quỹ 0", "kind": "cash"}, &acc0)
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": "2024-06-30", "reason": "khóa lại"}, nil)
	e.Admin.Expect(422, "PERIOD_LOCKED", "DELETE", fmt.Sprintf("/api/partners/%d", pa.ID), nil)
	e.Admin.Expect(422, "PERIOD_LOCKED", "DELETE", fmt.Sprintf("/api/cash-accounts/%d", acc.ID), nil)
	e.Admin.Expect(422, "PERIOD_LOCKED", "PUT", fmt.Sprintf("/api/cash-accounts/%d", acc2.ID), map[string]any{"code": "TM8", "name": "Quỹ 8", "kind": "bank", "opening_balance": 999})
	e.Admin.OK("PUT", fmt.Sprintf("/api/cash-accounts/%d", acc0.ID), map[string]any{"code": "TM0", "name": "Quỹ 0", "kind": "bank", "opening_balance": 0}, nil)
	e.Admin.OK("DELETE", fmt.Sprintf("/api/cash-accounts/%d", acc0.ID), nil, nil)
	for _, v := range []any{"1000.004", "1000.00", 1000.0} {
		e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", pa.ID), map[string]any{"code": "ND", "name": "Nợ đầu", "is_customer": true, "opening_receivable": v, "opening_payable": "499.996"}, nil)
	}
	e.Admin.OK("PUT", fmt.Sprintf("/api/cash-accounts/%d", acc.ID), map[string]any{"code": "TM9", "name": "Quỹ 9 mới", "kind": "cash", "opening_balance": "4321.001"}, nil)
	e.Admin.Expect(422, "PERIOD_LOCKED", "PUT", fmt.Sprintf("/api/partners/%d", pa.ID), map[string]any{"code": "ND", "name": "Nợ đầu", "is_customer": true, "opening_receivable": "1000.006", "opening_payable": 500})

	// (a) Lịch sử khóa sổ (mới nhất trước), mọi người dùng xem được.
	var lk struct {
		LockDate *string `json:"lock_date"`
		History  []struct {
			UserName    *string `json:"user_name"`
			OldLockDate *string `json:"old_lock_date"`
			NewLockDate *string `json:"new_lock_date"`
			Reason      string  `json:"reason"`
		} `json:"history"`
	}
	bh.OK("GET", "/api/period-lock", nil, &lk)
	if len(lk.History) != 3 || lk.History[0].Reason != "khóa lại" || lk.History[0].OldLockDate != nil || *lk.History[0].NewLockDate != "2024-06-30" ||
		lk.History[1].NewLockDate != nil || *lk.History[1].OldLockDate != "2024-06-30" || lk.History[2].Reason != "Chốt sổ 6/2024" || lk.History[0].UserName == nil {
		b, _ := json.Marshal(lk)
		t.Fatalf("lịch sử khóa sổ: %s", b)
	}

	// (b) /api/audit: chỉ quản trị; lọc theo entity, user, ngày; phân trang.
	bh.Expect(403, "FORBIDDEN", "GET", "/api/audit", nil)
	type auditResp struct {
		Items []struct {
			Entity   string          `json:"entity"`
			Action   string          `json:"action"`
			UserName *string         `json:"user_name"`
			After    json.RawMessage `json:"after"`
		} `json:"items"`
		Total int `json:"total"`
	}
	var au auditResp
	e.Admin.OK("GET", "/api/audit?entity=period_lock,features,role_permissions&limit=2", nil, &au)
	if au.Total < 5 || len(au.Items) != 2 || au.Items[0].Entity != "period_lock" {
		t.Fatalf("audit: %+v", au)
	}
	e.Admin.OK("GET", "/api/audit?entity=features", nil, &au)
	if au.Total < 1 || au.Items[0].Action != "updated" {
		t.Fatalf("audit features: %+v", au)
	}
	e.Admin.OK("GET", "/api/audit?entity=partner_prices&from=2000-01-01&to=2099-12-31", nil, &au)
	if au.Total != 2 {
		t.Fatalf("audit partner_prices: %+v", au)
	}
	e.Admin.OK("GET", "/api/audit?from=2099-01-01", nil, &au)
	if au.Total != 0 {
		t.Fatalf("audit lọc ngày: %+v", au)
	}
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/audit?limit=0", nil)

	// Q-07: người dùng vai trò mới đã khóa không chặn việc tắt phân quyền.
	var us struct {
		Items []struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
			FullName string `json:"full_name"`
			Role     string `json:"role"`
		} `json:"items"`
	}
	e.Admin.OK("GET", "/api/users", nil, &us)
	for _, u := range us.Items {
		if u.Role == "banhang" || u.Role == "thukho" {
			e.Admin.OK("PUT", fmt.Sprintf("/api/users/%d", u.ID), map[string]any{"username": u.Username, "full_name": u.FullName, "role": u.Role, "active": false}, nil)
		}
	}
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"permissions": false}}, nil)
}

// Q-02: người không có cost.view không sửa / bỏ ghi sổ được phiếu mua, trả NCC, tồn đầu kỳ đã ghi sổ; và không bao giờ đổi
// được đơn giá đang lưu của một dòng có sẵn (gửi null, gửi số "mù", gửi theo mã hàng) — phiếu tạm vẫn sửa được.
func TestMR_C1_NguoiBiCheGiaKhongDoiGiaDangLuu(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "permissions")
	sup := e.Partner("NCC", "NCC", false, true)
	cus := e.Partner("KH", "Khách", true, false)
	p := e.Product("P", "Hàng P", "Cái", 100, 864, 0)
	q := e.Product("Q", "Hàng Q", "Cái", 100, 555, 0)
	e.Admin.OK("PUT", "/api/role-permissions", map[string]any{"matrix": map[string][]string{"thukho": {"stock.write", "purchase.write", "posted.edit", "sale.write"}}}, nil)
	tk := mrUser(e, "tk", "thukho")
	pu := e.Admin.Posted(DocBody("purchase", "2026-03-03", sup, e.WH["KHO1"], Line(p, "3", "913")))
	pr := e.Admin.Posted(DocBody("purchase_return", "2026-03-04", sup, e.WH["KHO1"], Line(p, "1", "913")))
	op := e.Opening("2026-03-01", e.WH["KHO2"], Line(p, "2", "700"))
	for _, d := range []int64{pu.ID, pr.ID, op.ID} {
		doc := tk.GetDoc(d)
		body := map[string]any{"doc_date": "2026-03-05", "warehouse_id": doc.WarehouseID, "partner_id": doc.PartnerID, "version": doc.Version,
			"lines": []any{map[string]any{"id": doc.Lines[0].ID, "product_id": p, "qty": 1, "unit_price": nil}}}
		r := tk.Expect(403, "FORBIDDEN", "PUT", fmt.Sprintf("/api/documents/%d", d), body)
		if !strings.Contains(string(r.Body), "giá") {
			t.Fatalf("thông báo cần nói rõ lý do: %s", r.Body)
		}
		tk.Expect(403, "FORBIDDEN", "POST", fmt.Sprintf("/api/documents/%d/unpost", d), map[string]any{"version": doc.Version})
	}
	if x := e.Admin.GetDoc(pu.ID); !x.Lines[0].UnitPrice.Equal(d("913")) || !x.TotalAmount.Equal(d("2739")) || x.Status != "posted" {
		t.Fatalf("phiếu mua đã ghi sổ không đổi: %+v", x)
	}
	// Phiếu bán đã ghi sổ: người bị che giá vẫn sửa được (không phải phiếu giá vốn).
	sale := tk.Posted(DocBody("sale", "2026-03-06", cus, e.WH["KHO1"], Line(p, "1", "100")))
	tk.OK("POST", fmt.Sprintf("/api/documents/%d/unpost", sale.ID), map[string]any{"version": sale.Version}, nil)

	// Phiếu tạm: dòng có id giữ đơn giá đang lưu dù gửi null / số mù / theo mã hàng; dòng mới không giá ⇒ giá mặc định.
	dr := e.Admin.CreateDoc(DocBody("purchase", "2026-03-07", sup, e.WH["KHO1"], Line(p, "1", "655"), Line(q, "1", "444")))
	cases := []map[string]any{
		{"id": dr.Lines[0].ID, "product_id": p, "qty": 2, "unit_price": nil},
		{"id": dr.Lines[0].ID, "product_id": p, "qty": 2, "unit_price": 1},
		{"id": dr.Lines[0].ID, "product_code": "p", "qty": 2, "unit_price": 99999},
		{"id": dr.Lines[0].ID, "product_id": p, "qty": 2},
	}
	for i, l := range cases {
		cur := tk.GetDoc(dr.ID)
		tk.OK("PUT", fmt.Sprintf("/api/documents/%d", dr.ID), map[string]any{"doc_date": "2026-03-07", "warehouse_id": cur.WarehouseID, "partner_id": cur.PartnerID,
			"version": cur.Version, "lines": []any{l, map[string]any{"id": cur.Lines[1].ID, "product_id": q, "qty": 1, "unit_price": 3}}}, nil)
		x := e.Admin.GetDoc(dr.ID)
		if !x.Lines[0].UnitPrice.Equal(d("655")) || !x.Lines[0].Amount.Equal(d("1310")) || !x.Lines[1].UnitPrice.Equal(d("444")) {
			t.Fatalf("ca %d: đơn giá đang lưu bị đổi: %+v %+v", i, x.Lines[0], x.Lines[1])
		}
	}
	cur := tk.GetDoc(dr.ID)
	tk.OK("PUT", fmt.Sprintf("/api/documents/%d", dr.ID), map[string]any{"doc_date": "2026-03-07", "warehouse_id": cur.WarehouseID, "partner_id": cur.PartnerID,
		"version": cur.Version, "lines": []any{map[string]any{"id": cur.Lines[0].ID, "product_id": p, "qty": 1}, map[string]any{"product_id": q, "qty": 1}}}, nil)
	x := e.Admin.GetDoc(dr.ID)
	if len(x.Lines) != 2 || !x.Lines[0].UnitPrice.Equal(d("655")) || !x.Lines[1].UnitPrice.Equal(d("555")) {
		t.Fatalf("dòng mới ⇒ giá mặc định, dòng cũ giữ giá: %+v", x.Lines)
	}
	// Đổi mặt hàng của một dòng có id = dòng khác hẳn ⇒ giá mặc định của mã mới (giá cũ không chuyển sang mã khác).
	cur = tk.GetDoc(dr.ID)
	tk.OK("PUT", fmt.Sprintf("/api/documents/%d", dr.ID), map[string]any{"doc_date": "2026-03-07", "warehouse_id": cur.WarehouseID, "partner_id": cur.PartnerID,
		"version": cur.Version, "lines": []any{map[string]any{"id": cur.Lines[0].ID, "product_id": q, "qty": 1}}}, nil)
	if x := e.Admin.GetDoc(dr.ID); !x.Lines[0].UnitPrice.Equal(d("555")) {
		t.Fatalf("đổi mã: %+v", x.Lines[0])
	}
	// Ghi sổ phiếu tạm vẫn được (người lập), sau đó không sửa được nữa.
	cur = tk.GetDoc(dr.ID)
	posted := tk.PostDoc(cur)
	tk.Expect(403, "FORBIDDEN", "PUT", fmt.Sprintf("/api/documents/%d", dr.ID), map[string]any{"doc_date": "2026-03-07", "warehouse_id": cur.WarehouseID,
		"partner_id": cur.PartnerID, "version": posted.Version, "lines": []any{map[string]any{"id": posted.Lines[0].ID, "product_id": q, "qty": 1}}})
}

// Q-05: hai phiếu bán cùng khách ghi sổ đồng thời, mỗi phiếu một mình không vượt hạn mức nhưng cộng lại thì vượt ⇒ đúng
// một phiếu được ghi sổ, phiếu kia nhận CREDIT_WARNING (khóa advisory theo khách).
func TestMR_C8_HanMucGhiSoDongThoi(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "credit_limit")
	rounds := 8
	if testing.Short() {
		rounds = 2
	}
	for i := 0; i < rounds; i++ {
		var k struct {
			ID int64 `json:"id"`
		}
		e.Admin.OK("POST", "/api/partners", map[string]any{"code": fmt.Sprintf("DT%d", i), "name": "Khách đua", "is_customer": true, "credit_limit": 1500}, &k)
		// Dòng dịch vụ (không có khóa tồn kho mặt hàng + kho nào xếp hàng hộ hai phiếu) ⇒ chỉ khóa theo khách ngăn được.
		svc := map[string]any{"product_id": e.DV, "description": "Dịch vụ", "unit_price": 1000}
		d1 := e.Admin.CreateDoc(DocBody("sale", "2026-02-01", k.ID, e.WH["KHO1"], svc))
		d2 := e.Admin.CreateDoc(DocBody("sale", "2026-02-02", k.ID, e.WH["KHO2"], svc))
		var wg sync.WaitGroup
		res := make([]*Resp, 2)
		for j, dd := range []int64{d1.ID, d2.ID} {
			wg.Add(1)
			go func(j int, id int64, v int) {
				defer wg.Done()
				res[j] = e.Admin.Do("POST", fmt.Sprintf("/api/documents/%d/post", id), map[string]any{"version": v})
			}(j, dd, 1)
		}
		wg.Wait()
		ok, warn := 0, 0
		for _, r := range res {
			switch {
			case r.Status == 200:
				ok++
			case r.Status == 409 && r.ErrCode() == "CREDIT_WARNING":
				warn++
			default:
				t.Fatalf("vòng %d: %d %s", i, r.Status, r.Body)
			}
		}
		if ok != 1 || warn != 1 {
			t.Fatalf("vòng %d: %d phiếu ghi sổ, %d cảnh báo — hai phiếu cùng lọt hạn mức", i, ok, warn)
		}
		eqDec(t, e.Debt("receivable", k.ID), "1000", "nợ sau vòng đua")
	}
}

// C3 sau QA: ô công thức chưa có giá trị (M-08), Unicode NFD (M-09), số có dấu chấm thập phân trong ô chữ (Q-06),
// cột tiêu đề lặp (Q-11), nhập tồn đầu kỳ lặp (Q-08), người bị che giá nhập hàng hóa (Q-03).
func TestMR_C3_SuaLoiQA(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "import_excel", "permissions")
	// M-08: công thức không có giá trị lưu sẵn ⇒ lỗi dòng; có giá trị lưu sẵn ⇒ đọc giá trị.
	f := excelize.NewFile()
	for i, h := range []string{"Mã hàng", "Tên hàng", "ĐVT", "Giá bán"} {
		c, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellStr("Sheet1", c, h)
	}
	_ = f.SetCellStr("Sheet1", "A2", "CT1")
	_ = f.SetCellStr("Sheet1", "B2", "Công thức chưa tính")
	_ = f.SetCellStr("Sheet1", "C2", "Cái")
	_ = f.SetCellFormula("Sheet1", "D2", "=1000*2")
	_ = f.SetCellStr("Sheet1", "A3", "CT2")
	_ = f.SetCellStr("Sheet1", "B3", "Công thức có giá trị")
	_ = f.SetCellStr("Sheet1", "C3", "Cái")
	_ = f.SetCellFormula("Sheet1", "D3", "=1.25*2")
	_ = f.SetCellValue("Sheet1", "D3", 2.5) // excelize: SetCellValue xóa công thức ⇒ đặt lại công thức, giữ giá trị lưu sẵn
	_ = f.SetCellFormula("Sheet1", "D3", "=1.25*2")
	buf, _ := f.WriteToBuffer()
	res := e.Admin.importOK(t, "/api/import/products?dry_run=1", buf.Bytes())
	if len(res.Errors) != 1 || res.Errors[0].Row != 2 || res.Errors[0].Column != "Giá bán" || !strings.Contains(res.Errors[0].Message, "công thức chưa có giá trị") {
		t.Fatalf("công thức chưa có giá trị: %+v", res.Errors)
	}
	r := e.Admin.upload("/api/import/products", buf.Bytes())
	if r.Status != 422 || e.Admin.Do("GET", "/api/products/lookup?code=CT1", nil).Status != 404 {
		t.Fatalf("có lỗi ⇒ không nhập gì: %d %s", r.Status, r.Body)
	}

	// Q-06: ô chữ "1.25" / "2.5" không rõ nghĩa ⇒ lỗi dòng; "1.250" = 1250; ô số 2.5 vẫn đọc 2,5.
	res = e.Admin.importOK(t, "/api/import/products?dry_run=1", xlsxFile(t, [][]string{
		{"Mã hàng", "Tên hàng", "ĐVT", "Giá bán", "Giá mua"},
		{"S1", "Một", "Cái", "1.25", "#2.5"},
		{"S2", "Hai", "Cái", "2.5", "1.250"},
		{"S3", "Ba", "Cái", "1.250", "2,5"},
	}))
	if len(res.Errors) != 2 || res.Errors[0].Row != 2 || res.Errors[1].Row != 3 || !strings.Contains(res.Errors[0].Message, "dấu phẩy") {
		t.Fatalf("dấu chấm thập phân: %+v", res.Errors)
	}
	tpl := e.Admin.OK("GET", "/api/import/products/template", nil, nil).Body
	if g := strings.Join(sheetCol(t, tpl, "Hướng dẫn"), "\n"); !strings.Contains(g, "1.25") {
		t.Fatalf("Hướng dẫn phải nói về 1.25: %s", g)
	}

	// Q-11: cột tiêu đề lặp ⇒ lỗi.
	r = e.Admin.upload("/api/import/products?dry_run=1", xlsxFile(t, [][]string{{"Mã hàng", "Tên hàng", "Giá bán", "giá bán *"}, {"X", "Y", "1", "2"}}))
	if r.Status != 400 || !strings.Contains(string(r.Body), "Giá bán") {
		t.Fatalf("cột lặp: %d %s", r.Status, r.Body)
	}

	// M-09: NFC — tên NFD nhập vào được lưu NFC, tìm không dấu / có dấu (NFC và NFD) đều ra; hai mã NFC/NFD trùng nhau.
	nfd := norm.NFD.String("Công ty Hàn Việt")
	codeNFC, codeNFD := "HÀN01", norm.NFD.String("HÀN01")
	res = e.Admin.importOK(t, "/api/import/partners?dry_run=1", xlsxFile(t, [][]string{
		{"Mã đối tác", "Tên đối tác", "Khách hàng"}, {codeNFC, nfd, "x"}, {codeNFD, nfd, "x"}}))
	if len(res.Errors) != 1 || res.Errors[0].Row != 3 {
		t.Fatalf("mã NFC / NFD phải trùng: %+v", res.Errors)
	}
	e.Admin.importOK(t, "/api/import/partners", xlsxFile(t, [][]string{{"Mã đối tác", "Tên đối tác", "Khách hàng"}, {codeNFD, nfd, "x"}}))
	for _, q := range []string{"han viet", "Hàn Việt", nfd} {
		if codes := e.partnerCodes(url.QueryEscape(q)); len(codes) != 1 || codes[0] != codeNFC {
			t.Fatalf("tìm %q: %v", q, codes)
		}
	}
	// JSON: tên NFD gửi qua API được lưu NFC; mã NFD trùng mã NFC đã có ⇒ trùng.
	var pp struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	e.Admin.OK("POST", "/api/products", map[string]any{"code": norm.NFD.String("ĐÈN1"), "name": norm.NFD.String("Đèn hàn"), "unit": norm.NFD.String("Cái")}, &pp)
	if pp.Name != "Đèn hàn" {
		t.Fatalf("tên phải là NFC: %q", pp.Name)
	}
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/products", map[string]any{"code": "\u0110E\u0300N1", "name": "x", "unit": "Cái"})
	esc := `\`
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/products", json.RawMessage(`{"code":"`+esc+`u0110E`+esc+`u0300N1","name":"x","unit":"Cái"}`))
	if r := e.Admin.Do("GET", "/api/products/lookup?code="+url.QueryEscape(norm.NFD.String("ĐÈN1")), nil); r.Status != 200 {
		t.Fatalf("tra mã NFD trong query string: %d %s", r.Status, r.Body)
	}

	// Q-08: nhập tồn đầu kỳ lần hai cùng kho, cùng ngày ⇒ ghi chú cảnh báo.
	p := e.Product("TD", "Hàng tồn đầu", "Cái", 10, 5, 0)
	file := xlsxFile(t, [][]string{{"Mã hàng", "Mã kho", "Số lượng"}, {"TD", "KHO1", "#5"}})
	first := e.Admin.importOK(t, "/api/import/opening_stock?date=2026-10-25", file)
	if len(first.Notes) != 0 {
		t.Fatalf("lần đầu không có ghi chú: %v", first.Notes)
	}
	again := e.Admin.importOK(t, "/api/import/opening_stock?date=2026-10-25&dry_run=1", file)
	if len(again.Notes) != 1 || !strings.Contains(again.Notes[0], "KHO1") || !strings.Contains(again.Notes[0], "1 phiếu tồn đầu kỳ tạm") {
		t.Fatalf("nhập lại phải cảnh báo: %v", again.Notes)
	}
	_ = p

	// Q-03: người bị che giá nhập hàng hóa ⇒ cột Giá mua bị bỏ qua, có ghi chú, giá đang lưu giữ nguyên.
	e.Admin.OK("PUT", "/api/role-permissions", map[string]any{"matrix": map[string][]string{"thukho": {"stock.write", "catalog.write"}}}, nil)
	tk := mrUser(e, "tk", "thukho")
	res = tk.importOK(t, "/api/import/products", xlsxFile(t, [][]string{{"Mã hàng", "Tên hàng", "Giá mua"}, {"TD", "Hàng tồn đầu", "#777"}}))
	if len(res.Notes) == 0 || !strings.Contains(res.Notes[0], "Giá mua") {
		t.Fatalf("ghi chú bỏ qua Giá mua: %v", res.Notes)
	}
	var pr struct {
		PurchasePrice json.Number `json:"purchase_price"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products/%d", p), nil, &pr)
	if pr.PurchasePrice != "5" {
		t.Fatalf("giá mua giữ nguyên: %s", pr.PurchasePrice)
	}
}

// sheetCol đọc cột A của một trang trong file xlsx.
func sheetCol(t *testing.T, b []byte, sheet string) []string {
	t.Helper()
	f := openXLSX(t, b)
	rows, err := f.GetRows(sheet)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, r := range rows {
		if len(r) > 0 {
			out = append(out, r[0])
		}
	}
	return out
}
