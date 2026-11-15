// Package importx: nhập dữ liệu từ Excel (bản mở rộng C3) — danh mục hàng hóa, đối tác, tồn đầu kỳ, công nợ đầu kỳ.
// Thử (dry-run) không ghi gì; ghi thật là "tất cả hoặc không gì" trong một giao dịch.
package importx

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
	"github.com/xuri/excelize/v2"

	"kho/internal/apperr"
	"kho/internal/db"
	"kho/internal/ext"
	"kho/internal/util"
)

// Loại nhập.
const (
	KindProducts     = "products"
	KindPartners     = "partners"
	KindOpeningStock = "opening_stock"
	KindOpeningDebt  = "opening_debt"
)

// Giới hạn.
const (
	MaxRows       = 20000
	MaxFileBytes  = 10 << 20
	maxLinesInDoc = 1000 // mỗi phiếu tồn đầu tạm tối đa 1000 dòng (giới hạn chung của chứng từ)
)

// KindNames là tên tiếng Việt của loại nhập.
var KindNames = map[string]string{
	KindProducts:     "Danh mục hàng hóa",
	KindPartners:     "Danh mục đối tác",
	KindOpeningStock: "Tồn đầu kỳ",
	KindOpeningDebt:  "Công nợ đầu kỳ",
}

// column mô tả một cột: khóa, tiêu đề trong file mẫu, các tiêu đề được nhận diện (đã bỏ dấu), bắt buộc phải có cột.
type column struct {
	key      string
	title    string
	aliases  []string
	required bool
	numeric  bool
	note     string
}

var columns = map[string][]column{
	KindProducts: {
		{"code", "Mã hàng", []string{"ma hang", "ma", "ma vthh", "ma san pham"}, true, false, "Bắt buộc. Trùng mã đã có ⇒ cập nhật mặt hàng đó."},
		{"name", "Tên hàng", []string{"ten hang", "ten", "ten vthh", "ten san pham"}, true, false, "Bắt buộc với mã mới; để trống khi cập nhật ⇒ giữ tên cũ."},
		{"unit", "ĐVT", []string{"dvt", "don vi tinh", "don vi"}, false, false, "Bắt buộc với mã mới."},
		{"group", "Nhóm VTHH", []string{"nhom vthh", "nhom", "nhom hang"}, false, false, "Mã hoặc tên nhóm; chưa có ⇒ tự tạo nhóm mới."},
		{"sale_price", "Giá bán", []string{"gia ban"}, false, true, "Số, ví dụ 1.500.000 hoặc 1500000."},
		{"purchase_price", "Giá mua", []string{"gia mua", "gia nhap"}, false, true, "Số. Bỏ qua nếu bạn không có quyền xem giá mua."},
	},
	KindPartners: {
		{"code", "Mã đối tác", []string{"ma doi tac", "ma", "ma kh", "ma ncc", "ma khach hang"}, true, false, "Bắt buộc. Trùng mã đã có ⇒ cập nhật."},
		{"name", "Tên đối tác", []string{"ten doi tac", "ten", "ten khach hang", "ten kh"}, true, false, "Bắt buộc với mã mới."},
		{"is_customer", "Là KH", []string{"la kh", "la khach hang", "khach hang", "kh"}, false, false, "x / có / 1 = là khách hàng."},
		{"is_supplier", "Là NCC", []string{"la ncc", "la nha cung cap", "nha cung cap", "ncc"}, false, false, "x / có / 1 = là nhà cung cấp. Đối tác mới phải là KH hoặc NCC."},
		{"address", "Địa chỉ", []string{"dia chi"}, false, false, ""},
		{"phone", "Điện thoại", []string{"dien thoai", "dt", "so dien thoai", "sdt"}, false, false, ""},
		{"tax_code", "MST", []string{"mst", "ma so thue"}, false, false, ""},
	},
	KindOpeningStock: {
		{"product", "Mã hàng", []string{"ma hang", "ma vthh"}, true, false, "Bắt buộc, phải có trong danh mục (hàng hóa, không phải dịch vụ)."},
		{"warehouse", "Mã kho", []string{"ma kho", "kho"}, true, false, "Bắt buộc, phải có trong danh mục kho."},
		{"qty", "Số lượng", []string{"so luong", "sl"}, true, true, "Bắt buộc, > 0. Ví dụ 2,5 hoặc 1.500."},
		{"price", "Đơn giá", []string{"don gia", "gia", "gia von"}, false, true, "Để trống ⇒ giá mua mặc định của mặt hàng."},
	},
	KindOpeningDebt: {
		{"partner", "Mã đối tác", []string{"ma doi tac", "ma", "ma kh", "ma ncc"}, true, false, "Bắt buộc, phải có trong danh mục."},
		{"receivable", "Phải thu", []string{"phai thu", "no phai thu", "cong no phai thu"}, false, true, "Nợ phải thu đầu kỳ (thay số cũ). Ô trống ⇒ 0. Không có cột ⇒ giữ số cũ."},
		{"payable", "Phải trả", []string{"phai tra", "no phai tra", "cong no phai tra"}, false, true, "Nợ phải trả đầu kỳ (thay số cũ). Ô trống ⇒ 0. Không có cột ⇒ giữ số cũ."},
	},
}

