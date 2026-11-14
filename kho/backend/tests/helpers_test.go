// Package tests chứa test tích hợp chạy trên PostgreSQL thật qua HTTP handler (httptest).
// Mỗi test có schema CSDL riêng (tạo mới + migrate + seed, xóa khi xong) nên độc lập và chạy song song được.
// Tên test mang mã yêu cầu: TestREQ011_...; test phủ nhiều mã ghi chú "// REQ: 011, 077".
package tests

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"kho/internal/cash"
	"kho/internal/db"
	"kho/internal/docs"
	"kho/internal/httpapi"
)

var (
	adminOnce sync.Once
	adminPool *pgxpool.Pool
	adminErr  error
)

func dbURL() string {
	if u := os.Getenv("TEST_DATABASE_URL"); u != "" {
		return u
	}
	return "postgres://kho:kho@127.0.0.1:5432/kho_test"
}

func getAdminPool(t *testing.T) *pgxpool.Pool {
	adminOnce.Do(func() {
		adminPool, adminErr = db.Connect(context.Background(), dbURL(), db.Options{MaxConns: 4})
	})
	if adminErr != nil {
		t.Fatalf("không kết nối được CSDL test %s: %v", dbURL(), adminErr)
	}
	return adminPool
}

// Env là môi trường test: schema riêng, server HTTP thật, client admin đã đăng nhập.
type Env struct {
	t      *testing.T
	URL    string
	Srv    *httpapi.Server
	Pool   *pgxpool.Pool
	Admin  *Client
	WH     map[string]int64 // KHO1..KHO4
	DV     int64
	TM, NH int64
}

// newEnv tạo môi trường test độc lập.
func newEnv(t *testing.T) *Env {
	t.Helper()
	ctx := context.Background()
	ap := getAdminPool(t)
	buf := make([]byte, 6)
	_, _ = rand.Read(buf)
	schema := "t_" + hex.EncodeToString(buf)
	if _, err := ap.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatalf("tạo schema: %v", err)
	}
	pool, err := db.Connect(ctx, dbURL(), db.Options{SearchPath: schema, MaxConns: 8})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Seed(ctx, pool, db.SeedOptions{AdminPassword: "admin123", BcryptCost: 4}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	srv := httpapi.New(httpapi.Config{Pool: pool, StaticDir: t.TempDir(), BcryptCost: 4, Quiet: true})
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(func() {
		ts.CloseClientConnections()
		ts.Close()
		pool.Close()
		if _, err := ap.Exec(context.Background(), `DROP SCHEMA `+schema+` CASCADE`); err != nil {
			t.Logf("drop schema: %v", err)
		}
	})
	e := &Env{t: t, URL: ts.URL, Srv: srv, Pool: pool, WH: map[string]int64{}}
	e.Admin = e.Login("admin", "admin123")
	var whs struct {
		Items []struct {
			ID   int64  `json:"id"`
			Code string `json:"code"`
		} `json:"items"`
	}
	e.Admin.OK("GET", "/api/warehouses", nil, &whs)
	for _, w := range whs.Items {
		e.WH[w.Code] = w.ID
	}
	if len(e.WH) != 4 {
		t.Fatalf("seed phải có 4 kho, có %d", len(e.WH))
	}
	var dv struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("GET", "/api/products/lookup?code=DV", nil, &dv)
	e.DV = dv.ID
	var accs struct {
		Items []struct {
			ID   int64  `json:"id"`
			Code string `json:"code"`
		} `json:"items"`
	}
	e.Admin.OK("GET", "/api/cash-accounts", nil, &accs)
	for _, a := range accs.Items {
		switch a.Code {
		case "TM":
			e.TM = a.ID
		case "NH":
			e.NH = a.ID
		}
	}
	return e
}

// Client là một "máy" (một phiên đăng nhập, cookie riêng).
type Client struct {
	t    *testing.T
	base string
	hc   *http.Client
	Name string
}

// Login đăng nhập và trả client có cookie phiên.
func (e *Env) Login(username, password string) *Client {
	e.t.Helper()
	jar, _ := cookiejar.New(nil)
	c := &Client{t: e.t, base: e.URL, hc: &http.Client{Jar: jar, Timeout: 30 * time.Second}}
	var out struct {
		User struct {
			FullName string `json:"full_name"`
		} `json:"user"`
	}
	c.OK("POST", "/api/auth/login", map[string]any{"username": username, "password": password}, &out)
	c.Name = out.User.FullName
	return c
}

// NewUser tạo người dùng (kế toán) và trả client đã đăng nhập.
func (e *Env) NewUser(username, fullName string) *Client {
	e.t.Helper()
	e.Admin.OK("POST", "/api/users", map[string]any{"username": username, "password": "matkhau123", "full_name": fullName, "role": "ketoan"}, nil)
	return e.Login(username, "matkhau123")
}

// Resp là phản hồi HTTP.
type Resp struct {
	Status int
	Body   []byte
	Header http.Header
}

// Do gửi request JSON.
func (c *Client) Do(method, path string, body any) *Resp {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		switch b := body.(type) {
		case string:
			rd = strings.NewReader(b)
		case []byte:
			rd = bytes.NewReader(b)
		default:
			j, err := json.Marshal(body)
			if err != nil {
				c.t.Fatalf("marshal: %v", err)
			}
			rd = bytes.NewReader(j)
		}
	}
	req, err := http.NewRequest(method, c.base+path, rd)
	if err != nil {
		c.t.Fatalf("request: %v", err)
	}
	if rd != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return &Resp{Status: res.StatusCode, Body: b, Header: res.Header}
}

// JSON giải mã body.
func (r *Resp) JSON(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		t.Fatalf("giải mã JSON: %v\n%s", err, r.Body)
	}
}

