package tests

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/shopspring/decimal"

	"kho/internal/db"
	"kho/internal/docs"
	"kho/internal/stock"
)

// sum_total_amount của danh sách chứng từ / phiếu thu chi = tổng MỌI dòng khớp bộ lọc, không chỉ trang hiện tại.
// REQ: 067, 066, 056
func TestREQ067_TongTienDanhSachMoiTrang(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	sup := e.Partner("NCC", "NCC", false, true)
	p := e.Product("P", "Hàng P", "Cái", 1000, 500, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "100", nil))
	for i := 1; i <= 5; i++ {
		e.Admin.Posted(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, fmt.Sprint(i), "1000")))
	}
	e.Admin.CreateDoc(DocBody("sale", "2026-02-02", cus, e.WH["KHO1"], Line(p, "7", "1000")))
	e.Admin.Posted(DocBody("purchase", "2026-02-01", sup, e.WH["KHO1"], Line(p, "1", "500")))
	var l struct {
		Items []docs.Summary  `json:"items"`
		Total int             `json:"total"`
		Sum   decimal.Decimal `json:"sum_total_amount"`
		Page  int             `json:"page"`
	}
	e.Admin.OK("GET", "/api/documents?type=sale&status=posted&page_size=2", nil, &l)
	if l.Total != 5 || len(l.Items) != 2 {
		t.Fatalf("phân trang: %+v", l)
	}
	eqDec(t, l.Sum, "15000", "tổng tiền mọi trang (1+2+3+4+5)×1.000")
	e.Admin.OK("GET", "/api/documents?type=sale&page_size=1&page=3", nil, &l)
	eqDec(t, l.Sum, "22000", "gồm cả phiếu tạm khi không lọc trạng thái")
	e.Admin.OK("GET", "/api/documents?type=transfer", nil, &l)
	if l.Total != 0 {
		t.Fatal("không có phiếu chuyển kho")
	}
	eqDec(t, l.Sum, "0", "rỗng ⇒ 0")
	for _, a := range []int{100, 200, 300} {
		e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": cus, "lines": []any{map[string]any{"amount": a}}})
	}
	e.Admin.Voucher(map[string]any{"voucher_type": "payment", "account_id": e.TM, "partner_id": sup, "lines": []any{map[string]any{"amount": 50}}})
	e.Admin.OK("GET", "/api/vouchers?type=receipt&page_size=1", nil, &l)
	if l.Total != 3 {
		t.Fatalf("phiếu thu: %d", l.Total)
	}
	eqDec(t, l.Sum, "600", "tổng phiếu thu mọi trang")
}

