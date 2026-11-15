// Package printtpl: mẫu in (bản mở rộng C12) — logo, khổ giấy, chân trang, ẩn cột, tên các ô ký.
package printtpl

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg" // giải mã kiểm tra logo
	_ "image/png"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kho/internal/apperr"
	"kho/internal/db"
)

// Template là cấu hình mẫu in.
type Template struct {
	PaperDocument  string              `json:"paper_size_document"` // A4 | A5 (phiếu hàng)
	PaperVoucher   string              `json:"paper_size_voucher"`  // A4 | A5 (phiếu thu chi)
	Footer         string              `json:"footer"`              // dòng chân trang
	HideUnitColumn bool                `json:"hide_unit_column"`
	HideCodeColumn bool                `json:"hide_code_column"`
	Signatures     map[string][]string `json:"signatures"` // theo loại phiếu / "receipt" / "payment"; thiếu ⇒ mặc định
}

// Info là mẫu in kèm trạng thái logo.
type Info struct {
	Template
	HasLogo       bool       `json:"has_logo"`
	LogoType      *string    `json:"logo_type"`
	LogoUpdatedAt *time.Time `json:"logo_updated_at"`
}

// Defaults là mẫu in mặc định (đúng bản in / file xuất của bản chuẩn).
func Defaults() Template {
	return Template{PaperDocument: "A4", PaperVoucher: "A5", Signatures: map[string][]string{}}
}

// SignatureKeys là các khóa hợp lệ của Signatures.
var SignatureKeys = []string{"purchase", "sale", "sale_return", "purchase_return", "transfer", "opening", "stocktake", "receipt", "payment"}

// Load đọc mẫu in (giá trị thiếu ⇒ mặc định).
func Load(ctx context.Context, q db.Q) (*Info, error) {
	var raw []byte
	out := &Info{Template: Defaults()}
	var logoLen int
	if err := q.QueryRow(ctx, `SELECT print_template, COALESCE(length(logo), 0), logo_type, logo_updated_at FROM settings WHERE id=1`).
		Scan(&raw, &logoLen, &out.LogoType, &out.LogoUpdatedAt); err != nil {
		return nil, err
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out.Template); err != nil {
			return nil, err
		}
	}
	if out.PaperDocument == "" {
		out.PaperDocument = "A4"
	}
	if out.PaperVoucher == "" {
		out.PaperVoucher = "A5"
	}
	if out.Signatures == nil {
		out.Signatures = map[string][]string{}
	}
	out.HasLogo = logoLen > 0
	return out, nil
}

// Validate kiểm tra và chuẩn hóa mẫu in.
func Validate(t *Template) error {
	for _, p := range []*string{&t.PaperDocument, &t.PaperVoucher} {
		*p = strings.ToUpper(strings.TrimSpace(*p))
		if *p != "A4" && *p != "A5" {
			return apperr.ValidationField("paper_size_document", "Khổ giấy phải là A4 hoặc A5")
		}
	}
	t.Footer = strings.TrimSpace(t.Footer)
	if len([]rune(t.Footer)) > 300 {
		return apperr.ValidationField("footer", "Chân trang tối đa 300 ký tự")
	}
	valid := map[string]bool{}
	for _, k := range SignatureKeys {
		valid[k] = true
	}
	if t.Signatures == nil {
		t.Signatures = map[string][]string{}
	}
	for k, v := range t.Signatures {
		if !valid[k] {
			return apperr.ValidationField("signatures", "Loại phiếu không hợp lệ trong signatures: "+k)
		}
		if len(v) < 1 || len(v) > 6 {
			return apperr.ValidationField("signatures", "Mỗi loại phiếu có từ 1 đến 6 ô ký ("+k+")")
		}
		for i := range v {
			v[i] = strings.TrimSpace(v[i])
			if v[i] == "" || len([]rune(v[i])) > 60 {
				return apperr.ValidationField("signatures", "Tên ô ký không được trống, tối đa 60 ký tự ("+k+")")
			}
		}
	}
	return nil
}

// Save ghi mẫu in (quản trị), có audit.
func Save(ctx context.Context, pool *pgxpool.Pool, userID int64, t Template) (*Info, error) {
	if err := Validate(&t); err != nil {
		return nil, err
	}
	var out *Info
	err := db.InTx(ctx, pool, func(tx pgx.Tx) error {
		before, err := Load(ctx, tx)
		if err != nil {
			return err
		}
		b, _ := json.Marshal(t)
		if _, err := tx.Exec(ctx, `UPDATE settings SET print_template=$1, updated_by=$2, updated_at=now() WHERE id=1`, b, userID); err != nil {
			return err
		}
		if out, err = Load(ctx, tx); err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "print_template", 1, "updated", before.Template, out.Template)
	})
	return out, err
}

// MaxLogo là kích thước logo tối đa.
const MaxLogo = 500 * 1024

// SaveLogo kiểm tra (theo nội dung: PNG / JPEG giải mã được) và lưu logo.
func SaveLogo(ctx context.Context, pool *pgxpool.Pool, userID int64, data []byte) (*Info, error) {
	if len(data) == 0 {
		return nil, apperr.ValidationField("file", "Chưa chọn file logo")
	}
	if len(data) > MaxLogo {
		return nil, apperr.ValidationField("file", fmt.Sprintf("Logo tối đa 500 KB (file %d KB)", (len(data)+1023)/1024))
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") {
		return nil, apperr.ValidationField("file", "Logo phải là ảnh PNG hoặc JPG")
	}
	if cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4000 || cfg.Height > 4000 {
		return nil, apperr.ValidationField("file", "Kích thước ảnh logo không hợp lệ (tối đa 4000 × 4000 điểm ảnh)")
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return nil, apperr.ValidationField("file", "Ảnh logo bị hỏng, không đọc được")
	}
	ct := "image/" + format
	var out *Info
	err = db.InTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE settings SET logo=$1, logo_type=$2, logo_updated_at=now(), updated_by=$3, updated_at=now() WHERE id=1`, data, ct, userID); err != nil {
			return err
		}
		var err error
		if out, err = Load(ctx, tx); err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "print_template", 1, "logo_updated", nil, map[string]any{"logo_type": ct, "bytes": len(data), "width": cfg.Width, "height": cfg.Height})
	})
	return out, err
}

// DeleteLogo xóa logo.
func DeleteLogo(ctx context.Context, pool *pgxpool.Pool, userID int64) error {
	return db.InTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE settings SET logo=NULL, logo_type=NULL, logo_updated_at=NULL WHERE id=1`); err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "print_template", 1, "logo_deleted", nil, nil)
	})
}

// Logo trả nội dung logo (nil nếu chưa có).
func Logo(ctx context.Context, q db.Q) ([]byte, string, error) {
	var b []byte
	var ct *string
	if err := q.QueryRow(ctx, `SELECT logo, logo_type FROM settings WHERE id=1`).Scan(&b, &ct); err != nil {
		return nil, "", err
	}
	if len(b) == 0 || ct == nil {
		return nil, "", apperr.New(http.StatusNotFound, apperr.CodeNotFound, "Chưa có logo", nil)
	}
	return b, *ct, nil
}
