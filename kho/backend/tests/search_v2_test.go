package tests

import (
	"fmt"
	"net/url"
	"strings"
	"testing"
)

// F-12 — cụm từ khớp trọn từ đứng trên khớp một phần từ: "minh phu" ⇒ "Đại lý Minh Phú" trước "Công ty Minh Phước".
// REQ: 025, 060
func TestREQ025_TimDoiTacTronTuTruocMotPhan(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.Partner("CTMP", "Công ty Minh Phước", true, false)
	e.Partner("DLMP", "Đại lý Minh Phú", true, false)
	e.Partner("MPT", "Minh Phú Thịnh", true, false)
	if g := e.partnerCodes("minh%20phu"); fmt.Sprint(g) != "[MPT DLMP CTMP]" {
		t.Fatalf("minh phu: %v", g)
	}
	if g := e.partnerCodes("minh%20phuoc"); fmt.Sprint(g) != "[CTMP]" {
		t.Fatalf("minh phuoc: %v", g)
	}
}

func (e *Env) productCodes(path string) []string {
	var l struct {
		Items []struct {
			Code string `json:"code"`
		} `json:"items"`
	}
	e.Admin.OK("GET", path, nil, &l)
	out := []string{}
	for _, it := range l.Items {
		out = append(out, it.Code)
	}
	return out
}

// F-13 — tìm mặt hàng nhiều từ ở mọi nơi (danh mục, báo cáo tồn, NXT, báo cáo bán): tách theo khoảng trắng, giữ "3.2";
// mọi từ phải có trong mã hoặc tên, thứ tự bất kỳ, không dấu; xếp hạng trùng mã > mã bắt đầu > mọi từ trong tên.
// REQ: 012, 020, 021, 063
func TestREQ012_TimMatHangNhieuTu(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	k32 := e.Product("KT42132", "Que hàn Kim Tín KT-421 3.2mm", "Hộp", 180000, 146000, 0)
	k40 := e.Product("KT42140", "Que hàn Kim Tín KT-421 4.0mm", "Hộp", 190000, 150000, 0)
	ks := e.Product("K701832", "Que hàn Kiswel K7018 3.2", "Thùng", 1090000, 950000, 0)
	cap := e.Product("CAPHAN35", "Cáp hàn 35mm²", "Mét", 38000, 29000, 0)
	e.Product("ER70S6-12", "Dây hàn CO2 1.2mm", "Cuộn", 1, 1, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(k32, "1", nil), Line(k40, "1", nil), Line(ks, "1", nil), Line(cap, "1", nil))
	q := func(s string) string { return url.QueryEscape(s) }
	cases := map[string]string{
		"que 3.2":     "[K701832 KT42132]",
		"3.2 que":     "[K701832 KT42132]",
		"cap 35":      "[CAPHAN35]",
		"kim tin 4.0": "[KT42140]",
		"KIM TÍN":     "[KT42132 KT42140]",
		"que 5.0":     "[]",
		"er70s6-12":   "[ER70S6-12]",
	}
	for in, want := range cases {
		if g := e.productCodes("/api/products?q=" + q(in)); fmt.Sprint(g) != want {
			t.Errorf("products q=%q: %v, muốn %s", in, g, want)
		}
	}
	// Xếp hạng: trùng mã đứng đầu, rồi mã bắt đầu, rồi mọi từ trong tên.
	e.Product("K7", "Mã ngắn K7", "Cái", 1, 1, 0)
	if g := e.productCodes("/api/products?q=k7"); len(g) < 2 || g[0] != "K7" || g[1] != "K701832" {
		t.Fatalf("xếp hạng k7: %v", g)
	}
	e.Product("ZZZ", "Hàng có chữ kt421 trong tên", "Cái", 1, 1, 0)
	if g := e.productCodes("/api/products?q=kt421"); fmt.Sprint(g) != "[KT42132 KT42140 ZZZ]" {
		t.Fatalf("mã bắt đầu trước khớp tên: %v", g)
	}
	// Báo cáo tồn, NXT, báo cáo bán dùng cùng quy tắc.
	if g := e.productCodes("/api/reports/stock-summary?q=" + q("que 3.2")); fmt.Sprint(g) != "[K701832 KT42132]" {
		t.Fatalf("stock-summary: %v", g)
	}
	if g := e.productCodes("/api/reports/stock-nxt?from=2026-01-01&to=2026-12-31&q=" + q("kim tin 4.0")); fmt.Sprint(g) != "[KT42140]" {
		t.Fatalf("stock-nxt: %v", g)
	}
	cus := e.Partner("KH", "Khách", true, false)
	e.Admin.Posted(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(cap, "1", "38000"), Line(k32, "1", "180000")))
	var tr struct {
		Rows []struct {
			ProductCode string `json:"product_code"`
		} `json:"rows"`
	}
	e.Admin.OK("GET", "/api/reports/sales?from=2026-01-01&to=2026-12-31&q="+q("cap 35"), nil, &tr)
	if len(tr.Rows) != 1 || tr.Rows[0].ProductCode != "CAPHAN35" {
		t.Fatalf("báo cáo bán q: %+v", tr.Rows)
	}
	// Ký tự LIKE đặc biệt được coi là chữ thường.
	if g := e.productCodes("/api/products?q=" + q("100%")); len(g) != 0 {
		t.Fatalf("%% phải là ký tự thường: %v", g)
	}
}

