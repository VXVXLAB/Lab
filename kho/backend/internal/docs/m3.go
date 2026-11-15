package docs

import (
	"context"
	"strings"

	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/catalog"
	"kho/internal/db"
	"kho/internal/ext"
	"kho/internal/stock"
	"kho/internal/util"
	"kho/internal/vat"
)

// Bản mở rộng đợt M3 trên chứng từ: C9 kiểm kê, C10 quy đổi đơn vị, C11 thuế GTGT.

// feats là trạng thái các tính năng M3 dùng khi kiểm tra / đọc chứng từ.
type feats struct {
	unit, vat, stocktake bool
	defVat               string // thuế suất mặc định chung (mã), "" = không đặt
}

func loadFeats(ctx context.Context, q db.Q) (feats, error) {
	st, err := ext.Load(ctx, q)
	if err != nil {
		return feats{}, err
	}
	f := feats{unit: st.On(ext.FUnitConversion), vat: st.On(ext.FVAT), stocktake: st.On(ext.FStocktake)}
	if f.vat {
		if f.defVat, err = vat.DefaultCode(ctx, q); err != nil {
			return f, err
		}
	}
	return f, nil
}

// IsVATType: loại chứng từ có thuế GTGT (mua, bán, trả hàng).
func IsVATType(t string) bool {
	return t == TypePurchase || t == TypeSale || t == TypeSaleReturn || t == TypePurchaseReturn
}

var one = decimal.NewFromInt(1)

// validType kiểm tra loại chứng từ; kiểm kê chỉ hợp lệ khi tính năng bật (tắt ⇒ đúng thông báo của bản chuẩn).
func validType(t string, f feats) bool {
	if t == TypeStocktake {
		return f.stocktake
	}
	_, ok := TypeNames[t]
	return ok
}

func typeErr(f feats) error {
	if f.stocktake {
		return apperr.ValidationField("doc_type", "Loại chứng từ không hợp lệ (purchase, sale, sale_return, purchase_return, transfer, opening, stocktake)")
	}
	return apperr.ValidationField("doc_type", "Loại chứng từ không hợp lệ (purchase, sale, sale_return, purchase_return, transfer, opening)")
}

// oldLineOf trả dòng đang có của chính phiếu (cùng id và cùng mặt hàng) — dùng để giữ các trường máy khách cũ không gửi.
func oldLineOf(old *Document, id, productID int64) *Line {
	if old == nil || id == 0 {
		return nil
	}
	for i := range old.Lines {
		if old.Lines[i].ID == id && old.Lines[i].ProductID == productID {
			return &old.Lines[i]
		}
	}
	return nil
}

// resolveUnit chọn đơn vị và hệ số quy đổi của dòng (C10):
//   - dòng có id (cùng mặt hàng) không gửi unit, hoặc gửi đúng đơn vị đang lưu ⇒ giữ đơn vị + hệ số đang lưu
//     (khi tính năng tắt và hệ số = 1 thì như bản chuẩn: không gửi ⇒ đơn vị gốc);
//   - đơn vị trống / trùng đơn vị gốc ⇒ hệ số 1;
//   - tính năng bật: đơn vị phải là đơn vị quy đổi đã khai báo; tắt: chữ tự do, hệ số 1 (như bản chuẩn).
func resolveUnit(ctx context.Context, q db.Q, f feats, p *catalog.Product, li LineInput, ol *Line, i int) (string, decimal.Decimal, error) {
	if p.IsService {
		u := ""
		if li.Unit != nil {
			u = strings.TrimSpace(*li.Unit)
		}
		if u == "" {
			u = p.Unit
		}
		return u, one, nil
	}
	if ol != nil && (ol.factor.Cmp(one) != 0 || f.unit) {
		if li.Unit == nil {
			return ol.Unit, ol.factor, nil
		}
		if strings.EqualFold(strings.TrimSpace(*li.Unit), ol.Unit) {
			return ol.Unit, ol.factor, nil
		}
	}
	u := ""
	if li.Unit != nil {
		u = strings.TrimSpace(*li.Unit)
	}
	if u == "" {
		return p.Unit, one, nil
	}
	if strings.EqualFold(u, p.Unit) || !f.unit {
		return u, one, nil
	}
	name, factor, ok, err := catalog.FindUnit(ctx, q, p.ID, u)
	if err != nil {
		return "", one, err
	}
	if !ok {
		return "", one, lineErr(i, "unit", "đơn vị \""+u+"\" chưa được khai báo cho mã "+p.Code+" (đơn vị gốc "+p.Unit+"; khai báo ở Danh mục › Hàng hóa › Đơn vị quy đổi)")
	}
	return name, factor, nil
}

