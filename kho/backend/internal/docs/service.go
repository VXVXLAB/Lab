package docs

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
	"kho/internal/debt"
	"kho/internal/ext"
	"kho/internal/pricing"
	"kho/internal/stock"
	"kho/internal/util"
	"kho/internal/vat"
)

// Service xử lý chứng từ.
type Service struct {
	Pool    *pgxpool.Pool
	Catalog *catalog.Service
}

var maxQty = decimal.New(1, 12)   // 10^12
var maxPrice = decimal.New(1, 14) // 10^14

// pline là dòng chứng từ đã kiểm tra, sẵn sàng ghi.
type pline struct {
	ReqID       int64 // id dòng client gửi (có thể không thuộc phiếu)
	LineNo      int
	Product     *catalog.Product
	Description string
	Unit        string
	Qty         decimal.Decimal
	UnitPrice   *decimal.Decimal
	Amount      decimal.Decimal
	Note        string
	Factor      decimal.Decimal  // C10: hệ số quy đổi (1 = đơn vị gốc)
	BaseQty     decimal.Decimal  // SL quy về đơn vị gốc = round(Qty × Factor, 3)
	VatRate     *decimal.Decimal // C11: thuế suất (nil = không thuế)
	Tax         decimal.Decimal  // tiền thuế dòng
	BookQty     *decimal.Decimal // C9: tồn sổ sách (đơn vị gốc) khi ghi sổ phiếu kiểm kê
}

// header là phần đầu chứng từ đã kiểm tra.
type header struct {
	DocType       string
	DocDate       util.Date
	PartnerID     *int64
	WarehouseID   int64
	ToWarehouseID *int64
	Note          string
}

func lineErr(i int, field, msg string) error {
	return apperr.New(http.StatusBadRequest, apperr.CodeValidation, fmt.Sprintf("Dòng %d: %s", i+1, msg),
		map[string]any{"line_no": i + 1, "field": field})
}

