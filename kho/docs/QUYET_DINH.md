# QUYẾT ĐỊNH KỸ THUẬT — chỗ lệch hoặc diễn giải SPEC

Các điểm dưới đây là nơi backend **lệch khỏi** `docs/SPEC.md` hoặc phải **tự diễn giải** vì SPEC chưa nói rõ.
Nguyên tắc chọn: phục vụ đúng file yêu cầu của khách (`docs/yeu-cau/YEU_CAU_PHAN_MEM.txt`), số tồn/công nợ không thể lệch,
người dùng không rành công nghệ vẫn dùng được. Điểm đánh dấu **(cần khách xác nhận)** nên hỏi lại khi UAT.

## A. Lược đồ dữ liệu

| # | Quyết định | Lý do |
|---|---|---|
| A1 | `product_groups` có thêm cột `active` (SPEC không có). | Mọi danh mục dùng chung bộ lọc `active` (SPEC §4); ngừng dùng nhóm thay vì xóa. |
| A2 | `products` và `partners` có thêm cột `search_key` (mã + tên đã bỏ dấu, chữ thường; đối tác thêm điện thoại, MST). | Tìm "que han", "vinh phong", "dong" ra "Que hàn", "VĨNH PHONG", "Đông" — người dùng hay gõ không dấu. Không dùng extension `unaccent` vì cần quyền superuser. |
| A3 | Mã (`code`) và tên đăng nhập **duy nhất không phân biệt hoa thường** (unique index trên `upper()/lower()`). | `/products/lookup` tra không phân biệt hoa thường (SPEC) ⇒ `k701832` và `K701832` không được là hai mã. |
| A4 | `document_lines`/`stock_movements` xóa theo chứng từ (`CASCADE`). `cash_voucher_lines.document_id` **`ON DELETE RESTRICT`** (migration 002; trước đây `SET NULL`): xóa phiếu tạm đang được phiếu thu/chi tham chiếu ⇒ `409 IN_USE` nêu số phiếu thu/chi. Bỏ ghi sổ phiếu đó vẫn được. | Quyết định Q2 của controller: không âm thầm gỡ liên kết làm phiếu thu "treo". |
| A6 | Hàm SQL `kho_fold(text)` (migration 002) = chữ thường + bỏ dấu tiếng Việt bằng `translate` (không phụ thuộc locale máy chủ CSDL). Dùng cho tìm kiếm ghi chú chứng từ, phiếu thu chi (ghi chú, diễn giải dòng), kho, nhóm VTHH, tài khoản tiền. Mặt hàng/đối tác vẫn dùng cột `search_key`. | Quyết định Q3: tìm không dấu nhất quán ở mọi danh sách. |
| A5 | Bảng `schema_migrations` để chạy migration nhúng đúng một lần; migration & seed có advisory lock. | Nhiều tiến trình khởi động cùng lúc không chạy trùng. |

## B. Chứng từ, phiếu tạm, ghi sổ

| # | Quyết định | Lý do |
|---|---|---|
| B1 | **Bỏ ghi sổ giữ nguyên số chính thức** (`doc_no`); ghi sổ lại dùng lại số đó. Nếu sau đó xóa phiếu tạm thì dãy số có lỗ hổng. | SPEC: "số chứng từ chính thức không đổi khi sửa". Bỏ ghi sổ để sửa rồi ghi lại là một dạng sửa. |
| B2 | **Phiếu tạm luôn in/xuất được**, tiêu đề "PHIẾU TẠM (chưa ghi sổ)" + phụ đề loại phiếu. "Chặn in khi tồn = 0" (REQ-032) được hiểu là: phiếu **chính thức** chỉ in được khi đã ghi sổ, mà hết tồn thì không ghi sổ được. | Khách cần gửi phiếu tạm cho khách hàng xem kể cả khi chưa có hàng (yêu cầu gốc mục "BÁN HÀNG 3"), đồng thời không được in phiếu chính thức khi hết tồn. **(cần khách xác nhận)** |
| B3 | Đơn giá bỏ trống ở dòng hàng hóa ⇒ server tự điền: bán & khách trả hàng ⇒ `sale_price`; mua, trả NCC, tồn đầu ⇒ `purchase_price`; chuyển kho ⇒ để `null` (thành tiền 0). | REQ-026 "đơn giá mặc định nhảy theo đơn giá đã nhập"; frontend vẫn nên điền sẵn từ `price-info` để kế toán thấy và sửa. |
| B4 | Phiếu tạm được phép **không có dòng nào**; ghi sổ yêu cầu ≥ 1 dòng; phiếu đã ghi sổ khi sửa phải còn ≥ 1 dòng. | Máy 1 có thể mở phiếu trước khi khách đọc hàng. |
| B5 | `doc_date` / `voucher_date` **bỏ trống** (không gửi, `null`, `""`) ⇒ hôm nay (giờ VN). Ngày đã gửi không bao giờ bị thay thế: phải trong khoảng năm 2000–2100, ngoài khoảng (kể cả `0001-01-01`) ⇒ 400. Tham số lọc báo cáo (`from`, `to`, `as_of`) nhận mọi ngày hợp lệ đúng như gửi. | Tránh lỗi gõ năm; sửa lỗi B3 (trước đây `0001-01-01` bị coi là "trống"). |
| B11 | Ký tự NUL (`\u0000` trong JSON, `%00` trong tham số truy vấn) bị chặn tập trung ở lớp HTTP ⇒ `400 VALIDATION`. | PostgreSQL không lưu được NUL trong TEXT; trước đây trả 500 (lỗi B1). |
| B12 | Số lượng, đơn giá, số tiền được **làm tròn trước** (SL 3, tiền 2 chữ số) rồi mới kiểm tra `> 0`; giá trị tròn về 0 ⇒ 400, không lưu âm thầm thành 0. | Lỗi B4. |
| B6 | Phiếu chuyển kho / tồn đầu gửi kèm `partner_id` ⇒ **400** (không âm thầm bỏ qua). | Tránh hiểu nhầm là có công nợ. |
| B7 | Kho / đối tác / mặt hàng đã **ngừng sử dụng** không dùng được cho **phiếu mới**; phiếu cũ đang tham chiếu vẫn sửa, ghi sổ được. Tương tự, cờ Khách hàng / NCC của đối tác chỉ kiểm tra khi **đặt hoặc đổi** đối tác trên phiếu: phiếu cũ giữ nguyên đối tác vẫn sửa/ghi sổ được dù đối tác đã đổi cờ. | Sửa chứng từ quá khứ (R3) không được bị chặn vì danh mục đã đổi (lỗi B2). |
| B8 | Không đổi được `doc_type` khi sửa. | Đổi loại = đổi dãy số, đổi chiều tồn/công nợ; muốn đổi thì xóa/lập phiếu mới. |
| B9 | Mặt hàng đã có chứng từ không đổi được tính chất hàng hóa ↔ dịch vụ; mã `DV` không đổi mã / xóa được; mã `DICHVU` dành riêng làm bí danh của `DV`. | Đổi tính chất sẽ làm lệch bút toán kho đã sinh. |
| B10 | `DELETE /documents/{id}` nhận `version` qua **query** (`?version=`), tùy chọn. | DELETE không nên có body; vẫn chống xóa nhầm khi máy khác vừa sửa. |

