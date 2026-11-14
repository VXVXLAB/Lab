package tests

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"kho/internal/docs"
	"kho/internal/events"
	"kho/internal/reports"
)

// REQ: 040, 041, 042, 043, 044, 045, 082, 005
// Hai máy (hai phiên/hai người dùng): máy 1 lập phiếu tạm; máy 2 thấy, mở, bổ sung; máy 1 sửa với version cũ
// bị VERSION_CONFLICT; tải lại rồi chốt (ghi sổ).
func TestREQ040_045_082_PhieuTamHaiMay(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	may1 := e.NewUser("may1", "Kế toán Lan (Máy 1)")
	may2 := e.NewUser("may2", "Kế toán Hoa (Máy 2)")
	cus := e.Partner("KH", "CTY TNHH TM DV VĨNH PHONG", true, false)
	a := e.Product("A", "Mặt hàng A", "Cái", 6500, 4000, 0)
	b := e.Product("B", "Mặt hàng B (chưa có tồn)", "Cái", 9000, 5000, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "50", nil))

	// Máy 1 lập phiếu tạm, có cả hàng chưa có tồn (REQ-040/041).
	body := DocBody("sale", "2026-06-01", cus, e.WH["KHO1"], Line(a, "10", nil))
	body["note"] = "Khách gọi điện đặt"
	d1 := may1.CreateDoc(body)
	if d1.Status != "draft" || d1.CreatedByName == nil || *d1.CreatedByName != "Kế toán Lan (Máy 1)" {
		t.Fatalf("phiếu tạm máy 1: %+v", d1)
	}
	// Phiếu tạm không ảnh hưởng tồn / công nợ, không giữ hàng.
	ta, _ := e.TotalStock(a)
	eqDec(t, ta, "50", "phiếu tạm không trừ tồn")
	eqDec(t, e.Debt("receivable", cus), "0", "phiếu tạm không phát sinh công nợ")

	// Máy 2 thấy phiếu tạm trong danh sách (REQ-042/043).
	var list struct {
		Items []docs.Summary `json:"items"`
	}
	may2.OK("GET", "/api/documents?status=draft&type=sale", nil, &list)
	if len(list.Items) != 1 || list.Items[0].ID != d1.ID || *list.Items[0].CreatedByName != "Kế toán Lan (Máy 1)" || *list.Items[0].PartnerName != "CTY TNHH TM DV VĨNH PHONG" {
		t.Fatalf("máy 2 phải thấy phiếu tạm của máy 1: %+v", list.Items)
	}
	// Tìm theo tên khách không dấu.
	may2.OK("GET", "/api/documents?status=draft&q=vinh%20phong", nil, &list)
	if len(list.Items) != 1 {
		t.Fatalf("tìm phiếu tạm theo tên khách: %+v", list.Items)
	}
	// Máy 2 mở và bổ sung dòng (khách gọi lại bổ sung) (REQ-044).
	open2 := may2.GetDoc(d1.ID)
	if open2.Note != "Khách gọi điện đặt" || len(open2.Lines) != 1 {
		t.Fatalf("máy 2 mở phiếu: %+v", open2)
	}
	upd2 := map[string]any{"version": open2.Version, "doc_date": "2026-06-01", "partner_id": cus, "warehouse_id": e.WH["KHO1"], "note": "Khách gọi bổ sung",
		"lines": []any{Line(a, "12", nil), Line(b, "3", nil)}}
	var after2 docs.Document
	may2.OK("PUT", fmt.Sprintf("/api/documents/%d", d1.ID), upd2, &after2)
	if after2.Version != d1.Version+1 || *after2.UpdatedByName != "Kế toán Hoa (Máy 2)" || *after2.CreatedByName != "Kế toán Lan (Máy 1)" {
		t.Fatalf("sau khi máy 2 sửa: %+v", after2)
	}
	// Máy 1 đang giữ bản cũ ⇒ sửa bị từ chối, báo ai sửa sau cùng (không ghi đè mất dữ liệu máy 2).
	upd1 := map[string]any{"version": d1.Version, "doc_date": "2026-06-01", "partner_id": cus, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(a, "1", nil)}}
	r := may1.Expect(409, "VERSION_CONFLICT", "PUT", fmt.Sprintf("/api/documents/%d", d1.ID), upd1)
	var ce struct {
		Error struct {
			Message string `json:"message"`
			Details struct {
				UpdatedBy      string    `json:"updated_by"`
				UpdatedAt      time.Time `json:"updated_at"`
				CurrentVersion int       `json:"current_version"`
			} `json:"details"`
		} `json:"error"`
	}
	r.JSON(t, &ce)
	if ce.Error.Details.UpdatedBy != "Kế toán Hoa (Máy 2)" || ce.Error.Details.CurrentVersion != after2.Version || ce.Error.Details.UpdatedAt.IsZero() {
		t.Fatalf("chi tiết xung đột: %+v", ce)
	}
	if !strings.Contains(ce.Error.Message, "Kế toán Hoa (Máy 2)") {
		t.Fatalf("thông báo phải nêu người sửa: %s", ce.Error.Message)
	}
	may1.Expect(409, "VERSION_CONFLICT", "POST", fmt.Sprintf("/api/documents/%d/post", d1.ID), map[string]any{"version": d1.Version})
	// Máy 1 tải lại, thấy phần máy 2 bổ sung.
	re1 := may1.GetDoc(d1.ID)
	if len(re1.Lines) != 2 || re1.Lines[1].ProductCode != "B" || !re1.Lines[0].Qty.Equal(d("12")) {
		t.Fatalf("máy 1 tải lại phải thấy dòng máy 2 bổ sung: %+v", re1.Lines)
	}
	// Chốt phiếu: hàng B chưa có tồn ⇒ chưa chốt được; bỏ dòng B thì chốt được (REQ-045).
	may1.Expect(422, "INSUFFICIENT_STOCK", "POST", fmt.Sprintf("/api/documents/%d/post", d1.ID), map[string]any{"version": re1.Version})
	var fixed docs.Document
	may1.OK("PUT", fmt.Sprintf("/api/documents/%d", d1.ID), map[string]any{"version": re1.Version, "doc_date": "2026-06-01", "partner_id": cus, "warehouse_id": e.WH["KHO1"], "note": re1.Note,
		"lines": []any{Line(a, "12", nil)}}, &fixed)
	posted := may1.PostDoc(&fixed)
	if posted.Status != "posted" || *posted.PostedByName != "Kế toán Lan (Máy 1)" {
		t.Fatalf("chốt phiếu: %+v", posted)
	}
	ta, _ = e.TotalStock(a)
	eqDec(t, ta, "38", "tồn sau chốt")
	eqDec(t, e.Debt("receivable", cus), "78000", "công nợ sau chốt")
	// Máy 2 thấy phiếu đã ghi sổ.
	if may2.GetDoc(d1.ID).Status != "posted" {
		t.Fatal("máy 2 phải thấy phiếu đã chốt")
	}
	// Phiếu tạm lưu trên server: đăng xuất/đăng nhập lại vẫn còn (REQ-042).
	d3 := may1.CreateDoc(DocBody("sale", "2026-06-02", cus, e.WH["KHO1"], Line(b, "5", nil)))
	may1.OK("POST", "/api/auth/logout", nil, nil)
	may1.Expect(401, "UNAUTHORIZED", "GET", "/api/documents", nil)
	again := e.Login("may1", "matkhau123")
	if again.GetDoc(d3.ID).Status != "draft" {
		t.Fatal("phiếu tạm phải còn sau khi đăng nhập lại")
	}
}

