// Package auth: người dùng, đăng nhập, phiên làm việc (cookie), mật khẩu bcrypt.
package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"kho/internal/apperr"
)

// SessionTTL là thời hạn một phiên đăng nhập.
const SessionTTL = 30 * 24 * time.Hour

// User là người dùng (không bao giờ trả password_hash).
type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	FullName  string    `json:"full_name"`
	Role      string    `json:"role"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

// IsAdmin cho biết người dùng là quản trị.
func (u *User) IsAdmin() bool { return u != nil && u.Role == "admin" }

// Service xử lý người dùng & phiên.
type Service struct {
	Pool       *pgxpool.Pool
	BcryptCost int
}

const userCols = `id, username, full_name, role, active, created_at`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	if err := row.Scan(&u.ID, &u.Username, &u.FullName, &u.Role, &u.Active, &u.CreatedAt); err != nil {
		return nil, err
	}
	return &u, nil
}

// Login kiểm tra tài khoản, tạo phiên mới, trả token.
func (s *Service) Login(ctx context.Context, username, password string) (*User, string, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return nil, "", apperr.Validation("Vui lòng nhập tên đăng nhập và mật khẩu")
	}
	var hash string
	var u User
	err := s.Pool.QueryRow(ctx, `SELECT `+userCols+`, password_hash FROM users WHERE lower(username)=lower($1)`, username).
		Scan(&u.ID, &u.Username, &u.FullName, &u.Role, &u.Active, &u.CreatedAt, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", apperr.Unauthorized("Sai tên đăng nhập hoặc mật khẩu")
	}
	if err != nil {
		return nil, "", err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, "", apperr.Unauthorized("Sai tên đăng nhập hoặc mật khẩu")
	}
	if !u.Active {
		return nil, "", apperr.Unauthorized("Tài khoản đã bị khóa")
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, "", err
	}
	token := hex.EncodeToString(buf)
	if _, err := s.Pool.Exec(ctx, `INSERT INTO sessions(token,user_id,expires_at) VALUES ($1,$2,$3)`, token, u.ID, time.Now().Add(SessionTTL)); err != nil {
		return nil, "", err
	}
	_, _ = s.Pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at < now()`)
	return &u, token, nil
}

// Logout xóa phiên.
func (s *Service) Logout(ctx context.Context, token string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE token=$1`, token)
	return err
}

// UserBySession trả người dùng của phiên còn hạn.
func (s *Service) UserBySession(ctx context.Context, token string) (*User, error) {
	if token == "" {
		return nil, apperr.Unauthorized("Vui lòng đăng nhập")
	}
	u, err := scanUser(s.Pool.QueryRow(ctx, `SELECT u.id, u.username, u.full_name, u.role, u.active, u.created_at
		FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at > now()`, token))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperr.Unauthorized("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
	}
	if err != nil {
		return nil, err
	}
	if !u.Active {
		return nil, apperr.Unauthorized("Tài khoản đã bị khóa")
	}
	return u, nil
}

// UserInput là dữ liệu tạo/sửa người dùng.
type UserInput struct {
	Username string  `json:"username"`
	Password string  `json:"password"`
	FullName string  `json:"full_name"`
	Role     string  `json:"role"`
	Active   *bool   `json:"active"`
}

// ListUsers liệt kê người dùng.
func (s *Service) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.Pool.Query(ctx, `SELECT `+userCols+` FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (User, error) {
		u, err := scanUser(r)
		if err != nil {
			return User{}, err
		}
		return *u, nil
	})
}

func (s *Service) hash(pw string) (string, error) {
	cost := s.BcryptCost
	if cost == 0 {
		cost = bcrypt.DefaultCost
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), cost)
	return string(h), err
}

func validRole(r string) bool { return r == "admin" || r == "ketoan" }

// CreateUser tạo người dùng.
func (s *Service) CreateUser(ctx context.Context, in UserInput) (*User, error) {
	in.Username = strings.TrimSpace(in.Username)
	in.FullName = strings.TrimSpace(in.FullName)
	if in.Username == "" {
		return nil, apperr.ValidationField("username", "Vui lòng nhập tên đăng nhập")
	}
	if len(in.Password) < 6 {
		return nil, apperr.ValidationField("password", "Mật khẩu phải có ít nhất 6 ký tự")
	}
	if in.FullName == "" {
		return nil, apperr.ValidationField("full_name", "Vui lòng nhập họ tên")
	}
	if in.Role == "" {
		in.Role = "ketoan"
	}
	if !validRole(in.Role) {
		return nil, apperr.ValidationField("role", "Vai trò phải là admin hoặc ketoan")
	}
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	h, err := s.hash(in.Password)
	if err != nil {
		return nil, err
	}
	u, err := scanUser(s.Pool.QueryRow(ctx, `INSERT INTO users(username,password_hash,full_name,role,active) VALUES ($1,$2,$3,$4,$5) RETURNING `+userCols,
		in.Username, h, in.FullName, in.Role, active))
	if err != nil {
		if ae := apperr.From(err); ae.Code == apperr.CodeValidation {
			return nil, apperr.ValidationField("username", "Tên đăng nhập đã tồn tại")
		}
		return nil, err
	}
	return u, nil
}

// UpdateUser sửa người dùng (mật khẩu để trống = giữ nguyên).
func (s *Service) UpdateUser(ctx context.Context, id int64, in UserInput) (*User, error) {
	cur, err := scanUser(s.Pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperr.NotFound("người dùng")
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.FullName) != "" {
		cur.FullName = strings.TrimSpace(in.FullName)
	}
	if strings.TrimSpace(in.Username) != "" {
		cur.Username = strings.TrimSpace(in.Username)
	}
	if in.Role != "" {
		if !validRole(in.Role) {
			return nil, apperr.ValidationField("role", "Vai trò phải là admin hoặc ketoan")
		}
		cur.Role = in.Role
	}
	if in.Active != nil {
		cur.Active = *in.Active
	}
	if !cur.Active || cur.Role != "admin" {
		var others int
		if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE role='admin' AND active AND id<>$1`, id).Scan(&others); err != nil {
			return nil, err
		}
		if others == 0 {
			return nil, apperr.Validation("Phải còn ít nhất một quản trị đang hoạt động")
		}
	}
	if in.Password != "" {
		if len(in.Password) < 6 {
			return nil, apperr.ValidationField("password", "Mật khẩu phải có ít nhất 6 ký tự")
		}
		h, err := s.hash(in.Password)
		if err != nil {
			return nil, err
		}
		if _, err := s.Pool.Exec(ctx, `UPDATE users SET password_hash=$2 WHERE id=$1`, id, h); err != nil {
			return nil, err
		}
		if _, err := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE user_id=$1`, id); err != nil {
			return nil, err
		}
	}
	u, err := scanUser(s.Pool.QueryRow(ctx, `UPDATE users SET username=$2, full_name=$3, role=$4, active=$5 WHERE id=$1 RETURNING `+userCols,
		id, cur.Username, cur.FullName, cur.Role, cur.Active))
	if err != nil {
		if ae := apperr.From(err); ae.Code == apperr.CodeValidation {
			return nil, apperr.ValidationField("username", "Tên đăng nhập đã tồn tại")
		}
		return nil, err
	}
	if !u.Active {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM sessions WHERE user_id=$1`, id)
	}
	return u, nil
}
