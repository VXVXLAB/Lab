package tests

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"kho/internal/httpapi"
	"kho/internal/tlsconf"
)

type stockRow struct {
	Description string          `json:"description"`
	QtyIn       decimal.Decimal `json:"qty_in"`
	QtyOut      decimal.Decimal `json:"qty_out"`
	Balance     decimal.Decimal `json:"balance"`
}

func (e *Env) ledgerRows(product int64, wh int64) []stockRow {
	e.t.Helper()
	var l struct {
		Rows []stockRow `json:"rows"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d&warehouse_id=%d", product, wh), nil, &l)
	return l.Rows
}

// C9 — kiểm kê: tồn sổ sách cuối ngày phiếu (phiếu tạm: tính lúc xem; ghi sổ: chụp lại), ghi sổ sinh nhập / xuất đúng
// chênh lệch, R6 áp dụng từ ngày đó, thẻ kho "Kiểm kê thừa/thiếu", không vào công nợ / báo cáo mua bán, giá vốn bình quân
// liên hoàn xử lý thừa / thiếu theo bình quân hiện tại, chứng từ lùi ngày làm sổ khác lúc kiểm ⇒ báo "lệch" nhưng điều
// chỉnh giữ nguyên; bỏ ghi sổ / sửa / xóa / khóa sổ / quyền như chứng từ khác.
func TestMR_C9_KiemKe(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	k := e.Partner("K", "Khách", true, false)
	sup := e.Partner("NCC", "NCC", false, true)
	a := e.Product("A", "Hàng A", "Cái", 300, 100, 0)
	b := e.Product("B", "Hàng B", "Cái", 300, 200, 0)
	c := e.Product("C", "Hàng C", "Cái", 300, 50, 0)
	r := e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("stocktake", "2026-01-15", 0, e.WH["KHO1"], Line(a, "1", nil)))
	if !strings.Contains(string(r.Body), "transfer, opening)") {
		t.Fatalf("tắt ⇒ đúng thông báo bản chuẩn: %s", r.Body)
	}
	e.Admin.Expect(404, "FEATURE_OFF", "GET", fmt.Sprintf("/api/documents/stocktake-load?warehouse_id=%d", e.WH["KHO1"]), nil)
	mrEnable(e, "stocktake", "profit_report", "period_lock", "permissions")
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "10", "100"), Line(b, "5", "200"))
	e.Admin.Posted(DocBody("sale", "2026-01-10", k, e.WH["KHO1"], Line(a, "3", "300")))
	var load struct {
		Items []struct {
			ProductCode string          `json:"product_code"`
			BookQty     decimal.Decimal `json:"book_qty"`
		} `json:"items"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/documents/stocktake-load?warehouse_id=%d&date=2026-01-15", e.WH["KHO1"]), nil, &load)
	if len(load.Items) != 2 || load.Items[0].ProductCode != "A" || !load.Items[0].BookQty.Equal(d("7")) || !load.Items[1].BookQty.Equal(d("5")) {
		t.Fatalf("nạp mã có tồn: %+v", load)
	}
	// Kiểm tra dữ liệu.
	bad := func(lines ...map[string]any) {
		t.Helper()
		e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("stocktake", "2026-01-15", 0, e.WH["KHO1"], lines...))
	}
	bad(Line(a, "1", nil), Line(a, "2", nil))
	bad(map[string]any{"product_id": e.DV, "qty": 1})
	bad(Line(a, "-1", nil))
	bad(Line(a, "1", "100"))
	bad(map[string]any{"product_id": a})
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("stocktake", "2026-01-15", k, e.WH["KHO1"], Line(a, "1", nil)))
	// Quyền: cần stock.write.
	bh := mrUser(e, "bh", "banhang")
	bh.Expect(403, "FORBIDDEN", "POST", "/api/documents", DocBody("stocktake", "2026-01-15", 0, e.WH["KHO1"], Line(a, "1", nil)))

	dr := e.Admin.CreateDoc(DocBody("stocktake", "2026-01-15", 0, e.WH["KHO1"], Line(a, "9", nil), Line(b, "4", nil), Line(c, "0", nil)))
	for i, want := range [][3]string{{"7", "9", "2"}, {"5", "4", "-1"}, {"0", "0", "0"}} {
		lc := dr.Lines[i].LineCount
		if lc == nil || !lc.BookQty.Equal(d(want[0])) || !lc.CountedQty.Equal(d(want[1])) || !lc.DiffQty.Equal(d(want[2])) || lc.CurrentBookQty != nil {
			t.Fatalf("phiếu tạm dòng %d: %+v", i+1, lc)
		}
	}
	if !dr.TotalAmount.IsZero() || dr.DocVAT != nil {
		t.Fatalf("kiểm kê không có tiền: %+v", dr)
	}
	// R6: kiểm kê làm âm kho về sau ⇒ chặn (bán B 4 ngày 20/01 cần tồn).
	e.Admin.Posted(DocBody("sale", "2026-01-20", k, e.WH["KHO1"], Line(b, "4", "300")))
	bad2 := e.Admin.CreateDoc(DocBody("stocktake", "2026-01-15", 0, e.WH["KHO1"], Line(b, "2", nil)))
	e.Admin.Expect(422, "INSUFFICIENT_STOCK", "POST", fmt.Sprintf("/api/documents/%d/post", bad2.ID), map[string]any{"version": bad2.Version})
	e.Admin.OK("DELETE", fmt.Sprintf("/api/documents/%d", bad2.ID), nil, nil)

	ps := e.Admin.PostDoc(dr)
	if ps.DocNo == nil || *ps.DocNo != "KK00001" || ps.BookChangedLines == nil || *ps.BookChangedLines != 0 {
		t.Fatalf("ghi sổ kiểm kê: %+v", ps)
	}
	tot, _ := e.TotalStock(a)
	eqDec(t, tot, "9", "A sau kiểm kê thừa 2")
	tot, _ = e.TotalStock(b)
	eqDec(t, tot, "0", "B: 5 − 1 (thiếu) − 4 (bán)")
	ra := e.ledgerRows(a, e.WH["KHO1"])
	if ra[2].Description != "Kiểm kê thừa" || !ra[2].QtyIn.Equal(d("2")) || !ra[2].Balance.Equal(d("9")) {
		t.Fatalf("thẻ kho A: %+v", ra)
	}
	if rb := e.ledgerRows(b, e.WH["KHO1"]); rb[1].Description != "Kiểm kê thiếu" || !rb[1].QtyOut.Equal(d("1")) {
		t.Fatalf("thẻ kho B: %+v", rb)
	}
	if rc := e.ledgerRows(c, e.WH["KHO1"]); len(rc) != 0 {
		t.Fatalf("C không chênh ⇒ không có bút toán: %+v", rc)
	}
	// Báo cáo mua / bán không có kiểm kê; không có công nợ.
	var sr struct {
		DocCount int `json:"document_count"`
	}
	e.Admin.OK("GET", "/api/reports/sales?from=2026-01-01&to=2026-01-31", nil, &sr)
	if sr.DocCount != 2 {
		t.Fatalf("báo cáo bán: %+v", sr)
	}
	// Lãi gộp: thừa nhập theo bình quân hiện tại (100), bán A 2 ngày 25/01 ⇒ 200; thiếu B xuất theo 200 ⇒ bán B 4 = 800.
	sA := e.Admin.Posted(DocBody("sale", "2026-01-25", k, e.WH["KHO1"], Line(a, "2", "300")))
	cost := func(id int64) string {
		var p profitResp
		e.Admin.OK("GET", "/api/reports/profit?from=2026-01-01&to=2026-01-31", nil, &p)
		for _, x := range p.Items {
			if *x.DocumentID == id {
				return x.Cost.String()
			}
		}
		return "?"
	}
	if got := cost(sA.ID); got != "200" {
		t.Fatalf("giá vốn sau kiểm kê thừa: %s", got)
	}
	// Nhập lùi ngày 12/01 (5 @160): bình quân trước kiểm kê (700 + 800) / 12 = 125 ⇒ thừa 2 vào theo 125 ⇒ bán 2 = 250.
	e.Admin.Posted(DocBody("purchase", "2026-01-12", sup, e.WH["KHO1"], Line(a, "5", "160")))
	if got := cost(sA.ID); got != "250" {
		t.Fatalf("giá vốn sau nhập lùi ngày: %s", got)
	}
	// Sổ hiện tại khác lúc kiểm: điều chỉnh giữ nguyên (+2), phiếu báo lệch.
	g := e.Admin.GetDoc(ps.ID)
	la := g.Lines[0].LineCount
	if *g.BookChangedLines != 1 || !la.BookChanged || !la.BookQty.Equal(d("7")) || !la.CurrentBookQty.Equal(d("12")) || !la.DiffQty.Equal(d("2")) || g.Lines[1].BookChanged {
		t.Fatalf("lệch so với sổ hiện tại: %+v / %+v", la, g.Lines[1].LineCount)
	}
	tot, _ = e.TotalStock(a)
	eqDec(t, tot, "12", "10 − 3 + 5 + 2 − 2")
	// Xuất biên bản.
	rows := xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", ps.ID), nil, nil).Body)
	if row := findRow(rows, 1, "A"); row == nil || row[4] != "7" || row[5] != "9" || row[6] != "2" || !strings.Contains(fmt.Sprint(rows), "BIÊN BẢN KIỂM KÊ KHO") {
		t.Fatalf("biên bản kiểm kê: %v", rows)
	}
	// Sửa phiếu đã ghi sổ (posted.edit): tồn sổ sách tính lại (A 12 ⇒ đếm 9 = thiếu 3), id dòng giữ nguyên.
	tk := mrUser(e, "tk", "thukho")
	tk.Expect(403, "FORBIDDEN", "PUT", fmt.Sprintf("/api/documents/%d", ps.ID), map[string]any{"version": g.Version})
	e.Admin.OK("PUT", fmt.Sprintf("/api/documents/%d", ps.ID), map[string]any{"version": g.Version, "doc_date": "2026-01-15", "warehouse_id": e.WH["KHO1"],
		"lines": []any{map[string]any{"id": g.Lines[0].ID, "product_id": a, "qty": 9}, map[string]any{"id": g.Lines[1].ID, "product_id": b, "qty": 4}}}, nil)
	g2 := e.Admin.GetDoc(ps.ID)
	if g2.Lines[0].ID != g.Lines[0].ID || !g2.Lines[0].BookQty.Equal(d("12")) || !g2.Lines[0].DiffQty.Equal(d("-3")) || g2.Lines[0].BookChanged || len(g2.Lines) != 2 {
		t.Fatalf("sửa kiểm kê đã ghi sổ: %+v", g2.Lines[0].LineCount)
	}
	tot, _ = e.TotalStock(a)
	eqDec(t, tot, "7", "12 − 3 − 2")
	// Bỏ ghi sổ: bút toán mất, tồn sổ sách trở lại tính lúc xem; ghi sổ lại.
	u := e.Admin.OK("POST", fmt.Sprintf("/api/documents/%d/unpost", ps.ID), map[string]any{"version": g2.Version}, nil)
	_ = u
	tot, _ = e.TotalStock(a)
	eqDec(t, tot, "10", "bỏ ghi sổ")
	g3 := e.Admin.GetDoc(ps.ID)
	if g3.Status != "draft" || g3.Lines[0].CurrentBookQty != nil || !g3.Lines[0].BookQty.Equal(d("12")) {
		t.Fatalf("phiếu tạm sau bỏ ghi sổ: %+v", g3.Lines[0].LineCount)
	}
	g3 = e.Admin.PostDoc(g3)
	if *g3.DocNo != "KK00001" {
		t.Fatalf("giữ số: %v", g3.DocNo)
	}
	// Khóa sổ: không ghi sổ / bỏ ghi sổ / sửa / tạo kiểm kê trong kỳ khóa.
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": "2026-01-31", "reason": "chốt"}, nil)
	e.Admin.Expect(422, "PERIOD_LOCKED", "POST", fmt.Sprintf("/api/documents/%d/unpost", ps.ID), map[string]any{"version": g3.Version})
	e.Admin.Expect(422, "PERIOD_LOCKED", "POST", "/api/documents", DocBody("stocktake", "2026-01-20", 0, e.WH["KHO1"], Line(a, "1", nil)))
	e.Admin.OK("PUT", "/api/period-lock", map[string]any{"lock_date": nil, "reason": "mở"}, nil)
	// Thủ kho lập phiếu kiểm kê được; tắt tính năng ⇒ phiếu kiểm kê cũ không sửa / ghi sổ được (404), tồn vẫn đúng.
	td := tk.CreateDoc(DocBody("stocktake", "2026-02-01", 0, e.WH["KHO1"], Line(a, "7", nil)))
	e.Admin.OK("PUT", "/api/features", map[string]any{"features": map[string]bool{"stocktake": false}}, nil)
	e.Admin.Expect(404, "FEATURE_OFF", "POST", fmt.Sprintf("/api/documents/%d/post", td.ID), map[string]any{"version": td.Version})
	tot, _ = e.TotalStock(a)
	eqDec(t, tot, "7", "tắt tính năng không đổi tồn")
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/documents?type=stocktake", nil)
}

