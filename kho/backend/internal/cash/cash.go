// Package cash: phiếu thu / phiếu chi tiền mặt và ngân hàng, nhiều dòng (R9).
package cash

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/catalog"
	"kho/internal/db"
	"kho/internal/docs"
	"kho/internal/util"
)

// Loại phiếu.
const (
	TypeReceipt = "receipt"
	TypePayment = "payment"
)

// Service xử lý phiếu thu chi.
type Service struct {
	Pool    *pgxpool.Pool
	Catalog *catalog.Service
}

// Line là một dòng tiền.
type Line struct {
	ID          int64           `json:"id"`
	LineNo      int             `json:"line_no"`
	Description string          `json:"description"`
	Amount      decimal.Decimal `json:"amount"`
	DocumentID  *int64          `json:"document_id"`
	DocumentNo  *string         `json:"document_no"`
}

// Voucher là phiếu thu/chi đầy đủ.
type Voucher struct {
	ID              int64           `json:"id"`
	VoucherType     string          `json:"voucher_type"`
	VoucherTypeName string          `json:"voucher_type_name"`
	VoucherNo       string          `json:"voucher_no"`
	VoucherDate     util.Date       `json:"voucher_date"`
	DebtSide        string          `json:"debt_side"`
	AccountID       int64           `json:"account_id"`
	AccountCode     string          `json:"account_code"`
	AccountName     string          `json:"account_name"`
	AccountKind     string          `json:"account_kind"`
	PartnerID       *int64          `json:"partner_id"`
	PartnerCode     *string         `json:"partner_code"`
	PartnerName     *string         `json:"partner_name"`
	PartnerAddress  *string         `json:"partner_address"`
	Note            string          `json:"note"`
	TotalAmount     decimal.Decimal `json:"total_amount"`
	Version         int             `json:"version"`
	CreatedBy       *int64          `json:"created_by"`
	CreatedByName   *string         `json:"created_by_name"`
	UpdatedBy       *int64          `json:"updated_by"`
	UpdatedByName   *string         `json:"updated_by_name"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	Lines           []Line          `json:"lines"`
}

// LineInput là dòng tiền do client gửi.
type LineInput struct {
	Description string           `json:"description"`
	Amount      *decimal.Decimal `json:"amount"`
	DocumentID  *int64           `json:"document_id"`
}

// Input là dữ liệu tạo/sửa phiếu.
type Input struct {
	VoucherType string    `json:"voucher_type"`
	VoucherDate util.Date `json:"voucher_date"`
	AccountID   int64     `json:"account_id"`
	PartnerID   *int64    `json:"partner_id"`
	// DebtSide: "receivable" | "payable" | "" (mặc định — xem DefaultDebtSide).
	DebtSide string      `json:"debt_side"`
	Note     string      `json:"note"`
	Lines    []LineInput `json:"lines"`
	Version  int         `json:"version"`
}

// DefaultDebtSide trả phía công nợ mặc định khi không chỉ định: thu ⇒ phải thu, chi ⇒ phải trả;
// riêng đối tác chỉ-là-NCC thì phiếu thu ⇒ phải trả (NCC hoàn tiền), đối tác chỉ-là-KH thì phiếu chi ⇒ phải thu
// (trả lại tiền khách).
func DefaultDebtSide(voucherType string, isCustomer, isSupplier bool, hasPartner bool) string {
	if voucherType == TypeReceipt {
		if hasPartner && isSupplier && !isCustomer {
			return "payable"
		}
		return "receivable"
	}
	if hasPartner && isCustomer && !isSupplier {
		return "receivable"
	}
	return "payable"
}

// TypeName trả tên phiếu theo loại phiếu và loại tài khoản.
func TypeName(vt, kind string) string {
	switch {
	case vt == TypeReceipt && kind == "bank":
		return "Thu tiền ngân hàng (giấy báo có)"
	case vt == TypeReceipt:
		return "Phiếu thu tiền mặt"
	case kind == "bank":
		return "Chi tiền ngân hàng (giấy báo nợ)"
	default:
		return "Phiếu chi tiền mặt"
	}
}

// Prefix trả tiền tố số phiếu: PT, PC, BC, BN.
func Prefix(vt, kind string) string {
	switch {
	case vt == TypeReceipt && kind == "bank":
		return "BC"
	case vt == TypeReceipt:
		return "PT"
	case kind == "bank":
		return "BN"
	default:
		return "PC"
	}
}

type vline struct {
	Description string
	Amount      decimal.Decimal
	DocumentID  *int64
}

func (s *Service) validate(ctx context.Context, q db.Q, in *Input) (*catalog.CashAccount, []vline, error) {
	if in.VoucherType != TypeReceipt && in.VoucherType != TypePayment {
		return nil, nil, apperr.ValidationField("voucher_type", "Loại phiếu phải là receipt (thu) hoặc payment (chi)")
	}
	if in.VoucherDate.Empty() {
		in.VoucherDate = util.Today()
	}
	if in.VoucherDate.Year() < 2000 || in.VoucherDate.Year() > 2100 {
		return nil, nil, apperr.ValidationField("voucher_date", "Ngày phiếu không hợp lệ")
	}
	if in.AccountID == 0 {
		return nil, nil, apperr.ValidationField("account_id", "Vui lòng chọn quỹ tiền mặt hoặc tài khoản ngân hàng")
	}
	acc, err := s.Catalog.GetCashAccount(ctx, q, in.AccountID)
	if err != nil {
		return nil, nil, apperr.ValidationField("account_id", "Tài khoản tiền không tồn tại")
	}
	if in.PartnerID != nil && *in.PartnerID == 0 {
		in.PartnerID = nil
	}
	var cus, sup bool
	if in.PartnerID != nil {
		p, err := s.Catalog.GetPartner(ctx, q, *in.PartnerID)
		if err != nil {
			return nil, nil, apperr.ValidationField("partner_id", "Đối tác không tồn tại")
		}
		cus, sup = p.IsCustomer, p.IsSupplier
	}
	switch in.DebtSide {
	case "":
		in.DebtSide = DefaultDebtSide(in.VoucherType, cus, sup, in.PartnerID != nil)
	case "receivable", "payable":
	default:
		return nil, nil, apperr.ValidationField("debt_side", "debt_side phải là receivable (công nợ phải thu) hoặc payable (công nợ phải trả)")
	}
	in.Note = strings.TrimSpace(in.Note)
	if len(in.Lines) == 0 {
		return nil, nil, apperr.ValidationField("lines", "Phiếu phải có ít nhất một dòng tiền")
	}
	if len(in.Lines) > 500 {
		return nil, nil, apperr.ValidationField("lines", "Phiếu tối đa 500 dòng")
	}
	out := make([]vline, 0, len(in.Lines))
	for i, l := range in.Lines {
		// Làm tròn 2 chữ số trước rồi mới kiểm tra > 0 (0,001 ⇒ 0 ⇒ từ chối, không lưu âm thầm thành 0).
		if l.Amount == nil || !l.Amount.Round(2).IsPositive() {
			return nil, nil, apperr.New(http.StatusBadRequest, apperr.CodeValidation, fmt.Sprintf("Dòng %d: số tiền phải lớn hơn 0 (tối thiểu 0,01)", i+1), map[string]any{"line_no": i + 1, "field": "amount"})
		}
		amt := l.Amount.Round(2)
		if amt.GreaterThanOrEqual(decimal.New(1, 15)) {
			return nil, nil, apperr.New(http.StatusBadRequest, apperr.CodeValidation, fmt.Sprintf("Dòng %d: số tiền quá lớn", i+1), map[string]any{"line_no": i + 1, "field": "amount"})
		}
		vl := vline{Description: strings.TrimSpace(l.Description), Amount: amt}
		if l.DocumentID != nil && *l.DocumentID != 0 {
			var partner *int64
			err := q.QueryRow(ctx, `SELECT partner_id FROM documents WHERE id=$1`, *l.DocumentID).Scan(&partner)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, nil, apperr.New(http.StatusBadRequest, apperr.CodeValidation, fmt.Sprintf("Dòng %d: chứng từ liên quan không tồn tại", i+1), map[string]any{"line_no": i + 1, "field": "document_id"})
			}
			if err != nil {
				return nil, nil, err
			}
			if in.PartnerID != nil && partner != nil && *partner != *in.PartnerID {
				return nil, nil, apperr.New(http.StatusBadRequest, apperr.CodeValidation, fmt.Sprintf("Dòng %d: chứng từ liên quan thuộc đối tác khác", i+1), map[string]any{"line_no": i + 1, "field": "document_id"})
			}
			id := *l.DocumentID
			vl.DocumentID = &id
		}
		out = append(out, vl)
	}
	return acc, out, nil
}

func sum(lines []vline) decimal.Decimal {
	t := decimal.Zero
	for _, l := range lines {
		t = t.Add(l.Amount)
	}
	return t
}

func insertLines(ctx context.Context, tx pgx.Tx, id int64, lines []vline) error {
	for i, l := range lines {
		if _, err := tx.Exec(ctx, `INSERT INTO cash_voucher_lines(voucher_id,line_no,description,amount,document_id) VALUES ($1,$2,$3,$4,$5)`,
			id, i+1, l.Description, l.Amount, l.DocumentID); err != nil {
			return err
		}
	}
	return nil
}

// Create tạo phiếu thu/chi (có hiệu lực ngay).
func (s *Service) Create(ctx context.Context, userID int64, in Input) (*Voucher, error) {
	var id int64
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		acc, lines, err := s.validate(ctx, tx, &in)
		if err != nil {
			return err
		}
		prefix := Prefix(in.VoucherType, acc.Kind)
		n, err := db.NextNumber(ctx, tx, prefix)
		if err != nil {
			return err
		}
		no := fmt.Sprintf("%s%05d", prefix, n)
		if err := tx.QueryRow(ctx, `INSERT INTO cash_vouchers(voucher_type,voucher_no,voucher_date,account_id,partner_id,note,total_amount,created_by,updated_by,debt_side)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING id`, in.VoucherType, no, in.VoucherDate, in.AccountID, in.PartnerID, in.Note, sum(lines), userID, in.DebtSide).Scan(&id); err != nil {
			return err
		}
		if err := insertLines(ctx, tx, id, lines); err != nil {
			return err
		}
		after, err := s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "voucher", id, "created", nil, after)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, s.Pool, id)
}

type vlock struct {
	Version   int
	Type      string
	No        string
	Kind      string
	UpdatedAt time.Time
	ByName    *string
}

func lock(ctx context.Context, tx pgx.Tx, id int64) (*vlock, error) {
	var r vlock
	err := tx.QueryRow(ctx, `SELECT v.version, v.voucher_type, v.voucher_no, a.kind, v.updated_at, u.full_name
		FROM cash_vouchers v JOIN cash_accounts a ON a.id=v.account_id LEFT JOIN users u ON u.id=v.updated_by WHERE v.id=$1 FOR UPDATE OF v`, id).
		Scan(&r.Version, &r.Type, &r.No, &r.Kind, &r.UpdatedAt, &r.ByName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperr.NotFound("phiếu thu/chi")
	}
	return &r, err
}

// Update sửa phiếu thu/chi.
func (s *Service) Update(ctx context.Context, userID, id int64, in Input) (*Voucher, error) {
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		r, err := lock(ctx, tx, id)
		if err != nil {
			return err
		}
		if in.Version == 0 {
			return apperr.ValidationField("version", "Thiếu version của phiếu")
		}
		if in.Version != r.Version {
			return docs.VersionConflict(r.ByName, r.UpdatedAt, r.Version)
		}
		if in.VoucherType == "" {
			in.VoucherType = r.Type
		}
		before, err := s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		acc, lines, err := s.validate(ctx, tx, &in)
		if err != nil {
			return err
		}
		no := r.No
		if Prefix(in.VoucherType, acc.Kind) != Prefix(r.Type, r.Kind) {
			// Đổi thu↔chi hoặc tiền mặt↔ngân hàng thì số phiếu phải theo dãy mới.
			prefix := Prefix(in.VoucherType, acc.Kind)
			n, err := db.NextNumber(ctx, tx, prefix)
			if err != nil {
				return err
			}
			no = fmt.Sprintf("%s%05d", prefix, n)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM cash_voucher_lines WHERE voucher_id=$1`, id); err != nil {
			return err
		}
		if err := insertLines(ctx, tx, id, lines); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE cash_vouchers SET voucher_type=$2, voucher_no=$3, voucher_date=$4, account_id=$5, partner_id=$6, note=$7,
			total_amount=$8, version=version+1, updated_by=$9, updated_at=now(), debt_side=$10 WHERE id=$1`,
			id, in.VoucherType, no, in.VoucherDate, in.AccountID, in.PartnerID, in.Note, sum(lines), userID, in.DebtSide); err != nil {
			return err
		}
		after, err := s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "voucher", id, "updated", before, after)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, s.Pool, id)
}

// Delete xóa phiếu thu/chi (version = 0: không kiểm tra).
func (s *Service) Delete(ctx context.Context, userID, id int64, version int) (*Voucher, error) {
	var before *Voucher
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		r, err := lock(ctx, tx, id)
		if err != nil {
			return err
		}
		if version != 0 && version != r.Version {
			return docs.VersionConflict(r.ByName, r.UpdatedAt, r.Version)
		}
		before, err = s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM cash_vouchers WHERE id=$1`, id); err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "voucher", id, "deleted", before, nil)
	})
	return before, err
}

