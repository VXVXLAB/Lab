# API — Phần mềm Quản lý Kho / Bán hàng / Công nợ / Thu chi

Tài liệu này mô tả **đúng API đã cài đặt** trong `backend/` (Go). Frontend chỉ cần đọc file này.
Mọi ví dụ JSON lấy từ phản hồi thật của server (dữ liệu mẫu `cmd/seeddemo`), có rút gọn bằng `…`.

## 0. Quy ước chung

| Mục | Quy ước |
|---|---|
| Tiền tố | Mọi endpoint nằm dưới `/api`. Ngoài `/api`, server phục vụ file tĩnh SPA (`STATIC_DIR`, fallback `index.html`). |
| Định dạng | Request/response `application/json; charset=utf-8`. Body tối đa 5 MB. Trường lạ trong body bị bỏ qua. |
| Xác thực | Cookie `session` (HttpOnly, SameSite=Lax, 30 ngày) do `POST /api/auth/login` đặt. Trình duyệt tự gửi; dùng `fetch(..., {credentials: "include"})` nếu khác origin. Cũng chấp nhận header `Authorization: Bearer <token>` (chỉ dùng cho công cụ, token chính là giá trị cookie). Thiếu/hết hạn ⇒ `401 UNAUTHORIZED`. |
| Số | Tiền, đơn giá, số lượng trả về là **JSON number** (`3990000`, `100.5`). Gửi lên có thể là number hoặc chuỗi số (`"100.5"`). SL lưu 3 chữ số thập phân, đơn giá/tiền 2 chữ số; `amount = round(qty × unit_price, 0)` (đồng). |
| Ký tự NUL | Mọi chuỗi trong body JSON (`\u0000`) và mọi tham số truy vấn (`%00`) có ký tự NUL ⇒ `400 VALIDATION` "Dữ liệu không được chứa ký tự NUL…". |
| Ngày | `doc_date`, `from`, `to`, `as_of`… dạng `"YYYY-MM-DD"` (server cũng nhận `"DD/MM/YYYY"`). Ngày **đã gửi** không bao giờ bị thay bằng ngày mặc định: chỉ khi bỏ trường / `null` / `""` mới dùng mặc định. Ngày chứng từ / phiếu thu chi phải trong năm 2000–2100 (ngoài khoảng ⇒ 400); tham số lọc báo cáo nhận mọi ngày hợp lệ (vd. `as_of=0001-01-01` ⇒ tồn 0, `from=0001-01-01` ⇒ từ đầu). Thời điểm (`created_at`, `posted_at`…) là RFC 3339 UTC, ví dụ `"2026-11-14T13:58:09.257103Z"` — frontend đổi sang giờ VN khi hiển thị. "Hôm nay" phía server tính theo giờ Việt Nam (UTC+7). |
| Danh sách phân trang | `{"items":[…],"total":n,"page":p,"page_size":s}`. Tham số `page` (mặc định 1), `page_size` (mặc định 50; tối đa 1000 với danh mục, 500 với chứng từ/phiếu thu chi). |
| Tham số bool | `true/false` (hoặc `1/0`). `active=all` hoặc bỏ trống = không lọc. |
| Tìm kiếm `q` | Mặt hàng/đối tác: **không phân biệt hoa thường và dấu** (`que han` khớp "Que hàn", `dong` khớp "Đông"). |
| Xuất file | Mọi báo cáo nhận `format=xlsx` (và `format=docx`); chứng từ/phiếu thu chi có `/export?format=xlsx|docx`. Trả file với `Content-Disposition: attachment; filename="…"; filename*=UTF-8''…`. |

### Lỗi

Mọi lỗi có dạng:

```json
{"error": {"code": "VALIDATION", "message": "Dòng 1: số lượng phải lớn hơn 0", "details": {"line_no": 1, "field": "qty"}}}
```

| HTTP | `code` | Khi nào | `details` |
|---|---|---|---|
| 400 | `VALIDATION` | Dữ liệu nhập sai, JSON hỏng, tham số sai kiểu, thao tác không hợp lệ với trạng thái (vd. ghi sổ phiếu đã ghi sổ, xóa phiếu đã ghi sổ) | thường `{"field": "...", "line_no": n}` (có thể vắng) |
| 401 | `UNAUTHORIZED` | Chưa đăng nhập / phiên hết hạn / sai mật khẩu / tài khoản bị khóa | — |
| 403 | `FORBIDDEN` | Không phải admin mà gọi `/api/users` | — |
| 404 | `NOT_FOUND` | Không có bản ghi / đường dẫn API sai | — |
| 405 | `VALIDATION` | Sai phương thức HTTP | — |
| 409 | `VERSION_CONFLICT` | `version` gửi lên khác version hiện tại (máy khác đã sửa) | `{"updated_by": "Nguyễn Thị Lan (Máy 1)", "updated_at": "2026-11-14T13:58:09Z", "current_version": 3}` |
| 409 | `LOSS_WARNING` | Ghi sổ / sửa phiếu bán đã ghi sổ có dòng bán dưới giá vốn mà chưa gửi `confirm_loss: true` | mảng `Warning` (xem §3.1) |
| 409 | `IN_USE` | Xóa danh mục đã phát sinh chứng từ / mã DV; xóa phiếu tạm đang được phiếu thu/chi tham chiếu | với phiếu: `{"voucher_nos": ["PT00001", …]}` |
| 422 | `INSUFFICIENT_STOCK` | Ghi sổ / sửa / bỏ ghi sổ làm tồn cuối ngày của một (mặt hàng, kho) < 0 | mảng `Shortage` (xem §3.1) |
| 500 | `INTERNAL` | Lỗi hệ thống (không bao giờ do người dùng nhập sai) | — |

`message` luôn là tiếng Việt có dấu, hiển thị thẳng cho người dùng được.

---

## 1. Xác thực & người dùng

### `POST /api/auth/login`
Body `{"username":"lan","password":"123456"}` → `200 {"user": User}` + đặt cookie `session`.
Sai ⇒ `401 UNAUTHORIZED` "Sai tên đăng nhập hoặc mật khẩu". Tên đăng nhập không phân biệt hoa thường.

### `POST /api/auth/logout`
Xóa phiên, xóa cookie → `{"ok":true}` (không cần đăng nhập).

### `GET /api/auth/me`
→ `{"user": User}`

```json
{"user": {"id": 2, "username": "lan", "full_name": "Nguyễn Thị Lan (Máy 1)", "role": "ketoan", "active": true, "created_at": "2026-11-14T13:58:08.9Z"}}
```
`role`: `admin` | `ketoan`.

### `POST /api/auth/change-password` (mọi người dùng đã đăng nhập)
Body `{"old_password":"123456","new_password":"matkhaumoi"}` → `{"ok":true}`. `new_password` ≥ 6 ký tự (400). Sai mật khẩu cũ ⇒ `400 VALIDATION` "Mật khẩu hiện tại không đúng" (`details.field = "old_password"`). Mọi phiên **khác** của người này bị hủy, phiên hiện tại giữ nguyên.

### Thông tin công ty — `GET /api/settings` (mọi người dùng), `PUT /api/settings` (chỉ admin, người khác ⇒ 403)
```json
{"company_name": "CÔNG TY TNHH VẬT TƯ HÀN MINH PHÁT", "company_address": "12 Lê Trọng Tấn, Q. Tân Phú",
 "company_phone": "028 3812 3456", "company_tax_code": "0312345678", "updated_by_name": "Quản trị", "updated_at": "…"}
```
PUT body: 4 trường `company_*` (thay toàn bộ; mỗi trường ≤ 500 ký tự) → object như trên; phát SSE `catalog.changed` với `entity:"settings"`. Mặc định rỗng.
Mọi file xuất (chứng từ, phiếu thu chi, báo cáo; xlsx và docx) in các dòng đầu trang **trước tiêu đề**: tên công ty (đậm), "Địa chỉ: …", "Điện thoại: … &nbsp;&nbsp;&nbsp; MST: …" — mục nào trống thì không in (tất cả trống ⇒ không có dòng nào, tiêu đề ở ô A1 như cũ).

### Người dùng (chỉ admin; người khác ⇒ 403)
- `GET /api/users` → `{"items":[User…],"total":n,"page":1,"page_size":n}` (không phân trang).
- `POST /api/users` body `{"username","password","full_name","role","active"}` → `201 User`. `password` ≥ 6 ký tự, `role` mặc định `ketoan`, trùng username ⇒ 400.
- `PUT /api/users/{id}` body như trên, mọi trường tùy chọn (`password` trống = giữ nguyên) → `User`. Đổi mật khẩu hoặc khóa (`active:false`) ⇒ mọi phiên của người đó bị hủy. Không được khóa/hạ quyền admin cuối cùng (400).

### `GET /api/health` (không cần đăng nhập) → `{"ok":true}`

---

## 2. Danh mục

Năm danh mục có cùng bộ CRUD:

| Đường dẫn | Thực thể |
|---|---|
| `/api/warehouses` | Kho (seed `KHO1..KHO4`) |
| `/api/product-groups` | Nhóm VTHH |
| `/api/products` | Mặt hàng / dịch vụ (seed `DV`) |
| `/api/partners` | Đối tác (khách hàng và/hoặc nhà cung cấp) |
| `/api/cash-accounts` | Tài khoản tiền (seed `TM` tiền mặt, `NH` ngân hàng) |