## C. Kiểm tra tồn (R6) và khóa

| # | Quyết định | Lý do |
|---|---|---|
| C1 | Kiểm tra tồn **cuối mỗi ngày** của mọi cặp (mặt hàng, kho) bị ảnh hưởng (bút toán cũ ∪ mới), từ ngày nhỏ nhất bị ảnh hưởng trở đi. Áp dụng cho ghi sổ, sửa phiếu đã ghi sổ (kể cả đổi ngày, đổi kho, giảm SL nhập), bỏ ghi sổ. | Đúng SPEC R6; chặn mọi đường làm âm kho trong quá khứ (sửa phiếu nhập tháng 1 khi tháng 9 đã bán). |
| C2 | Chi tiết thiếu hàng: `date` (ngày âm đầu tiên), `balance`, `shortage = −balance`, `required` (SL chứng từ này xuất), `available = balance − tác động chứng từ`, `message` tiếng Việt. Với sửa lùi phiếu nhập `required = 0` và `available` có thể âm ⇒ frontend nên hiển thị `message`. | SPEC chỉ ghi {tồn, cần, thiếu}; trường hợp sửa phiếu nhập không có "cần". |
| C3 | Chống hai máy cùng bán vượt tồn bằng `pg_advisory_xact_lock(product_id::int4, warehouse_id::int4)` theo thứ tự cố định, lấy trước khi kiểm tra; cộng `SELECT … FOR UPDATE` trên `documents`. | SPEC §5. Test `TestREQ031_HaiMayCungGhiSoTranhTon` đã được kiểm chứng: bỏ khóa thì test đỏ. Giới hạn: id > 2³¹ sẽ quấn số (chỉ làm hai cặp khác nhau dùng chung khóa — chậm hơn, không sai). |
| C4 | `/check` và cảnh báo trên phiếu: thiếu hàng **chỉ** trả qua `GET /documents/{id}/check` và lỗi 422; mảng `warnings` của Document chỉ chứa cảnh báo `loss` như SPEC. | Giữ đúng hình dạng SPEC; tính tồn tốn truy vấn, chỉ chạy khi cần. |

## D. Cảnh báo bán lỗ (R4)

| # | Quyết định | Lý do |
|---|---|---|
| D1 | "Phiếu mua gần nhất" sắp theo `doc_date` giảm dần, rồi `posted_at`, rồi `id`, rồi `line_no`. Chỉ phiếu `purchase` đã ghi sổ; không tính tồn đầu kỳ, khách trả hàng. Lần mua gần nhất có giá 0 vẫn là `last_purchase` (⇒ không cảnh báo). | SPEC R4. |
| D2 | Chỉ phiếu `sale` có cảnh báo lỗ. Lưu phiếu tạm không bao giờ cần xác nhận. Ghi sổ, và **mỗi lần sửa phiếu bán đã ghi sổ còn dòng lỗ**, đều cần `confirm_loss: true`. | SPEC: "Phiếu đã ghi sổ có dòng lỗ ⇒ cần confirm_loss". Không lưu trạng thái "đã xác nhận" để mỗi lần sửa người dùng thấy lại cảnh báo. |
| D3 | Thứ tự kiểm tra khi ghi sổ: tồn kho (422) trước, bán lỗ (409) sau. | Tránh bắt người dùng xác nhận lỗ rồi mới báo không đủ hàng. |

## E. Mã dịch vụ (R7)

| # | Quyết định | Lý do |
|---|---|---|
| E1 | Dòng dịch vụ: `qty` phải > 0 (mặc định 1); cộng/trừ tiền bằng **đơn giá dương/âm**; đơn giá `null` = dòng ghi chú, thành tiền 0, khi in để trống ô giá/thành tiền. | Đúng ví dụ của khách ("TRẢ 01 ĐỒNG HỒ", SL 1,0, giá trống). |
| E2 | Dòng dịch vụ dùng được ở `sale`, `sale_return`, `purchase`, `purchase_return`; **không** ở `transfer`, `opening`. | Phiếu mua cũng có cước xe, phí phát sinh; chuyển kho/tồn đầu không có tiền. |
| E3 | Hàng hóa không được đơn giá âm. | Chiết khấu dùng dòng dịch vụ âm. |

## F. Công nợ (R8) & thu chi (R9)

