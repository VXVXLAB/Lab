# Báo cáo kiểm thử nghiệm thu đầu-cuối (E2E) — Phần mềm Quản lý Kho

Người kiểm thử độc lập, đóng vai kế toán của khách, thao tác trên trình duyệt thật (Chromium, 1366×768) bằng nhãn tiếng Việt, vai trò và bàn phím. API chỉ dùng để chuẩn bị dữ liệu nền (danh mục, tồn đầu) và đối chiếu số đã thấy trên màn hình.

## 1. Cách chạy và kết quả

```bash
cd kho/e2e
./run.sh                          # CSDL mới kho_e2e → khoserver cổng 18091 → toàn bộ test → dừng máy chủ
./run.sh tests/02_the_kho_vi_du_khach.spec.js   # chạy riêng một câu chuyện
```
- Cần PostgreSQL 16 (role `kho`/`kho`), `backend/bin/khoserver`, `frontend/dist` đã build. Lần đầu `run.sh` tự `npm install` (exceljs, jszip; Playwright 1.63 dùng bản cài sẵn qua liên kết `file:`). Không dùng cổng 8080 / CSDL kho_dev.
- Biến tùy chọn: `E2E_PORT`, `E2E_DB`, `PGHOST/PGUSER/PGPASSWORD`, `E2E_CHROMIUM`.
- Mã thoát = kết quả Playwright. Đầu ra trong `e2e/out/` (không commit): `screenshots/` (46 ảnh), `files/` (file xlsx/docx đã tải và đã sửa), `ket-qua.json`, `server.log`, `browser-issues.jsonl`.

**Kết quả lần chạy đầy đủ thật (2 lần liên tiếp, mã nguồn cuối cùng):**

| Lần | Kết quả Playwright | Thời gian | Mã thoát |
|---|---|---|---|
| A | `117 passed (3.3m)` — expected 117, unexpected 0, flaky 0 | 3 phút 16 giây | 0 |
| B | `117 passed (3.3m)` — expected 117, unexpected 0, flaky 0 | 3 phút 20 giây | 0 |

117 test = **108 test đạt** + **9 test "lỗi đã biết"** (`test.fail`, mỗi test có chú thích trỏ tới một phát hiện F-xx bên dưới; nếu ứng dụng được sửa, test đó sẽ báo "Expected to fail, but passed" và cần bỏ `test.fail`). Trước đó còn 2 lần chạy đầy đủ liên tiếp xanh khác. Không dùng `sleep` mù để chờ ứng dụng: mọi chờ đều là chờ trạng thái (con trỏ đã vào ô, dòng đã lọc xong, số phiếu đã hiện…). `waitForTimeout` chỉ dùng để mô phỏng nhịp gõ của người (F-05, F-07) hoặc khi kiểm sự *vắng mặt* (F-06).

Các câu chuyện (`tests/`): 01 lần đầu dùng · 02 thẻ kho ví dụ khách · 03 phiếu bán ví dụ khách (chỉ bàn phím) · 04 bốn kho/chuyển kho/nhóm/Excel · 05 hết hàng/phiếu tạm/hàng cần đặt · 06 giá mặc định/bán lỗ · 07 sửa chứng từ cũ · 08 hai máy · 09 mã DV · 10 công nợ + mở chi tiết · 11 thu chi nhiều dòng · 12 báo cáo · 13 file Excel/Word sửa được · 14 bàn phím & độ bền · 99 lỗi trình duyệt toàn lần chạy. Mọi mã REQ-009…087 đều có trong tên ít nhất một test.

Đã xác nhận đúng (tóm tắt): ví dụ thẻ kho WW829HT107k khớp từng dòng 23/20/21/20, tổng 1/8/20 trên màn hình và Excel; phiếu bán ví dụ khớp 3.990.000 / Nợ cũ 2.000.000 / Tổng nợ 5.990.000 trên màn hình, bản in, xlsx (ô số, Cộng = SUM, Tổng nợ = công thức) và docx; tồn 4 kho + tổng, chuyển kho triệt tiêu ở "Tất cả kho"; chặn ghi sổ khi thiếu hàng, in phiếu tạm, hàng cần đặt → lập phiếu nhập; cảnh báo lỗ theo giá nhập gần nhất (đổi ngày phiếu thì đổi giá vốn); sửa phiếu nhập tháng 1 lan đúng sang tồn, công nợ, thẻ kho, báo cáo; sửa làm âm kho bị từ chối, không đổi gì; lịch sử ghi ai sửa gì; hai máy thấy nhau qua SSE không cần tải lại; mở chi tiết nhiều tầng, Esc lùi từng tầng, không rời trang; số tiền bằng chữ đúng ("… năm mươi lăm nghìn", "không trăm mười lăm nghìn"); file xuất không khóa, không ảnh, thêm dòng/cột rồi lưu lại vẫn đọc được; không cuộn ngang và không còn chữ tiếng Anh/mã lỗi thô trên 44 màn hình; không lỗi JavaScript, không phản hồi 5xx trong cả lần chạy.