// validate kiểm tra & chuẩn hóa dữ liệu nhập.
// strict = true (tạo phiếu mới): không cho dùng kho / đối tác / mặt hàng đã ngừng sử dụng.
// Khi sửa phiếu cũ thì cho phép (dữ liệu cũ có thể tham chiếu mục đã ngừng).
// oldPartner: đối tác hiện có trên phiếu (khi sửa / ghi sổ). Nếu phiếu giữ nguyên đối tác này thì không kiểm tra
// lại cờ Khách hàng / Nhà cung cấp (đối tác có thể đã đổi cờ sau khi phát sinh) — chỉ kiểm khi đặt / đổi đối tác.
// old: chứng từ đang có (khi sửa / ghi sổ / kiểm tra phiếu đang sửa) — dòng gửi lại id giữ các trường không gửi.
func (s *Service) validate(ctx context.Context, q db.Q, in Input, strict bool, old *Document) (header, []pline, error) {
	h := header{DocType: in.DocType, DocDate: in.DocDate, PartnerID: in.PartnerID, WarehouseID: in.WarehouseID, ToWarehouseID: in.ToWarehouseID, Note: strings.TrimSpace(in.Note)}
	var oldPartner *int64
	if old != nil {
		oldPartner = old.PartnerID
	}
	f, err := loadFeats(ctx, q)
	if err != nil {
		return h, nil, err
	}
	if !validType(h.DocType, f) {
		if h.DocType == TypeStocktake && old != nil {
			return h, nil, apperr.FeatureOff(ext.FeatureNames[ext.FStocktake])
		}
		return h, nil, typeErr(f)
	}
	if h.DocDate.Empty() {
		h.DocDate = util.Today()
	}
	if h.DocDate.Year() < 2000 || h.DocDate.Year() > 2100 {
		return h, nil, apperr.ValidationField("doc_date", "Ngày chứng từ không hợp lệ")
	}
	if h.WarehouseID == 0 {
		return h, nil, apperr.ValidationField("warehouse_id", "Vui lòng chọn kho")
	}
	wh, err := s.Catalog.GetWarehouse(ctx, q, h.WarehouseID)
	if err != nil {
		return h, nil, apperr.ValidationField("warehouse_id", "Kho không tồn tại")
	}
	if strict && !wh.Active {
		return h, nil, apperr.ValidationField("warehouse_id", "Kho "+wh.Name+" đã ngừng sử dụng")
	}
	if h.PartnerID != nil && *h.PartnerID == 0 {
		h.PartnerID = nil
	}
	if h.ToWarehouseID != nil && *h.ToWarehouseID == 0 {
		h.ToWarehouseID = nil
	}
	// Trường không thuộc loại phiếu ⇒ 400, không âm thầm bỏ qua (QUYET_DINH B6, QA M-13).
	if h.DocType != TypeTransfer && h.ToWarehouseID != nil {
		return h, nil, apperr.ValidationField("to_warehouse_id", TypeNames[h.DocType]+" không có kho nhận (to_warehouse_id chỉ dùng cho phiếu chuyển kho)")
	}
	switch {
	case h.DocType == TypeTransfer:
		if h.ToWarehouseID == nil {
			return h, nil, apperr.ValidationField("to_warehouse_id", "Vui lòng chọn kho nhận")
		}
		if *h.ToWarehouseID == h.WarehouseID {
			return h, nil, apperr.ValidationField("to_warehouse_id", "Kho nhận phải khác kho xuất")
		}
		tw, err := s.Catalog.GetWarehouse(ctx, q, *h.ToWarehouseID)
		if err != nil {
			return h, nil, apperr.ValidationField("to_warehouse_id", "Kho nhận không tồn tại")
		}
		if strict && !tw.Active {
			return h, nil, apperr.ValidationField("to_warehouse_id", "Kho "+tw.Name+" đã ngừng sử dụng")
		}
		if h.PartnerID != nil {
			return h, nil, apperr.ValidationField("partner_id", "Phiếu chuyển kho không có đối tác")
		}
	case h.DocType == TypeOpening:
		if h.PartnerID != nil {
			return h, nil, apperr.ValidationField("partner_id", "Phiếu tồn đầu kỳ không có đối tác")
		}
		h.ToWarehouseID = nil
	case h.DocType == TypeStocktake:
		if h.PartnerID != nil {
			return h, nil, apperr.ValidationField("partner_id", "Phiếu kiểm kê không có đối tác")
		}
		h.ToWarehouseID = nil
	default:
		h.ToWarehouseID = nil
		if h.PartnerID == nil {
			if needsCustomer(h.DocType) {
				return h, nil, apperr.ValidationField("partner_id", "Vui lòng chọn khách hàng")
			}
			return h, nil, apperr.ValidationField("partner_id", "Vui lòng chọn nhà cung cấp")
		}
		p, err := s.Catalog.GetPartner(ctx, q, *h.PartnerID)
		if err != nil {
			return h, nil, apperr.ValidationField("partner_id", "Đối tác không tồn tại")
		}
		if strict && !p.Active {
			return h, nil, apperr.ValidationField("partner_id", "Đối tác "+p.Name+" đã ngừng sử dụng")
		}
		unchanged := oldPartner != nil && *oldPartner == p.ID
		if needsCustomer(h.DocType) && !p.IsCustomer && !unchanged {
			return h, nil, apperr.ValidationField("partner_id", "Đối tác "+p.Name+" không phải là khách hàng")
		}
		if needsSupplier(h.DocType) && !p.IsSupplier && !unchanged {
			return h, nil, apperr.ValidationField("partner_id", "Đối tác "+p.Name+" không phải là nhà cung cấp")
		}
	}
	if len(in.Lines) > 1000 {
		return h, nil, apperr.ValidationField("lines", "Chứng từ tối đa 1000 dòng")
	}
	lines := make([]pline, 0, len(in.Lines))
	var priceList *bool        // bản mở rộng C6: nạp trạng thái tính năng khi cần
	counted := map[int64]int{} // kiểm kê: mỗi mã một dòng
	for i, li := range in.Lines {
		var p *catalog.Product
		var err error
		switch {
		case li.ProductID != 0:
			p, err = s.Catalog.GetProduct(ctx, q, li.ProductID)
			if err != nil {
				return h, nil, lineErr(i, "product_id", "mặt hàng không tồn tại")
			}
		case strings.TrimSpace(li.ProductCode) != "":
			p, err = s.Catalog.LookupProduct(ctx, q, li.ProductCode)
			if err != nil {
				return h, nil, lineErr(i, "product_code", "không tìm thấy mã hàng "+strings.TrimSpace(li.ProductCode))
			}
		default:
			if in.lenient {
				continue
			}
			return h, nil, lineErr(i, "product_id", "vui lòng chọn mã hàng")
		}
		if strict && !p.Active {
			return h, nil, lineErr(i, "product_id", "mặt hàng "+p.Code+" đã ngừng sử dụng")
		}
		pl := pline{ReqID: li.ID, LineNo: i + 1, Product: p, Description: strings.TrimSpace(li.Description), Note: strings.TrimSpace(li.Note)}
		ol := oldLineOf(old, li.ID, p.ID)
		if pl.Unit, pl.Factor, err = resolveUnit(ctx, q, f, p, li, ol, i); err != nil {
			return h, nil, err
		}
		if h.DocType == TypeStocktake {
			if p.IsService {
				return h, nil, lineErr(i, "product_id", "phiếu kiểm kê không có dòng dịch vụ")
			}
			if first, dup := counted[p.ID]; dup {
				return h, nil, lineErr(i, "product_id", fmt.Sprintf("mã %s đã có ở dòng %d (mỗi mã một dòng)", p.Code, first))
			}
			counted[p.ID] = i + 1
			if li.Qty == nil {
				if in.lenient {
					continue
				}
				return h, nil, lineErr(i, "qty", "vui lòng nhập số lượng thực tế (0 nếu không còn)")
			}
			if li.Qty.IsNegative() {
				return h, nil, lineErr(i, "qty", "số lượng thực tế không được âm")
			}
			pl.Qty = li.Qty.Round(3)
			if err := exactBase(pl.Qty, pl.Factor, ol, i); err != nil {
				return h, nil, err
			}
			pl.BaseQty = pl.Qty.Mul(pl.Factor).Round(3)
			if pl.BaseQty.GreaterThanOrEqual(maxQty) {
				return h, nil, lineErr(i, "qty", "số lượng quá lớn")
			}
			if li.UnitPrice != nil || (li.VatRate.Set && li.VatRate.Val != nil) {
				return h, nil, lineErr(i, "unit_price", "phiếu kiểm kê không có đơn giá / thuế")
			}
			pl.Amount = decimal.Zero
			lines = append(lines, pl)
			continue
		}
		if p.IsService {
			if !AllowsService(h.DocType) {
				return h, nil, lineErr(i, "product_id", "phiếu chuyển kho / tồn đầu kỳ không có dòng dịch vụ")
			}
			pl.Qty = decimal.NewFromInt(1)
			if li.Qty != nil && !li.Qty.IsZero() {
				pl.Qty = li.Qty.Round(3)
			}
			if !pl.Qty.IsPositive() {
				return h, nil, lineErr(i, "qty", "số lượng phải lớn hơn 0 (muốn trừ tiền thì nhập đơn giá âm)")
			}
			if li.UnitPrice != nil {
				up := li.UnitPrice.Round(2)
				pl.UnitPrice = &up
			}
		} else {
			if in.lenient && (li.Qty == nil || !li.Qty.Round(3).IsPositive()) {
				continue
			}
			if li.Qty == nil || !li.Qty.IsPositive() {
				return h, nil, lineErr(i, "qty", "số lượng phải lớn hơn 0")
			}
			pl.Qty = li.Qty.Round(3)
			if pl.Qty.IsZero() {
				return h, nil, lineErr(i, "qty", "số lượng phải lớn hơn 0")
			}
			if li.UnitPrice != nil {
				up := li.UnitPrice.Round(2)
				pl.UnitPrice = &up
			} else {
				// Đơn giá mặc định theo danh mục (REQ-026); vẫn sửa được khi nhập phiếu (REQ-027).
				// Bản mở rộng C6 (price_list bật): phiếu bán lấy giá riêng của khách / giá bán gần nhất cho khách.
				switch h.DocType {
				case TypeSale, TypeSaleReturn:
					up := p.SalePrice
					if h.DocType == TypeSale && h.PartnerID != nil {
						if priceList == nil {
							st, err := ext.Load(ctx, q)
							if err != nil {
								return h, nil, err
							}
							on := st.On(ext.FPriceList)
							priceList = &on
						}
						if *priceList {
							qs, err := pricing.Resolve(ctx, q, *h.PartnerID, []int64{p.ID}, h.DocDate)
							if err != nil {
								return h, nil, err
							}
							if len(qs) == 1 {
								up = qs[0].PriceFor(pl.Factor)
								pl.UnitPrice = &up
							}
						}
					}
					if pl.UnitPrice == nil {
						up = byFactor(up, pl.Factor)
						pl.UnitPrice = &up
					}
				case TypePurchase, TypePurchaseReturn, TypeOpening:
					up := byFactor(p.PurchasePrice, pl.Factor)
					pl.UnitPrice = &up
				}
			}
			if pl.UnitPrice != nil && pl.UnitPrice.IsNegative() {
				return h, nil, lineErr(i, "unit_price", "đơn giá hàng hóa không được âm")
			}
		}
		if pl.Qty.GreaterThanOrEqual(maxQty) {
			return h, nil, lineErr(i, "qty", "số lượng quá lớn")
		}
		pl.BaseQty = pl.Qty
		if pl.Factor.Cmp(one) != 0 {
			if err := exactBase(pl.Qty, pl.Factor, ol, i); err != nil {
				return h, nil, err
			}
			pl.BaseQty = pl.Qty.Mul(pl.Factor).Round(3)
			if !pl.BaseQty.IsPositive() {
				return h, nil, lineErr(i, "qty", "số lượng quy về đơn vị gốc bằng 0 (quá nhỏ)")
			}
			if pl.BaseQty.GreaterThanOrEqual(maxQty) {
				return h, nil, lineErr(i, "qty", "số lượng quá lớn")
			}
		}
		if pl.UnitPrice != nil && pl.UnitPrice.Abs().GreaterThanOrEqual(maxPrice) {
			return h, nil, lineErr(i, "unit_price", "đơn giá quá lớn")
		}
		if pl.UnitPrice != nil {
			pl.Amount = util.RoundVND(pl.Qty.Mul(*pl.UnitPrice))
			if pl.Amount.Abs().GreaterThanOrEqual(decimal.New(1, 15)) {
				return h, nil, lineErr(i, "unit_price", "thành tiền quá lớn")
			}
		} else {
			pl.Amount = decimal.Zero
		}
		if pl.VatRate, err = resolveVAT(f, h.DocType, p, li, ol, i); err != nil {
			return h, nil, err
		}
		pl.Tax = vat.Tax(pl.Amount, pl.VatRate)
		lines = append(lines, pl)
	}
	return h, lines, nil
}

