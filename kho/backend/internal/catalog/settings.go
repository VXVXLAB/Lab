package catalog

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"kho/internal/apperr"
	"kho/internal/db"
)

// Settings là thông tin công ty dùng cho đầu phiếu / báo cáo xuất file.
type Settings struct {
	CompanyName    string    `json:"company_name"`
	CompanyAddress string    `json:"company_address"`
	CompanyPhone   string    `json:"company_phone"`
	CompanyTaxCode string    `json:"company_tax_code"`
	UpdatedByName  *string   `json:"updated_by_name"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// SettingsInput là dữ liệu sửa thông tin công ty.
type SettingsInput struct {
	CompanyName    string `json:"company_name"`
	CompanyAddress string `json:"company_address"`
	CompanyPhone   string `json:"company_phone"`
	CompanyTaxCode string `json:"company_tax_code"`
}

// GetSettings đọc thông tin công ty.
func (s *Service) GetSettings(ctx context.Context, q db.Q) (*Settings, error) {
	var x Settings
	err := q.QueryRow(ctx, `SELECT s.company_name, s.company_address, s.company_phone, s.company_tax_code, u.full_name, s.updated_at
		FROM settings s LEFT JOIN users u ON u.id=s.updated_by WHERE s.id=1`).
		Scan(&x.CompanyName, &x.CompanyAddress, &x.CompanyPhone, &x.CompanyTaxCode, &x.UpdatedByName, &x.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &x, nil
}

// SaveSettings sửa thông tin công ty (thay toàn bộ).
func (s *Service) SaveSettings(ctx context.Context, userID int64, in SettingsInput) (*Settings, error) {
	in.CompanyName = strings.TrimSpace(in.CompanyName)
	in.CompanyAddress = strings.TrimSpace(in.CompanyAddress)
	in.CompanyPhone = strings.TrimSpace(in.CompanyPhone)
	in.CompanyTaxCode = strings.TrimSpace(in.CompanyTaxCode)
	for f, v := range map[string]string{"company_name": in.CompanyName, "company_address": in.CompanyAddress, "company_phone": in.CompanyPhone, "company_tax_code": in.CompanyTaxCode} {
		if len([]rune(v)) > 500 {
			return nil, apperr.ValidationField(f, "Nội dung quá dài (tối đa 500 ký tự)")
		}
	}
	var out *Settings
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		before, err := s.GetSettings(ctx, tx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE settings SET company_name=$1, company_address=$2, company_phone=$3, company_tax_code=$4,
			updated_by=$5, updated_at=now() WHERE id=1`, in.CompanyName, in.CompanyAddress, in.CompanyPhone, in.CompanyTaxCode, userID); err != nil {
			return err
		}
		out, err = s.GetSettings(ctx, tx)
		if err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "settings", 1, "updated", before, out)
	})
	return out, err
}

// HeaderLines trả các dòng đầu trang cho file xuất; bỏ qua mục để trống.
func (x *Settings) HeaderLines() []string {
	var out []string
	if x == nil {
		return out
	}
	if x.CompanyName != "" {
		out = append(out, x.CompanyName)
	}
	if x.CompanyAddress != "" {
		out = append(out, "Địa chỉ: "+x.CompanyAddress)
	}
	var parts []string
	if x.CompanyPhone != "" {
		parts = append(parts, "Điện thoại: "+x.CompanyPhone)
	}
	if x.CompanyTaxCode != "" {
		parts = append(parts, "MST: "+x.CompanyTaxCode)
	}
	if len(parts) > 0 {
		out = append(out, strings.Join(parts, "    "))
	}
	return out
}