// ValidKind kiểm tra loại nhập.
func ValidKind(k string) bool { _, ok := columns[k]; return ok }

// RowError là lỗi một ô / một dòng.
type RowError struct {
	Row     int    `json:"row"`
	Column  string `json:"column"`
	Message string `json:"message"`
}

// DocRef là phiếu tồn đầu kỳ tạm được tạo.
type DocRef struct {
	ID            int64  `json:"id"`
	DraftNo       string `json:"draft_no"`
	WarehouseID   int64  `json:"warehouse_id"`
	WarehouseCode string `json:"warehouse_code"`
	Lines         int    `json:"lines"`
}

// Result là kết quả thử / nhập.
type Result struct {
	Kind      string     `json:"kind"`
	DryRun    bool       `json:"dry_run"`
	Rows      int        `json:"rows"`
	Creates   int        `json:"creates"`
	Updates   int        `json:"updates"`
	Errors    []RowError `json:"errors"`
	Documents []DocRef   `json:"documents,omitempty"`
	Notes     []string   `json:"notes,omitempty"`
}

// Options là tham số nhập.
type Options struct {
	DryRun  bool
	Date    util.Date // ngày phiếu tồn đầu kỳ
	UserID  int64
	CanCost bool // có quyền xem giá mua (không ⇒ bỏ qua cột Giá mua)
}

// ---------- Đọc file ----------

type sheetData struct {
	headerRow int
	colIdx    map[string]int // key → chỉ số cột (0-based)
	present   map[string]bool
	rows      []dataRow
}

type dataRow struct {
	num   int // số dòng Excel (1-based)
	cells map[string]cell
}

type cell struct {
	text    string
	numeric bool // ô kiểu số trong Excel (không phải chuỗi)
}

var nonAlnum = regexp.MustCompile(`[^a-z0-9 ]+`)

func normHeader(s string) string {
	f := util.Fold(s)
	f = nonAlnum.ReplaceAllString(f, " ")
	return strings.Join(strings.Fields(f), " ")
}

func readSheet(data []byte, kind string) (*sheetData, error) {
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, apperr.ValidationField("file", "Không đọc được file Excel (.xlsx). Vui lòng lưu lại dưới dạng Excel Workbook rồi thử lại.")
	}
	defer f.Close()
	sheet := ""
	for _, name := range f.GetSheetList() {
		if util.Fold(name) != "huong dan" {
			sheet = name
			break
		}
	}
	if sheet == "" {
		return nil, apperr.ValidationField("file", "File không có trang dữ liệu")
	}
	rows, err := f.Rows(sheet)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols := columns[kind]
	sd := &sheetData{}
	rowNum := 0
	for rows.Next() {
		rowNum++
		vals, err := rows.Columns(excelize.Options{RawCellValue: true})
		if err != nil {
			return nil, apperr.ValidationField("file", "File Excel bị lỗi ở dòng "+fmt.Sprint(rowNum))
		}
		if sd.colIdx == nil {
			if rowNum > 30 {
				break
			}
			idx := map[string]int{}
			for i, v := range vals {
				h := normHeader(v)
				if h == "" {
					continue
				}
				for _, c := range cols {
					if _, done := idx[c.key]; done {
						continue
					}
					for _, a := range c.aliases {
						if h == a {
							idx[c.key] = i
							break
						}
					}
				}
			}
			ok := true
			for _, c := range cols {
				if _, has := idx[c.key]; c.required && !has {
					ok = false
				}
			}
			if ok && len(idx) > 0 {
				sd.colIdx, sd.headerRow = idx, rowNum
				sd.present = map[string]bool{}
				for k := range idx {
					sd.present[k] = true
				}
			}
			continue
		}
		dr := dataRow{num: rowNum, cells: map[string]cell{}}
		blank := true
		for key, i := range sd.colIdx {
			if i >= len(vals) {
				continue
			}
			t := strings.TrimSpace(vals[i])
			if t == "" {
				continue
			}
			blank = false
			c := cell{text: t}
			if colByKey(kind, key).numeric {
				axis, _ := excelize.CoordinatesToCellName(i+1, rowNum)
				ct, _ := f.GetCellType(sheet, axis)
				c.numeric = ct != excelize.CellTypeSharedString && ct != excelize.CellTypeInlineString && ct != excelize.CellTypeFormula
			}
			dr.cells[key] = c
		}
		if blank {
			continue
		}
		if len(sd.rows) >= MaxRows {
			return nil, apperr.ValidationField("file", fmt.Sprintf("File có quá %d dòng dữ liệu. Vui lòng chia nhỏ file.", MaxRows))
		}
		sd.rows = append(sd.rows, dr)
	}
	if sd.colIdx == nil {
		var need []string
		for _, c := range cols {
			if c.required {
				need = append(need, "\""+c.title+"\"")
			}
		}
		return nil, apperr.ValidationField("file", "Không tìm thấy dòng tiêu đề cột (cần có các cột "+strings.Join(need, ", ")+"). Hãy dùng file mẫu.")
	}
	return sd, nil
}