func pngBytes(t *testing.T, w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		img.Set(x, x%h, color.RGBA{200, 10, 10, 255})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func (c *Client) raw(method, path, ctype string, body []byte) *Resp {
	req, _ := http.NewRequest(method, c.base+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", ctype)
	res, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	var out bytes.Buffer
	_, _ = out.ReadFrom(res.Body)
	return &Resp{Status: res.StatusCode, Body: out.Bytes(), Header: res.Header}
}

// C12 — mẫu in: cấu hình (kiểm tra), logo PNG/JPG ≤ 500 KB kiểm theo nội dung, chỉ người đăng nhập tải được; file xuất
// dùng tên ô ký, chân trang, ẩn cột; mặc định (chưa đặt gì) cho file y như khi tắt tính năng.
func TestMR_C12_MauIn(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	k := e.Partner("K", "Khách", true, false)
	a := e.Product("A", "Hàng A", "Cái", 300, 100, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "10", "100"))
	s := e.Admin.Posted(DocBody("sale", "2026-01-10", k, e.WH["KHO1"], Line(a, "3", "300")))
	v := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": k, "lines": []any{map[string]any{"amount": 900, "document_id": s.ID}}})
	exportRows := func(path string) [][]string {
		rows := xlsxRows(t, e.Admin.OK("GET", path, nil, nil).Body)
		var out [][]string
		for _, r := range rows {
			if len(r) > 0 && strings.HasPrefix(r[0], "Xuất file lúc") {
				continue // thời điểm xuất
			}
			out = append(out, r)
		}
		return out
	}
	docPath := fmt.Sprintf("/api/documents/%d/export?format=xlsx", s.ID)
	before := fmt.Sprint(exportRows(docPath))
	e.Admin.Expect(404, "FEATURE_OFF", "GET", "/api/print-template", nil)
	mrEnable(e, "print_template", "permissions")
	if after := fmt.Sprint(exportRows(docPath)); after != before {
		t.Fatalf("mẫu in mặc định phải cho file như khi tắt:\n%s\n%s", before, after)
	}
	var pt struct {
		Template struct {
			PaperDocument string `json:"paper_size_document"`
			HasLogo       bool   `json:"has_logo"`
		} `json:"template"`
		DefaultSignatures map[string][]string `json:"default_signatures"`
	}
	e.Admin.OK("GET", "/api/print-template", nil, &pt)
	if pt.Template.PaperDocument != "A4" || pt.Template.HasLogo || len(pt.DefaultSignatures["sale"]) != 4 {
		t.Fatalf("mặc định: %+v", pt)
	}
	for _, body := range []map[string]any{
		{"paper_size_document": "A3", "paper_size_voucher": "A5"},
		{"paper_size_document": "A4", "paper_size_voucher": "A5", "signatures": map[string]any{"hoa_don": []string{"X"}}},
		{"paper_size_document": "A4", "paper_size_voucher": "A5", "signatures": map[string]any{"sale": []string{"1", "2", "3", "4", "5", "6", "7"}}},
		{"paper_size_document": "A4", "paper_size_voucher": "A5", "signatures": map[string]any{"sale": []string{" "}}},
	} {
		e.Admin.Expect(400, "VALIDATION", "PUT", "/api/print-template", body)
	}
	bh := mrUser(e, "bh", "banhang")
	bh.Expect(403, "FORBIDDEN", "PUT", "/api/print-template", map[string]any{"paper_size_document": "A4", "paper_size_voucher": "A5"})
	bh.OK("GET", "/api/print-template", nil, nil)
	e.Admin.OK("PUT", "/api/print-template", map[string]any{"paper_size_document": "a5", "paper_size_voucher": "A5", "footer": "Cảm ơn quý khách!",
		"hide_code_column": true, "signatures": map[string]any{"sale": []string{"Người bán", "Người mua"}, "receipt": []string{"Thủ quỹ", "Người nộp"}}}, nil)
	all := fmt.Sprint(exportRows(docPath))
	for _, want := range []string{"Người bán", "Người mua", "Cảm ơn quý khách!"} {
		if !strings.Contains(all, want) {
			t.Fatalf("file xuất thiếu %q: %s", want, all)
		}
	}
	if strings.Contains(all, "Mã hàng") || strings.Contains(all, "Người giao hàng") {
		t.Fatalf("ẩn cột Mã hàng, ô ký thay thế: %s", all)
	}
	if vr := fmt.Sprint(exportRows(fmt.Sprintf("/api/vouchers/%d/export?format=xlsx", v.ID))); !strings.Contains(vr, "Người nộp") || strings.Contains(vr, "Kế toán trưởng") {
		t.Fatalf("phiếu thu dùng ô ký mẫu in: %s", vr)
	}
	// Logo.
	logo := pngBytes(t, 40, 20)
	if r := e.Admin.raw("PUT", "/api/print-template/logo", "image/png", logo); r.Status != 200 || !strings.Contains(string(r.Body), `"has_logo":true`) {
		t.Fatalf("tải logo: %d %s", r.Status, r.Body)
	}
	g := bh.OK("GET", "/api/print-template/logo", nil, nil)
	if !bytes.Equal(g.Body, logo) || g.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("đọc logo: %v", g.Header)
	}
	anon := &Client{t: t, base: e.URL, hc: &http.Client{}}
	anon.Expect(401, "UNAUTHORIZED", "GET", "/api/print-template/logo", nil)
	if r := e.Admin.raw("PUT", "/api/print-template/logo", "image/png", []byte("<svg onload=alert(1)>giả png</svg>")); r.Status != 400 {
		t.Fatalf("logo giả: %d", r.Status)
	}
	if r := e.Admin.raw("PUT", "/api/print-template/logo", "image/png", append(append([]byte{}, logo[:40]...), make([]byte, 100)...)); r.Status != 400 {
		t.Fatalf("logo hỏng: %d", r.Status)
	}
	big := make([]byte, 600*1024)
	copy(big, logo)
	if r := e.Admin.raw("PUT", "/api/print-template/logo", "image/png", big); r.Status != 400 || !strings.Contains(string(r.Body), "500 KB") {
		t.Fatalf("logo quá lớn: %d %s", r.Status, r.Body)
	}
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	var jb bytes.Buffer
	_ = jpeg.Encode(&jb, img, nil)
	if r := bh.raw("PUT", "/api/print-template/logo", "image/jpeg", jb.Bytes()); r.Status != 403 {
		t.Fatalf("chỉ quản trị: %d", r.Status)
	}
	if r := e.Admin.upload("/api/print-template/logo", jb.Bytes()); r.Status != 200 || !strings.Contains(string(r.Body), "image/jpeg") {
		t.Fatalf("logo JPG (multipart): %d %s", r.Status, r.Body)
	}
	e.Admin.OK("DELETE", "/api/print-template/logo", nil, nil)
	e.Admin.Expect(404, "NOT_FOUND", "GET", "/api/print-template/logo", nil)
	var au struct {
		Total int `json:"total"`
	}
	e.Admin.OK("GET", "/api/audit?entity=print_template", nil, &au)
	if au.Total != 4 {
		t.Fatalf("audit mẫu in: %d", au.Total)
	}
}