// ErrCode trả mã lỗi trong body.
func (r *Resp) ErrCode() string {
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(r.Body, &e)
	return e.Error.Code
}

// OK gửi request, yêu cầu 2xx, giải mã vào out (nếu khác nil).
func (c *Client) OK(method, path string, body any, out any) *Resp {
	c.t.Helper()
	r := c.Do(method, path, body)
	if r.Status < 200 || r.Status > 299 {
		c.t.Fatalf("%s %s: HTTP %d: %s", method, path, r.Status, r.Body)
	}
	if out != nil {
		r.JSON(c.t, out)
	}
	return r
}

// Expect gửi request và yêu cầu đúng mã HTTP + mã lỗi.
func (c *Client) Expect(status int, code string, method, path string, body any) *Resp {
	c.t.Helper()
	r := c.Do(method, path, body)
	if r.Status != status {
		c.t.Fatalf("%s %s: muốn HTTP %d, nhận %d: %s", method, path, status, r.Status, r.Body)
	}
	if code != "" && r.ErrCode() != code {
		c.t.Fatalf("%s %s: muốn mã lỗi %s, nhận %q: %s", method, path, code, r.ErrCode(), r.Body)
	}
	return r
}

// ---------- tiện ích dữ liệu ----------

func d(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func eqDec(t *testing.T, got decimal.Decimal, want string, what string) {
	t.Helper()
	if !got.Equal(d(want)) {
		t.Fatalf("%s: muốn %s, nhận %s", what, want, got.String())
	}
}

// Group tạo nhóm VTHH.
func (e *Env) Group(code, name string) int64 {
	var x struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/product-groups", map[string]any{"code": code, "name": name}, &x)
	return x.ID
}

// Product tạo mặt hàng.
func (e *Env) Product(code, name, unit string, sale, purchase int64, groupID int64) int64 {
	e.t.Helper()
	body := map[string]any{"code": code, "name": name, "unit": unit, "sale_price": sale, "purchase_price": purchase}
	if groupID != 0 {
		body["group_id"] = groupID
	}
	var x struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/products", body, &x)
	return x.ID
}

// Partner tạo đối tác.
func (e *Env) Partner(code, name string, customer, supplier bool) int64 {
	e.t.Helper()
	var x struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": code, "name": name, "is_customer": customer, "is_supplier": supplier}, &x)
	return x.ID
}

// Line tạo một dòng chứng từ.
func Line(productID int64, qty string, price any) map[string]any {
	l := map[string]any{"product_id": productID, "qty": json.Number(qty)}
	switch p := price.(type) {
	case nil:
	case string:
		l["unit_price"] = json.Number(p)
	case int:
		l["unit_price"] = p
	case int64:
		l["unit_price"] = p
	}
	return l
}

// DocBody tạo body chứng từ.
func DocBody(docType, date string, partner int64, wh int64, lines ...map[string]any) map[string]any {
	b := map[string]any{"doc_type": docType, "doc_date": date, "warehouse_id": wh, "lines": lines}
	if partner != 0 {
		b["partner_id"] = partner
	}
	return b
}

// CreateDoc tạo phiếu tạm.
func (c *Client) CreateDoc(body map[string]any) *docs.Document {
	c.t.Helper()
	var x docs.Document
	c.OK("POST", "/api/documents", body, &x)
	return &x
}

// GetDoc đọc chứng từ.
func (c *Client) GetDoc(id int64) *docs.Document {
	c.t.Helper()
	var x docs.Document
	c.OK("GET", fmt.Sprintf("/api/documents/%d", id), nil, &x)
	return &x
}

// PostDoc ghi sổ (xác nhận lỗ nếu có).
func (c *Client) PostDoc(doc *docs.Document) *docs.Document {
	c.t.Helper()
	var x docs.Document
	c.OK("POST", fmt.Sprintf("/api/documents/%d/post", doc.ID), map[string]any{"version": doc.Version, "confirm_loss": true}, &x)
	return &x
}

// Posted tạo và ghi sổ chứng từ.
func (c *Client) Posted(body map[string]any) *docs.Document {
	c.t.Helper()
	return c.PostDoc(c.CreateDoc(body))
}

// Voucher tạo phiếu thu/chi.
func (c *Client) Voucher(body map[string]any) *cash.Voucher {
	c.t.Helper()
	var v cash.Voucher
	c.OK("POST", "/api/vouchers", body, &v)
	return &v
}

// Opening nhập tồn đầu kỳ.
func (e *Env) Opening(date string, wh int64, lines ...map[string]any) *docs.Document {
	return e.Admin.Posted(DocBody("opening", date, 0, wh, lines...))
}

// TotalStock đọc tồn tổng của mặt hàng qua price-info.
func (e *Env) TotalStock(productID int64) (decimal.Decimal, map[string]decimal.Decimal) {
	e.t.Helper()
	var pi struct {
		TotalStock       decimal.Decimal `json:"total_stock"`
		StockByWarehouse []struct {
			Code string          `json:"code"`
			Qty  decimal.Decimal `json:"qty"`
		} `json:"stock_by_warehouse"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products/%d/price-info", productID), nil, &pi)
	m := map[string]decimal.Decimal{}
	for _, w := range pi.StockByWarehouse {
		m[w.Code] = w.Qty
	}
	return pi.TotalStock, m
}

// Debt đọc số dư công nợ cuối kỳ của đối tác.
func (e *Env) Debt(side string, partnerID int64) decimal.Decimal {
	e.t.Helper()
	var l struct {
		Closing decimal.Decimal `json:"closing"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/debt-ledger?side=%s&partner_id=%d", side, partnerID), nil, &l)
	return l.Closing
}
