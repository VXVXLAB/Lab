# Báo cáo kiểm thử nghiệm thu đầu-cuối (E2E) — Phần mềm Quản lý Kho

Người kiểm thử độc lập, đóng vai kế toán của khách, thao tác trên trình duyệt thật (Chromium, 1366×768) bằng nhãn tiếng Việt, vai trò và bàn phím. API chỉ dùng để chuẩn bị dữ liệu nền (danh mục, tồn đầu, phiếu nền cho báo cáo) và đối chiếu số đã thấy trên màn hình.

Báo cáo có ba vòng: **Vòng 3 (kiểm lại sau khi đội phát triển sửa F-09…F-16)** ở mục 1–4; **Vòng 2** giữ nguyên ở mục 5 và **Vòng 1** ở mục 6 làm lịch sử.

## 1. Cách chạy và kết quả (vòng 3)

```bash
cd kho/e2e
./run.sh                                   # CSDL mới kho_e2e → khoserver cổng 18091 → toàn bộ test → dừng máy chủ
./run.sh tests/08_hai_may.spec.js          # chạy riêng một câu chuyện
```
- Cần PostgreSQL 16 (role `kho`/`kho`), `backend/bin/khoserver`, `frontend/dist` đã build. Lần đầu `run.sh` tự `npm install` (exceljs, jszip; Playwright 1.63 dùng bản cài sẵn qua liên kết `file:`). Không dùng cổng 8080 / CSDL kho_dev. Biến tùy chọn: `E2E_PORT`, `E2E_DB`, `PGHOST/PGUSER/PGPASSWORD`, `E2E_CHROMIUM`.
- Mã thoát = kết quả Playwright. Đầu ra trong `e2e/out/` (không commit): `screenshots/`, `files/`, `ket-qua.json`, `server.log`, `browser-issues.jsonl`.

**Kết quả hai lần chạy đầy đủ liên tiếp trên mã nguồn cuối cùng (frontend `f27ce0a`, backend `edb163d`):**

| Lần | Kết quả Playwright | Thời gian | Mã thoát |
|---|---|---|---|
| A | `167 passed (9.4m)` — expected 167, unexpected 0, flaky 0 | 9 phút 25 giây | 0 |
| B | `167 passed (9.4m)` — expected 167, unexpected 0, flaky 0 | 9 phút 28 giây | 0 |

167 test = **165 đạt** + **2 "lỗi đã biết"** (`test.fail`: F-17, F-18 — mỗi test có chú thích trỏ tới phát hiện; đã kiểm là hỏng đúng lý do). Lỗi chập chờn **F-19** không gắn `test.fail` (mục 3) nên thỉnh thoảng một lần chạy đầy đủ hỏng ở `14` — lỗi của ứng dụng, không phải của test. Vòng 2 có 155 test (144 + 11 lỗi đã biết).

Lần chạy cơ sở (bộ test vòng 2 trên mã vòng 3, trước khi sửa test): `5 failed, 15 did not run, 135 passed` — 4 test "lỗi đã biết" báo **"Expected to fail, but passed"** (F-10 phiếu bán khác ô, F-09, F-15, F-16) và 1 hỏng thật ở `12` "Lịch sử bán theo mặt hàng" ⇒ phát hiện mới **F-17**.

Các lần chạy đầy đủ trước khi chốt (ghi đúng nguyên văn): (1) `1 failed, 6 did not run, 160 passed` — hỏng ở `01` do helper của test (xem dưới); (2) `1 failed, 5 did not run, 161 passed` — hỏng ở `14` do **F-19** (lỗi chập chờn của ứng dụng); (3) `167 passed`; (4) `1 failed, 4 did not run, 162 passed` — hỏng ở `15` F-11 do test gõ lại ô Khách trước khi con trỏ tự sang ô Kho xong (một nhịp sau khi chọn) ⇒ sửa test chờ con trỏ vào ô Kho như người dùng thấy, lặp 5/5 đạt; (5)–(6) = A, B ở bảng trên.

