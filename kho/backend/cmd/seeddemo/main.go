// Lệnh seeddemo: nạp dữ liệu mẫu (vật tư hàn) để trình diễn giao diện.
//
//	go run ./cmd/seeddemo            # nạp vào CSDL trống (từ chối nếu đã có chứng từ)
//	go run ./cmd/seeddemo -reset     # XÓA SẠCH dữ liệu rồi nạp lại (chỉ dùng cho CSDL demo!)
//
// Dùng DATABASE_URL (mặc định postgres://kho:kho@127.0.0.1:5432/kho_dev).
// Người dùng mẫu: admin/admin123, lan/123456 (Máy 1), hoa/123456 (Máy 2).
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/shopspring/decimal"

	"kho/internal/auth"
	"kho/internal/cash"
	"kho/internal/catalog"
	"kho/internal/db"
	"kho/internal/docs"
	"kho/internal/util"
)

func main() {
	reset := flag.Bool("reset", false, "xóa sạch dữ liệu hiện có trước khi nạp dữ liệu mẫu")
	flag.Parse()
	ctx := context.Background()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://kho:kho@127.0.0.1:5432/kho_dev"
	}
	pool, err := db.Connect(ctx, url, db.Options{})
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		log.Fatal(err)
	}
	if *reset {
		_, err := pool.Exec(ctx, `TRUNCATE audit_log, cash_voucher_lines, cash_vouchers, stock_movements, document_lines, documents,
			counters, sessions, users, partners, products, product_groups, warehouses, cash_accounts RESTART IDENTITY CASCADE`)
		if err != nil {
			log.Fatal(err)
		}
	}
	if err := db.Seed(ctx, pool, db.SeedOptions{AdminPassword: envOr("ADMIN_PASSWORD", "admin123")}); err != nil {
		log.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM documents`).Scan(&n); err != nil {
		log.Fatal(err)
	}
	if n > 0 {
		log.Fatalf("CSDL đã có %d chứng từ. Chạy lại với -reset để xóa sạch và nạp dữ liệu mẫu.", n)
	}
	s := &seeder{ctx: ctx}
	s.cat = &catalog.Service{Pool: pool}
	s.docs = &docs.Service{Pool: pool, Catalog: s.cat}
	s.cash = &cash.Service{Pool: pool, Catalog: s.cat}
	s.auth = &auth.Service{Pool: pool}
	if err := s.run(); err != nil {
		log.Fatalf("Lỗi nạp dữ liệu mẫu: %v", err)
	}
	fmt.Println("Đã nạp dữ liệu mẫu. Đăng nhập: admin/admin123, lan/123456 (Máy 1), hoa/123456 (Máy 2).")
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

type seeder struct {
	ctx      context.Context
	cat      *catalog.Service
	docs     *docs.Service
	cash     *cash.Service
	auth     *auth.Service
	admin    int64
	lan, hoa int64
	wh       map[string]int64
	prod     map[string]int64
	partner  map[string]int64
	tm, nh   int64
}

func dec(v int64) *decimal.Decimal { x := decimal.NewFromInt(v); return &x }

func date(s string) util.Date {
	d, err := util.ParseDate(s)
	if err != nil {
		panic(err)
	}
	return d
}

type ln struct {
	code  string
	qty   string
	price int64 // -1 = để trống (dịch vụ: dòng ghi chú; hàng hóa: lấy giá mặc định)
	desc  string
}

func (s *seeder) lines(ls []ln) []docs.LineInput {
	out := make([]docs.LineInput, 0, len(ls))
	for _, l := range ls {
		q := decimal.RequireFromString(l.qty)
		li := docs.LineInput{ProductCode: l.code, Qty: &q, Description: l.desc}
		if l.price != -1 {
			li.UnitPrice = dec(l.price)
		}
		out = append(out, li)
	}
	return out
}

func (s *seeder) doc(user int64, typ, d, partner, wh, toWh, note string, post bool, ls ...ln) *docs.Document {
	in := docs.Input{DocType: typ, DocDate: date(d), WarehouseID: s.wh[wh], Note: note, Lines: s.lines(ls)}
	if partner != "" {
		id := s.partner[partner]
		in.PartnerID = &id
	}
	if toWh != "" {
		id := s.wh[toWh]
		in.ToWarehouseID = &id
	}
	doc, err := s.docs.Create(s.ctx, user, in)
	if err != nil {
		panic(fmt.Errorf("tạo %s %s: %w", typ, d, err))
	}
	if post {
		doc, err = s.docs.Post(s.ctx, user, doc.ID, doc.Version, true)
		if err != nil {
			panic(fmt.Errorf("ghi sổ %s %s: %w", typ, d, err))
		}
	}
	return doc
}

func (s *seeder) voucher(user int64, typ, d string, acc int64, partner, note string, lines ...cash.LineInput) {
	in := cash.Input{VoucherType: typ, VoucherDate: date(d), AccountID: acc, Note: note, Lines: lines}
	if partner != "" {
		id := s.partner[partner]
		in.PartnerID = &id
	}
	if _, err := s.cash.Create(s.ctx, user, in); err != nil {
		panic(fmt.Errorf("phiếu %s %s: %w", typ, d, err))
	}
}

func cl(desc string, amount int64) cash.LineInput {
	return cash.LineInput{Description: desc, Amount: dec(amount)}
}

func (s *seeder) run() (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("%v", r)
		}
	}()
	ctx := s.ctx
	s.admin = 1
	lan, err := s.auth.CreateUser(ctx, auth.UserInput{Username: "lan", Password: "123456", FullName: "Nguyễn Thị Lan (Máy 1)", Role: "ketoan"})
	if err != nil {
		return err
	}
	hoa, err := s.auth.CreateUser(ctx, auth.UserInput{Username: "hoa", Password: "123456", FullName: "Trần Thị Hoa (Máy 2)", Role: "ketoan"})
	if err != nil {
		return err
	}
	s.lan, s.hoa = lan.ID, hoa.ID

	if _, err := s.cat.SaveSettings(ctx, s.admin, catalog.SettingsInput{CompanyName: "CÔNG TY TNHH VẬT TƯ HÀN MINH PHÁT",
		CompanyAddress: "12 Lê Trọng Tấn, P. Tây Thạnh, Q. Tân Phú, TP.HCM", CompanyPhone: "028 3812 3456", CompanyTaxCode: "0312345678"}); err != nil {
		return err
	}
	// Kho: đổi tên 4 kho seed.
	s.wh = map[string]int64{}
	names := map[string]string{"KHO1": "Kho Tân Bình", "KHO2": "Kho Bình Tân", "KHO3": "Kho Thủ Đức", "KHO4": "Kho Bình Dương"}
	whs, err := s.cat.ListWarehouses(ctx, util.ListParams{Page: 1, PageSize: 100})
	if err != nil {
		return err
	}
	for _, w := range whs.Items {
		s.wh[w.Code] = w.ID
		if nm, ok := names[w.Code]; ok {
			if _, err := s.cat.SaveWarehouse(ctx, s.admin, w.ID, catalog.WarehouseInput{Code: w.Code, Name: nm}); err != nil {
				return err
			}
		}
	}
	accs, err := s.cat.ListCashAccounts(ctx, util.ListParams{Page: 1, PageSize: 100})
	if err != nil {
		return err
	}
	for _, a := range accs.Items {
		switch a.Code {
		case "TM":
			s.tm = a.ID
			if _, err := s.cat.SaveCashAccount(ctx, s.admin, a.ID, catalog.CashAccountInput{Code: "TM", Name: "Quỹ tiền mặt", Kind: "cash", OpeningBalance: dec(50000000)}); err != nil {
				return err
			}
		case "NH":
			s.nh = a.ID
			if _, err := s.cat.SaveCashAccount(ctx, s.admin, a.ID, catalog.CashAccountInput{Code: "NH", Name: "Ngân hàng Vietcombank - CN Tân Bình", Kind: "bank", OpeningBalance: dec(300000000)}); err != nil {
				return err
			}
		}
	}

	// Nhóm VTHH.
	groups := map[string]int64{}
	for _, g := range [][2]string{{"QH", "Que hàn"}, {"DH", "Dây hàn"}, {"BEC", "Béc & phụ kiện súng hàn"}, {"SUNG", "Súng hàn & máy hàn"}, {"PK", "Phụ kiện điện"}, {"BH", "Bảo hộ lao động"}} {
		x, err := s.cat.SaveGroup(ctx, s.admin, 0, catalog.GroupInput{Code: g[0], Name: g[1]})
		if err != nil {
			return err
		}
		groups[g[0]] = x.ID
	}
	// Mặt hàng.
	s.prod = map[string]int64{}
	type pd struct {
		code, name, unit, group string
		sale, purchase          int64
	}
	for _, p := range []pd{
		{"K701832", "Que hàn Kiswel K7018-3.2 (20kg)", "Thùng", "QH", 1090000, 950000},
		{"K701840", "Que hàn Kiswel K7018-4.0 (20kg)", "Thùng", "QH", 1120000, 980000},
		{"KT42126", "Que hàn Kim Tín KT-421 2.6mm (5kg)", "Hộp", "QH", 185000, 150000},
		{"KT42132", "Que hàn Kim Tín KT-421 3.2mm (5kg)", "Hộp", "QH", 180000, 146000},
		{"WW829HT107k", "Dây hàn lõi thuốc WW829 1.2mm (15kg)", "Cuộn", "DH", 820000, 690000},
		{"ER70S6-08", "Dây hàn CO2 ER70S-6 0.8mm (15kg)", "Cuộn", "DH", 560000, 470000},
		{"ER70S6-10", "Dây hàn CO2 ER70S-6 1.0mm (15kg)", "Cuộn", "DH", 545000, 455000},
		{"CN249SS08", "Béc CO2 Sunshine 0.8 mm", "Cái", "BEC", 13000, 8500},
		{"CN249SS10", "Béc CO2 Sunshine 1.0 mm", "Cái", "BEC", 13000, 8500},
		{"CN249SS12", "Béc CO2 Sunshine 1.2 mm", "Cái", "BEC", 13500, 9000},
		{"CHUP350", "Chụp khí súng hàn CO2 350A", "Cái", "BEC", 45000, 30000},
		{"4CA200A5", "Súng hàn CO2 200A-5.0M (EU)", "Bộ", "SUNG", 600000, 450000},
		{"4CA350A5", "Súng hàn CO2 350A-5.0M (EU)", "Bộ", "SUNG", 950000, 720000},
		{"JASICMIG250", "Máy hàn MIG Jasic 250A", "Cái", "SUNG", 9800000, 8200000},
		{"COS10", "Đầu cos (khoen đồng) 10mm (50c/bao)", "Cái", "PK", 6000, 3800},
		{"COS16", "Đầu cos (khoen đồng) 16mm (50c/bao)", "Cái", "PK", 8000, 5200},
		{"CAPHAN25", "Cáp hàn 25mm² (cuộn 100m)", "Mét", "PK", 38000, 29000},
		{"KINHHAN", "Kính hàn đen", "Cái", "BH", 15000, 9000},
		{"GANGTAYDA", "Găng tay da hàn", "Đôi", "BH", 35000, 22000},
		{"MATNA", "Mặt nạ hàn tự động biến quang", "Cái", "BH", 450000, 320000},
	} {
		gid := groups[p.group]
		x, err := s.cat.SaveProduct(ctx, s.admin, 0, catalog.ProductInput{Code: p.code, Name: p.name, Unit: p.unit, GroupID: &gid, SalePrice: dec(p.sale), PurchasePrice: dec(p.purchase)})
		if err != nil {
			return err
		}
		s.prod[p.code] = x.ID
	}
	// Đối tác.
	s.partner = map[string]int64{}
	type pt struct {
		code, name, addr, phone, tax string
		cus, sup                     bool
		openR, openP                 int64
	}
	for _, p := range []pt{
		{"VINHPHONG", "CTY TNHH TM DV VĨNH PHONG", "123 Lũy Bán Bích, P. Tân Thới Hòa, Q. Tân Phú, TP.HCM", "0283 861 2345", "0312345678", true, false, 2000000, 0},
		{"NGOCMINH", "CHÚ NGỌC MINH", "Chợ Bình Tây, Q.6, TP.HCM", "0903 111 222", "", true, false, 0, 0},
		{"PHAMGIA", "CÔNG TY TNHH NHỰA PHẠM GIA - Phường Bình Hưng Hòa B", "45 Đường số 7, P. Bình Hưng Hòa B, Q. Bình Tân, TP.HCM", "0287 300 4567", "0315678901", true, false, 0, 0},
		{"TANPHU", "Cơ khí Tân Phú", "88 Tân Kỳ Tân Quý, Q. Tân Phú, TP.HCM", "0918 222 333", "", true, false, 5500000, 0},
		{"THANHCONG", "Xưởng cơ khí Thành Công", "KCN Tân Tạo, Q. Bình Tân, TP.HCM", "0909 444 555", "0309876543", true, false, 0, 0},
		{"DAIPHAT", "Công ty CP Kết cấu thép Đại Phát", "KCN Sóng Thần, Dĩ An, Bình Dương", "0274 377 8899", "3701234567", true, false, 12000000, 0},
		{"KHACHLE", "Khách lẻ", "", "", "", true, false, 0, 0},
		{"KISWEL", "Công ty TNHH Kiswel Việt Nam", "KCN Long Hậu, Long An", "0272 362 1234", "1101234567", false, true, 0, 45000000},
		{"KIMTIN", "Công ty CP Kim Tín", "KCN Nhơn Trạch, Đồng Nai", "0251 356 7890", "3601234567", false, true, 0, 0},
		{"SUNSHINE", "Công ty TNHH Sunshine Welding", "Q. 12, TP.HCM", "0283 715 9999", "0301112223", false, true, 0, 0},
		{"HANVIET", "Công ty TNHH Thiết bị hàn Hàn Việt", "Q. Gò Vấp, TP.HCM", "0283 894 5678", "0304445556", true, true, 0, 8000000},
	} {
		x, err := s.cat.SavePartner(ctx, s.admin, 0, catalog.PartnerInput{Code: p.code, Name: p.name, Address: p.addr, Phone: p.phone, TaxCode: p.tax,
			IsCustomer: p.cus, IsSupplier: p.sup, OpeningReceivable: dec(p.openR), OpeningPayable: dec(p.openP)})
		if err != nil {
			return err
		}
		s.partner[p.code] = x.ID
	}

	// Tồn đầu kỳ 4 kho.
	s.doc(s.admin, "opening", "2026-01-01", "", "KHO1", "", "Số dư đầu năm 2026", true,
		ln{"K701832", "40", 950000, ""}, ln{"K701840", "25", 980000, ""}, ln{"KT42126", "60", 150000, ""}, ln{"WW829HT107k", "27", 690000, ""},
		ln{"ER70S6-08", "30", 470000, ""}, ln{"CN249SS08", "800", 8500, ""}, ln{"CN249SS10", "900", 8500, ""}, ln{"COS10", "1500", 3800, ""},
		ln{"4CA200A5", "12", 450000, ""}, ln{"KINHHAN", "200", 9000, ""}, ln{"GANGTAYDA", "150", 22000, ""})
	s.doc(s.admin, "opening", "2026-01-01", "", "KHO2", "", "Số dư đầu năm 2026", true,
		ln{"K701832", "20", 950000, ""}, ln{"KT42132", "50", 146000, ""}, ln{"ER70S6-10", "40", 455000, ""}, ln{"CN249SS12", "400", 9000, ""},
		ln{"CHUP350", "120", 30000, ""}, ln{"COS16", "800", 5200, ""}, ln{"CAPHAN25", "500", 29000, ""})
	s.doc(s.admin, "opening", "2026-01-01", "", "KHO3", "", "Số dư đầu năm 2026", true,
		ln{"4CA350A5", "8", 720000, ""}, ln{"JASICMIG250", "5", 8200000, ""}, ln{"MATNA", "30", 320000, ""}, ln{"WW829HT107k", "10", 690000, ""})
	s.doc(s.admin, "opening", "2026-01-01", "", "KHO4", "", "Số dư đầu năm 2026", true,
		ln{"K701840", "15", 980000, ""}, ln{"ER70S6-08", "20", 470000, ""}, ln{"CN249SS10", "300", 8500, ""}, ln{"GANGTAYDA", "80", 22000, ""})

	// Mua hàng (tháng 1 — ví dụ sửa phiếu cũ của khách) và các tháng sau.
	s.doc(s.lan, "purchase", "2026-01-15", "KISWEL", "KHO1", "", "HĐ 0001245", true,
		ln{"K701832", "50", 950000, ""}, ln{"K701840", "30", 980000, ""})
	s.doc(s.lan, "purchase", "2026-02-20", "KIMTIN", "KHO2", "", "HĐ 0008812", true,
		ln{"KT42126", "100", 150000, ""}, ln{"KT42132", "100", 146000, ""})
	s.doc(s.lan, "purchase", "2026-03-10", "SUNSHINE", "KHO1", "", "", true,
		ln{"CN249SS08", "1000", 8500, ""}, ln{"CN249SS10", "1000", 8700, ""}, ln{"CN249SS12", "500", 9000, ""},
		ln{"DV", "1", 250000, "Cước vận chuyển"})
	s.doc(s.hoa, "purchase", "2026-06-05", "HANVIET", "KHO3", "", "", true,
		ln{"JASICMIG250", "3", 8300000, ""}, ln{"MATNA", "20", 330000, ""})
	s.doc(s.lan, "purchase", "2026-09-02", "KISWEL", "KHO1", "", "HĐ 0002390", true, ln{"K701832", "30", 960000, ""})
	s.doc(s.hoa, "purchase_return", "2026-09-05", "KISWEL", "KHO1", "", "Trả 2 thùng móp méo", true, ln{"K701832", "2", 960000, ""})

	// Chuyển kho nội bộ.
	s.doc(s.hoa, "transfer", "2026-02-01", "", "KHO1", "KHO4", "Bổ sung hàng cho kho Bình Dương", true, ln{"K701832", "10", -1, ""}, ln{"COS10", "300", -1, ""})
	s.doc(s.hoa, "transfer", "2026-07-15", "", "KHO3", "KHO1", "", true, ln{"MATNA", "5", -1, ""})

	// Bán hàng — gồm đúng ví dụ thẻ kho của khách cho mã WW829HT107k.
	s.doc(s.lan, "sale", "2026-04-03", "VINHPHONG", "KHO1", "", "", true, ln{"WW829HT107k", "4", 820000, ""}, ln{"CN249SS08", "100", 13000, ""})
	s.doc(s.lan, "sale", "2026-04-14", "VINHPHONG", "KHO1", "", "", true, ln{"WW829HT107k", "3", 820000, ""})
	s.doc(s.hoa, "sale_return", "2026-04-17", "NGOCMINH", "KHO1", "", "", true, ln{"WW829HT107k", "1", 820000, ""})
	s.doc(s.lan, "sale", "2026-05-26", "PHAMGIA", "KHO1", "", "", true, ln{"WW829HT107k", "1", 820000, ""}, ln{"GANGTAYDA", "20", 35000, ""})
	s.doc(s.lan, "sale", "2026-03-15", "TANPHU", "KHO2", "", "", true, ln{"KT42132", "30", 180000, ""}, ln{"CHUP350", "10", 45000, ""})
	s.doc(s.hoa, "sale", "2026-06-20", "DAIPHAT", "KHO3", "", "Giao tại công trình Dĩ An", true,
		ln{"JASICMIG250", "2", 9800000, ""}, ln{"MATNA", "5", 450000, ""}, ln{"DV", "1", 500000, "Phí lắp đặt, hướng dẫn sử dụng"},
		ln{"DV", "1", -300000, "Chiết khấu khách quen"})
	s.doc(s.lan, "sale", "2026-08-10", "THANHCONG", "KHO1", "", "", true, ln{"K701832", "2", 1000000, ""})
	// Mẫu phiếu bán của khách (5 mặt hàng + DICHVU ghi chú + DICHVU 400.000).
	s.doc(s.lan, "sale", "2026-09-25", "THANHCONG", "KHO1", "", "", true,
		ln{"4CA200A5", "1", 600000, ""}, ln{"CN249SS08", "50", 13000, ""}, ln{"CN249SS10", "50", 13000, ""}, ln{"COS10", "100", 6000, ""},
		ln{"K701832", "1", 1090000, ""}, ln{"DV", "1", -1, "TRẢ 01 ĐỒNG HỒ"}, ln{"DV", "1", 400000, "PHÍ SỬA XE"})
	s.doc(s.hoa, "sale", "2026-10-12", "HANVIET", "KHO2", "", "", true, ln{"CAPHAN25", "100", 38000, ""}, ln{"COS16", "200", 8000, ""})
	// Một phiếu bán dưới giá vốn (đã xác nhận bán lỗ).
	s.doc(s.lan, "sale", "2026-10-20", "KHACHLE", "KHO1", "", "Xả hàng tồn lâu", true, ln{"KINHHAN", "50", 8000, ""})
	// Doanh thu hôm nay / tháng này.
	today := util.Today()
	s.doc(s.lan, "sale", today.String(), "TANPHU", "KHO1", "", "", true, ln{"K701840", "2", 1120000, ""}, ln{"GANGTAYDA", "10", 35000, ""})
	if today.Day() > 1 {
		s.doc(s.hoa, "sale", util.NewDate(today.Year(), today.Month(), 1).String(), "VINHPHONG", "KHO4", "", "", true, ln{"ER70S6-08", "5", 560000, ""})
	}

	// Phiếu tạm đang treo (máy 1 lập, chưa chốt) — có mặt hàng chưa đủ tồn.
	s.doc(s.lan, "sale", today.String(), "DAIPHAT", "KHO3", "", "Báo giá - chờ khách xác nhận", false,
		ln{"JASICMIG250", "10", 9600000, ""}, ln{"4CA350A5", "4", 950000, ""}, ln{"DV", "1", 800000, "Vận chuyển tới Bình Dương"})
	s.doc(s.hoa, "sale", today.String(), "VINHPHONG", "KHO1", "", "Khách gọi điện đặt, chiều giao", false,
		ln{"WW829HT107k", "5", -1, ""}, ln{"CN249SS12", "100", -1, ""})
	s.doc(s.lan, "purchase", today.String(), "SUNSHINE", "KHO1", "", "Đơn đặt hàng dự kiến", false,
		ln{"CN249SS12", "500", 9000, ""})

	// Thu chi nhiều dòng.
	s.voucher(s.lan, "receipt", "2026-04-20", s.tm, "VINHPHONG", "Thu nợ tháng 4",
		cl("Thu nợ cũ", 2000000), cl("Thu tiền phiếu bán ngày 03/04", 4000000), cl("Thu tiền phiếu bán ngày 14/04", 2460000))
	s.voucher(s.hoa, "receipt", "2026-07-01", s.nh, "DAIPHAT", "Chuyển khoản Vietcombank",
		cl("Thanh toán đợt 1 HĐ máy hàn", 10000000), cl("Thanh toán đợt 2 HĐ máy hàn", 8000000))
	s.voucher(s.lan, "payment", "2026-02-25", s.nh, "KISWEL", "Ủy nhiệm chi",
		cl("Trả nợ đầu kỳ", 45000000), cl("Trả tiền HĐ 0001245", 40000000), cl("Phí chuyển khoản", 22000))
	s.voucher(s.lan, "payment", "2026-03-12", s.tm, "SUNSHINE", "",
		cl("Trả tiền hàng béc CO2", 20000000), cl("Trả cước vận chuyển", 250000))
	s.voucher(s.hoa, "payment", "2026-10-01", s.tm, "", "Chi phí văn phòng",
		cl("Tiền điện tháng 9", 2350000), cl("Tiền nước tháng 9", 420000))
	return nil
}