// writeCert tạo chứng thư tự ký (ECDSA) hết hạn sau ttl, ghi cert / key ra thư mục, trả đường dẫn.
func writeCert(t *testing.T, dir, name string, ttl time.Duration) (string, string, *x509.Certificate) {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: "kho.local"},
		NotBefore: time.Now().Add(-2 * time.Hour), NotAfter: time.Now().Add(ttl), DNSNames: []string{"localhost"},
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	kb, _ := x509.MarshalECPrivateKey(key)
	cp, kp := filepath.Join(dir, name+".crt"), filepath.Join(dir, name+".key")
	_ = os.WriteFile(cp, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600)
	_ = os.WriteFile(kp, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb}), 0o600)
	cert, _ := x509.ParseCertificate(der)
	return cp, kp, cert
}

// C13 — HTTPS: TLS_CERT/TLS_KEY ⇒ máy chủ chạy HTTPS, cookie phiên có Secure; file sai ⇒ lỗi khởi động rõ ràng.
func TestMR_C13_HTTPS(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	cp, kp, cert := writeCert(t, dir, "ok", 365*24*time.Hour)
	_, kp2, _ := writeCert(t, dir, "other", 365*24*time.Hour)
	ep, ekp, _ := writeCert(t, dir, "old", -time.Hour)
	if cfg, w, err := tlsconf.Load("", ""); cfg != nil || err != nil || w != nil {
		t.Fatal("không đặt ⇒ HTTP như bản chuẩn")
	}
	for _, c := range []struct{ cert, key, want string }{
		{cp, "", "CẢ HAI"},
		{filepath.Join(dir, "khong-co.crt"), kp, "TLS_CERT"},
		{cp, dir, "thư mục"},
		{cp, kp2, "không dùng được"},
		{kp, cp, "không dùng được"},
	} {
		if _, _, err := tlsconf.Load(c.cert, c.key); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Fatalf("%v: lỗi phải nêu %q, nhận %v", c, c.want, err)
		}
	}
	if _, w, err := tlsconf.Load(ep, ekp); err != nil || len(w) != 1 || !strings.Contains(w[0], "hết hạn") {
		t.Fatalf("chứng thư hết hạn ⇒ cảnh báo: %v %v", w, err)
	}
	cfg, _, err := tlsconf.Load(cp, kp)
	if err != nil {
		t.Fatal(err)
	}
	e := newEnv(t)
	srv := httpapi.New(httpapi.Config{Pool: e.Pool, StaticDir: t.TempDir(), BcryptCost: 4, Quiet: true, SecureCookie: true})
	ts := httptest.NewUnstartedServer(srv.Handler())
	ts.TLS = cfg
	ts.Config.ErrorLog = log.New(io.Discard, "", 0) // lỗi bắt tay TLS cố ý ở cuối bài
	ts.StartTLS()
	defer ts.Close()
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	hc := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}}
	res, err := hc.Post(ts.URL+"/api/auth/login", "application/json", strings.NewReader(`{"username":"admin","password":"admin123"}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 || res.TLS == nil || !strings.Contains(res.Header.Get("Set-Cookie"), "Secure") {
		t.Fatalf("HTTPS + cookie Secure: %d %v", res.StatusCode, res.Header)
	}
	// Không tin chứng thư ⇒ máy khách từ chối (đúng là TLS thật).
	if _, err := (&http.Client{}).Get(ts.URL + "/api/health"); err == nil {
		t.Fatal("phải lỗi xác thực chứng thư")
	}
}

// C9 — kiểm kê ghi sổ đồng thời với phiếu bán cùng mặt hàng + kho: khóa mặt hàng+kho lấy TRƯỚC khi tính tồn sổ sách ⇒
// dù thứ tự nào, tồn cuối cùng luôn đúng bằng số đếm được (bán trước ⇒ kiểm kê thừa; kiểm kê trước ⇒ bán bị chặn).
func TestMR_C9_KiemKeDongThoiVoiBan(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "stocktake")
	k := e.Partner("K", "Khách", true, false)
	rounds := 8
	if testing.Short() {
		rounds = 2
	}
	for i := 0; i < rounds; i++ {
		p := e.Product(fmt.Sprintf("P%d", i), "Hàng đua", "Cái", 10, 5, 0)
		e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "5", "5"))
		sale := e.Admin.CreateDoc(DocBody("sale", "2026-01-10", k, e.WH["KHO1"], Line(p, "5", "10")))
		st := e.Admin.CreateDoc(DocBody("stocktake", "2026-01-10", 0, e.WH["KHO1"], Line(p, "3", nil)))
		done := make(chan *Resp, 2)
		for _, dd := range []int64{sale.ID, st.ID} {
			go func(id int64) {
				done <- e.Admin.Do("POST", fmt.Sprintf("/api/documents/%d/post", id), map[string]any{"version": 1})
			}(dd)
		}
		r1, r2 := <-done, <-done
		for _, r := range []*Resp{r1, r2} {
			if r.Status != 200 && r.ErrCode() != "INSUFFICIENT_STOCK" {
				t.Fatalf("vòng %d: %d %s", i, r.Status, r.Body)
			}
		}
		tot, _ := e.TotalStock(p)
		eqDec(t, tot, "3", fmt.Sprintf("vòng %d: tồn = số đếm", i))
	}
}
