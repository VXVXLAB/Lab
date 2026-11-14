package tests

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kho/internal/httpapi"
	"kho/internal/reports"
)

// Xác thực & phân quyền: bcrypt, cookie phiên, admin mới quản lý người dùng; thông báo tiếng Việt.
// REQ: 042
func TestREQ042_DangNhapPhanQuyen(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	anon := &Client{t: t, base: e.URL, hc: &http.Client{}}
	r := anon.Expect(401, "UNAUTHORIZED", "POST", "/api/auth/login", map[string]any{"username": "admin", "password": "sai"})
	if !strings.Contains(string(r.Body), "Sai tên đăng nhập hoặc mật khẩu") {
		t.Fatalf("thông báo tiếng Việt: %s", r.Body)
	}
	anon.Expect(401, "UNAUTHORIZED", "GET", "/api/documents", nil)
	anon.Expect(400, "VALIDATION", "POST", "/api/auth/login", "{")
	var me struct {
		User struct {
			Username string `json:"username"`
			Role     string `json:"role"`
		} `json:"user"`
	}
	e.Admin.OK("GET", "/api/auth/me", nil, &me)
	if me.User.Username != "admin" || me.User.Role != "admin" {
		t.Fatalf("me: %+v", me)
	}
	kt := e.NewUser("ketoan1", "Kế toán 1")
	kt.Expect(403, "FORBIDDEN", "GET", "/api/users", nil)
	kt.Expect(403, "FORBIDDEN", "POST", "/api/users", map[string]any{"username": "x", "password": "123456", "full_name": "X"})
	// Mật khẩu lưu bằng bcrypt, không lưu thô; response không lộ hash.
	var hash string
	if err := e.Pool.QueryRow(context.Background(), `SELECT password_hash FROM users WHERE username='ketoan1'`).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$2") || strings.Contains(hash, "matkhau123") {
		t.Fatalf("mật khẩu phải băm bcrypt: %s", hash)
	}
	users := e.Admin.OK("GET", "/api/users", nil, nil)
	if strings.Contains(string(users.Body), "password") || strings.Contains(string(users.Body), "$2") {
		t.Fatal("không được trả password_hash")
	}
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/users", map[string]any{"username": "ketoan1", "password": "123456", "full_name": "Trùng"})
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/users", map[string]any{"username": "ngan", "password": "1", "full_name": "Mật khẩu ngắn"})
	// Khóa tài khoản ⇒ phiên cũ mất hiệu lực, không đăng nhập được.
	var u struct {
		Items []struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		} `json:"items"`
	}
	e.Admin.OK("GET", "/api/users", nil, &u)
	var id int64
	for _, x := range u.Items {
		if x.Username == "ketoan1" {
			id = x.ID
		}
	}
	e.Admin.OK("PUT", fmt.Sprintf("/api/users/%d", id), map[string]any{"active": false}, nil)
	kt.Expect(401, "UNAUTHORIZED", "GET", "/api/documents", nil)
	anon.Expect(401, "UNAUTHORIZED", "POST", "/api/auth/login", map[string]any{"username": "ketoan1", "password": "matkhau123"})
	// Không được tự khóa admin cuối cùng.
	e.Admin.Expect(400, "VALIDATION", "PUT", "/api/users/1", map[string]any{"active": false})
	// Cookie HttpOnly.
	res := anon.Do("POST", "/api/auth/login", map[string]any{"username": "admin", "password": "admin123"})
	if sc := res.Header.Get("Set-Cookie"); !strings.Contains(sc, "session=") || !strings.Contains(sc, "HttpOnly") {
		t.Fatalf("cookie: %s", sc)
	}
}