// byFactor: giá theo đơn vị gốc × hệ số (làm tròn 2 chữ số) — giá mặc định của đơn vị quy đổi.
func byFactor(price, factor decimal.Decimal) decimal.Decimal {
	if factor.Cmp(one) == 0 {
		return price
	}
	return price.Mul(factor).Round(2)
}

// total là tổng thanh toán của phiếu: tiền hàng + tiền thuế (công nợ, hạn mức dùng số này).
func total(lines []pline) decimal.Decimal {
	t := decimal.Zero
	for _, l := range lines {
		t = t.Add(l.lineTotal())
	}
	return t
}

// movements tính bút toán kho của chứng từ (không gồm dòng dịch vụ).
func movements(h header, lines []pline) []stock.Mov {
	var out []stock.Mov
	for _, l := range lines {
		if l.Product.IsService {
			continue
		}
		m := stock.Mov{ProductID: l.Product.ID, WarehouseID: h.WarehouseID, Date: h.DocDate, In: decimal.Zero, Out: decimal.Zero}
		in, outQ := lineInOut(h, l)
		if in.IsZero() && outQ.IsZero() {
			continue
		}
		m.In, m.Out = in, outQ
		out = append(out, m)
		if h.DocType == TypeTransfer && h.ToWarehouseID != nil {
			out = append(out, stock.Mov{ProductID: l.Product.ID, WarehouseID: *h.ToWarehouseID, Date: h.DocDate, In: l.BaseQty, Out: decimal.Zero})
		}
	}
	return out
}

// lineInOut: SL nhập / xuất (đơn vị gốc) của một dòng hàng tại kho chính của phiếu. Kiểm kê: chênh lệch thực tế − sổ
// sách (BookQty phải đã được gán); không chênh ⇒ (0, 0).
func lineInOut(h header, l pline) (decimal.Decimal, decimal.Decimal) {
	switch {
	case h.DocType == TypeStocktake:
		book := decimal.Zero
		if l.BookQty != nil {
			book = *l.BookQty
		}
		d := l.BaseQty.Sub(book)
		if d.IsNegative() {
			return decimal.Zero, d.Neg()
		}
		return d, decimal.Zero
	case isInbound(h.DocType):
		return l.BaseQty, decimal.Zero
	default:
		return decimal.Zero, l.BaseQty
	}
}

// lossWarnings tính các dòng bán dưới giá vốn (R4). Chỉ phiếu bán, không xét dòng dịch vụ.
func lossWarnings(ctx context.Context, q db.Q, h header, lines []pline) ([]Warning, error) {
	out := []Warning{}
	if h.DocType != TypeSale {
		return out, nil
	}
	var ids []int64
	for _, l := range lines {
		if !l.Product.IsService {
			ids = append(ids, l.Product.ID)
		}
	}
	costs, err := stock.CostPrices(ctx, q, ids, h.DocDate)
	if err != nil {
		return nil, err
	}
	for _, l := range lines {
		if l.Product.IsService || l.UnitPrice == nil {
			continue
		}
		c, ok := costs[l.Product.ID]
		if !ok || c.Source == "none" {
			continue
		}
		// So theo đơn vị gốc (C10): giá bán / hệ số < giá vốn ⟺ giá bán < giá vốn × hệ số (giá trước thuế).
		cost := c.Price
		if !l.Factor.IsZero() && l.Factor.Cmp(one) != 0 {
			cost = c.Price.Mul(l.Factor).Round(2)
		}
		if l.UnitPrice.LessThan(cost) {
			out = append(out, Warning{
				Type: "loss", LineNo: l.LineNo, ProductID: l.Product.ID, ProductCode: l.Product.Code, ProductName: l.Product.Name,
				UnitPrice: *l.UnitPrice, CostPrice: cost, CostSource: c.Source,
				Message: fmt.Sprintf("Dòng %d (%s): giá bán %s thấp hơn giá mua %s — bán lỗ", l.LineNo, l.Product.Code,
					util.FormatVND(*l.UnitPrice), util.FormatVND(cost)),
			})
		}
	}
	return out, nil
}

func insufficient(sh []stock.Shortage) error {
	msgs := make([]string, 0, len(sh))
	for _, s := range sh {
		msgs = append(msgs, s.Message)
	}
	return apperr.New(http.StatusUnprocessableEntity, apperr.CodeInsufficientStock,
		"Không đủ tồn kho, không ghi sổ được: "+strings.Join(msgs, "; "), sh)
}

func lossErr(w []Warning) error {
	return apperr.New(http.StatusConflict, apperr.CodeLossWarning,
		"Có mặt hàng bán thấp hơn giá mua (bán lỗ). Bấm xác nhận để vẫn ghi sổ.", w)
}