// REQ: 042, 043, 044
// SSE: máy 2 nhận sự kiện tức thời khi máy 1 tạo/sửa/ghi sổ phiếu.
func TestREQ043_SuKienSSEGiuaHaiMay(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	may1 := e.NewUser("may1", "Kế toán Lan (Máy 1)")
	may2 := e.NewUser("may2", "Kế toán Hoa (Máy 2)")
	cus := e.Partner("KH", "Khách SSE", true, false)
	a := e.Product("A", "Hàng A", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "10", nil))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", e.URL+"/api/events", nil)
	hc := &http.Client{Jar: may2.hc.Jar}
	res, err := hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("SSE: %d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
	evs := make(chan events.Event, 32)
	go func() {
		sc := bufio.NewScanner(res.Body)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "data: ") {
				var ev events.Event
				if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &ev) == nil {
					evs <- ev
				}
			}
		}
		close(evs)
	}()
	// Chờ đăng ký xong.
	deadline := time.Now().Add(5 * time.Second)
	for e.Srv.Events.Count() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	next := func(what string) events.Event {
		t.Helper()
		for {
			select {
			case ev, ok := <-evs:
				if !ok {
					t.Fatalf("luồng SSE đóng khi chờ %s", what)
				}
				if ev.Type == "document.changed" {
					return ev
				}
			case <-time.After(5 * time.Second):
				t.Fatalf("không nhận được sự kiện %s", what)
			}
		}
	}
	doc := may1.CreateDoc(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(a, "2", nil)))
	ev := next("created")
	if ev.ID != doc.ID || ev.Action != "created" || ev.Status != "draft" || ev.DocType != "sale" || ev.By != "Kế toán Lan (Máy 1)" || ev.At.IsZero() {
		t.Fatalf("sự kiện tạo phiếu: %+v", ev)
	}
	var upd docs.Document
	may1.OK("PUT", fmt.Sprintf("/api/documents/%d", doc.ID), map[string]any{"version": doc.Version, "doc_date": "2026-02-01", "partner_id": cus, "warehouse_id": e.WH["KHO1"], "lines": []any{Line(a, "3", nil)}}, &upd)
	if ev := next("updated"); ev.Action != "updated" || ev.ID != doc.ID {
		t.Fatalf("sự kiện sửa: %+v", ev)
	}
	may1.PostDoc(&upd)
	if ev := next("posted"); ev.Action != "posted" || ev.Status != "posted" {
		t.Fatalf("sự kiện ghi sổ: %+v", ev)
	}
	// Không đăng nhập thì không nghe được.
	r, _ := http.Get(e.URL + "/api/events")
	if r.StatusCode != 401 {
		t.Fatalf("SSE không đăng nhập phải 401, nhận %d", r.StatusCode)
	}
	r.Body.Close()
}