- `GET <path>?q=&page=&page_size=&active=` → danh sách phân trang, sắp theo `code`.
- `POST <path>` → `201` bản ghi vừa tạo.
- `GET <path>/{id}` → bản ghi.
- `PUT <path>/{id}` → bản ghi sau sửa. **PUT là thay toàn bộ** (gửi đủ trường; trường thiếu nhận giá trị mặc định).
- `DELETE <path>/{id}` → `{"ok":true}`; đã phát sinh chứng từ ⇒ `409 IN_USE` (hãy `PUT` với `active:false` để ngừng sử dụng).
- Mã (`code`) duy nhất, không phân biệt hoa thường; trùng ⇒ `400 VALIDATION` với `details.field = "code"`.
- Mọi thay đổi phát sự kiện SSE `catalog.changed`.
- Mục `active:false` không dùng được cho **phiếu mới** (400), nhưng phiếu cũ đang dùng vẫn sửa được.
- `q` của mọi danh mục (kho, nhóm VTHH, mặt hàng, đối tác, tài khoản tiền) **không phân biệt hoa thường và dấu** (`binh duong` khớp "Kho Bình Dương").

### 2.1 Kho, nhóm VTHH
```json
{"id": 1, "code": "KHO1", "name": "Kho Tân Bình", "active": true}
```
Body POST/PUT: `{"code":"KHO5","name":"Kho Bình Dương","active":true}` (`active` mặc định `true`). Nhóm VTHH cùng dạng.

### 2.2 Mặt hàng — `/api/products`
Lọc thêm: `group_id`, `is_service=true|false`.
`q` — tìm **theo từ**, tách theo **khoảng trắng** (dấu chấm, gạch trong một từ giữ nguyên: `3.2`, `er70s6-12` là một từ); bỏ dấu, không phân biệt hoa thường; **mọi từ** phải có mặt (liền trong từ đó) trong mã hoặc tên, thứ tự bất kỳ (`que 3.2`, `3.2 que`, `kim tin 4.0`, `cap 35`). Khi có `q`, xếp: trùng mã → mã bắt đầu bằng chuỗi gõ → mọi từ nằm trong tên → còn lại, rồi theo mã. Cùng cách khớp cho `q` của `/api/reports/stock-summary`, `/api/reports/stock-nxt`, phần mặt hàng trong `q` của `/api/reports/sales|purchases` (báo cáo vẫn sắp theo mã).
`with_stock=true` (tùy chọn, kèm `warehouse_id`): mỗi item có thêm `total_stock` (tồn tổng mọi kho đến hết hôm nay) và, nếu có `warehouse_id`, `warehouse_qty` (tồn tại kho đó). Tồn của cả trang lấy bằng một truy vấn gộp. Không có `with_stock` ⇒ hình dạng như cũ (không có hai trường này).
```json
{
  "id": 5, "code": "KT42132", "name": "Que hàn Kim Tín KT-421 3.2mm (5kg)", "unit": "Hộp",
  "group_id": 1, "group_code": "QH", "group_name": "Que hàn",
  "sale_price": 180000, "purchase_price": 146000, "is_service": false, "active": true
}
```
Body: `{"code","name","unit","group_id","sale_price","purchase_price","is_service","active"}`.
`unit` bắt buộc với hàng hóa; giá ≥ 0. Không đổi được `is_service` khi đã phát sinh chứng từ. Mã `DV` không xóa/đổi mã được; mã `DICHVU` dành riêng.

#### `GET /api/products/lookup?code=K701832[&optional=1]`
Tìm **chính xác** theo mã, không phân biệt hoa thường; `DICHVU` / `dichvu` / `dịch vụ` ⇒ mã `DV`. → `Product` hoặc `404` (mặc định, không đổi).
Với `optional=1` (hoặc `true`): **luôn 200** (dùng khi gõ mã từng chữ, không sinh 404):
`{"found": true, "product": {Product}}` khi có, `{"found": false, "product": null}` khi không có. `code` rỗng vẫn 400; `optional` không phải true/false ⇒ 400.

#### `GET /api/products/{id}/price-info?date=YYYY-MM-DD`
Dùng khi nhập dòng phiếu: tự điền giá bán (REQ-026), cảnh báo lỗ tức thời (R4), xem tồn. `date` mặc định hôm nay (= ngày phiếu).
```json
{
  "product_id": 5, "code": "KT42132", "name": "Que hàn Kim Tín KT-421 3.2mm (5kg)", "unit": "Hộp", "is_service": false,
  "date": "2026-06-01",
  "sale_price": 180000, "purchase_price": 146000,
  "cost_price": 146000, "cost_source": "last_purchase",
  "total_stock": 120,
  "stock_by_warehouse": [
    {"warehouse_id": 1, "code": "KHO1", "name": "Kho Tân Bình", "qty": 0},
    {"warehouse_id": 2, "code": "KHO2", "name": "Kho Bình Tân", "qty": 120}, …
  ]
}
```
- `cost_price`/`cost_source`: giá vốn so sánh = đơn giá dòng **phiếu mua đã ghi sổ gần nhất có ngày ≤ date** (mọi kho) ⇒ `last_purchase`; chưa từng mua ⇒ `purchase_price` của danh mục ⇒ `default`; nếu cũng = 0 (hoặc là dịch vụ) ⇒ `none` (không cảnh báo). Cảnh báo lỗ khi `unit_price < cost_price` và `cost_source ≠ "none"`.
- Tồn tính **đến hết ngày `date`** (chỉ chứng từ đã ghi sổ). `stock_by_warehouse` gồm mọi kho đang dùng (và kho ngừng dùng còn tồn).
- Tham số tùy chọn `warehouse_id` ⇒ thêm trường `warehouse_qty` (tồn tại kho đó; không có tham số thì không có trường).

#### `GET /api/products/price-info?ids=1,2,3&date=YYYY-MM-DD&warehouse_id=`
Bản hàng loạt: → `{"items": [PriceInfo…]}`, mỗi phần tử **giống hệt** object của endpoint đơn lẻ (có `product_id`, và `warehouse_qty` khi có `warehouse_id`), theo thứ tự `ids` (id trùng bị bỏ). Tối đa **500** id (vượt ⇒ 400). Thiếu `ids` / id không phải số nguyên dương ⇒ 400; có id không tồn tại ⇒ `404 NOT_FOUND` với `details.missing_ids`; `warehouse_id` không tồn tại ⇒ 400.

### 2.3 Đối tác — `/api/partners`
Lọc thêm: `type=customer|supplier`.
`q` — tìm **theo từ**: chuỗi được bỏ dấu, chữ thường, bỏ dấu câu (`–`, `,`, `.`…) rồi tách thành các từ; **mọi từ** phải có mặt (thứ tự bất kỳ) trong mã, tên, điện thoại hoặc MST (`viet han` và `han viet` đều ra "Thiết bị hàn Việt – Hàn"). Khi có `q`, kết quả **xếp theo mức khớp** rồi theo tên:
0 mã trùng chuỗi gõ (bỏ khoảng trắng/dấu câu) · 1 tên bắt đầu bằng cụm từ (trọn từ ở cả hai đầu) · 2 tên chứa cụm từ (trọn từ) · 3 mọi từ là từ nguyên trong tên · 4 mã bắt đầu bằng chuỗi gõ · 5 mọi từ nằm trong tên (một phần từ) · 6 còn lại (khớp qua mã/ĐT/MST).
Ví dụ `minh phu`: "Đại lý Minh Phú" (mức 2) đứng trên "Công ty Minh Phước" (mức 5, "phu" chỉ là một phần của "phuoc"). Ví dụ `thanh cong`: "Xưởng cơ khí Thành Công" (mức 2) đứng trước "TANTHANH – Công ty TNHH Thép Tân Thành" (mức 3, khớp rời "công ty"/"thành"). Không có `q` ⇒ sắp theo mã như cũ.
Cùng cách khớp đối tác được dùng cho phần tên đối tác trong `q` của `/api/documents`, `/api/vouchers` và `/api/reports/debt-summary`.

#### `GET /api/partners/{id}/balance?date=&exclude_document_id=&exclude_voucher_id=`
Số dư công nợ hiện tại của một đối tác, nhẹ hơn sổ chi tiết:
```json
{"partner_id": 5, "partner_code": "THANHCONG", "partner_name": "Xưởng cơ khí Thành Công", "date": "2026-09-25",
 "exclude_document_id": 20, "exclude_voucher_id": null, "receivable": 2000000, "payable": 0}
```
`date` (tùy chọn) = tính đến hết ngày đó (bỏ trống ⇒ mọi ngày); `exclude_document_id` / `exclude_voucher_id` (tùy chọn) bỏ qua một chứng từ / phiếu thu chi — dùng để hiện "Nợ cũ" trước phiếu đang lập/sửa (`date` = ngày phiếu, `exclude_document_id` = id phiếu). Lưu ý: khác `old_debt` của Document ở chỗ không xét thứ tự các phiếu **cùng ngày** (mọi phiếu cùng ngày đều được tính). `receivable` = phải thu, `payable` = phải trả (cùng quy tắc R8/`debt_side`). Đối tác không tồn tại ⇒ 404; tham số sai ⇒ 400.
```json
{
  "id": 1, "code": "VINHPHONG", "name": "CTY TNHH TM DV VĨNH PHONG",
  "address": "123 Lũy Bán Bích, …", "phone": "0283 861 2345", "tax_code": "0312345678",
  "is_customer": true, "is_supplier": false,
  "opening_receivable": 2000000, "opening_payable": 0, "active": true
}
```
Phải có ít nhất một trong `is_customer`/`is_supplier`. `opening_receivable` = nợ phải thu đầu kỳ, `opening_payable` = nợ phải trả đầu kỳ.

### 2.4 Tài khoản tiền — `/api/cash-accounts`
```json
{"id": 1, "code": "TM", "name": "Quỹ tiền mặt", "kind": "cash", "opening_balance": 50000000, "active": true}
```
`kind`: `cash` | `bank`. Không đổi `kind` khi đã có phiếu thu/chi.

---

## 3. Chứng từ kho — `/api/documents`

