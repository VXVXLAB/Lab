// Package catalog: danh mục kho, nhóm VTHH, mặt hàng, đối tác, tài khoản tiền.
package catalog

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/db"
	"kho/internal/stock"
	"kho/internal/util"
)

// Service xử lý danh mục.
type Service struct {
	Pool *pgxpool.Pool
}

// ---------- Kho ----------

// Warehouse là kho hàng.
type Warehouse struct {
	ID     int64  `json:"id"`
	Code   string `json:"code"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

// WarehouseInput là dữ liệu tạo/sửa kho.
type WarehouseInput struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	Active *bool  `json:"active"`
}

func activeOr(b *bool) bool { return b == nil || *b }

func requireCodeName(code, name *string) error {
	*code = strings.TrimSpace(*code)
	*name = strings.TrimSpace(*name)
	if *code == "" {
		return apperr.ValidationField("code", "Vui lòng nhập mã")
	}
	if len(*code) > 50 {
		return apperr.ValidationField("code", "Mã quá dài (tối đa 50 ký tự)")
	}
	if *name == "" {
		return apperr.ValidationField("name", "Vui lòng nhập tên")
	}
	return nil
}

func dupErr(err error) error {
	if err == nil {
		return nil
	}
	if ae := apperr.From(err); ae.Code == apperr.CodeValidation && ae.Details != nil {
		if m, ok := ae.Details.(map[string]any); ok && strings.HasSuffix(m["constraint"].(string), "_code_uq") {
			return apperr.ValidationField("code", "Mã đã tồn tại, vui lòng chọn mã khác")
		}
	}
	return err
}

func notFound(err error, what string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.NotFound(what)
	}
	return err
}

func deleteErr(err error, what string) error {
	if err == nil {
		return nil
	}
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23503" {
		return apperr.InUse(what + " đã phát sinh dữ liệu, không xóa được. Hãy chuyển sang \"Ngừng sử dụng\".")
	}
	return err
}

// ListWarehouses liệt kê kho.
func (s *Service) ListWarehouses(ctx context.Context, p util.ListParams) (util.Page[Warehouse], error) {
	var w util.Where
	if p.Q != "" {
		w.Add(`kho_fold(code || ' ' || name) LIKE ?`, util.LikePattern(p.Q))
	}
	if p.Active != nil {
		w.Add(`active = ?`, *p.Active)
	}
	out := util.Page[Warehouse]{Page: p.Page, PageSize: p.PageSize, Items: []Warehouse{}}
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM warehouses`+w.SQL(), w.Args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT id,code,name,active FROM warehouses`+w.SQL()+` ORDER BY code LIMIT `+w.Arg(p.PageSize)+` OFFSET `+w.Arg(p.Offset()), w.Args...)
	if err != nil {
		return out, err
	}
	out.Items, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Warehouse])
	return out, err
}

// GetWarehouse lấy kho.
func (s *Service) GetWarehouse(ctx context.Context, q db.Q, id int64) (*Warehouse, error) {
	var x Warehouse
	err := q.QueryRow(ctx, `SELECT id,code,name,active FROM warehouses WHERE id=$1`, id).Scan(&x.ID, &x.Code, &x.Name, &x.Active)
	if err != nil {
		return nil, notFound(err, "kho")
	}
	return &x, nil
}

// SaveWarehouse tạo (id=0) hoặc sửa kho.
func (s *Service) SaveWarehouse(ctx context.Context, userID, id int64, in WarehouseInput) (*Warehouse, error) {
	if err := requireCodeName(&in.Code, &in.Name); err != nil {
		return nil, err
	}
	var out Warehouse
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		var before *Warehouse
		var row pgx.Row
		if id == 0 {
			row = tx.QueryRow(ctx, `INSERT INTO warehouses(code,name,active) VALUES ($1,$2,$3) RETURNING id,code,name,active`, in.Code, in.Name, activeOr(in.Active))
		} else {
			b, err := s.GetWarehouse(ctx, tx, id)
			if err != nil {
				return err
			}
			before = b
			row = tx.QueryRow(ctx, `UPDATE warehouses SET code=$2,name=$3,active=$4 WHERE id=$1 RETURNING id,code,name,active`, id, in.Code, in.Name, activeOr(in.Active))
		}
		if err := row.Scan(&out.ID, &out.Code, &out.Name, &out.Active); err != nil {
			return dupErr(err)
		}
		return db.Audit(ctx, tx, userID, "warehouse", out.ID, actionOf(id), before, out)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func actionOf(id int64) string {
	if id == 0 {
		return "created"
	}
	return "updated"
}

// DeleteWarehouse xóa kho chưa phát sinh.
func (s *Service) DeleteWarehouse(ctx context.Context, userID, id int64) error {
	return db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		b, err := s.GetWarehouse(ctx, tx, id)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM warehouses WHERE id=$1`, id); err != nil {
			return deleteErr(err, "Kho")
		}
		return db.Audit(ctx, tx, userID, "warehouse", id, "deleted", b, nil)
	})
}

