// Lệnh khoserver: máy chủ phần mềm quản lý kho / bán hàng / công nợ / thu chi.
//
// Biến môi trường:
//
//	DATABASE_URL   (mặc định postgres://kho:kho@127.0.0.1:5432/kho_dev)
//	LISTEN_ADDR    (mặc định :8080)
//	ADMIN_PASSWORD (mật khẩu admin khi seed lần đầu, mặc định admin123)
//	STATIC_DIR     (thư mục giao diện đã build, mặc định ../frontend/dist)
//	COOKIE_SECURE  (true nếu chạy sau HTTPS)
//	TLS_CERT, TLS_KEY (đường dẫn file chứng thư / khóa riêng PEM ⇒ máy chủ chạy HTTPS, cookie Secure; xem CAI_DAT.md)
//	KHO_EDITION    (extended ⇒ tính năng mở rộng mặc định bật; bỏ trống ⇒ bản chuẩn, mặc định tắt)
//	LOG_FILE       (ghi log ra file này thay vì màn hình; dùng khi chạy nền)
//
// Bản cài đặt: nếu cạnh file chạy có file kho.env (mỗi dòng KHÓA=giá trị, dòng bắt đầu bằng # là ghi chú) thì các
// giá trị trong đó được nạp trước (biến môi trường thật vẫn được ưu tiên); nếu cạnh file chạy có thư mục giao-dien
// thì đó là STATIC_DIR mặc định.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"kho/internal/db"
	"kho/internal/ext"
	"kho/internal/httpapi"
	"kho/internal/tlsconf"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// exeDir trả thư mục chứa file chạy ("" nếu không xác định được).
func exeDir() string {
	p, err := os.Executable()
	if err != nil {
		return ""
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		p = r
	}
	return filepath.Dir(p)
}

// loadEnvFile nạp KHÓA=giá trị từ file; không ghi đè biến môi trường đã có. Không có file thì bỏ qua.
func loadEnvFile(path string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	b = []byte(strings.TrimPrefix(string(b), "\ufeff")) // BOM do Notepad/PowerShell thêm
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		k = strings.TrimSpace(k)
		if !ok || k == "" {
			continue
		}
		if _, set := os.LookupEnv(k); !set {
			_ = os.Setenv(k, strings.TrimSpace(v))
		}
	}
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dir := exeDir()
	if dir != "" {
		loadEnvFile(filepath.Join(dir, "kho.env"))
	}
	if lf := os.Getenv("LOG_FILE"); lf != "" {
		if f, err := os.OpenFile(lf, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
			log.SetOutput(f)
			defer f.Close()
		}
	}
	defaultStatic := "../frontend/dist"
	if dir != "" {
		if fi, err := os.Stat(filepath.Join(dir, "giao-dien", "index.html")); err == nil && !fi.IsDir() {
			defaultStatic = filepath.Join(dir, "giao-dien")
		}
	}

	dbURL := env("DATABASE_URL", "postgres://kho:kho@127.0.0.1:5432/kho_dev")
	addr := env("LISTEN_ADDR", ":8080")
	static := env("STATIC_DIR", defaultStatic)

	// HTTPS (bản mở rộng C13): kiểm tra file chứng thư TRƯỚC khi kết nối CSDL để lỗi cấu hình hiện ngay.
	tlsCfg, tlsWarn, err := tlsconf.Load(os.Getenv("TLS_CERT"), os.Getenv("TLS_KEY"))
	if err != nil {
		log.Fatalf("Không bật được HTTPS: %v", err)
	}
	for _, w := range tlsWarn {
		log.Printf("Cảnh báo: %s", w)
	}

	pool, err := db.Connect(ctx, dbURL, db.Options{})
	if err != nil {
		log.Fatalf("Không kết nối được CSDL: %v", err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		log.Fatalf("Lỗi migration: %v", err)
	}
	if err := db.Seed(ctx, pool, db.SeedOptions{AdminPassword: env("ADMIN_PASSWORD", "admin123")}); err != nil {
		log.Fatalf("Lỗi seed dữ liệu: %v", err)
	}
	// Bản cài: KHO_EDITION=extended ⇒ tính năng quản trị chưa đặt tường minh mặc định BẬT (đọc lại mỗi lần khởi động).
	if err := ext.SetEdition(ctx, pool, os.Getenv("KHO_EDITION")); err != nil {
		log.Fatalf("Lỗi seed tính năng: %v", err)
	}

	srv := httpapi.New(httpapi.Config{Pool: pool, StaticDir: static, SecureCookie: env("COOKIE_SECURE", "") == "true" || tlsCfg != nil})
	hs := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		IdleTimeout:       120 * time.Second,
		// Không đặt WriteTimeout vì kết nối SSE /api/events giữ lâu.
		TLSConfig: tlsCfg,
	}
	go func() {
		<-ctx.Done()
		sh, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = hs.Shutdown(sh)
	}()
	httpapi.LogStartup(addr, static)
	if tlsCfg != nil {
		log.Printf("HTTPS đang bật (TLS_CERT=%s)", os.Getenv("TLS_CERT"))
		err = hs.ListenAndServeTLS("", "")
	} else {
		err = hs.ListenAndServe()
	}
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("Lỗi máy chủ: %v", err)
	}
}
