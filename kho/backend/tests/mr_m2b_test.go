package tests

import (
	"context"
	"fmt"
	"math/rand"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"kho/internal/docs"
	"kho/internal/reports"
)

type profitResp struct {
	GroupBy        string              `json:"group_by"`
	Items          []reports.ProfitRow `json:"items"`
	Totals         reports.ProfitRow   `json:"totals"`
	EstimatedLines int                 `json:"estimated_lines"`
}

// C7 — lãi gộp: giá vốn bình quân gia quyền (nhập mua + tồn đầu đến hết ngày bán, mọi kho; trả NCC trừ SL và giá trị theo
// giá của nó; chuyển kho bỏ qua); chưa có nhập ⇒ giá mua mặc định + "ước tính"; dịch vụ giá vốn 0; khách trả hàng giảm
// doanh thu và giá vốn; ba cách nhóm cùng tổng; doanh thu = báo cáo bán hàng; nhập lùi ngày làm thay đổi lãi quá khứ.
func TestMR_C7_LaiGop(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	k1 := e.Partner("K1", "Khách 1", true, false)
	k2 := e.Partner("K2", "Khách 2", true, false)
	sup := e.Partner("NCC", "NCC", false, true)
	a := e.Product("A", "Hàng A", "Cái", 300, 999, 0)
	e.Admin.Expect(404, "FEATURE_OFF", "GET", "/api/reports/profit", nil)
	mrEnable(e, "profit_report", "permissions")
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "10", "100"))
	e.Admin.Posted(DocBody("sale", "2026-01-15", k1, e.WH["KHO1"], Line(a, "2", "150")))
	e.Admin.Posted(DocBody("purchase", "2026-02-01", sup, e.WH["KHO2"], Line(a, "10", "200")))
	e.Admin.Posted(DocBody("purchase_return", "2026-02-10", sup, e.WH["KHO2"], Line(a, "5", "200")))
	e.Admin.Posted(map[string]any{"doc_type": "transfer", "doc_date": "2026-02-12", "warehouse_id": e.WH["KHO2"], "to_warehouse_id": e.WH["KHO1"], "lines": []any{Line(a, "5", nil)}})
	// Ngày 15/02: SL nhập lũy kế 10 + 10 − 5 = 15, giá trị 1.000 + 2.000 − 1.000 = 2.000 ⇒ bình quân 133,33…
	s2 := e.Admin.Posted(DocBody("sale", "2026-02-15", k2, e.WH["KHO1"], Line(a, "3", "300"), map[string]any{"product_id": e.DV, "description": "Phí", "unit_price": 50}))
	e.Admin.Posted(DocBody("sale_return", "2026-02-20", k2, e.WH["KHO1"], Line(a, "1", "300")))
	get := func(by string) profitResp {
		var p profitResp
		e.Admin.OK("GET", "/api/reports/profit?from=2026-01-01&to=2026-12-31&group_by="+by, nil, &p)
		return p
	}
	doc := get("document")
	if len(doc.Items) != 3 {
		t.Fatalf("theo phiếu: %+v", doc.Items)
	}
	// Phiếu 15/01: doanh thu 300, giá vốn 2 × 100 = 200.
	eqDec(t, doc.Items[0].Revenue, "300", "doanh thu 15/01")
	eqDec(t, doc.Items[0].Cost, "200", "giá vốn 15/01")
	// Phiếu 15/02: doanh thu 900 + 50 (dịch vụ), giá vốn round(3 × 133,33…) = 400, dịch vụ 0.
	if *doc.Items[1].DocumentID != s2.ID {
		t.Fatalf("thứ tự phiếu: %+v", doc.Items)
	}
	eqDec(t, doc.Items[1].Revenue, "950", "doanh thu 15/02")
	eqDec(t, doc.Items[1].Cost, "400", "giá vốn bình quân")
	eqDec(t, doc.Items[1].Profit, "550", "lãi")
	eqDec(t, *doc.Items[1].Margin, "57.89", "tỷ lệ lãi")
	// Khách trả 20/02: doanh thu −300, giá vốn −133.
	eqDec(t, doc.Items[2].Revenue, "-300", "trả hàng giảm doanh thu")
	eqDec(t, doc.Items[2].Cost, "-133", "trả hàng giảm giá vốn")
	eqDec(t, doc.Totals.Revenue, "950", "tổng doanh thu")
	eqDec(t, doc.Totals.Cost, "467", "tổng giá vốn")
	if doc.EstimatedLines != 0 {
		t.Fatalf("không có dòng ước tính: %d", doc.EstimatedLines)
	}
	// Ba cách nhóm cùng tổng; doanh thu = báo cáo bán hàng (gồm trả hàng).
	prod, cus := get("product"), get("customer")
	for _, g := range []profitResp{prod, cus} {
		if !g.Totals.Revenue.Equal(doc.Totals.Revenue) || !g.Totals.Cost.Equal(doc.Totals.Cost) || !g.Totals.Profit.Equal(doc.Totals.Profit) {
			t.Fatalf("%s: tổng khác theo phiếu: %+v vs %+v", g.GroupBy, g.Totals, doc.Totals)
		}
		sumR, sumC := decimal.Zero, decimal.Zero
		for _, x := range g.Items {
			sumR, sumC = sumR.Add(x.Revenue), sumC.Add(x.Cost)
		}
		if !sumR.Equal(g.Totals.Revenue) || !sumC.Equal(g.Totals.Cost) {
			t.Fatalf("%s: cộng dòng ≠ tổng", g.GroupBy)
		}
	}
	var sr reports.Trade
	e.Admin.OK("GET", "/api/reports/sales?from=2026-01-01&to=2026-12-31&include_returns=true", nil, &sr)
	if !sr.TotalAmount.Equal(doc.Totals.Revenue) {
		t.Fatalf("doanh thu lãi gộp %s ≠ báo cáo bán %s", doc.Totals.Revenue, sr.TotalAmount)
	}
	for _, x := range prod.Items {
		if *x.ProductCode == "A" {
			eqDec(t, *x.Qty, "4", "SL bán ròng A = 2 + 3 − 1")
		}
		if *x.ProductCode == "DV" && !x.Cost.IsZero() {
			t.Fatal("dịch vụ giá vốn 0")
		}
	}
	// Ước tính: mã chưa có lượng nhập mua / tồn đầu nào (tồn chỉ đến từ khách trả hàng) ⇒ giá mua mặc định 70.
	cc := e.Product("CC", "Hàng chưa nhập", "Cái", 100, 70, 0)
	e.Admin.Posted(DocBody("sale_return", "2026-03-05", k1, e.WH["KHO4"], Line(cc, "4", "100")))
	sCC := e.Admin.Posted(DocBody("sale", "2026-03-10", k1, e.WH["KHO4"], Line(cc, "2", "100")))
	p3 := get("document")
	found := false
	for _, x := range p3.Items {
		if *x.DocumentID == sCC.ID {
			found = true
			if !x.Estimated || !x.Cost.Equal(d("140")) {
				t.Fatalf("ước tính theo giá mua mặc định: %+v", x)
			}
		}
	}
	if !found || p3.EstimatedLines != 2 || !p3.Totals.Estimated {
		t.Fatalf("dòng ước tính (trả hàng + bán CC): %d", p3.EstimatedLines)
	}
	// Nhập mua lùi ngày (10/01, giá 400) ⇒ lãi phiếu 15/01 được tính lại: bình quân (1.000 + 4.000) / 20 = 250.
	e.Admin.Posted(DocBody("purchase", "2026-01-10", sup, e.WH["KHO1"], Line(a, "10", "400")))
	doc = get("document")
	eqDec(t, doc.Items[0].Cost, "500", "giá vốn 15/01 sau khi nhập lùi ngày")
	// Xuất Excel; quyền: cần cost.view + report.view.
	rows := xlsxRows(t, e.Admin.OK("GET", "/api/reports/profit?from=2026-01-01&to=2026-12-31&group_by=customer&format=xlsx", nil, nil).Body)
	if tot := findRow(rows, 0, "Cộng"); tot == nil || tot[3] != doc.Totals.Revenue.String() {
		t.Fatalf("xlsx lãi gộp: %q", tot)
	}
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/reports/profit?group_by=abc", nil)
	mrEnable(e, "permissions")
	bh := mrUser(e, "bh", "banhang")
	bh.Expect(403, "FORBIDDEN", "GET", "/api/reports/profit", nil)
}