// ---------- Nhóm VTHH ----------

// ProductGroup là nhóm vật tư hàng hóa.
type ProductGroup struct {
	ID     int64  `json:"id"`
	Code   string `json:"code"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

// GroupInput là dữ liệu tạo/sửa nhóm.
type GroupInput = WarehouseInput

// ListGroups liệt kê nhóm.
func (s *Service) ListGroups(ctx context.Context, p util.ListParams) (util.Page[ProductGroup], error) {
	var w util.Where
	if p.Q != "" {
		w.Add(`kho_fold(code || ' ' || name) LIKE ?`, util.LikePattern(p.Q))
	}
	if p.Active != nil {
		w.Add(`active = ?`, *p.Active)
	}
	out := util.Page[ProductGroup]{Page: p.Page, PageSize: p.PageSize, Items: []ProductGroup{}}
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM product_groups`+w.SQL(), w.Args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT id,code,name,active FROM product_groups`+w.SQL()+` ORDER BY code LIMIT `+w.Arg(p.PageSize)+` OFFSET `+w.Arg(p.Offset()), w.Args...)
	if err != nil {
		return out, err
	}
	out.Items, err = pgx.CollectRows(rows, pgx.RowToStructByPos[ProductGroup])
	return out, err
}

// GetGroup lấy nhóm.
func (s *Service) GetGroup(ctx context.Context, q db.Q, id int64) (*ProductGroup, error) {
	var x ProductGroup
	err := q.QueryRow(ctx, `SELECT id,code,name,active FROM product_groups WHERE id=$1`, id).Scan(&x.ID, &x.Code, &x.Name, &x.Active)
	if err != nil {
		return nil, notFound(err, "nhóm VTHH")
	}
	return &x, nil
}

// SaveGroup tạo/sửa nhóm.
func (s *Service) SaveGroup(ctx context.Context, userID, id int64, in GroupInput) (*ProductGroup, error) {
	if err := requireCodeName(&in.Code, &in.Name); err != nil {
		return nil, err
	}
	var out ProductGroup
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		var before *ProductGroup
		var row pgx.Row
		if id == 0 {
			row = tx.QueryRow(ctx, `INSERT INTO product_groups(code,name,active) VALUES ($1,$2,$3) RETURNING id,code,name,active`, in.Code, in.Name, activeOr(in.Active))
		} else {
			b, err := s.GetGroup(ctx, tx, id)
			if err != nil {
				return err
			}
			before = b
			row = tx.QueryRow(ctx, `UPDATE product_groups SET code=$2,name=$3,active=$4 WHERE id=$1 RETURNING id,code,name,active`, id, in.Code, in.Name, activeOr(in.Active))
		}
		if err := row.Scan(&out.ID, &out.Code, &out.Name, &out.Active); err != nil {
			return dupErr(err)
		}
		return db.Audit(ctx, tx, userID, "product_group", out.ID, actionOf(id), before, out)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteGroup xóa nhóm chưa có mặt hàng.
func (s *Service) DeleteGroup(ctx context.Context, userID, id int64) error {
	return db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		b, err := s.GetGroup(ctx, tx, id)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM product_groups WHERE id=$1`, id); err != nil {
			return deleteErr(err, "Nhóm VTHH")
		}
		return db.Audit(ctx, tx, userID, "product_group", id, "deleted", b, nil)
	})
}

