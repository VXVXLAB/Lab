# BÁO CÁO QA HỘP ĐEN — BẢN MỞ RỘNG, ĐỢT M1 + M2

Phạm vi: §0 công tắc tính năng; M1 = C1 phân quyền, C4 khóa sổ, C3 nhập Excel; M2 = C5 tồn tối thiểu, C6 giá theo khách,
C8 hạn mức + tuổi nợ, C7 lãi gộp. Kiểm thử **chỉ qua HTTP API** (không đọc mã nguồn backend), binary
`backend/bin/khoserver` có sẵn (không build lại). Nguồn đối chiếu: `SPEC_MO_RONG.md`, `SPEC.md`, `API.md` §8–§9,
`QUYET_DINH.md` mục N, O. Ngày chạy: 15/11/2026.

## 1. Cách chạy

```bash
cd kho/qa
./run_mr.sh                 # toàn bộ: pha 1 bản mở rộng + pha 2 bản chuẩn
./run_mr.sh test_C8         # lọc theo tên (chỉ áp cho pha 1; pha 2 luôn chạy)
```

- Pha 1: tạo CSDL mới `kho_qa_mr`, chạy `khoserver` với `KHO_EDITION=extended` ở `127.0.0.1:18391`, chạy mọi `mr_*.py`.
- Pha 2: tạo CSDL mới `kho_qa_mr_base`, chạy `khoserver` **không** đặt `KHO_EDITION` ở `127.0.0.1:18392`, chạy `mr_base.py`
  (mọi API của tính năng trả `404 FEATURE_OFF`, phản hồi bản chuẩn không có trường mới).
- Không đụng cổng 8080 / 8090 / 18091 (script từ chối các cổng này và dừng nếu cổng đã có người dùng). Postgres tắt ⇒
  `pg_ctlcluster 16 main start`. Xong thì dừng máy chủ và xóa 2 CSDL (`MR_KEEP_DB=1` để giữ lại).
- Biến tùy chọn: `KHOSERVER`, `MR_PORT`, `MR_PORT_BASE`, `MR_DB`, `MR_DB_BASE`.
- Kết quả: `out/mr_run_extended.log`, `out/mr_run_base.log`, `out/mr_results_{extended,base}.json`, log máy chủ
  `out/mr_server_*.log`.
- **Mã thoát hiện tại = 1**: các lỗi sản phẩm đã biết được giữ nguyên là test đỏ (không nới test cho qua). Mã thoát 0
  khi mọi lỗi mục 3 được sửa.

Tệp mới: `run_mr.sh`, `mr_main.py`, `mr_lib.py`, `mr_f.py`, `mr_c1.py`, `mr_c1_mask.py`, `mr_c4.py`, `mr_c3.py`, `mr_c5.py`,
`mr_c6.py`, `mr_c8.py`, `mr_c7.py`, `mr_extra.py`, `mr_general.py`, `mr_base.py`, báo cáo này. Không sửa tệp cũ nào.
Mỗi test gắn nhãn tính năng (F, C1, C3, C4, C5, C6, C7, C8, G = chung); trong log hiện dạng `REQ-C8`.

Ghi chú về bộ khung cũ: `lib.run_all` **nuốt im lặng** ngoại lệ `Fatal` do các hàm trợ giúp (`ok()`, `posted()`,
`draft()`) ném ra — một test hỏng ngay ở khâu dựng dữ liệu vẫn báo PASS với 0 check. Bộ `mr_*` dùng decorator riêng
(`mr_lib.test`) ghi `Fatal` thành lỗi. Nên xem lại bộ QA bản chuẩn vì lý do này (bộ cũ không bị sửa).

## 2. Số liệu (2 lần chạy liên tiếp, kết quả giống nhau)

| Pha | Test | PASS | FAIL | Check | Check lỗi | HTTP 5xx | "panic" trong log |
|---|---|---|---|---|---|---|---|
| Bản mở rộng (`KHO_EDITION=extended`) | 92 | 84 | 8 | ≈3.975 | 14 | **0** | 0 |
| Bản chuẩn (không `KHO_EDITION`) | 4 | 4 | 0 | 111 | 0 | **0** | 0 |

Theo tính năng (pha 1): C1 19/20 · C3 18/20 · C4 7/9 · C5 5/5 · C6 4/5 · C7 7/7 · C8 12/13 · F 6/7 · G 6/6.

Ngoài ra: chạy lại **bộ QA bản chuẩn có sẵn** (`qa/run.sh`, từ một bản sao trong thư mục tạm, cổng 18393) với binary mới ở
bản chuẩn: **45/45 PASS, 16.765 check, 0 × 5xx** — đúng yêu cầu "tắt = y như bản chuẩn".

Phủ chính: ma trận 5 vai trò × ~90 thao tác ghi/đọc (≈950 check); bò toàn bộ GET + file xlsx/docx + lỗi + lịch sử + SSE
bằng 3 tài khoản bị che giá vốn, tìm 14 con số giá vốn "đánh dấu" (có đối chứng ngược bằng admin); mọi loại chứng từ ×
mọi thao tác qua ranh giới khóa sổ; 20 kịch bản nhập Excel; tuổi nợ: kịch bản tính tay + 10 khách ngẫu nhiên × 18 nghiệp
vụ × 4 ngày xét so với **mô hình FIFO độc lập** viết trong test và với sổ công nợ; lãi gộp: kịch bản bình quân gia quyền
tính tay (tồn đầu + 3 lần mua giá khác nhau + trả NCC + mua lùi ngày + khách trả + dịch vụ + chuyển kho + phiếu tạm), ba
cách nhóm, đối chiếu báo cáo bán hàng; đồng thời (2 nhập Excel, 4 nhập tồn đầu, đặt khóa sổ khi đang ghi sổ, 2 phiếu tranh
hạn mức, tắt/bật tính năng khi người khác đang dùng).

## 3. Lỗi tìm thấy

Mức độ: **Cao** (sai số liệu/lộ dữ liệu nghiêm trọng) · **Trung bình** · **Thấp**. Phân loại: BUG (trái spec/API),
USABILITY. Mọi ví dụ lấy từ phản hồi thật.