| # | Quyết định | Lý do |
|---|---|---|
| F1 | Thứ tự bút toán công nợ (cho "Nợ cũ" và số dư lũy kế): ngày, rồi thời điểm (`posted_at` của chứng từ / `created_at` của phiếu thu chi), rồi loại, rồi id. Phiếu tạm: "Nợ cũ" = số dư đến hết ngày phiếu. Bỏ ghi sổ rồi ghi lại ⇒ phiếu chuyển xuống cuối ngày đó. | SPEC R8 "theo ngày + thứ tự". |
| F2 | "Nợ cũ / Tổng nợ" có ở phiếu `sale` (phải thu) và `purchase` (phải trả); loại khác `null`. | SPEC §4 "(phiếu bán/mua)". |
| F3 | **(Thay thế quyết định cũ — quyết định Q1 của controller.)** Phiếu thu/chi có cột `debt_side` (`receivable`/`payable`). Thu + receivable ⇒ giảm phải thu; thu + payable ⇒ **tăng** phải trả (NCC hoàn tiền); chi + payable ⇒ giảm phải trả; chi + receivable ⇒ **tăng** phải thu (trả lại tiền khách). Bỏ trống ⇒ thu→receivable, chi→payable, trừ đối tác chỉ-là-NCC (thu→payable) và chỉ-là-KH (chi→receivable). Khi sửa mà bỏ trống thì tính lại mặc định theo dữ liệu mới (PUT thay toàn bộ). Phiếu cũ được migration gán theo quy tắc cũ (thu→receivable, chi→payable). | Hoàn tiền không làm sai cả hai sổ: mua 1.000.000 → chi 1.000.000 → trả hàng 500.000 → NCC hoàn 500.000 ⇒ phải trả 0, phải thu 0 (tương tự phía khách). Mở rộng R8 của SPEC. |
| F4 | Mỗi dòng tiền `amount > 0`. `document_id` (tùy chọn) phải tồn tại và cùng đối tác với phiếu. Liên kết chỉ để tra cứu, không phân bổ công nợ theo hóa đơn. | Công nợ theo đối tác (R8), không theo từng hóa đơn. |
| F5 | Sửa phiếu thu/chi làm đổi thu ↔ chi hoặc tiền mặt ↔ ngân hàng ⇒ cấp **số mới** theo dãy mới (PT/PC/BC/BN). Không đổi được `kind` của tài khoản đã có phiếu. Xóa phiếu thu/chi là xóa hẳn (có audit). | Số phiếu phải khớp loại. |
| F6 | `debt-summary`: gồm đối tác có cờ phía đó, hoặc có phát sinh, hoặc có số dư đầu; ẩn dòng toàn 0 trừ khi `include_zero=true`. | Báo cáo gọn. |

## G. Báo cáo & xuất file (R10)

| # | Quyết định | Lý do |
|---|---|---|
| G1 | `stock-summary` mặc định `only_with_data=true` (mã đã từng phát sinh đến `as_of`); `false` thêm mọi mã hàng hóa đang dùng. | TODO REQ-022 đã thống nhất "không bắt buộc mã chỉ có trong danh mục". |
| G2 | `stock-nxt` / `stock-ledger` khi xem **tất cả kho** bỏ dòng chuyển kho khỏi nhập/xuất (R2); xem từng kho thì có. | Chuyển kho tự triệt tiêu trên tổng. |
| G3 | `sales` / `purchases` mặc định chỉ phiếu bán / mua; `include_returns=true` thêm phiếu trả hàng với SL, tiền âm. Dòng dịch vụ có trong báo cáo; `total_qty` chỉ cộng hàng hóa. | "Lịch sử bán hàng" thuần; bán ròng khi cần. |
| G4 | `cash-book` mỗi **dòng tiền** là một dòng sổ (không gộp theo phiếu); `account_id` tùy chọn (gộp mọi tài khoản, lọc `kind`). | Phiếu nhiều dòng (REQ-060/061) phải thấy từng khoản. |
| G5 | `draft-demand`: `total_stock` là tồn tổng mọi kho tại thời điểm xem (không theo ngày phiếu). | SPEC: "tồn tổng hiện tại". |
| G6 | Dashboard: doanh thu = bán − khách trả (đã ghi sổ); "sắp hết" = mã đang dùng đã từng phát sinh có tồn tổng ≤ ngưỡng (mặc định 5, tham số `low_stock_threshold`); thêm `out_of_stock_count`, số dư quỹ/ngân hàng, 10 phiếu tạm gần nhất, số mã thiếu trên phiếu bán tạm. | SPEC chỉ liệt kê tên chỉ tiêu. **(ngưỡng cần khách xác nhận)** |
| G7 | Excel: số ghi là **ô số thật** (không qua float). Tiền/đơn giá chẵn định dạng `#,##0`, có số lẻ định dạng `#,##0.0#` (không làm tròn khi hiển thị, vd. 13.001,5); SL `#,##0.0##`. Ô "Cộng" (phiếu và báo cáo) là **công thức `SUM`**; "Nợ cũ:" / "Tổng nợ …:" / "Tổng số tiền (đồng):" là ô nhãn + **ô số riêng**, Tổng nợ = công thức `Nợ cũ + Cộng`. Mọi ô công thức có kết quả lưu sẵn **dạng số** (bỏ `t="str"` mà excelize ghi mặc định) để trình xem không tính lại công thức vẫn hiện đúng. Tiêu đề gộp ô, không khóa sheet, không ảnh, cố định dòng tiêu đề cột. | REQ-074 "chỉnh sửa, thêm bớt dòng cột"; lỗi B5. |
| G8 | Word: tự sinh `.docx` (zip + XML) có `styles.xml`, bảng `<w:tbl>` có viền, số định dạng kiểu Việt Nam (`3.990.000`, SL `1,0`), font Times New Roman; bảng > 8 cột chuyển trang ngang. | SPEC §1. |
| G9 | Báo cáo nhận thêm `format=docx` (ngoài `xlsx` SPEC yêu cầu). | Chi phí thấp, có ích cho khách. |
| G10 | Báo cáo/thẻ kho có `from`/`to` tùy chọn; `stock-nxt`, `sales`, `purchases` mặc định đầu tháng → hôm nay. | Màn báo cáo mở ra có dữ liệu ngay. |

## H. Xác thực, API