// saveLines ghi các dòng của phiếu theo thứ tự yêu cầu, trả id dòng theo thứ tự.
// Dòng có ReqID là dòng đang có của chính phiếu này ⇒ sửa tại chỗ, GIỮ id; còn lại ⇒ thêm mới.
// Dòng đang có mà yêu cầu không gửi lại ⇒ xóa. Bút toán kho của phiếu phải được xóa trước (gọi bởi Update).
func saveLines(ctx context.Context, tx pgx.Tx, docID int64, lines []pline) ([]int64, error) {
	existing := map[int64]bool{}
	rows, err := tx.Query(ctx, `SELECT id FROM document_lines WHERE document_id=$1`, docID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		existing[id] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	keep := map[int64]bool{}
	for _, l := range lines {
		if l.ReqID != 0 && existing[l.ReqID] && !keep[l.ReqID] {
			keep[l.ReqID] = true
		}
	}
	var drop []int64
	for id := range existing {
		if !keep[id] {
			drop = append(drop, id)
		}
	}
	if len(drop) > 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM document_lines WHERE document_id=$1 AND id = ANY($2)`, docID, drop); err != nil {
			return nil, err
		}
	}
	used := map[int64]bool{}
	ids := make([]int64, len(lines))
	for i, l := range lines {
		if l.ReqID != 0 && keep[l.ReqID] && !used[l.ReqID] {
			used[l.ReqID] = true
			if _, err := tx.Exec(ctx, `UPDATE document_lines SET line_no=$3, product_id=$4, description=$5, unit=$6, qty=$7, unit_price=$8, amount=$9, note=$10,
				unit_factor=$11, vat_rate=$12, tax_amount=$13, book_qty=$14
				WHERE id=$1 AND document_id=$2`, l.ReqID, docID, l.LineNo, l.Product.ID, l.Description, l.Unit, l.Qty, l.UnitPrice, l.Amount, l.Note,
				factorOr1(l.Factor), l.VatRate, l.Tax, l.BookQty); err != nil {
				return nil, err
			}
			ids[i] = l.ReqID
			continue
		}
		if err := tx.QueryRow(ctx, `INSERT INTO document_lines(document_id,line_no,product_id,description,unit,qty,unit_price,amount,note,unit_factor,vat_rate,tax_amount,book_qty)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
			docID, l.LineNo, l.Product.ID, l.Description, l.Unit, l.Qty, l.UnitPrice, l.Amount, l.Note,
			factorOr1(l.Factor), l.VatRate, l.Tax, l.BookQty).Scan(&ids[i]); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

func factorOr1(f decimal.Decimal) decimal.Decimal {
	if f.IsZero() {
		return one
	}
	return f
}

// insertMovements sinh bút toán kho cho chứng từ đã ghi sổ.
func insertMovements(ctx context.Context, tx pgx.Tx, docID int64, h header, lines []pline, lineIDs []int64) error {
	for i, l := range lines {
		if l.Product.IsService {
			continue
		}
		cost := decimal.Zero
		if l.UnitPrice != nil {
			cost = *l.UnitPrice
			if f := factorOr1(l.Factor); f.Cmp(one) != 0 {
				cost = cost.Div(f).Round(2) // giá theo đơn vị gốc
			}
		}
		in, out := lineInOut(h, l)
		if in.IsZero() && out.IsZero() {
			continue // kiểm kê không chênh lệch
		}
		if _, err := tx.Exec(ctx, `INSERT INTO stock_movements(document_id,line_id,product_id,warehouse_id,doc_date,qty_in,qty_out,unit_cost)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, docID, lineIDs[i], l.Product.ID, h.WarehouseID, h.DocDate, in, out, cost); err != nil {
			return err
		}
		if h.DocType == TypeTransfer && h.ToWarehouseID != nil {
			if _, err := tx.Exec(ctx, `INSERT INTO stock_movements(document_id,line_id,product_id,warehouse_id,doc_date,qty_in,qty_out,unit_cost)
				VALUES ($1,$2,$3,$4,$5,$6,0,$7)`, docID, lineIDs[i], l.Product.ID, *h.ToWarehouseID, h.DocDate, l.BaseQty, cost); err != nil {
				return err
			}
		}
	}
	return nil
}

// existingPairs trả các cặp (mặt hàng, kho) đang có bút toán của chứng từ.
func existingPairs(ctx context.Context, q db.Q, docID int64) ([]stock.Pair, error) {
	rows, err := q.Query(ctx, `SELECT product_id, warehouse_id, min(doc_date) FROM stock_movements WHERE document_id=$1 GROUP BY 1,2`, docID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []stock.Pair
	for rows.Next() {
		var p stock.Pair
		if err := rows.Scan(&p.ProductID, &p.WarehouseID, &p.From); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// lockedRow là thông tin đầu chứng từ đọc khi khóa.
type lockedRow struct {
	Status        string
	Version       int
	DocType       string
	DocNo         *string
	UpdatedAt     time.Time
	UpdatedByName *string
}

func lockDoc(ctx context.Context, tx pgx.Tx, id int64) (*lockedRow, error) {
	var r lockedRow
	err := tx.QueryRow(ctx, `SELECT d.status, d.version, d.doc_type, d.doc_no, d.updated_at, u.full_name
		FROM documents d LEFT JOIN users u ON u.id=d.updated_by WHERE d.id=$1 FOR UPDATE OF d`, id).
		Scan(&r.Status, &r.Version, &r.DocType, &r.DocNo, &r.UpdatedAt, &r.UpdatedByName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperr.NotFound("chứng từ")
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// VersionConflict tạo lỗi 409 khi người khác đã sửa trước.
func VersionConflict(byName *string, at time.Time, current int) error {
	name := "người khác"
	if byName != nil {
		name = *byName
	}
	return apperr.New(http.StatusConflict, apperr.CodeVersionConflict,
		fmt.Sprintf("Phiếu đã được %s sửa lúc %s. Vui lòng tải lại phiếu trước khi sửa tiếp.", name, at.In(util.VNZone).Format("15:04:05 02/01/2006")),
		map[string]any{"updated_by": name, "updated_at": at, "current_version": current})
}

func checkVersion(r *lockedRow, version int) error {
	if version == 0 {
		return apperr.ValidationField("version", "Thiếu version của phiếu")
	}
	if version != r.Version {
		return VersionConflict(r.UpdatedByName, r.UpdatedAt, r.Version)
	}
	return nil
}

// Create tạo phiếu tạm (R5).
func (s *Service) Create(ctx context.Context, userID int64, in Input) (*Document, error) {
	var id int64
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		h, lines, err := s.validate(ctx, tx, in, true, nil)
		if err != nil {
			return err
		}
		if err := checkLock(ctx, tx, h.DocDate); err != nil {
			return err
		}
		n, err := db.NextNumber(ctx, tx, "TAM")
		if err != nil {
			return err
		}
		draftNo := fmt.Sprintf("TAM%06d", n)
		err = tx.QueryRow(ctx, `INSERT INTO documents(doc_type,draft_no,doc_date,status,partner_id,warehouse_id,to_warehouse_id,note,total_amount,version,created_by,updated_by,tax_amount)
			VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,1,$9,$9,$10) RETURNING id`,
			h.DocType, draftNo, h.DocDate, h.PartnerID, h.WarehouseID, h.ToWarehouseID, h.Note, total(lines), userID, taxTotal(lines)).Scan(&id)
		if err != nil {
			return err
		}
		if _, err := saveLines(ctx, tx, id, lines); err != nil {
			return err
		}
		after, err := s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "document", id, "created", nil, after)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, s.Pool, id)
}

// Update sửa chứng từ (phiếu tạm hoặc đã ghi sổ — R3).
func (s *Service) Update(ctx context.Context, userID, id int64, in Input) (*Document, error) {
	var creditConfirmed *CreditInfo
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		r, err := lockDoc(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := checkVersion(r, in.Version); err != nil {
			return err
		}
		if in.DocType == "" {
			in.DocType = r.DocType
		}
		if in.DocType != r.DocType {
			return apperr.ValidationField("doc_type", "Không được đổi loại chứng từ")
		}
		before, err := s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := MatchLineIDs(before, in.Lines, false); err != nil {
			return err
		}
		h, lines, err := s.validate(ctx, tx, in, false, before)
		if err != nil {
			return err
		}
		posted := r.Status == StatusPosted
		if err := checkUpdateLock(ctx, tx, posted, before.DocDate, h.DocDate); err != nil {
			return err
		}
		if posted {
			if len(lines) == 0 {
				return apperr.ValidationField("lines", "Phiếu đã ghi sổ phải có ít nhất một dòng")
			}
			oldPairs, err := existingPairs(ctx, tx, id)
			if err != nil {
				return err
			}
			// Kiểm kê: khóa cặp mặt hàng+kho rồi mới tính tồn sổ sách; mọi khóa lấy một lần, theo thứ tự cố định.
			stp := stocktakePairs(h, lines)
			if h.DocType == TypeStocktake {
				if err := stock.LockPairs(ctx, tx, stock.MergePairs(oldPairs, stp)); err != nil {
					return err
				}
				if err := fillBook(ctx, tx, id, h, lines); err != nil {
					return err
				}
			}
			newMovs := movements(h, lines)
			pairs := stock.MergePairs(oldPairs, stock.PairsOf(newMovs), stp)
			if h.DocType != TypeStocktake {
				if err := stock.LockPairs(ctx, tx, pairs); err != nil {
					return err
				}
			}
			sh, err := stock.CheckShortages(ctx, tx, id, newMovs, pairs)
			if err != nil {
				return err
			}
			if len(sh) > 0 {
				return insufficient(sh)
			}
			lw, err := lossWarnings(ctx, tx, h, lines)
			if err != nil {
				return err
			}
			ci, err := creditCheck(ctx, tx, h, total(lines), &prevSale{partnerID: before.PartnerID, total: before.TotalAmount})
			if err != nil {
				return err
			}
			if err := confirmations(lw, ci, in.ConfirmLoss, in.ConfirmCredit); err != nil {
				return err
			}
			if ci != nil {
				creditConfirmed = ci
			}
		}
		// Bút toán kho luôn dựng lại từ đầu; dòng giữ id nếu client gửi id dòng của chính phiếu này.
		if _, err := tx.Exec(ctx, `DELETE FROM stock_movements WHERE document_id=$1`, id); err != nil {
			return err
		}
		lineIDs, err := saveLines(ctx, tx, id, lines)
		if err != nil {
			return err
		}
		if posted {
			if err := insertMovements(ctx, tx, id, h, lines, lineIDs); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE documents SET doc_date=$2, partner_id=$3, warehouse_id=$4, to_warehouse_id=$5, note=$6,
			total_amount=$7, version=version+1, updated_by=$8, updated_at=now(), tax_amount=$9 WHERE id=$1`,
			id, h.DocDate, h.PartnerID, h.WarehouseID, h.ToWarehouseID, h.Note, total(lines), userID, taxTotal(lines)); err != nil {
			return err
		}
		after, err := s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		if creditConfirmed != nil {
			if err := db.Audit(ctx, tx, userID, "document", id, "credit_confirmed", nil, creditConfirmed); err != nil {
				return err
			}
		}
		return db.Audit(ctx, tx, userID, "document", id, "updated", before, after)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, s.Pool, id)
}