// Dữ liệu nhập sai không bao giờ trả 500; luôn có mã lỗi + thông báo tiếng Việt.
// REQ: 023, 025, 030
func TestREQ023_KiemTraDuLieuNhapKhong500(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	doc := e.Admin.CreateDoc(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "1", nil)))
	cases := []struct {
		method, path string
		body         any
		status       int
	}{
		{"POST", "/api/documents", "{không phải json", 400},
		{"POST", "/api/documents", map[string]any{"doc_type": "abc", "warehouse_id": e.WH["KHO1"]}, 400},
		{"POST", "/api/documents", map[string]any{"doc_type": "sale", "partner_id": cus}, 400},
		{"POST", "/api/documents", map[string]any{"doc_type": "sale", "partner_id": cus, "warehouse_id": 99999}, 400},
		{"POST", "/api/documents", map[string]any{"doc_type": "sale", "partner_id": 99999, "warehouse_id": e.WH["KHO1"]}, 400},
		{"POST", "/api/documents", map[string]any{"doc_type": "sale", "partner_id": cus, "warehouse_id": e.WH["KHO1"], "doc_date": "31/02/2026"}, 400},
		{"POST", "/api/documents", map[string]any{"doc_type": "sale", "partner_id": cus, "warehouse_id": e.WH["KHO1"], "doc_date": 123}, 400},
		{"POST", "/api/documents", map[string]any{"doc_type": "sale", "partner_id": "abc", "warehouse_id": e.WH["KHO1"]}, 400},
		{"POST", "/api/documents", DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "0", nil)), 400},
		{"POST", "/api/documents", DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "-3", nil)), 400},
		{"POST", "/api/documents", DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "1e20", nil)), 400},
		{"POST", "/api/documents", DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "1", "99999999999999999999")), 400},
		{"POST", "/api/documents", DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(99999, "1", nil)), 400},
		{"POST", "/api/documents", DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], map[string]any{"product_code": "KHONGCO", "qty": 1}), 400},
		{"POST", "/api/documents", DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], map[string]any{"qty": 1}), 400},
		{"POST", "/api/documents", DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], map[string]any{"product_id": p, "qty": "abc"}), 400},
		{"POST", "/api/documents", DocBody("sale", "1800-01-01", cus, e.WH["KHO1"], Line(p, "1", nil)), 400},
		{"PUT", fmt.Sprintf("/api/documents/%d", doc.ID), map[string]any{"doc_date": "2026-02-01", "partner_id": cus, "warehouse_id": e.WH["KHO1"]}, 400},
		{"PUT", fmt.Sprintf("/api/documents/%d", doc.ID), map[string]any{"version": doc.Version, "doc_type": "purchase", "partner_id": cus, "warehouse_id": e.WH["KHO1"]}, 400},
		{"PUT", "/api/documents/999999", map[string]any{"version": 1}, 404},
		{"GET", "/api/documents/abc", nil, 404},
		{"GET", "/api/documents/999999", nil, 404},
		{"POST", "/api/documents/999999/post", map[string]any{"version": 1}, 404},
		{"POST", fmt.Sprintf("/api/documents/%d/post", doc.ID), map[string]any{}, 400},
		{"POST", fmt.Sprintf("/api/documents/%d/unpost", doc.ID), map[string]any{"version": doc.Version}, 400},
		{"GET", "/api/documents?status=xyz", nil, 400},
		{"GET", "/api/documents?type=xyz", nil, 400},
		{"GET", "/api/documents?from=hôm-qua", nil, 400},
		{"GET", "/api/documents?partner_id=x", nil, 400},
		{"GET", "/api/products?is_service=maybe", nil, 400},
		{"GET", "/api/partners?type=abc", nil, 400},
		{"GET", "/api/products/lookup?code=", nil, 400},
		{"GET", "/api/products/lookup?code=KHONGCO", nil, 404},
		{"GET", "/api/products/999999/price-info", nil, 404},
		{"GET", "/api/products/1/price-info?date=abc", nil, 400},
		{"POST", "/api/products", map[string]any{"code": "", "name": "x"}, 400},
		{"POST", "/api/products", map[string]any{"code": "X", "name": "x", "unit": "Cái", "sale_price": -1}, 400},
		{"POST", "/api/products", map[string]any{"code": "X", "name": "x", "unit": "Cái", "group_id": 99999}, 400},
		{"POST", "/api/partners", map[string]any{"code": "Y", "name": "y"}, 400},
		{"POST", "/api/cash-accounts", map[string]any{"code": "Z", "name": "z", "kind": "gold"}, 400},
		{"GET", "/api/reports/stock-nxt?from=2026-05-01&to=2026-04-01", nil, 400},
		{"GET", "/api/reports/cash-book?account_id=99999", nil, 404},
		{"GET", "/api/reports/stock-summary?warehouse_id=99999", nil, 400},
		{"GET", "/api/dashboard?low_stock_threshold=-1", nil, 400},
		{"GET", "/api/khong-ton-tai", nil, 404},
		{"PATCH", "/api/documents", nil, 405},
	}
	for _, c := range cases {
		r := e.Admin.Do(c.method, c.path, c.body)
		if r.Status != c.status {
			t.Errorf("%s %s: muốn %d, nhận %d: %s", c.method, c.path, c.status, r.Status, r.Body)
			continue
		}
		var er struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		r.JSON(t, &er)
		if er.Error.Code == "" || er.Error.Message == "" {
			t.Errorf("%s %s: thiếu mã/thông báo lỗi: %s", c.method, c.path, r.Body)
		}
	}
}

