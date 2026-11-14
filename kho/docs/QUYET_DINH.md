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