// loadForPost đọc dữ liệu chứng từ hiện có thành header + pline (kiểm tra lại như khi nhập).
func (s *Service) loadForPost(ctx context.Context, q db.Q, d *Document) (header, []pline, error) {
	in := Input{DocType: d.DocType, DocDate: d.DocDate, PartnerID: d.PartnerID, WarehouseID: d.WarehouseID, ToWarehouseID: d.ToWarehouseID, Note: d.Note}
	for _, l := range d.Lines {
		qty := l.Qty
		unit := l.Unit
		li := LineInput{ID: l.ID, ProductID: l.ProductID, Description: l.Description, Unit: &unit, Qty: &qty, Note: l.Note}
		if l.UnitPrice != nil {
			up := *l.UnitPrice
			li.UnitPrice = &up
		} else if !l.IsService && (d.DocType == TypeTransfer || d.DocType == TypeStocktake) {
			li.UnitPrice = nil
		} else if !l.IsService {
			z := decimal.Zero
			li.UnitPrice = &z
		}
		in.Lines = append(in.Lines, li)
	}
	return s.validate(ctx, q, in, false, d)
}

// Post ghi sổ phiếu tạm: cấp số chính thức, sinh bút toán kho, phát sinh công nợ (R5, R6).
func (s *Service) Post(ctx context.Context, userID, id int64, version int, confirmLoss bool) (*Document, error) {
	return s.PostWith(ctx, userID, id, PostParams{Version: version, ConfirmLoss: confirmLoss})
}

// PostParams là tham số ghi sổ.
type PostParams struct {
	Version       int
	ConfirmLoss   bool
	ConfirmCredit bool // bản mở rộng C8
}

// PostWith ghi sổ với các xác nhận cảnh báo.
func (s *Service) PostWith(ctx context.Context, userID, id int64, pp PostParams) (*Document, error) {
	version, confirmLoss := pp.Version, pp.ConfirmLoss
	var creditConfirmed *CreditInfo
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		r, err := lockDoc(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := checkVersion(r, version); err != nil {
			return err
		}
		if r.Status == StatusPosted {
			return apperr.Validation("Phiếu đã được ghi sổ rồi")
		}
		before, err := s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := checkLock(ctx, tx, before.DocDate); err != nil {
			return err
		}
		if len(before.Lines) == 0 {
			return apperr.ValidationField("lines", "Phiếu chưa có dòng nào, không ghi sổ được")
		}
		h, lines, err := s.loadForPost(ctx, tx, before)
		if err != nil {
			return err
		}
		stp := stocktakePairs(h, lines)
		if h.DocType == TypeStocktake {
			if err := stock.LockPairs(ctx, tx, stp); err != nil {
				return err
			}
			if err := fillBook(ctx, tx, id, h, lines); err != nil {
				return err
			}
		}
		newMovs := movements(h, lines)
		pairs := stock.MergePairs(stock.PairsOf(newMovs), stp)
		if h.DocType != TypeStocktake {
			if err := stock.LockPairs(ctx, tx, pairs); err != nil {
				return err
			}
		}
		sh, err := stock.CheckShortages(ctx, tx, id, newMovs, pairs)
		if err != nil {
			return err
		}
		if len(sh) > 0 {
			return insufficient(sh)
		}
		lw, err := lossWarnings(ctx, tx, h, lines)
		if err != nil {
			return err
		}
		ci, err := creditCheck(ctx, tx, h, total(lines), nil)
		if err != nil {
			return err
		}
		if err := confirmations(lw, ci, confirmLoss, pp.ConfirmCredit); err != nil {
			return err
		}
		creditConfirmed = ci
		docNo := r.DocNo
		if docNo == nil {
			prefix := NumberPrefix[r.DocType]
			n, err := db.NextNumber(ctx, tx, prefix)
			if err != nil {
				return err
			}
			no := fmt.Sprintf("%s%05d", prefix, n)
			docNo = &no
		}
		lineIDs := make([]int64, len(before.Lines))
		for i, l := range before.Lines {
			lineIDs[i] = l.ID
		}
		if err := insertMovements(ctx, tx, id, h, lines, lineIDs); err != nil {
			return err
		}
		if h.DocType == TypeStocktake {
			for i, l := range lines {
				if _, err := tx.Exec(ctx, `UPDATE document_lines SET book_qty=$2 WHERE id=$1`, lineIDs[i], l.BookQty); err != nil {
					return err
				}
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE documents SET status='posted', doc_no=$2, posted_by=$3, posted_at=clock_timestamp(),
			version=version+1, updated_by=$3, updated_at=now() WHERE id=$1`, id, *docNo, userID); err != nil {
			return err
		}
		after, err := s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		if creditConfirmed != nil {
			if err := db.Audit(ctx, tx, userID, "document", id, "credit_confirmed", nil, creditConfirmed); err != nil {
				return err
			}
		}
		return db.Audit(ctx, tx, userID, "document", id, "posted", before, after)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, s.Pool, id)
}

// Unpost bỏ ghi sổ: chứng từ trở về phiếu tạm (giữ số chính thức để ghi sổ lại).
func (s *Service) Unpost(ctx context.Context, userID, id int64, version int) (*Document, error) {
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		r, err := lockDoc(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := checkVersion(r, version); err != nil {
			return err
		}
		if r.Status != StatusPosted {
			return apperr.Validation("Phiếu chưa ghi sổ")
		}
		before, err := s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := checkLock(ctx, tx, before.DocDate); err != nil {
			return err
		}
		pairs, err := existingPairs(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := stock.LockPairs(ctx, tx, pairs); err != nil {
			return err
		}
		sh, err := stock.CheckShortages(ctx, tx, id, nil, pairs)
		if err != nil {
			return err
		}
		if len(sh) > 0 {
			return insufficient(sh)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM stock_movements WHERE document_id=$1`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE document_lines SET book_qty=NULL WHERE document_id=$1 AND book_qty IS NOT NULL`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE documents SET status='draft', posted_by=NULL, posted_at=NULL,
			version=version+1, updated_by=$2, updated_at=now() WHERE id=$1`, id, userID); err != nil {
			return err
		}
		after, err := s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "document", id, "unposted", before, after)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, s.Pool, id)
}

