# Báo cáo kiểm thử nghiệm thu đầu-cuối (E2E) — Phần mềm Quản lý Kho

Người kiểm thử độc lập, đóng vai kế toán của khách, thao tác trên trình duyệt thật (Chromium, 1366×768) bằng nhãn tiếng Việt, vai trò và bàn phím. API chỉ dùng để chuẩn bị dữ liệu nền (danh mục, tồn đầu, phiếu nền cho báo cáo) và đối chiếu số đã thấy trên màn hình.

Báo cáo có hai vòng: **Vòng 2 (kiểm lại sau khi đội phát triển sửa F-01…F-08)** ở mục 1–4; **Vòng 1** (lần kiểm đầu) giữ nguyên ở mục 5 làm lịch sử.

## 1. Cách chạy và kết quả (vòng 2)

```bash
cd kho/e2e
./run.sh                                   # CSDL mới kho_e2e → khoserver cổng 18091 → toàn bộ test → dừng máy chủ
./run.sh tests/15_tim_roi_enter.spec.js    # chạy riêng một câu chuyện
```
- Cần PostgreSQL 16 (role `kho`/`kho`), `backend/bin/khoserver`, `frontend/dist` đã build. Lần đầu `run.sh` tự `npm install` (exceljs, jszip; Playwright 1.63 dùng bản cài sẵn qua liên kết `file:`). Không dùng cổng 8080 / CSDL kho_dev. Biến tùy chọn: `E2E_PORT`, `E2E_DB`, `PGHOST/PGUSER/PGPASSWORD`, `E2E_CHROMIUM`.
- Mã thoát = kết quả Playwright. Đầu ra trong `e2e/out/` (không commit): `screenshots/`, `files/` (xlsx/docx đã tải, đã sửa), `ket-qua.json`, `server.log`, `browser-issues.jsonl`.

**Kết quả hai lần chạy đầy đủ liên tiếp trên mã nguồn cuối cùng:**

| Lần | Kết quả Playwright | Thời gian | Mã thoát |
|---|---|---|---|
| A | `155 passed (9.5m)` — expected 155, unexpected 0, flaky 0 | 9 phút 31 giây | 0 |
| B | `155 passed (9.4m)` — expected 155, unexpected 0, flaky 0 | 9 phút 23 giây | 0 |

155 test = **144 đạt** + **11 "lỗi đã biết"** (`test.fail`, mỗi test có chú thích trỏ tới phát hiện F-xx; khi ứng dụng sửa xong, test đó sẽ báo "Expected to fail, but passed" và phải bỏ `test.fail`). Mỗi test lỗi-đã-biết đã được kiểm là hỏng **đúng lý do** (đọc thông báo lỗi trong `ket-qua.json`), và lỗi được tái hiện ổn định (lặp 3/3 lần, hoặc lặp nhiều lần trong cùng test). Thời gian chạy tăng từ ~3,3 lên ~9,5 phút chủ yếu do ma trận tìm kiếm của câu chuyện 15 (hơn 300 lần gõ/Enter với nhiều tốc độ và độ trễ mạng).

Câu chuyện mới / viết lại ở vòng 2:
- `tests/15_tim_roi_enter.spec.js` (mới): "gõ rồi Enter" trên phiếu bán, phiếu nhập, phiếu thu, danh mục khách/NCC/hàng, danh sách phiếu bán, danh sách phiếu thu, thẻ kho, ô mã hàng — 5 tốc độ (20/60/120 ms mỗi phím, dán cả chuỗi; Enter ngay, sau 80 ms, sau 400 ms), có và không có độ trễ mạng giả lập (300/600 ms).
- `08` viết lại phần xung đột: thêm / sửa / xóa trên cả hai máy, hai máy sửa cùng một dòng, cùng mặt hàng trên hai dòng, và phiếu thu.
- `14`: F-04 theo mọi chiều (đúng người ⇒ khôi phục; người khác ⇒ không; đã lưu / đã bỏ ⇒ không còn gì; phiếu thu; đăng xuất chủ động ⇒ bỏ), nhãn ô đầu phiếu, màn hẹp 1024 px ("Thêm ▾").
- `13`: file Excel và Word **so khớp từng phần với bản in** cho cả 6 loại phiếu + phiếu tạm (`lib/printcmp.js`: tiêu đề, phụ đề, số, ngày, các dòng thông tin, bảng, dòng tổng, Nợ cũ/Tổng nợ, dòng ngày, ô ký, dòng cuối).
- `11`: "Bằng chữ" trong xlsx/docx = đúng chữ trên màn hình; so khớp bản in cho PT, BC, BN và phiếu thu không đối tác; quy tắc đọc số (24, 1.234.000 "bốn", linh, mốt, lăm, không trăm, tỷ).
- `10`: F-08 hai chiều (chưa gõ ⇒ không hỏi; gõ ghi chú / dòng tiền / số tiền / chọn khách ⇒ phải hỏi); nút In trong ngăn kéo sổ công nợ.
- `12`: nút In trong ngăn kéo thẻ kho và lịch sử bán (chỉ in ngăn kéo).
- `99`: siết lại — không còn được phép có 404 nào; 401 chỉ ở test cố ý sai mật khẩu và test cố ý làm hết phiên; màn đăng nhập của trình duyệt mới không gọi `/api/auth/me`.