// C8 — kiểm tra tính chất: với chuỗi thao tác ngẫu nhiên (bán, khách trả, thu tiền, trả lại tiền khách, nợ đầu kỳ, sửa lùi
// ngày phiếu đã ghi sổ), ở mọi ngày xét: tổng các cột tuổi nợ của từng khách = số dư sổ công nợ cùng ngày; các cột ≥ 0,
// cột trả trước ≤ 0 và chỉ khác 0 khi không còn khoản nợ mở; tổng cộng = cộng các dòng.
func TestMR_C8_TuoiNoKhopSoCongNo_NgauNhien(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "credit_limit")
	rng := rand.New(rand.NewSource(20261115))
	svc := func(amount int) map[string]any {
		return map[string]any{"product_id": e.DV, "description": "DV", "unit_price": amount}
	}
	day := func() string { return fmt.Sprintf("2026-%02d-%02d", 1+rng.Intn(6), 1+rng.Intn(28)) }
	cases, opsPerCase := 12, 30
	if testing.Short() {
		cases = 3
	}
	for cs := 0; cs < cases; cs++ {
		var custs []int64
		for i := 0; i < 3; i++ {
			body := map[string]any{"code": fmt.Sprintf("C%d_%d", cs, i), "name": "Khách ngẫu nhiên", "is_customer": true}
			switch rng.Intn(4) {
			case 1:
				body["payment_days"] = 0
			case 2:
				body["payment_days"] = 15
			case 3:
				body["payment_days"] = 45
			}
			var x struct {
				ID int64 `json:"id"`
			}
			e.Admin.OK("POST", "/api/partners", body, &x)
			custs = append(custs, x.ID)
		}
		var posted []*docs.Document
		for op := 0; op < opsPerCase; op++ {
			c := custs[rng.Intn(len(custs))]
			switch rng.Intn(7) {
			case 0, 1:
				amt := 100 * (1 + rng.Intn(50))
				if rng.Intn(10) == 0 {
					amt = -amt // phiếu bán chỉ có dòng giảm trừ
				}
				posted = append(posted, e.Admin.Posted(DocBody("sale", day(), c, e.WH["KHO1"], svc(amt))))
			case 2:
				e.Admin.Posted(DocBody("sale_return", day(), c, e.WH["KHO1"], svc(100*(1+rng.Intn(20)))))
			case 3:
				e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "voucher_date": day(), "account_id": e.TM, "partner_id": c, "lines": []any{map[string]any{"amount": 100 * (1 + rng.Intn(40))}}})
			case 4:
				e.Admin.Voucher(map[string]any{"voucher_type": "payment", "debt_side": "receivable", "voucher_date": day(), "account_id": e.TM, "partner_id": c, "lines": []any{map[string]any{"amount": 100 * (1 + rng.Intn(10))}}})
			case 5:
				idx := 0
				for i, x := range custs {
					if x == c {
						idx = i
					}
				}
				e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", c), map[string]any{"code": fmt.Sprintf("C%d_%d", cs, idx), "name": "Khách ngẫu nhiên",
					"is_customer": true, "opening_receivable": 100 * (rng.Intn(60) - 10)}, nil)
			case 6:
				if len(posted) > 0 {
					d := posted[rng.Intn(len(posted))]
					cur := e.Admin.GetDoc(d.ID)
					e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", d.ID), map[string]any{"version": cur.Version, "doc_date": day(), "partner_id": *cur.PartnerID,
						"warehouse_id": e.WH["KHO1"], "lines": []any{svc(100 * (1 + rng.Intn(60)))}}, nil)
				}
			}
		}
		for _, asOf := range []string{"2026-01-31", "2026-03-15", "2026-06-30", "2026-12-31"} {
			var a agingResp
			e.Admin.OK("GET", "/api/reports/debt-aging?as_of="+asOf, nil, &a)
			seen := map[int64]reports.AgingRow{}
			sum := decimal.Zero
			for _, x := range a.Items {
				seen[x.PartnerID] = x
				sum = sum.Add(x.Total)
				cols := x.InTerm.Add(x.D1to30).Add(x.D31to60).Add(x.D61to90).Add(x.Over90).Add(x.Opening).Add(x.Prepaid)
				if !cols.Equal(x.Total) {
					t.Fatalf("ca %d ngày %s %s: cộng cột %s ≠ tổng %s", cs, asOf, x.PartnerCode, cols, x.Total)
				}
				for _, v := range []decimal.Decimal{x.InTerm, x.D1to30, x.D31to60, x.D61to90, x.Over90, x.Opening} {
					if v.IsNegative() {
						t.Fatalf("cột âm: %+v", x)
					}
				}
				if x.Prepaid.IsPositive() || (!x.Prepaid.IsZero() && !x.Total.Equal(x.Prepaid)) {
					t.Fatalf("trả trước chỉ khi không còn nợ mở: %+v", x)
				}
			}
			if !sum.Equal(a.Totals.Total) {
				t.Fatalf("tổng cộng %s ≠ cộng dòng %s", a.Totals.Total, sum)
			}
			for _, c := range custs {
				want := e.debtAt(c, asOf)
				got := decimal.Zero
				if x, ok := seen[c]; ok {
					got = x.Total
				}
				if !got.Equal(want) {
					t.Fatalf("ca %d ngày %s khách %d: tuổi nợ %s ≠ sổ công nợ %s", cs, asOf, c, got, want)
				}
			}
		}
	}
}