### M-01 — Trung bình — BUG (C8 + C1): thông báo `CREDIT_WARNING` lộ số công nợ cho người không có `debt.view`
Test: `test_C8_credit_vs_loss_vs_stock_order_and_flags`.
Dựng: quản trị cho `thukho` thêm `sale.write` (`PUT /api/role-permissions {"matrix":{"thukho":["sale.write"]}}`); khách có
`opening_receivable` 200, `credit_limit` 100. `thukho` lập phiếu bán 1.000 rồi:
```
POST /api/documents/2/post {"version":1}
→ 409 {"error":{"code":"CREDIT_WARNING","details":{"credit":{"credit_limit":null,"document_amount":1000,"over":null,
  "receivable":null,"total_after":null,…}},
  "message":"Khách … vượt hạn mức công nợ: nợ hiện tại 200 + phiếu này 1.000 = 1.200, hạn mức 100 (vượt 1.100). …"}}
```
`details` đã che đúng nhưng `message` in nguyên các con số. Mong đợi (API §9.3, §8.2 "che mọi phản hồi JSON, kể cả
lỗi"): người không có `debt.view` không thấy nợ hiện tại, hạn mức, số vượt — kể cả trong `message`.

### M-02 — Trung bình — BUG (C4): xóa đối tác / tài khoản tiền đang có số dư đầu kỳ khi đã khóa sổ
Test: `test_C4_deleting_or_rekinding_opening_holders_while_locked`.
```
PUT /api/period-lock {"lock_date":"2024-06-30"}                        → 200
(đối tác chưa phát sinh chứng từ, opening_receivable 1.234; tài khoản tiền opening_balance 4.321)
DELETE /api/partners/1       → 200 {"ok":true}
DELETE /api/cash-accounts/3  → 200 {"ok":true}
```
Số dư đầu kỳ không có ngày nên thuộc cả kỳ đã khóa; xóa bản ghi làm mất 1.234 phải thu và 4.321 tồn quỹ của kỳ đã khóa
(tổng hợp công nợ, sổ quỹ, dashboard đến 30/06/2024 thay đổi). Spec C4: "khi đang có ngày khóa: không đổi công nợ đầu kỳ
của đối tác, số dư đầu của tài khoản tiền" — sửa thành số khác bị chặn `422`, nhưng xóa thì lọt. Mong đợi:
`422 PERIOD_LOCKED` (hoặc buộc đưa số dư về 0 trước, việc này đã bị chặn).

### M-03 — Thấp — BUG (C4): đổi loại tài khoản tiền mặt ↔ ngân hàng khi khóa sổ
Cùng test. Tài khoản tiền mặt có `opening_balance` 999, chưa có phiếu:
`PUT /api/cash-accounts/20 {…,"kind":"bank","opening_balance":999}` → `200`. Số dư đầu chuyển từ "quỹ tiền mặt" sang
"ngân hàng" của kỳ đã khóa (sổ quỹ lọc `kind`, `cash_balance`/`bank_balance`). Mong đợi `422 PERIOD_LOCKED` khi số dư
đầu ≠ 0.

### M-04 — Thấp/Trung bình — BUG (C6): `replace:true` với danh sách rỗng không xóa gì
Test: `test_C6_validation_permissions_partner_kind`.
```
PUT /api/partners/3/prices {"items":[],"replace":true}
→ 200 {"items":[{"product_id":2,…,"price":7,…}],"partner_id":3}
```
API §9.2: "`replace: true` xóa các giá riêng không có trong danh sách" ⇒ danh sách rỗng phải xóa hết. Trả 200 mà không
xóa ⇒ người dùng tưởng đã xóa bảng giá cũ. Mong đợi: xóa hết (hoặc 400 nếu không muốn cho phép, nhưng không im lặng).

### M-05 — Thấp — BUG (C1, QUYET_DINH N8): kiểm tra dữ liệu chạy trước kiểm tra quyền khi JSON sai kiểu
Test: `test_C1_permission_checked_before_data`. Người `banhang` (không có `purchase.write`):
```
POST /api/documents {"doc_type":"purchase","warehouse_id":"xx","lines":"x"}
→ 400 {"error":{"code":"VALIDATION","details":{"field":"warehouse_id"},"message":"Trường \"warehouse_id\" sai kiểu dữ liệu"}}
POST /api/documents {"doc_type":"purchase","warehouse_id":1,"lines":[]}   → 403 FORBIDDEN (đúng)
```
API §8.2 / N8: "Kiểm tra quyền chạy **trước** kiểm tra dữ liệu (thiếu quyền ⇒ 403 dù dữ liệu sai)". Không lộ dữ liệu,
chỉ trái cam kết. Gợi ý: đọc `doc_type` trước rồi mới giải mã toàn bộ.

### M-06 — Thấp — BUG (F): giá trị `null` của công tắc bị hiểu là "tắt"
Test: `test_F_unknown_unavailable_and_garbage_keys`.
```
PUT /api/features {"features":{"permissions":null}}                 → 409 IN_USE (tức là đang định TẮT)
PUT /api/features {"features":{"permissions":null},"confirm":true}  → 200, permissions = false
```
Giá trị không phải boolean khác (`"có"`) bị 400, riêng `null` lại tắt tính năng phân quyền. Máy khách lỗi gửi `null` sẽ tắt
phân quyền. Mong đợi `400 VALIDATION` (hoặc định nghĩa rõ `null` = "về mặc định của bản cài").

### M-07 — Thấp — BUG (C4 + QUYET_DINH B12): số dư đầu "không đổi" nhưng gửi dạng khác bị chặn
Test: `test_C4_unchanged_opening_in_other_formats_and_masked_user_while_locked`. Đang khóa sổ, đối tác có
`opening_receivable` 1000; gửi lại `"1000.004"` (làm tròn 2 chữ số = 1000,00, đúng quy tắc B12 "làm tròn rồi mới kiểm"):
`PUT /api/partners/2 {…,"opening_receivable":"1000.004"}` → `422 PERIOD_LOCKED`, số lưu vẫn 1000. `"1000"`, `"1000.00"`,
`1000.0` thì qua. Mong đợi so sánh **sau** làm tròn ⇒ 200. Mức thấp (ít gặp).

### M-08 — Thấp/Trung bình — BUG (C3): ô công thức không có giá trị lưu sẵn bị nhập im lặng thành 0
Test: `test_C3_formulas_in_cells`. File (tạo bằng thư viện, như nhiều phần mềm xuất Excel) có ô Giá bán `=1000*2` không
kèm giá trị tính sẵn ⇒ thử: không lỗi; nhập thật: mặt hàng mới có `sale_price = 0`. Ô công thức **có** giá trị lưu sẵn
(như Excel lưu) thì đọc đúng 2000 (đạt). Mong đợi: báo lỗi dòng "ô công thức chưa có giá trị, hãy mở file bằng Excel
và lưu lại" thay vì ghi 0.

### M-09 — Trung bình — USABILITY/BUG (C3 + tìm kiếm K3): chữ Unicode dạng tổ hợp (NFD) không được chuẩn hóa
Test: `test_C3_unicode_nfc_nfd`. Nhập đối tác tên "Công ty Hàn Việt" dạng NFD (thường gặp khi chép từ macOS / một số
trình soạn thảo):
```
POST /api/import/partners (tên NFD)            → 200
GET  /api/partners?q=han viet                  → 200 {"items":[],"total":0}
GET  /api/partners?q=Hàn Việt (NFC)            → không thấy
```
Tên lưu nguyên NFD nên ô tìm kiếm không dấu/ có dấu (K3) không tìm ra; hai mã trông giống hệt nhau `HÀN…` (NFC) và
`HÀN…` (NFD) trong cùng file **không** bị báo trùng ⇒ có thể tạo hai mã hàng nhìn y hệt. Mong đợi: chuẩn hóa NFC mọi
chuỗi khi nhập (Excel và JSON).

### M-10 — Thấp — USABILITY (C6): `sale-price` bỏ im lặng id không tồn tại
```
GET /api/products/sale-price?partner_id=3&ids=2,9999999 → 200 {"items":[{"product_id":2,…}]}   (mất id 9999999)
GET /api/products/price-info?ids=2,9999999              → 404 {"details":{"missing_ids":[9999999]}}
```
Hai endpoint hàng loạt cùng kiểu xử lý khác nhau; giao diện sẽ không điền giá mà không biết vì sao. Nên trả 404
`missing_ids` như `price-info`.

## 4. Quyết định đáng xem lại (đúng spec/QUYET_DINH nhưng có rủi ro cho kế toán)

| # | Điểm | Quan sát (có test) | Đề nghị |
|---|---|---|---|
| Q-01 | **C7 / O6 — "bình quân gia quyền" cộng dồn từ đầu**, không trừ hàng đã xuất | `test_C7_cumulative_average_ignores_stock_on_hand_documented`: mua 100 @10, bán hết, mua 1 @100, bán 1 @120 ⇒ giá vốn = 1.100/101 → **11**, lãi 109; thực tế đơn vị đó giá 100, lãi 20. Sai số tăng theo thời gian vì giá cũ không bao giờ "ra khỏi" bình quân. Không khớp phương pháp bình quân cả kỳ dự trữ hay bình quân sau mỗi lần nhập (TT 200/133). | Khách cần xác nhận (spec ghi "cần khách xác nhận"). Nên dùng bình quân di động (sau mỗi lần nhập, theo tồn thực) hoặc bình quân theo kỳ (tồn đầu kỳ + nhập trong kỳ). |
| Q-02 | **C1 / N7 — người bị che giá lưu lại phiếu mua đã ghi sổ mà không gửi id dòng** | `test_C1_mask_saving_…`: đơn giá dòng phiếu mua **đã ghi sổ** đổi im lặng 913.579 → 864.197 (giá mua mặc định), kéo theo công nợ phải trả và lãi gộp. Đúng chữ API §8.2 ("dòng mới ⇒ giá mặc định") nhưng là mất dữ liệu ẩn. | Với người không có `cost.view`, dòng không id trên phiếu mua/tồn đầu: khớp theo mã hàng để giữ giá, hoặc từ chối 400. |
| Q-03 | Người bị che giá **vẫn nhập** được giá mua | Phiếu mua với `unit_price: 1234` được lưu 1234; nhập tồn đầu Excel cột Đơn giá 999 được lưu 999 (không có `notes`) — trong khi nhập hàng hóa thì **bỏ qua** cột Giá mua kèm ghi chú. Không nhất quán; người nhập không đọc lại được số mình gõ. | Thống nhất một quy tắc (bỏ qua + ghi chú, hoặc cho nhập "ghi mù" ở cả hai nơi). |
| Q-04 | `PUT /period-lock` thiếu trường `lock_date` = **bỏ khóa** | `{"reason":"…"}` → 200, khóa về `null`. | Bắt buộc gửi `lock_date` (kể cả `null`) để bỏ khóa. |
| Q-05 | O4 — hai máy ghi sổ cùng lúc có thể cùng lọt hạn mức | Lần chạy này một phiếu nhận 409 (không tái hiện được lọt), nhưng thiết kế chấp nhận. | Khóa advisory theo đối tác rẻ và triệt để. |
| Q-06 | N12 — đọc số kiểu Việt | `"1.250"` = 1.250 nhưng `"1.25"` = 1,25; `"1e3"` = 1000; `"1 500 000đ"` = 1.500.000; `"1,500,000"` lỗi (tốt). Người gõ kiểu Anh "1.250" (kg) bị nhân 1000 không báo. | Khi chuỗi có đúng một dấu chấm và 3 chữ số sau, thêm `notes` cảnh báo trong lần thử. |
| Q-07 | Tắt phân quyền khi chỉ còn người dùng **đã khóa** mang vai trò mới | Vẫn `409`, danh sách gồm cả người đã khóa. Đúng chữ spec. | Bỏ qua người đã khóa hoặc ghi rõ "(đã khóa)". |
| Q-08 | Nhập tồn đầu kỳ lần hai cùng file | Tạo thêm bộ phiếu tạm, thử không có `notes` cảnh báo. | Ghi chú "đã có N phiếu tồn đầu kỳ (tạm/đã ghi sổ) cho kho …". |
| Q-09 | C5 tồn tối thiểu tính cả chứng từ **ngày tương lai** | Tồn hôm nay 10, phiếu bán đã ghi sổ ngày 20/12 SL 6, min 5 ⇒ hôm nay đã báo "sắp hết" (tồn 4). Nhất quán với `draft-demand` (G5). | Chấp nhận được; nên ghi rõ trên màn hình. |
| Q-10 | C8 FIFO / C6 giá gần nhất | Khách trả hàng trừ vào **khoản nợ cũ nhất**, không vào hóa đơn bị trả (đúng spec C8). Giá "bán gần nhất" là đơn giá dòng, **bỏ qua** chiết khấu bằng dòng DV âm. | Nêu với khách khi UAT. |
| Q-11 | Cột tiêu đề lặp trong file Excel | Hai cột "Giá bán" ⇒ lấy cột đầu, không báo. | Báo lỗi "cột … xuất hiện 2 lần". |
| Q-12 | `price-info` cho người bị che vẫn trả `cost_source` | `last_purchase`/`default` cho biết mã đã từng được mua hay chưa. Rò rỉ nhỏ. | Che cả `cost_source` (hoặc chấp nhận). |
| Q-13 | N5 — nợ phải trả cần thêm `cost.view` | `banhang` không thấy phải trả ở đâu cả (dashboard, số dư). Hợp lý về bảo mật. | Giữ, ghi trong hướng dẫn. |

Những điểm đã kiểm và **đạt**, đáng ghi nhận: không lộ giá vốn ở bất kỳ GET/xlsx/docx/lỗi/lịch sử/SSE nào cho
`banhang`, `thukho` và vai trò "mọi quyền trừ cost.view" (kể cả các biến thể `type=Purchase`, `type=purchase,`… của
`sum_total_amount`, và `loss_lines` gộp trong `CREDIT_WARNING`); lưu lại hồ sơ hàng/đối tác/tài khoản/dòng phiếu mua có
id không xóa giá trị bị che; đổi vai trò / ma trận có hiệu lực ngay trong phiên đang mở; khóa tài khoản hủy phiên;
khóa sổ chặn đúng mọi loại chứng từ, ngày ranh giới (= ngày khóa bị chặn, ngày kế tiếp được), dời ngày cả hai chiều,
phiếu tạm trong kỳ, phiếu thu chi, số dư đầu, nhập Excel; báo cáo trong kỳ khóa không đổi sau các thao tác bị từ chối;
nhập Excel tất cả-hoặc-không, thử không ghi gì, mẫu tải về gửi lại đạt, 20.000 dòng nhận / 20.001 dòng 400, >10 MB 400,
tách 1000 dòng/phiếu; công thức `order_more` đúng O2 trên 6 ca; tuổi nợ khớp mô hình FIFO độc lập và sổ công nợ cho mọi
đối tác ở mọi ngày xét, biên 0/1/30/31/60/61/90/91 ngày đúng; lãi gộp khớp tính tay, ba cách nhóm cùng tổng, doanh thu =
báo cáo bán hàng; không có 5xx nào; tên bắt đầu bằng "=" xuất xlsx là ô chữ (không thành công thức).

## 5. Không kiểm được / giới hạn

- **Nhật ký audit** của công tắc tính năng, ma trận quyền, khóa sổ (lý do khóa), lần nhập Excel: không có API đọc audit
  (chỉ lịch sử chứng từ — đã kiểm `credit_confirmed` có ghi và không lộ số nợ cho người không có `debt.view`).
- Giao diện (ẩn nút/menu theo quyền), E2E trình duyệt, bản in.
- Nâng cấp CSDL thật: đổi `KHO_EDITION` trên CSDL đang có dữ liệu, migration 005 (N1) — test luôn dùng CSDL mới.
- File do Excel/LibreOffice thật tạo (dùng openpyxl và tự chèn giá trị công thức lưu sẵn); file `.xls` cũ chỉ kiểm bị từ
  chối; ô gộp, dòng ẩn, nhiều trang dữ liệu.
- Đồng thời nhiều máy thật (dùng luồng song song trên một máy); tranh chấp hạn mức không tái hiện được trường hợp lọt
  (Q-05). Ranh giới nửa đêm giờ VN cho "hôm nay" của khóa sổ.
- Hiệu năng ở quy mô lớn (chỉ đo 20.000 dòng nhập thử: vài giây); M3 (C9–C13) ngoài phạm vi.

---

# VÒNG KIỂM LẠI (sau commit `db49751`, binary build lại 15/11/2026 08:27)

Phần trên là vòng 1, giữ nguyên làm lịch sử. Vòng này kiểm lại M-01…M-10 theo kiểu tấn công, cập nhật test theo quy tắc
mới (SPEC_MO_RONG C7 viết lại, QUYET_DINH mục P, API §8–§10) và thêm test cho hành vi mới. Mọi con số kỳ vọng tính tay,
không lấy từ bên xây dựng.

## A. Số liệu (`./run_mr.sh` chạy 2 lần, kết quả giống nhau)

| Pha | Test | PASS | FAIL | Check | Check lỗi | HTTP 5xx | panic |
|---|---|---|---|---|---|---|---|
| Bản mở rộng | 110 | 109 | 1 | ≈4.267 | 2 | **0** | 0 |
| Bản chuẩn | 5 | 5 | 0 | 118 | 0 | **0** | 0 |

Theo tính năng: C1 23/23 · C3 22/22 · C4 10/10 · C5 5/5 · C6 6/6 · C7 13/13 · C8 16/16 · F 8/8 · G 6/7.
Bộ QA bản chuẩn cũ (45 test, đã sửa khung `lib.run_all` để `Fatal` = FAIL) với binary mới: **45/45, 16.775 check, 0 × 5xx**.
`run_mr.sh` vẫn thoát 1 vì M-11, M-12 (giữ là test đỏ).

## B. Test đổi theo quy tắc mới (7 chỗ mâu thuẫn)

| Test | Thay đổi |
|---|---|
| `mr_c7.py` (4 test) | Kỳ vọng tính lại theo **bình quân liên hoàn**. Kịch bản tháng 1/2025 đổi phiếu trả NCC thành 2 @64 để giá bình quân nguyên (54), tránh phụ thuộc chi tiết làm tròn giá trị xuất mà spec chưa nói. Tính tay: X = 230 / 162 / −54; tổng doanh thu 1.200, giá vốn 478, lãi 722, tỷ lệ 60,17%. Sửa lùi giá phiếu mua 08/01 30→130 ⇒ phiếu 10/01 giá vốn 330. |
| `mr_extra.py` | "Bình quân cộng dồn" (Q-01) thay bằng ví dụ của spec (mua 100 @10, bán hết, mua 1 @100, bán 1 @120 ⇒ giá vốn 100, lãi 20); kịch bản "kho về 0 rồi mua lại" ⇒ 80 (trước là 65). |
| `mr_c1_mask.py` | Q-02/P2: sửa / bỏ ghi sổ phiếu mua đã ghi sổ bởi người bị che ⇒ 403; phiếu tạm: dòng gửi lại `id` giữ giá dù gửi 1, 0, null, "999", 5e6. |
| `mr_c3.py` | Q-06/P6: ô chữ `2.5`, `1.25`, `12.5`, `0.5` ⇒ lỗi dòng (cả cột SL); `1.250` = 1.250. Q-11: cột tiêu đề lặp ⇒ 400 nêu tên cột. |
| `mr_c4.py` | Q-04/P4: `PUT /period-lock` thiếu `lock_date` ⇒ 400, khóa giữ nguyên. |
| `mr_f.py` | Q-07: chỉ còn người dùng **đã khóa** mang vai trò mới ⇒ tắt phân quyền 200, không 409. |

## C. Kết luận từng lỗi vòng 1

| Lỗi | Kết luận | Đã kiểm thêm (tấn công) |
|---|---|---|
| M-01 | **Đã sửa** | Người không có `debt.view`: thông báo CREDIT_WARNING không còn con số nợ, giá vốn (cả đường ghi sổ, cả đường **sửa phiếu đã ghi sổ tăng tiền**, cả khi gộp dòng lỗ); `banhang` (có `debt.view`) vẫn thấy số nợ, không thấy giá vốn. |
| M-02 | **Đã sửa** | Xóa đối tác chỉ có nợ **phải trả** đầu kỳ ⇒ 422; số dư 0 hoặc làm tròn về 0 (`"0.004"`) ⇒ xóa được; ngừng dùng (active=false) được; tắt tính năng khóa sổ ⇒ xóa được. |
| M-03 | **Đã sửa** | ngân hàng → tiền mặt có số dư ⇒ 422; số dư 0 ⇒ đổi được. |
| M-04 | **Đã sửa** | `replace:false` + `[]` giữ nguyên; `thukho` không xóa được bảng giá (403). |
| M-05 | **Đã sửa** | 403 trước khi đọc body ở `POST /documents` (sai kiểu), `PUT`/`post`/`check` theo phiếu có sẵn, `check` với `id` phiếu mua. JSON hỏng cú pháp (không đọc được `doc_type`) ⇒ 400, chấp nhận được. Lặp khóa `doc_type` (`"sale"` rồi `"purchase"`) không tạo được phiếu mua. |
| M-06 | **Đã sửa** | `null`, `"true"`, `1`, `0`, `[]`, `{}` ⇒ 400, `details.field = features.permissions`; `null` + `confirm:true` vẫn 400. |
| M-07 | **Đã sửa** | `"999.995"` và `"1000.0049"` ⇒ không đổi (200); `"1000.005"` ⇒ 1000,01 ⇒ 422. |
| M-08 | **Đã sửa** | Ô công thức không có giá trị lưu sẵn ⇒ lỗi dòng; có giá trị lưu sẵn đọc đúng. |
| M-09 | **Đã sửa** (chỉ phần kiểm được qua API) | NFD qua body JSON (UTF-8 thô và chuỗi thoát `̀`), query string (`lookup`, `q` của hàng/đối tác/chứng từ), ô Excel (mã NFD = mã NFC đã có ⇒ "cập nhật" chứ không tạo mới), ghi chú phiếu và dòng; mã NFC/NFD trùng ⇒ 400; **tên đăng nhập / mật khẩu NFD**: tạo bằng NFD rồi đăng nhập bằng NFC, NFD, lẫn lộn, viết hoa ⇒ đều được; đổi mật khẩu bằng NFD rồi đăng nhập NFC được; NUL + dấu tổ hợp ⇒ 400. **Không kiểm được** migration 007 trên dữ liệu cũ (cần CSDL có sẵn chuỗi NFD) và người dùng có mật khẩu NFD lưu **trước** migration (nay chuỗi gửi lên bị chuẩn hóa NFC ⇒ có thể không đăng nhập được nữa — nên kiểm ở mức Go). |
| M-10 | **Đã sửa** | 404 `missing_ids` liệt kê đủ các id thiếu. (Ghi chú: id trùng trả 2 lần, `price-info` gộp làm 1 — vô hại.) |

Quyết định vòng 1 đã sửa và kiểm: Q-01 (bình quân liên hoàn, mục D), Q-02 (mục E), Q-03 (nhập hàng hóa bỏ cột Giá mua
kèm `notes`), Q-04, Q-05 (mục F), Q-06, Q-07, Q-08 (`notes` "Kho KHO1 đã có 1 phiếu tồn đầu kỳ tạm… ngày 25/10/2026…"
khi cùng ngày; ngày khác không cảnh báo), Q-11, Q-12 (`cost_source` null với `banhang`/`thukho`, cả bản hàng loạt;
`muahang` vẫn thấy). Q-09, Q-10, Q-13 giữ theo P10–P12 (đồng ý, nêu khi UAT).

## D. C7 bình quân liên hoàn — các tấn công (tất cả đạt)

| Kịch bản (tháng 8/2025) | Tính tay | Kết quả |
|---|---|---|
| Cùng ngày: bán 5 ghi sổ **trước**, mua 10 @40 ghi sổ sau (tồn đầu 10 @10) | nhập trước: 500/20 = 25 ⇒ 125 (nếu theo thứ tự ghi sổ: 50) | 125 ✔ |
| Mua 10 @10; bán 4 (40); rồi ghi sổ phiếu mua **lùi ngày** 10 @30 trước ngày bán | 400/20 = 20 ⇒ 80; bỏ ghi sổ ⇒ lại 40 | ✔ |
| Mua 2 @10; trả NCC 1 @50 (giá trị không xuống dưới 0 ⇒ 0); mua 1 @30; bán 2 | 30/2 = 15 ⇒ 30 (không chặn 0 ⇒ 0) | 30 ✔ |
| Mua 10 @10; bán 5 (50); mua 5 @40 (250/10 = 25); khách trả 1 ⇒ nhập lại @25; bán 11 | trả −25, bán 275; cửa sổ báo cáo bắt đầu giữa lịch sử (04–05/08, hay chỉ 05/08) ra cùng số | ✔ |
| Tồn chỉ từ khách trả (chưa từng mua, giá mua mặc định 70) ⇒ bán 2; mua 3 @100; bán 2 | phiếu trả và lần bán đầu "ước tính" (140); lần bán sau không ước tính | ✔ (lần bán sau = 170 ⇒ hàng khách trả đã vào kho bình quân @70 — hợp lý nhưng spec chưa nói, nên ghi rõ) |
| Dòng DV cước trên phiếu mua; DV trên phiếu bán | giá vốn hàng = 5 × 20 = 100; DV giá vốn 0 | ✔ |
| Ba cách nhóm (tháng 8 và toàn CSDL), doanh thu = báo cáo bán hàng `include_returns` | | ✔ |
| SL lẻ + số lớn (3 @33,33 + 0,5 @1 tỷ; bán 1,25) | 178.571.464 | ✔ |

## E. Q-02 — mọi đường đổi giá đã lưu khi không có `cost.view`

Đạt: `PUT` (kể cả chỉ sửa ghi chú, dời ngày, JSON hỏng) và `unpost` phiếu **mua / trả NCC / tồn đầu đã ghi sổ** ⇒ 403
(quyền kiểm trước body); vẫn ghi sổ được phiếu tạm, vẫn sửa được phiếu chuyển kho đã ghi sổ; người có quyền xem giá
vẫn sửa được. Phiếu tạm mua và tồn đầu: dòng gửi lại `id` cùng mặt hàng giữ giá với `null`, bỏ trống, `0`, `1`,
`"9.999"`, `9e9`, `-5`; thành tiền = SL mới × giá giữ; đảo thứ tự dòng giữ giá theo dòng; đổi mặt hàng trên một `id`
(hoán đổi id hai dòng) ⇒ dòng mới giá mặc định; `PUT /products` và nhập Excel không đổi được giá mua.

**Còn đường vòng (Q-14, cần controller quyết):** người bị che giá vẫn **gõ giá mới** được trên dòng **mới**: bỏ dòng cũ
(giá lưu 111) rồi thêm dòng mới giá 1 ⇒ lưu 1; dùng `id` dòng của phiếu khác + giá 1 ⇒ lưu 1; dòng mới phiếu mua
`4321` ⇒ lưu 4321. Đúng chữ P2 ("dòng mới không có giá ⇒ giá mặc định" — không nói dòng mới **có** giá), nên không ghi
là lỗi; nhưng câu "mọi cách gửi giá đều giữ giá đang lưu" chỉ đúng với dòng giữ `id`. Nếu muốn chặn hẳn: dòng mới của
người bị che luôn lấy giá mua mặc định. (Lặp `id` hai lần: dòng thứ hai được giá đang lưu 5555 chứ không phải giá gửi 1 —
vô hại.)

## F. Q-05 — hạn mức chạy song song (đạt)

3 vòng × 8 lần ghi sổ đồng thời, mỗi phiếu 300 (dòng DV, không có khóa kho), hạn mức 1.000, không xác nhận: mỗi vòng
**đúng 3 phiếu qua, 5 phiếu `CREDIT_WARNING`**, nợ 900. 10 phiếu của 2 khách với thứ tự mặt hàng ngược nhau ghi sổ
đồng thời: cả 10 qua, không deadlock, không 5xx.

## G. Nhật ký `/api/audit`, `/auth/login`, lịch sử khóa sổ

Đạt: `ketoan`/`banhang`/`muahang`/`thukho` ⇒ 403, ẩn danh 401 (cả bản chuẩn: admin 200, `ketoan` 403); có dòng cho
`features` (người, trước/sau, tên khóa), `role_permissions`, `period_lock` (kèm lý do), `import` (đúng **một** dòng mỗi
lần nhập thật, nhập thử không ghi), `partner_prices`, xác nhận hạn mức (`credit_confirmed` của phiếu, có người và số
liệu); lọc nhiều `entity`; `limit`/`offset`; mới nhất trước; tham số sai (limit 0 / 1001 / chữ, offset âm, ngày sai, NUL)
⇒ 400. `GET /period-lock` có `history` mới nhất trước kèm lý do và người (người không phải quản trị cũng thấy — chấp
nhận được). `POST /auth/login` trả `permissions` + `features` đúng vai trò, không có trường mật khẩu.

## H. Lỗi mới

### M-11 — Thấp — BUG: `/api/audit` nhận `to < from`
`GET /api/audit?from=2026-02-01&to=2026-01-01` → `200` (danh sách rỗng). Mọi báo cáo khác trả `400` khi `to < from`
(API §5). Người dùng gõ nhầm sẽ tưởng "không có thay đổi nào".

### M-12 — Trung bình — BUG (SPEC_MO_RONG §0 "mọi thay đổi có audit"): tạo người dùng và đổi vai trò không có nhật ký
`POST /api/users {"role":"banhang",…}` rồi `PUT /api/users/{id} {"role":"muahang"}` ⇒ cả hai `200`, không có dòng nào
trong `GET /api/audit` (lọc từ id cuối trước thao tác, mọi `entity`). API §10 tự ghi "thay đổi người dùng chưa ghi nhật
ký". Với tính năng phân quyền, **nâng quyền một người** (vd. thành `admin`, hay đổi sang vai trò thấy giá vốn) là thao
tác nhạy cảm nhất và hiện không truy vết được. Mong đợi: audit entity `user` (không ghi mật khẩu/băm).

## I. Còn chưa kiểm được (bổ sung)
Migration 007 trên dữ liệu NFD có sẵn và mật khẩu NFD lưu trước migration; audit của thao tác người dùng ngoài tạo/đổi vai
trò (khóa tài khoản, đổi mật khẩu) — cùng nguyên nhân M-12.

---

# VÒNG 3 — ĐỢT M3 (C9–C13) + kiểm lại M-11, M-12 (binary 15/11/2026 09:13)

Hai vòng trên giữ nguyên làm lịch sử. Tệp mới: `mr_m3_c9.py` (kiểm kê), `mr_m3_c10.py` (quy đổi đơn vị),
`mr_m3_c11.py` (thuế GTGT), `mr_m3_c12.py` (mẫu in, logo, HTTPS, nhật ký người dùng), `mr_m3_cross.py` (kết hợp).
`run_mr.sh` thêm cổng `18396` cho máy chủ HTTPS thứ hai (C13) và truyền `MR_DATABASE_URL`.

## A. Số liệu (`./run_mr.sh` 2 lần, giống nhau)

| Pha | Test | PASS | FAIL | Check | Check lỗi | HTTP 5xx | panic |
|---|---|---|---|---|---|---|---|
| Bản mở rộng (11 tính năng bật) | 136 | 132 | 4 | ≈4.811 | 7 | **0** | 0 |
| Bản chuẩn | 6 | 6 | 0 | 145 | 0 | **0** | 0 |

Theo tính năng: C1 23/23 · C3 22/22 · C4 10/10 · C5 5/5 · C6 6/6 · C7 13/13 · C8 16/16 · **C9 7/8 · C10 4/6 · C11 6/7** ·
C12 3/3 · C13 1/1 · F 8/8 · G 8/8.

Bộ QA bản chuẩn cũ (45 test) chạy từ bản sao, cổng 18394:
- bản chuẩn (không `KHO_EDITION`): **45/45 PASS**, 16.765 check, 0 × 5xx;
- `KHO_EDITION=extended` (mọi tính năng bật): **44/45** — khác biệt duy nhất là **hợp lệ**: `test_REQ047_083_customer_sale_slip_example`
  (biến thể 2) lập phiếu bán không gửi đơn giá cho khách đã mua K701832 giá 1.000.000 ngày 10/08 ⇒ C6 tự điền "giá bán
  gần nhất cho khách" 1.000.000 thay vì giá mặc định 1.090.000 (đúng SPEC C6). Không có khác biệt nào khác (thuế mặc định
  chung = không thuế, đơn vị gốc, không kiểm kê) ⇒ không thấy hồi quy hành vi bản chuẩn.