// ---------- Mặt hàng ----------

// Product là mặt hàng (vật tư hàng hóa) hoặc dịch vụ.
type Product struct {
	ID            int64           `json:"id"`
	Code          string          `json:"code"`
	Name          string          `json:"name"`
	Unit          string          `json:"unit"`
	GroupID       *int64          `json:"group_id"`
	GroupCode     *string         `json:"group_code"`
	GroupName     *string         `json:"group_name"`
	SalePrice     decimal.Decimal `json:"sale_price"`
	PurchasePrice decimal.Decimal `json:"purchase_price"`
	IsService     bool            `json:"is_service"`
	Active        bool            `json:"active"`
}

// ProductInput là dữ liệu tạo/sửa mặt hàng.
type ProductInput struct {
	Code          string           `json:"code"`
	Name          string           `json:"name"`
	Unit          string           `json:"unit"`
	GroupID       *int64           `json:"group_id"`
	SalePrice     *decimal.Decimal `json:"sale_price"`
	PurchasePrice *decimal.Decimal `json:"purchase_price"`
	IsService     bool             `json:"is_service"`
	Active        *bool            `json:"active"`
}

const productSelect = `SELECT p.id,p.code,p.name,p.unit,p.group_id,g.code,g.name,p.sale_price,p.purchase_price,p.is_service,p.active
	FROM products p LEFT JOIN product_groups g ON g.id=p.group_id`

// ProductFilter là bộ lọc danh sách mặt hàng.
type ProductFilter struct {
	util.ListParams
	GroupID   *int64
	IsService *bool
}

