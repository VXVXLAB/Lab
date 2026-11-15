// Package ext: "bản mở rộng" — công tắc tính năng (SPEC_MO_RONG §0), phân quyền theo vai trò (C1), khóa sổ (C4).
// Mọi tính năng tắt ⇒ hệ thống hoạt động y như bản chuẩn.
package ext

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kho/internal/apperr"
	"kho/internal/db"
	"kho/internal/util"
)

// Khóa tính năng.
const (
	FPermissions    = "permissions"
	FPeriodLock     = "period_lock"
	FImportExcel    = "import_excel"
	FMinStock       = "min_stock"
	FPriceList      = "price_list"
	FCreditLimit    = "credit_limit"
	FProfitReport   = "profit_report"
	FStocktake      = "stocktake"
	FUnitConversion = "unit_conversion"
	FVAT            = "vat"
	FPrintTemplate  = "print_template"
)

// FeatureKeys là mọi khóa tính năng theo thứ tự hiển thị.
var FeatureKeys = []string{FPermissions, FPeriodLock, FImportExcel, FMinStock, FPriceList, FCreditLimit,
	FProfitReport, FStocktake, FUnitConversion, FVAT, FPrintTemplate}

// FeatureNames là tên tiếng Việt của tính năng.
var FeatureNames = map[string]string{
	FPermissions:    "Phân quyền",
	FPeriodLock:     "Khóa sổ",
	FImportExcel:    "Nhập từ Excel",
	FMinStock:       "Tồn tối thiểu từng mã",
	FPriceList:      "Giá theo khách",
	FCreditLimit:    "Hạn mức và tuổi nợ",
	FProfitReport:   "Lãi gộp",
	FStocktake:      "Kiểm kê",
	FUnitConversion: "Quy đổi đơn vị",
	FVAT:            "Thuế GTGT trên phiếu",
	FPrintTemplate:  "Mẫu in",
}

// State là trạng thái tính năng & khóa sổ đọc từ settings.
type State struct {
	Flags    map[string]bool
	lockDate *util.Date
}

// On cho biết tính năng đang bật.
func (s *State) On(key string) bool { return s != nil && s.Flags[key] }

// LockDate trả ngày khóa sổ đang có hiệu lực (nil nếu không khóa hoặc tính năng khóa sổ tắt).
func (s *State) LockDate() *util.Date {
	if !s.On(FPeriodLock) {
		return nil
	}
	return s.lockDate
}

// RawLockDate trả ngày khóa đã lưu (kể cả khi tính năng tắt).
func (s *State) RawLockDate() *util.Date { return s.lockDate }

// Load đọc trạng thái tính năng.
func Load(ctx context.Context, q db.Q) (*State, error) {
	var raw []byte
	var lock *util.Date
	var d util.Date
	err := q.QueryRow(ctx, `SELECT features, lock_date FROM settings WHERE id=1`).Scan(&raw, &d)
	if errors.Is(err, pgx.ErrNoRows) {
		return &State{Flags: map[string]bool{}}, nil
	}
	if err != nil {
		return nil, err
	}
	if !d.Empty() {
		lock = &d
	}
	st := &State{Flags: map[string]bool{}, lockDate: lock}
	if len(raw) > 0 {
		m := map[string]bool{}
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, err
		}
		for _, k := range FeatureKeys {
			st.Flags[k] = m[k]
		}
	}
	return st, nil
}

// AllFlags trả map đủ mọi khóa (tắt ⇒ false).
func (s *State) AllFlags() map[string]bool {
	out := map[string]bool{}
	for _, k := range FeatureKeys {
		out[k] = s.On(k)
	}
	return out
}

// CheckLock trả lỗi 422 PERIOD_LOCKED nếu ngày nằm trong kỳ đã khóa.
func (s *State) CheckLock(dates ...util.Date) error {
	lock := s.LockDate()
	if lock == nil {
		return nil
	}
	for _, d := range dates {
		if d.Empty() {
			continue
		}
		if !d.After(lock.Time) {
			return LockedErr(*lock)
		}
	}
	return nil
}