Test cập nhật vì mọi khóa đều "có sẵn" (Q14): `test_F_defaults_extended_edition` (11 khóa bật, `UNAVAILABLE = []`),
`test_F_unknown_unavailable_and_garbage_keys` (dùng khóa lạ thay khóa "chưa làm", và tự bật lại mọi tính năng — trước đây
để lại `min_stock` tắt làm `test_F_switch_off…` đỏ dây chuyền), `test_F_switch_off_hides…` (hết đỏ khi test trước dọn
dẹp), `test_BASE_admin_can_switch…` (khóa lạ; `finally` tắt lại **cả 11** khóa), `test_BASE_audit_endpoint_admin_only`
(so `features` của `/auth/login` với `/api/features` hiện hành, không giả định "tất cả tắt") ⇒ các test pha bản chuẩn
không phụ thuộc thứ tự / tác dụng phụ của nhau.

## B. Kết luận M-11, M-12

| Lỗi | Kết luận | Đã kiểm |
|---|---|---|
| M-11 | **Đã sửa** | `/audit?from>to` ⇒ 400; `from = to` ⇒ 200. |
| M-12 | **Đã sửa** | entity `user`: `created`, `role_changed` (trước/sau `banhang`→`muahang`), `deactivated`, `activated`, `password_reset` (quản trị đặt lại), `password_changed` (người dùng tự đổi, `user_id` = chính họ), `updated`. Không có mật khẩu, không có chuỗi băm `$2a$/$2b$`, không có `password_hash`; các khóa chứa "password" chỉ là cờ boolean. |