Trong quá trình chốt, một lần chạy đầy đủ hỏng ở `01` (thêm mặt hàng) do chính helper của bộ test: bấm Esc để đóng danh sách F-17 cả ở ô chọn thường (Nhóm hàng) đang đóng dần ⇒ Esc đóng luôn hộp thoại. Đã giới hạn bước Esc chỉ cho ô tìm có "chặn Enter" ngoài biểu mẫu (đúng nơi F-17 xảy ra), rồi chạy lại.

Thay đổi bộ test ở vòng 3:
- `08` viết lại phần xung đột theo quy tắc gộp ba chiều đã chốt: 11 vòng xung đột liên tiếp trên CÙNG một phiếu tạm, rồi ghi sổ, rồi xung đột trên phiếu ĐÃ GHI SỔ, rồi cùng mặt hàng trên BA dòng (3 vòng), rồi 6 vòng phiếu thu. **Sau mỗi vòng** kiểm: các dòng trên máy 1 sau gộp, **phiếu đã lưu trên máy chủ** (mã:SL@giá theo thứ tự), tổng tiền máy chủ, máy 2 tự hiện đúng như vậy, chân phiếu "Cộng" của cả hai máy, tồn kho và công nợ (phiếu tạm: không đổi; ghi sổ / sửa phiếu đã ghi sổ: đổi đúng phần chênh; phiếu thu: công nợ = trước − tổng phiếu).
- `15`: bỏ `test.fail` F-11/12/13/14/15 và siết thêm (xem mục 2); thêm F-17 (`test.fail`) và test ngày gõ ngay khi mở phiếu.
- `lib/ui.js`: `selectByTyping` không bấm ↓ hộ người dùng nữa (F-11 b đã sửa); `enterVoucher` không chờ con trỏ vào ô đối tác nữa (ngày gõ ngay phải được giữ).
- `13`: F-09 thành test thường, kiểm cả "ĐT" vẫn có. `14`: thông báo khôi phục khi phiên hết phải đúng nguyên câu "Phiên đăng nhập đã hết. Đã khôi phục các dòng đang gõ dở — kiểm tra rồi bấm Lưu.". `99`: bỏ ngoại lệ 404 cho tra mã — **không còn được phép có 404 nào**.
- Thời gian chạy giữ ~9,5–10 phút: không cắt ma trận câu chuyện 15 (giữ nguyên độ phủ); phần thêm của `08` chỉ ~35 giây.

## 2. Phát hiện vòng 2: đã sửa hay chưa, kiểm thế nào