// resolveVAT chọn thuế suất của dòng (C11). Không gửi: dòng có id giữ thuế suất đang lưu (kể cả khi tính năng tắt — dữ
// liệu cũ vẫn đúng), dòng mới lấy mặc định của mặt hàng rồi mặc định chung (chỉ khi tính năng bật). Gửi một thuế suất
// khi tính năng tắt ⇒ 400 (trừ khi gửi lại đúng thuế suất đang lưu của dòng đó).
func resolveVAT(f feats, docType string, p *catalog.Product, li LineInput, ol *Line, i int) (*decimal.Decimal, error) {
	vatDoc := IsVATType(docType)
	if li.VatRate.Set {
		if li.VatRate.Val == nil {
			return nil, nil
		}
		r := *li.VatRate.Val
		if !vatDoc {
			return nil, lineErr(i, "vat_rate", "loại chứng từ này không có thuế GTGT")
		}
		if !vat.ValidRate(r) {
			return nil, lineErr(i, "vat_rate", "thuế suất phải là 0, 5, 8, 10 hoặc để trống (không thuế)")
		}
		if !f.vat && (ol == nil || ol.vatRate == nil || !ol.vatRate.Equal(r)) {
			return nil, lineErr(i, "vat_rate", "tính năng Thuế GTGT đang tắt, không đặt được thuế suất")
		}
		r = r.Round(2)
		return &r, nil
	}
	if ol != nil {
		return ol.vatRate, nil
	}
	if !f.vat || !vatDoc {
		return nil, nil
	}
	code := f.defVat
	if p.VatRate != nil && p.VatRate.Valid {
		code = p.VatRate.S
	}
	return vat.RateOf(code), nil
}

func (l pline) lineTotal() decimal.Decimal { return l.Amount.Add(l.Tax) }

func taxTotal(lines []pline) decimal.Decimal {
	t := decimal.Zero
	for _, l := range lines {
		t = t.Add(l.Tax)
	}
	return t
}