## 2. Phát hiện vòng 1: đã sửa hay chưa, kiểm thế nào

| Mã | Kết luận vòng 2 | Bằng chứng |
|---|---|---|
| **F-01** khung vàng giữ cả dòng cũ, gộp bị lặp | **Đã sửa phần chính**, nhưng còn lỗi gộp khi hai máy sửa cùng một dòng ⇒ phát hiện mới **F-10** | `08`: máy 1 sửa SL MATNA, xóa BUAGO, thêm KINHBH; máy 2 sửa GANGTAY, xóa BUAGO, thêm XITHAN ⇒ khung vàng đúng 3 thay đổi của máy 1 ("Đã sửa MATNA SL 2 → 3", "Thêm mới KINHBH", "Đã xóa BUAGO"), gộp ra MATNA 3, GANGTAY 12, XITHAN 1, KINHBH 4, không lặp, máy 2 tự thấy; phiếu thu: máy 2 thêm dòng, máy 1 sửa dòng 2 ⇒ gộp đúng, tổng 3.650.000. Ảnh `08-khung-vang-chi-thay-doi-may-1.png`, `F01-sau-khi-gop.png`. |
| **F-02** xlsx/docx phiếu thu chi thiếu "Bằng chữ" | **Đã sửa** | `11`: "Bằng chữ: Tám triệu bốn trăm năm mươi lăm nghìn đồng" trong xlsx và docx, đúng y chữ trên màn hình; toàn bộ file khớp bản in cho PT, BC ("Ba triệu không trăm mười lăm nghìn đồng"), BN ("Mười triệu đồng") và phiếu thu khác 1.234.000 ("…ba mươi bốn nghìn đồng"); 9 số mẫu đọc đúng. |
| **F-03** bản in và file xuất khác nhau | **Đã sửa** | `03`, `13`: với bán, khách trả, mua, trả NCC, chuyển kho, tồn đầu, phiếu tạm — xlsx và docx bằng đúng bản in ở mọi phần (DICHVU, "Xuất từ kho:/Nhập vào kho:/Kho xuất: … → Kho nhận: …", ô ký 4/3/3/3/3/2, "Tên (MÃ)", chuyển kho không có cột giá, phụ đề và dòng cuối của phiếu tạm). Còn một lỗi trình bày chung của cả bản in và file ⇒ **F-09**. |
| **F-04** phiên hết hạn mất dòng đang gõ | **Đã sửa** | `14`: đăng nhập lại đúng người ⇒ khách, ghi chú, các dòng được khôi phục, có thông báo, lưu được; lưu xong rồi phiên ngắt nữa ⇒ không khôi phục gì; khôi phục rồi "Bỏ thay đổi" ⇒ lần sau không hiện lại; người khác (hoa) đăng nhập cùng cửa sổ ⇒ không thấy gì của lan; phiếu thu cũng khôi phục; đăng xuất chủ động ⇒ bỏ. Ảnh `F04-khoi-phuc-dong-go-do.png`. Còn thông báo sai lý do khi tải lại trang ⇒ **F-14**. |
| **F-05** Enter lấy kết quả tìm cũ | **Đã sửa cho lần tìm mới**; còn lỗi khi đổi mục đã chọn / danh sách không đổi ⇒ **F-11**, và Enter-Enter ở danh sách phiếu đôi khi mất ⇒ **F-15** | `15`: phiếu bán (4 tên × 5 tốc độ), phiếu nhập (4 × 5), phiếu thu (3 × 5), danh mục khách (4 × 5), NCC (2 × 5), hàng (3 × 5), thẻ kho (3 × 5), ô mã hàng (3 × 5), danh sách phiếu bán / phiếu thu (21 lần mỗi màn): **không lần nào chọn/mở nhầm mục**. |
| **F-06** 404 sau khi xóa phiếu, 401 ở màn đăng nhập | **Đã sửa** | `05`: không còn 404 nào sau khi xóa phiếu tạm; `99`: trình duyệt mới mở màn đăng nhập không gọi `/api/auth/me`, cả lần chạy không có 404 nào ngoài **F-16** (nguồn khác). |
| **F-07** xếp hạng/tìm đối tác | **Đã sửa cho đối tác** ("thanh cong" ⇒ Thành Công trước Tân Thành; "viet han"/"han viet" ⇒ Việt – Hàn); tìm **mặt hàng** ngoài lưới phiếu vẫn chỉ khớp chuỗi liền ⇒ **F-13**; cách xếp hạng đã chốt có điểm đáng hỏi ⇒ **F-12** | `15` (phiếu nhập, phiếu thu, danh mục NCC). |
| **F-08** hỏi "Phiếu chưa lưu" khi chưa gõ gì | **Đã sửa** (cả hai chiều) | `10`: phiếu thu từ "Thu tiền" và từ "Thu tiền phiếu này", phiếu thu mới (F2) chưa gõ ⇒ không hỏi; gõ ghi chú, gõ dòng tiền, sửa số tiền, chọn khách ⇒ có hỏi, "Ở lại phiếu" giữ chữ; `05`: phiếu nhập điền sẵn từ "Hàng cần đặt" chưa gõ ⇒ không hỏi. |

