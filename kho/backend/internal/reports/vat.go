package reports

import (
	"context"

	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/util"
)

// VatSide là bảng kê thuế một phía (bán ra / mua vào), trả hàng trừ vào.
type VatSide struct {
	Rows     []VatSummaryRow `json:"rows"`
	Totals   VatSummaryRow   `json:"totals"`
	DocCount int             `json:"document_count"`
}

// VatReport là bảng kê thuế GTGT theo thuế suất trong kỳ (C11).
type VatReport struct {
	From      util.Date `json:"from"`
	To        util.Date `json:"to"`
	Sales     *VatSide  `json:"sales"`
	Purchases *VatSide  `json:"purchases"` // null khi người xem không có quyền xem giá vốn
}

// VatSummary tính bảng kê thuế theo thuế suất: bán ra = bán − khách trả; mua vào = mua − trả NCC (phiếu đã ghi sổ).
func (s *Service) VatSummary(ctx context.Context, from, to util.Date, withPurchases bool) (*VatReport, error) {
	if to.Before(from.Time) {
		return nil, apperr.ValidationField("to", "Ngày kết thúc phải sau ngày bắt đầu")
	}
	rows, err := s.Pool.Query(ctx, `SELECT d.doc_type IN ('sale', 'sale_return'), l.vat_rate,
			sum(CASE WHEN d.doc_type IN ('sale', 'purchase') THEN l.amount ELSE -l.amount END),
			sum(CASE WHEN d.doc_type IN ('sale', 'purchase') THEN l.tax_amount ELSE -l.tax_amount END)
		FROM document_lines l JOIN documents d ON d.id = l.document_id
		WHERE d.status = 'posted' AND d.doc_type IN ('sale', 'sale_return', 'purchase', 'purchase_return') AND d.doc_date BETWEEN $1 AND $2
		GROUP BY 1, 2`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sides := map[bool]*VatSide{true: newSide(), false: newSide()}
	keys := map[bool][]string{}
	byKey := map[bool]map[string]*VatSummaryRow{true: {}, false: {}}
	for rows.Next() {
		var sale bool
		var r VatSummaryRow
		if err := rows.Scan(&sale, &r.VatRate, &r.GoodsAmount, &r.TaxAmount); err != nil {
			return nil, err
		}
		r.Label = VatLabel(r.VatRate)
		r.Total = r.GoodsAmount.Add(r.TaxAmount)
		rr := r
		byKey[sale][r.Label] = &rr
		keys[sale] = append(keys[sale], r.Label)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, sale := range []bool{true, false} {
		ks := keys[sale]
		sortVatKeys(ks, byKey[sale])
		side := sides[sale]
		for _, k := range ks {
			r := *byKey[sale][k]
			side.Rows = append(side.Rows, r)
			side.Totals.GoodsAmount = side.Totals.GoodsAmount.Add(r.GoodsAmount)
			side.Totals.TaxAmount = side.Totals.TaxAmount.Add(r.TaxAmount)
			side.Totals.Total = side.Totals.Total.Add(r.Total)
		}
		types := []string{"purchase", "purchase_return"}
		if sale {
			types = []string{"sale", "sale_return"}
		}
		if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM documents WHERE status='posted' AND doc_type = ANY($1) AND doc_date BETWEEN $2 AND $3`,
			types, from, to).Scan(&side.DocCount); err != nil {
			return nil, err
		}
	}
	out := &VatReport{From: from, To: to, Sales: sides[true]}
	if withPurchases {
		out.Purchases = sides[false]
	}
	return out, nil
}

func newSide() *VatSide {
	return &VatSide{Rows: []VatSummaryRow{}, Totals: VatSummaryRow{Label: "Cộng", GoodsAmount: decimal.Zero, TaxAmount: decimal.Zero, Total: decimal.Zero}}
}