`doc_type`:

| doc_type | Tên | Đối tác | Ảnh hưởng tồn | Công nợ | Số chính thức |
|---|---|---|---|---|---|
| `purchase` | Phiếu nhập mua hàng | NCC (bắt buộc) | + kho `warehouse_id` | + phải trả | `NK00001` |
| `sale_return` | Phiếu nhập hàng bán bị trả lại | KH (bắt buộc) | + kho | − phải thu | `NK…` (chung dãy) |
| `sale` | Phiếu bán hàng | KH (bắt buộc) | − kho | + phải thu | `XK00001` |
| `purchase_return` | Phiếu xuất trả hàng NCC | NCC (bắt buộc) | − kho | − phải trả | `XK…` (chung dãy) |
| `transfer` | Phiếu chuyển kho nội bộ | không có | − `warehouse_id`, + `to_warehouse_id` | không | `CK00001` |
| `opening` | Phiếu nhập tồn đầu kỳ | không có | + kho | không | `TDK00001` |

`status`: `draft` (phiếu tạm, số tạm `TAM000001`, **không** ảnh hưởng tồn/công nợ, không giữ hàng) → `posted` (đã ghi sổ).
`display_no` = `doc_no` nếu đã ghi sổ, ngược lại `draft_no`. Số chính thức cấp khi ghi sổ lần đầu và **giữ nguyên** khi sửa / bỏ ghi sổ rồi ghi sổ lại.

### 3.1 Kiểu dữ liệu

**Document** (`GET /api/documents/{id}` và mọi response ghi):
```json
{
  "id": 22, "doc_type": "sale", "doc_type_name": "Phiếu bán hàng",
  "doc_no": "XK00010", "draft_no": "TAM000022", "display_no": "XK00010",
  "doc_date": "2026-10-20", "status": "posted",
  "partner_id": 7, "partner_code": "KHACHLE", "partner_name": "Khách lẻ", "partner_address": "", "partner_phone": "",
  "warehouse_id": 1, "warehouse_code": "KHO1", "warehouse_name": "Kho Tân Bình",
  "to_warehouse_id": null, "to_warehouse_code": null, "to_warehouse_name": null,
  "note": "Xả hàng tồn lâu", "total_amount": 400000, "version": 2,
  "created_by": 2, "created_by_name": "Nguyễn Thị Lan (Máy 1)",
  "updated_by": 2, "updated_by_name": "Nguyễn Thị Lan (Máy 1)",
  "posted_by": 2, "posted_by_name": "Nguyễn Thị Lan (Máy 1)", "posted_at": "2026-11-14T13:58:09.257103Z",
  "created_at": "2026-11-14T13:58:09.252239Z", "updated_at": "2026-11-14T13:58:09.255147Z",
  "lines": [
    {"id": 64, "line_no": 1, "product_id": 19, "product_code": "KINHHAN", "product_name": "Kính hàn đen", "is_service": false,
     "description": "", "unit": "Cái", "qty": 50, "unit_price": 8000, "amount": 400000, "note": ""}
  ],
  "warnings": [
    {"type": "loss", "line_no": 1, "product_id": 19, "product_code": "KINHHAN", "product_name": "Kính hàn đen",
     "unit_price": 8000, "cost_price": 9000, "cost_source": "default",
     "message": "Dòng 1 (KINHHAN): giá bán 8.000 thấp hơn giá mua 9.000 — bán lỗ"}
  ],
  "old_debt": 0,
  "total_debt": 400000
}
```
- `unit_price` có thể `null` (dòng dịch vụ ghi chú thuần, hoặc dòng chuyển kho) — khi đó `amount = 0` và khi in ô đơn giá/thành tiền để trống.
- `warnings` luôn là mảng (chỉ phiếu `sale` mới có cảnh báo `loss`; dòng dịch vụ không xét).
- `old_debt` / `total_debt`: chỉ có với `sale` (phải thu) và `purchase` (phải trả) có đối tác; các loại khác `null`.
  `old_debt` = số dư công nợ của đối tác **trước phiếu này** (theo ngày, rồi thứ tự ghi sổ); với phiếu tạm = số dư tính đến hết ngày phiếu. `total_debt = old_debt + total_amount`.

**Warning** (loss): như trên.

**Shortage** (thiếu hàng, trong `details` của `INSUFFICIENT_STOCK` và trong `/check`):
```json
{
  "product_id": 15, "product_code": "JASICMIG250", "product_name": "Máy hàn MIG Jasic 250A", "unit": "Cái",
  "warehouse_id": 3, "warehouse_code": "KHO3", "warehouse_name": "Kho Thủ Đức",
  "date": "2026-11-14", "available": 6, "required": 10, "shortage": 4, "balance": -4,
  "message": "Mặt hàng JASICMIG250 - Máy hàn MIG Jasic 250A tại Kho Thủ Đức ngày 14/11/2026: tồn 6, cần 10, thiếu 4"
}
```
`date` = ngày đầu tiên tồn cuối ngày bị âm; `balance` = tồn cuối ngày đó nếu chấp nhận thao tác; `shortage = −balance`;
`required` = SL chứng từ này xuất ra (gộp mọi dòng cùng mã); `available = balance − (tác động của chứng từ này)`.
Với thao tác sửa lùi phiếu nhập (giảm SL nhập, đổi kho, dời ngày, bỏ ghi sổ) `required` có thể = 0 và `available` âm — hãy hiển thị `message`.

### 3.2 `GET /api/documents`
Tham số: `type` (một hoặc nhiều, cách bằng dấu phẩy: `type=sale,sale_return`), `status=draft|posted`, `partner_id`, `warehouse_id` (khớp kho xuất **hoặc** kho nhận), `product_id` (phiếu có dòng mã này), `q` (số phiếu, số tạm, tên/mã đối tác, ghi chú — tên và ghi chú không phân biệt dấu), `from`, `to`, `page`, `page_size`. Sắp xếp `doc_date` giảm dần, rồi `id` giảm dần.
```json
{"items": [{
  "id": 24, "doc_type": "sale", "doc_type_name": "Phiếu bán hàng", "doc_no": "XK00012", "draft_no": "TAM000024", "display_no": "XK00012",
  "doc_date": "2026-11-01", "status": "posted", "partner_id": 1, "partner_name": "CTY TNHH TM DV VĨNH PHONG",
  "warehouse_id": 4, "warehouse_name": "Kho Bình Dương", "to_warehouse_id": null, "to_warehouse_name": null,
  "note": "", "total_amount": 2800000, "line_count": 1, "version": 2,
  "created_by_name": "Trần Thị Hoa (Máy 2)", "updated_by_name": "Trần Thị Hoa (Máy 2)",
  "posted_at": "2026-11-14T13:58:09Z", "updated_at": "2026-11-14T13:58:09Z"
}], "total": 27, "page": 1, "page_size": 50}
```
Phản hồi có thêm `"sum_total_amount"`: tổng `total_amount` của **mọi** chứng từ khớp bộ lọc (mọi trang), ví dụ `{"items":[…],"total":27,"page":1,"page_size":50,"sum_total_amount":153760000}`.
Máy 2 xem "phiếu tạm đang treo": `GET /api/documents?status=draft` (REQ-043).

### 3.3 `POST /api/documents` — tạo phiếu tạm
```json
{
  "doc_type": "sale",
  "doc_date": "2026-09-25",
  "partner_id": 5,
  "warehouse_id": 1,
  "to_warehouse_id": null,
  "note": "",
  "lines": [
    {"product_id": 12, "qty": 1, "unit_price": 600000},
    {"product_code": "CN249SS08", "qty": 50},
    {"product_code": "DICHVU", "description": "TRẢ 01 ĐỒNG HỒ"},
    {"product_code": "DICHVU", "description": "PHÍ SỬA XE", "qty": 1, "unit_price": 400000},
    {"product_id": 1, "description": "Chiết khấu", "unit_price": -100000}
  ]
}
```
→ `201 Document` (status `draft`, version 1, kèm `warnings`).
Quy tắc dòng:
- Chọn mặt hàng bằng `product_id` **hoặc** `product_code` (tra chính xác như `/products/lookup`, `DICHVU` ⇒ `DV`).
- **Hàng hóa**: `qty > 0` bắt buộc (sau khi làm tròn 3 chữ số; `0.0004` ⇒ 400); `unit_price ≥ 0`; **bỏ trống `unit_price` ⇒ server tự điền giá mặc định** (`sale`/`sale_return`: `sale_price`; `purchase`/`purchase_return`/`opening`: `purchase_price`; `transfer`: để `null`). Gửi giá khác ⇒ giữ giá gửi (sửa giá khi bán, REQ-027).
- **Dịch vụ** (`is_service`, mã `DV`): `description` tự do; `qty` mặc định 1; `unit_price` dương (cộng), âm (trừ) hoặc `null` (dòng ghi chú, `amount = 0`). Không có ở `transfer`/`opening`. Không ảnh hưởng tồn, không cảnh báo lỗ.
- `unit` bỏ trống ⇒ ĐVT của mặt hàng. `note` mỗi dòng tùy chọn.
- `doc_date` bỏ trống ⇒ hôm nay. Phiếu tạm được phép không có dòng nào và được chứa hàng chưa có tồn (REQ-041).
- `partner_id` phải là KH với `sale`/`sale_return`, NCC với `purchase`/`purchase_return` — kiểm tra khi **đặt hoặc đổi** đối tác; phiếu cũ giữ nguyên đối tác vẫn sửa/ghi sổ được dù sau đó đối tác đã đổi cờ KH/NCC; `transfer`/`opening` không được có `partner_id`. `transfer` cần `to_warehouse_id ≠ warehouse_id`.
- Lỗi dòng: `400` với `details: {"line_no": n, "field": "qty"|"unit_price"|"product_id"|"product_code"}`.