| Mã | Kết luận vòng 3 | Bằng chứng |
|---|---|---|
| **F-10** gộp hai máy sửa cùng dòng | **Đã sửa** (phiếu tạm, phiếu đã ghi sổ, phiếu thu). Còn một điểm khả dụng ở phiếu đã ghi sổ ⇒ **F-18** | `08`, 20 vòng xung đột, đều kiểm bản lưu trên máy chủ + máy 2 + tổng + tồn + nợ: (1) mỗi máy thêm/sửa/xóa dòng khác nhau ⇒ MATNA 3, GANGTAY 12, XITHAN 1, KINHBH 4; (2) cùng dòng khác ô: SL 15 (tôi) + giá 44.000 (máy kia) ⇒ GANGTAY 15 × 44.000, khung vàng chỉ "Đã sửa GANGTAY"; (3) cùng ô: "Cùng sửa: SL — máy kia: 5, bạn: 6", mặc định ⇒ 5; (4) cùng ô giá, chọn "Dùng của tôi" ⇒ 55.000; (5) tôi sửa, máy kia xóa ⇒ "Máy kia đã xóa dòng này, bạn đã sửa", mặc định ⇒ dòng mất; (6) như trên, chọn của tôi ⇒ dòng còn với SL của tôi (đứng cuối phiếu — chấp nhận); (7) tôi xóa, máy kia sửa ⇒ "Máy kia đã sửa dòng này, bạn đã xóa", mặc định ⇒ dòng còn, SL máy kia; (8) tôi dời dòng, máy kia sửa SL ⇒ thứ tự của tôi + số máy kia, có mục "Đổi thứ tự"; (9) cả hai dời ⇒ "Cùng đổi thứ tự", mặc định thứ tự máy kia; (10) tôi xóa rồi thêm lại y hệt, máy kia sửa dòng khác ⇒ chỉ một KINHBH; (11) tôi xóa+thêm lại, máy kia sửa chính dòng cũ, chọn của tôi ⇒ chỉ một KINHBH. Ghi sổ ⇒ tồn MATNA −8, GANGTAY −16, KINHBH −9, nợ +3.999.000. Phiếu đã ghi sổ: máy 2 sửa giá MATNA 340.000, máy 1 sửa SL GANGTAY 20 ⇒ gộp đúng, tồn GANGTAY −4, nợ +96.000. BA dòng BUAGO: mỗi máy sửa một dòng ⇒ đúng dòng; cùng sửa dòng 2 ⇒ mặc định của máy kia; cùng sửa dòng 3, chọn của tôi ⇒ đúng dòng 3. Phiếu thu: thêm vs sửa (3.650.000); diễn giải vs số tiền cùng dòng ⇒ **một** dòng, 4.150.000 (vòng 2 nhân đôi); cùng số tiền mặc định / chọn của tôi; xóa vs sửa hai chiều — công nợ khách khớp sau từng vòng. |
| **F-11** Enter không chọn mục mới | **Đã sửa** | `15`: đã chọn An Phú, gõ "thanh cong", đợi danh sách, Enter ⇒ Thành Công (3/3), và danh sách khi đang gõ **không** có An Phú; ↓ rồi Enter ⇒ đúng mục thứ hai (TC2); gõ chữ không có kết quả rồi Enter ⇒ chữ gõ còn nguyên, khách không đổi; thẻ kho đổi KT40 → GL26 được; danh mục một khách ⇒ Enter chọn Minh Tâm và sang ô Kho. Mọi test khác chọn bằng gõ + Enter, không còn ↓. |
| **F-12** "minh phu" chọn "Minh Phước" | **Đã sửa** | `15`: gõ và dán "minh phu" ⇒ DLMP đứng đầu và được chọn. |
| **F-13** tìm mặt hàng nhiều từ | **Đã sửa** | `15`: "que 3.2", "3.2 que", "cap 35", "35 cap", "kim tin 4.0" ở Danh mục hàng hóa, Tồn kho, Thẻ kho: mặt hàng mong đợi có mặt và **mọi** dòng chứa đủ các từ; thẻ kho "kim tin 4.0" + Enter ⇒ KT40. |
| **F-14** thông báo khôi phục sai lý do | **Đã sửa** | `15`: tải lại trang ⇒ đúng một thông báo "Đã khôi phục các dòng đang gõ dở từ lần mở trước — kiểm tra rồi bấm Lưu.", dòng và khách còn đúng; `14`: phiên hết thật ⇒ đúng câu "Phiên đăng nhập đã hết. …" (3 test). |
| **F-15** Enter, Enter ở danh sách phiếu bị mất | **Đã sửa** | `15`: 42/42 lần mở đúng phiếu (5 tốc độ, dán + mạng trễ 0,6 s lặp 3 lần), không lần nào trượt hay mở nhầm. |
| **F-16** 404 khi gõ mã | **Đã sửa** | `99`: cả lần chạy (hàng trăm lần gõ mã) **không có 404 nào**; ngoại lệ đã bỏ. |
| **F-09** "Địa chỉ:  · ĐT" | **Đã sửa** | `13`: bản in, xlsx, docx của khách không địa chỉ: không có nhãn "Địa chỉ:" trống hay "·" treo, "0918 777 888" vẫn có. |
| Ghi nhận vòng 2: ngày phiếu thu gõ quá sớm bị đặt lại | **Đã sửa** | `15`: mở phiếu thu, phiếu chi, phiếu bán rồi gõ ngày **ngay** (không chờ gì), 3 lần mỗi loại ⇒ 9/9 giữ đúng ngày; `enterVoucher` (dùng ở 10, 11, 14, 08) không còn chờ. |

