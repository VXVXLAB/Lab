// Lệnh khoserver: máy chủ phần mềm quản lý kho / bán hàng / công nợ / thu chi.
//
// Biến môi trường:
//
//	DATABASE_URL   (mặc định postgres://kho:kho@127.0.0.1:5432/kho_dev)
//	LISTEN_ADDR    (mặc định :8080)
//	ADMIN_PASSWORD (mật khẩu admin khi seed lần đầu, mặc định admin123)
//	STATIC_DIR     (thư mục giao diện đã build, mặc định ../frontend/dist)
//	COOKIE_SECURE  (true nếu chạy sau HTTPS)
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"kho/internal/db"
	"kho/internal/httpapi"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dbURL := env("DATABASE_URL", "postgres://kho:kho@127.0.0.1:5432/kho_dev")
	addr := env("LISTEN_ADDR", ":8080")
	static := env("STATIC_DIR", "../frontend/dist")

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

	srv := httpapi.New(httpapi.Config{Pool: pool, StaticDir: static, SecureCookie: env("COOKIE_SECURE", "") == "true"})
	hs := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		IdleTimeout:       120 * time.Second,
		// Không đặt WriteTimeout vì kết nối SSE /api/events giữ lâu.
	}
	go func() {
		<-ctx.Done()
		sh, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = hs.Shutdown(sh)
	}()
	httpapi.LogStartup(addr, static)
	if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("Lỗi máy chủ: %v", err)
	}
}