// Delete xóa phiếu tạm (version = 0 nghĩa là không kiểm tra version).
func (s *Service) Delete(ctx context.Context, userID, id int64, version int) (*Document, error) {
	var before *Document
	err := db.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		r, err := lockDoc(ctx, tx, id)
		if err != nil {
			return err
		}
		if version != 0 && version != r.Version {
			return VersionConflict(r.UpdatedByName, r.UpdatedAt, r.Version)
		}
		if r.Status != StatusDraft {
			return apperr.Validation("Chỉ xóa được phiếu tạm. Phiếu đã ghi sổ phải \"Bỏ ghi sổ\" trước.")
		}
		before, err = s.Get(ctx, tx, id)
		if err != nil {
			return err
		}
		var refs []string
		if err := tx.QueryRow(ctx, `SELECT COALESCE(array_agg(DISTINCT v.voucher_no ORDER BY v.voucher_no), '{}')
			FROM cash_voucher_lines l JOIN cash_vouchers v ON v.id=l.voucher_id WHERE l.document_id=$1`, id).Scan(&refs); err != nil {
			return err
		}
		if len(refs) > 0 {
			return apperr.New(http.StatusConflict, apperr.CodeInUse,
				"Phiếu đang được phiếu thu/chi "+strings.Join(refs, ", ")+" tham chiếu, không xóa được. Hãy sửa các phiếu thu/chi đó (bỏ liên kết chứng từ) trước.",
				map[string]any{"voucher_nos": refs})
		}
		if _, err := tx.Exec(ctx, `DELETE FROM documents WHERE id=$1`, id); err != nil {
			return err
		}
		return db.Audit(ctx, tx, userID, "document", id, "deleted", before, nil)
	})
	return before, err
}

// Check kiểm tra tồn & bán lỗ nếu ghi sổ (hoặc lưu lại) chứng từ ngay bây giờ — không đổi dữ liệu.
func (s *Service) Check(ctx context.Context, id int64) (*CheckResult, error) {
	d, err := s.Get(ctx, s.Pool, id)
	if err != nil {
		return nil, err
	}
	res := &CheckResult{StockShortages: []stock.Shortage{}, LossLines: []Warning{}}
	h, lines, err := s.loadForPost(ctx, s.Pool, d)
	if err != nil {
		return nil, err
	}
	if err := fillBook(ctx, s.Pool, id, h, lines); err != nil {
		return nil, err
	}
	newMovs := movements(h, lines)
	oldPairs, err := existingPairs(ctx, s.Pool, id)
	if err != nil {
		return nil, err
	}
	sh, err := stock.CheckShortages(ctx, s.Pool, id, newMovs, stock.MergePairs(oldPairs, stock.PairsOf(newMovs)))
	if err != nil {
		return nil, err
	}
	res.StockShortages = sh
	lw, err := lossWarnings(ctx, s.Pool, h, lines)
	if err != nil {
		return nil, err
	}
	res.LossLines = lw
	res.CanPost = len(sh) == 0 && len(d.Lines) > 0
	return res, nil
}

// CheckInput kiểm tra tồn & bán lỗ cho một phiếu CHƯA LƯU (đang gõ) như thể ghi sổ ngay — không đổi dữ liệu.
// id ≠ 0: phiếu đang sửa; bút toán hiện có của nó được loại trừ (thay bằng nội dung mới), đối tác giữ nguyên
// không bị kiểm lại cờ KH/NCC. Dòng chưa chọn mặt hàng hoặc hàng hóa chưa có SL được bỏ qua.
func (s *Service) CheckInput(ctx context.Context, in Input, id int64) (*CheckResult, error) {
	in.lenient = true
	strict := true
	var oldDoc *Document
	if id != 0 {
		d, err := s.Get(ctx, s.Pool, id)
		if err != nil {
			return nil, err
		}
		if in.DocType == "" {
			in.DocType = d.DocType
		}
		if in.DocType != d.DocType {
			return nil, apperr.ValidationField("doc_type", "Không được đổi loại chứng từ")
		}
		strict, oldDoc = false, d
		if err := MatchLineIDs(d, in.Lines, false); err != nil {
			return nil, err
		}
	}
	h, lines, err := s.validate(ctx, s.Pool, in, strict, oldDoc)
	if err != nil {
		return nil, err
	}
	if err := fillBook(ctx, s.Pool, id, h, lines); err != nil {
		return nil, err
	}
	newMovs := movements(h, lines)
	var oldPairs []stock.Pair
	if id != 0 {
		if oldPairs, err = existingPairs(ctx, s.Pool, id); err != nil {
			return nil, err
		}
	}
	sh, err := stock.CheckShortages(ctx, s.Pool, id, newMovs, stock.MergePairs(oldPairs, stock.PairsOf(newMovs)))
	if err != nil {
		return nil, err
	}
	lw, err := lossWarnings(ctx, s.Pool, h, lines)
	if err != nil {
		return nil, err
	}
	return &CheckResult{StockShortages: sh, LossLines: lw, CanPost: len(sh) == 0 && len(lines) > 0}, nil
}

const docSelect = `SELECT d.id, d.doc_type, d.doc_no, d.draft_no, d.doc_date, d.status,
	d.partner_id, p.code, p.name, p.address, p.phone,
	d.warehouse_id, w.code, w.name, d.to_warehouse_id, tw.code, tw.name,
	d.note, d.total_amount, d.version, d.tax_amount,
	d.created_by, cu.full_name, d.updated_by, uu.full_name, d.posted_by, pu.full_name, d.posted_at, d.created_at, d.updated_at
FROM documents d
LEFT JOIN partners p ON p.id=d.partner_id
JOIN warehouses w ON w.id=d.warehouse_id
LEFT JOIN warehouses tw ON tw.id=d.to_warehouse_id
LEFT JOIN users cu ON cu.id=d.created_by
LEFT JOIN users uu ON uu.id=d.updated_by
LEFT JOIN users pu ON pu.id=d.posted_by`

