package tests

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"kho/internal/ext"
)

// mrEnable bật các tính năng mở rộng (rỗng ⇒ bật mọi tính năng đã có).
func mrEnable(e *Env, keys ...string) {
	e.t.Helper()
	if len(keys) == 0 {
		for k := range ext.AvailableFeatures {
			keys = append(keys, k)
		}
	}
	m := map[string]bool{}
	for _, k := range keys {
		m[k] = true
	}
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": m}, nil)
}

// mrUser tạo người dùng với vai trò và trả client đã đăng nhập (cần bật permissions cho vai trò mới).
func mrUser(e *Env, username, role string) *Client {
	e.t.Helper()
	e.Admin.OK("POST", "/api/users", map[string]any{"username": username, "password": "matkhau123", "full_name": "Người " + username, "role": role}, nil)
	return e.Login(username, "matkhau123")
}

// upload gửi file multipart lên đường dẫn.
func (c *Client) upload(path string, file []byte) *Resp {
	c.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "du_lieu.xlsx")
	_, _ = fw.Write(file)
	_ = mw.Close()
	req, _ := http.NewRequest("POST", c.base+path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatalf("upload %s: %v", path, err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return &Resp{Status: res.StatusCode, Body: b, Header: res.Header}
}

// xlsxFile tạo file xlsx từ các dòng (chuỗi bắt đầu bằng "#" ⇒ ô số với giá trị phía sau).
func xlsxFile(t *testing.T, rows [][]string) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	for r, row := range rows {
		for c, v := range row {
			if v == "" {
				continue
			}
			cell, _ := excelize.CoordinatesToCellName(c+1, r+1)
			if strings.HasPrefix(v, "#") {
				_ = f.SetCellDefault("Sheet1", cell, v[1:])
			} else {
				_ = f.SetCellStr("Sheet1", cell, v)
			}
		}
	}
	b, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func (e *Env) count(table string) int {
	e.t.Helper()
	var n int
	if err := e.Pool.QueryRow(t0ctx(), fmt.Sprintf(`SELECT count(*) FROM %s`, table)).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func t0ctx() context.Context { return context.Background() }