## C. Lỗi mới

### M-13 — Thấp — BUG (C9): phiếu kiểm kê nhận im lặng `to_warehouse_id`
`POST /api/documents {"doc_type":"stocktake","warehouse_id":1,"to_warehouse_id":2,"lines":[{"product_id":…,"qty":12}]}`
→ `201`, trường bị bỏ qua (phiếu chỉ ảnh hưởng kho 1). Phiếu tồn đầu / chuyển kho gửi trường không thuộc loại phiếu ⇒ 400
(QUYET_DINH B6 "không âm thầm bỏ qua"); kiểm kê "một kho" nên cũng phải 400.

### M-14 — Trung bình — BUG/USABILITY (C10): hệ số < 1 làm "trôi" tồn — bán lẻ từng đơn vị không hết được một thùng
Đơn vị gốc `Thùng`, đơn vị `Lon` hệ số 0,041667 (1/24 làm tròn 6 chữ số). Nhập 1 Thùng, bán 24 phiếu mỗi phiếu 1 Lon:
mỗi phiếu ghi sổ `round(0,041667; 3) = 0,042` Thùng ⇒ sau 23 phiếu đã trừ 0,966, còn 0,034 < 0,042 ⇒ **phiếu thứ 24 bị
`422 INSUFFICIENT_STOCK`** dù lon cuối cùng vẫn còn trên kệ; tồn kho "kẹt" 0,034 Thùng mãi mãi (bán 24 Lon trong **một**
dòng thì đúng: 1,000). Tương tự mọi hệ số không biểu diễn hết bằng 3 chữ số thập phân. QUYET_DINH Q2 hứa "không trôi số"
nhưng chỉ đúng khi hệ số ≥ 1. Đề nghị: cấm hệ số < 1 (yêu cầu đơn vị gốc là đơn vị nhỏ nhất — thường gặp ở Việt Nam:
Lon/Chai/Cái), hoặc lưu `base_qty` đủ chính xác (hệ số dạng phân số), hoặc ít nhất cảnh báo khi khai báo.