## 2. Phát hiện (nặng nhất trước)

**F-05 — Ô tìm lấy kết quả CŨ khi bấm Enter ⇒ chọn nhầm khách hàng.** *Lỗi (ảnh hưởng số liệu) + khả dụng.* REQ-025, 043/HDSD "Gõ vài chữ tên… rồi Enter".
- (a) Phiếu bán, ô Khách hàng: gõ `an phu` (~16 phím/giây) rồi Enter sau ~80 ms ⇒ phiếu nhận **"ANBINH – Công ty TNHH An Bình"** thay vì "Cơ khí An Phú"; con trỏ nhảy sang ô Kho nên rất dễ không để ý ⇒ phiếu và công nợ vào nhầm khách. Tái hiện cả khi không trễ mạng (80 ms); test giả lập mạng LAN chậm 0,6 s để ổn định. Ảnh `out/screenshots/F05-phieu-ban-chon-nham-khach.png`. (Ô Mã hàng KHÔNG bị — nó kiểm kết quả có đúng chữ đang gõ không trước khi lấy.)
- (b) Danh mục Khách hàng: gõ `thanh cong` rồi Enter, Enter ⇒ mở **"Sửa khách hàng ANBINH"** (dòng đầu danh sách cũ) hoặc không mở gì, vì ô tìm chờ 250 ms và trong lúc chờ vẫn để danh sách cũ. Ảnh `F05-danh-muc-mo-nham-khach.png`.
- Mong đợi: Enter chỉ chọn trong kết quả của đúng chữ đã gõ (hoặc chờ kết quả). Test: `14_… › REQ-025 REQ-UX Phiếu bán: gõ "an phu"…`, `› REQ-UX Gõ tìm "thanh cong" rồi Enter, Enter…`.

**F-07 — Tìm đối tác trong phiếu thu/chi xếp theo mã, khớp cả chuỗi "mã + tên" ⇒ Enter chọn nhầm đối tác.** *Khả dụng / lỗi.* REQ-060. Gõ `thanh cong` ở Phiếu thu, đợi danh sách lọc xong, Enter ⇒ chọn **"TANTHANH – Công ty TNHH Thép Tân Thành"** (vì "tanTHANH CONG ty…") đứng trên "Xưởng cơ khí Thành Công". Ngoài ra tìm đối tác chỉ khớp chuỗi liền: `viet han` không ra "Thiết bị hàn Việt – Hàn", trong khi ô mã hàng chấp nhận các từ không liền ("que 3.2") — hai ô tìm cư xử khác nhau. Ảnh `F07-phieu-thu-chon-nham-doi-tac.png`.

**F-01 — Xung đột hai máy: khung vàng giữ CẢ dòng cũ; "Thêm các dòng này vào phiếu" làm lặp dòng và đưa lại số lượng cũ.** *Lỗi / lệch hướng dẫn.* REQ-044, 082. Máy 1 có MATNA 2, GANGTAY 10, đang gõ thêm BUAGO 5; máy 2 sửa GANGTAY 10→12 và lưu; máy 1 Ctrl+S → "Máy khác vừa sửa phiếu này" (đúng, không ghi đè) → "Tải bản mới" → khung vàng liệt kê 3 dòng; bấm "Thêm các dòng này vào phiếu" ⇒ phiếu thành MATNA 2, GANGTAY 12, **MATNA 2, GANGTAY 10**, BUAGO 5. HDSD: "Các dòng bạn vừa gõ vẫn giữ trong khung vàng để thêm lại" ⇒ mong đợi chỉ BUAGO. Rủi ro bán gấp đôi hoặc lấy lại SL cũ. Ảnh `08-khung-vang-dong-da-go.png`, `F01-them-lai-dong-bi-lap.png`.

**F-02 — File Excel/Word của phiếu thu/chi không có dòng "Bằng chữ".** *Lỗi / lệch hướng dẫn.* REQ-085, 087. Bản in trên màn hình có "Bằng chữ: Tám triệu bốn trăm năm mươi lăm nghìn đồng"; file `.xlsx` và `.docx` (kế toán mở ra in/gửi) chỉ có "Tổng số tiền (đồng): 8.455.000". Phiếu thu/chi thiếu nội dung thường bắt buộc. File `out/files/11-phieu-thu.xlsx|.docx`, ảnh bản in `11-ban-in-phieu-thu.png`.