## 3. Phát hiện mới vòng 3 (nặng nhất trước)

**F-17 — Ô chọn mặt hàng ở bộ lọc (Thẻ kho, Lịch sử bán theo mặt hàng): Enter chọn xong nhưng danh sách không đóng; Enter lần nữa đổi lựa chọn.** *Lỗi (khả dụng, có thể xem nhầm số liệu). Hồi quy so với vòng 2.* REQ-012, 021, UX.
- Bước: Báo cáo → Lịch sử bán theo mặt hàng → ô "Mặt hàng…" gõ `E6013-25` → Enter.
- Mong đợi: chọn E6013-25, danh sách đóng (mã nguồn `searchGuard` cũng ghi ý định "đóng danh sách").
- Thực tế: chọn đúng, bảng lọc đúng, nhưng sau ~0,5 s danh sách hiện lại **toàn bộ** danh mục, che bảng kết quả, mục đầu ("DV – Dịch vụ") sáng. Bấm Enter lần nữa (thói quen "Enter, Enter") ⇒ lựa chọn đổi sang **DV**, bảng thành "Không có số liệu". Cùng lỗi ở Thẻ kho. Esc thì đóng và giữ lựa chọn. Vòng 2 test `12` bấm được dòng báo cáo; vòng 3 bị danh sách che (đây là lỗi duy nhất của lần chạy cơ sở).
- Test: `15` "F-17 …" (`test.fail`); helper `selectByTyping` bấm Esc như người dùng khi thấy danh sách còn mở (chú thích trỏ F-17). Ảnh `F17-the-kho-danh-sach-con-mo.png`, `F17-lich-su-ban-danh-sach-con-mo.png`.

**F-19 — Phiên của người này hết, NGƯỜI KHÁC đăng nhập trên cùng cửa sổ: thỉnh thoảng phiếu mới trống của người sau báo "Đã khôi phục…" và "Có thay đổi chưa lưu".** *Lỗi chập chờn (khả dụng; cơ chế đáng ngại về tách dữ liệu giữa người dùng).* REQ-UX, F-04.
- Bước: lan gõ dở phiếu bán (khách, ghi chú, dòng) → phiên lan bị ngắt → Ctrl+S → màn đăng nhập → **hoa** đăng nhập trên cùng cửa sổ → mở phiếu bán mới.
- Mong đợi: phiếu trống, không thông báo khôi phục, không "thay đổi chưa lưu" (đúng như phần lớn các lần).
- Thực tế (khoảng 1/10–1/20 lần): phiếu trống (không khách, không dòng, không ghi chú — **chưa thấy lộ dữ liệu của lan**) nhưng hiện "Đã khôi phục các dòng đang gõ dở từ lần mở trước — kiểm tra rồi bấm Lưu.", chân phiếu "Có thay đổi chưa lưu", bấm menu thì hỏi "Phiếu chưa lưu". Nghĩa là đã có một bản gõ dở được ghi dưới tên **hoa** dù hoa chưa gõ gì — nhiều khả năng màn phiếu còn mở từ phiên lan ghi lại sau khi hoa đăng nhập.
- Tần suất: 1 lần chạy đầy đủ ở vòng 2 và 1/3 lần chạy đầy đủ ở vòng 3 (hỏng ở bước bấm menu); lặp riêng 4 test F-04: 1/12 và 1/20. Không tái hiện chắc chắn ⇒ **không gắn `test.fail`**; test `14` "F-04: … người KHÁC (hoa) …" giữ nghiêm và nay kiểm thẳng (không thông báo khôi phục, không "thay đổi chưa lưu") nên khi lỗi xảy ra, test hỏng với đúng thông điệp này. Ảnh `F19-phieu-trong-bao-chua-luu.png`.