// REQ: 046
// Kế toán mua xem phiếu tạm để biết hàng cần đặt: SL trên phiếu tạm − tồn tổng = SL thiếu.
func TestREQ046_HangCanDatTuPhieuTam(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	k1 := e.Partner("K1", "Khách 1", true, false)
	k2 := e.Partner("K2", "Khách 2", true, false)
	a := e.Product("A", "Hàng A", "Cái", 100, 50, 0)
	b := e.Product("B", "Hàng B", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(a, "5", nil))
	e.Opening("2026-01-01", e.WH["KHO2"], Line(a, "3", nil), Line(b, "100", nil))
	d1 := e.Admin.CreateDoc(DocBody("sale", "2026-02-01", k1, e.WH["KHO1"], Line(a, "6", nil), map[string]any{"product_id": e.DV, "description": "ghi chú"}))
	e.Admin.CreateDoc(DocBody("sale", "2026-02-02", k2, e.WH["KHO1"], Line(a, "4", nil), Line(b, "1", nil)))
	posted := e.Admin.Posted(DocBody("sale", "2026-02-03", k2, e.WH["KHO1"], Line(a, "1", nil)))
	_ = posted
	var r struct {
		Items []reports.DemandRow `json:"items"`
	}
	e.Admin.OK("GET", "/api/reports/draft-demand", nil, &r)
	if len(r.Items) != 2 {
		t.Fatalf("hàng cần đặt: %+v", r.Items)
	}
	ra := r.Items[0]
	if ra.ProductCode != "A" || ra.Product.Code != "A" {
		t.Fatalf("mã thiếu nhiều nhất phải đứng đầu: %+v", ra)
	}
	eqDec(t, ra.QtyInDrafts, "10", "SL trên phiếu tạm")
	eqDec(t, ra.TotalStock, "7", "tồn tổng (8 − 1 đã bán)")
	eqDec(t, ra.Shortage, "3", "SL thiếu")
	if len(ra.Drafts) != 2 || ra.Drafts[0].DocumentID != d1.ID || *ra.Drafts[0].PartnerName != "Khách 1" {
		t.Fatalf("danh sách phiếu tạm: %+v", ra.Drafts)
	}
	eqDec(t, r.Items[1].Shortage, "0", "B đủ hàng")
	e.Admin.OK("GET", "/api/reports/draft-demand?only_shortage=true", nil, &r)
	if len(r.Items) != 1 {
		t.Fatalf("chỉ hàng thiếu: %+v", r.Items)
	}
	rows := xlsxRows(t, e.Admin.OK("GET", "/api/reports/draft-demand?format=xlsx", nil, nil).Body)
	if row := findRow(rows, 1, "A"); row == nil || row[6] != "3" {
		t.Fatalf("xlsx hàng cần đặt: %v", rows)
	}
}