// LockedErr tạo lỗi 422 PERIOD_LOCKED.
func LockedErr(lock util.Date) error {
	return apperr.New(http.StatusUnprocessableEntity, apperr.CodePeriodLocked,
		fmt.Sprintf("Kỳ đến %s đã khóa sổ: không tạo, sửa, ghi sổ, bỏ ghi sổ hay xóa chứng từ có ngày từ %s trở về trước, và không đổi ngày chứng từ vào/ra kỳ đã khóa. Liên hệ quản trị nếu cần mở khóa.", lock.VN(), lock.VN()),
		map[string]any{"lock_date": lock})
}

// LoadPool đọc trạng thái bằng pool.
func LoadPool(ctx context.Context, pool *pgxpool.Pool) (*State, error) { return Load(ctx, pool) }

// ---------- Phân quyền ----------

// Quyền.
const (
	PSaleWrite     = "sale.write"
	PPurchaseWrite = "purchase.write"
	PStockWrite    = "stock.write"
	PCashWrite     = "cash.write"
	PCatalogWrite  = "catalog.write"
	PPostedEdit    = "posted.edit"
	PCostView      = "cost.view"
	PDebtView      = "debt.view"
	PCashView      = "cash.view"
	PReportView    = "report.view"
)

// Permissions là mọi quyền theo thứ tự hiển thị.
var Permissions = []string{PSaleWrite, PPurchaseWrite, PStockWrite, PCashWrite, PCatalogWrite, PPostedEdit,
	PCostView, PDebtView, PCashView, PReportView}

// PermissionNames là tên tiếng Việt của quyền.
var PermissionNames = map[string]string{
	PSaleWrite:     "Lập phiếu bán, khách trả hàng",
	PPurchaseWrite: "Lập phiếu nhập mua, trả nhà cung cấp",
	PStockWrite:    "Lập phiếu chuyển kho, tồn đầu kỳ, kiểm kê",
	PCashWrite:     "Lập phiếu thu, phiếu chi",
	PCatalogWrite:  "Sửa danh mục (hàng hóa, đối tác, nhóm, kho, tài khoản tiền)",
	PPostedEdit:    "Sửa / bỏ ghi sổ / xóa chứng từ đã ghi sổ",
	PCostView:      "Xem giá mua, giá vốn, lãi",
	PDebtView:      "Xem công nợ",
	PCashView:      "Xem sổ quỹ, ngân hàng",
	PReportView:    "Xem báo cáo mua, bán",
}

// Roles là các vai trò (admin luôn đủ quyền, không có trong bảng role_permissions).
var Roles = []string{"admin", "ketoan", "banhang", "muahang", "thukho"}

// EditableRoles là các vai trò sửa được ma trận quyền.
var EditableRoles = []string{"ketoan", "banhang", "muahang", "thukho"}

// RoleNames là tên tiếng Việt của vai trò.
var RoleNames = map[string]string{"admin": "Quản trị", "ketoan": "Kế toán", "banhang": "Bán hàng", "muahang": "Mua hàng", "thukho": "Thủ kho"}

// IsNewRole cho biết vai trò chỉ có ở bản mở rộng.
func IsNewRole(r string) bool { return r == "banhang" || r == "muahang" || r == "thukho" }

// ValidRole kiểm tra vai trò hợp lệ.
func ValidRole(r string) bool {
	for _, x := range Roles {
		if x == r {
			return true
		}
	}
	return false
}

// Set là tập quyền của một người dùng.
type Set map[string]bool

// Has cho biết có quyền.
func (s Set) Has(p string) bool { return s[p] }

// List trả danh sách quyền theo thứ tự chuẩn.
func (s Set) List() []string {
	out := []string{}
	for _, p := range Permissions {
		if s[p] {
			out = append(out, p)
		}
	}
	return out
}