| # | Quyết định | Lý do |
|---|---|---|
| H1 | Vai trò `ketoan` làm được mọi nghiệp vụ và sửa danh mục; chỉ `admin` quản lý người dùng. Không khóa/hạ quyền được admin cuối cùng. Đổi mật khẩu hoặc khóa tài khoản ⇒ hủy mọi phiên của người đó. | SPEC không chia quyền chi tiết hơn. |
| H2 | Phiên 30 ngày, không trượt; cookie `session` HttpOnly, SameSite=Lax, `Secure` khi `COOKIE_SECURE=true`. Chấp nhận thêm `Authorization: Bearer <token>` cho công cụ. | Mạng nội bộ, ít đăng nhập lại. |
| H3 | Thời điểm trả về RFC 3339 UTC; "hôm nay" tính theo giờ Việt Nam (UTC+7); kết nối CSDL đặt `timezone=Asia/Ho_Chi_Minh`. | Chuẩn JSON; frontend tự đổi giờ hiển thị. |
| H4 | Thêm endpoint ngoài SPEC: `GET /api/health`, `GET /api/vouchers/{id}/history`; thêm trường tiện dụng (`display_no`, `doc_type_name`, `voucher_type_name`, `*_name`, `line_count`, `can_post`, `product_*` phẳng trong `draft-demand`). Sai phương thức HTTP ⇒ 405 với `code: VALIDATION`. | Giảm việc ghép dữ liệu ở frontend. |
| H5 | `PUT` danh mục là thay toàn bộ (không phải PATCH). | Đơn giản, form sửa luôn gửi đủ trường. |
| H6 | Danh mục cũng ghi `audit_log` (entity `warehouse`, `product_group`, `product`, `partner`, `cash_account`). | Truy vết thay đổi giá bán mặc định… |

## I. Môi trường

| # | Quyết định | Lý do |
|---|---|---|
| I1 | Phiên bản thư viện được ghim để build bằng **Go 1.24** (`go.mod: go 1.24`): chi v5.2.1, pgx v5.7.2, decimal v1.4.0, excelize v2.9.0, x/crypto v0.36.0, pgx-shopspring-decimal. Bản mới nhất của các thư viện này đòi Go ≥ 1.25. | SPEC §1 chốt Go 1.24. |
| I2 | Test tích hợp tạo **schema PostgreSQL riêng cho mỗi test** (`search_path`), migrate + seed, xóa khi xong ⇒ độc lập và chạy song song (`t.Parallel`). | Nhanh hơn truncate + tuần tự, cô lập hoàn toàn. |

## J. Bổ sung API cho frontend (giai đoạn 2)

| # | Quyết định | Lý do |
|---|---|---|
| J1 | `sum_total_amount` ở `GET /documents`, `GET /vouchers` = tổng mọi dòng khớp bộ lọc (một truy vấn `count + sum`). Không lọc `status` thì gồm cả phiếu tạm. | Dòng tổng dưới bảng danh sách. |
| J2 | `GET /products/price-info?ids=` trả `{"items":[…]}` (không phải mảng trần, cho thống nhất với các danh sách khác), tối đa 500 id, id trùng bị bỏ, id không tồn tại ⇒ 404 `missing_ids`. Endpoint đơn lẻ dùng chung mã nguồn và nhận thêm `warehouse_id`. | Tránh N+1 khi mở phiếu nhiều dòng. |
| J3 | `with_stock=true` tính tồn **đến hết hôm nay** (giờ VN), chỉ cho các mặt hàng của trang hiện tại, một truy vấn gộp. | Đủ nhanh với vài nghìn mã (trang tối đa 1000). |
| J4 | `POST /documents/check`: bỏ qua dòng chưa chọn mặt hàng và dòng hàng hóa chưa có SL > 0 (đang gõ); lỗi dữ liệu khác vẫn 400. Phiếu mới kiểm như tạo mới (danh mục ngừng dùng ⇒ 400); có `id` thì như sửa. | Gợi ý tức thời khi gõ, không báo lỗi vì dòng còn dở. |
| J5 | Đổi mật khẩu: sai mật khẩu cũ ⇒ **400** `VALIDATION` (không phải 401, để giao diện không coi là hết phiên); hủy mọi phiên khác, giữ phiên hiện tại. | Theo yêu cầu controller. |
| J6 | Thông tin công ty: bảng một dòng `settings` (migration 003), mặc định rỗng; seed lúc khởi động luôn tạo lại dòng này nếu mất (vd. `seeddemo -reset` TRUNCATE CASCADE); in trước tiêu đề mọi file xuất, mục trống thì bỏ dòng. Có ghi `audit_log` (entity `settings`). | Đầu phiếu in gửi khách. |
| J7 | Cột "Ghi chú" (ghi chú từng dòng) trong file xuất chứng từ chỉ có khi ít nhất một dòng có ghi chú; khi không có, bảng còn 7 cột. | Phiếu gọn hơn; theo yêu cầu controller. |

## K. Đợt sửa sau E2E trình duyệt (F-02, F-03, F-07)