// Get đọc chứng từ đầy đủ (kèm dòng, cảnh báo, nợ cũ / tổng nợ).
func (s *Service) Get(ctx context.Context, q db.Q, id int64) (*Document, error) {
	var d Document
	err := q.QueryRow(ctx, docSelect+` WHERE d.id=$1`, id).Scan(&d.ID, &d.DocType, &d.DocNo, &d.DraftNo, &d.DocDate, &d.Status,
		&d.PartnerID, &d.PartnerCode, &d.PartnerName, &d.PartnerAddress, &d.PartnerPhone,
		&d.WarehouseID, &d.WarehouseCode, &d.WarehouseName, &d.ToWarehouseID, &d.ToWarehouseCode, &d.ToWarehouseName,
		&d.Note, &d.TotalAmount, &d.Version, &d.taxAmount,
		&d.CreatedBy, &d.CreatedByName, &d.UpdatedBy, &d.UpdatedByName, &d.PostedBy, &d.PostedByName, &d.PostedAt, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperr.NotFound("chứng từ")
	}
	if err != nil {
		return nil, err
	}
	d.DocTypeName = TypeNames[d.DocType]
	d.DisplayNo = d.DraftNo
	if d.Status == StatusPosted && d.DocNo != nil {
		d.DisplayNo = *d.DocNo
	}
	rows, err := q.Query(ctx, `SELECT l.id, l.line_no, l.product_id, p.code, p.name, p.is_service, l.description, l.unit, l.qty, l.unit_price, l.amount, l.note,
			l.unit_factor, l.base_qty, l.vat_rate, l.tax_amount, l.book_qty, p.unit
		FROM document_lines l JOIN products p ON p.id=l.product_id WHERE l.document_id=$1 ORDER BY l.line_no, l.id`, id)
	if err != nil {
		return nil, err
	}
	d.Lines = []Line{}
	for rows.Next() {
		var l Line
		if err := rows.Scan(&l.ID, &l.LineNo, &l.ProductID, &l.ProductCode, &l.ProductName, &l.IsService, &l.Description, &l.Unit, &l.Qty,
			&l.UnitPrice, &l.Amount, &l.Note, &l.factor, &l.baseQty, &l.vatRate, &l.tax, &l.bookQty, &l.baseUnit); err != nil {
			rows.Close()
			return nil, err
		}
		d.Lines = append(d.Lines, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Cảnh báo bán lỗ.
	h := header{DocType: d.DocType, DocDate: d.DocDate}
	pls := make([]pline, len(d.Lines))
	for i, l := range d.Lines {
		pls[i] = pline{LineNo: l.LineNo, Product: &catalog.Product{ID: l.ProductID, Code: l.ProductCode, Name: l.ProductName, IsService: l.IsService}, UnitPrice: l.UnitPrice, Qty: l.Qty, Factor: l.factor}
	}
	d.Warnings, err = lossWarnings(ctx, q, h, pls)
	if err != nil {
		return nil, err
	}
	// Nợ cũ / tổng nợ (R8).
	if d.PartnerID != nil && (d.DocType == TypeSale || d.DocType == TypePurchase) {
		side := debt.Receivable
		if d.DocType == TypePurchase {
			side = debt.Payable
		}
		var postedAt *time.Time
		if d.Status == StatusPosted {
			postedAt = d.PostedAt
		}
		old, err := debt.BalanceBeforeDocument(ctx, q, side, *d.PartnerID, d.ID, d.DocDate, postedAt)
		if err != nil {
			return nil, err
		}
		t := old.Add(d.TotalAmount)
		d.OldDebt, d.TotalDebt = &old, &t
	}
	if err := decorate(ctx, q, &d); err != nil {
		return nil, err
	}
	return &d, nil
}

// Filter là bộ lọc danh sách chứng từ.
type Filter struct {
	util.ListParams
	Type        []string
	Status      string
	PartnerID   *int64
	WarehouseID *int64
	ProductID   *int64
	From, To    *util.Date
}

// List liệt kê chứng từ (mới nhất trước).
// ListResult là danh sách phân trang kèm tổng tiền của MỌI dòng khớp bộ lọc (không chỉ trang hiện tại).
type ListResult struct {
	util.Page[Summary]
	SumTotalAmount decimal.Decimal `json:"sum_total_amount"`
}

func (s *Service) List(ctx context.Context, f Filter) (ListResult, error) {
	var w util.Where
	if len(f.Type) > 0 {
		ft, err := loadFeats(ctx, s.Pool)
		if err != nil {
			return ListResult{}, err
		}
		for _, t := range f.Type {
			if !validType(t, ft) {
				return ListResult{}, apperr.ValidationField("type", "Loại chứng từ không hợp lệ: "+t)
			}
		}
		w.Add(`d.doc_type = ANY(?)`, f.Type)
	}
	if f.Status != "" {
		if f.Status != StatusDraft && f.Status != StatusPosted {
			return ListResult{}, apperr.ValidationField("status", "status phải là draft hoặc posted")
		}
		w.Add(`d.status = ?`, f.Status)
	}
	if f.PartnerID != nil {
		w.Add(`d.partner_id = ?`, *f.PartnerID)
	}
	if f.WarehouseID != nil {
		w.Add(`(d.warehouse_id = ? OR d.to_warehouse_id = ?)`, *f.WarehouseID, *f.WarehouseID)
	}
	if f.ProductID != nil {
		w.Add(`EXISTS (SELECT 1 FROM document_lines l WHERE l.document_id=d.id AND l.product_id=?)`, *f.ProductID)
	}
	if f.From != nil {
		w.Add(`d.doc_date >= ?`, *f.From)
	}
	if f.To != nil {
		w.Add(`d.doc_date <= ?`, *f.To)
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		// Đối tác: mọi từ có mặt (thứ tự bất kỳ, không dấu, bỏ dấu câu) — như ô tìm đối tác.
		cond := `(upper(COALESCE(d.doc_no,'')) LIKE upper(` + w.Arg("%"+q+"%") + `) OR upper(d.draft_no) LIKE upper(` + w.Arg("%"+q+"%") + `)
			OR kho_fold(d.note) LIKE ` + w.Arg(util.LikePattern(q))
		if pm := util.PartnerMatchSQL(&w, "p", util.SearchTokens(q)); pm != "" {
			cond += ` OR COALESCE(` + pm + `, FALSE)`
		}
		w.Add(cond + `)`)
	}
	res := ListResult{Page: util.Page[Summary]{Page: f.Page, PageSize: f.PageSize, Items: []Summary{}}, SumTotalAmount: decimal.Zero}
	out := &res.Page
	from := ` FROM documents d LEFT JOIN partners p ON p.id=d.partner_id`
	if err := s.Pool.QueryRow(ctx, `SELECT count(*), COALESCE(sum(d.total_amount), 0)`+from+w.SQL(), w.Args...).Scan(&out.Total, &res.SumTotalAmount); err != nil {
		return res, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT d.id, d.doc_type, d.doc_no, d.draft_no, d.doc_date, d.status, d.partner_id, p.name,
		d.warehouse_id, w.name, d.to_warehouse_id, tw.name, d.note, d.total_amount,
		(SELECT count(*) FROM document_lines l WHERE l.document_id=d.id)::int, d.version, cu.full_name, uu.full_name, d.posted_at, d.updated_at`+from+`
		JOIN warehouses w ON w.id=d.warehouse_id LEFT JOIN warehouses tw ON tw.id=d.to_warehouse_id
		LEFT JOIN users cu ON cu.id=d.created_by LEFT JOIN users uu ON uu.id=d.updated_by`+w.SQL()+
		` ORDER BY d.doc_date DESC, d.id DESC LIMIT `+w.Arg(f.PageSize)+` OFFSET `+w.Arg(f.Offset()), w.Args...)
	if err != nil {
		return res, err
	}
	defer rows.Close()
	for rows.Next() {
		var x Summary
		if err := rows.Scan(&x.ID, &x.DocType, &x.DocNo, &x.DraftNo, &x.DocDate, &x.Status, &x.PartnerID, &x.PartnerName,
			&x.WarehouseID, &x.WarehouseName, &x.ToWarehouseID, &x.ToWarehouse, &x.Note, &x.TotalAmount,
			&x.LineCount, &x.Version, &x.CreatedByName, &x.UpdatedByName, &x.PostedAt, &x.UpdatedAt); err != nil {
			return res, err
		}
		x.DocTypeName = TypeNames[x.DocType]
		x.DisplayNo = x.DraftNo
		if x.Status == StatusPosted && x.DocNo != nil {
			x.DisplayNo = *x.DocNo
		}
		out.Items = append(out.Items, x)
	}
	return res, rows.Err()
}

// History trả nhật ký thay đổi của một thực thể (document | voucher ...).
func History(ctx context.Context, q db.Q, entity string, id int64) ([]HistoryEntry, error) {
	rows, err := q.Query(ctx, `SELECT a.id, a.at, a.user_id, u.full_name, a.action, a.before, a.after
		FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity=$1 AND a.entity_id=$2 ORDER BY a.at, a.id`, entity, id)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[HistoryEntry])
	if out == nil {
		out = []HistoryEntry{}
	}
	return out, err
}

// checkLock: khóa sổ (bản mở rộng C4) — ngày ≤ ngày khóa ⇒ 422 PERIOD_LOCKED. Tính năng tắt ⇒ không làm gì.
func checkLock(ctx context.Context, q db.Q, dates ...util.Date) error {
	st, err := ext.Load(ctx, q)
	if err != nil {
		return err
	}
	return st.CheckLock(dates...)
}

// checkUpdateLock: phiếu đã ghi sổ ⇒ ngày cũ và ngày mới đều phải ngoài kỳ khóa (không sửa trong kỳ, không đổi ngày
// vào/ra kỳ). Phiếu tạm ⇒ sửa được kể cả trong kỳ khóa, nhưng không được dời ngày từ ngoài vào trong kỳ khóa.
func checkUpdateLock(ctx context.Context, q db.Q, posted bool, oldDate, newDate util.Date) error {
	st, err := ext.Load(ctx, q)
	if err != nil {
		return err
	}
	lock := st.LockDate()
	if lock == nil {
		return nil
	}
	if posted {
		return st.CheckLock(oldDate, newDate)
	}
	if oldDate.After(lock.Time) && !newDate.After(lock.Time) {
		return ext.LockedErr(*lock)
	}
	return nil
}

// ---------- Hạn mức công nợ (bản mở rộng C8) ----------

// CreditInfo là chi tiết cảnh báo vượt hạn mức công nợ.
type CreditInfo struct {
	PartnerID      int64           `json:"partner_id"`
	PartnerName    string          `json:"partner_name"`
	Receivable     decimal.Decimal `json:"receivable"`      // nợ phải thu hiện tại (không gồm phiếu này)
	DocumentAmount decimal.Decimal `json:"document_amount"` // tổng tiền phiếu này
	TotalAfter     decimal.Decimal `json:"total_after"`     // nợ sau khi ghi sổ
	CreditLimit    decimal.Decimal `json:"credit_limit"`
	Over           decimal.Decimal `json:"over"` // vượt bao nhiêu
}

// creditLockClass là lớp khóa advisory của kiểm tra hạn mức (âm: không trùng mã số mặt hàng của khóa tồn kho).
const creditLockClass int32 = -8001

type prevSale struct {
	partnerID *int64
	total     decimal.Decimal
}

// creditCheck: phiếu bán, tính năng credit_limit bật, khách có hạn mức ⇒ nợ phải thu hiện tại (mọi ngày, không gồm phiếu
// này) + tổng phiếu > hạn mức ⇒ trả thông tin cảnh báo. Sửa phiếu đã ghi sổ: chỉ xét khi tổng tiền tăng (cùng khách)
// hoặc đổi sang khách khác.
func creditCheck(ctx context.Context, tx pgx.Tx, h header, newTotal decimal.Decimal, prev *prevSale) (*CreditInfo, error) {
	if h.DocType != TypeSale || h.PartnerID == nil {
		return nil, nil
	}
	st, err := ext.Load(ctx, tx)
	if err != nil {
		return nil, err
	}
	if !st.On(ext.FCreditLimit) {
		return nil, nil
	}
	var limit decimal.NullDecimal
	var name string
	if err := tx.QueryRow(ctx, `SELECT name, credit_limit FROM partners WHERE id=$1`, *h.PartnerID).Scan(&name, &limit); err != nil {
		return nil, err
	}
	if !limit.Valid {
		return nil, nil
	}
	// Khóa advisory theo khách (đến hết transaction) TRƯỚC khi tính nợ: hai phiếu ghi sổ cùng lúc cho cùng khách được xếp
	// hàng, phiếu sau thấy phiếu trước ⇒ không cùng lọt hạn mức (QA Q-05). Lớp khóa âm nên không trùng khóa mặt hàng+kho
	// (luôn lấy trước khóa này ⇒ thứ tự khóa cố định, không deadlock).
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1::int4, $2::int4)`, creditLockClass, int32(*h.PartnerID)); err != nil {
		return nil, err
	}
	rec, err := debt.Balance(ctx, tx, debt.Receivable, *h.PartnerID, nil)
	if err != nil {
		return nil, err
	}
	if prev != nil && prev.partnerID != nil && *prev.partnerID == *h.PartnerID {
		if !newTotal.GreaterThan(prev.total) {
			return nil, nil
		}
		rec = rec.Sub(prev.total) // nợ hiện tại đang gồm bản cũ của phiếu này
	}
	after := rec.Add(newTotal)
	if !after.GreaterThan(limit.Decimal) {
		return nil, nil
	}
	return &CreditInfo{PartnerID: *h.PartnerID, PartnerName: name, Receivable: rec, DocumentAmount: newTotal,
		TotalAfter: after, CreditLimit: limit.Decimal, Over: after.Sub(limit.Decimal)}, nil
}

// confirmations gộp cảnh báo bán lỗ và vượt hạn mức để người dùng xác nhận một lần:
// còn vượt hạn mức chưa xác nhận ⇒ 409 CREDIT_WARNING (kèm các dòng lỗ chưa xác nhận nếu có);
// chỉ còn bán lỗ ⇒ 409 LOSS_WARNING như cũ.
func confirmations(lw []Warning, ci *CreditInfo, confirmLoss, confirmCredit bool) error {
	lossPending := len(lw) > 0 && !confirmLoss
	if ci != nil && !confirmCredit {
		need := []string{"confirm_credit"}
		loss := []Warning{}
		msg := fmt.Sprintf("Khách %s vượt hạn mức công nợ: nợ hiện tại %s + phiếu này %s = %s, hạn mức %s (vượt %s). Bấm xác nhận để vẫn ghi sổ.",
			ci.PartnerName, util.FormatVND(ci.Receivable), util.FormatVND(ci.DocumentAmount), util.FormatVND(ci.TotalAfter),
			util.FormatVND(ci.CreditLimit), util.FormatVND(ci.Over))
		if lossPending {
			need = append(need, "confirm_loss")
			loss = lw
			msg += " Phiếu cũng có mặt hàng bán thấp hơn giá mua (bán lỗ)."
		}
		return apperr.New(http.StatusConflict, apperr.CodeCreditWarning, msg,
			map[string]any{"credit": ci, "loss_lines": loss, "confirm": need})
	}
	if lossPending {
		return lossErr(lw)
	}
	return nil
}