func colByKey(kind, key string) column {
	for _, c := range columns[kind] {
		if c.key == key {
			return c
		}
	}
	return column{}
}

var thousandsDot = regexp.MustCompile(`^-?\d{1,3}(\.\d{3})+$`)
var thousandsDotComma = regexp.MustCompile(`^-?\d{1,3}(\.\d{3})*,\d+$`)

// ParseNumber đọc số kiểu Việt Nam: "1.500.000" = 1500000; "2,5" = 2,5; "1.500,75" = 1500,75; "2.5" = 2,5.
// Ô kiểu số của Excel đọc thẳng giá trị gốc.
func ParseNumber(s string, numericCell bool) (decimal.Decimal, error) {
	s = strings.TrimSpace(s)
	s = strings.NewReplacer(" ", "", " ", "", "đ", "", "₫", "", "VND", "", "vnd", "").Replace(s)
	if numericCell {
		return decimal.NewFromString(s)
	}
	switch {
	case thousandsDotComma.MatchString(s):
		s = strings.ReplaceAll(s, ".", "")
		s = strings.ReplaceAll(s, ",", ".")
	case thousandsDot.MatchString(s):
		s = strings.ReplaceAll(s, ".", "")
	case strings.Contains(s, ","):
		if strings.Count(s, ",") == 1 && !strings.Contains(s, ".") {
			s = strings.ReplaceAll(s, ",", ".")
		} else {
			return decimal.Zero, fmt.Errorf("số không hợp lệ")
		}
	}
	return decimal.NewFromString(s)
}

func parseBool(s string) (bool, error) {
	switch util.Fold(strings.TrimSpace(s)) {
	case "x", "co", "c", "1", "true", "yes", "y", "v", "dung", "la":
		return true, nil
	case "", "khong", "k", "0", "false", "no", "n", "-":
		return false, nil
	}
	return false, fmt.Errorf("không hiểu %q (dùng x / có hoặc để trống)", s)
}

// ---------- Chạy ----------

// Run thử hoặc nhập file.
func Run(ctx context.Context, pool *pgxpool.Pool, kind string, data []byte, opt Options) (*Result, error) {
	sd, err := readSheet(data, kind)
	if err != nil {
		return nil, err
	}
	res := &Result{Kind: kind, DryRun: opt.DryRun, Rows: len(sd.rows), Errors: []RowError{}}
	err = db.InTx(ctx, pool, func(tx pgx.Tx) error {
		var apply func() error
		var err error
		switch kind {
		case KindProducts:
			apply, err = planProducts(ctx, tx, sd, res, opt)
		case KindPartners:
			apply, err = planPartners(ctx, tx, sd, res, opt)
		case KindOpeningStock:
			apply, err = planOpeningStock(ctx, tx, sd, res, opt)
		case KindOpeningDebt:
			apply, err = planOpeningDebt(ctx, tx, sd, res, opt)
		}
		if err != nil {
			return err
		}
		if opt.DryRun || len(res.Errors) > 0 {
			return errRollback
		}
		if err := apply(); err != nil {
			return err
		}
		return db.Audit(ctx, tx, opt.UserID, "import", 0, "imported", nil,
			map[string]any{"kind": kind, "rows": res.Rows, "creates": res.Creates, "updates": res.Updates, "documents": res.Documents})
	})
	if err == errRollback {
		err = nil
	}
	if err != nil {
		return nil, err
	}
	if !opt.DryRun && len(res.Errors) > 0 {
		return res, apperr.New(http.StatusUnprocessableEntity, apperr.CodeImportInvalid,
			fmt.Sprintf("File còn %d lỗi, chưa nhập gì. Sửa các lỗi rồi nhập lại.", len(res.Errors)), res)
	}
	return res, nil
}

type rollback struct{}

func (rollback) Error() string { return "rollback" }

var errRollback error = rollback{}

func addErr(res *Result, row int, kind, key, msg string) {
	title := ""
	if key != "" {
		title = colByKey(kind, key).title
	}
	res.Errors = append(res.Errors, RowError{Row: row, Column: title, Message: msg})
}

func num(res *Result, kind string, r dataRow, key string, allowNeg bool) (*decimal.Decimal, bool) {
	c, ok := r.cells[key]
	if !ok {
		return nil, true
	}
	d, err := ParseNumber(c.text, c.numeric)
	if err != nil {
		addErr(res, r.num, kind, key, fmt.Sprintf("\"%s\" không phải là số", c.text))
		return nil, false
	}
	if !allowNeg && d.IsNegative() {
		addErr(res, r.num, kind, key, "Không được âm")
		return nil, false
	}
	if d.Abs().GreaterThanOrEqual(decimal.New(1, 14)) {
		addErr(res, r.num, kind, key, "Số quá lớn")
		return nil, false
	}
	return &d, true
}

func text(r dataRow, key string) string { return r.cells[key].text }

// batchExec gửi nhiều câu lệnh theo lô (nhanh với hàng chục nghìn dòng).
type batcher struct {
	ctx context.Context
	tx  pgx.Tx
	b   *pgx.Batch
}