| # | Quyết định | Lý do |
|---|---|---|
| K1 | Số tiền bằng chữ (`util.MoneyInWords`) cùng quy tắc với `frontend/src/lib/numberWords.ts`, **trừ** "bốn" (không "tư") sau mươi — quyết định của controller (34 = "ba mươi bốn"); làm tròn về đồng (nửa xa 0); 0 ⇒ "Không đồng"; số âm ⇒ "Âm …" (số âm tròn về 0 ⇒ "Không đồng"). | F-02: file phiếu thu/chi phải có "Bằng chữ" như bản in. |
| K2 | File xuất chứng từ / phiếu thu chi lấy bản in trên màn hình làm chuẩn: mã `DICHVU` cho dòng dịch vụ, nhãn kho theo loại phiếu, đối tác kèm mã, địa chỉ + ĐT một dòng, ô ký theo loại phiếu (phiếu thu/chi 5 người ký), dòng "Ngày …… tháng …… năm ………", dòng cuối thời điểm xuất + người ghi sổ/lập. Phiếu chuyển kho bỏ cột giá (dòng Cộng = tổng SL). Cột Tên hàng của hàng hóa = diễn giải dòng nếu có (như bản in), trước đây là "tên - diễn giải". Dòng tổng phiếu thu/chi đổi nhãn "Cộng" → "Tổng số tiền"; bỏ dòng "Tổng số tiền (đồng):" riêng (trùng ô tổng; vẫn là công thức `SUM` có kết quả số). Phụ đề phiếu tạm dùng tên phiếu của giao diện ("Phiếu khách trả hàng"…), khác `doc_type_name` của API (API giữ nguyên). | F-03: in và xuất cùng một phiếu phải giống nhau. |
| K3 | Tìm đối tác theo **từ**: mọi từ (đã bỏ dấu, bỏ dấu câu) phải có mặt ở mã, tên, ĐT hoặc MST; xếp hạng 0–6 (xem API.md §2.3). Tính trực tiếp trong SQL bằng `kho_fold` + `regexp_replace` (không thêm cột). "Trùng mã" so với chuỗi gõ đã bỏ khoảng trắng/dấu câu (gõ `thanh cong` khớp mã `THANHCONG`). Áp dụng cho `/partners`, phần đối tác trong `q` của `/documents`, `/vouchers`, `/reports/debt-summary`. Tìm mặt hàng giữ nguyên (chuỗi liền, không dấu) vì mã hàng có dấu chấm có nghĩa ("3.2"). | F-07: Enter chọn nhầm đối tác; "viet han" không ra "Việt – Hàn". |
| K4 | `GET /partners/{id}/balance`: số dư phải thu/phải trả đến hết `date`, loại trừ tùy chọn một chứng từ / phiếu. Không xét thứ tự cùng ngày (khác `old_debt` của Document). | Giao diện không phải tải cả sổ chi tiết công nợ. |

## L. Đợt sửa 2 sau E2E (F-09, F-12, F-13, F-16)

| # | Quyết định | Lý do |
|---|---|---|
| L1 | Tìm đối tác: mức 1 (tên bắt đầu bằng cụm từ) và mức 2 (tên chứa cụm từ) đòi **trọn từ ở cả hai đầu** cụm; khớp một phần từ rơi xuống mức 5. | F-12: "minh phu" phải ưu tiên "Minh Phú" hơn "Minh Phước". |
| L2 | Tìm mặt hàng ở mọi nơi theo từ, tách theo khoảng trắng (giữ "3.2", "er70s6-12"), mỗi từ liền trong mã hoặc tên (cột `search_key`), thứ tự bất kỳ; danh mục mặt hàng xếp trùng mã → mã bắt đầu → mọi từ trong tên → còn lại; báo cáo vẫn sắp theo mã. Từ có thể khớp trong mã (vd. "32" khớp mã "KT42132"). Ký tự `%`, `_` được coi là chữ thường. | F-13: thống nhất với ô Mã hàng trong lưới phiếu. |
| L3 | Dòng địa chỉ trên file xuất bỏ phần trống. | F-09. |
| L4 | `GET /products/lookup?optional=1` ⇒ luôn 200 `{"found": bool, "product": Product|null}`; mặc định giữ 404. | F-16: gõ từng chữ không sinh 404 trong console; bộ QA dựa vào hành vi mặc định. |

## M. Id dòng ổn định khi sửa

| # | Quyết định | Lý do |
|---|---|---|
| M1 | PUT chứng từ / phiếu thu chi: dòng gửi kèm `id` thuộc chính phiếu ⇒ UPDATE tại chỗ, giữ id; `id` của phiếu khác hoặc lặp lại ⇒ **coi là dòng mới** (không trả 400, để bản ghép xung đột của giao diện không bị chặn); dòng không gửi lại ⇒ xóa. Bút toán kho của phiếu đã ghi sổ được xóa và sinh lại như trước (liên kết `stock_movements.line_id` trỏ đúng id dòng mới/giữ). Liên kết phiếu thu → chứng từ (`document_id`) và nhật ký không tham chiếu id dòng nên không bị ảnh hưởng. | Giao diện ghép xung đột hai máy cần nhận ra đúng từng dòng. |

## N. Bản mở rộng — đợt M1 (§0, C1 phân quyền, C4 khóa sổ, C3 nhập Excel)