// ListProducts liệt kê mặt hàng (q tìm theo mã/tên, không phân biệt dấu).
func (s *Service) ListProducts(ctx context.Context, f ProductFilter) (util.Page[Product], error) {
	var w util.Where
	if f.Q != "" {
		w.Add(`p.search_key LIKE ?`, util.LikePattern(f.Q))
	}
	if f.Active != nil {
		w.Add(`p.active = ?`, *f.Active)
	}
	if f.GroupID != nil {
		w.Add(`p.group_id = ?`, *f.GroupID)
	}
	if f.IsService != nil {
		w.Add(`p.is_service = ?`, *f.IsService)
	}
	out := util.Page[Product]{Page: f.Page, PageSize: f.PageSize, Items: []Product{}}
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM products p`+w.SQL(), w.Args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := s.Pool.Query(ctx, productSelect+w.SQL()+` ORDER BY p.code LIMIT `+w.Arg(f.PageSize)+` OFFSET `+w.Arg(f.Offset()), w.Args...)
	if err != nil {
		return out, err
	}
	out.Items, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Product])
	return out, err
}

// GetProduct lấy mặt hàng.
func (s *Service) GetProduct(ctx context.Context, q db.Q, id int64) (*Product, error) {
	rows, err := q.Query(ctx, productSelect+` WHERE p.id=$1`, id)
	if err != nil {
		return nil, err
	}
	x, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[Product])
	if err != nil {
		return nil, notFound(err, "mặt hàng")
	}
	return &x, nil
}

// LookupProduct tìm chính xác theo mã (không phân biệt hoa thường; DICHVU ⇒ DV).
func (s *Service) LookupProduct(ctx context.Context, q db.Q, code string) (*Product, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, apperr.ValidationField("code", "Vui lòng nhập mã hàng")
	}
	if strings.EqualFold(code, "DICHVU") || strings.EqualFold(code, "DỊCHVỤ") || strings.EqualFold(util.Fold(code), "dich vu") {
		code = "DV"
	}
	rows, err := q.Query(ctx, productSelect+` WHERE upper(p.code)=upper($1)`, code)
	if err != nil {
		return nil, err
	}
	x, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[Product])
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.NotFound("mặt hàng có mã " + code)
		}
		return nil, err
	}
	return &x, nil
}

// SaveProduct tạo/sửa mặt hàng.
func (s *Service) SaveProduct(ctx context.Context, userID, id int64, in ProductInput) (*Product, error) {
	if err := requireCodeName(&in.Code, &in.Name); err != nil {
		return nil, err
	}
	in.Unit = strings.TrimSpace(in.Unit)
	sale, purchase := decimal.Zero, decimal.Zero
	if in.SalePrice != nil {
		sale = *in.SalePrice
	}
	if in.PurchasePrice != nil {
		purchase = *in.PurchasePrice
	}
	if sale.IsNegative() {
		return nil, apperr.ValidationField("sale_price", "Giá bán không được âm")
	}
	if purchase.IsNegative() {
		return nil, apperr.ValidationField("purchase_price", "Giá mua không được âm")
	}
	if !in.IsService && in.Unit == "" {
		return nil, apperr.ValidationField("unit", "Vui lòng nhập đơn vị tính")
	}
	if strings.EqualFold(in.Code, "DICHVU") {
		return nil, apperr.ValidationField("code", "Mã DICHVU dành cho mã Dịch vụ (DV)")
	}
	var out *Product
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		if in.GroupID != nil {
			if _, err := s.GetGroup(ctx, tx, *in.GroupID); err != nil {
				return apperr.ValidationField("group_id", "Nhóm VTHH không tồn tại")
			}
		}
		key := util.Fold(in.Code + " " + in.Name)
		var before *Product
		var newID int64
		if id == 0 {
			err := tx.QueryRow(ctx, `INSERT INTO products(code,name,unit,group_id,sale_price,purchase_price,is_service,active,search_key)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
				in.Code, in.Name, in.Unit, in.GroupID, sale, purchase, in.IsService, activeOr(in.Active), key).Scan(&newID)
			if err != nil {
				return dupErr(err)
			}
		} else {
			b, err := s.GetProduct(ctx, tx, id)
			if err != nil {
				return err
			}
			before = b
			if strings.EqualFold(b.Code, "DV") && (!strings.EqualFold(in.Code, "DV") || !in.IsService) {
				return apperr.Validation("Không được đổi mã hoặc bỏ tính chất dịch vụ của mã DV")
			}
			if b.IsService != in.IsService {
				var used bool
				if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM document_lines WHERE product_id=$1)`, id).Scan(&used); err != nil {
					return err
				}
				if used {
					return apperr.ValidationField("is_service", "Mặt hàng đã phát sinh chứng từ, không đổi được tính chất hàng hóa/dịch vụ")
				}
			}
			_, err = tx.Exec(ctx, `UPDATE products SET code=$2,name=$3,unit=$4,group_id=$5,sale_price=$6,purchase_price=$7,is_service=$8,active=$9,search_key=$10 WHERE id=$1`,
				id, in.Code, in.Name, in.Unit, in.GroupID, sale, purchase, in.IsService, activeOr(in.Active), key)
			if err != nil {
				return dupErr(err)
			}
			newID = id
		}
		p, err := s.GetProduct(ctx, tx, newID)
		if err != nil {
			return err
		}
		out = p
		return db.Audit(ctx, tx, userID, "product", newID, actionOf(id), before, p)
	})
	return out, err
}

// DeleteProduct xóa mặt hàng chưa phát sinh.
func (s *Service) DeleteProduct(ctx context.Context, userID, id int64) error {
	return db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		b, err := s.GetProduct(ctx, tx, id)
		if err != nil {
			return err
		}
		if strings.EqualFold(b.Code, "DV") {
			return apperr.InUse("Mã Dịch vụ (DV) là mã hệ thống, không xóa được")
		}
		if _, err := tx.Exec(ctx, `DELETE FROM products WHERE id=$1`, id); err != nil {
			return deleteErr(err, "Mặt hàng")
		}
		return db.Audit(ctx, tx, userID, "product", id, "deleted", b, nil)
	})
}

// ---------- Đối tác ----------

// Partner là khách hàng và/hoặc nhà cung cấp.
type Partner struct {
	ID                int64           `json:"id"`
	Code              string          `json:"code"`
	Name              string          `json:"name"`
	Address           string          `json:"address"`
	Phone             string          `json:"phone"`
	TaxCode           string          `json:"tax_code"`
	IsCustomer        bool            `json:"is_customer"`
	IsSupplier        bool            `json:"is_supplier"`
	OpeningReceivable decimal.Decimal `json:"opening_receivable"`
	OpeningPayable    decimal.Decimal `json:"opening_payable"`
	Active            bool            `json:"active"`
}

// PartnerInput là dữ liệu tạo/sửa đối tác.
type PartnerInput struct {
	Code              string           `json:"code"`
	Name              string           `json:"name"`
	Address           string           `json:"address"`
	Phone             string           `json:"phone"`
	TaxCode           string           `json:"tax_code"`
	IsCustomer        bool             `json:"is_customer"`
	IsSupplier        bool             `json:"is_supplier"`
	OpeningReceivable *decimal.Decimal `json:"opening_receivable"`
	OpeningPayable    *decimal.Decimal `json:"opening_payable"`
	Active            *bool            `json:"active"`
}

const partnerCols = `id,code,name,address,phone,tax_code,is_customer,is_supplier,opening_receivable,opening_payable,active`

// PartnerFilter là bộ lọc đối tác.
type PartnerFilter struct {
	util.ListParams
	Type string // customer | supplier | ""
}

// ListPartners liệt kê đối tác.
func (s *Service) ListPartners(ctx context.Context, f PartnerFilter) (util.Page[Partner], error) {
	var w util.Where
	tokens := util.SearchTokens(f.Q)
	if c := util.PartnerMatchSQL(&w, "partners", tokens); c != "" {
		w.Add(c)
	}
	if f.Active != nil {
		w.Add(`active = ?`, *f.Active)
	}
	switch f.Type {
	case "customer":
		w.Add(`is_customer`)
	case "supplier":
		w.Add(`is_supplier`)
	case "":
	default:
		return util.Page[Partner]{}, apperr.ValidationField("type", "type phải là customer hoặc supplier")
	}
	out := util.Page[Partner]{Page: f.Page, PageSize: f.PageSize, Items: []Partner{}}
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM partners`+w.SQL(), w.Args...).Scan(&out.Total); err != nil {
		return out, err
	}
	// Có từ khóa ⇒ xếp theo mức khớp (trùng mã, tên bắt đầu bằng cụm từ, …) rồi theo tên; không có ⇒ theo mã.
	order := ` ORDER BY code`
	if len(tokens) > 0 {
		order = ` ORDER BY ` + util.PartnerRankSQL(&w, "partners", tokens) + `, name, code`
	}
	rows, err := s.Pool.Query(ctx, `SELECT `+partnerCols+` FROM partners`+w.SQL()+order+` LIMIT `+w.Arg(f.PageSize)+` OFFSET `+w.Arg(f.Offset()), w.Args...)
	if err != nil {
		return out, err
	}
	out.Items, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Partner])
	return out, err
}