### 3.4 `PUT /api/documents/{id}` — sửa (phiếu tạm **hoặc** đã ghi sổ)
**Id dòng ổn định:** mỗi dòng trong body có thể kèm `"id"` (id dòng lấy từ `GET`). Dòng có `id` là dòng đang có của **chính phiếu này** ⇒ sửa tại chỗ, **giữ nguyên `id`**; dòng không có `id` ⇒ dòng mới (id mới); dòng đang có mà không được gửi lại ⇒ bị xóa; `id` không thuộc phiếu này hoặc lặp lại lần thứ hai ⇒ bị bỏ qua, coi là **dòng mới** (không lỗi). `line_no` theo thứ tự trong body (đổi thứ tự vẫn giữ id). Máy khách không gửi `id` ⇒ mọi dòng nhận id mới như trước. Bút toán kho luôn được dựng lại.
Body như POST + **`version` bắt buộc** (+ `confirm_loss` cho phiếu bán đã ghi sổ). `doc_type` có thể bỏ, không được đổi.
Thay toàn bộ header + dòng. → `200 Document` (version + 1).
- Version cũ ⇒ `409 VERSION_CONFLICT` (details: `updated_by`, `updated_at`, `current_version`) — frontend tải lại phiếu rồi cho sửa tiếp.
- Phiếu **đã ghi sổ** (sửa chứng từ quá khứ, R3): trong một transaction dựng lại bút toán kho và kiểm tra tồn cuối mỗi ngày từ ngày bị ảnh hưởng trở đi; âm ⇒ `422 INSUFFICIENT_STOCK`, không đổi gì. Phiếu bán còn dòng lỗ ⇒ cần `confirm_loss: true` (nếu không ⇒ `409 LOSS_WARNING`). Phiếu đã ghi sổ phải còn ≥ 1 dòng. Số chính thức không đổi; tồn kho, công nợ, báo cáo tự đúng vì đều tính từ chứng từ. Có ghi lịch sử (trước/sau).

### 3.5 `POST /api/documents/{id}/post` — ghi sổ
Body `{"version": 3, "confirm_loss": false}` → `200 Document` (`status:"posted"`, có `doc_no`, `posted_by_name`, `posted_at`).
Thứ tự kiểm tra: version (409) → đã ghi sổ rồi (400) → không có dòng (400) → dữ liệu (400) → **tồn kho (422)** → **bán lỗ (409 `LOSS_WARNING` nếu chưa `confirm_loss`)**.
Luồng UI gợi ý: gọi post; nếu 409 `LOSS_WARNING` ⇒ hiện danh sách `details` + nút "Vẫn ghi sổ" ⇒ gọi lại với `confirm_loss:true`.
Hai máy cùng ghi sổ tranh cùng lượng tồn: server khóa theo (mặt hàng, kho) nên chỉ phiếu đủ hàng được ghi sổ, phiếu sau nhận 422.

### 3.6 `POST /api/documents/{id}/unpost` — bỏ ghi sổ
Body `{"version": 4}` → `200 Document` (về `draft`, giữ `doc_no` để ghi sổ lại cùng số). Nếu bỏ phiếu nhập làm âm kho các phiếu xuất sau ⇒ `422`.

### 3.7 `DELETE /api/documents/{id}?version=5`
Chỉ phiếu tạm (đã ghi sổ ⇒ 400, hãy bỏ ghi sổ trước). `version` tùy chọn (khuyên gửi; sai ⇒ 409). → `{"ok":true,"id":28}`.
Phiếu đang được dòng phiếu thu/chi tham chiếu (`document_id`) ⇒ `409 IN_USE`, message nêu số phiếu, `details: {"voucher_nos": ["PT00003"]}` — sửa phiếu thu/chi bỏ liên kết trước. (Bỏ ghi sổ phiếu được tham chiếu vẫn cho phép.)

### 3.8 `GET /api/documents/{id}/check`
Kiểm tra nếu ghi sổ (hoặc lưu lại) ngay bây giờ, **không đổi dữ liệu**:
```json
{"stock_shortages": [Shortage…], "loss_lines": [Warning…], "can_post": false}
```
`can_post = không thiếu hàng && có ≥ 1 dòng` (chưa xét `confirm_loss`).

### 3.8b `POST /api/documents/check` — kiểm tra phiếu **chưa lưu** (đang gõ)
Body như `POST`/`PUT /api/documents` (không cần `version`), thêm `"id"` (tùy chọn) khi đang sửa phiếu có sẵn: bút toán kho hiện có của phiếu đó được loại trừ (thay bằng nội dung đang gõ) và đối tác giữ nguyên không bị kiểm lại cờ KH/NCC. → cùng hình dạng `{"stock_shortages", "loss_lines", "can_post"}` như §3.8, tính như thể ghi sổ nội dung này ngay — kể cả xung đột sửa lùi (giảm SL phiếu nhập cũ, dời ngày, đổi kho). **Không đổi dữ liệu.**
Để dùng khi đang gõ: dòng chưa chọn mặt hàng, và dòng hàng hóa chưa có SL (hoặc SL làm tròn = 0), được **bỏ qua**; `line_no` trong `loss_lines` vẫn là số thứ tự dòng trong body. Lỗi dữ liệu khác như POST (400; thiếu `warehouse_id`, đối tác sai loại…). `id` không tồn tại ⇒ 404; `doc_type` khác loại phiếu `id` ⇒ 400.

### 3.9 `GET /api/documents/{id}/export?format=xlsx|docx`
File phiếu (mặc định `xlsx`). Phiếu tạm: tiêu đề **"PHIẾU TẠM (chưa ghi sổ)"**, tên file `PHIEU_TAM_TAM000025.xlsx`. Đã ghi sổ: tiêu đề theo loại (`PHIẾU XUẤT KHO BÁN HÀNG`, `PHIẾU NHẬP KHO MUA HÀNG`, `PHIẾU NHẬP HÀNG BÁN BỊ TRẢ LẠI`, `PHIẾU XUẤT TRẢ HÀNG NHÀ CUNG CẤP`, `PHIẾU CHUYỂN KHO NỘI BỘ`, `PHIẾU NHẬP TỒN ĐẦU KỲ`), tên file `XK00008.xlsx`.
Nội dung: (thông tin công ty nếu có), thông tin phiếu, bảng `STT | Mã hàng | Tên hàng | ĐVT | Số lượng | Đơn giá | Thành tiền` — thêm cột thứ 8 `Ghi chú` (ghi chú từng dòng) **chỉ khi** ít nhất một dòng có `note` —, dòng `Cộng`, rồi (phiếu bán/mua) "Nợ cũ:" và "Tổng nợ (đến ngày dd/mm/yyyy):", ô ký tên.
**Khớp bản in** (`PrintSheet`, theo mẫu khách): dòng "Số: <số phiếu> &nbsp; Ngày: dd/mm/yyyy" (phiếu tạm dùng số tạm); "<Khách hàng|Nhà cung cấp>: <tên> (<mã>)"; "Địa chỉ: … · ĐT: …" (bỏ phần trống: chỉ có địa chỉ ⇒ "Địa chỉ: …", chỉ có ĐT ⇒ "ĐT: …", không có cả hai ⇒ không có dòng); nhãn kho theo loại phiếu — bán, trả NCC: "Xuất từ kho:"; mua, khách trả, tồn đầu: "Nhập vào kho:"; chuyển kho: "Kho xuất: X → Kho nhận: Y"; phụ đề phiếu tạm "<tên phiếu> — chưa ghi sổ, chưa trừ/cộng kho, chưa vào công nợ". Cột Mã hàng của dòng dịch vụ ghi **`DICHVU`** (mã trong API vẫn là `DV`); cột Tên hàng = diễn giải dòng nếu có, ngược lại tên hàng. Phiếu **chuyển kho không có cột Đơn giá/Thành tiền**, dòng Cộng là tổng SL. "Nợ cũ/Tổng nợ" chỉ ở phiếu bán và phiếu mua. Dòng "Ngày …… tháng …… năm ………", rồi ô ký theo loại phiếu — bán: Người lập phiếu, Người giao hàng, Khách hàng, Thủ kho; khách trả: Người lập phiếu, Khách hàng, Thủ kho; mua: Người lập phiếu, Người giao hàng, Thủ kho; trả NCC: Người lập phiếu, Người nhận hàng, Thủ kho; chuyển kho: Người lập phiếu, Thủ kho xuất, Thủ kho nhận; tồn đầu: Người lập phiếu, Thủ kho — mỗi ô kèm "(Ký, ghi rõ họ tên)"; dòng cuối "Xuất file lúc HH:MM dd/mm/yyyy · Ghi sổ bởi <tên>" (phiếu tạm: "· Phiếu tạm").
Excel: số là ô số thật; ô Cộng = công thức `SUM(...)`; "Nợ cũ:" và "Tổng nợ …:" là ô nhãn (cột C) + **ô số riêng** (cột Thành tiền); ô Tổng nợ = công thức `Nợ cũ + Cộng`. Mọi ô công thức có **kết quả lưu sẵn dạng số** (trình xem không tính lại vẫn hiện đúng). Đơn giá/tiền có số lẻ hiển thị số lẻ (`#,##0.0#`), số chẵn hiển thị `#,##0`. Word: "Nợ cũ: 2.000.000", "Tổng nợ (đến ngày …): 5.990.000". Dòng dịch vụ: cột Tên hàng = diễn giải. File không khóa, không ảnh ⇒ người dùng thêm/bớt dòng cột được.
Phiếu chính thức chỉ in được khi đã ghi sổ ⇒ hết tồn thì không ghi sổ ⇒ không có phiếu chính thức (REQ-031/032).