// bookQtys trả tồn sổ sách cuối ngày date tại kho của các mặt hàng, không gồm bút toán của chứng từ excludeDoc.
func bookQtys(ctx context.Context, q db.Q, warehouseID int64, date util.Date, productIDs []int64, excludeDoc int64) (map[int64]decimal.Decimal, error) {
	out := map[int64]decimal.Decimal{}
	if len(productIDs) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT product_id, sum(qty_in - qty_out) FROM stock_movements
		WHERE warehouse_id=$1 AND doc_date <= $2 AND product_id = ANY($3) AND document_id <> $4 GROUP BY product_id`,
		warehouseID, date, productIDs, excludeDoc)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var v decimal.Decimal
		if err := rows.Scan(&id, &v); err != nil {
			return nil, err
		}
		out[id] = v
	}
	return out, rows.Err()
}

// fillBook gán tồn sổ sách (đơn vị gốc) cho các dòng kiểm kê.
func fillBook(ctx context.Context, q db.Q, docID int64, h header, lines []pline) error {
	if h.DocType != TypeStocktake {
		return nil
	}
	ids := make([]int64, 0, len(lines))
	for _, l := range lines {
		ids = append(ids, l.Product.ID)
	}
	book, err := bookQtys(ctx, q, h.WarehouseID, h.DocDate, ids, docID)
	if err != nil {
		return err
	}
	for i := range lines {
		b := book[lines[i].Product.ID]
		lines[i].BookQty = &b
	}
	return nil
}

// stocktakePairs: cặp (mặt hàng, kho) của phiếu kiểm kê — khóa TRƯỚC khi tính tồn sổ sách.
func stocktakePairs(h header, lines []pline) []stock.Pair {
	if h.DocType != TypeStocktake {
		return nil
	}
	ps := make([]stock.Pair, 0, len(lines))
	for _, l := range lines {
		ps = append(ps, stock.Pair{ProductID: l.Product.ID, WarehouseID: h.WarehouseID, From: h.DocDate})
	}
	return stock.MergePairs(ps)
}

// StocktakeItem là một mã có tồn tại kho cuối ngày (nạp vào phiếu kiểm kê).
type StocktakeItem struct {
	ProductID   int64           `json:"product_id"`
	ProductCode string          `json:"product_code"`
	ProductName string          `json:"product_name"`
	Unit        string          `json:"unit"`
	BookQty     decimal.Decimal `json:"book_qty"`
}

// StocktakeLoad trả mọi mặt hàng (không phải dịch vụ) có tồn ≠ 0 tại kho cuối ngày date, theo mã.
func (s *Service) StocktakeLoad(ctx context.Context, warehouseID int64, date util.Date) ([]StocktakeItem, error) {
	if _, err := s.Catalog.GetWarehouse(ctx, s.Pool, warehouseID); err != nil {
		return nil, apperr.ValidationField("warehouse_id", "Kho không tồn tại")
	}
	rows, err := s.Pool.Query(ctx, `SELECT p.id, p.code, p.name, p.unit, sum(m.qty_in - m.qty_out)
		FROM stock_movements m JOIN products p ON p.id = m.product_id
		WHERE m.warehouse_id = $1 AND m.doc_date <= $2 AND NOT p.is_service
		GROUP BY p.id, p.code, p.name, p.unit HAVING sum(m.qty_in - m.qty_out) <> 0 ORDER BY p.code`, warehouseID, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StocktakeItem{}
	for rows.Next() {
		var x StocktakeItem
		if err := rows.Scan(&x.ProductID, &x.ProductCode, &x.ProductName, &x.Unit, &x.BookQty); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// decorate gắn các phần mở rộng vào JSON chứng từ (Get): quy đổi đơn vị, thuế GTGT, kiểm kê.
func decorate(ctx context.Context, q db.Q, d *Document) error {
	f, err := loadFeats(ctx, q)
	if err != nil {
		return err
	}
	showUnit, showVat := f.unit, f.vat && IsVATType(d.DocType)
	for _, l := range d.Lines {
		if l.factor.Cmp(one) != 0 {
			showUnit = true
		}
		if l.vatRate != nil || !l.tax.IsZero() {
			showVat = true
		}
	}
	if !d.taxAmount.IsZero() {
		showVat = true
	}
	for i := range d.Lines {
		l := &d.Lines[i]
		if showUnit {
			l.LineUnit = &LineUnit{Factor: l.factor, BaseQty: l.baseQty, BaseUnit: l.baseUnit}
		}
		if showVat {
			l.LineVAT = &LineVAT{VatRate: l.vatRate, TaxAmount: l.tax, AmountWithTax: l.Amount.Add(l.tax)}
		}
	}
	if showVat {
		d.DocVAT = &DocVAT{GoodsAmount: d.TotalAmount.Sub(d.taxAmount), TaxAmount: d.taxAmount, AmountInWords: util.MoneyInWords(d.TotalAmount)}
	}
	if d.DocType != TypeStocktake {
		return nil
	}
	ids := make([]int64, 0, len(d.Lines))
	for _, l := range d.Lines {
		ids = append(ids, l.ProductID)
	}
	cur, err := bookQtys(ctx, q, d.WarehouseID, d.DocDate, ids, d.ID)
	if err != nil {
		return err
	}
	changed := 0
	for i := range d.Lines {
		l := &d.Lines[i]
		c := cur[l.ProductID]
		lc := &LineCount{BookQty: c, CountedQty: l.baseQty}
		if d.Status == StatusPosted && l.bookQty != nil {
			cc := c
			lc.BookQty, lc.CurrentBookQty = *l.bookQty, &cc
			lc.BookChanged = !l.bookQty.Equal(c)
			if lc.BookChanged {
				changed++
			}
		}
		lc.DiffQty = l.baseQty.Sub(lc.BookQty)
		l.LineCount = lc
	}
	if d.Status == StatusPosted {
		d.BookChangedLines = &changed
	}
	return nil
}

// exactBase: SL × hệ số phải biểu diễn đúng bằng 3 chữ số thập phân (thang SL của sổ kho) — không làm tròn âm thầm
// (QA M-14). Dòng giữ nguyên SL và hệ số đang lưu thì không kiểm lại (dữ liệu cũ).
func exactBase(qty, factor decimal.Decimal, ol *Line, i int) error {
	if ol != nil && ol.factor.Equal(factor) && ol.Qty.Equal(qty) {
		return nil
	}
	b := qty.Mul(factor)
	if !b.Equal(b.Round(3)) {
		return lineErr(i, "qty", "số lượng quy đổi ra đơn vị gốc bị lẻ quá 3 số thập phân ("+b.String()+"); hãy nhập số lượng khác hoặc dùng đơn vị gốc")
	}
	return nil
}

// lineAtRisk: dòng đang lưu có dữ liệu mà máy khách không gửi id dòng sẽ làm mất (hệ số quy đổi, thuế suất, đơn giá bị
// che với người không xem được giá mua).
func lineAtRisk(l Line, maskedPrices bool) bool {
	return (!l.factor.IsZero() && l.factor.Cmp(one) != 0) || l.vatRate != nil || (maskedPrices && l.UnitPrice != nil)
}

func sameProduct(li LineInput, l Line) bool {
	if li.ProductID != 0 {
		return li.ProductID == l.ProductID
	}
	c := strings.TrimSpace(li.ProductCode)
	if strings.EqualFold(c, l.ProductCode) {
		return true
	}
	return strings.EqualFold(l.ProductCode, "DV") && (strings.EqualFold(c, "DICHVU") || strings.EqualFold(util.Fold(c), "dich vu"))
}

// MatchLineIDs (QA M-15/M-16): máy khách gửi lại các dòng KHÔNG có id cho một phiếu đang có dòng mang dữ liệu sẽ mất
// (hệ số ≠ 1, thuế suất, giá bị che) ⇒ cùng số dòng và cùng mặt hàng ở từng vị trí ⇒ gán id dòng đang lưu theo vị trí
// (rồi xử lý như dòng có id: trường không gửi được giữ); khác dãy ⇒ 400 LINE_IDS_REQUIRED. Phiếu không có dòng nào như
// vậy ⇒ giữ đúng hành vi bản chuẩn (dòng không id = dòng mới). Dòng có id ở bất kỳ đâu ⇒ không đổi gì.
func MatchLineIDs(old *Document, lines []LineInput, maskedPrices bool) error {
	if old == nil || len(old.Lines) == 0 {
		return nil
	}
	for _, li := range lines {
		if li.ID != 0 {
			return nil
		}
	}
	risky := false
	for _, l := range old.Lines {
		if lineAtRisk(l, maskedPrices) {
			risky = true
			break
		}
	}
	if !risky {
		return nil
	}
	same := len(lines) == len(old.Lines)
	for i := 0; same && i < len(lines); i++ {
		same = sameProduct(lines[i], old.Lines[i])
	}
	if !same {
		return apperr.New(400, apperr.CodeLineIDsRequired,
			"Phiếu có dòng dùng đơn vị quy đổi, thuế suất hoặc đơn giá bạn không xem được; các dòng gửi lên không có id và không khớp từng dòng đang lưu. Hãy tải lại phiếu và gửi kèm id của từng dòng (lines[].id).",
			map[string]any{"field": "lines"})
	}
	for i := range lines {
		lines[i].ID = old.Lines[i].ID
	}
	return nil
}