**F-04 — Phiên hết hạn khi đang gõ phiếu ⇒ mất toàn bộ dòng đã gõ.** *Khả dụng.* Khi quản trị đặt lại mật khẩu, khóa tài khoản, hoặc chính kế toán đổi mật khẩu ở máy khác (HDSD: các phiên khác bị hủy), bấm Ctrl+S ⇒ về màn đăng nhập (có thông báo "Phiên làm việc đã hết", đúng) nhưng đăng nhập lại là phiếu trống. Ảnh `F04-dang-nhap-lai-mat-phieu.png`.

**F-03 — Bản in và file xuất của cùng một phiếu không thống nhất.** *Lệch mẫu khách / câu hỏi cho khách.* REQ-047, 073. Bản in ghi mã dòng dịch vụ là `DICHVU` (đúng mẫu khách), file Excel/Word ghi `DV`. Ô ký: bản in phiếu bán 4 người ký (Người lập phiếu, Người giao hàng, Khách hàng, Thủ kho), file xuất 3 người (Người lập phiếu, Thủ kho, Khách hàng); "Xuất từ kho:" trên bản in và "Kho:" trong file. So sánh `03-ban-in-phieu-ban.png` với `out/files/03-phieu-ban.xlsx`.

**F-08 — Hỏi "Phiếu chưa lưu" khi chưa gõ gì.** *Khả dụng.* Từ sổ chi tiết công nợ bấm "Thu tiền" (phần mềm điền sẵn khách), đổi ý bấm sang màn khác ⇒ "Bạn có thay đổi chưa lưu… sẽ mất các thay đổi này". Báo động giả làm người dùng quen bấm "Bỏ thay đổi" mà không đọc. Ảnh `F08-hoi-chua-luu-du-chua-go-gi.png`.

**F-06 — Lệnh gọi thừa / lỗi đỏ trong console.** *Lỗi nhỏ (người dùng không thấy).* Ngay sau khi xóa phiếu tạm, màn hình vẫn gọi `GET /api/documents/{id}` và `POST /api/documents/check` cho phiếu vừa xóa ⇒ 2 phản hồi 404. Ngoài ra Chrome in "Failed to load resource" (lỗi đỏ console) cho mọi phản hồi 4xx đúng thiết kế: 401 `/api/auth/me` mỗi lần mở màn đăng nhập (24 lần/lần chạy), 422 thiếu hàng, 409 bán lỗ / xung đột. Test 99 vì vậy kiểm nghiêm "không lỗi JS, không 5xx, không lỗi console nào khác", còn các dòng 4xx được phân loại và thống kê trong ghi chú kết quả; nếu khách đòi "console sạch tuyệt đối" thì tiêu chí này hiện không đạt.

**Ghi nhận thêm (nhẹ, không thành test):**
- Mẫu khách ghi "Nợ cũ : 10/8/26 2.000.000" (có ngày); phần mềm in "Nợ cũ:" không ngày — *câu hỏi cho khách*: ngày đó là ngày gì (ngày phát sinh nợ cuối?) và có cần in không.
- Ô chọn khoảng thời gian hiện cắt chữ "Khoảng ngà…".
- Các ô đầu phiếu (Khách hàng, Kho, Ghi chú) không gắn nhãn với ô nhập (`<label for>`), trình đọc màn hình và công cụ tự động không nhận ra tên ô.
- Gõ ở tốc độ máy (0 ms/phím) vào lưới phiếu thì mất phím; ở mọi tốc độ người (≥30 ms/phím) không mất — không coi là lỗi.

## 3. REQ không kiểm được trên trình duyệt / giới hạn

- **REQ-001…008** là phân tích, chốt quy tắc: không có màn hình riêng; kiểm gián tiếp qua hành vi (R1–R10 đều được các câu chuyện chạm tới).
- **REQ-088** UAT (cần khách), **REQ-089** sửa lỗi, **REQ-091** bàn giao: ngoài phạm vi tự động. **REQ-090** hướng dẫn: đã đối chiếu nhiều câu trong HDSD với phần mềm (phím tắt, F4, F6/F7, Ctrl+Ins/Del, Alt+↑↓, chặn rời trang, "Thu tiền phiếu này", "Có mặt hàng…", đổi mật khẩu…); các chỗ lệch ghi ở F-01, F-02.
- Không in ra giấy thật (chỉ kiểm bản xem trước và nội dung in); không mở file bằng Excel/Word thật (kiểm bằng exceljs/jszip: bảng, ô số, công thức, không khóa, sửa rồi lưu lại); "hai máy" là hai ngữ cảnh trình duyệt trên cùng một máy, không phải hai PC trong LAN; không kiểm hiệu năng với dữ liệu lớn.