| # | Quyết định | Lý do |
|---|---|---|
| N1 | **(Sửa theo quyết định controller.)** `settings.features` chỉ chứa khóa quản trị đã đặt tường minh; `settings.edition` ghi lại mỗi lần máy chủ / seeddemo khởi động từ `KHO_EDITION`. Giá trị hiệu lực = giá trị đã đặt, nếu không có thì `edition = extended` ⇒ bật, ngược lại tắt. Danh sách tính năng có sẵn là `ext.AvailableFeatures` (M1: permissions, period_lock, import_excel); tính năng chưa có luôn tắt, PUT ⇒ 400. `features_initialized` không còn dùng (giữ cột). Migration 005 xóa các giá trị do seed M1 gán nếu chưa có audit `features` (chưa có quản trị đổi). | Bản mở rộng nâng cấp nhận tính năng mới ở trạng thái bật, bản chuẩn giữ tắt; lựa chọn của quản trị không bị đè. |
| N2 | Migration 004 nới ràng buộc `users_role_check` bằng `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` với tập vai trò lớn hơn (tập cũ là tập con ⇒ không dòng nào vi phạm). Ma trận mặc định nằm trong bảng `role_permissions` (seed trong migration); `admin` không có dòng (luôn đủ quyền). | Additive, an toàn với CSDL đang chạy. |
| N3 | Khi tính năng phân quyền **tắt**, không tạo/đổi được người dùng sang vai trò mới (400) — người đã có vai trò mới vẫn đăng nhập, được coi như `ketoan`. | Tránh "vai trò ma" khi tắt. |
| N4 | Che số liệu làm **tập trung** ở lớp HTTP: phản hồi JSON của người thiếu quyền xem được giải mã, che theo tên khóa (`purchase_price`, `cost_price`, … và mọi object có `doc_type` mua/trả NCC/tồn đầu), rồi mã hóa lại; file xuất chứng từ dùng tùy chọn che riêng. Có test đi qua mọi route GET (đối chiếu router bằng `chi.Walk`) + SSE + file xuất, so với các con số giá vốn đánh dấu, và đối chứng ngược. | Không phụ thuộc từng handler nhớ che. **Rủi ro**: endpoint mới thêm trường giá vốn với tên khóa khác sẽ không tự được che — test rò sẽ báo nếu dữ liệu mẫu chạm tới; khi thêm endpoint/trường mới phải cập nhật luật che. |
| N5 | Coi **phiếu tồn đầu kỳ** là chứng từ giá vốn (đơn giá = giá mua) ⇒ che như phiếu mua; dòng thẻ kho của phiếu mua/trả NCC/tồn đầu che `unit_price`. Nợ **phải trả** (báo cáo, số dư, dashboard, số dư đầu kỳ NCC) cần thêm `cost.view` vì lộ giá trị hàng mua. | Spec chỉ nói "giá mua, giá vốn, đơn giá/thành tiền chứng từ mua"; tồn đầu và phải trả cho suy ra được cùng con số. |
| N6 | Ánh xạ quyền đọc mà spec chưa nói: xem phiếu thu chi cần `cash.view` **hoặc** `cash.write` (bán hàng lập phiếu thu phải xem lại được phiếu mình lập); `debt.view` che Nợ cũ/Tổng nợ trên phiếu bán và số dư đầu kỳ; `cash.view` che số dư quỹ/ngân hàng và `opening_balance`; `report.view` che doanh thu dashboard. Xem chứng từ (mọi loại, đã che giá vốn) và dashboard: mọi vai trò. `GET /role-permissions` chỉ quản trị (giao diện người thường dùng `/auth/me`). | Spec liệt kê quyền nhưng không ánh xạ từng endpoint đọc. |
| N7 | Người thiếu quyền xem mà vẫn được sửa (vd. vai trò tùy biến có `catalog.write` nhưng không `cost.view`): trường bị che **không bị ghi đè** khi lưu (giữ giá mua, số dư đầu kỳ, đơn giá dòng phiếu mua có `id`). Dòng mới trên phiếu mua của người không thấy giá ⇒ giá mua mặc định (máy chủ tự điền). | Không để việc che làm mất dữ liệu. |
| N8 | `POST /documents/check` cần quyền lập loại phiếu đó. Kiểm tra quyền chạy trước kiểm tra dữ liệu (thiếu quyền ⇒ 403 dù dữ liệu sai). | Nhất quán. |
| N9 | **Khóa sổ — chỗ spec tự mâu thuẫn**: "≤ ngày khóa: không tạo, sửa, … xóa" và "phiếu tạm trong kỳ khóa: sửa/xóa được". Diễn giải: không tạo chứng từ mới (kể cả phiếu tạm) trong kỳ khóa; phiếu tạm **đã có** trong kỳ khóa sửa/xóa được và dời ngày ra ngoài được (để ghi sổ sau), nhưng không ghi sổ được; không dời phiếu tạm từ ngoài vào kỳ khóa (tương đương tạo mới trong kỳ). Phiếu đã ghi sổ: không sửa nếu ngày cũ hoặc mới ≤ ngày khóa, không bỏ ghi sổ. Kiểm tra trong cùng giao dịch ghi. | **Cần controller/khách xác nhận.** |
| N10 | **(Sửa theo quyết định controller.)** Khi có ngày khóa (tính năng bật), số dư đầu kỳ không có ngày bị chặn: tạo đối tác / tài khoản tiền với số dư đầu khác 0, sửa thành số khác, và nhập `opening_debt` (cả thử) ⇒ 422 PERIOD_LOCKED, bảo quản trị bỏ khóa trước. Tạo mới với số 0 và sửa trường khác (số dư giữ nguyên, kể cả do người không có quyền xem lưu lại) vẫn được. | Các số này làm thay đổi số dư của kỳ đã khóa. |
| N11 | Tắt tính năng khóa sổ ⇒ không áp dụng khóa nhưng vẫn giữ ngày khóa đã lưu. `GET /period-lock` mọi người dùng xem được. Lý do khóa chỉ lưu trong audit. | |
| N12 | Nhập Excel: dòng tiêu đề tìm trong 30 dòng đầu; trang đầu không tên "Hướng dẫn"; nhóm VTHH chưa có ⇒ **tự tạo** (mã = tên = giá trị ô); cập nhật theo mã: ô trống giữ nguyên (cờ KH/NCC trống cũng giữ); công nợ đầu kỳ: ô trống = 0, cột vắng = giữ; tồn đầu tách phiếu 1000 dòng (giới hạn dòng của chứng từ, để ghi sổ/sửa được); cặp mã hàng+kho trùng ⇒ lỗi; số chữ "1.500" = 1500 (nhóm nghìn) còn "2.5" = 2,5; giá làm tròn 2 chữ số. Thử luôn trả 200 (lỗi nằm trong `errors`); nhập thật có lỗi ⇒ 422 `IMPORT_INVALID`. File quá 10 MB hoặc quá 20.000 dòng ⇒ 400 (không dùng 413). Một dòng audit cho mỗi lần nhập (không phải từng dòng) + một dòng cho mỗi phiếu tồn đầu tạo ra. Ghi theo lô (pgx batch): 20.000 mặt hàng ≈ 2,1 s thử, ≈ 2,8 s nhập trên máy phát triển. | Spec để mở. |
| N13 | Mẫu tồn đầu / công nợ đầu lấy 2 mã có thật trong danh mục làm ví dụ (danh mục trống ⇒ mã giả, thử sẽ báo lỗi). | Yêu cầu "tải mẫu → gửi lại nguyên vẹn → thử OK". |
| N14 | `/auth/me` thêm `features` (ngoài `permissions` spec yêu cầu). Mỗi request đăng nhập đọc thêm `settings` (+ `role_permissions` khi bật phân quyền): 1–2 truy vấn nhỏ. | Giao diện cần cả hai để dựng menu. |