// REQ: 047, 048, 049, 050, 051, 083, 006, 034
// Đúng mẫu phiếu bán của khách: 5 dòng hàng + DICHVU ghi chú (để trống giá) + DICHVU 400.000 ⇒ Cộng 3.990.000;
// nợ cũ 2.000.000 ⇒ tổng nợ 5.990.000. Dịch vụ không theo dõi NXT.
func TestREQ047_083_PhieuBanMauCuaKhachVoiDichVu(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KHX", "Cơ khí Thành Công", true, false)
	g := e.Product("4CA200A5", "Súng hàn CO2 200A-5.0M (EU)", "Bộ", 600000, 450000, 0)
	b8 := e.Product("CN249SS08", "Béc CO2 Sunshine 0.8 mm", "Cái", 13000, 9000, 0)
	b10 := e.Product("CN249SS10", "Béc CO2 Sunshine 1.0 mm", "Cái", 13000, 9000, 0)
	cos := e.Product("COS10", "Đầu cos (khoen đồng) 10mm (50c/bao)", "Cái", 6000, 4000, 0)
	que := e.Product("K701832", "Que hàn Kiswel K7018-3.2 (20kg)", "Thùng", 1090000, 950000, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(g, "5", nil), Line(b8, "500", nil), Line(b10, "500", nil), Line(cos, "1000", nil), Line(que, "20", nil))
	// Nợ cũ: phiếu bán ngày 10/8/26 = 2.000.000.
	e.Admin.Posted(DocBody("sale", "2026-08-10", cus, e.WH["KHO1"], Line(que, "2", "1000000")))
	// Mã DICHVU gõ ở ô mã hàng ra mã DV.
	var lk struct {
		ID        int64 `json:"id"`
		IsService bool  `json:"is_service"`
	}
	e.Admin.OK("GET", "/api/products/lookup?code=dichvu", nil, &lk)
	if lk.ID != e.DV || !lk.IsService {
		t.Fatalf("DICHVU phải ra mã DV: %+v", lk)
	}
	stockBefore, _ := e.TotalStock(g)
	body := DocBody("sale", "2026-09-25", cus, e.WH["KHO1"],
		Line(g, "1", "600000"), Line(b8, "50", "13000"), Line(b10, "50", "13000"), Line(cos, "100", "6000"), Line(que, "1", "1090000"),
		map[string]any{"product_code": "DICHVU", "description": "TRẢ 01 ĐỒNG HỒ", "qty": 1},
		map[string]any{"product_code": "DICHVU", "description": "PHÍ SỬA XE", "qty": 1, "unit_price": 400000},
	)
	doc := e.Admin.CreateDoc(body)
	if len(doc.Lines) != 7 {
		t.Fatalf("phải có 7 dòng: %d", len(doc.Lines))
	}
	note := doc.Lines[5]
	if !note.IsService || note.ProductCode != "DV" || note.Description != "TRẢ 01 ĐỒNG HỒ" || note.UnitPrice != nil || !note.Amount.IsZero() || !note.Qty.Equal(d("1")) {
		t.Fatalf("dòng ghi chú dịch vụ: %+v", note)
	}
	eqDec(t, doc.Lines[6].Amount, "400000", "phí sửa xe")
	eqDec(t, doc.TotalAmount, "3990000", "Cộng")
	posted := e.Admin.PostDoc(doc)
	eqDec(t, *posted.OldDebt, "2000000", "Nợ cũ")
	eqDec(t, *posted.TotalDebt, "5990000", "Tổng nợ")
	eqDec(t, e.Debt("receivable", cus), "5990000", "công nợ khách")
	// Dịch vụ không có bút toán kho, không có thẻ kho; hàng hóa vẫn trừ tồn.
	var cnt int
	if err := e.Pool.QueryRow(context.Background(), `SELECT count(*) FROM stock_movements WHERE product_id=$1`, e.DV).Scan(&cnt); err != nil {
		t.Fatal(err)
	}
	if cnt != 0 {
		t.Fatalf("mã dịch vụ không được sinh bút toán kho: %d", cnt)
	}
	var dvl reports.Ledger
	e.Admin.OK("GET", fmt.Sprintf("/api/reports/stock-ledger?product_id=%d", e.DV), nil, &dvl)
	if len(dvl.Rows) != 0 {
		t.Fatal("thẻ kho mã dịch vụ phải rỗng")
	}
	stockAfter, _ := e.TotalStock(g)
	if !stockBefore.Sub(stockAfter).Equal(d("1")) {
		t.Fatal("hàng hóa phải trừ tồn")
	}
	// Xuất Excel đúng mẫu.
	rows := xlsxRows(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", doc.ID), nil, nil).Body)
	if rows[0][0] != "PHIẾU XUẤT KHO BÁN HÀNG" {
		t.Fatalf("tiêu đề: %v", rows[0])
	}
	r6 := findRow(rows, 0, "6")
	if r6 == nil || r6[1] != "DICHVU" || r6[2] != "TRẢ 01 ĐỒNG HỒ" || r6[4] != "1" || (len(r6) > 5 && r6[5] != "") || (len(r6) > 6 && r6[6] != "") {
		t.Fatalf("dòng 6 ghi chú dịch vụ trong Excel: %q", r6)
	}
	r7 := findRow(rows, 0, "7")
	if r7 == nil || r7[2] != "PHÍ SỬA XE" || r7[5] != "400000" || r7[6] != "400000" {
		t.Fatalf("dòng 7 dịch vụ trong Excel: %q", r7)
	}
	r1 := findRow(rows, 0, "1")
	if r1 == nil || r1[1] != "4CA200A5" || r1[2] != "Súng hàn CO2 200A-5.0M (EU)" || r1[3] != "Bộ" || r1[6] != "600000" {
		t.Fatalf("dòng 1: %q", r1)
	}
	tot := findRow(rows, 0, "Cộng")
	if tot == nil || tot[6] != "3990000" {
		t.Fatalf("dòng Cộng: %q", tot)
	}
	// Nợ cũ / Tổng nợ: nhãn và số ở hai ô; số là ô số (REQ-034, B5).
	if r := findRow(rows, 2, "Nợ cũ:"); r == nil || r[6] != "2000000" {
		t.Fatalf("Excel dòng Nợ cũ: %q", r)
	}
	if r := findRow(rows, 2, "Tổng nợ (đến ngày 25/09/2026):"); r == nil || r[6] != "5990000" {
		t.Fatalf("Excel dòng Tổng nợ: %q", r)
	}
	xb := e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=xlsx", doc.ID), nil, nil).Body
	checkNumericFormulas(t, xb, map[string]string{"SUM(G": "3990000", "+G": "5990000"})
	// Word.
	x := docxXML(t, e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d/export?format=docx", doc.ID), nil, nil).Body)
	cells := docxCellTexts(x)
	if len(cells) != 1+7+1 {
		t.Fatalf("bảng Word phải có tiêu đề + 7 dòng + Cộng: %d", len(cells))
	}
	if cells[6][2] != "TRẢ 01 ĐỒNG HỒ" || cells[6][5] != "" || cells[7][6] != "400.000" || cells[8][6] != "3.990.000" || cells[1][4] != "1,0" {
		t.Fatalf("bảng Word: %q", cells)
	}
	if !strings.Contains(x, "Tổng nợ (đến ngày 25/09/2026): 5.990.000") {
		t.Fatal("Word thiếu tổng nợ")
	}
}

// REQ: 050, 049, 083, 051
// Dòng dịch vụ số tiền âm làm giảm tổng phiếu và công nợ; dương làm tăng; không ảnh hưởng tồn; dùng được cả phiếu mua.
func TestREQ050_DichVuTruTienGiamCongNo(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cus := e.Partner("KH", "Khách D", true, false)
	sup := e.Partner("NCC", "NCC D", false, true)
	p := e.Product("P", "Hàng P", "Cái", 1000000, 600000, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "10", nil))
	s := e.Admin.Posted(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "1", "1000000"),
		map[string]any{"product_id": e.DV, "description": "Chiết khấu thanh toán", "unit_price": -100000},
		map[string]any{"product_id": e.DV, "description": "Phí vận chuyển", "unit_price": 30000}))
	eqDec(t, s.TotalAmount, "930000", "tổng phiếu = 1.000.000 − 100.000 + 30.000")
	eqDec(t, e.Debt("receivable", cus), "930000", "công nợ khách")
	tp, _ := e.TotalStock(p)
	eqDec(t, tp, "9", "chỉ hàng hóa trừ tồn")
	// Phiếu mua có dòng dịch vụ (phí vận chuyển NCC tính thêm).
	e.Admin.Posted(DocBody("purchase", "2026-02-02", sup, e.WH["KHO1"], Line(p, "2", "600000"), map[string]any{"product_id": e.DV, "description": "Cước xe", "unit_price": 50000}))
	eqDec(t, e.Debt("payable", sup), "1250000", "phải trả gồm cước")
	tp, _ = e.TotalStock(p)
	eqDec(t, tp, "11", "tồn")
	// Phiếu chuyển kho / tồn đầu không có dòng dịch vụ.
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", map[string]any{"doc_type": "transfer", "doc_date": "2026-02-03", "warehouse_id": e.WH["KHO1"], "to_warehouse_id": e.WH["KHO2"], "lines": []any{map[string]any{"product_id": e.DV, "unit_price": 1}}})
	// Hàng hóa không được đơn giá âm.
	e.Admin.Expect(400, "VALIDATION", "POST", "/api/documents", DocBody("sale", "2026-02-03", cus, e.WH["KHO1"], Line(p, "1", "-5")))
	// Báo cáo bán hàng có dòng dịch vụ với diễn giải.
	var tr reports.Trade
	e.Admin.OK("GET", "/api/reports/sales?from=2026-02-01&to=2026-02-01", nil, &tr)
	eqDec(t, tr.TotalAmount, "930000", "tổng báo cáo bán")
	eqDec(t, tr.TotalQty, "1", "SL bán chỉ tính hàng hóa")
	if tr.Rows[1].Description != "Chiết khấu thanh toán" || !tr.Rows[1].Amount.Equal(d("-100000")) {
		t.Fatalf("dòng dịch vụ trong báo cáo: %+v", tr.Rows[1])
	}
}