### 3.10 `GET /api/documents/{id}/history`
```json
{"items": [
  {"id": 101, "at": "2026-11-14T13:58:09Z", "user_id": 2, "user_name": "Nguyễn Thị Lan (Máy 1)", "action": "created", "before": null, "after": {Document}},
  {"id": 102, "at": "…", "user_id": 2, "user_name": "…", "action": "posted", "before": {Document}, "after": {Document}}
]}
```
`action`: `created | updated | posted | unposted | deleted`. Phiếu đã xóa vẫn xem được lịch sử.

---

## 4. Thu chi — `/api/vouchers`

Phiếu thu/chi **có hiệu lực ngay khi lưu** (không có trạng thái tạm), sửa/xóa được, có `version`.
Số phiếu: thu tiền mặt `PT00001`, chi tiền mặt `PC…`, thu ngân hàng `BC…`, chi ngân hàng `BN…` (theo `kind` của tài khoản). Sửa đổi thu↔chi hoặc tiền mặt↔ngân hàng ⇒ cấp số mới theo dãy mới.
`partner_id` có thể `null` (thu/chi khác — không vào công nợ).

**Phía công nợ `debt_side`** (`"receivable"` | `"payable"`, lưu trên phiếu, luôn trả về):

| voucher_type | debt_side | Tác động |
|---|---|---|
| `receipt` | `receivable` | **giảm** phải thu (khách trả tiền — thông thường) |
| `receipt` | `payable` | **tăng** phải trả (NCC hoàn tiền cho mình, bù số phải trả âm) |
| `payment` | `payable` | **giảm** phải trả (trả tiền NCC — thông thường) |
| `payment` | `receivable` | **tăng** phải thu (mình trả lại tiền cho khách) |

Bỏ trống `debt_side` (khi tạo **và** khi sửa) ⇒ mặc định: `receipt` → `receivable`, `payment` → `payable`; **trừ khi** đối tác chỉ là NCC (phiếu thu → `payable`) hoặc chỉ là KH (phiếu chi → `receivable`). Giá trị khác ⇒ 400. Sổ công nợ, tổng hợp, "Nợ cũ", dashboard, file xuất đều theo quy tắc này.

**Voucher**:
```json
{
  "id": 1, "voucher_type": "receipt", "voucher_type_name": "Phiếu thu tiền mặt", "voucher_no": "PT00001", "voucher_date": "2026-04-20", "debt_side": "receivable",
  "account_id": 1, "account_code": "TM", "account_name": "Quỹ tiền mặt", "account_kind": "cash",
  "partner_id": 1, "partner_code": "VINHPHONG", "partner_name": "CTY TNHH TM DV VĨNH PHONG", "partner_address": "123 Lũy Bán Bích, …",
  "note": "Thu nợ tháng 4", "total_amount": 8460000, "version": 1,
  "created_by": 2, "created_by_name": "Nguyễn Thị Lan (Máy 1)", "updated_by": 2, "updated_by_name": "Nguyễn Thị Lan (Máy 1)",
  "created_at": "…", "updated_at": "…",
  "lines": [
    {"id": 1, "line_no": 1, "description": "Thu nợ cũ", "amount": 2000000, "document_id": null, "document_no": null},
    {"id": 2, "line_no": 2, "description": "Thu tiền phiếu bán ngày 03/04", "amount": 4000000, "document_id": 13, "document_no": "XK00002"}
  ]
}
```
`voucher_type_name`: "Phiếu thu tiền mặt" | "Phiếu chi tiền mặt" | "Thu tiền ngân hàng (giấy báo có)" | "Chi tiền ngân hàng (giấy báo nợ)".

- `GET /api/vouchers?type=receipt|payment&account_id=&partner_id=&from=&to=&q=&page=&page_size=` → phân trang `Summary` + `"sum_total_amount"` (tổng tiền mọi phiếu khớp bộ lọc, mọi trang):
  `{"id","voucher_type","voucher_type_name","voucher_no","voucher_date","debt_side","account_id","account_name","account_kind","partner_id","partner_name","note","total_amount","line_count","version","updated_by_name","updated_at"}`. `q` tìm số phiếu, đối tác, ghi chú, diễn giải dòng (không phân biệt dấu).
- `POST /api/vouchers` body:
  ```json
  {"voucher_type": "receipt", "voucher_date": "2026-04-20", "account_id": 1, "partner_id": 1, "debt_side": "receivable", "note": "Thu nợ tháng 4",
   "lines": [{"description": "Thu nợ cũ", "amount": 2000000}, {"description": "Thu tiền XK00002", "amount": 4000000, "document_id": 13}]}
  ```
  → `201 Voucher`. Ít nhất 1 dòng, `amount > 0` mỗi dòng **sau khi làm tròn 2 chữ số** (`0.001` ⇒ 400; `0.005` ⇒ 0,01); `document_id` (tùy chọn) phải tồn tại và cùng đối tác. `voucher_date` trống ⇒ hôm nay.
- `GET /api/vouchers/{id}` → `Voucher`.
- `PUT /api/vouchers/{id}` body như POST + `version` (bắt buộc) → `Voucher`; version cũ ⇒ `409 VERSION_CONFLICT`. Dòng tiền có thể kèm `"id"` với cùng quy tắc id dòng ổn định như §3.4 (id dòng của chính phiếu ⇒ giữ; thiếu / lạ / lặp ⇒ dòng mới; dòng không gửi lại ⇒ xóa).
- `DELETE /api/vouchers/{id}?version=` → `{"ok":true,"id":…}`.
- `GET /api/vouchers/{id}/export?format=xlsx|docx` → khớp bản in `VoucherPrint`: tiêu đề "PHIẾU THU" / "PHIẾU CHI" / "GIẤY BÁO CÓ (THU QUA NGÂN HÀNG)" / "GIẤY BÁO NỢ (CHI QUA NGÂN HÀNG)"; "Số: … &nbsp; Ngày: … &nbsp; <tài khoản>"; "Họ tên người nộp tiền:" / "Họ tên người nhận tiền:" (không có đối tác ⇒ dòng chấm); "Địa chỉ:"; "Lý do nộp:" / "Lý do chi:" (ghi chú, hoặc diễn giải nếu phiếu một dòng); bảng `STT | Diễn giải | Chứng từ liên quan | Số tiền` với dòng **"Tổng số tiền"** (công thức `SUM`, kết quả số); **"Bằng chữ: <số tiền bằng chữ> đồng"** (vd. "Tám triệu bốn trăm năm mươi lăm nghìn đồng"; quy tắc: linh, mười/mươi, mốt, lăm, "bốn" sau mươi — 34 = "ba mươi bốn", "không trăm" ở nhóm giữa, viết hoa chữ đầu, số âm "Âm …", làm tròn về đồng); "Kèm theo: ……… chứng từ gốc."; ô ký — phiếu thu: Giám đốc, Kế toán trưởng, Người nộp tiền, Người lập phiếu, Thủ quỹ; phiếu chi: Giám đốc, Kế toán trưởng, Thủ quỹ, Người lập phiếu, Người nhận tiền — kèm "(Ký, họ tên)"; dòng cuối "Xuất file lúc … · Lập bởi <tên>".
- `GET /api/vouchers/{id}/history` → như §3.10.

---

## 5. Báo cáo — `/api/reports/*`

Tất cả nhận `format=xlsx` (hoặc `docx`) để tải file cùng dữ liệu; mặc định JSON. Mọi dòng có id
(`product_id`, `document_id`, `voucher_id`, `partner_id`) để bấm mở chi tiết **ngay trong màn báo cáo** (Drawer/Modal):
dòng chứng từ ⇒ `GET /api/documents/{document_id}`; dòng phiếu thu chi ⇒ `GET /api/vouchers/{voucher_id}`;
dòng mã hàng ⇒ thẻ kho `stock-ledger?product_id=`; dòng đối tác ⇒ `debt-ledger?partner_id=`.
Chỉ chứng từ **đã ghi sổ** được tính (trừ `draft-demand`). `to < from` ⇒ 400.
Excel báo cáo: dòng Cộng của các cột cộng dồn được (SL theo kho, nhập/xuất, tăng/giảm, thu/chi, thành tiền) là công thức `SUM` có kết quả lưu sẵn dạng số.

### 5.1 `GET /api/reports/stock-summary` — tồn kho (tổng 4 kho + từng kho)
Tham số: `as_of` (mặc định hôm nay; tồn đến hết ngày), `warehouse_id` (chỉ 1 kho), `group_id`, `q`, `only_with_data` (mặc định `true`: chỉ mã đã từng có phát sinh đến `as_of`; `false`: thêm mọi mã hàng hóa đang dùng, kể cả tồn 0). Mã dịch vụ không bao giờ có.
```json
{
  "as_of": "2026-11-14",
  "warehouses": [{"id": 1, "code": "KHO1", "name": "Kho Tân Bình"}, {"id": 2, …}, {"id": 3, …}, {"id": 4, …}],
  "items": [{
    "product_id": 6, "code": "WW829HT107k", "name": "Dây hàn lõi thuốc WW829 1.2mm (15kg)", "unit": "Cuộn",
    "group_id": 2, "group_name": "Dây hàn",
    "by_warehouse": {"1": 20, "2": 0, "3": 10, "4": 0},
    "total": 30
  }],
  "totals_by_warehouse": {"1": 20, "2": 0, "3": 10, "4": 0},
  "total_qty": 30
}
```
`by_warehouse` / `totals_by_warehouse`: khóa là **warehouse_id dạng chuỗi**, có đủ mọi kho trong `warehouses`.
Excel: `STT | Mã hàng | Tên hàng | ĐVT | Nhóm VTHH | <tên từng kho> | Tổng tồn` + dòng Cộng (xuất toàn bộ mã, REQ-022/075).

