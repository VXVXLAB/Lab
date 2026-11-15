package tests

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"kho/internal/ext"
)

// §0 — mặc định tắt hết; API của tính năng tắt ⇒ 404 FEATURE_OFF; chỉ quản trị bật/tắt; có audit + SSE "features".
func TestMR_Features_MacDinhTatVaBatTat(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	var f featResp
	e.Admin.OK("GET", "/api/features", nil, &f)
	if len(f.Features) != 11 || len(f.Items) != 11 || f.Edition != "base" {
		t.Fatalf("11 khóa: %+v", f)
	}
	for k, v := range f.Features {
		if v {
			t.Fatalf("bản chuẩn phải tắt %s", k)
		}
	}
	for _, it := range f.Items {
		if it.Name == "" || it.Description == "" || it.Enabled || it.Available != ext.AvailableFeatures[it.Key] {
			t.Fatalf("mục tính năng: %+v", it)
		}
	}
	// Tính năng chưa làm xong không bật được.
	e.Admin.Expect(400, "VALIDATION", "PUT", "/api/features", map[string]any{"features": map[string]bool{"vat": true}})
	var me struct {
		Permissions []string        `json:"permissions"`
		Features    map[string]bool `json:"features"`
	}
	e.Admin.OK("GET", "/api/auth/me", nil, &me)
	if len(me.Permissions) != 10 {
		t.Fatalf("tắt phân quyền ⇒ đủ quyền: %v", me.Permissions)
	}
	kt := e.NewUser("kt", "Kế toán")
	kt.OK("GET", "/api/auth/me", nil, &me)
	if len(me.Permissions) != 10 {
		t.Fatalf("kế toán đủ quyền: %v", me.Permissions)
	}
	for _, p := range []string{"/api/role-permissions", "/api/period-lock", "/api/import/products/template"} {
		e.Admin.Expect(404, "FEATURE_OFF", "GET", p, nil)
	}
	e.Admin.Expect(404, "FEATURE_OFF", "PUT", "/api/period-lock", map[string]any{"lock_date": "2026-01-01"})
	e.Admin.Expect(404, "FEATURE_OFF", "POST", "/api/import/products?dry_run=1", nil)
	// Vai trò mới chỉ dùng khi bật phân quyền.
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/users", map[string]any{"username": "bh", "password": "123456", "full_name": "BH", "role": "banhang"})
	// Chỉ quản trị bật/tắt; khóa lạ ⇒ 400.
	kt.Expect(403, "FORBIDDEN", "PUT", "/api/features", map[string]any{"features": map[string]bool{"import_excel": true}})
	e.Admin.Expect(400, "VALIDATION", "PUT", "/api/features", map[string]any{"features": map[string]bool{"khong_co": true}})

	// SSE "features" tới máy khác.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", e.URL+"/api/events", nil)
	res, err := (&http.Client{Jar: kt.hc.Jar}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	got := make(chan string, 8)
	go func() {
		sc := bufio.NewScanner(res.Body)
		for sc.Scan() {
			if strings.HasPrefix(sc.Text(), "data: ") {
				got <- sc.Text()
			}
		}
	}()
	for e.Srv.Events.Count() == 0 {
		time.Sleep(5 * time.Millisecond)
	}
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"import_excel": true}}, &f)
	if !f.Features["import_excel"] || f.Features["period_lock"] {
		t.Fatalf("chỉ đổi khóa gửi lên: %+v", f.Features)
	}
	select {
	case ev := <-got:
		var x struct {
			Type string `json:"type"`
		}
		_ = json.Unmarshal([]byte(strings.TrimPrefix(ev, "data: ")), &x)
		if x.Type != "features" {
			t.Fatalf("sự kiện: %s", ev)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("không nhận sự kiện features")
	}
	kt.OK("GET", "/api/import/products/template", nil, nil)
	var n int
	if err := e.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_log WHERE entity='features'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("audit features: %d %v", n, err)
	}
}