## O. Bản mở rộng — đợt M2 (C5 tồn tối thiểu, C6 giá theo khách, C8 hạn mức & tuổi nợ, C7 lãi gộp)

| # | Quyết định | Lý do |
|---|---|---|
| O1 | Trường mới của danh mục (`min_stock`, `credit_limit`, `payment_days`) chỉ có trong JSON khi tính năng bật; trường nhập chỉ áp dụng khi có gửi (kiểu "tùy chọn": không gửi ⇒ giữ, `null` ⇒ xóa) và tính năng bật. Tắt tính năng ⇒ dữ liệu đã đặt vẫn giữ. | "Tắt = y như bản chuẩn", và không làm mất dữ liệu khi máy khách cũ PUT thiếu trường. |
| O2 | **Đề nghị sửa công thức spec C5**: spec ghi "Cần đặt thêm = max(0, min − tồn + thiếu của phiếu tạm)". Với tồn 3, phiếu tạm 5, min 10: thiếu = 2 ⇒ 9, nhưng đặt 9 xong giao phiếu tạm còn 7 < 10. Đã làm **max(0, min − (tồn − SL trên phiếu tạm))** = 12 (tồn sau khi giao phiếu tạm phải đạt min). "Hàng cần đặt" khi bật cũng liệt kê các mã dưới tồn tối thiểu dù không có trên phiếu tạm. Tồn tối thiểu tính trên tổng các kho, mã ngừng dùng / dịch vụ không xét. Thêm báo cáo `/reports/low-stock`. | **Cần controller/khách xác nhận.** |
| O3 | Giá theo khách: "giá bán gần nhất" chỉ tính dòng phiếu **bán** đã ghi sổ, ngày ≤ ngày phiếu đang lập, mới nhất theo ngày → thứ tự ghi sổ → id → số dòng; bỏ dòng không có đơn giá, khách trả hàng, phiếu tạm. Máy chủ tự điền đơn giá theo thứ tự này cho dòng phiếu bán không gửi `unit_price` (phiếu trả hàng vẫn giá mặc định). Giá riêng chỉ cho đối tác là khách hàng; xem: mọi vai trò; sửa: `sale.write`. Xóa mặt hàng/đối tác (chưa phát sinh chứng từ) ⇒ **xóa luôn** giá riêng (`ON DELETE CASCADE`): giá riêng là cấu hình, không phải chứng từ. Có thêm loại nhập Excel `partner_prices`. | Spec để mở các chi tiết này. |
| O4 | **(Rủi ro đồng thời đã xử lý ở P5.)** Hạn mức: "nợ phải thu hiện tại" = số dư từ mọi chứng từ / phiếu đã ghi sổ (kể cả ngày sau hôm nay), không gồm phiếu đang ghi sổ. Sửa phiếu bán đã ghi sổ chỉ kiểm khi tổng tiền tăng (cùng khách) hoặc đổi khách. Có vượt hạn mức chưa xác nhận ⇒ `CREDIT_WARNING` gộp cả dòng lỗ chưa xác nhận (`details.confirm` liệt kê cờ cần gửi); chỉ còn lỗ ⇒ `LOSS_WARNING` như cũ (giữ tương thích). Không khóa hàng đối tác khi kiểm hạn mức: hai máy cùng ghi sổ hai phiếu một lúc có thể cùng lọt (đây là cảnh báo, không phải chặn cứng). | **Rủi ro nhỏ** đã chấp nhận. |
| O5 | Tuổi nợ: spec chỉ có 5 cột; thêm 2 cột để **tổng luôn khớp sổ công nợ**: `opening` (nợ đầu kỳ khai báo — không có ngày nên không xếp tuổi được; là khoản cũ nhất trong FIFO) và `prepaid` (khách trả thừa, âm; bù vào khoản tăng nợ sau). Phiếu chi trả lại tiền khách là khoản tăng nợ; phiếu bán có tổng âm là khoản giảm nợ. Số ngày quá hạn = ngày xét − (ngày phát sinh + payment_days); ≤ 0 ⇒ trong hạn. Mỗi khách kèm danh sách khoản còn mở để mở chi tiết. Có test tính chất ngẫu nhiên (12 ca × 30 thao tác × 4 ngày xét, seed cố định) và đã kiểm chứng test bắt lỗi khi phá FIFO. | Bắt buộc khớp sổ công nợ. |
| O6 | **(Đã thay bằng P1 — bình quân liên hoàn.)** Lãi gộp: giá trị nhập lấy theo **thành tiền dòng** (đã làm tròn đồng); bình quân không làm tròn, giá vốn từng dòng làm tròn đồng rồi mới cộng (mọi cách nhóm cộng từ cùng các dòng ⇒ tổng bằng nhau tuyệt đối). Khách trả hàng không phải "lượng nhập" cho giá vốn. SL lũy kế ≤ 0 (trả NCC nhiều hơn nhập) ⇒ coi như chưa có nhập ⇒ ước tính. Tính tại thời điểm xem: sửa / nhập lùi ngày phiếu mua **làm thay đổi lãi các kỳ trước** (nhất quán với R2/R3 — số liệu luôn tính từ chứng từ). Cần `report.view` + `cost.view`. | Spec C7 "cần khách xác nhận". |
| O7 | Nhập Excel hàng hóa / đối tác: cột Tên không còn bắt buộc **có mặt** (để file chỉ cập nhật vài cột, vd. Tồn tối thiểu); mã mới vẫn bắt buộc có tên (lỗi theo dòng). | Thay đổi nhỏ của M1, có lợi cho người dùng. |
| O8 | Hiệu năng (máy phát triển, 20.000 chứng từ / 100.000 dòng / 5.000 phiếu thu): tuổi nợ ≈ 0,19 s; lãi gộp theo phiếu ≈ 1,1 s, theo mặt hàng ≈ 0,9 s, theo khách ≈ 0,9 s, xuất xlsx ≈ 1,1 s. | Đo trong `TestMR_C7_C8_HieuNang` (bỏ qua khi `-race`/`-short`). |