// GetPartner lấy đối tác.
func (s *Service) GetPartner(ctx context.Context, q db.Q, id int64) (*Partner, error) {
	rows, err := q.Query(ctx, `SELECT `+partnerCols+` FROM partners WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	x, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[Partner])
	if err != nil {
		return nil, notFound(err, "đối tác")
	}
	return &x, nil
}

// SavePartner tạo/sửa đối tác.
func (s *Service) SavePartner(ctx context.Context, userID, id int64, in PartnerInput) (*Partner, error) {
	if err := requireCodeName(&in.Code, &in.Name); err != nil {
		return nil, err
	}
	if !in.IsCustomer && !in.IsSupplier {
		return nil, apperr.ValidationField("is_customer", "Đối tác phải là Khách hàng hoặc Nhà cung cấp (hoặc cả hai)")
	}
	or, op := decimal.Zero, decimal.Zero
	if in.OpeningReceivable != nil {
		or = *in.OpeningReceivable
	}
	if in.OpeningPayable != nil {
		op = *in.OpeningPayable
	}
	var out *Partner
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		key := util.Fold(in.Code + " " + in.Name + " " + in.Phone + " " + in.TaxCode)
		var before *Partner
		var newID int64
		if id == 0 {
			err := tx.QueryRow(ctx, `INSERT INTO partners(code,name,address,phone,tax_code,is_customer,is_supplier,opening_receivable,opening_payable,active,search_key)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
				in.Code, in.Name, strings.TrimSpace(in.Address), strings.TrimSpace(in.Phone), strings.TrimSpace(in.TaxCode),
				in.IsCustomer, in.IsSupplier, or, op, activeOr(in.Active), key).Scan(&newID)
			if err != nil {
				return dupErr(err)
			}
		} else {
			b, err := s.GetPartner(ctx, tx, id)
			if err != nil {
				return err
			}
			before = b
			_, err = tx.Exec(ctx, `UPDATE partners SET code=$2,name=$3,address=$4,phone=$5,tax_code=$6,is_customer=$7,is_supplier=$8,
				opening_receivable=$9,opening_payable=$10,active=$11,search_key=$12 WHERE id=$1`,
				id, in.Code, in.Name, strings.TrimSpace(in.Address), strings.TrimSpace(in.Phone), strings.TrimSpace(in.TaxCode),
				in.IsCustomer, in.IsSupplier, or, op, activeOr(in.Active), key)
			if err != nil {
				return dupErr(err)
			}
			newID = id
		}
		p, err := s.GetPartner(ctx, tx, newID)
		if err != nil {
			return err
		}
		out = p
		return db.Audit(ctx, tx, userID, "partner", newID, actionOf(id), before, p)
	})
	return out, err
}