Các thay đổi đã thống nhất (không phải lỗi) đã được đưa vào kiểm tra: đọc số dùng "bốn" (24 = "Hai mươi bốn"); file xuất theo bản in (DICHVU, nhãn kho theo loại, ô ký như bản in, "Số: …", "Tên (MÃ)", "Tổng số tiền" là công thức SUM, "Kèm theo…", 5 ô ký phiếu thu chi); tìm đối tác nhiều từ có xếp hạng; nút In trong ngăn kéo; "Thêm ▾" ở màn ≤1100 px; ô đầu phiếu có nhãn thật.

## 3. Phát hiện còn lại / mới (nặng nhất trước)

**F-10 — Gộp thay đổi khi hai máy sửa CÙNG một dòng: mất phần của máy kia, sửa nhầm dòng, nhân đôi tiền.** *Lỗi (sai số liệu).* REQ-044, 060, 082. Ba trường hợp, mỗi trường hợp một test (`08`):
- Phiếu bán: máy 2 sửa giá GANGTAY 45.000→44.000 và lưu; máy 1 sửa SL 12→15 ⇒ "Thêm các dòng này vào phiếu" cho **GANGTAY 15 × 45.000** — giá máy 2 vừa sửa bị trả về cũ, không báo. HDSD: "phần máy kia đã sửa vẫn giữ". Ảnh `F10-gop-mat-gia-may-2.png`.
- Cùng mặt hàng trên hai dòng (BUAGO 5 × 35.000 và BUAGO 2 × 30.000): máy 2 sửa dòng 2 thành 3, máy 1 sửa dòng 2 thành 4 ⇒ gộp sửa nhầm **dòng 1** thành 4 × 30.000, dòng 2 vẫn 3. Ảnh `F10-gop-sua-nham-dong.png`.
- **Phiếu thu (nặng nhất):** máy 2 sửa diễn giải dòng 1, máy 1 sửa số tiền dòng 1 (1.000.000→1.500.000) ⇒ gộp ra **hai dòng tiền** ("Thu đợt 1 (tiền mặt)" 1.000.000 và "Thu đợt 1" 1.500.000) ⇒ nếu bấm lưu, tổng thu bị cộng thêm 1.000.000. Ảnh `F10-phieu-thu-nhan-doi-dong.png`.