type featResp struct {
	Edition  string          `json:"edition"`
	Features map[string]bool `json:"features"`
	Items    []struct {
		Key         string `json:"key"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Available   bool   `json:"available"`
		Enabled     bool   `json:"enabled"`
	} `json:"items"`
}

// Giá trị hiệu lực = giá trị quản trị đặt (nếu có), ngược lại theo bản cài (KHO_EDITION). Tính năng chưa làm xong luôn tắt.
// Bản mở rộng nâng cấp lên phiên bản có tính năng mới ⇒ tính năng mới BẬT; bản chuẩn ⇒ TẮT.
func TestMR_Features_MacDinhTheoBanCai(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	e := newEnv(t)
	get := func() featResp {
		var f featResp
		e.Admin.OK("GET", "/api/features", nil, &f)
		return f
	}
	if err := ext.SetEdition(ctx, e.Pool, "extended"); err != nil {
		t.Fatal(err)
	}
	f := get()
	if f.Edition != "extended" {
		t.Fatalf("edition: %+v", f)
	}
	for _, k := range ext.FeatureKeys {
		if f.Features[k] != ext.AvailableFeatures[k] {
			t.Fatalf("bản mở rộng: %s = %v (có sẵn = %v)", k, f.Features[k], ext.AvailableFeatures[k])
		}
	}
	// Quản trị tắt một tính năng ⇒ chỉ khóa đó được lưu; khởi động lại vẫn tắt.
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"period_lock": false}}, nil)
	var stored []byte
	if err := e.Pool.QueryRow(ctx, `SELECT features FROM settings`).Scan(&stored); err != nil || string(stored) != `{"period_lock": false}` {
		t.Fatalf("chỉ lưu khóa quản trị đặt: %s %v", stored, err)
	}
	if err := ext.SetEdition(ctx, e.Pool, "extended"); err != nil {
		t.Fatal(err)
	}
	if f = get(); f.Features["period_lock"] || !f.Features["permissions"] || !f.Features["import_excel"] {
		t.Fatalf("giữ lựa chọn của quản trị: %+v", f.Features)
	}
	// Mô phỏng "tính năng mới xuất hiện ở phiên bản sau": khóa không có trong giá trị đã lưu ⇒ theo bản cài.
	if _, err := e.Pool.Exec(ctx, `UPDATE settings SET features='{}'`); err != nil {
		t.Fatal(err)
	}
	if f = get(); !f.Features["period_lock"] {
		t.Fatal("bản mở rộng: khóa chưa đặt ⇒ bật")
	}
	// Bản chuẩn: khóa chưa đặt ⇒ tắt; khóa quản trị đã bật vẫn bật.
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"import_excel": true}}, nil)
	if err := ext.SetEdition(ctx, e.Pool, ""); err != nil {
		t.Fatal(err)
	}
	if f = get(); f.Edition != "base" || f.Features["permissions"] || f.Features["period_lock"] || !f.Features["import_excel"] {
		t.Fatalf("bản chuẩn: %+v", f)
	}
	// Tính năng chưa làm xong: luôn tắt, PUT ⇒ 400, kể cả khi giá trị lưu (cũ) là true.
	if _, err := e.Pool.Exec(ctx, `UPDATE settings SET features='{"vat": true}'`); err != nil {
		t.Fatal(err)
	}
	if err := ext.SetEdition(ctx, e.Pool, "extended"); err != nil {
		t.Fatal(err)
	}
	if f = get(); f.Features["vat"] || f.Features["stocktake"] {
		t.Fatalf("chưa làm xong luôn tắt: %+v", f.Features)
	}
	for _, it := range f.Items {
		if it.Key == "vat" && (it.Available || it.Enabled) {
			t.Fatalf("vat: %+v", it)
		}
	}
	e.Admin.Expect(400, "VALIDATION", "PUT", "/api/features", map[string]any{"features": map[string]bool{"stocktake": false}})
}

// Tắt phân quyền khi còn người dùng mang vai trò mới ⇒ 409 nêu tên, trừ khi confirm; sau đó họ như kế toán.
func TestMR_Features_TatPhanQuyenCanXacNhan(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "permissions")
	tk := mrUser(e, "thukho1", "thukho")
	sup := e.Partner("NCC", "NCC", false, true)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	tk.Expect(403, "FORBIDDEN", "POST", "/api/documents", DocBody("purchase", "2026-02-01", sup, e.WH["KHO1"], Line(p, "1", "50")))
	r := e.Admin.Expect(409, "IN_USE", "PUT", "/api/features", map[string]any{"features": map[string]bool{"permissions": false}})
	if !strings.Contains(string(r.Body), "thukho1") {
		t.Fatalf("phải nêu tên người dùng: %s", r.Body)
	}
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"permissions": false}, "confirm": true}, nil)
	tk.OK("POST", "/api/documents", DocBody("purchase", "2026-02-01", sup, e.WH["KHO1"], Line(p, "1", "50")), nil)
	var me struct {
		Permissions []string `json:"permissions"`
	}
	tk.OK("GET", "/api/auth/me", nil, &me)
	if len(me.Permissions) != 10 {
		t.Fatalf("tắt phân quyền ⇒ vai trò mới như kế toán: %v", me.Permissions)
	}
}