// DeletePartner xóa đối tác chưa phát sinh.
func (s *Service) DeletePartner(ctx context.Context, userID, id int64) error {
	return db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		b, err := s.GetPartner(ctx, tx, id)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM partners WHERE id=$1`, id); err != nil {
			return deleteErr(err, "Đối tác")
		}
		return db.Audit(ctx, tx, userID, "partner", id, "deleted", b, nil)
	})
}

// ---------- Tài khoản tiền ----------

// CashAccount là quỹ tiền mặt hoặc tài khoản ngân hàng.
type CashAccount struct {
	ID             int64           `json:"id"`
	Code           string          `json:"code"`
	Name           string          `json:"name"`
	Kind           string          `json:"kind"`
	OpeningBalance decimal.Decimal `json:"opening_balance"`
	Active         bool            `json:"active"`
}

// CashAccountInput là dữ liệu tạo/sửa tài khoản tiền.
type CashAccountInput struct {
	Code           string           `json:"code"`
	Name           string           `json:"name"`
	Kind           string           `json:"kind"`
	OpeningBalance *decimal.Decimal `json:"opening_balance"`
	Active         *bool            `json:"active"`
}

// ListCashAccounts liệt kê tài khoản tiền.
func (s *Service) ListCashAccounts(ctx context.Context, p util.ListParams) (util.Page[CashAccount], error) {
	var w util.Where
	if p.Q != "" {
		w.Add(`kho_fold(code || ' ' || name) LIKE ?`, util.LikePattern(p.Q))
	}
	if p.Active != nil {
		w.Add(`active = ?`, *p.Active)
	}
	out := util.Page[CashAccount]{Page: p.Page, PageSize: p.PageSize, Items: []CashAccount{}}
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM cash_accounts`+w.SQL(), w.Args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT id,code,name,kind,opening_balance,active FROM cash_accounts`+w.SQL()+` ORDER BY code LIMIT `+w.Arg(p.PageSize)+` OFFSET `+w.Arg(p.Offset()), w.Args...)
	if err != nil {
		return out, err
	}
	out.Items, err = pgx.CollectRows(rows, pgx.RowToStructByPos[CashAccount])
	return out, err
}

// GetCashAccount lấy tài khoản tiền.
func (s *Service) GetCashAccount(ctx context.Context, q db.Q, id int64) (*CashAccount, error) {
	rows, err := q.Query(ctx, `SELECT id,code,name,kind,opening_balance,active FROM cash_accounts WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	x, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[CashAccount])
	if err != nil {
		return nil, notFound(err, "tài khoản tiền")
	}
	return &x, nil
}