// Full cho biết có mọi quyền.
func (s Set) Full() bool {
	for _, p := range Permissions {
		if !s[p] {
			return false
		}
	}
	return true
}

func allSet() Set {
	s := Set{}
	for _, p := range Permissions {
		s[p] = true
	}
	return s
}

// PermsFor tính tập quyền của vai trò. Tính năng tắt (hoặc admin) ⇒ đủ quyền, như bản chuẩn.
func PermsFor(ctx context.Context, q db.Q, st *State, role string) (Set, error) {
	if !st.On(FPermissions) || role == "admin" {
		return allSet(), nil
	}
	rows, err := q.Query(ctx, `SELECT permission FROM role_permissions WHERE role=$1`, role)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	s := Set{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		s[p] = true
	}
	return s, rows.Err()
}

// Need trả lỗi 403 nêu tên quyền nếu thiếu.
func Need(s Set, perms ...string) error {
	for _, p := range perms {
		if !s.Has(p) {
			return apperr.New(http.StatusForbidden, apperr.CodeForbidden,
				"Bạn không có quyền \""+PermissionNames[p]+"\". Liên hệ quản trị để được cấp quyền.", map[string]any{"permission": p})
		}
	}
	return nil
}

// RoleMatrix trả ma trận vai trò × quyền (không gồm admin).
func RoleMatrix(ctx context.Context, q db.Q) (map[string][]string, error) {
	out := map[string][]string{}
	for _, r := range EditableRoles {
		out[r] = []string{}
	}
	rows, err := q.Query(ctx, `SELECT role, permission FROM role_permissions ORDER BY role, permission`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r, p string
		if err := rows.Scan(&r, &p); err != nil {
			return nil, err
		}
		out[r] = append(out[r], p)
	}
	for r := range out {
		sort.SliceStable(out[r], func(i, j int) bool { return permIndex(out[r][i]) < permIndex(out[r][j]) })
	}
	return out, rows.Err()
}

func permIndex(p string) int {
	for i, x := range Permissions {
		if x == p {
			return i
		}
	}
	return len(Permissions)
}

// SaveRoleMatrix thay quyền của các vai trò có trong m (vai trò không có trong m giữ nguyên).
func SaveRoleMatrix(ctx context.Context, pool *pgxpool.Pool, userID int64, m map[string][]string) (map[string][]string, error) {
	for r, perms := range m {
		if r == "admin" {
			return nil, apperr.ValidationField("role", "Quản trị luôn có mọi quyền, không sửa được")
		}
		ok := false
		for _, x := range EditableRoles {
			if x == r {
				ok = true
			}
		}
		if !ok {
			return nil, apperr.ValidationField("role", "Vai trò không hợp lệ: "+r)
		}
		for _, p := range perms {
			if _, ok := PermissionNames[p]; !ok {
				return nil, apperr.ValidationField("permission", "Quyền không hợp lệ: "+p)
			}
		}
	}
	var out map[string][]string
	err := db.InTx(ctx, pool, func(tx pgx.Tx) error {
		before, err := RoleMatrix(ctx, tx)
		if err != nil {
			return err
		}
		for r, perms := range m {
			if _, err := tx.Exec(ctx, `DELETE FROM role_permissions WHERE role=$1`, r); err != nil {
				return err
			}
			seen := map[string]bool{}
			for _, p := range perms {
				if seen[p] {
					continue
				}
				seen[p] = true
				if _, err := tx.Exec(ctx, `INSERT INTO role_permissions(role, permission) VALUES ($1,$2)`, r, p); err != nil {
					return err
				}
			}
		}
		out, err = RoleMatrix(ctx, tx)
		if err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "role_permissions", 1, "updated", before, out)
	})
	return out, err
}

// ---------- Ghi công tắc / khóa sổ ----------