### M-15 — Trung bình/Cao — BUG (C10 + §0): tắt quy đổi rồi lưu lại phiếu (máy khách không gửi id dòng) làm đổi số lượng đã ghi sổ
Phiếu bán đã ghi sổ 1 `Thùng` (= 24 Lon, hệ số 24). Tắt `unit_conversion`. `PUT /api/documents/{id}` chỉ đổi ghi chú,
gửi lại đúng các dòng (kể cả `"unit":"Thùng"`) nhưng **không có `id` dòng** (được phép theo API §3.4 — bộ QA bản chuẩn
và mọi máy khách cũ làm vậy) ⇒ `200`, dòng nhận hệ số **1** ⇒ phiếu chỉ còn xuất 1 Lon; **tồn tăng 23 Lon** (471 → 494),
thẻ kho, lãi gộp thay đổi — chỉ vì sửa một ghi chú. Gửi kèm `id` thì giữ đúng (đã kiểm). SPEC §0: tắt tính năng "không
đổi số liệu đã ghi sổ". Đề nghị: khi tắt, dòng không `id` mà mặt hàng + đơn vị trùng một dòng cũ hệ số ≠ 1 ⇒ giữ hệ số
(hoặc từ chối 400 "phiếu có dòng quy đổi, hãy bật lại tính năng"), như cách giữ thuế suất ở Q8.

