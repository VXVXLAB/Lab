// Package debt: công nợ phải thu khách hàng / phải trả nhà cung cấp, tính động từ chứng từ (R8).
package debt

import (
	"context"
	"fmt"
	"time"

	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/db"
	"kho/internal/util"
)

// Side là phía công nợ.
const (
	Receivable = "receivable"
	Payable    = "payable"
)

// ValidSide kiểm tra tham số side.
func ValidSide(side string) error {
	if side != Receivable && side != Payable {
		return apperr.ValidationField("side", "side phải là receivable (phải thu) hoặc payable (phải trả)")
	}
	return nil
}

// EntriesSQL trả câu SELECT các bút toán công nợ của một phía, cột:
// partner_id, kind('document'|'voucher'), ref_id, date, ts, ref_no, ref_type, increase, decrease, description.
// Chỉ chứng từ đã ghi sổ. Phiếu thu/chi luôn có hiệu lực và thuộc phía ghi ở cash_vouchers.debt_side:
//   - phía phải thu: phiếu thu làm GIẢM (khách trả tiền), phiếu chi làm TĂNG (trả lại tiền cho khách);
//   - phía phải trả: phiếu chi làm GIẢM (trả tiền NCC), phiếu thu làm TĂNG (NCC hoàn tiền cho mình).
func EntriesSQL(side string) string {
	incType, decType, decVoucher := "sale", "sale_return", "receipt"
	if side == Payable {
		incType, decType, decVoucher = "purchase", "purchase_return", "payment"
	}
	return fmt.Sprintf(`
SELECT d.partner_id, 'document'::text AS kind, d.id AS ref_id, d.doc_date AS date, d.posted_at AS ts,
       COALESCE(d.doc_no, d.draft_no) AS ref_no, d.doc_type AS ref_type,
       CASE WHEN d.doc_type='%[1]s' THEN d.total_amount ELSE 0 END AS increase,
       CASE WHEN d.doc_type='%[2]s' THEN d.total_amount ELSE 0 END AS decrease,
       (CASE d.doc_type WHEN 'sale' THEN 'Bán hàng' WHEN 'sale_return' THEN 'Khách trả hàng'
                        WHEN 'purchase' THEN 'Mua hàng' ELSE 'Trả hàng nhà cung cấp' END)
         || CASE WHEN d.note <> '' THEN ' - ' || d.note ELSE '' END AS description
  FROM documents d
 WHERE d.status='posted' AND d.partner_id IS NOT NULL AND d.doc_type IN ('%[1]s','%[2]s')
UNION ALL
SELECT v.partner_id, 'voucher'::text, v.id, v.voucher_date, v.created_at, v.voucher_no, v.voucher_type,
       CASE WHEN v.voucher_type <> '%[3]s' THEN v.total_amount ELSE 0 END,
       CASE WHEN v.voucher_type = '%[3]s' THEN v.total_amount ELSE 0 END,
       (CASE WHEN v.voucher_type='receipt' THEN 'Thu tiền' ELSE 'Chi tiền' END)
         || CASE WHEN a.kind='bank' THEN ' qua ngân hàng' ELSE ' mặt' END
         || CASE WHEN v.voucher_type <> '%[3]s' THEN (CASE WHEN v.voucher_type='receipt' THEN ' (nhà cung cấp hoàn tiền)' ELSE ' (trả lại tiền khách)' END) ELSE '' END
         || COALESCE(' - ' || NULLIF(v.note,''), ' - ' || NULLIF((SELECT string_agg(NULLIF(l.description,''), '; ' ORDER BY l.line_no) FROM cash_voucher_lines l WHERE l.voucher_id=v.id), ''), '')
  FROM cash_vouchers v JOIN cash_accounts a ON a.id=v.account_id
 WHERE v.partner_id IS NOT NULL AND v.debt_side='%[4]s'`, incType, decType, decVoucher, side)
}

func openingCol(side string) string {
	if side == Payable {
		return "opening_payable"
	}
	return "opening_receivable"
}