// Get đọc phiếu đầy đủ.
func (s *Service) Get(ctx context.Context, q db.Q, id int64) (*Voucher, error) {
	var v Voucher
	err := q.QueryRow(ctx, `SELECT v.id, v.voucher_type, v.voucher_no, v.voucher_date, v.debt_side, v.account_id, a.code, a.name, a.kind,
		v.partner_id, p.code, p.name, p.address, v.note, v.total_amount, v.version,
		v.created_by, cu.full_name, v.updated_by, uu.full_name, v.created_at, v.updated_at
		FROM cash_vouchers v JOIN cash_accounts a ON a.id=v.account_id LEFT JOIN partners p ON p.id=v.partner_id
		LEFT JOIN users cu ON cu.id=v.created_by LEFT JOIN users uu ON uu.id=v.updated_by WHERE v.id=$1`, id).
		Scan(&v.ID, &v.VoucherType, &v.VoucherNo, &v.VoucherDate, &v.DebtSide, &v.AccountID, &v.AccountCode, &v.AccountName, &v.AccountKind,
			&v.PartnerID, &v.PartnerCode, &v.PartnerName, &v.PartnerAddress, &v.Note, &v.TotalAmount, &v.Version,
			&v.CreatedBy, &v.CreatedByName, &v.UpdatedBy, &v.UpdatedByName, &v.CreatedAt, &v.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperr.NotFound("phiếu thu/chi")
	}
	if err != nil {
		return nil, err
	}
	v.VoucherTypeName = TypeName(v.VoucherType, v.AccountKind)
	rows, err := q.Query(ctx, `SELECT l.id, l.line_no, l.description, l.amount, l.document_id, COALESCE(d.doc_no, d.draft_no)
		FROM cash_voucher_lines l LEFT JOIN documents d ON d.id=l.document_id WHERE l.voucher_id=$1 ORDER BY l.line_no`, id)
	if err != nil {
		return nil, err
	}
	v.Lines, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Line])
	return &v, err
}