### M-16 — Trung bình/Cao — BUG (C11 + §0): tắt thuế rồi lưu lại phiếu (không id dòng) làm mất thuế đã ghi sổ ⇒ đổi công nợ
Phiếu bán đã ghi sổ 2 × 100, thuế 10% ⇒ tổng thanh toán 220. Tắt `vat`. `PUT` chỉ đổi ghi chú, các dòng không `id`
(và không `vat_rate`) ⇒ `200`, tổng **200**, phải thu của khách **220 → 200**. Gửi kèm `id` thì giữ thuế (đạt; gửi thuế
suất khác khi tắt ⇒ 400 đạt). Cùng nguyên nhân với M-15. (Chưa kiểm: khi **bật** thuế, máy khách cũ không gửi `id` cũng
nhận thuế suất mặc định hiện hành thay vì thuế suất đã lưu — theo chữ API "dòng mới ⇒ mặc định"; nên xem cùng lúc.)

## D. Tính năng M3 — những gì đã tấn công và **đạt**

**C9 kiểm kê** (tính tay): tồn sổ sách cuối ngày gồm cả phiếu cùng ngày ghi sổ **sau** phiếu kiểm (7 → 6), tính lại khi
ghi sổ, lưu `book_qty`; thừa/thiếu sinh đúng bút toán nhập/xuất, thẻ kho "Kiểm kê thừa" / "Kiểm kê thiếu"; dòng không
chênh không có bút toán; SL thực tế 0 được; số `KK00001`; bỏ ghi sổ khôi phục tồn, giữ số. Phiếu mua **lùi ngày** sau khi
kiểm ⇒ `book_changed`, `current_book_qty` 11, `book_changed_lines` 1, điều chỉnh giữ +3. R6: kiểm kê thiếu làm phiếu bán
sau âm ⇒ 422; bỏ ghi sổ / hạ SL / dời ngày phiếu kiểm thừa mà phiếu bán sau cần ⇒ 422. Kiểm tra dữ liệu: đơn giá, thuế
suất, đối tác, trùng mã, dòng DV, SL âm/thiếu/chữ, không kho ⇒ 400; ghi sổ phiếu rỗng ⇒ 400. `stocktake-load` đúng tồn
theo kho/ngày, bỏ DV, tham số sai ⇒ 400/404. Quyền: `banhang` 403, `thukho` lập + ghi sổ, sửa phiếu đã ghi sổ ⇒ 403
(thiếu `posted.edit`); khóa sổ ⇒ 422 cả tạo/sửa/bỏ ghi sổ; không có trong báo cáo mua/bán/công nợ, có trong NXT; file
xlsx/docx "BIÊN BẢN KIỂM KÊ KHO" với cột Tồn sổ sách / Thực tế / Chênh lệch là ô số, không có cột giá. Lãi gộp: thừa vào
theo bình quân (giá vốn bán sau 60), thiếu ra theo bình quân (15), phiếu kiểm không có dòng lãi; hàng chỉ có từ kiểm kê
thừa ⇒ giá mua mặc định 70. Đơn vị trên dòng (2 Thùng ⇒ thực tế 48 gốc). **Đồng thời**: 5 vòng ghi sổ kiểm kê và phiếu
bán cùng ngày cùng mã — cả hai luôn ghi được và luôn thỏa đẳng thức tồn cuối ngày = tồn sổ hiện tại + chênh lệch. Tắt
tính năng: phiếu cũ vẫn tính tồn; tạo / lọc `type=stocktake` ⇒ 400; sửa / ghi sổ phiếu cũ ⇒ 404 FEATURE_OFF; bỏ ghi sổ
/ xóa được.

**C10 quy đổi**: kiểm tra `PUT units` (hệ số 0/âm/7 chữ số/≥10⁹/chữ/thiếu, trùng đơn vị gốc kể cả hoa thường và khoảng
trắng, trùng nhau, rỗng, NUL ⇒ 400); `IN_USE` khi bỏ / đổi hệ số đơn vị đã dùng; dòng gõ tay "Hộp" hệ số 1 (lúc tắt)
không khóa đơn vị Hộp 50 (Q4); đổi đơn vị gốc khi đã có dòng quy đổi ⇒ 400. Dòng: đơn vị không phân biệt hoa thường, lưu
tên khai báo; đơn vị lạ ⇒ 400; `base_qty` 3 Vỉ × 0,333333 = 1,000, 1 Vỉ = 0,333, 0,4 Gram × 0,001 ⇒ 0 ⇒ 400; biên tồn:
2 Thùng = 48 Lon ghi được, 2,001 Thùng ⇒ 422 thiếu 0,024 **Lon**; thẻ kho theo đơn vị gốc, đơn giá / hệ số. Giá: mặc
định × hệ số (1234,56 × 24 = 29.629,44; × 0,333333 = 411,52), giá riêng khách theo gốc × hệ số (21.600 / 5.400), giá bán
gần nhất cùng đơn vị đúng 25.001, đơn vị khác 6.250,25, gốc 1.041,71; `sale-price` trả giá gốc. Cảnh báo lỗ theo gốc
(3.500/6 = 583,33 < 600 lỗ; 3.600/6 = 600 không lỗ; `cost_price` 3.600). Báo cáo bán giữ đơn vị + `base_qty`, `total_qty`
theo gốc (51); lãi gộp 51 × 600. Máy khách cũ: `id` + không `unit` / `unit` khác hoa ⇒ giữ Thùng 24; không `id` ⇒ đơn vị
gốc. Tắt: `units` 404, đơn vị chữ tự do hệ số 1, dòng cũ giữ hệ số. Nhập Excel `product_units` (đạt, kể cả "2.5" ⇒ lỗi
theo P6, trùng hoa thường, hệ số 0). Chuyển kho 3 Cuộn = 300 Mét.

**C11 thuế** (tính tay): thuế từng dòng làm tròn nửa xa 0 (15@10% = 2; 25@10% = 3; DV −25@10% = −3; 30@5% = 2;
300@8% = 24; 0% = 0; KCT = null) ⇒ hàng 545, thuế 28, tổng 573, "Năm trăm bảy mươi ba đồng"; xlsx có cột Thuế suất,
Tiền thuế, 3 dòng tổng là ô số; docx đủ. Mặc định: mặt hàng 8 / KCT / mặc định chung 10 / gửi tay 5; mặc định chung KCT;
`ketoan` không đặt được (403); 9 ⇒ 400; thuế suất trên chuyển kho / tồn đầu / kiểm kê ⇒ 400; 7, "abc", −10, 100 ⇒ 400.
Công nợ theo tổng thanh toán cả hai phía và khi trả hàng (1.100 − 110 = 990; 231 − 116 = 115); Nợ cũ / Tổng nợ 115 / 231;
hạn mức dùng tổng thanh toán (`document_amount` 116, vượt 1); cảnh báo lỗ và lãi gộp trước thuế (bán 105 so với giá vốn
100 không lỗ); báo cáo bán có `total_tax`, `total_with_tax`, `vat_summary`; `vat-summary` khớp cộng tay từng thuế suất
(bán − khách trả), mua vào 154 @8% = 12; `banhang` không thấy phần mua vào (null) và các trường thuế của phiếu mua bị che
(cả file xuất); `thukho` 403. Bật/tắt/bật thuế: sổ công nợ, tổng hợp công nợ, tuổi nợ, tồn, lãi gộp, báo cáo mua/bán,
dashboard **không đổi** (so JSON); thuế cũ không tính lại khi bật lại; khi tắt: phiếu cũ vẫn hiện thuế, phiếu mới không
có trường thuế, lưu lại có `id` giữ thuế, gửi thuế suất khác ⇒ 400, `vat-summary` / `settings/vat` ⇒ 404.

**C12 mẫu in**: lưu/đọc đủ trường; chân trang 300 ký tự tiếng Việt được, 301 ⇒ 400; A3, 0 / 7 ô ký, tên 61 ký tự, khóa
loại phiếu lạ, kiểu sai, NUL ⇒ 400; `ketoan` PUT ⇒ 403; có audit `print_template`. Logo: PNG thô, multipart, JPG ⇒ 200 và
tải về đúng từng byte, `nosniff`, `image/*`; ai đăng nhập cũng tải được, ẩn danh 401, `ketoan` tải lên 403; **từ chối**
PNG > 500 KB, PNG + rác cuối tệp, 4001 × 1, 1 × 4001, PNG khai 30000 × 30000 (dạng bom giải nén — không treo, không 5xx),
SVG có script (kể cả gửi kiểu image/png), đa định dạng PNG/HTML, GIF, 0 byte, chữ — logo cũ giữ nguyên; 4000 × 1 nhận
(giới hạn bao gồm); xóa ⇒ 404. File xuất **9 loại** (6 phiếu kho + kiểm kê + phiếu thu + phiếu chi) × xlsx/docx: đúng tên
ô ký riêng, chân trang đứng trước "Xuất file lúc", ẩn cột ĐVT / Mã hàng; tắt tính năng ⇒ file **giống hệt** khi chưa đặt
mẫu (so nội dung trừ giờ xuất); xóa mẫu ⇒ giống như chưa từng đặt.