**F-11 — Ô chọn khách / mặt hàng: Enter không chọn mục mới.** *Lỗi (khả dụng, có thể sai số liệu).* REQ-018, 025.
- (a) Đã chọn một khách (vd. chọn nhầm), gõ tên khách khác, đợi danh sách hiện (khách mới đứng đầu), Enter ⇒ **phiếu vẫn giữ khách cũ**, không báo gì (3/3; chỉ khi Enter thật nhanh < 0,1 s mới đổi được). Ghi sổ sẽ vào công nợ khách cũ. Nguyên nhân thấy được: danh sách gợi ý đặt **khách đang chọn lên đầu** (thứ tự thực tế: "ANPHU | THANHCONG | TC2" khi gõ "thanh cong") nên Enter lấy lại khách cũ. Cùng lỗi ở ô chọn mặt hàng của Thẻ kho (đã chọn KT40, gõ GL26, Enter ⇒ vẫn KT40). Ảnh `F11-doi-khach-van-giu-khach-cu.png`.
- (b) Danh mục chỉ có một khách (công ty mới bắt đầu dùng — đúng như khi chạy riêng câu chuyện 10 trên CSDL mới): bán cho khách, rồi lập "Khách trả hàng", gõ tên, danh sách hiện đúng khách nhưng không mục nào sáng; Enter **không chọn gì và xóa chữ đã gõ** (3/3). Test giả lập "chỉ có một khách" bằng cách trả danh sách ban đầu bằng đúng kết quả tìm. Ảnh `F11-mot-khach-enter-khong-chon.png`.
- Các test khác dùng cách người dùng làm khi không thấy mục sáng (↓ rồi Enter) — có chú thích trỏ về F-11.

**F-09 — Khách không có địa chỉ: phiếu in "Địa chỉ:  · ĐT: 0918 777 888".** *Trình bày (phiếu gửi khách).* REQ-073. Nhãn "Địa chỉ:" trống với dấu "·" treo, trên bản in và cả xlsx/docx. Mong đợi: chỉ "ĐT: …" (hoặc bỏ nhãn trống). Ảnh `F09-dia-chi-trong.png`.

**F-15 — Danh sách phiếu bán / phiếu thu: dán số phiếu rồi Enter, Enter khi mạng chậm thường không mở gì.** *Khả dụng (thấp).* REQ-037, 060. 8/42 lần (chỉ ở trường hợp dán + mạng trễ 0,6 s; không lần nào mở nhầm phiếu). Trái với cách sửa F-05 đã nêu ("Enter 2 lần ⇒ mở luôn dòng đầu").

**F-12 — Câu hỏi về cách xếp hạng tìm đối tác.** *Câu hỏi cho khách / khả dụng.* REQ-025. Theo quy tắc đã chốt (API.md §2.3), "tên chứa cụm từ ở đầu một từ" (mức 2, khớp được cả **một phần** từ) đứng trên "mọi từ là từ nguyên" (mức 3). Gõ đủ "minh phu" ⇒ "Công ty Minh Phước" đứng trước "Đại lý Minh Phú" và được chọn khi Enter. Đúng quy tắc, nhưng có lẽ không đúng ý người gõ. Ảnh `F12-minh-phu-chon-minh-phuoc.png`.

**F-13 — Tìm mặt hàng nhiều từ chỉ có ở ô Mã hàng của phiếu.** *Khả dụng / không nhất quán (phần còn lại của F-07).* REQ-012, 020. Ở Danh mục hàng hóa, Tồn kho, Thẻ kho: "que 3.2", "cap 35", "kim tin 4.0" không ra kết quả nào; ô Mã hàng của phiếu và ô đối tác thì khớp nhiều từ.

**F-14 — Tải lại trang khi đang gõ phiếu: thông báo sai lý do.** *Khả dụng (thấp) / câu hỏi.* Trình duyệt hỏi "rời trang?", người dùng đồng ý tải lại ⇒ phiếu gõ dở hiện lại (có thể là tiện) nhưng kèm "Đã khôi phục … (phiên đăng nhập trước bị ngắt)" — phiên không hề bị ngắt. Hệ quả phụ: phiếu đã "bỏ" bằng cách tải lại vẫn quay lại ở phiếu mới kế tiếp. Ảnh `F14-bao-sai-phien-bi-ngat.png`.

**F-16 — Gõ mã hàng từng chữ sinh 404 đỏ trong console.** *Lỗi nhỏ (người dùng không thấy).* Ô Mã hàng tra "mã chính xác" cho từng tiền tố ("K", "KT", "KT4"…) ⇒ mỗi lần gõ chậm là một phản hồi 404 và một dòng lỗi đỏ. Test 99 tách riêng nguồn này (các 404 khác đều bị cấm).