// SaveCashAccount tạo/sửa tài khoản tiền.
func (s *Service) SaveCashAccount(ctx context.Context, userID, id int64, in CashAccountInput) (*CashAccount, error) {
	if err := requireCodeName(&in.Code, &in.Name); err != nil {
		return nil, err
	}
	if in.Kind != "cash" && in.Kind != "bank" {
		return nil, apperr.ValidationField("kind", "Loại tài khoản phải là cash (tiền mặt) hoặc bank (ngân hàng)")
	}
	ob := decimal.Zero
	if in.OpeningBalance != nil {
		ob = *in.OpeningBalance
	}
	var out *CashAccount
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		var before *CashAccount
		var newID int64
		if id == 0 {
			if err := tx.QueryRow(ctx, `INSERT INTO cash_accounts(code,name,kind,opening_balance,active) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
				in.Code, in.Name, in.Kind, ob, activeOr(in.Active)).Scan(&newID); err != nil {
				return dupErr(err)
			}
		} else {
			b, err := s.GetCashAccount(ctx, tx, id)
			if err != nil {
				return err
			}
			before = b
			if b.Kind != in.Kind {
				var used bool
				if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM cash_vouchers WHERE account_id=$1)`, id).Scan(&used); err != nil {
					return err
				}
				if used {
					return apperr.ValidationField("kind", "Tài khoản đã có phiếu thu/chi, không đổi được loại tiền mặt/ngân hàng")
				}
			}
			if _, err := tx.Exec(ctx, `UPDATE cash_accounts SET code=$2,name=$3,kind=$4,opening_balance=$5,active=$6 WHERE id=$1`,
				id, in.Code, in.Name, in.Kind, ob, activeOr(in.Active)); err != nil {
				return dupErr(err)
			}
			newID = id
		}
		a, err := s.GetCashAccount(ctx, tx, newID)
		if err != nil {
			return err
		}
		out = a
		return db.Audit(ctx, tx, userID, "cash_account", newID, actionOf(id), before, a)
	})
	return out, err
}

// DeleteCashAccount xóa tài khoản chưa phát sinh.
func (s *Service) DeleteCashAccount(ctx context.Context, userID, id int64) error {
	return db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		b, err := s.GetCashAccount(ctx, tx, id)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM cash_accounts WHERE id=$1`, id); err != nil {
			return deleteErr(err, "Tài khoản tiền")
		}
		return db.Audit(ctx, tx, userID, "cash_account", id, "deleted", b, nil)
	})
}

// ProductStock là mặt hàng kèm tồn (danh sách with_stock=true).
type ProductStock struct {
	Product
	TotalStock   decimal.Decimal  `json:"total_stock"`
	WarehouseQty *decimal.Decimal `json:"warehouse_qty,omitempty"`
}

// ListProductsWithStock như ListProducts, thêm tồn tổng (và tồn tại kho warehouseID) đến hết hôm nay;
// tồn của cả trang lấy bằng một truy vấn gộp.
func (s *Service) ListProductsWithStock(ctx context.Context, f ProductFilter, warehouseID *int64) (util.Page[ProductStock], error) {
	pg, err := s.ListProducts(ctx, f)
	out := util.Page[ProductStock]{Page: pg.Page, PageSize: pg.PageSize, Total: pg.Total, Items: []ProductStock{}}
	if err != nil {
		return out, err
	}
	if warehouseID != nil {
		if _, err := s.GetWarehouse(ctx, s.Pool, *warehouseID); err != nil {
			return out, apperr.ValidationField("warehouse_id", "Kho không tồn tại")
		}
	}
	ids := make([]int64, len(pg.Items))
	for i, p := range pg.Items {
		ids[i] = p.ID
	}
	totals, err := stock.StockTotals(ctx, s.Pool, ids, util.Today(), warehouseID)
	if err != nil {
		return out, err
	}
	for _, p := range pg.Items {
		t := totals[p.ID]
		it := ProductStock{Product: p, TotalStock: t[0]}
		if warehouseID != nil {
			w := t[1]
			it.WarehouseQty = &w
		}
		out.Items = append(out.Items, it)
	}
	return out, nil
}