**C13 HTTPS** (chứng thư tự ký tạo bằng openssl, máy chủ riêng cổng 18396): health và đăng nhập qua HTTPS; cookie
`Secure; HttpOnly`; phiên dùng được; HTTP thường vào cổng HTTPS ⇒ 400 gọn (không treo); TLS ≤ 1.1 bị từ chối (hoặc máy
khách không hỗ trợ); chỉ `TLS_CERT`, chỉ `TLS_KEY`, chứng thư/khóa không khớp, file không tồn tại, file rác ⇒ tiến trình
thoát mã ≠ 0 kèm thông báo tiếng Việt "Không bật được HTTPS: …".

**Kết hợp** (tính tay): một phiếu bán có đơn vị Thùng + thuế 10% + DV chiết khấu có thuế + giá riêng khách + hạn mức +
dòng lỗ ⇒ giá 21.600 / 550 / −1.000; thuế 2.160 / 110 / −100; tổng 23.870; `CREDIT_WARNING` nợ 5.000 + 23.870 = 28.870,
vượt 870, kèm dòng lỗ (giá vốn 600/Lon); xác nhận cả hai ⇒ ghi sổ; tồn 98; lãi gộp doanh thu 21.700, giá vốn 15.600; lưu
lại theo `id` không gửi `unit`/`vat_rate` giữ đơn vị và thuế. Nhập tồn đầu Excel → ghi sổ → `stocktake-load` thấy 10 →
kiểm kê 8 ⇒ tồn 8.

## E. Quyết định đáng xem lại (M3)

| # | Điểm | Ý kiến |
|---|---|---|
| Q-15 | Q7 — lỗ / lãi gộp / doanh thu dùng tiền **trước thuế**, giá vốn từ phiếu mua trước thuế | Đúng cho doanh nghiệp khấu trừ; sai cho hộ / DN tính thuế **trực tiếp** (thuế đầu vào là giá vốn). Cần khách xác nhận (bên xây dựng cũng nêu). |
| Q-16 | Q3 — giá riêng của khách chỉ theo đơn vị gốc | Không thể "Thùng rẻ hơn 24 Lon". Cần khách xác nhận. |
| Q-17 | Q5 — dòng không phân biệt "KCT" và "không kê khai" | Bảng kê thuế gộp "Không thuế / KCT"; nếu cần lập tờ khai thì thiếu. |
| Q-18 | Q10 — hàng chỉ có từ kiểm kê thừa (chưa từng nhập) | Giá vốn theo giá mua mặc định, cờ `estimated: true` — hợp lý, nên hiện trên màn hình. |
| Q-19 | Q12 — logo không vào file xlsx/docx | Đúng chữ spec ("áp cho bản in"); khách có thể mong logo trên file gửi đi. |
| Q-20 | M-14 / Q2 | Nên quy định đơn vị gốc là đơn vị nhỏ nhất. |

## F. Không kiểm được / giới hạn (M3)
Bản in trên giao diện (khổ A4/A5, logo trên trang in) — chỉ kiểm được file xuất; nâng cấp CSDL M2 → M3 có dữ liệu sẵn
(test luôn dùng CSDL mới); TLS 1.0/1.1 phụ thuộc OpenSSL của máy kiểm (có thể chính máy khách từ chối); chứng thư hết hạn;
hành vi "bật thuế + máy khách không gửi id" (xem M-16); hiệu năng M3 ở quy mô lớn.

---

# VÒNG 4 — kiểm lại M-13…M-16 theo quy tắc mới (commit `3ea062c`, binary 09:35)

Quy tắc mới (API §11 đầu mục, QUYET_DINH Q17–Q19): `to_warehouse_id` chỉ trên chuyển kho; hệ số quy đổi ≥ 1 và
`SL × hệ số` phải đúng tới 3 chữ số (không làm tròn); PUT mà **mọi** dòng không có `id` trên phiếu có dòng mang hệ số ≠ 1 /
thuế suất / giá bị che ⇒ ghép theo vị trí khi cùng dãy mặt hàng, khác ⇒ `400 LINE_IDS_REQUIRED`. Tệp mới `mr_r4.py`;
`mr_m3_c10.py` đổi dữ liệu (Lon/Thùng 24, Gram/Kg 1000, Két 2,5 / 20,5 thay cho các hệ số < 1), kỳ vọng "không id ⇒ đơn
vị gốc" đổi thành "giữ đơn vị đang lưu".

## A. Số liệu (`./run_mr.sh` 2 lần, giống nhau)

| Pha | Test | PASS | FAIL | Check | Check lỗi | HTTP 5xx | panic |
|---|---|---|---|---|---|---|---|
| Bản mở rộng | 143 | 141 | 2 | ≈4.951 | 4 | **0** | 0 |
| Bản chuẩn | 6 | 6 | 0 | 145 | 0 | **0** | 0 |

Bộ QA bản chuẩn 45 test: bản chuẩn **45/45** (16.785 check, 0 × 5xx); `KHO_EDITION=extended` **44/45** — vẫn chỉ khác biệt
hợp lệ của C6 (giá bán gần nhất cho khách 1.000.000 thay giá mặc định 1.090.000), như vòng 3.

## B. Kết luận

| Lỗi | Kết luận | Đã kiểm |
|---|---|---|
| M-13 | **Đã sửa** | `to_warehouse_id` khác null trên bán, khách trả, mua, trả NCC, tồn đầu, kiểm kê ⇒ 400 (cả POST và PUT thêm vào); `null` ⇒ 201; chuyển kho bình thường. |
| M-14 | **Đã sửa** | Hệ số 0,5 / 0,999999 ⇒ 400, 1,000001 / 999.999.999 nhận, nhập Excel "0,01" ⇒ lỗi dòng; dòng: 0,5 Kg = 500 g, 0,001 Kg = 1 g, 0,125 Kg = 125 g, 0,002 Gói (20,5) = 0,041, 3 Gói = 61,5 ⇒ nhận và `base_qty = qty × hệ số` chính xác; 0,001 / 0,333 Gói, 0,333 Két (2,5) ⇒ 400 có thông báo tiếng Việt; 12 phiếu × 0,125 Kg làm hết đúng 1.500 g; 24 phiếu × 1 Lon hết đúng 1 Thùng, Lon thứ 25 ⇒ 422; trả hàng / chuyển kho / kiểm kê theo đơn vị (0,25 Kg; 0,1 Kg = 100 g; 0,2 Kg = 200 g) đạt, 0,001 Gói trên kiểm kê ⇒ 400. Ghi chú: SL nhập 4 chữ số (`1.0005` Kg, `0.0417` Thùng) vẫn bị làm tròn 3 chữ số **trước** (quy tắc B12 bản chuẩn) rồi mới quy đổi đúng — không phải lỗi mới. Không kiểm được "dòng cũ không kiểm lại" vì không còn cách tạo dòng hệ số < 1 qua API. |
| M-15 | **Đã sửa** (trường hợp mọi dòng không id) | Phiếu đã ghi sổ [P 2 Thùng 10%, Q 3 Cái, P 5 Lon]: lưu lại chỉ đổi ghi chú, không id, không `vat_rate`, ở **4 tổ hợp** bật/tắt `vat` × `unit_conversion` ⇒ 200, đơn vị / hệ số / thuế giữ theo vị trí; tồn, sổ công nợ (từng dòng), báo cáo mua/bán, lãi gộp, NXT, bảng kê thuế **không đổi**. Đảo thứ tự / bỏ dòng / thêm dòng / đổi mặt hàng một vị trí ⇒ `400 LINE_IDS_REQUIRED`, thông báo tiếng Việt, **version và dòng không đổi**. Có id thì đảo / bỏ dòng thoải mái và giữ trường. Kiểm kê có dòng Thùng lưu lại không id ⇒ giữ 96. Phiếu thường (không hệ số / thuế / giá che) giữ hành vi cũ (dòng không id = dòng mới, đổi thứ tự được). |
| M-16 | **Đã sửa** (trường hợp mọi dòng không id) | Thuế 10% gửi tay trên mặt hàng không có thuế mặc định, máy khách cũ lưu lại khi **bật** thuế ⇒ giữ 10%, tổng 220, công nợ 220; đổi thuế mặc định mặt hàng sang 5% rồi lưu lại ⇒ vẫn 10%. Người bị che giá (`thukho` có `purchase.write`) lưu phiếu tạm mua không id cùng dãy ⇒ giữ 5.555 / 6.666; đảo / bỏ dòng ⇒ 400, giá giữ nguyên. |

## C. Lỗi mới