### 5.2 `GET /api/reports/stock-nxt` — tổng hợp nhập xuất tồn
Tham số: `from`, `to` (mặc định đầu tháng → hôm nay), `warehouse_id`, `group_id`, `q`. Khi **không** chọn kho, phiếu chuyển kho không tính vào nhập/xuất (tự triệt tiêu); chọn kho thì có. Bỏ các mã toàn số 0.
```json
{
  "from": "2026-04-01", "to": "2026-05-31", "warehouse_id": null,
  "items": [{"product_id": 6, "code": "WW829HT107k", "name": "…", "unit": "Cuộn", "group_name": "Dây hàn",
             "opening": 37, "qty_in": 1, "qty_out": 8, "closing": 30}],
  "totals": {"opening": 37, "qty_in": 1, "qty_out": 8, "closing": 30}
}
```

### 5.3 `GET /api/reports/stock-ledger` — thẻ kho / chi tiết NXT một mã (R2)
Tham số: `product_id` (bắt buộc), `from`, `to` (tùy chọn; bỏ `from` ⇒ từ đầu, `opening = 0`), `warehouse_id` (bỏ = tất cả kho; khi đó **ẩn dòng chuyển kho**).
Sắp xếp: ngày, nhập trước xuất, số chứng từ.
```json
{
  "product": {"id": 6, "code": "WW829HT107k", "name": "Dây hàn lõi thuốc WW829 1.2mm (15kg)", "unit": "Cuộn"},
  "from": "2026-04-01", "to": "2026-05-31", "warehouse_id": 1,
  "opening": 27,
  "rows": [
    {"date": "2026-04-03", "doc_no": "XK00002", "document_id": 13, "doc_type": "sale",
     "description": "Xuất kho bán hàng CTY TNHH TM DV VĨNH PHONG", "partner_id": 1, "partner_name": "CTY TNHH TM DV VĨNH PHONG",
     "warehouse_id": 1, "warehouse_code": "KHO1", "product_code": "WW829HT107k", "unit": "Cuộn",
     "qty_in": 0, "qty_out": 4, "balance": 23, "unit_price": 820000},
    {"date": "2026-04-14", "doc_no": "XK00003", …, "qty_out": 3, "balance": 20},
    {"date": "2026-04-17", "doc_no": "NK00006", "doc_type": "sale_return", "description": "CHÚ NGỌC MINH - trả hàng", …, "qty_in": 1, "balance": 21},
    {"date": "2026-05-26", "doc_no": "XK00004", "description": "Xuất kho bán hàng CÔNG TY TNHH NHỰA PHẠM GIA - Phường Bình Hưng Hòa B", …, "qty_out": 1, "balance": 20}
  ],
  "total_in": 1, "total_out": 8, "closing": 20
}
```
Diễn giải tự sinh: bán `Xuất kho bán hàng <KH>`; mua `Nhập kho mua hàng <NCC>`; khách trả `<KH> - trả hàng`; trả NCC `Trả hàng <NCC>`; chuyển kho `Chuyển kho <kho xuất> → <kho nhận>`; tồn đầu `Nhập tồn đầu kỳ`; có ghi chú phiếu thì nối ` - <ghi chú>`.
Excel theo đúng mẫu của khách: `Mã hàng | Ngày hạch toán | Số chứng từ | Diễn giải | ĐVT | Nhập | Xuất | Tồn`, dòng đầu "Số dư đầu kỳ", dòng cuối Cộng.

### 5.4 `GET /api/reports/sales` và `GET /api/reports/purchases` — chi tiết bán / mua hàng
Tham số: `from`, `to` (mặc định đầu tháng → hôm nay), `partner_id`, `product_id` (lịch sử bán một mã — REQ-021), `group_id`, `warehouse_id`, `q`, `include_returns` (mặc định `false`; `true` ⇒ thêm dòng trả hàng với `qty`, `amount` **âm**).
```json
{
  "kind": "sales", "from": "2026-09-01", "to": "2026-09-30",
  "rows": [{
    "date": "2026-09-25", "doc_no": "XK00008", "document_id": 20, "doc_type": "sale",
    "partner_id": 5, "partner_code": "THANHCONG", "partner_name": "Xưởng cơ khí Thành Công",
    "warehouse_id": 1, "warehouse_name": "Kho Tân Bình", "line_no": 6,
    "product_id": 1, "product_code": "DV", "product_name": "Dịch vụ", "is_service": true,
    "description": "TRẢ 01 ĐỒNG HỒ", "unit": "", "qty": 1, "unit_price": null, "amount": 0
  }, …],
  "total_qty": 202, "total_amount": 3990000, "document_count": 1
}
```
Dòng hàng hóa có `description` = tên hàng nếu dòng không có diễn giải. `total_qty` chỉ cộng hàng hóa; `total_amount` cộng cả dịch vụ.

### 5.5 `GET /api/reports/debt-summary` — tổng hợp công nợ
Tham số: `side=receivable` (phải thu KH, mặc định) | `payable` (phải trả NCC), `from`, `to` (tùy chọn), `q`, `include_zero` (mặc định `false`: bỏ đối tác toàn số 0).
- Phải thu = `opening_receivable` + bán − khách trả hàng − phiếu thu (`debt_side=receivable`) + phiếu chi trả lại tiền khách (`debt_side=receivable`).
- Phải trả = `opening_payable` + mua − trả hàng NCC − phiếu chi (`debt_side=payable`) + phiếu thu NCC hoàn tiền (`debt_side=payable`).
- `opening` = số dư trước `from` (không có `from` ⇒ số dư đầu kỳ khai báo ở danh mục); `increase`/`decrease` trong `[from, to]`; `closing = opening + increase − decrease`.
```json
{
  "side": "receivable", "from": "2026-09-01", "to": "2026-09-30",
  "items": [{"partner_id": 5, "partner_code": "THANHCONG", "partner_name": "Xưởng cơ khí Thành Công", "phone": "0909 444 555",
             "opening": 2000000, "increase": 3990000, "decrease": 0, "closing": 5990000}],
  "totals": {"partner_id": 0, "partner_code": "", "partner_name": "", "phone": "", "opening": 2000000, "increase": 3990000, "decrease": 0, "closing": 5990000}
}
```
(`totals` chỉ dùng các trường số.)

### 5.6 `GET /api/reports/debt-ledger` — sổ chi tiết công nợ một đối tác
Tham số: `partner_id` (bắt buộc), `side` (mặc định `receivable`), `from`, `to`.
```json
{
  "side": "receivable",
  "partner": {"id": 1, "code": "VINHPHONG", "name": "CTY TNHH TM DV VĨNH PHONG", "address": "…", "phone": "…"},
  "from": null, "to": null,
  "opening": 2000000,
  "rows": [
    {"date": "2026-04-03", "ref_no": "XK00002", "ref_type": "sale", "document_id": 13, "voucher_id": null,
     "description": "Bán hàng", "increase": 4580000, "decrease": 0, "balance": 6580000},
    {"date": "2026-04-14", "ref_no": "XK00003", "ref_type": "sale", "document_id": 14, "voucher_id": null,
     "description": "Bán hàng", "increase": 2460000, "decrease": 0, "balance": 9040000},
    {"date": "2026-04-20", "ref_no": "PT00001", "ref_type": "receipt", "document_id": null, "voucher_id": 1,
     "description": "Thu tiền mặt - Thu nợ tháng 4", "increase": 0, "decrease": 8460000, "balance": 580000},
    …
  ],
  "total_increase": …, "total_decrease": …, "closing": 3380000
}
```
`ref_type`: `sale | sale_return | purchase | purchase_return | receipt | payment`. Phiếu ở phía "ngược" (phiếu chi trên sổ phải thu, phiếu thu trên sổ phải trả) nằm bên `increase`, diễn giải có "(trả lại tiền khách)" / "(nhà cung cấp hoàn tiền)". Đúng một trong `document_id`/`voucher_id` khác `null`. Sắp theo ngày, rồi thứ tự ghi sổ/lập phiếu.

### 5.7 `GET /api/reports/cash-book` — sổ quỹ / sổ ngân hàng
Tham số: `account_id` (bỏ ⇒ gộp mọi tài khoản), `kind=cash|bank` (lọc khi không chọn tài khoản), `from`, `to`. Mỗi **dòng tiền** của phiếu là một dòng sổ.
```json
{
  "account_id": 1, "account_name": "Quỹ tiền mặt", "from": "2026-03-01", "to": "2026-03-31",
  "opening": 50000000,
  "rows": [{"date": "2026-03-12", "voucher_no": "PC00001", "voucher_id": 4, "voucher_type": "payment", "account_id": 1, "account_code": "TM",
            "partner_id": 10, "partner_name": "Công ty TNHH Sunshine Welding", "line_no": 1, "description": "Trả tiền hàng béc CO2",
            "document_id": null, "receipt": 0, "payment": 20000000, "balance": 30000000}, …],
  "total_receipt": 0, "total_payment": 20250000, "closing": 29750000
}
```

### 5.8 `GET /api/reports/draft-demand` — hàng cần đặt từ phiếu bán tạm (REQ-046)
Tham số: `only_shortage=true` (chỉ mã thiếu). Sắp theo `shortage` giảm dần.
```json
{"items": [{
  "product": {"id": 15, "code": "JASICMIG250", "name": "Máy hàn MIG Jasic 250A", "unit": "Cái"},
  "product_id": 15, "product_code": "JASICMIG250", "product_name": "Máy hàn MIG Jasic 250A", "unit": "Cái",
  "qty_in_drafts": 10, "total_stock": 6, "shortage": 4,
  "drafts": [{"document_id": 25, "draft_no": "TAM000025", "doc_date": "2026-11-14", "partner_id": 6, "partner_name": "Công ty CP Kết cấu thép Đại Phát", "qty": 10}]
}]}
```
`total_stock` = tồn tổng mọi kho hiện tại (mọi ngày); `shortage = max(0, qty_in_drafts − total_stock)`.