// BalanceBeforeDocument trả số dư công nợ của đối tác ngay trước chứng từ (theo ngày + thứ tự ghi sổ).
// Chứng từ chưa ghi sổ (posted_at nil): tính mọi bút toán có ngày ≤ ngày chứng từ.
func BalanceBeforeDocument(ctx context.Context, q db.Q, side string, partnerID, docID int64, date util.Date, postedAt *time.Time) (decimal.Decimal, error) {
	var bal decimal.Decimal
	var err error
	if postedAt == nil {
		err = q.QueryRow(ctx, `SELECT p.`+openingCol(side)+` + COALESCE((SELECT sum(e.increase - e.decrease) FROM (`+EntriesSQL(side)+`) e
			WHERE e.partner_id=$1 AND e.date <= $2), 0) FROM partners p WHERE p.id=$1`, partnerID, date).Scan(&bal)
	} else {
		err = q.QueryRow(ctx, `SELECT p.`+openingCol(side)+` + COALESCE((SELECT sum(e.increase - e.decrease) FROM (`+EntriesSQL(side)+`) e
			WHERE e.partner_id=$1 AND (e.date, e.ts, e.kind, e.ref_id) < ($2::date, $3::timestamptz, 'document'::text, $4::bigint)), 0)
			FROM partners p WHERE p.id=$1`, partnerID, date, *postedAt, docID).Scan(&bal)
	}
	return bal, err
}

// Balance trả số dư công nợ của đối tác đến hết ngày asOf (nil = tất cả).
func Balance(ctx context.Context, q db.Q, side string, partnerID int64, asOf *util.Date) (decimal.Decimal, error) {
	var bal decimal.Decimal
	var d any
	if asOf != nil {
		d = *asOf
	}
	err := q.QueryRow(ctx, `SELECT p.`+openingCol(side)+` + COALESCE((SELECT sum(e.increase - e.decrease) FROM (`+EntriesSQL(side)+`) e
		WHERE e.partner_id=$1 AND ($2::date IS NULL OR e.date <= $2::date)), 0) FROM partners p WHERE p.id=$1`, partnerID, d).Scan(&bal)
	return bal, err
}

// Total trả tổng công nợ một phía của mọi đối tác.
func Total(ctx context.Context, q db.Q, side string) (decimal.Decimal, error) {
	var t decimal.Decimal
	err := q.QueryRow(ctx, `SELECT COALESCE((SELECT sum(`+openingCol(side)+`) FROM partners),0)
		+ COALESCE((SELECT sum(e.increase - e.decrease) FROM (`+EntriesSQL(side)+`) e),0)`).Scan(&t)
	return t, err
}

// BalanceExcluding trả số dư một phía của đối tác đến hết ngày asOf (nil = mọi ngày), bỏ qua một chứng từ và/hoặc
// một phiếu thu chi (dùng cho "nợ trước phiếu này" khi đang lập/sửa phiếu).
func BalanceExcluding(ctx context.Context, q db.Q, side string, partnerID int64, asOf *util.Date, exDoc, exVoucher *int64) (decimal.Decimal, error) {
	var bal decimal.Decimal
	var d, xd, xv any
	if asOf != nil {
		d = *asOf
	}
	if exDoc != nil {
		xd = *exDoc
	}
	if exVoucher != nil {
		xv = *exVoucher
	}
	err := q.QueryRow(ctx, `SELECT p.`+openingCol(side)+` + COALESCE((SELECT sum(e.increase - e.decrease) FROM (`+EntriesSQL(side)+`) e
		WHERE e.partner_id=$1 AND ($2::date IS NULL OR e.date <= $2::date)
		  AND NOT (e.kind='document' AND e.ref_id IS NOT DISTINCT FROM $3::bigint)
		  AND NOT (e.kind='voucher' AND e.ref_id IS NOT DISTINCT FROM $4::bigint)), 0)
		FROM partners p WHERE p.id=$1`, partnerID, d, xd, xv).Scan(&bal)
	return bal, err
}