// Hiệu năng: ~20.000 chứng từ / 100.000 dòng — tuổi nợ và lãi gộp trả lời trong vài giây.
func TestMR_C7_C8_HieuNang(t *testing.T) {
	if raceEnabled || testing.Short() {
		t.Skip("bỏ qua khi chạy -race / -short (chỉ đo thời gian)")
	}
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "profit_report", "credit_limit")
	ctx := context.Background()
	start := time.Now()
	_, err := e.Pool.Exec(ctx, `
INSERT INTO products(code, name, unit, sale_price, purchase_price, search_key)
SELECT 'SP'||i, 'Sản phẩm '||i, 'Cái', 1000 + i, 500 + i, 'sp'||i FROM generate_series(1, 2000) i;
INSERT INTO partners(code, name, is_customer, is_supplier, payment_days, search_key)
SELECT 'KH'||i, 'Khách '||i, TRUE, TRUE, (i % 4) * 15, 'kh'||i FROM generate_series(1, 500) i;
INSERT INTO documents(doc_type, doc_no, draft_no, doc_date, status, partner_id, warehouse_id, total_amount, posted_at)
SELECT CASE WHEN i <= 2000 THEN 'purchase' ELSE 'sale' END, 'PF'||i, 'GF'||i,
       DATE '2026-01-01' + (i % 300), 'posted', (SELECT min(id) FROM partners) + (i % 500), (SELECT min(id) FROM warehouses), 0, now()
  FROM generate_series(1, 20000) i;
INSERT INTO document_lines(document_id, line_no, product_id, qty, unit_price, amount)
SELECT d.id, n, (SELECT min(id) FROM products WHERE code LIKE 'SP%') + ((d.id * 7 + n * 13) % 2000), 1 + n,
       CASE WHEN d.doc_type = 'purchase' THEN 600 ELSE 1500 END, (1 + n) * CASE WHEN d.doc_type = 'purchase' THEN 600 ELSE 1500 END
  FROM documents d CROSS JOIN generate_series(1, 5) n WHERE d.doc_no LIKE 'PF%';
UPDATE documents d SET total_amount = x.s FROM (SELECT document_id, sum(amount) s FROM document_lines GROUP BY document_id) x WHERE x.document_id = d.id AND d.doc_no LIKE 'PF%';
INSERT INTO cash_vouchers(voucher_type, voucher_no, voucher_date, account_id, partner_id, total_amount, debt_side)
SELECT 'receipt', 'PTF'||i, DATE '2026-01-01' + (i % 300), (SELECT min(id) FROM cash_accounts), (SELECT min(id) FROM partners) + (i % 500), 20000, 'receivable'
  FROM generate_series(1, 5000) i;`)
	if err != nil {
		t.Fatal(err)
	}
	var nLines int
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM document_lines`).Scan(&nLines)
	t.Logf("tạo dữ liệu: %d dòng chứng từ trong %v", nLines, time.Since(start).Round(time.Millisecond))
	for _, path := range []string{
		"/api/reports/debt-aging?as_of=2026-12-31",
		"/api/reports/profit?from=2026-01-01&to=2026-12-31&group_by=document",
		"/api/reports/profit?from=2026-01-01&to=2026-12-31&group_by=product",
		"/api/reports/profit?from=2026-01-01&to=2026-12-31&group_by=customer",
		"/api/reports/profit?from=2026-01-01&to=2026-12-31&group_by=product&format=xlsx",
	} {
		t0 := time.Now()
		r := e.Admin.Do("GET", path, nil)
		el := time.Since(t0)
		t.Logf("%-75s %v (%d KB)", path, el.Round(time.Millisecond), len(r.Body)/1024)
		if r.Status != 200 {
			t.Fatalf("%s: %d %s", path, r.Status, r.Body[:200])
		}
		if el > 10*time.Second {
			t.Fatalf("%s quá chậm: %v", path, el)
		}
	}
	var p profitResp
	e.Admin.OK("GET", "/api/reports/profit?from=2026-01-01&to=2026-12-31&group_by=customer", nil, &p)
	var a agingResp
	e.Admin.OK("GET", "/api/reports/debt-aging?as_of=2026-12-31", nil, &a)
	if len(p.Items) == 0 || len(a.Items) != 500 {
		t.Fatalf("số dòng: lãi %d, tuổi nợ %d", len(p.Items), len(a.Items))
	}
}
