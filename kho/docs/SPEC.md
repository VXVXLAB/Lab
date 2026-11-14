# ĐẶC TẢ KỸ THUẬT — Phần mềm Quản lý Kho / Bán hàng / Công nợ / Thu chi

Nguồn yêu cầu: `docs/yeu-cau/YEU_CAU_PHAN_MEM.txt` (yêu cầu gốc của khách) và
`docs/yeu-cau/TODO_91_DAU_VIEC.md` (91 đầu việc nghiệm thu, mã REQ-001…091).
Tài liệu này là **hợp đồng** giữa backend, frontend và kiểm thử. Muốn lệch khỏi nó phải ghi lại
trong `docs/QUYET_DINH.md` kèm lý do.

Người dùng: kế toán bán hàng / kế toán mua hàng / thủ kho của công ty thương mại vật tư (que hàn,
béc hàn, dây cáp…), 2–10 máy trong mạng nội bộ, không rành công nghệ. Toàn bộ giao diện, thông báo
lỗi, file xuất đều bằng **tiếng Việt có dấu**.

## 1. Kiến trúc

- **Backend**: Go 1.24, một binary `khoserver`. Router `chi`, PostgreSQL 16 qua `pgx/v5` (SQL thuần,
  không ORM), số thập phân `shopspring/decimal`, Excel `xuri/excelize/v2`, Word (.docx) tự sinh
  bằng `archive/zip` + XML (không phụ thuộc ngoài). Migration SQL nhúng (`embed`), tự chạy khi khởi động.
- **Frontend**: React 18 + TypeScript + Vite + Ant Design 5 (locale `vi_VN`) + TanStack Query +
  react-router. Build ra `frontend/dist`, binary Go phục vụ file tĩnh (SPA fallback) ⇒ triển khai
  một máy chủ, các máy khác mở trình duyệt vào `http://<ip-máy-chủ>:8080`.
- **Nhiều máy**: dữ liệu nằm trên một server chung ⇒ mọi máy thấy cùng dữ liệu. Cập nhật tức thời
  qua SSE; chống ghi đè nhau bằng khóa lạc quan (`version`).
- Cấu hình bằng biến môi trường: `DATABASE_URL`, `LISTEN_ADDR` (mặc định `:8080`),
  `ADMIN_PASSWORD` (mật khẩu admin khi seed lần đầu, mặc định `admin123`).
- DB dev: `postgres://kho:kho@127.0.0.1:5432/kho_dev`; DB test: `.../kho_test`.

Cấu trúc thư mục:
```
kho/
  backend/   cmd/khoserver, internal/{db,migrations,auth,catalog,docs,stock,debt,cash,reports,export,events,httpapi}, tests/
  frontend/  src/...
  e2e/       Playwright
  docs/
```

## 2. Quy tắc nghiệp vụ đã chốt (REQ-001…008)

**R1 – Kho (REQ-001).** Seed sẵn 4 kho `KHO1..KHO4` (đổi tên được, thêm được). Tồn kho = tổng
`stock_movements` của các chứng từ **đã ghi sổ**. Tồn tổng = cộng các kho. Chuyển kho nội bộ là
một chứng từ sinh 2 bút toán (xuất kho nguồn, nhập kho nhận), tổng tồn không đổi, không ảnh hưởng công nợ.

**R2 – Thẻ kho / chi tiết NXT (REQ-002).** Mỗi dòng: mã hàng, ngày hạch toán, số chứng từ, diễn
giải, ĐVT, SL nhập, SL xuất, tồn lũy kế; dòng đầu "Số dư đầu kỳ", dòng cuối tổng cộng. Diễn giải
tự sinh và **luôn có tên đối tượng**:
- bán: `Xuất kho bán hàng <tên KH>`; mua: `Nhập kho mua hàng <tên NCC>`;
- khách trả: `<tên KH> - trả hàng`; trả NCC: `Trả hàng <tên NCC>`;
- chuyển kho: `Chuyển kho <kho nguồn> → <kho nhận>`; tồn đầu: `Nhập tồn đầu kỳ`.
Nếu chứng từ có ghi chú thì nối thêm ` - <ghi chú>`. Sắp xếp: ngày hạch toán, rồi nhập trước xuất,
rồi số chứng từ. Khi xem "Tất cả kho" thì **ẩn** dòng chuyển kho (vì tự triệt tiêu).

**R3 – Sửa chứng từ quá khứ (REQ-003).** Chứng từ đã ghi sổ **sửa được bất kỳ lúc nào**, không
khóa kỳ: sửa ngày, đối tượng, kho, ghi chú, thêm/bớt/sửa dòng (SL, đơn giá). Trong một transaction:
ghi lại dòng → dựng lại bút toán kho → kiểm tra không âm kho (R6) → ghi `audit_log` (trước/sau).
Tồn kho, công nợ, báo cáo đều **tính từ chứng từ** nên tự đúng sau khi sửa. Có "Bỏ ghi sổ" (về phiếu
tạm) và "Xóa" (chỉ phiếu tạm). Số chứng từ chính thức không đổi khi sửa.