**Ghi nhận thêm (không thành test):**
- Gõ ngày phiếu thu chỉ ~0,1 s sau khi mở phiếu mới thì đôi khi (3/60) ngày bị bỏ qua, trở về hôm nay; chờ 0,4 s (tốc độ người) thì 0/60. Tốc độ máy, không coi là lỗi; helper của bộ test chờ con trỏ vào ô đối tác rồi mới gõ.
- Trong quá trình làm, một lần chạy đầy đủ hỏng ở `10` vì chính test sửa số tiền trước khi dòng "Thu tiền phiếu này" kịp điền sẵn (điền sẵn đến sau, đè lên); đã sửa test chờ dòng điền sẵn hiện rồi mới sửa — đúng như người dùng. Sau đó chạy lại hai lần liên tiếp mới (bảng trên).
- Một lần trong 3 lần chạy đầy đủ giữa chừng (trước khi chốt mã test), test F-04 "người khác đăng nhập cùng cửa sổ" hỏng ở bước bấm menu (không chuyển trang); không tái hiện được khi chạy riêng (3/3 đạt) hay khi dò riêng (25/25). Đã gắn ảnh chẩn đoán vào bước đó (`out/screenshots/loi-F04-hoa-khong-roi-phieu.png` nếu tái diễn). Hai lần chạy cuối không gặp.
- Mẫu khách ghi "Nợ cũ : 10/8/26 2.000.000" (có ngày); phần mềm in "Nợ cũ:" không ngày — câu hỏi cho khách (từ vòng 1, vẫn vậy).

## 4. REQ không kiểm được trên trình duyệt / giới hạn

- **REQ-001…008**: phân tích, chốt quy tắc — kiểm gián tiếp qua hành vi.
- **REQ-088** UAT (cần khách), **REQ-089** sửa lỗi, **REQ-091** bàn giao: ngoài phạm vi tự động. **REQ-090** hướng dẫn: đã đối chiếu nhiều câu trong HDSD (cả các câu mới về tìm nhiều chữ, khung vàng, khôi phục phiếu gõ dở); lệch ở F-10, F-11, F-15.
- Không in ra giấy (kiểm bản xem trước, và "chỉ in ngăn kéo" bằng giả lập `@media print`); không mở file bằng Excel/Word thật (exceljs/jszip); "hai máy" là hai ngữ cảnh trình duyệt; độ trễ mạng là giả lập bằng `page.route`; không kiểm hiệu năng dữ liệu lớn.

## 5. Lịch sử — Vòng 1

Kết quả vòng 1: 117 test (108 đạt + 9 lỗi đã biết), 2 lần chạy liên tiếp xanh, ~3,3 phút. Phát hiện vòng 1 (xem kết luận vòng 2 ở mục 2):

- **F-05** Ô tìm lấy kết quả CŨ khi bấm Enter: phiếu bán gõ "an phu" + Enter ⇒ chọn "An Bình"; danh mục khách "thanh cong" + Enter, Enter ⇒ mở "ANBINH".
- **F-07** Phiếu thu: "thanh cong" + Enter ⇒ chọn "TANTHANH – Thép Tân Thành"; tìm đối tác chỉ khớp chuỗi liền ("viet han" không ra "Việt – Hàn").
- **F-01** Xung đột hai máy: khung vàng giữ cả dòng cũ; "Thêm các dòng này vào phiếu" làm lặp dòng (MATNA 2 lần, GANGTAY 10 cạnh 12).
- **F-02** xlsx/docx phiếu thu chi không có "Bằng chữ".
- **F-04** Phiên hết hạn khi đang gõ phiếu ⇒ mất toàn bộ dòng đã gõ.
- **F-03** Bản in ghi DICHVU, file ghi DV; ô ký và nhãn kho khác nhau giữa bản in và file.
- **F-08** Phiếu thu mở từ "Thu tiền" chưa gõ gì vẫn hỏi "Phiếu chưa lưu".
- **F-06** Sau khi xóa phiếu tạm vẫn gọi phiếu đã xóa (404); màn đăng nhập gọi `/api/auth/me` (401 đỏ trong console).
- Ghi nhận vòng 1: cắt chữ "Khoảng ngà…" (vòng 2: ô được nới rộng 132→158 px, không kiểm bằng test); ô đầu phiếu không có nhãn (vòng 2: đã có nhãn, có test); "Nợ cũ" không có ngày như mẫu khách (còn nguyên, là câu hỏi).