// Thông tin giá & tồn hàng loạt; danh sách mặt hàng kèm tồn.
// REQ: 026, 009, 010, 028
func TestREQ026_PriceInfoHangLoatVaDanhSachKemTon(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sup := e.Partner("NCC", "NCC", false, true)
	a := e.Product("A", "Hàng A", "Cái", 6500, 4000, 0)
	b := e.Product("B", "Hàng B", "Bộ", 9000, 0, 0)
	c := e.Product("C", "Hàng C chưa có tồn", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "10", nil), Line(b, "3", nil))
	e.Opening("2026-01-01", e.WH["KHO3"], Line(a, "5", nil))
	e.Admin.Posted(DocBody("purchase", "2026-02-01", sup, e.WH["KHO2"], Line(a, "2", "4200")))
	var batch struct {
		Items []stock.PriceInfo `json:"items"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products/price-info?ids=%d,%d,%d,%d&date=2026-03-01&warehouse_id=%d", c, a, b, a, e.WH["KHO1"]), nil, &batch)
	if len(batch.Items) != 3 || batch.Items[0].ProductID != c || batch.Items[1].ProductID != a || batch.Items[2].ProductID != b {
		t.Fatalf("thứ tự theo ids, bỏ trùng: %+v", batch.Items)
	}
	ia := batch.Items[1]
	eqDec(t, ia.TotalStock, "17", "tồn tổng A")
	eqDec(t, *ia.WarehouseQty, "10", "tồn A tại KHO1")
	eqDec(t, ia.CostPrice, "4200", "giá vốn A")
	eqDec(t, ia.SalePrice, "6500", "giá bán A")
	if ia.CostSource != "last_purchase" || len(ia.StockByWarehouse) != 4 {
		t.Fatalf("A: %+v", ia)
	}
	eqDec(t, *batch.Items[0].WarehouseQty, "0", "C tại KHO1")
	if batch.Items[2].CostSource != "none" {
		t.Fatalf("B giá mua 0 ⇒ none: %+v", batch.Items[2])
	}
	// Khớp hoàn toàn với endpoint đơn lẻ.
	var single stock.PriceInfo
	e.Admin.OK("GET", fmt.Sprintf("/api/products/%d/price-info?date=2026-03-01&warehouse_id=%d", a, e.WH["KHO1"]), nil, &single)
	if fmt.Sprint(single) != fmt.Sprint(ia) {
		t.Fatalf("đơn lẻ ≠ hàng loạt:\n%+v\n%+v", single, ia)
	}
	// Ngày trước mọi phát sinh ⇒ tồn 0.
	batch.Items = nil
	e.Admin.OK("GET", fmt.Sprintf("/api/products/price-info?ids=%d&date=2025-12-31", a), nil, &batch)
	eqDec(t, batch.Items[0].TotalStock, "0", "tồn trước ngày tồn đầu")
	if batch.Items[0].WarehouseQty != nil {
		t.Fatal("không có warehouse_id thì không có warehouse_qty")
	}
	// Lỗi.
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/products/price-info", nil)
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/products/price-info?ids=1,abc", nil)
	e.Admin.Expect(404, "NOT_FOUND", "GET", fmt.Sprintf("/api/products/price-info?ids=%d,999999", a), nil)
	e.Admin.Expect(400, "VALIDATION", "GET", fmt.Sprintf("/api/products/price-info?ids=%d&warehouse_id=999999", a), nil)
	many := make([]string, 501)
	for i := range many {
		many[i] = fmt.Sprint(i + 1)
	}
	e.Admin.Expect(400, "VALIDATION", "GET", "/api/products/price-info?ids="+strings.Join(many, ","), nil)

	// Danh sách mặt hàng kèm tồn (hôm nay).
	var pl struct {
		Items []struct {
			Code         string           `json:"code"`
			TotalStock   *decimal.Decimal `json:"total_stock"`
			WarehouseQty *decimal.Decimal `json:"warehouse_qty"`
		} `json:"items"`
		Total int `json:"total"`
	}
	e.Admin.OK("GET", fmt.Sprintf("/api/products?with_stock=true&warehouse_id=%d&is_service=false", e.WH["KHO3"]), nil, &pl)
	got := map[string][2]string{}
	for _, it := range pl.Items {
		if it.TotalStock == nil || it.WarehouseQty == nil {
			t.Fatalf("thiếu tồn: %+v", it)
		}
		got[it.Code] = [2]string{it.TotalStock.String(), it.WarehouseQty.String()}
	}
	if pl.Total != 3 || got["A"] != [2]string{"17", "5"} || got["B"] != [2]string{"3", "0"} || got["C"] != [2]string{"0", "0"} {
		t.Fatalf("with_stock: %v", got)
	}
	pl.Items = nil
	e.Admin.OK("GET", "/api/products?with_stock=true", nil, &pl)
	for _, it := range pl.Items {
		if it.TotalStock == nil || it.WarehouseQty != nil {
			t.Fatalf("không kho ⇒ chỉ total_stock: %+v", it)
		}
	}
	pl.Items = nil
	e.Admin.OK("GET", "/api/products", nil, &pl)
	if pl.Items[0].TotalStock != nil {
		t.Fatal("mặc định không kèm tồn (giữ nguyên hình dạng cũ)")
	}
}

// Kiểm tra phiếu CHƯA LƯU khi đang gõ: thiếu hàng, bán lỗ, xung đột sửa lùi; không đổi dữ liệu.
// REQ: 030, 029, 028, 081, 041
func TestREQ030_KiemTraPhieuChuaLuu(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	sup := e.Partner("NCC", "NCC", false, true)
	p := e.Product("P", "Hàng P", "Cái", 1000, 800, 0)
	pur := e.Admin.Posted(DocBody("purchase", "2026-01-10", sup, e.WH["KHO1"], Line(p, "10", "800")))
	e.Admin.Posted(DocBody("sale", "2026-03-01", cus, e.WH["KHO1"], Line(p, "6", "1000")))
	var res docs.CheckResult
	// Phiếu mới: đang gõ, có dòng chưa chọn hàng và dòng chưa có SL (bị bỏ qua).
	body := DocBody("sale", "2026-03-05", cus, e.WH["KHO1"], Line(p, "5", "700"), map[string]any{"product_id": 0}, map[string]any{"product_id": p})
	e.Admin.OK("POST", "/api/documents/check", body, &res)
	if len(res.StockShortages) != 1 || !res.StockShortages[0].Shortage.Equal(d("1")) || res.CanPost {
		t.Fatalf("thiếu 1 (tồn 4, cần 5): %+v", res)
	}
	if len(res.LossLines) != 1 || res.LossLines[0].LineNo != 1 {
		t.Fatalf("bán lỗ dòng 1: %+v", res.LossLines)
	}
	e.Admin.OK("POST", "/api/documents/check", DocBody("sale", "2026-03-05", cus, e.WH["KHO1"], Line(p, "4", "1000")), &res)
	if !res.CanPost || len(res.StockShortages) != 0 || len(res.LossLines) != 0 {
		t.Fatalf("đủ hàng: %+v", res)
	}
	// Đang sửa phiếu nhập cũ (id): giảm SL nhập làm âm ngày bán sau ⇒ báo ngay (bút toán hiện có của phiếu được loại trừ).
	body = DocBody("purchase", "2026-01-10", sup, e.WH["KHO1"], Line(p, "5", "800"))
	body["id"] = pur.ID
	e.Admin.OK("POST", "/api/documents/check", body, &res)
	if len(res.StockShortages) != 1 || res.StockShortages[0].Date.String() != "2026-03-01" || !res.StockShortages[0].Shortage.Equal(d("1")) {
		t.Fatalf("xung đột sửa lùi: %+v", res.StockShortages)
	}
	body["lines"] = []any{Line(p, "10", "800")}
	e.Admin.OK("POST", "/api/documents/check", body, &res)
	if len(res.StockShortages) != 0 || !res.CanPost {
		t.Fatalf("giữ nguyên SL không được báo thiếu (không tính trùng bút toán cũ): %+v", res)
	}
	// Không có id thì phiếu nhập mới cộng thêm, không loại trừ gì.
	delete(body, "id")
	body["lines"] = []any{Line(p, "1", "800")}
	e.Admin.OK("POST", "/api/documents/check", body, &res)
	if len(res.StockShortages) != 0 {
		t.Fatalf("phiếu nhập mới: %+v", res)
	}
	// Không đổi dữ liệu.
	tp, _ := e.TotalStock(p)
	eqDec(t, tp, "4", "tồn không đổi")
	var l struct {
		Total int `json:"total"`
	}
	e.Admin.OK("GET", "/api/documents", nil, &l)
	if l.Total != 2 {
		t.Fatalf("không tạo phiếu: %d", l.Total)
	}
	// Lỗi nhập liệu thật vẫn 400; id sai 404; đổi loại phiếu 400.
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents/check", map[string]any{"doc_type": "sale", "partner_id": cus})
	e.Admin.Expect(404, "NOT_FOUND", "POST", "/api/documents/check", map[string]any{"id": 999999, "doc_type": "sale", "partner_id": cus, "warehouse_id": e.WH["KHO1"]})
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents/check", map[string]any{"id": pur.ID, "doc_type": "sale", "partner_id": cus, "warehouse_id": e.WH["KHO1"]})
}

// Đổi mật khẩu của chính mình: sai mật khẩu cũ ⇒ 400; phiên khác bị hủy, phiên hiện tại giữ.
// REQ: 042
func TestREQ042_DoiMatKhau(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	may1 := e.NewUser("lan", "Lan")
	may2 := e.Login("lan", "matkhau123")
	r := may1.Expect(400, "VALIDATION", "POST", "/api/auth/change-password", map[string]any{"old_password": "sai", "new_password": "moi123456"})
	if !strings.Contains(string(r.Body), "Mật khẩu hiện tại không đúng") {
		t.Fatalf("thông báo: %s", r.Body)
	}
	may1.Expect(400, "VALIDATION", "POST", "/api/auth/change-password", map[string]any{"old_password": "matkhau123", "new_password": "123"})
	may1.OK("POST", "/api/auth/change-password", map[string]any{"old_password": "matkhau123", "new_password": "moi123456"}, nil)
	may1.OK("GET", "/api/auth/me", nil, nil)
	may2.Expect(401, "UNAUTHORIZED", "GET", "/api/auth/me", nil)
	anon := &Client{t: t, base: e.URL, hc: &http.Client{}}
	anon.Expect(401, "UNAUTHORIZED", "POST", "/api/auth/login", map[string]any{"username": "lan", "password": "matkhau123"})
	e.Login("lan", "moi123456")
	anon.Expect(401, "UNAUTHORIZED", "POST", "/api/auth/change-password", map[string]any{"old_password": "x", "new_password": "yyyyyy"})
}

// Thông tin công ty in đầu mọi file xuất (phiếu, phiếu thu chi, báo cáo); để trống thì không in. Cột Ghi chú dòng chỉ khi có dùng.
// REQ: 008, 071, 072, 073, 087
func TestREQ008_ThongTinCongTyVaGhiChuDong(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách", true, false)
	p := e.Product("P", "Hàng P", "Cái", 1000, 500, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "10", nil))
	s := e.Admin.Posted(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "1", "1000")))
	v := e.Admin.Voucher(map[string]any{"voucher_type": "receipt", "account_id": e.TM, "partner_id": cus, "lines": []any{map[string]any{"amount": 1000}}})
	var st struct {
		CompanyName string `json:"company_name"`
	}
	e.Admin.OK("GET", "/api/settings", nil, &st)
	if st.CompanyName != "" {
		t.Fatal("mặc định rỗng")
	}
	if xlsxCell(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", s.ID), nil, nil).Body, "A1") != "PHIẾU XUẤT KHO BÁN HÀNG" {
		t.Fatal("chưa khai báo công ty thì không in dòng đầu")
	}
	kt := e.NewUser("kt", "Kế toán")
	kt.OK("GET", "/api/settings", nil, nil)
	kt.Expect(403, "FORBIDDEN", "PUT", "/api/settings", map[string]any{"company_name": "X"})
	e.Admin.OK("PUT", "/api/settings", map[string]any{"company_name": "CÔNG TY TNHH VẬT TƯ HÀN MINH PHÁT", "company_address": "12 Lê Trọng Tấn, Q. Tân Phú", "company_phone": "028 3812 3456", "company_tax_code": "0312345678"}, &st)
	if st.CompanyName != "CÔNG TY TNHH VẬT TƯ HÀN MINH PHÁT" {
		t.Fatalf("lưu: %+v", st)
	}
	for _, path := range []string{
		fmt.Sprintf("/api/documents/%d/export?format=", s.ID),
		fmt.Sprintf("/api/vouchers/%d/export?format=", v.ID),
		"/api/reports/stock-summary?format=",
		"/api/reports/debt-summary?side=receivable&format=",
	} {
		rows := xlsxRows(t, e.Admin.OK("GET", path+"xlsx", nil, nil).Body)
		if rows[0][0] != "CÔNG TY TNHH VẬT TƯ HÀN MINH PHÁT" || rows[1][0] != "Địa chỉ: 12 Lê Trọng Tấn, Q. Tân Phú" || rows[2][0] != "Điện thoại: 028 3812 3456    MST: 0312345678" {
			t.Fatalf("%s xlsx đầu trang: %v", path, rows[:4])
		}
		x := docxXML(t, e.Admin.OK("GET", path+"docx", nil, nil).Body)
		if i, j := strings.Index(x, "VẬT TƯ HÀN MINH PHÁT"), strings.Index(x, "<w:tbl>"); i < 0 || i > j {
			t.Fatalf("%s docx đầu trang", path)
		}
	}
	// Chỉ khai tên: không in dòng địa chỉ / ĐT rỗng.
	e.Admin.OK("PUT", "/api/settings", map[string]any{"company_name": "Minh Phát"}, nil)
	rows := xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", s.ID), nil, nil).Body)
	if rows[0][0] != "Minh Phát" || rows[1][0] != "PHIẾU XUẤT KHO BÁN HÀNG" {
		t.Fatalf("chỉ tên công ty: %v", rows[:3])
	}
	// Ghi chú dòng: có cột Ghi chú khi có dòng ghi chú.
	ln := Line(p, "1", "1000")
	ln["note"] = "Giao trước 9h"
	d2 := e.Admin.CreateDoc(DocBody("sale", "2026-02-02", cus, e.WH["KHO1"], Line(p, "1", "1000"), ln))
	rows = xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", d2.ID), nil, nil).Body)
	if h := findRow(rows, 0, "STT"); h == nil || len(h) != 8 || h[7] != "Ghi chú" {
		t.Fatalf("cột Ghi chú: %q", h)
	}
	if r := findRow(rows, 0, "2"); r == nil || r[7] != "Giao trước 9h" {
		t.Fatalf("ghi chú dòng 2: %q", r)
	}
	cells := docxCellTexts(docxXML(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=docx", d2.ID), nil, nil).Body))
	if cells[0][7] != "Ghi chú" || cells[2][7] != "Giao trước 9h" {
		t.Fatalf("docx ghi chú: %q", cells)
	}
}

// Dòng thông tin công ty luôn được seed lại nếu bị mất (vd. TRUNCATE ... CASCADE dữ liệu demo).
// REQ: 008
func TestREQ008_SettingsLuonCoSauKhiSeed(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	if _, err := e.Pool.Exec(context.Background(), `DELETE FROM settings`); err != nil {
		t.Fatal(err)
	}
	if err := db.Seed(context.Background(), e.Pool, db.SeedOptions{BcryptCost: 4}); err != nil {
		t.Fatal(err)
	}
	e.Admin.OK("GET", "/api/settings", nil, nil)
}