## P. Sửa sau QA hộp đen bản mở rộng M1 + M2 (qa/BAO_CAO_QA_MO_RONG.md)

| # | Quyết định | Lý do |
|---|---|---|
| P1 | **C7 đổi sang bình quân gia quyền liên hoàn** (thay O6, theo SPEC_MO_RONG C7 viết lại): chạy từng mã từ dòng sổ đầu tiên đến hết ngày `to`, cùng ngày nhập (mua, tồn đầu, khách trả) trước, xuất (bán, trả NCC) sau, rồi theo thứ tự ghi sổ (`posted_at`, id, số dòng). Giá trị nhập = thành tiền dòng; bình quân giữ 10 chữ số thập phân, giá vốn dòng làm tròn đồng. Tồn ≤ 0 khi nhập mua ⇒ bình quân = đơn giá nhập; trả NCC làm SL về ≤ 0 ⇒ giá trị về 0, giữ bình quân cũ; khách trả hàng khi chưa từng có nhập mua ⇒ giá mặc định, ước tính (không tính là "lượng nhập"). Bán vượt tồn (chỉ xảy ra trong tính toán vì R6 chặn âm kho) ⇒ vẫn dùng bình quân hiện tại. | Controller quyết (Q-01). Có test tính tay ở mức hàm (`internal/reports/cost_test.go`, gồm bán vào âm rồi mua) và qua API. |
| P2 | Người không có `cost.view` không sửa / bỏ ghi sổ được phiếu mua, trả NCC, tồn đầu **đã ghi sổ** (403). Phiếu tạm: dòng gửi lại `id` cùng mặt hàng luôn giữ đơn giá đang lưu (kể cả khi gửi một số "mù"); đổi mặt hàng của dòng ⇒ dòng mới (giá mặc định của mã mới). | Q-02: họ không thấy mình đang đổi gì. |
| P3 | Nhập Excel hàng hóa bởi người bị che giá: giữ như M1 (bỏ cột Giá mua, có `notes`). Nhập **tồn đầu kỳ** của người bị che giá vẫn nhận cột Đơn giá như trước ("ghi mù" lên phiếu **tạm**, người có quyền xem giá kiểm tra trước khi ghi sổ). | Q-03 controller chỉ yêu cầu hàng hóa; phiếu tồn đầu tạo ra là phiếu tạm. |
| P4 | `PUT /period-lock` bắt buộc có trường `lock_date` (null = bỏ khóa). **Lý do (`reason`) vẫn không bắt buộc** như M1: test cũ (Go và QA) gửi khóa sổ không kèm lý do. | Q-04. Nếu muốn bắt buộc lý do, cần controller xác nhận (sẽ đổi test M1). |
| P5 | Kiểm tra hạn mức lấy khóa advisory theo khách (lớp âm, lấy sau các khóa mặt hàng+kho ⇒ thứ tự khóa cố định) trước khi tính nợ. Thay rủi ro ghi ở O4. | Q-05; test đồng thời dùng dòng dịch vụ (không có khóa kho nào xếp hàng hộ) và đã kiểm tra test đỏ khi bỏ khóa. |
| P6 | Số trong ô chữ dạng `1.25` / `2.5` (một dấu chấm, 1–2 chữ số sau) ⇒ lỗi dòng; `1.250` = 1250; ô số không đổi; ô công thức có giá trị lưu sẵn đọc như ô số. | Q-06 (thay một phần N12). |
| P7 | Chuẩn hóa NFC ở biên API: một chỗ cho body JSON (`decode`), một middleware cho query string, và khi đọc ô Excel. Migration 007 chuẩn hóa các cột chữ của bảng danh mục (từng dòng, bỏ qua dòng mà bản NFC trùng mã một dòng khác để máy chủ vẫn khởi động; CSDL không UTF8 ⇒ bỏ qua). Không chuẩn hóa dữ liệu chứng từ cũ (ghi chú, diễn giải). | M-09. |
| P8 | `GET /api/audit` có cả ở bản chuẩn (chỉ quản trị, chỉ đọc; không đổi hành vi nào của bản chuẩn). | Yêu cầu của QA / giao diện. |
| P9 | Q-07: bỏ qua người dùng đã khóa khi chặn tắt phân quyền. Q-11: cột tiêu đề lặp ⇒ 400. Q-12: che `cost_source`. Q-08: `notes` khi kho đã có phiếu tồn đầu cùng ngày. | Rẻ và rõ ràng đúng. |
| P10 | Q-09 (tồn tối thiểu tính cả chứng từ ngày tương lai): **giữ** — nhất quán với "Hàng cần đặt" (G5) và tồn kiểm tra khi ghi sổ; giao diện nên ghi "tính cả phiếu đã ghi sổ ngày sau". | Đổi sẽ làm hai màn hình lệch nhau. |
| P11 | Q-10 (khách trả hàng trừ vào khoản nợ cũ nhất; giá bán gần nhất bỏ qua chiết khấu bằng dòng DV âm): **giữ**, đúng spec C8 / C6; nêu với khách khi UAT. | Không có quy tắc phân bổ chiết khấu nào đúng cho mọi trường hợp. |
| P12 | Q-13 (nợ phải trả cần thêm `cost.view`): **giữ** (N5) — phải trả lộ tổng giá mua. | Bảo mật giá vốn. |
| P13 | Hiệu năng sau P1 (20.000 chứng từ / 100.000 dòng): lãi gộp theo phiếu ≈ 1,6 s, theo mặt hàng ≈ 1,4 s, theo khách ≈ 1,3 s, xlsx ≈ 1,3 s; tuổi nợ ≈ 0,17 s. | Đo trong `TestMR_C7_C8_HieuNang`. |