// REQ: 031, 030, 076
// Hai máy cùng ghi sổ hai phiếu bán tranh nhau cùng một lượng tồn: chỉ một phiếu được ghi sổ, không bao giờ âm kho.
func TestREQ031_HaiMayCungGhiSoTranhTon(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	may1 := e.NewUser("may1", "Máy 1")
	may2 := e.NewUser("may2", "Máy 2")
	cus := e.Partner("KH", "Khách E", true, false)
	for round := 0; round < 5; round++ {
		p := e.Product(fmt.Sprintf("R%d", round), "Hàng tranh chấp", "Cái", 100, 50, 0)
		e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "10", nil))
		d1 := may1.CreateDoc(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "6", nil)))
		d2 := may2.CreateDoc(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "6", nil)))
		var wg sync.WaitGroup
		start := make(chan struct{})
		codes := make([]int, 2)
		for i, pair := range []struct {
			c *Client
			d *docs.Document
		}{{may1, d1}, {may2, d2}} {
			wg.Add(1)
			go func(i int, c *Client, dd *docs.Document) {
				defer wg.Done()
				<-start
				codes[i] = c.Do("POST", fmt.Sprintf("/api/documents/%d/post", dd.ID), map[string]any{"version": dd.Version}).Status
			}(i, pair.c, pair.d)
		}
		close(start)
		wg.Wait()
		ok, rejected := 0, 0
		for _, c := range codes {
			switch c {
			case 200:
				ok++
			case 422:
				rejected++
			}
		}
		if ok != 1 || rejected != 1 {
			t.Fatalf("vòng %d: phải đúng 1 thành công + 1 bị chặn, nhận %v", round, codes)
		}
		tp, _ := e.TotalStock(p)
		eqDec(t, tp, "4", "tồn còn lại")
	}
	// Nhiều phiếu nhỏ đồng thời: tồn 5, 10 phiếu × 1 ⇒ đúng 5 phiếu ghi sổ.
	p := e.Product("MANY", "Hàng nhiều phiếu", "Cái", 100, 50, 0)
	e.Opening("2026-01-01", e.WH["KHO1"], Line(p, "5", nil))
	var ds []*docs.Document
	for i := 0; i < 10; i++ {
		c := may1
		if i%2 == 1 {
			c = may2
		}
		ds = append(ds, c.CreateDoc(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"], Line(p, "1", nil))))
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	okCount := 0
	start := make(chan struct{})
	for i, dd := range ds {
		c := may1
		if i%2 == 1 {
			c = may2
		}
		wg.Add(1)
		go func(c *Client, dd *docs.Document) {
			defer wg.Done()
			<-start
			if c.Do("POST", fmt.Sprintf("/api/documents/%d/post", dd.ID), map[string]any{"version": dd.Version}).Status == 200 {
				mu.Lock()
				okCount++
				mu.Unlock()
			}
		}(c, dd)
	}
	close(start)
	wg.Wait()
	if okCount != 5 {
		t.Fatalf("phải đúng 5 phiếu ghi sổ, có %d", okCount)
	}
	tp, _ := e.TotalStock(p)
	eqDec(t, tp, "0", "tồn về 0, không âm")
	// Hai máy cùng sửa một phiếu cùng version: chỉ một bên thắng.
	dd := may1.CreateDoc(DocBody("sale", "2026-02-01", cus, e.WH["KHO1"]))
	codes := make([]int, 2)
	start2 := make(chan struct{})
	for i, c := range []*Client{may1, may2} {
		wg.Add(1)
		go func(i int, c *Client) {
			defer wg.Done()
			<-start2
			codes[i] = c.Do("PUT", fmt.Sprintf("/api/documents/%d", dd.ID), map[string]any{"version": dd.Version, "doc_date": "2026-02-01", "partner_id": cus, "warehouse_id": e.WH["KHO1"], "note": c.Name}).Status
		}(i, c)
	}
	close(start2)
	wg.Wait()
	if !((codes[0] == 200 && codes[1] == 409) || (codes[0] == 409 && codes[1] == 200)) {
		t.Fatalf("sửa đồng thời: %v", codes)
	}
	_ = decimal.Zero
}
