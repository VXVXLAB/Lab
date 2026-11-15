package tests

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Số giá vốn "đánh dấu" — không thể tình cờ xuất hiện ở chỗ khác.
var mrCostMarks = []string{
	"777123", "777.123", // giá mua mặc định
	"654321", "654.321", // đơn giá phiếu mua
	"1962963", "1.962.963", // thành tiền phiếu mua 3 × 654.321
	"5439861", "5.439.861", // thành tiền tồn đầu 7 × 777.123
	"313131", "313.131", // nợ phải trả đầu kỳ
	"1621773", "1.621.773", // tổng phải trả = 313.131 + 1.962.963 − 654.321
}

func leaks(body []byte) []string {
	texts := []string{string(body)}
	if len(body) > 4 && body[0] == 'P' && body[1] == 'K' { // xlsx / docx: xem mọi phần trong gói zip
		texts = nil
		for _, c := range zipFilesNoT(body) {
			texts = append(texts, c)
		}
	}
	var out []string
	for _, tx := range texts {
		for _, m := range mrCostMarks {
			if strings.Contains(tx, m) {
				out = append(out, m)
			}
		}
	}
	return out
}

// C1 — người không có quyền "xem giá mua" (vai trò Bán hàng) đi qua MỌI endpoint GET (đối chiếu với router), mọi file
// xuất xlsx/docx, kiểm tra phiếu chưa lưu, lỗi LOSS_WARNING và luồng SSE: không con số giá vốn nào lộ ra.
// Đối chứng: kế toán (có quyền) thấy các con số đó ⇒ bài test không rỗng.
func TestMR_C1_KhongLoGiaVon(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e)
	var sup struct {
		ID int64 `json:"id"`
	}
	e.Admin.OK("POST", "/api/partners", map[string]any{"code": "NCC", "name": "NCC", "is_supplier": true, "opening_payable": 313131}, &sup)
	cus := e.Partner("KH", "Khách", true, false)
	g := e.Group("G", "Nhóm")
	p := e.Product("P", "Hàng giá vốn", "Cái", 990000, 777123, g)
	op := e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "7", nil))
	pur := e.Admin.Posted(DocBody("purchase", "2026-01-05", sup.ID, e.WH["KHO1"], Line(p, "3", "654321")))
	pr := e.Admin.Posted(DocBody("purchase_return", "2026-01-06", sup.ID, e.WH["KHO1"], Line(p, "1", "654321")))
	sale := e.Admin.Posted(DocBody("sale", "2026-01-07", cus, e.WH["KHO1"], Line(p, "1", "500000")))
	draftPur := e.Admin.CreateDoc(DocBody("purchase", "2026-01-08", sup.ID, e.WH["KHO1"], Line(p, "1", nil)))
	tr := e.Admin.Posted(map[string]any{"doc_type": "transfer", "doc_date": "2026-01-09", "warehouse_id": e.WH["KHO1"], "to_warehouse_id": e.WH["KHO2"], "lines": []any{Line(p, "1", nil)}})
	v := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": cus, "lines": []any{map[string]any{"amount": 1000, "document_id": sale.ID}}})
	// Dữ liệu của các tính năng M2: giá riêng, tồn tối thiểu, hạn mức.
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d/prices", cus), map[string]any{"items": []any{map[string]any{"product_id": p, "price": 995000}}}, nil)
	e.Admin.OK("PUT", fmt.Sprintf("/api/products/%d", p), map[string]any{"code": "P", "name": "Hàng giá vốn", "unit": "Cái", "sale_price": 990000, "purchase_price": 777123, "group_id": g, "min_stock": 100}, nil)
	e.Admin.OK("PUT", fmt.Sprintf("/api/partners/%d", cus), map[string]any{"code": "KH", "name": "Khách", "is_customer": true, "credit_limit": 50000000, "payment_days": 30}, nil)
	bh := mrUser(e, "banhang1", "banhang")
	kt := mrUser(e, "ketoan1", "ketoan")
	docsIDs := []int64{op.ID, pur.ID, pr.ID, sale.ID, draftPur.ID, tr.ID}

	urls := map[string][]string{
		"/api/health":                   {"/api/health"},
		"/api/auth/me":                  {"/api/auth/me"},
		"/api/features":                 {"/api/features"},
		"/api/role-permissions":         {"/api/role-permissions"},
		"/api/period-lock":              {"/api/period-lock"},
		"/api/import/{kind}/template":   {"/api/import/products/template", "/api/import/partners/template", "/api/import/opening_stock/template", "/api/import/opening_debt/template"},
		"/api/users":                    {"/api/users"},
		"/api/settings":                 {"/api/settings"},
		"/api/warehouses":               {"/api/warehouses"},
		"/api/warehouses/{id}":          {fmt.Sprintf("/api/warehouses/%d", e.WH["KHO1"])},
		"/api/product-groups":           {"/api/product-groups"},
		"/api/product-groups/{id}":      {fmt.Sprintf("/api/product-groups/%d", g)},
		"/api/products":                 {"/api/products", "/api/products?with_stock=true&warehouse_id=1", "/api/products?q=gia%20von"},
		"/api/products/{id}":            {fmt.Sprintf("/api/products/%d", p)},
		"/api/products/lookup":          {"/api/products/lookup?code=P", "/api/products/lookup?code=P&optional=1"},
		"/api/products/price-info":      {fmt.Sprintf("/api/products/price-info?ids=%d&warehouse_id=1", p), fmt.Sprintf("/api/products/price-info?ids=%d&date=2026-01-05", p)},
		"/api/products/{id}/price-info": {fmt.Sprintf("/api/products/%d/price-info", p), fmt.Sprintf("/api/products/%d/price-info?date=2026-01-02", p)},
		"/api/partners":                 {"/api/partners", "/api/partners?type=supplier"},
		"/api/partners/{id}":            {fmt.Sprintf("/api/partners/%d", sup.ID)},
		"/api/partners/{id}/balance":    {fmt.Sprintf("/api/partners/%d/balance", sup.ID), fmt.Sprintf("/api/partners/%d/balance", cus)},
		"/api/cash-accounts":            {"/api/cash-accounts"},
		"/api/cash-accounts/{id}":       {fmt.Sprintf("/api/cash-accounts/%d", e.TM)},
		"/api/documents":                {"/api/documents", "/api/documents?type=purchase", "/api/documents?type=sale", "/api/documents?type=purchase_return", "/api/documents?type=opening", "/api/documents?status=draft"},
		"/api/vouchers":                 {"/api/vouchers"},
		"/api/vouchers/{id}":            {fmt.Sprintf("/api/vouchers/%d", v.ID)},
		"/api/vouchers/{id}/export":     {fmt.Sprintf("/api/vouchers/%d/export?format=xlsx", v.ID), fmt.Sprintf("/api/vouchers/%d/export?format=docx", v.ID)},
		"/api/vouchers/{id}/history":    {fmt.Sprintf("/api/vouchers/%d/history", v.ID)},
		"/api/reports/stock-summary":    {"/api/reports/stock-summary", "/api/reports/stock-summary?format=xlsx", "/api/reports/stock-summary?format=docx"},
		"/api/reports/stock-nxt":        {"/api/reports/stock-nxt?from=2026-01-01&to=2026-12-31", "/api/reports/stock-nxt?from=2026-01-01&to=2026-12-31&format=xlsx"},
		"/api/reports/stock-ledger":     {fmt.Sprintf("/api/reports/stock-ledger?product_id=%d", p), fmt.Sprintf("/api/reports/stock-ledger?product_id=%d&warehouse_id=1&format=xlsx", p), fmt.Sprintf("/api/reports/stock-ledger?product_id=%d&format=docx", p)},
		"/api/reports/sales":            {"/api/reports/sales?from=2026-01-01&to=2026-12-31&include_returns=true", "/api/reports/sales?from=2026-01-01&to=2026-12-31&format=xlsx"},
		"/api/reports/purchases":        {"/api/reports/purchases?from=2026-01-01&to=2026-12-31", "/api/reports/purchases?from=2026-01-01&to=2026-12-31&format=xlsx"},
		"/api/reports/debt-summary":     {"/api/reports/debt-summary?side=receivable", "/api/reports/debt-summary?side=payable", "/api/reports/debt-summary?side=payable&format=xlsx"},
		"/api/reports/debt-ledger":      {fmt.Sprintf("/api/reports/debt-ledger?side=payable&partner_id=%d", sup.ID), fmt.Sprintf("/api/reports/debt-ledger?side=receivable&partner_id=%d&format=xlsx", cus)},
		"/api/reports/cash-book":        {"/api/reports/cash-book", "/api/reports/cash-book?format=xlsx"},
		"/api/reports/draft-demand":     {"/api/reports/draft-demand", "/api/reports/draft-demand?format=xlsx"},
		"/api/dashboard":                {"/api/dashboard"},
		"/api/reports/low-stock":        {"/api/reports/low-stock", "/api/reports/low-stock?format=xlsx"},
		"/api/reports/debt-aging":       {"/api/reports/debt-aging", "/api/reports/debt-aging?format=xlsx", "/api/reports/debt-aging?format=docx"},
		"/api/reports/profit":           {"/api/reports/profit?from=2026-01-01&to=2026-12-31", "/api/reports/profit?from=2026-01-01&to=2026-12-31&group_by=product&format=xlsx", "/api/reports/profit?from=2026-01-01&to=2026-12-31&group_by=customer"},
		"/api/partners/{id}/prices":     {fmt.Sprintf("/api/partners/%d/prices", cus)},
		"/api/products/sale-price":      {fmt.Sprintf("/api/products/sale-price?partner_id=%d&ids=%d", cus, p)},
		"/api/documents/{id}":           nil,
		"/api/documents/{id}/check":     nil,
		"/api/documents/{id}/export":    nil,
		"/api/documents/{id}/history":   nil,
		"/api/events":                   nil, // kiểm riêng bên dưới
	}
	for _, id := range docsIDs {
		urls["/api/documents/{id}"] = append(urls["/api/documents/{id}"], fmt.Sprintf("/api/documents/%d", id))
		urls["/api/documents/{id}/check"] = append(urls["/api/documents/{id}/check"], fmt.Sprintf("/api/documents/%d/check", id))
		urls["/api/documents/{id}/history"] = append(urls["/api/documents/{id}/history"], fmt.Sprintf("/api/documents/%d/history", id))
		for _, f := range []string{"xlsx", "docx"} {
			urls["/api/documents/{id}/export"] = append(urls["/api/documents/{id}/export"], fmt.Sprintf("/api/documents/%d/export?format=%s", id, f))
		}
	}
	for r := range routes(t, e, func(m string) bool { return m == "GET" }) {
		if _, ok := urls[strings.TrimPrefix(r, "GET ")]; !ok {
			t.Errorf("endpoint GET chưa được kiểm tra rò giá vốn: %s", r)
		}
	}
	controlHits := 0
	for pattern, list := range urls {
		for _, u := range list {
			rb := bh.Do("GET", u, nil)
			if rb.Status >= 500 {
				t.Errorf("%s ⇒ %d", u, rb.Status)
			}
			if l := leaks(rb.Body); len(l) > 0 {
				t.Errorf("RÒ giá vốn cho người không có quyền: GET %s (%s) chứa %v", u, pattern, l)
			}
			if len(leaks(kt.Do("GET", u, nil).Body)) > 0 {
				controlHits++
			}
		}
	}
	if controlHits < 10 {
		t.Fatalf("đối chứng: kế toán phải thấy giá vốn ở nhiều endpoint, chỉ thấy %d", controlHits)
	}
	// Endpoint POST trả dữ liệu: kiểm tra phiếu chưa lưu, lỗi LOSS_WARNING khi ghi sổ phiếu bán lỗ.
	r := bh.Do("POST", "/api/documents/check", DocBody("sale", "2026-01-10", cus, e.WH["KHO1"], Line(p, "1", "500000")))
	if r.Status != 200 || len(leaks(r.Body)) > 0 || !strings.Contains(string(r.Body), "bán lỗ") {
		t.Fatalf("check: %d %s", r.Status, r.Body)
	}
	d := bh.CreateDoc(DocBody("sale", "2026-01-10", cus, e.WH["KHO1"], Line(p, "1", "500000")))
	if len(d.Warnings) != 1 {
		t.Fatalf("vẫn có cảnh báo lỗ: %+v", d.Warnings)
	}
	r = bh.Expect(409, "LOSS_WARNING", "POST", fmt.Sprintf("/api/documents/%d/post", d.ID), map[string]any{"version": d.Version})
	if l := leaks(r.Body); len(l) > 0 {
		t.Fatalf("LOSS_WARNING lộ giá vốn: %s", r.Body)
	}
	// SSE: phiếu mua được ghi sổ ⇒ sự kiện tới máy bán hàng không mang số liệu.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", e.URL+"/api/events", nil)
	res, err := (&http.Client{Jar: bh.hc.Jar}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	lines := make(chan string, 16)
	go func() {
		sc := bufio.NewScanner(res.Body)
		for sc.Scan() {
			if strings.HasPrefix(sc.Text(), "data: ") {
				lines <- sc.Text()
			}
		}
	}()
	for e.Srv.Events.Count() == 0 {
		time.Sleep(5 * time.Millisecond)
	}
	e.Admin.Posted(DocBody("purchase", "2026-01-11", sup.ID, e.WH["KHO1"], Line(p, "3", "654321")))
	n := 0
	timeout := time.After(5 * time.Second)
	for n < 2 {
		select {
		case l := <-lines:
			n++
			if len(leaks([]byte(l))) > 0 {
				t.Fatalf("SSE lộ giá vốn: %s", l)
			}
		case <-timeout:
			t.Fatalf("chỉ nhận %d sự kiện", n)
		}
	}
	// Sửa phiếu mua khi không thấy giá (vai trò tùy biến có quyền mua nhưng không xem giá) không làm mất giá vốn.
	e.Admin.OK("PUT", "/api/role-permissions", map[string]any{"matrix": map[string][]string{"thukho": {"stock.write", "purchase.write"}}}, nil)
	tk := mrUser(e, "thukho1", "thukho")
	dp := tk.GetDoc(draftPur.ID)
	if dp.Lines[0].UnitPrice != nil {
		t.Fatalf("đơn giá phiếu mua phải bị che: %+v", dp.Lines[0])
	}
	tk.OK("PUT", fmt.Sprintf("/api/documents/%d", draftPur.ID), map[string]any{"version": dp.Version, "doc_date": "2026-01-08", "partner_id": sup.ID, "warehouse_id": e.WH["KHO1"],
		"lines": []any{map[string]any{"id": dp.Lines[0].ID, "product_id": p, "qty": 2}}}, nil)
	eqDec(t, *e.Admin.GetDoc(draftPur.ID).Lines[0].UnitPrice, "777123", "giữ đơn giá cũ khi người sửa không thấy giá")
	// Sửa mặt hàng khi không thấy giá mua không làm mất giá mua.
	e.Admin.OK("PUT", "/api/role-permissions", map[string]any{"matrix": map[string][]string{"banhang": {"sale.write", "catalog.write"}}}, nil)
	bh.OK("PUT", fmt.Sprintf("/api/products/%d", p), map[string]any{"code": "P", "name": "Hàng giá vốn (đổi tên)", "unit": "Cái", "sale_price": 990000, "group_id": g}, nil)
	var pp struct {
		PurchasePrice float64 `json:"purchase_price"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products/%d", p), nil, &pp)
	if pp.PurchasePrice != 777123 {
		t.Fatalf("giá mua bị mất: %v", pp.PurchasePrice)
	}
}

// zipFilesNoT giải nén gói zip (xlsx/docx) thành map tên → nội dung; lỗi ⇒ rỗng.
func zipFilesNoT(b []byte) map[string]string {
	out := map[string]string{}
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return out
	}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			continue
		}
		c, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = string(c)
	}
	return out
}