func newBatcher(ctx context.Context, tx pgx.Tx) *batcher {
	return &batcher{ctx: ctx, tx: tx, b: &pgx.Batch{}}
}

func (b *batcher) add(sql string, args ...any) error {
	b.b.Queue(sql, args...)
	if b.b.Len() >= 1000 {
		return b.flush()
	}
	return nil
}

func (b *batcher) flush() error {
	if b.b.Len() == 0 {
		return nil
	}
	br := b.tx.SendBatch(b.ctx, b.b)
	for i := 0; i < b.b.Len(); i++ {
		if _, err := br.Exec(); err != nil {
			br.Close()
			return err
		}
	}
	b.b = &pgx.Batch{}
	return br.Close()
}

// ---------- Hàng hóa ----------

func planProducts(ctx context.Context, tx pgx.Tx, sd *sheetData, res *Result, opt Options) (func() error, error) {
	type prod struct {
		id         int64
		isService  bool
		name, unit string
		groupID    *int64
		sale, buy  decimal.Decimal
	}
	existing := map[string]*prod{}
	rows, err := tx.Query(ctx, `SELECT id, upper(code), is_service, name, unit, group_id, sale_price, purchase_price FROM products`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p prod
		var code string
		if err := rows.Scan(&p.id, &code, &p.isService, &p.name, &p.unit, &p.groupID, &p.sale, &p.buy); err != nil {
			rows.Close()
			return nil, err
		}
		existing[code] = &p
	}
	rows.Close()
	groups := map[string]int64{} // upper(code) và fold(name) → id
	grows, err := tx.Query(ctx, `SELECT id, upper(code), name FROM product_groups`)
	if err != nil {
		return nil, err
	}
	for grows.Next() {
		var id int64
		var code, name string
		if err := grows.Scan(&id, &code, &name); err != nil {
			grows.Close()
			return nil, err
		}
		groups["c:"+code] = id
		groups["n:"+util.Fold(name)] = id
	}
	grows.Close()
	if sd.present["purchase_price"] && !opt.CanCost {
		res.Notes = append(res.Notes, "Cột Giá mua bị bỏ qua vì bạn không có quyền xem giá mua.")
	}
	type plan struct {
		code, name, unit, group string
		existing                *prod
		sale, buy               *decimal.Decimal
	}
	var plans []plan
	newGroups := map[string]string{} // khóa → tên
	seen := map[string]int{}
	k := KindProducts
	for _, r := range sd.rows {
		code := text(r, "code")
		if code == "" {
			addErr(res, r.num, k, "code", "Thiếu mã hàng")
			continue
		}
		uc := strings.ToUpper(code)
		if first, dup := seen[uc]; dup {
			addErr(res, r.num, k, "code", fmt.Sprintf("Mã %s trùng với dòng %d trong file", code, first))
			continue
		}
		seen[uc] = r.num
		if len(code) > 50 {
			addErr(res, r.num, k, "code", "Mã quá dài (tối đa 50 ký tự)")
			continue
		}
		if uc == "DICHVU" || uc == "DV" {
			addErr(res, r.num, k, "code", "Mã "+code+" là mã Dịch vụ của hệ thống, không nhập được")
			continue
		}
		p := plan{code: code, name: text(r, "name"), unit: text(r, "unit"), group: text(r, "group"), existing: existing[uc]}
		if p.existing != nil && p.existing.isService {
			addErr(res, r.num, k, "code", "Mã "+code+" đang là dịch vụ, không cập nhật bằng file hàng hóa được")
			continue
		}
		ok := true
		if p.existing == nil {
			if p.name == "" {
				addErr(res, r.num, k, "name", "Mã mới phải có tên hàng")
				ok = false
			}
			if p.unit == "" {
				addErr(res, r.num, k, "unit", "Mã mới phải có ĐVT")
				ok = false
			}
		}
		var good bool
		if p.sale, good = num(res, k, r, "sale_price", false); !good {
			ok = false
		}
		if opt.CanCost {
			if p.buy, good = num(res, k, r, "purchase_price", false); !good {
				ok = false
			}
		}
		// Giá lưu 2 chữ số thập phân (như nhập trên phiếu).
		for _, pp := range []**decimal.Decimal{&p.sale, &p.buy} {
			if *pp != nil {
				v := (*pp).Round(2)
				*pp = &v
			}
		}
		if p.group != "" {
			if _, has := groups["c:"+strings.ToUpper(p.group)]; !has {
				if _, has := groups["n:"+util.Fold(p.group)]; !has {
					if len(p.group) > 50 {
						addErr(res, r.num, k, "group", "Tên nhóm mới quá dài (tối đa 50 ký tự)")
						ok = false
					} else {
						newGroups[util.Fold(p.group)] = p.group
					}
				}
			}
		}
		if !ok {
			continue
		}
		if p.existing == nil {
			res.Creates++
		} else {
			res.Updates++
		}
		plans = append(plans, p)
	}
	if len(newGroups) > 0 {
		res.Notes = append(res.Notes, fmt.Sprintf("Sẽ tạo %d nhóm VTHH mới.", len(newGroups)))
	}
	return func() error {
		for key, name := range newGroups {
			var id int64
			if err := tx.QueryRow(ctx, `INSERT INTO product_groups(code, name) VALUES ($1, $2) RETURNING id`, name, name).Scan(&id); err != nil {
				return apperr.Validation("Không tạo được nhóm %q (trùng mã nhóm?)", name)
			}
			groups["n:"+key] = id
		}
		b := newBatcher(ctx, tx)
		for _, p := range plans {
			var gid *int64
			if p.group != "" {
				if id, ok := groups["c:"+strings.ToUpper(p.group)]; ok {
					gid = &id
				} else if id, ok := groups["n:"+util.Fold(p.group)]; ok {
					gid = &id
				}
			}
			if p.existing == nil {
				sale, buy := decimal.Zero, decimal.Zero
				if p.sale != nil {
					sale = *p.sale
				}
				if p.buy != nil {
					buy = *p.buy
				}
				if err := b.add(`INSERT INTO products(code,name,unit,group_id,sale_price,purchase_price,search_key) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
					p.code, p.name, p.unit, gid, sale, buy, util.Fold(p.code+" "+p.name)); err != nil {
					return err
				}
				continue
			}
			e := p.existing
			name, unit, sale, buy, g := e.name, e.unit, e.sale, e.buy, e.groupID
			if p.name != "" {
				name = p.name
			}
			if p.unit != "" {
				unit = p.unit
			}
			if p.sale != nil {
				sale = *p.sale
			}
			if p.buy != nil {
				buy = *p.buy
			}
			if gid != nil {
				g = gid
			}
			if err := b.add(`UPDATE products SET name=$2, unit=$3, group_id=$4, sale_price=$5, purchase_price=$6, search_key=$7 WHERE id=$1`,
				e.id, name, unit, g, sale, buy, util.Fold(p.code+" "+name)); err != nil {
				return err
			}
		}
		return b.flush()
	}, nil
}

// ---------- Đối tác ----------

func planPartners(ctx context.Context, tx pgx.Tx, sd *sheetData, res *Result, opt Options) (func() error, error) {
	type partner struct {
		id                        int64
		name, address, phone, tax string
		code                      string
		isCustomer, isSupplier    bool
	}
	existing := map[string]*partner{}
	rows, err := tx.Query(ctx, `SELECT id, code, name, address, phone, tax_code, is_customer, is_supplier FROM partners`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p partner
		if err := rows.Scan(&p.id, &p.code, &p.name, &p.address, &p.phone, &p.tax, &p.isCustomer, &p.isSupplier); err != nil {
			rows.Close()
			return nil, err
		}
		existing[strings.ToUpper(p.code)] = &p
	}
	rows.Close()
	var plans []partner
	var isNew []bool
	seen := map[string]int{}
	k := KindPartners
	for _, r := range sd.rows {
		code := text(r, "code")
		if code == "" {
			addErr(res, r.num, k, "code", "Thiếu mã đối tác")
			continue
		}
		uc := strings.ToUpper(code)
		if first, dup := seen[uc]; dup {
			addErr(res, r.num, k, "code", fmt.Sprintf("Mã %s trùng với dòng %d trong file", code, first))
			continue
		}
		seen[uc] = r.num
		if len(code) > 50 {
			addErr(res, r.num, k, "code", "Mã quá dài (tối đa 50 ký tự)")
			continue
		}
		ok := true
		flag := func(key string, cur bool) bool {
			c, has := r.cells[key]
			if !has {
				return cur
			}
			v, err := parseBool(c.text)
			if err != nil {
				addErr(res, r.num, k, key, err.Error())
				ok = false
			}
			return v
		}
		e := existing[uc]
		p := partner{code: code}
		if e != nil {
			p = *e
		}
		p.isCustomer = flag("is_customer", p.isCustomer)
		p.isSupplier = flag("is_supplier", p.isSupplier)
		for key, dst := range map[string]*string{"name": &p.name, "address": &p.address, "phone": &p.phone, "tax_code": &p.tax} {
			if v := text(r, key); v != "" {
				*dst = v
			}
		}
		if p.name == "" {
			addErr(res, r.num, k, "name", "Đối tác mới phải có tên")
			ok = false
		}
		if ok && !p.isCustomer && !p.isSupplier {
			addErr(res, r.num, k, "is_customer", "Đối tác phải là Khách hàng hoặc Nhà cung cấp (đánh x vào cột Là KH / Là NCC)")
			ok = false
		}
		if !ok {
			continue
		}
		if e == nil {
			res.Creates++
		} else {
			res.Updates++
		}
		plans = append(plans, p)
		isNew = append(isNew, e == nil)
	}
	return func() error {
		b := newBatcher(ctx, tx)
		for i, p := range plans {
			key := util.Fold(p.code + " " + p.name + " " + p.phone + " " + p.tax)
			if isNew[i] {
				if err := b.add(`INSERT INTO partners(code,name,address,phone,tax_code,is_customer,is_supplier,search_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
					p.code, p.name, p.address, p.phone, p.tax, p.isCustomer, p.isSupplier, key); err != nil {
					return err
				}
				continue
			}
			if err := b.add(`UPDATE partners SET name=$2, address=$3, phone=$4, tax_code=$5, is_customer=$6, is_supplier=$7, search_key=$8 WHERE id=$1`,
				p.id, p.name, p.address, p.phone, p.tax, p.isCustomer, p.isSupplier, key); err != nil {
				return err
			}
		}
		return b.flush()
	}, nil
}

// ---------- Tồn đầu kỳ ----------

func planOpeningStock(ctx context.Context, tx pgx.Tx, sd *sheetData, res *Result, opt Options) (func() error, error) {
	if opt.Date.Empty() {
		opt.Date = util.Today()
	}
	if opt.Date.Year() < 2000 || opt.Date.Year() > 2100 {
		return nil, apperr.ValidationField("date", "Ngày phiếu tồn đầu kỳ không hợp lệ")
	}
	st, err := ext.Load(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err := st.CheckLock(opt.Date); err != nil {
		return nil, err
	}
	type prod struct {
		id      int64
		unit    string
		service bool
		active  bool
		buy     decimal.Decimal
		code    string
	}
	prods := map[string]*prod{}
	rows, err := tx.Query(ctx, `SELECT id, code, unit, is_service, active, purchase_price FROM products`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p prod
		if err := rows.Scan(&p.id, &p.code, &p.unit, &p.service, &p.active, &p.buy); err != nil {
			rows.Close()
			return nil, err
		}
		prods[strings.ToUpper(p.code)] = &p
	}
	rows.Close()
	type wh struct {
		id     int64
		code   string
		active bool
	}
	whs := map[string]*wh{}
	wrows, err := tx.Query(ctx, `SELECT id, code, active FROM warehouses`)
	if err != nil {
		return nil, err
	}
	for wrows.Next() {
		var w wh
		if err := wrows.Scan(&w.id, &w.code, &w.active); err != nil {
			wrows.Close()
			return nil, err
		}
		whs[strings.ToUpper(w.code)] = &w
	}
	wrows.Close()
	type line struct {
		p     *prod
		qty   decimal.Decimal
		price decimal.Decimal
	}
	byWh := map[int64][]line{}
	var whOrder []*wh
	seen := map[string]int{}
	k := KindOpeningStock
	for _, r := range sd.rows {
		ok := true
		p := prods[strings.ToUpper(text(r, "product"))]
		switch {
		case text(r, "product") == "":
			addErr(res, r.num, k, "product", "Thiếu mã hàng")
			ok = false
		case p == nil:
			addErr(res, r.num, k, "product", "Mã hàng "+text(r, "product")+" chưa có trong danh mục")
			ok = false
		case p.service:
			addErr(res, r.num, k, "product", "Mã "+p.code+" là dịch vụ, không có tồn kho")
			ok = false
		case !p.active:
			addErr(res, r.num, k, "product", "Mã "+p.code+" đã ngừng sử dụng")
			ok = false
		}
		w := whs[strings.ToUpper(text(r, "warehouse"))]
		switch {
		case text(r, "warehouse") == "":
			addErr(res, r.num, k, "warehouse", "Thiếu mã kho")
			ok = false
		case w == nil:
			addErr(res, r.num, k, "warehouse", "Mã kho "+text(r, "warehouse")+" chưa có trong danh mục")
			ok = false
		case !w.active:
			addErr(res, r.num, k, "warehouse", "Kho "+w.code+" đã ngừng sử dụng")
			ok = false
		}
		qty, good := num(res, k, r, "qty", false)
		if !good {
			ok = false
		} else if qty == nil || !qty.Round(3).IsPositive() {
			addErr(res, r.num, k, "qty", "Số lượng phải lớn hơn 0")
			ok = false
		}
		price, good := num(res, k, r, "price", false)
		if !good {
			ok = false
		}
		if ok {
			key := strings.ToUpper(p.code) + "|" + strings.ToUpper(w.code)
			if first, dup := seen[key]; dup {
				addErr(res, r.num, k, "product", fmt.Sprintf("Mã %s tại kho %s trùng với dòng %d trong file", p.code, w.code, first))
				ok = false
			} else {
				seen[key] = r.num
			}
		}
		if !ok {
			continue
		}
		pr := p.buy
		if price != nil {
			pr = price.Round(2)
		}
		if _, has := byWh[w.id]; !has {
			whOrder = append(whOrder, w)
		}
		byWh[w.id] = append(byWh[w.id], line{p: p, qty: qty.Round(3), price: pr})
		res.Creates++
	}
	return func() error {
		for _, w := range whOrder {
			lines := byWh[w.id]
			for start := 0; start < len(lines); start += maxLinesInDoc {
				end := start + maxLinesInDoc
				if end > len(lines) {
					end = len(lines)
				}
				chunk := lines[start:end]
				n, err := db.NextNumber(ctx, tx, "TAM")
				if err != nil {
					return err
				}
				draftNo := fmt.Sprintf("TAM%06d", n)
				total := decimal.Zero
				for _, l := range chunk {
					total = total.Add(util.RoundVND(l.qty.Mul(l.price)))
				}
				var id int64
				if err := tx.QueryRow(ctx, `INSERT INTO documents(doc_type,draft_no,doc_date,status,warehouse_id,note,total_amount,version,created_by,updated_by)
					VALUES ('opening',$1,$2,'draft',$3,$4,$5,1,$6,$6) RETURNING id`,
					draftNo, opt.Date, w.id, "Nhập từ Excel", total, opt.UserID).Scan(&id); err != nil {
					return err
				}
				b := newBatcher(ctx, tx)
				for i, l := range chunk {
					if err := b.add(`INSERT INTO document_lines(document_id,line_no,product_id,unit,qty,unit_price,amount) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
						id, i+1, l.p.id, l.p.unit, l.qty, l.price, util.RoundVND(l.qty.Mul(l.price))); err != nil {
						return err
					}
				}
				if err := b.flush(); err != nil {
					return err
				}
				res.Documents = append(res.Documents, DocRef{ID: id, DraftNo: draftNo, WarehouseID: w.id, WarehouseCode: w.code, Lines: len(chunk)})
				if err := db.Audit(ctx, tx, opt.UserID, "document", id, "created", nil, map[string]any{"source": "import_excel", "draft_no": draftNo, "lines": len(chunk)}); err != nil {
					return err
				}
			}
		}
		return nil
	}, nil
}

// ---------- Công nợ đầu kỳ ----------

func planOpeningDebt(ctx context.Context, tx pgx.Tx, sd *sheetData, res *Result, opt Options) (func() error, error) {
	st, err := ext.Load(ctx, tx)
	if err != nil {
		return nil, err
	}
	if lock := st.LockDate(); lock != nil {
		return nil, ext.OpeningLockedErr(*lock)
	}
	ids := map[string]int64{}
	rows, err := tx.Query(ctx, `SELECT id, upper(code) FROM partners`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		var c string
		if err := rows.Scan(&id, &c); err != nil {
			rows.Close()
			return nil, err
		}
		ids[c] = id
	}
	rows.Close()
	if !sd.present["receivable"] && !sd.present["payable"] {
		return nil, apperr.ValidationField("file", "File phải có ít nhất một cột \"Phải thu\" hoặc \"Phải trả\"")
	}
	type plan struct {
		id       int64
		rec, pay *decimal.Decimal
	}
	var plans []plan
	seen := map[string]int{}
	k := KindOpeningDebt
	for _, r := range sd.rows {
		code := text(r, "partner")
		uc := strings.ToUpper(code)
		id, has := ids[uc]
		if code == "" {
			addErr(res, r.num, k, "partner", "Thiếu mã đối tác")
			continue
		}
		if !has {
			addErr(res, r.num, k, "partner", "Mã đối tác "+code+" chưa có trong danh mục")
			continue
		}
		if first, dup := seen[uc]; dup {
			addErr(res, r.num, k, "partner", fmt.Sprintf("Mã %s trùng với dòng %d trong file", code, first))
			continue
		}
		seen[uc] = r.num
		p := plan{id: id}
		ok := true
		for key, dst := range map[string]**decimal.Decimal{"receivable": &p.rec, "payable": &p.pay} {
			if !sd.present[key] {
				continue
			}
			v, good := num(res, k, r, key, true)
			if !good {
				ok = false
				continue
			}
			if v == nil {
				z := decimal.Zero
				v = &z
			}
			r2 := v.Round(2)
			*dst = &r2
		}
		if !ok {
			continue
		}
		res.Updates++
		plans = append(plans, p)
	}
	return func() error {
		b := newBatcher(ctx, tx)
		for _, p := range plans {
			if err := b.add(`UPDATE partners SET opening_receivable=COALESCE($2, opening_receivable), opening_payable=COALESCE($3, opening_payable) WHERE id=$1`,
				p.id, p.rec, p.pay); err != nil {
				return err
			}
		}
		return b.flush()
	}, nil
}

// ---------- File mẫu ----------

// Template tạo file mẫu: trang dữ liệu (tiêu đề + 2 dòng ví dụ) và trang "Hướng dẫn".
// Ví dụ tồn đầu / công nợ đầu dùng mã có thật trong danh mục để tải về rồi nhập thử ngay được.
func Template(ctx context.Context, q db.Q, kind string) ([]byte, error) {
	cols := columns[kind]
	examples, err := exampleRows(ctx, q, kind)
	if err != nil {
		return nil, err
	}
	f := excelize.NewFile()
	defer f.Close()
	data := "Dữ liệu"
	_ = f.SetSheetName("Sheet1", data)
	head, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Family: "Times New Roman"},
		Fill: excelize.Fill{Type: "pattern", Color: []string{"D9E1F2"}, Pattern: 1}})
	for i, c := range cols {
		cellName, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellStr(data, cellName, c.title)
		_ = f.SetCellStyle(data, cellName, cellName, head)
		col, _ := excelize.ColumnNumberToName(i + 1)
		w := 16.0
		if c.key == "name" || c.key == "address" {
			w = 36
		}
		_ = f.SetColWidth(data, col, col, w)
	}
	for ri, ex := range examples {
		for i, c := range cols {
			cellName, _ := excelize.CoordinatesToCellName(i+1, ri+2)
			v := ex[c.key]
			if v == "" {
				continue
			}
			if c.numeric {
				_ = f.SetCellDefault(data, cellName, v) // ô số
			} else {
				_ = f.SetCellStr(data, cellName, v)
			}
		}
	}
	guide := "Hướng dẫn"
	_, _ = f.NewSheet(guide)
	lines := []string{
		"HƯỚNG DẪN NHẬP " + strings.ToUpper(KindNames[kind]) + " TỪ EXCEL",
		"",
		"• Giữ nguyên dòng tiêu đề (tên cột); thứ tự cột không quan trọng, có thể bỏ các cột không bắt buộc.",
		"• Xóa 2 dòng ví dụ rồi điền dữ liệu từ dòng 2. Dòng trống bị bỏ qua. Tối đa 20.000 dòng, file ≤ 10 MB.",
		"• Số viết kiểu Việt Nam: 1.500.000 (dấu chấm ngăn nghìn), 2,5 (dấu phẩy thập phân); hoặc ô kiểu số của Excel.",
		"• Bấm \"Kiểm tra\" để xem trước (không ghi gì). Khi không còn lỗi, bấm \"Nhập\": tất cả được ghi cùng lúc, có lỗi thì không ghi gì.",
		"",
		"CÁC CỘT:",
	}
	for _, c := range cols {
		req := ""
		if c.required {
			req = " (bắt buộc)"
		}
		lines = append(lines, "• "+c.title+req+": "+c.note)
	}
	switch kind {
	case KindOpeningStock:
		lines = append(lines, "", "Kết quả: mỗi kho một phiếu Tồn đầu kỳ TẠM (tối đa 1000 dòng mỗi phiếu), ngày do bạn chọn khi nhập. Xem lại rồi bấm Ghi sổ.")
	case KindOpeningDebt:
		lines = append(lines, "", "Nhập lại file thì số đầu kỳ của các đối tác có trong file được THAY bằng số mới (không cộng dồn).")
	default:
		lines = append(lines, "", "Mã đã có ⇒ cập nhật theo các ô có dữ liệu (ô trống giữ nguyên). Không xóa mã nào.")
	}
	for i, l := range lines {
		cellName, _ := excelize.CoordinatesToCellName(1, i+1)
		_ = f.SetCellStr(guide, cellName, l)
	}
	_ = f.SetColWidth(guide, "A", "A", 120)
	f.SetActiveSheet(0)
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func exampleRows(ctx context.Context, q db.Q, kind string) ([]map[string]string, error) {
	switch kind {
	case KindProducts:
		return []map[string]string{
			{"code": "VD-QH32", "name": "Que hàn mẫu 3.2mm (ví dụ)", "unit": "Hộp", "group": "Que hàn", "sale_price": "185000", "purchase_price": "150000"},
			{"code": "VD-BEC08", "name": "Béc hàn mẫu 0.8mm (ví dụ)", "unit": "Cái", "group": "Béc hàn", "sale_price": "13000", "purchase_price": "8500"},
		}, nil
	case KindPartners:
		return []map[string]string{
			{"code": "VD-KH01", "name": "Khách hàng mẫu (ví dụ)", "is_customer": "x", "address": "12 Lê Lợi, Q.1", "phone": "0909 000 111"},
			{"code": "VD-NCC01", "name": "Nhà cung cấp mẫu (ví dụ)", "is_supplier": "x", "tax_code": "0300000000"},
		}, nil
	case KindOpeningStock:
		var whCode string
		_ = q.QueryRow(ctx, `SELECT code FROM warehouses WHERE active ORDER BY code LIMIT 1`).Scan(&whCode)
		if whCode == "" {
			whCode = "KHO1"
		}
		rows, err := q.Query(ctx, `SELECT code FROM products WHERE active AND NOT is_service ORDER BY code LIMIT 2`)
		if err != nil {
			return nil, err
		}
		codes, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return nil, err
		}
		for len(codes) < 2 {
			codes = append(codes, fmt.Sprintf("MA-HANG-%d", len(codes)+1))
		}
		return []map[string]string{
			{"product": codes[0], "warehouse": whCode, "qty": "10", "price": "150000"},
			{"product": codes[1], "warehouse": whCode, "qty": "2.5"},
		}, nil
	case KindOpeningDebt:
		rows, err := q.Query(ctx, `SELECT code FROM partners WHERE active ORDER BY code LIMIT 2`)
		if err != nil {
			return nil, err
		}
		codes, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return nil, err
		}
		for len(codes) < 2 {
			codes = append(codes, fmt.Sprintf("MA-DOI-TAC-%d", len(codes)+1))
		}
		return []map[string]string{
			{"partner": codes[0], "receivable": "2000000", "payable": "0"},
			{"partner": codes[1], "receivable": "0", "payable": "1500000"},
		}, nil
	}
	return nil, nil
}