**R4 – Cảnh báo bán lỗ (REQ-004).** Giá vốn so sánh = **đơn giá nhập mua gần nhất** của mã hàng
(dòng phiếu mua đã ghi sổ có ngày ≤ ngày phiếu bán, mới nhất; mọi kho); nếu chưa từng mua thì dùng
`products.purchase_price`; nếu cũng = 0 thì không cảnh báo. Đơn giá bán < giá vốn ⇒ **cảnh báo**
(không chặn): hiện ngay khi nhập dòng, và khi ghi sổ phải xác nhận (`confirm_loss=true`).
Dòng dịch vụ không xét.

**R5 – Phiếu tạm (REQ-005).** Mọi chứng từ tạo ra ở trạng thái `draft` (phiếu tạm), số tạm `TAM000001`.
Phiếu tạm **không** ảnh hưởng tồn kho, công nợ; **không giữ hàng**; được nhập mặt hàng chưa có
tồn; in/xuất được nhưng tiêu đề ghi rõ **"PHIẾU TẠM (chưa ghi sổ)"** để gửi khách xem. "Ghi sổ"
(`posted`) ⇒ cấp số chính thức, sinh bút toán kho, phát sinh công nợ. In/xuất **phiếu chính thức**
chỉ khi đã ghi sổ ⇒ hàng hết tồn thì không ghi sổ được ⇒ không in được phiếu chính thức (REQ-031/032).
Báo cáo "Hàng cần đặt" tổng hợp phiếu bán tạm: SL trên phiếu tạm − tồn tổng hiện tại = SL thiếu (REQ-046).

**R6 – Kiểm tra tồn (REQ-030/031).** Khi ghi sổ / sửa / bỏ ghi sổ bất kỳ chứng từ nào, với mọi cặp
(mã hàng, kho) bị ảnh hưởng: tồn **cuối mỗi ngày** kể từ ngày bị ảnh hưởng trở đi phải ≥ 0. Vi phạm ⇒
từ chối `422 INSUFFICIENT_STOCK` kèm danh sách {mã hàng, tên, kho, ngày, tồn, cần, thiếu}. Gộp SL các
dòng cùng mã trong một phiếu trước khi so.

**R7 – Mã Dịch vụ (REQ-006).** Seed sẵn mặt hàng `DV` ("Dịch vụ", `is_service=true`). Dòng dịch vụ:
diễn giải tự do (`description`), SL mặc định 1, đơn giá có thể **dương, âm hoặc để trống** (ghi chú
thuần). Thành tiền cộng/trừ vào tổng phiếu ⇒ vào công nợ. Không sinh bút toán kho, không kiểm tồn,
không xét bán lỗ. Gõ `DV` hoặc `DICHVU` ở ô mã hàng đều ra mã này.

**R8 – Công nợ (REQ-034, 052–055, 062).** Tính động theo đối tác:
- Phải thu KH = `opening_receivable` + Σ phiếu bán − Σ khách trả hàng − Σ phiếu thu.
- Phải trả NCC = `opening_payable` + Σ phiếu mua − Σ trả hàng NCC − Σ phiếu chi.
Chỉ tính chứng từ đã ghi sổ. Một đối tác có thể vừa là KH vừa là NCC (hai sổ riêng).
Phiếu bán in ra có "Nợ cũ" (số dư phải thu trước phiếu này, tính đến trước nó theo ngày+thứ tự) và
"Tổng nợ" = nợ cũ + tổng phiếu.

**R9 – Thu chi (REQ-007, 056–061).** Tài khoản tiền: seed `TM` (Quỹ tiền mặt) và `NH` (Ngân hàng), thêm được.
Phiếu thu/chi gắn 1 tài khoản, 1 đối tác (có thể bỏ trống cho thu/chi khác), **nhiều dòng** {diễn
giải, số tiền, chứng từ liên quan (tùy chọn)}. Lưu là có hiệu lực (không có trạng thái tạm), sửa/xóa
được, có `version`. Số phiếu: thu tiền mặt `PT`, chi tiền mặt `PC`, thu ngân hàng `BC`, chi ngân hàng `BN`.

**R10 – Báo cáo & xuất file (REQ-008).** Mọi dòng báo cáo có `document_id`/`voucher_id`/`product_id`/
`partner_id` để frontend bấm vào mở chi tiết **ngay trong màn báo cáo** (Drawer/Modal, không rời trang).
Mọi báo cáo xuất `.xlsx`; chứng từ xuất `.xlsx` và `.docx` là file thường (bảng thật, không ảnh, không
khóa sheet) ⇒ thêm/bớt dòng cột được.