// Danh mục: CRUD, mã trùng, IN_USE khi xóa dữ liệu đã phát sinh, tìm không dấu, phân trang.
// REQ: 001, 020, 026
func TestREQ001_DanhMucCRUDVaInUse(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	// Kho: đổi tên, thêm kho thứ 5.
	e.Admin.OK("PUT", fmt.Sprintf("/api/warehouses/%d", e.WH["KHO1"]), map[string]any{"code": "KHO1", "name": "Kho Tân Bình"}, nil)
	var w5 struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/warehouses", map[string]any{"code": "KHO5", "name": "Kho Bình Dương"}, &w5)
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/warehouses", map[string]any{"code": "kho5", "name": "Trùng mã"})
	g := e.Group("QH", "Que hàn")
	p := e.Product("K701832", "Que hàn Kiswel K7018-3.2", "Thùng", 1090000, 950000, g)
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/products", map[string]any{"code": "k701832", "name": "Trùng", "unit": "Cái"})
	var got struct {
		Code      string  `json:"code"`
		GroupName *string `json:"group_name"`
		SalePrice float64 `json:"sale_price"`
	}
	e.Admin.OK("PUT", fmt.Sprintf("/api/products/%d", p), map[string]any{"code": "K701832", "name": "Que hàn Kiswel K7018-3.2 (20kg)", "unit": "Thùng", "sale_price": 1100000, "purchase_price": 950000, "group_id": g}, &got)
	if got.SalePrice != 1100000 || got.GroupName == nil || *got.GroupName != "Que hàn" {
		t.Fatalf("sửa mặt hàng: %+v", got)
	}
	// Tìm không dấu theo tên.
	var pl struct {
		Items []struct {
			Code string `json:"code"`
		} `json:"items"`
		Total    int `json:"total"`
		PageSize int `json:"page_size"`
	}
	e.Admin.OK("GET", "/api/products?q=que%20han%20kiswel", nil, &pl)
	if pl.Total != 1 || pl.Items[0].Code != "K701832" {
		t.Fatalf("tìm không dấu: %+v", pl)
	}
	e.Admin.OK("GET", "/api/products?is_service=true", nil, &pl)
	if pl.Total != 1 || pl.Items[0].Code != "DV" {
		t.Fatalf("lọc dịch vụ: %+v", pl)
	}
	e.Admin.OK("GET", "/api/products?page=1&page_size=1", nil, &pl)
	if pl.Total != 2 || len(pl.Items) != 1 || pl.PageSize != 1 {
		t.Fatalf("phân trang: %+v", pl)
	}
	// Đối tác lọc loại.
	kh := e.Partner("KH01", "Nguyễn Văn Đông", true, false)
	e.Partner("NCC01", "Công ty Đại Phát", false, true)
	var parts struct {
		Total int `json:"total"`
	}
	e.Admin.OK("GET", "/api/partners?type=customer", nil, &parts)
	if parts.Total != 1 {
		t.Fatalf("lọc khách hàng: %d", parts.Total)
	}
	e.Admin.OK("GET", "/api/partners?q=dong", nil, &parts)
	if parts.Total != 1 {
		t.Fatalf("tìm 'dong' không dấu (Đông): %d", parts.Total)
	}
	// Xóa khi chưa phát sinh được; đã phát sinh ⇒ IN_USE.
	tmp := e.Product("TMP", "Tạm", "Cái", 1, 1, 0)
	e.Admin.OK("DELETE", fmt.Sprintf("/api/products/%d", tmp), nil, nil)
	e.Admin.Expect(404, "NOT_FOUND", "GET", fmt.Sprintf("/api/products/%d", tmp), nil)
	e.Admin.CreateDoc(DocBody("sale", "2026-02-01", kh, w5.ID, Line(p, "1", nil)))
	e.Admin.Expect(409, "IN_USE", "DELETE", fmt.Sprintf("/api/products/%d", p), nil)
	e.Admin.Expect(409, "IN_USE", "DELETE", fmt.Sprintf("/api/partners/%d", kh), nil)
	e.Admin.Expect(409, "IN_USE", "DELETE", fmt.Sprintf("/api/warehouses/%d", w5.ID), nil)
	e.Admin.Expect(409, "IN_USE", "DELETE", fmt.Sprintf("/api/product-groups/%d", g), nil)
	e.Admin.Expect(409, "IN_USE", "DELETE", fmt.Sprintf("/api/products/%d", e.DV), nil)
	e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.NH, "lines": []any{map[string]any{"amount": 1}}})
	e.Admin.Expect(409, "IN_USE", "DELETE", fmt.Sprintf("/api/cash-accounts/%d", e.NH), nil)
	// Ngừng sử dụng thay vì xóa.
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", kh), map[string]any{"code": "KH01", "name": "Nguyễn Văn Đông", "is_customer": true, "active": false}, nil)
	e.Admin.OK("GET", "/api/partners?active=true&type=customer", nil, &parts)
	if parts.Total != 0 {
		t.Fatalf("lọc đang dùng: %d", parts.Total)
	}
	// Đối tác đã ngừng sử dụng không dùng được cho phiếu mới.
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("sale", "2026-02-01", kh, w5.ID, Line(p, "1", nil)))
	// Không đổi mã DV / tính chất dịch vụ.
	e.Admin.Expect(400, "VALIDATION", "PUT", fmt.Sprintf("/api/products/%d", e.DV), map[string]any{"code": "DV2", "name": "Dịch vụ", "is_service": true})
	// Tài khoản tiền thêm được.
	e.Admin.OK("POST", "/api/cash-accounts", map[string]any{"code": "ACB", "name": "TK ACB 123456", "kind": "bank", "opening_balance": 5000000}, nil)
	var cb reports.CashBook
	e.Admin.OK("GET", "/api/reports/cash-book?kind=bank", nil, &cb)
	eqDec(t, cb.Closing, "5000001", "tổng ngân hàng")
}