### M-17 — Trung bình — BUG (M-15/M-16 chưa kín): body **trộn** — dòng có id và dòng không id — làm mất thuế (và giá che / hệ số) của dòng không id
Phiếu đã ghi sổ [P 2 Thùng × 24.000 thuế 10%, Q 3 × 500, P 5 Lon × 1.000] = 59.300. PUT chỉ đổi ghi chú, dòng Q gửi kèm
`id`, hai dòng P **không** `id` (có `unit`, không `vat_rate`) ⇒ `200`; dòng Thùng mất thuế suất ⇒ tổng **54.500**, phải thu
của khách giảm 4.800 — chỉ vì sửa ghi chú. Quy tắc Q19 chỉ áp dụng khi **mọi** dòng không id; một giao diện ghép xung đột
(hoặc máy khách gửi id cho dòng nó biết, bỏ id dòng nó vừa chép) rơi đúng vào kẽ hở này. Nếu không gửi `unit` thì hệ số
cũng mất; với người bị che giá thì giá cũng mất theo đúng cách đó. Đề nghị: dòng không id trong body có id lẫn lộn mà
phiếu có dữ liệu "có thể mất" ⇒ cũng `400 LINE_IDS_REQUIRED`, hoặc ghép các dòng không id vào các dòng cũ chưa được
nhận theo vị trí / mặt hàng.

### M-18 — Thấp/Trung bình — BUG: ghép theo vị trí bỏ qua đơn vị gửi lên ⇒ thuế "nhảy" sang dòng khác
Phiếu tạm [P 2 Thùng × 24.000 thuế 10%, Q, P 5 Lon × 1.000]. Máy khách cũ gửi lại không id theo thứ tự **đảo ngược**
[P 5 Lon, Q, P 2 Thùng] (cùng dãy mặt hàng P, Q, P) ⇒ `200`; ghép theo vị trí giữ thuế 10% ở **vị trí 1** — nay là dòng
5 Lon × 1.000 — còn dòng 2 Thùng mất thuế: tiền thuế 4.800 → 500, tổng phiếu đổi, không báo gì. Đơn vị gửi lên ở mọi vị trí
đều khác đơn vị đang lưu nên máy chủ có đủ thông tin để nhận ra đây không phải "cùng dòng". Đề nghị: khi ghép theo vị
trí, đơn vị (nếu gửi) phải trùng đơn vị đang lưu, khác ⇒ `400 LINE_IDS_REQUIRED`.

## D. Còn chưa kiểm được
Dòng hệ số < 1 tạo trước bản sửa (không còn tạo được qua API) — "không kiểm lại dòng cũ không đổi" chỉ kiểm được với dòng
hợp lệ.

---

# VÒNG 5 — tấn công quy tắc id dòng hợp nhất (API §11 bảng quyết định, QUYET_DINH Q20; commit `0df2f98`, binary 09:52)

Tệp mới `mr_r5.py`. Phiếu mẫu (đã ghi sổ và phiếu tạm): [P 2 Thùng × 24.000 thuế 10% · Q 3 × 500 · P 5 Lon × 1.000 · DV "Phí"
100 thuế 10%] = hàng 54.600, thuế 4.810, tổng 59.410. Mỗi lần lưu "không chủ ý" phải hoặc `400 LINE_IDS_REQUIRED` và phiếu
y nguyên, hoặc 200 với tổng / thuế / tồn / công nợ không đổi.

## A. Số liệu (`./run_mr.sh` 2 lần, giống nhau)
Bản mở rộng **148 test, 147 PASS, 1 FAIL** (≈5.073 check, 12 check lỗi — đều là M-19, M-20 ở cả phiếu ghi sổ và phiếu
tạm), 0 × 5xx; bản chuẩn 6/6. Bộ QA bản chuẩn 45 test: bản chuẩn 45/45; `extended` 44/45 (vẫn chỉ khác biệt hợp lệ C6).

## B. Đạt
- Dòng không id cùng mặt hàng gọi bằng `product_code` (chữ thường) thay `product_id`, dòng DV có thuế gửi lại qua bí danh
  `DICHVU`, `id` của dòng **phiếu khác** trên dòng đặc biệt, thiếu khóa ⇒ `400 LINE_IDS_REQUIRED`, phiếu y nguyên.
- Kiểu sai: `id` dạng chuỗi / 1,5, `unit: 123` / `[]`, `vat_rate: true` ⇒ 400 VALIDATION, không ghi; `vat_rate: "10"` (chuỗi
  số) nhận như số; `id: -1` coi như id lạ (dòng mới, khóa đầy đủ) — không đổi số.
- Phiên bản cũ + body sai hình dạng ⇒ **409 VERSION_CONFLICT** (thắng LINE_IDS_REQUIRED); 3 vòng ba lần lưu đồng thời
  cùng version (hai body hợp lệ + một body sai) ⇒ đúng một 200, version +1, tổng y nguyên, không 5xx.
- Máy khách hiện đại (id trên dòng cũ, khóa tường minh trên dòng mới): đảo / bỏ / thêm dòng, đổi đơn vị hay bỏ thuế tường
  minh trên dòng có id, hoán đổi hai dòng cùng mặt hàng khác đơn vị theo id ⇒ luôn 200, trường đúng như gửi, tổng tính lại
  đúng (53.600 / 4.835 / 58.435).
- Người bị che giá: dòng không id cùng mặt hàng với dòng bỏ có giá, `"unit_price": null` ⇒ 400, giá giữ 5.555; không có
  khóa ⇒ giá mua mặc định 111; gõ 7 ⇒ 7 (đúng bảng, Q-02/Q-14); dòng mang id lạ không bao giờ thừa hưởng giá ẩn; PUT phiếu
  mua đã ghi sổ ⇒ 403.
- Kiểm kê và chuyển kho có dòng Thùng: lưu lại không id bỏ `unit` ⇒ giữ; không id với đơn vị khác ⇒ 400; tồn từng kho y
  nguyên. Nạp phiếu khi tính năng bật, tắt `vat` + `unit_conversion` rồi lưu (cùng giá trị, có id) ⇒ 200, tổng giữ; thêm
  dòng mới có thuế suất khi `vat` tắt ⇒ 400, phiếu y nguyên.

## C. Lỗi mới

### M-19 — Trung bình — BUG: cùng một `id` gửi hai lần ⇒ dòng thứ hai "thừa hưởng" đơn vị + thuế của dòng đặc biệt
Body (phiếu ghi sổ hoặc tạm): dòng 1 = P Thùng với `id` của nó (khóa đầy đủ); dòng 3 (P 5 × 1.000, vốn là **Lon**) gửi kèm
**cùng `id` của dòng Thùng**, không có `unit` / `vat_rate`; `id` dòng Lon không được nhắc. API §3.4: lần xuất hiện thứ hai
của một id ⇒ dòng mới (mặc định: đơn vị gốc, thuế mặc định). Thực tế `200`, dòng đó thành **5 Thùng** thuế 10% ⇒ xuất thêm
115 Lon (tồn 947 → 832), thuế 4.810 → 5.310, tổng và phải thu 59.410 → 59.910 — không ai yêu cầu đổi đơn vị hay thuế.
Đề nghị: lần xuất hiện thứ hai của id xử lý như dòng không id (áp cùng kiểm tra "bỏ dòng đặc biệt / thiếu khóa" ⇒ 400), không
sao chép trường từ dòng mang id đó.

### M-20 — Trung bình — BUG: hoán đổi id giữa hai mặt hàng khác nhau lọt qua quy tắc
Body: dòng P Thùng mang **id của dòng Q**, dòng Q mang **id của dòng P Thùng**, cả hai không gửi `unit` / `vat_rate`. Vì
id dòng đặc biệt "có được nhắc" nên không kiểm tra; nhưng id đó đi kèm **mặt hàng khác** (đổi mặt hàng ⇒ dòng mới, Q-02).
Kết quả `200`: 2 Thùng thành **2 Lon** không thuế ⇒ tồn P 947 → 993 (+46), thuế 4.810 → 10, tổng / phải thu 59.410 →
54.610. Đề nghị: id đi kèm mặt hàng khác với dòng đang lưu được coi là "không nhắc tới" dòng đó (dòng đặc biệt bị bỏ ⇒ áp
kiểm tra thiếu khóa ⇒ 400).

## D. Đáng xem lại (đúng bảng quyết định)
- Q-21: `"unit": null` / `"vat_rate": null` là "khóa có mặt" ⇒ ý người dùng: dòng thay thế không id nhận đơn vị gốc và bỏ
  thuế (tổng 59.410 → 54.610); ghép theo vị trí với `vat_rate: null` ở mọi dòng bỏ hết thuế (→ 54.600). Đúng chữ bảng; rủi
  ro với máy khách tự điền `null` cho mọi khóa không biết. Có thể chấp nhận nếu chỉ giao diện mới gửi các khóa này.