**Số chứng từ chính thức**: mua `NK`, khách trả hàng `NK` (chung dãy), bán `XK`, trả NCC `XK` (chung dãy),
chuyển kho `CK`, tồn đầu `TDK`; dạng tiền tố + 5 chữ số, cấp tăng dần không trùng (bảng `counters`, `FOR UPDATE`).

**Làm tròn**: SL `numeric(18,3)`, đơn giá & tiền `numeric(18,2)`; `amount = round(qty*unit_price, 0)` (VND).
JSON trả **number**.

## 3. Mô hình dữ liệu (PostgreSQL)

```
users(id, username UNIQUE, password_hash, full_name, role CHECK IN('admin','ketoan'), active, created_at)
sessions(token PK, user_id, expires_at)
warehouses(id, code UNIQUE, name, active)
product_groups(id, code UNIQUE, name)
products(id, code UNIQUE, name, unit, group_id NULL, sale_price, purchase_price, is_service, active)
partners(id, code UNIQUE, name, address, phone, tax_code, is_customer, is_supplier,
         opening_receivable, opening_payable, active)
cash_accounts(id, code UNIQUE, name, kind CHECK IN('cash','bank'), opening_balance, active)
counters(key PK, value)
documents(id, doc_type CHECK IN('purchase','sale','sale_return','purchase_return','transfer','opening'),
          doc_no UNIQUE, draft_no, doc_date, status CHECK IN('draft','posted'),
          partner_id NULL, warehouse_id, to_warehouse_id NULL, note, total_amount,
          version INT, created_by, updated_by, posted_by, posted_at, created_at, updated_at)
document_lines(id, document_id, line_no, product_id, description, unit, qty, unit_price NULL, amount, note)
stock_movements(id, document_id, line_id, product_id, warehouse_id, doc_date, qty_in, qty_out, unit_cost)
     -- chỉ tồn tại cho chứng từ posted & hàng không phải dịch vụ; index (product_id, warehouse_id, doc_date)
cash_vouchers(id, voucher_type CHECK IN('receipt','payment'), voucher_no UNIQUE, voucher_date,
              account_id, partner_id NULL, note, total_amount, version, created_by, updated_by, created_at, updated_at)
cash_voucher_lines(id, voucher_id, line_no, description, amount, document_id NULL)
audit_log(id, at, user_id, entity, entity_id, action, before JSONB, after JSONB)
```
Ràng buộc: `sale`/`sale_return` cần partner là KH; `purchase`/`purchase_return` cần partner là NCC;
`transfer` cần `to_warehouse_id ≠ warehouse_id`, không partner; `opening` không partner.
Seed: admin, 4 kho, mã `DV`, tài khoản `TM`, `NH`.

## 4. API (JSON, tiền tố `/api`)

Xác thực bằng cookie `session` (HttpOnly). Lỗi: `{"error":{"code":"...","message":"<tiếng Việt>","details":...}}`.
Mã lỗi chuẩn: `UNAUTHORIZED`(401) `FORBIDDEN`(403) `NOT_FOUND`(404) `VALIDATION`(400)
`VERSION_CONFLICT`(409, details: người sửa sau cùng, thời điểm, version hiện tại)
`LOSS_WARNING`(409, details: các dòng lỗ) `INSUFFICIENT_STOCK`(422) `IN_USE`(409).
Danh sách có phân trang trả `{"items":[...],"total":n,"page":p,"page_size":s}`.

**Auth**: `POST /auth/login {username,password}` · `POST /auth/logout` · `GET /auth/me`
**Người dùng (admin)**: `GET/POST /users` · `PUT /users/{id}`
**Danh mục** (CRUD: `GET` list có `q`,`page`,`page_size`,`active`; `POST`; `GET /{id}`; `PUT /{id}`; `DELETE /{id}` → `IN_USE` nếu đã phát sinh):
`/warehouses` · `/product-groups` · `/products` (thêm lọc `group_id`, `is_service`) · `/partners` (lọc `type=customer|supplier`) · `/cash-accounts`
- `GET /products/{id}/price-info?date=` → `{sale_price, cost_price, cost_source:"last_purchase"|"default"|"none", total_stock, stock_by_warehouse:[{warehouse_id,code,name,qty}]}`
- `GET /products/lookup?code=` → tìm chính xác theo mã (không phân biệt hoa thường; `DICHVU` ⇒ `DV`).