// Summary là dòng danh sách phiếu thu chi.
type Summary struct {
	ID              int64           `json:"id"`
	VoucherType     string          `json:"voucher_type"`
	VoucherTypeName string          `json:"voucher_type_name"`
	VoucherNo       string          `json:"voucher_no"`
	VoucherDate     util.Date       `json:"voucher_date"`
	DebtSide        string          `json:"debt_side"`
	AccountID       int64           `json:"account_id"`
	AccountName     string          `json:"account_name"`
	AccountKind     string          `json:"account_kind"`
	PartnerID       *int64          `json:"partner_id"`
	PartnerName     *string         `json:"partner_name"`
	Note            string          `json:"note"`
	TotalAmount     decimal.Decimal `json:"total_amount"`
	LineCount       int             `json:"line_count"`
	Version         int             `json:"version"`
	UpdatedByName   *string         `json:"updated_by_name"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// Filter là bộ lọc danh sách phiếu.
type Filter struct {
	util.ListParams
	Type      string
	AccountID *int64
	PartnerID *int64
	From, To  *util.Date
}

// List liệt kê phiếu thu chi.
func (s *Service) List(ctx context.Context, f Filter) (util.Page[Summary], error) {
	var w util.Where
	if f.Type != "" {
		if f.Type != TypeReceipt && f.Type != TypePayment {
			return util.Page[Summary]{}, apperr.ValidationField("type", "type phải là receipt hoặc payment")
		}
		w.Add(`v.voucher_type = ?`, f.Type)
	}
	if f.AccountID != nil {
		w.Add(`v.account_id = ?`, *f.AccountID)
	}
	if f.PartnerID != nil {
		w.Add(`v.partner_id = ?`, *f.PartnerID)
	}
	if f.From != nil {
		w.Add(`v.voucher_date >= ?`, *f.From)
	}
	if f.To != nil {
		w.Add(`v.voucher_date <= ?`, *f.To)
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		w.Add(`(upper(v.voucher_no) LIKE upper(?) OR COALESCE(p.search_key,'') LIKE ? OR kho_fold(v.note) LIKE ?
			OR EXISTS (SELECT 1 FROM cash_voucher_lines l WHERE l.voucher_id=v.id AND kho_fold(l.description) LIKE ?))`,
			"%"+q+"%", util.LikePattern(q), util.LikePattern(q), util.LikePattern(q))
	}
	out := util.Page[Summary]{Page: f.Page, PageSize: f.PageSize, Items: []Summary{}}
	from := ` FROM cash_vouchers v JOIN cash_accounts a ON a.id=v.account_id LEFT JOIN partners p ON p.id=v.partner_id`
	if err := s.Pool.QueryRow(ctx, `SELECT count(*)`+from+w.SQL(), w.Args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT v.id, v.voucher_type, v.voucher_no, v.voucher_date, v.debt_side, v.account_id, a.name, a.kind, v.partner_id, p.name,
		v.note, v.total_amount, (SELECT count(*) FROM cash_voucher_lines l WHERE l.voucher_id=v.id)::int, v.version, uu.full_name, v.updated_at`+from+`
		LEFT JOIN users uu ON uu.id=v.updated_by`+w.SQL()+` ORDER BY v.voucher_date DESC, v.id DESC LIMIT `+w.Arg(f.PageSize)+` OFFSET `+w.Arg(f.Offset()), w.Args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var x Summary
		if err := rows.Scan(&x.ID, &x.VoucherType, &x.VoucherNo, &x.VoucherDate, &x.DebtSide, &x.AccountID, &x.AccountName, &x.AccountKind, &x.PartnerID, &x.PartnerName,
			&x.Note, &x.TotalAmount, &x.LineCount, &x.Version, &x.UpdatedByName, &x.UpdatedAt); err != nil {
			return out, err
		}
		x.VoucherTypeName = TypeName(x.VoucherType, x.AccountKind)
		out.Items = append(out.Items, x)
	}
	return out, rows.Err()
}