// SaveFeatures cập nhật công tắc (chỉ các khóa gửi lên). Tắt `permissions` khi còn người dùng mang vai trò mới
// ⇒ 409 nêu tên, trừ khi confirm.
func SaveFeatures(ctx context.Context, pool *pgxpool.Pool, userID int64, changes map[string]bool, confirm bool) (map[string]bool, error) {
	for k := range changes {
		if _, ok := FeatureNames[k]; !ok {
			return nil, apperr.ValidationField("features", "Khóa tính năng không hợp lệ: "+k)
		}
	}
	var out map[string]bool
	err := db.InTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT 1 FROM settings WHERE id=1 FOR UPDATE`); err != nil {
			return err
		}
		st, err := Load(ctx, tx)
		if err != nil {
			return err
		}
		before := st.AllFlags()
		after := st.AllFlags()
		for k, v := range changes {
			after[k] = v
		}
		if before[FPermissions] && !after[FPermissions] && !confirm {
			rows, err := tx.Query(ctx, `SELECT username || ' (' || full_name || ', ' || role || ')' FROM users WHERE role IN ('banhang','muahang','thukho') ORDER BY username`)
			if err != nil {
				return err
			}
			names, err := pgx.CollectRows(rows, pgx.RowTo[string])
			if err != nil {
				return err
			}
			if len(names) > 0 {
				return apperr.New(http.StatusConflict, apperr.CodeInUse,
					"Còn người dùng mang vai trò mới: "+strings.Join(names, ", ")+". Tắt Phân quyền thì họ được coi như Kế toán (đủ quyền nghiệp vụ). Gửi lại với confirm=true nếu chắc chắn.",
					map[string]any{"users": names})
			}
		}
		b, _ := json.Marshal(after)
		if _, err := tx.Exec(ctx, `UPDATE settings SET features=$1, features_initialized=TRUE, updated_by=$2, updated_at=now() WHERE id=1`, b, userID); err != nil {
			return err
		}
		out = after
		return db.Audit(ctx, tx, userID, "features", 1, "updated", before, after)
	})
	return out, err
}

// SetLockDate đặt / lùi / bỏ ngày khóa sổ (nil = bỏ khóa). Không cho ngày tương lai.
func SetLockDate(ctx context.Context, pool *pgxpool.Pool, userID int64, lock *util.Date, reason string) (*util.Date, error) {
	if lock != nil && lock.After(util.Today().Time) {
		return nil, apperr.ValidationField("lock_date", "Không được khóa sổ đến ngày trong tương lai")
	}
	reason = strings.TrimSpace(reason)
	err := db.InTx(ctx, pool, func(tx pgx.Tx) error {
		st, err := Load(ctx, tx)
		if err != nil {
			return err
		}
		var arg any
		if lock != nil {
			arg = *lock
		}
		if _, err := tx.Exec(ctx, `UPDATE settings SET lock_date=$1, updated_by=$2, updated_at=now() WHERE id=1`, arg, userID); err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "period_lock", 1, "updated",
			map[string]any{"lock_date": st.RawLockDate()}, map[string]any{"lock_date": lock, "reason": reason})
	})
	return lock, err
}

// SeedFeatures gán công tắc lần đầu theo bản cài (KHO_EDITION=extended ⇒ bật hết, ngược lại tắt hết).
// Chỉ có hiệu lực khi dòng settings chưa từng được gán (features_initialized = false); không bao giờ đè lại.
// Gọi sau db.Seed (máy chủ và seeddemo).
func SeedFeatures(ctx context.Context, pool *pgxpool.Pool, edition string) error {
	m := map[string]bool{}
	for _, k := range FeatureKeys {
		m[k] = edition == "extended"
	}
	b, _ := json.Marshal(m)
	_, err := pool.Exec(ctx, `UPDATE settings SET features=$1, features_initialized=TRUE WHERE id=1 AND NOT features_initialized`, b)
	return err
}