### 5.9 `GET /api/dashboard`
Tham số: `low_stock_threshold` (mặc định 5).
```json
{
  "today": "2026-11-14",
  "draft_count": 3, "draft_sale_count": 2,
  "revenue_today": 2590000, "revenue_month": 5390000,
  "total_receivable": 45860000, "total_payable": 134558000,
  "low_stock_count": 0, "out_of_stock_count": 0, "low_stock_threshold": 5,
  "cash_balance": 35440000, "bank_balance": 232978000,
  "draft_shortage_count": 1,
  "recent_drafts": [{"document_id": 27, "doc_type": "purchase", "draft_no": "TAM000027", "doc_date": "2026-11-14",
                     "partner_name": "Công ty TNHH Sunshine Welding", "total_amount": 4500000,
                     "updated_by_name": "Nguyễn Thị Lan (Máy 1)", "updated_at": "…"}],
  "generated_at": "…"
}
```
Doanh thu = phiếu bán − khách trả hàng (đã ghi sổ). `low_stock_count` = mã đang dùng đã từng phát sinh có tồn tổng ≤ ngưỡng (gồm cả hết hàng); `out_of_stock_count` = tồn tổng ≤ 0. `recent_drafts` tối đa 10 phiếu tạm sửa gần nhất. `draft_shortage_count` = số mã trên phiếu bán tạm đang thiếu hàng.

---

## 6. Sự kiện thời gian thực — `GET /api/events` (SSE)

Cần đăng nhập (cookie). Dùng `new EventSource("/api/events", {withCredentials: true})`. Server gửi `retry: 3000`, ping `: ping` mỗi 25 giây, và mỗi sự kiện là một message mặc định (`onmessage`):
```
data: {"type":"document.changed","id":25,"doc_type":"sale","status":"draft","action":"updated","by":"Trần Thị Hoa (Máy 2)","by_id":3,"at":"2026-11-14T13:58:09.589Z"}
```
| `type` | Khi | Trường thêm |
|---|---|---|
| `document.changed` | tạo/sửa/ghi sổ/bỏ ghi sổ/xóa chứng từ | `doc_type`, `status` (sau thao tác), `action`: `created|updated|posted|unposted|deleted` |
| `voucher.changed` | tạo/sửa/xóa phiếu thu chi | `doc_type` = `receipt|payment`, `action`: `created|updated|deleted` |
| `catalog.changed` | tạo/sửa/xóa danh mục, người dùng | `entity`: `warehouse|product_group|product|partner|cash_account|user`, `action` |

Gợi ý frontend: nhận sự kiện ⇒ invalidate query liên quan (TanStack Query). Đang mở phiếu `id` mà nhận `document.changed` của chính phiếu đó từ người khác (`by_id` ≠ mình) ⇒ báo "Phiếu vừa được <by> sửa" và tải lại. Sự kiện chỉ là tín hiệu; dữ liệu luôn lấy lại bằng GET.

---

## 7. Danh sách endpoint

| # | Phương thức | Đường dẫn |
|---|---|---|
| 1 | GET | `/api/health` |
| 2–4 | POST, POST, GET | `/api/auth/login`, `/api/auth/logout`, `/api/auth/me` |
| 63 | POST | `/api/auth/change-password` |
| 64–65 | GET, PUT | `/api/settings` |
| 5–7 | GET, POST, PUT | `/api/users`, `/api/users`, `/api/users/{id}` |
| 8–32 | GET, POST, GET, PUT, DELETE | `/api/warehouses[/{id}]`, `/api/product-groups[/{id}]`, `/api/products[/{id}]`, `/api/partners[/{id}]`, `/api/cash-accounts[/{id}]` |
| 33–34 | GET | `/api/products/lookup?code=`, `/api/products/{id}/price-info` |
| 66 | GET | `/api/products/price-info?ids=` (hàng loạt) |
| 67 | POST | `/api/documents/check` (phiếu chưa lưu) |
| 68 | GET | `/api/partners/{id}/balance` |
| 35–44 | GET, POST, GET, PUT, DELETE, POST, POST, GET, GET, GET | `/api/documents`, `/api/documents`, `/api/documents/{id}` (GET/PUT/DELETE), `/{id}/post`, `/{id}/unpost`, `/{id}/check`, `/{id}/export`, `/{id}/history` |
| 45–51 | GET, POST, GET, PUT, DELETE, GET, GET | `/api/vouchers`, `/api/vouchers`, `/api/vouchers/{id}` (GET/PUT/DELETE), `/{id}/export`, `/{id}/history` |
| 52–60 | GET | `/api/reports/stock-summary`, `stock-nxt`, `stock-ledger`, `sales`, `purchases`, `debt-summary`, `debt-ledger`, `cash-book`, `draft-demand` |
| 61 | GET | `/api/dashboard` |
| 62 | GET | `/api/events` (SSE) |

---

## 8. Bản mở rộng (SPEC_MO_RONG.md) — đợt M1

Mọi tính năng mở rộng **tắt** ⇒ mọi endpoint ở các mục 1–7 hoạt động y như bản chuẩn. API riêng của tính năng đang tắt trả
`404` với `code: "FEATURE_OFF"` ("Tính năng "…" chưa được bật (Danh mục › Tính năng mở rộng)").
Mã lỗi mới: `FEATURE_OFF` (404), `PERIOD_LOCKED` (422), `IMPORT_INVALID` (422).

### 8.1 Công tắc tính năng
- `GET /api/features` (mọi người dùng) →
  ```json
  {"edition": "extended",
   "features": {"permissions": true, "period_lock": true, "import_excel": true, "min_stock": false, "price_list": false, "credit_limit": false,
                "profit_report": false, "stocktake": false, "unit_conversion": false, "vat": false, "print_template": false},
   "items": [{"key": "permissions", "name": "Phân quyền", "description": "Vai trò Bán hàng, …", "available": true, "enabled": true},
             {"key": "min_stock", "name": "Tồn tối thiểu từng mã", "description": "…", "available": false, "enabled": false}, …],
   "keys": [{"key": "permissions", "name": "Phân quyền"}, …]}
  ```
  `edition`: `"extended"` | `"base"`. `features` = giá trị **hiệu lực** (đủ 11 khóa). `items` (11 phần tử, theo thứ tự hiển thị): `available:false` = tính năng chưa có trong phiên bản này (đợt M2/M3) — luôn `enabled:false`, giao diện hiện mờ/ẩn. `keys` giữ từ M1 để tương thích (nên dùng `items`).
  Giá trị hiệu lực của một khóa có sẵn = giá trị quản trị đã đặt nếu có, ngược lại theo bản cài: `KHO_EDITION=extended` ⇒ bật, bản chuẩn ⇒ tắt (đọc lại mỗi lần máy chủ khởi động; bản mở rộng nâng cấp lên phiên bản có tính năng mới ⇒ tính năng mới bật, bản chuẩn ⇒ tắt).
- `PUT /api/features` (quản trị) body `{"features": {"permissions": true, "import_excel": true}, "confirm": false}` — chỉ lưu các khóa gửi lên (thành giá trị quản trị đặt) → cùng hình dạng như GET. Khóa lạ hoặc khóa `available:false` ⇒ 400. Có audit (entity `features`) và phát SSE `{"type":"features","action":"updated",…}` (cũng phát khi đổi ma trận quyền / ngày khóa sổ) — giao diện tải lại `/api/features`, `/api/auth/me`.
  Tắt `permissions` khi còn người dùng mang vai trò `banhang`/`muahang`/`thukho` ⇒ `409 IN_USE`, message nêu tên, `details.users`; gửi lại với `"confirm": true` để tắt (họ được coi như `ketoan`).
- Bản cài: biến môi trường `KHO_EDITION=extended` ⇒ mọi tính năng có sẵn mà quản trị chưa đặt đều bật; không đặt ⇒ tắt. Lựa chọn của quản trị không bao giờ bị đè.
- `GET /api/auth/me` có thêm `"permissions": ["sale.write", …]` (tính năng tắt ⇒ đủ 10 quyền) và `"features": {…}`.

### 8.2 Phân quyền (`permissions`)
Vai trò: `admin`, `ketoan`, `banhang`, `muahang`, `thukho` (`POST/PUT /api/users` nhận `role` mới chỉ khi tính năng bật, ngược lại 400).
Quyền: `sale.write`, `purchase.write`, `stock.write`, `cash.write`, `catalog.write`, `posted.edit`, `cost.view`, `debt.view`, `cash.view`, `report.view`.
- `GET /api/role-permissions` (quản trị) → `{"matrix": {"ketoan": [...], "banhang": ["sale.write","cash.write","debt.view","report.view"], "muahang": [...], "thukho": ["stock.write"], "admin": [đủ 10]}, "permissions": [{"key","name"}], "roles": [{"key","name"}]}`.
- `PUT /api/role-permissions` (quản trị) body `{"matrix": {"thukho": ["stock.write","sale.write"]}}` — thay quyền của các vai trò gửi lên; `admin` không sửa được (400); quyền lạ ⇒ 400; có audit.
- Thiếu quyền ⇒ `403 FORBIDDEN`, message "Bạn không có quyền "<tên quyền>"…", `details.permission`. Kiểm tra quyền chạy **trước** kiểm tra dữ liệu.

