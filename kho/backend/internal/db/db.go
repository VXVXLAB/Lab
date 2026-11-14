// Package db kết nối PostgreSQL, chạy migration nhúng và seed dữ liệu ban đầu.
package db

import (
	"context"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	pgxdecimal "github.com/jackc/pgx-shopspring-decimal"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"kho/internal/migrations"
)

// Q là giao diện chung của *pgxpool.Pool và pgx.Tx.
type Q interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Options cấu hình kết nối.
type Options struct {
	// SearchPath (tùy chọn) đặt search_path cho mọi kết nối — dùng trong test (schema riêng).
	SearchPath string
	MaxConns   int32
}

// Connect mở pool kết nối, đăng ký kiểu numeric ↔ decimal.Decimal.
func Connect(ctx context.Context, url string, opt Options) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL không hợp lệ: %w", err)
	}
	if opt.SearchPath != "" {
		cfg.ConnConfig.RuntimeParams["search_path"] = opt.SearchPath
	}
	if opt.MaxConns > 0 {
		cfg.MaxConns = opt.MaxConns
	}
	cfg.ConnConfig.RuntimeParams["timezone"] = "Asia/Ho_Chi_Minh"
	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		pgxdecimal.Register(conn.TypeMap())
		return nil
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("không kết nối được CSDL: %w", err)
	}
	return pool, nil
}

// InTx chạy fn trong một transaction; rollback nếu fn trả lỗi.
func InTx(ctx context.Context, pool *pgxpool.Pool, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Migrate chạy các file migration chưa chạy (theo thứ tự tên), mỗi file một transaction.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	entries, err := fs.ReadDir(migrations.FS, ".")
	if err != nil {
		return err
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		err := InTx(ctx, pool, func(tx pgx.Tx) error {
			// Khóa để nhiều tiến trình khởi động cùng lúc không chạy trùng migration.
			if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(4242001)`); err != nil {
				return err
			}
			var n int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE name=$1`, name).Scan(&n); err != nil {
				return err
			}
			if n > 0 {
				return nil
			}
			body, err := migrations.FS.ReadFile(name)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, string(body)); err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
			_, err = tx.Exec(ctx, `INSERT INTO schema_migrations(name) VALUES ($1)`, name)
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// SeedOptions cấu hình seed.
type SeedOptions struct {
	AdminPassword string
	// BcryptCost (tùy chọn) — test dùng chi phí thấp cho nhanh.
	BcryptCost int
}

// Seed tạo dữ liệu bắt buộc nếu chưa có: admin, 4 kho, mã DV, tài khoản TM/NH. Chạy nhiều lần không sao.
func Seed(ctx context.Context, pool *pgxpool.Pool, opt SeedOptions) error {
	if opt.AdminPassword == "" {
		opt.AdminPassword = "admin123"
	}
	cost := opt.BcryptCost
	if cost == 0 {
		cost = bcrypt.DefaultCost
	}
	return InTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(4242002)`); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			hash, err := bcrypt.GenerateFromPassword([]byte(opt.AdminPassword), cost)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO users(username,password_hash,full_name,role) VALUES ('admin',$1,'Quản trị','admin')`, string(hash)); err != nil {
				return err
			}
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM warehouses`).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			for i := 1; i <= 4; i++ {
				if _, err := tx.Exec(ctx, `INSERT INTO warehouses(code,name) VALUES ($1,$2)`, fmt.Sprintf("KHO%d", i), fmt.Sprintf("Kho %d", i)); err != nil {
					return err
				}
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO products(code,name,unit,is_service,search_key)
			SELECT 'DV','Dịch vụ','',TRUE,'dv dich vu'
			WHERE NOT EXISTS (SELECT 1 FROM products WHERE upper(code)='DV')`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO cash_accounts(code,name,kind)
			SELECT 'TM','Quỹ tiền mặt','cash' WHERE NOT EXISTS (SELECT 1 FROM cash_accounts WHERE upper(code)='TM')`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO cash_accounts(code,name,kind)
			SELECT 'NH','Ngân hàng','bank' WHERE NOT EXISTS (SELECT 1 FROM cash_accounts WHERE upper(code)='NH')`); err != nil {
			return err
		}
		return nil
	})
}

// NextNumber cấp số tiếp theo cho khóa key (khóa hàng counters bằng UPDATE ... RETURNING, an toàn đồng thời).
func NextNumber(ctx context.Context, tx pgx.Tx, key string) (int64, error) {
	var v int64
	err := tx.QueryRow(ctx, `INSERT INTO counters(key,value) VALUES ($1,1)
		ON CONFLICT (key) DO UPDATE SET value = counters.value + 1 RETURNING value`, key).Scan(&v)
	return v, err
}

// Audit ghi nhật ký thay đổi.
func Audit(ctx context.Context, tx pgx.Tx, userID int64, entity string, entityID int64, action string, before, after any) error {
	_, err := tx.Exec(ctx, `INSERT INTO audit_log(user_id,entity,entity_id,action,before,after) VALUES ($1,$2,$3,$4,$5,$6)`,
		nullID(userID), entity, entityID, action, before, after)
	return err
}

func nullID(id int64) any {
	if id == 0 {
		return nil
	}
	return id
}
