package tests

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/text/unicode/norm"
)

// Sửa sau QA lần 2: M-11 (/api/audit to < from), M-12 (nhật ký người dùng, không ghi mật khẩu), mật khẩu / tên đăng nhập
// lưu dạng NFD trước khi máy chủ chuẩn hóa NFC vẫn đăng nhập được và được băm lại theo NFC.
func TestMR_QA_NhatKyNguoiDungVaMatKhauNFD(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/audit?from=2026-02-01&to=2026-01-31", nil)

	// M-12 (bản chuẩn: không bật tính năng nào).
	var u struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/users", map[string]any{"username": "lan", "password": "BiMat_Rat_Rieng1", "full_name": "Lan", "role": "ketoan"}, &u)
	e.Admin.OK("PUT", fmt.Sprintf("/api/users/%d", u.ID), map[string]any{"role": "admin"}, nil)
	e.Admin.OK("PUT", fmt.Sprintf("/api/users/%d", u.ID), map[string]any{"active": false}, nil)
	e.Admin.OK("PUT", fmt.Sprintf("/api/users/%d", u.ID), map[string]any{"active": true}, nil)
	e.Admin.OK("PUT", fmt.Sprintf("/api/users/%d", u.ID), map[string]any{"password": "MatKhauMoi_Bi_Mat2"}, nil)
	lan := e.Login("lan", "MatKhauMoi_Bi_Mat2")
	lan.OK("POST", "/api/auth/change-password", map[string]any{"old_password": "MatKhauMoi_Bi_Mat2", "new_password": "MatKhauThu3_Bi_Mat"}, nil)
	var au struct {
		Items []struct {
			UserName *string         `json:"user_name"`
			EntityID int64           `json:"entity_id"`
			Action   string          `json:"action"`
			Before   json.RawMessage `json:"before"`
			After    json.RawMessage `json:"after"`
		} `json:"items"`
		Total int `json:"total"`
	}
	r := e.Admin.OK("GET", fmt.Sprintf("/api/audit?entity=user&entity_id=%d", u.ID), nil, &au)
	for _, secret := range []string{"BiMat_Rat_Rieng1", "MatKhauMoi_Bi_Mat2", "MatKhauThu3_Bi_Mat", "$2a$"} {
		if strings.Contains(string(r.Body), secret) {
			t.Fatalf("nhật ký lộ mật khẩu / bản băm: %s", r.Body)
		}
	}
	var acts []string
	for i := len(au.Items) - 1; i >= 0; i-- {
		acts = append(acts, au.Items[i].Action)
	}
	if strings.Join(acts, ",") != "created,role_changed,deactivated,activated,password_reset,password_changed" {
		t.Fatalf("hành động: %v", acts)
	}
	rc := au.Items[4]
	if !strings.Contains(string(rc.Before), `"role": "ketoan"`) && !strings.Contains(string(rc.Before), `"role":"ketoan"`) ||
		!strings.Contains(strings.ReplaceAll(string(rc.After), " ", ""), `"role":"admin"`) || rc.UserName == nil || *rc.UserName == "" {
		t.Fatalf("đổi vai trò cũ → mới, người làm: %s → %s", rc.Before, rc.After)
	}
	if !strings.Contains(strings.ReplaceAll(string(au.Items[1].After), " ", ""), `"password_reset":true`) {
		t.Fatalf("đặt lại mật khẩu: %s", au.Items[1].After)
	}

	// Mật khẩu NFD băm trực tiếp (như dữ liệu trước migration 007), tên đăng nhập NFD.
	pwNFD := norm.NFD.String("Mật khẩu Việt")
	h, _ := bcrypt.GenerateFromPassword([]byte(pwNFD), 4)
	userNFD := norm.NFD.String("hòa")
	if _, err := e.Pool.Exec(t0ctx(), `INSERT INTO users(username,password_hash,full_name,role) VALUES ($1,$2,'Hòa','ketoan')`, userNFD, string(h)); err != nil {
		t.Fatal(err)
	}
	// Gửi dạng NFC (như mọi máy khách sau chuẩn hóa) ⇒ vẫn đăng nhập được; mật khẩu được băm lại theo NFC.
	e.Login("hòa", "Mật khẩu Việt")
	var nh string
	if err := e.Pool.QueryRow(t0ctx(), `SELECT password_hash FROM users WHERE full_name='Hòa'`).Scan(&nh); err != nil {
		t.Fatal(err)
	}
	if nh == string(h) || bcrypt.CompareHashAndPassword([]byte(nh), []byte(norm.NFC.String(pwNFD))) != nil {
		t.Fatal("phải băm lại mật khẩu theo dạng NFC")
	}
	// Sau khi băm lại: dạng NFD gửi lên (byte như cũ) vẫn đăng nhập được; sai mật khẩu vẫn bị từ chối.
	e.Login(userNFD, pwNFD)
	c := e.Login("admin", "admin123")
	c.Expect(401, "UNAUTHORIZED", "POST", "/api/auth/login", map[string]any{"username": "hòa", "password": "Mat khau Viet"})

	// Mật khẩu chứa ký tự tổ hợp lẫn lộn (không NFC, không NFD) gửi đúng byte như lúc đặt ⇒ khớp "byte như gửi".
	mixed := "á" + "é" // á dạng tổ hợp + é dựng sẵn
	h2, _ := bcrypt.GenerateFromPassword([]byte(mixed), 4)
	if _, err := e.Pool.Exec(t0ctx(), `INSERT INTO users(username,password_hash,full_name,role) VALUES ('tron',$1,'Trộn','ketoan')`, string(h2)); err != nil {
		t.Fatal(err)
	}
	e.Login("tron", mixed)
	e.Login("tron", norm.NFC.String(mixed))
}