| Thao tác | Quyền |
|---|---|
| POST/PUT/DELETE `/warehouses`, `/product-groups`, `/products`, `/partners`, `/cash-accounts` | `catalog.write` |
| Tạo / sửa / ghi sổ / xóa phiếu tạm, `POST /documents/check` — bán, khách trả | `sale.write` |
| … — nhập mua, trả NCC | `purchase.write` |
| … — chuyển kho, tồn đầu kỳ | `stock.write` |
| Sửa / bỏ ghi sổ / xóa chứng từ **đã ghi sổ** | quyền loại phiếu + `posted.edit` |
| POST/PUT/DELETE `/vouchers` | `cash.write` |
| GET `/vouchers`, `/vouchers/{id}` (+ export, history) | `cash.view` **hoặc** `cash.write` |
| `/reports/sales` | `report.view` |
| `/reports/purchases` | `report.view` + `cost.view` |
| `/reports/debt-summary`, `/reports/debt-ledger` (side=receivable), `/partners/{id}/balance` | `debt.view` |
| `/reports/debt-*` với `side=payable` | `debt.view` + `cost.view` |
| `/reports/cash-book` | `cash.view` |
| Người dùng, cài đặt công ty, tính năng, ma trận quyền, ngày khóa sổ, nhập công nợ đầu kỳ | chỉ `admin` |
| Tồn kho, thẻ kho, NXT, hàng cần đặt, danh mục, xem chứng từ, dashboard, đổi mật khẩu | mọi vai trò |

**Che số liệu ở máy chủ** (mọi phản hồi JSON, kể cả lỗi, lịch sử, dashboard; trường vẫn có mặt, giá trị `null`):
- Không có `cost.view`: `purchase_price`, `cost_price`; với mọi object có `doc_type` ∈ `purchase`, `purchase_return`, `opening` (chứng từ, dòng danh sách, dòng thẻ kho, lịch sử): `unit_price`, `amount`, `total_amount`, `old_debt`, `total_debt` và `unit_price`/`amount` của các dòng; `sum_total_amount` của `/documents` (trừ khi `type=` chỉ gồm loại không phải mua/tồn đầu); `total_payable`, `opening_payable`, `payable`. Cảnh báo bán lỗ vẫn có (`type:"loss"`, `line_no`, `product_code`, `unit_price` bán) nhưng `cost_price: null` và message không có con số. File xuất chứng từ mua / trả NCC / tồn đầu bỏ cột Đơn giá, Thành tiền và Nợ cũ/Tổng nợ.
- Không có `debt.view`: `old_debt`, `total_debt`, `total_receivable`, `total_payable`, `opening_receivable`, `opening_payable`, `receivable`, `payable`; file xuất chứng từ bỏ Nợ cũ/Tổng nợ.
- Không có `cash.view`: `cash_balance`, `bank_balance`, `opening_balance` (tài khoản tiền).
- Không có `report.view`: `revenue_today`, `revenue_month`.
- Khi lưu, trường bị che không bị ghi đè: sửa mặt hàng giữ `purchase_price` cũ (tạo mới ⇒ 0); sửa đối tác giữ số dư đầu kỳ; sửa tài khoản tiền giữ `opening_balance`; sửa chứng từ mua/tồn đầu: dòng gửi lại `id` với `unit_price: null` giữ đơn giá cũ (dòng mới ⇒ giá mua mặc định).
- Sự kiện SSE không mang số liệu tiền.

### 8.3 Khóa sổ (`period_lock`)
- `GET /api/period-lock` (mọi người dùng) → `{"lock_date": "2026-01-31"}` (hoặc `null`).
- `PUT /api/period-lock` (quản trị) body `{"lock_date": "2026-01-31", "reason": "Chốt sổ tháng 1"}`; `lock_date: null` = bỏ khóa. Ngày tương lai ⇒ 400. Có audit (lưu cả lý do).
- Khi bật, với ngày khóa L (`422 PERIOD_LOCKED`, message "Kỳ đến dd/mm/yyyy đã khóa sổ…", `details.lock_date`):
  - tạo chứng từ (kể cả phiếu tạm) hoặc phiếu thu chi có ngày ≤ L;
  - ghi sổ, bỏ ghi sổ chứng từ có ngày ≤ L; sửa chứng từ **đã ghi sổ** có ngày cũ hoặc ngày mới ≤ L (không sửa trong kỳ, không dời vào/ra kỳ);
  - sửa / xóa phiếu thu chi có ngày cũ hoặc mới ≤ L;
  - phiếu **tạm** đã nằm trong kỳ khóa: sửa, xóa, dời ngày ra ngoài kỳ được; không ghi sổ được; không được dời phiếu tạm từ ngoài vào trong kỳ;
  - nhập tồn đầu kỳ từ Excel với `date` ≤ L (cả `dry_run`);
  - **số dư đầu kỳ không có ngày**: đổi `opening_receivable` / `opening_payable` của đối tác, `opening_balance` của tài khoản tiền (tạo mới với số khác 0, hoặc sửa thành số khác), và nhập `opening_debt` từ Excel (cả `dry_run`) ⇒ `422 PERIOD_LOCKED` ("… Quản trị cần bỏ khóa sổ trước …"). Tạo mới với số 0 và sửa các trường khác (giữ nguyên số dư) vẫn được.
- Tính năng tắt ⇒ không áp dụng khóa (ngày khóa đã lưu vẫn giữ để bật lại).

### 8.4 Nhập từ Excel (`import_excel`)
`{loai}` ∈ `products` (quyền `catalog.write`), `partners` (`catalog.write`), `opening_stock` (`stock.write`), `opening_debt` (chỉ quản trị).
- `GET /api/import/{loai}/template` → file `Mau_nhap_{loai}.xlsx`: trang "Dữ liệu" (dòng tiêu đề + 2 dòng ví dụ; ví dụ tồn đầu / công nợ đầu dùng mã có thật trong danh mục), trang "Hướng dẫn".
- `POST /api/import/{loai}?dry_run=1[&date=YYYY-MM-DD]` — `multipart/form-data`, trường `file` (.xlsx, ≤ 10 MB, ≤ 20.000 dòng dữ liệu; vượt ⇒ 400). Không ghi gì. → `200`:
  ```json
  {"kind": "products", "dry_run": true, "rows": 4, "creates": 3, "updates": 1,
   "errors": [{"row": 9, "column": "Giá bán", "message": "\"abc\" không phải là số"}],
   "notes": ["Sẽ tạo 1 nhóm VTHH mới."]}
  ```
  `row` = số dòng trong Excel; `column` = tiêu đề cột ("" nếu lỗi cả dòng).
- `POST /api/import/{loai}` (không `dry_run`): **tất cả hoặc không gì**. Còn lỗi ⇒ `422 IMPORT_INVALID`, `details` = kết quả như trên (không ghi gì). Thành công ⇒ `200` cùng hình dạng (`dry_run: false`); `opening_stock` có thêm `"documents": [{"id", "draft_no", "warehouse_id", "warehouse_code", "lines"}]`.
- Đọc file: trang đầu tiên không tên "Hướng dẫn"; dòng tiêu đề tìm trong 30 dòng đầu, nhận cột theo **tiêu đề** (không phân biệt dấu/hoa thường, bỏ ký tự như `*`), thứ tự cột tùy ý, cột lạ bỏ qua; dòng trống bỏ qua; cắt khoảng trắng; mã trùng trong file ⇒ lỗi "trùng với dòng N".
- Số: ô kiểu số của Excel đọc nguyên giá trị; ô chữ đọc kiểu Việt: `1.500.000` = 1500000, `2,5` = 2,5, `1.200.000,5` = 1200000,5, `2.5` = 2,5 (dấu chấm chỉ là ngăn nghìn khi đúng dạng nhóm 3 chữ số). Giá làm tròn 2 chữ số, SL 3 chữ số.
- `products` — cột: Mã hàng*, Tên hàng*, ĐVT, Nhóm VTHH, Giá bán, Giá mua. Mã đã có ⇒ cập nhật các ô có dữ liệu (ô trống giữ nguyên); mã mới cần Tên và ĐVT. Nhóm tìm theo mã hoặc tên, chưa có ⇒ tự tạo. Mã `DV`/`DICHVU` không nhập được. Không có `cost.view` ⇒ cột Giá mua bị bỏ qua (có `notes`).
- `partners` — Mã đối tác*, Tên đối tác*, Là KH, Là NCC (`x`/`có`/`1` = có), Địa chỉ, Điện thoại, MST. Đối tác mới phải là KH hoặc NCC.
- `opening_stock` — Mã hàng*, Mã kho*, Số lượng* (> 0), Đơn giá (trống ⇒ giá mua mặc định). Mã hàng / kho phải có sẵn (đang dùng, không phải dịch vụ); cặp mã hàng + kho trùng ⇒ lỗi. Tạo phiếu **Tồn đầu kỳ TẠM** ngày `date` (mặc định hôm nay), mỗi kho một phiếu (tối đa 1000 dòng/phiếu, nhiều hơn thì tách); người dùng xem lại rồi ghi sổ.
- `opening_debt` — Mã đối tác*, Phải thu, Phải trả (âm được). Đặt `opening_receivable` / `opening_payable` theo đúng cơ chế hiện có, **thay** số cũ: cột có mặt mà ô trống ⇒ 0; cột không có trong file ⇒ giữ số cũ.
- Mỗi lần nhập thật ghi một dòng audit (entity `import`); SSE `catalog.changed` (entity `product`/`partner`, action `imported`) hoặc `document.changed` cho từng phiếu tồn đầu tạo ra.

| # | Phương thức | Đường dẫn (bản mở rộng) |
|---|---|---|
| 69–70 | GET, PUT | `/api/features` |
| 71–72 | GET, PUT | `/api/role-permissions` |
| 73–74 | GET, PUT | `/api/period-lock` |
| 75–76 | GET, POST | `/api/import/{loai}/template`, `/api/import/{loai}` |