**Chứng từ**
- `GET /documents?type=&status=&partner_id=&warehouse_id=&product_id=&q=&from=&to=&page=&page_size=` (q tìm theo số phiếu, số tạm, tên đối tác, ghi chú)
- `POST /documents` → tạo phiếu tạm. Body: `{doc_type, doc_date, partner_id, warehouse_id, to_warehouse_id, note, lines:[{product_id, description, unit, qty, unit_price, note}]}`
- `GET /documents/{id}` → đầy đủ header + lines (kèm `product_code`, `product_name`, `is_service`) + tên đối tác/kho + người tạo/sửa/ghi sổ + `warnings` + `old_debt`,`total_debt` (phiếu bán/mua).
- `PUT /documents/{id}` body như POST + `version` (bắt buộc). Dùng cho cả phiếu tạm và phiếu đã ghi sổ (R3). Phiếu đã ghi sổ có dòng lỗ ⇒ cần `confirm_loss`.
- `POST /documents/{id}/post {version, confirm_loss}` · `POST /documents/{id}/unpost {version}` · `DELETE /documents/{id}` (chỉ draft)
- `GET /documents/{id}/check` → `{stock_shortages:[...], loss_lines:[...]}` (không đổi dữ liệu)
- `GET /documents/{id}/export?format=xlsx|docx` (draft ⇒ tiêu đề "PHIẾU TẠM (chưa ghi sổ)")
- `GET /documents/{id}/history` → audit log của phiếu.
- Mọi response ghi (POST/PUT/post) trả document đầy đủ + `warnings:[{type:"loss", line_no, product_code, unit_price, cost_price}]`.

**Thu chi**: `GET /vouchers?type=&account_id=&partner_id=&from=&to=&q=` · `POST /vouchers` · `GET/PUT/DELETE /vouchers/{id}` · `GET /vouchers/{id}/export?format=xlsx|docx`
Body: `{voucher_type, voucher_date, account_id, partner_id, note, lines:[{description, amount, document_id}], version}`.

**Báo cáo** (tất cả nhận thêm `format=xlsx` để tải file):
- `GET /reports/stock-summary?as_of=&group_id=&q=&warehouse_id=&only_with_data=true` → mỗi mã: `{product_id, code, name, unit, group_name, by_warehouse:{<warehouse_id>:qty}, total}` + danh sách kho (REQ-009/010/020/022/063/075)
- `GET /reports/stock-nxt?from=&to=&warehouse_id=&group_id=&q=` → mỗi mã: tồn đầu, nhập, xuất, tồn cuối (REQ-064)
- `GET /reports/stock-ledger?product_id=&from=&to=&warehouse_id=` → `{product, opening, rows:[{date, doc_no, document_id, doc_type, description, partner_name, unit, qty_in, qty_out, balance}], total_in, total_out, closing}` (REQ-012…019)
- `GET /reports/sales?from=&to=&partner_id=&product_id=&group_id=` và `GET /reports/purchases?...` → theo dòng hàng: ngày, số phiếu, document_id, đối tác, mã/tên hàng, SL, đơn giá, thành tiền + tổng (REQ-021/066/067)
- `GET /reports/debt-summary?side=receivable|payable&from=&to=&q=` → mỗi đối tác: đầu kỳ, tăng, giảm, cuối kỳ (REQ-052/054/065)
- `GET /reports/debt-ledger?partner_id=&side=&from=&to=` → đầu kỳ + dòng {date, ref_no, document_id|voucher_id, description, increase, decrease, balance} + cuối kỳ (REQ-053/055)
- `GET /reports/cash-book?account_id=&from=&to=` → sổ quỹ / sổ ngân hàng có số dư lũy kế
- `GET /reports/draft-demand` → hàng cần đặt từ phiếu bán tạm: `{product, qty_in_drafts, total_stock, shortage, drafts:[{document_id, draft_no, partner_name, qty}]}` (REQ-046)
- `GET /dashboard` → số phiếu tạm đang treo, doanh thu hôm nay/tháng, tổng phải thu, tổng phải trả, số mã sắp hết.

**Sự kiện**: `GET /events` (SSE). Phát `{"type":"document.changed"|"voucher.changed"|"catalog.changed","id":..,"doc_type":..,"status":..,"action":"created|updated|posted|unposted|deleted","by":"<họ tên>","at":..}` sau mỗi thay đổi (REQ-042…044).

## 5. Yêu cầu chất lượng
- Mọi thao tác ghi chạy trong transaction; khóa hàng `documents` bằng `SELECT … FOR UPDATE` khi sửa/ghi sổ;
  kiểm tra tồn có khóa tránh 2 máy cùng bán vượt tồn (advisory lock theo product_id+warehouse_id hoặc tương đương).
- Không có số tồn/công nợ lưu sẵn bị lệch: mọi con số tính từ `stock_movements` / chứng từ.
- Test nghiệm thu gắn mã yêu cầu: tên test dạng `TestREQ011_...`; một test có thể phủ nhiều mã (ghi trong comment `// REQ: 011, 077`).
- `docs/NGHIEM_THU.md`: bảng 91 mã ↔ test ↔ kết quả.