// F-09 — dòng địa chỉ trên file xuất bỏ phần trống.
// REQ: 073, 071
func TestREQ073_DiaChiTrongKhongInNhanTreo(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	p := e.Product("P", "Hàng P", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "10", nil))
	mk := func(code, addr, phone string) int64 {
		var x struct {
			ID int64 `json:"id"`
		}
		e.Admin.OK("POST", "/api/partners", map[string]any{"code": code, "name": "Khách " + code, "address": addr, "phone": phone, "is_customer": true}, &x)
		return x.ID
	}
	cases := []struct {
		id      int64
		want    string
		notWant []string
	}{
		{mk("A", "", "0918 777 888"), "ĐT: 0918 777 888", []string{"Địa chỉ:"}},
		{mk("B", "12 Lê Lợi", ""), "Địa chỉ: 12 Lê Lợi", []string{"ĐT:", "Lợi · "}},
		{mk("C", "12 Lê Lợi", "0909"), "Địa chỉ: 12 Lê Lợi · ĐT: 0909", nil},
		{mk("D", "", ""), "", []string{"Địa chỉ:", "ĐT:"}},
	}
	for _, c := range cases {
		d := e.Admin.CreateDoc(DocBody("sale", "2026-02-01", c.id, e.WH["KHO1"], Line(p, "1", nil)))
		for _, f := range []string{"xlsx", "docx"} {
			body := e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=%s", d.ID, f), nil, nil).Body
			var txt string
			if f == "xlsx" {
				txt = fmt.Sprint(xlsxRows(t, body))
			} else {
				txt = docxXML(t, body)
			}
			if c.want != "" && !strings.Contains(txt, c.want) {
				t.Fatalf("%s: thiếu %q", f, c.want)
			}
			for _, nw := range c.notWant {
				if strings.Contains(txt, nw) {
					t.Fatalf("%s khách %d: không được có %q", f, c.id, nw)
				}
			}
		}
	}
}

// F-16 — tra mã chính xác với optional=1: không có ⇒ 200 {"found":false,"product":null}; mặc định vẫn 404.
// REQ: 025, 047
func TestREQ025_TraMaKhongBao404KhiOptional(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.Product("KT42132", "Que hàn", "Hộp", 1, 1, 0)
	r := e.Admin.OK("GET", "/api/products/lookup?code=KT4&optional=1", nil, nil)
	if strings.TrimSpace(string(r.Body)) != `{"found":false,"product":null}` {
		t.Fatalf("không có: %s", r.Body)
	}
	var ok struct {
		Found   bool `json:"found"`
		Product struct {
			Code string `json:"code"`
		} `json:"product"`
	}
	e.Admin.OK("GET", "/api/products/lookup?code=kt42132&optional=1", nil, &ok)
	if !ok.Found || ok.Product.Code != "KT42132" {
		t.Fatalf("có: %+v", ok)
	}
	e.Admin.OK("GET", "/api/products/lookup?code=dichvu&optional=true", nil, &ok)
	if !ok.Found || ok.Product.Code != "DV" {
		t.Fatalf("DICHVU: %+v", ok)
	}
	e.Admin.Expect(404, "NOT_FOUND", "GET", "/api/products/lookup?code=KT4", nil)
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/products/lookup?code=&optional=1", nil)
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/products/lookup?code=X&optional=maybe", nil)
}