**F-18 — Đang sửa phiếu ĐÃ GHI SỔ, máy khác lưu trước: sau "Tải bản mới" phiếu thoát chế độ sửa, khung vàng không có nút gộp.** *Khả dụng (thấp).* REQ-038, 082.
- Bước: hai máy mở cùng phiếu đã ghi sổ, cùng F8; máy 2 sửa giá MATNA, Ctrl+S; máy 1 (đã sửa SL GANGTAY) Ctrl+S ⇒ "Máy khác vừa sửa phiếu này" ⇒ "Tải bản mới".
- Mong đợi: như phiếu tạm — vẫn đang sửa, khung vàng có "Thêm các dòng này vào phiếu".
- Thực tế: phiếu về trạng thái "ĐÃ GHI SỔ" (không sửa), khung vàng "1 thay đổi của máy này, chưa lưu" chỉ có "Chép" / "Ẩn", không nói phải bấm F8. Bấm F8 lại thì nút gộp hiện và gộp đúng (đã kiểm số, tồn, nợ).
- Test: `08` "F-18 …" (`test.fail`). Ảnh `F18-phieu-ghi-so-sau-tai-ban-moi.png`.

**Ghi nhận (không thành lỗi):** F-10 vòng 6 — chọn "Dùng của tôi" cho dòng máy kia đã xóa thì dòng được giữ nhưng chuyển xuống **cuối** phiếu (thứ tự theo máy kia, nơi dòng đã mất). Hợp với quy tắc "mặc định thứ tự của máy kia"; màn hình = bản lưu = máy kia. Có thể hỏi khách có muốn dòng giữ chỗ cũ không.

**Các ghi nhận cũ còn nguyên:** "Nợ cũ" không ghi ngày như mẫu khách (câu hỏi cho khách, từ vòng 1).

## 4. REQ không kiểm được trên trình duyệt / giới hạn

- **REQ-001…008**: phân tích, chốt quy tắc — kiểm gián tiếp qua hành vi.
- **REQ-088** UAT (cần khách), **REQ-089** sửa lỗi, **REQ-091** bàn giao: ngoài phạm vi tự động. **REQ-090** hướng dẫn: đối chiếu ở các vòng trước (mục 5, 6); vòng 3 không đối chiếu lại toàn bộ HDSD.
- Không in ra giấy (kiểm bản xem trước và giả lập `@media print`); không mở file bằng Excel/Word thật (exceljs/jszip); "hai máy" là hai ngữ cảnh trình duyệt; độ trễ mạng giả lập bằng `page.route`; không kiểm hiệu năng dữ liệu lớn.

## 5. Lịch sử — Vòng 2

### 5.1 Cách chạy và kết quả (vòng 2)

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

### 5.2 Phát hiện vòng 1: đã sửa hay chưa (vòng 2)

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

### 5.3 Phát hiện còn lại / mới ở vòng 2

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

### 5.4 REQ không kiểm được (vòng 2)

- **REQ-001…008**: phân tích, chốt quy tắc — kiểm gián tiếp qua hành vi.
- **REQ-088** UAT (cần khách), **REQ-089** sửa lỗi, **REQ-091** bàn giao: ngoài phạm vi tự động. **REQ-090** hướng dẫn: đã đối chiếu nhiều câu trong HDSD (cả các câu mới về tìm nhiều chữ, khung vàng, khôi phục phiếu gõ dở); lệch ở F-10, F-11, F-15.
- Không in ra giấy (kiểm bản xem trước, và "chỉ in ngăn kéo" bằng giả lập `@media print`); không mở file bằng Excel/Word thật (exceljs/jszip); "hai máy" là hai ngữ cảnh trình duyệt; độ trễ mạng là giả lập bằng `page.route`; không kiểm hiệu năng dữ liệu lớn.

## 6. Lịch sử — Vòng 1

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