// File tĩnh SPA: phục vụ file, fallback index.html cho đường dẫn giao diện, /api không bị nuốt; thiếu thư mục không lỗi.
func TestREQ008_PhucVuGiaoDienSPA(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>SPA</html>"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("console.log(1)"), 0o644)
	srv := httpapi.New(httpapi.Config{Pool: e.Pool, StaticDir: dir, BcryptCost: 4, Quiet: true})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	get := func(path string) (int, string) {
		r, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		return r.StatusCode, string(b)
	}
	if c, b := get("/"); c != 200 || b != "<html>SPA</html>" {
		t.Fatalf("/: %d %s", c, b)
	}
	if c, b := get("/bao-cao/the-kho/5"); c != 200 || b != "<html>SPA</html>" {
		t.Fatalf("SPA fallback: %d %s", c, b)
	}
	if c, b := get("/assets/app.js"); c != 200 || b != "console.log(1)" {
		t.Fatalf("asset: %d %s", c, b)
	}
	if c, b := get("/../../etc/passwd"); c >= 500 || strings.Contains(b, "root:") {
		t.Fatalf("path traversal: %d %s", c, b)
	}
	if c, b := get("/api/khong-co"); c != 404 || !strings.Contains(b, "NOT_FOUND") {
		t.Fatalf("/api không được fallback: %d %s", c, b)
	}
	if c, b := get("/api/health"); c != 200 || !strings.Contains(b, "true") {
		t.Fatalf("health: %d %s", c, b)
	}
	srv2 := httpapi.New(httpapi.Config{Pool: e.Pool, StaticDir: filepath.Join(dir, "khong-ton-tai"), Quiet: true})
	ts2 := httptest.NewServer(srv2.Handler())
	defer ts2.Close()
	r, err := http.Get(ts2.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != 404 {
		t.Fatalf("thiếu thư mục giao diện: %d", r.StatusCode)
	}
}

// Dashboard: phiếu tạm treo, doanh thu, phải thu/phải trả, mã sắp hết.
// REQ: 040, 052, 054
func TestREQ040_Dashboard(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	sup := e.Partner("NCC", "NCC", false, true)
	a := e.Product("A", "A", "Cái", 1000, 500, 0)
	b := e.Product("B", "B", "Cái", 1000, 500, 0)
	e.Admin.Posted(DocBody("purchase", "2026-01-01", sup, e.WH["KHO1"], Line(a, "100", "500"), Line(b, "3", "500")))
	var dash reports.Dashboard
	e.Admin.OK("GET", "/api/dashboard", nil, &dash)
	e.Admin.Posted(DocBody("sale", dash.Today.String(), cus, e.WH["KHO1"], Line(a, "2", "1000")))
	e.Admin.CreateDoc(DocBody("sale", dash.Today.String(), cus, e.WH["KHO1"], Line(b, "10", "1000")))
	e.Admin.OK("GET", "/api/dashboard", nil, &dash)
	if dash.DraftCount != 1 || dash.DraftSaleCount != 1 || len(dash.RecentDrafts) != 1 || dash.ShortageInDrafts != 1 {
		t.Fatalf("dashboard phiếu tạm: %+v", dash)
	}
	eqDec(t, dash.RevenueToday, "2000", "doanh thu hôm nay")
	eqDec(t, dash.RevenueMonth, "2000", "doanh thu tháng")
	eqDec(t, dash.TotalReceivable, "2000", "phải thu")
	eqDec(t, dash.TotalPayable, "51500", "phải trả")
	if dash.LowStockCount != 1 || dash.OutOfStockCount != 0 {
		t.Fatalf("mã sắp hết: %+v", dash)
	}
}
