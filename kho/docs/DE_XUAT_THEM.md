# GHI CHÚ: NHỮNG GÌ THÊM NGOÀI FILE YÊU CẦU

Theo mẫu sheet "ĐỀ XUẤT CHỈNH SỬA" trong file TODO: mỗi mục một dòng, hai bên xác nhận trước khi coi là
phạm vi chính thức. Mục chưa được duyệt **không phải cam kết**.

Trạng thái: **Đã làm** = đã có trong phần mềm, bỏ được nếu anh không cần
**Đề xuất** = chưa làm, chờ anh quyết.

## A. Đã thêm vào phần mềm (ngoài file yêu cầu)

| # | Nội dung | Lý do | Mã liên quan | Trạng thái |
|---|---|---|---|---|
| A1 | Lịch sử sửa của từng phiếu: ai sửa, lúc nào, sửa gì (vd "SL 30 → 35") | Cho phép sửa phiếu cũ bất kỳ lúc nào thì phải truy được ai sửa | 003, 036, 038 | Đã làm |
| A2 | Chặn hai máy ghi đè nhau: máy lưu sau được báo "phiếu vừa được … sửa", giữ lại những dòng đang gõ | Hai máy cùng làm một phiếu tạm là tình huống chính của khách | 042–044 | Đã làm |
| A3 | Chặn hai máy cùng bán vượt tồn (chỉ phiếu đủ hàng được ghi sổ) | Tránh âm kho khi 2 kế toán bán cùng lúc | 030, 031 | Đã làm |
| A4 | Chặn sửa/bỏ ghi sổ phiếu cũ nếu làm âm kho ở bất kỳ ngày nào về sau | Sửa phiếu nhập tháng 1 khi tháng 9 đã bán hết | 003, 039 | Đã làm |
| A5 | Bỏ ghi sổ (đưa phiếu về phiếu tạm), giữ nguyên số chứng từ | Sửa lớn mà không mất số phiếu đã gửi khách | 003 | Đã làm |
| A6 | Hoàn tiền: NCC hoàn tiền / trả lại tiền cho khách ghi đúng sổ công nợ | Bản đầu làm sai cả hai sổ khi có hoàn tiền | 062 | Đã làm |
| A7 | Không cho xóa phiếu tạm đang được phiếu thu tham chiếu | Tránh phiếu thu "mồ côi" | 062 | Đã làm |
| A8 | Tìm kiếm không dấu ở mọi nơi ("vinh phong" ra "VĨNH PHONG") | Kế toán hay gõ không dấu | — | Đã làm |
| A9 | Gõ số kiểu Việt: `150k`, `2,5tr`, `1.500.000`; gõ ngày `2509` ra 25/09 | Nhập liệu nhanh bằng bàn phím số | — | Đã làm |
| A10 | Khi lập phiếu: xem ngay tồn từng kho, giá mua gần nhất, "lần trước bán mã này cho ai, giá bao nhiêu" (F6/F7) | Kế toán hay phải tra lại khi báo giá | 021, 028 | Đã làm |
| A11 | Hàng cần đặt: bấm một nút mở sẵn phiếu nhập với số lượng thiếu | Nối phiếu tạm sang đặt hàng | 046 | Đã làm |
| A12 | Trang tổng quan: phiếu tạm đang treo, doanh thu ngày/tháng, phải thu, phải trả, tiền mặt, ngân hàng, hàng sắp hết | Nhìn một màn hình biết việc đầu ngày | — | Đã làm |
| A13 | Thông tin công ty in lên đầu phiếu và file xuất | Phiếu gửi khách cần tên, địa chỉ, MST | 071–073 | Đã làm |
| A14 | Người dùng tự đổi mật khẩu; quản trị quản lý tài khoản; khóa tài khoản là đăng xuất ngay | Nhiều kế toán dùng chung hệ thống | — | Đã làm |
| A15 | Báo cáo cũng xuất được Word (yêu cầu chỉ nêu Excel) | Chi phí thấp | 008 | Đã làm |
| A16 | Ô "Cộng" và "Tổng nợ" trong Excel là công thức, thêm dòng thì tự cộng | Đúng tinh thần "xuất ra rồi chỉnh sửa, thêm bớt dòng" | 074 | Đã làm |
| A17 | Thêm nhanh khách hàng / NCC ngay trong phiếu (F4) | Khách mới gọi đặt hàng không phải thoát phiếu | — | Đã làm |
| A18 | Ghi chú từng dòng hàng, đổi thứ tự dòng | Tiện khi làm phiếu dài | — | Đã làm |
| A19 | Trả hàng nhà cung cấp, tồn đầu kỳ, công nợ đầu kỳ | Cần để chạy thật (yêu cầu chỉ nêu khách trả hàng) | 013, 052, 054 | Đã làm |
| A20 | Phiếu thu/chi có dòng "Bằng chữ", in khổ A5; thu/chi ngay từ phiếu bán/mua | Thói quen chứng từ kế toán | 056–059 | Đã làm |
| A21 | Hướng dẫn sử dụng ngay trong phần mềm; màn hình dẫn dắt khi mới cài | Mục 090; người dùng không rành công nghệ | 090 | Đã làm |

## B. Quy tắc em tự chốt, cần anh hoặc khách xác nhận

| # | Quy tắc đang áp dụng | Phương án khác nếu khách muốn |
|---|---|---|
| B1 | Giá mua để cảnh báo bán lỗ = đơn giá nhập gần nhất (chưa nhập thì giá mua mặc định) | Bình quân gia quyền |
| B2 | Bán lỗ chỉ cảnh báo và bắt xác nhận, không chặn | Chặn hẳn, hoặc chỉ quản trị được duyệt |
| B3 | Phiếu tạm không giữ hàng, nhập được hàng chưa có tồn | Có thêm loại "giữ hàng" |
| B4 | Phiếu tạm in được nhưng ghi rõ "PHIẾU TẠM (chưa ghi sổ)"; phiếu chính thức chỉ in sau khi ghi sổ | Cấm in hẳn phiếu tạm khi thiếu hàng |
| B5 | Không khóa kỳ: phiếu cũ sửa được mãi | Khóa sổ theo tháng/năm, chỉ quản trị mở |
| B6 | Thẻ kho xem "Tất cả kho" thì ẩn dòng chuyển kho nội bộ | Hiện cả hai dòng nhập và xuất |
| B7 | Số chứng từ: NK (mua, khách trả), XK (bán, trả NCC), CK, TDK, PT/PC/BC/BN, 5 chữ số | Theo cách đánh số hiện tại của khách |
| B8 | Kế toán làm được mọi nghiệp vụ; chỉ quản trị quản lý người dùng | Phân quyền theo vai trò (xem B-đề xuất C1) |
| B9 | Chi tiền làm âm quỹ/ngân hàng vẫn cho; khách trả hàng không bắt phải từng mua mã đó | Chặn |
| B10 | Ngưỡng "hàng sắp hết" = tồn ≤ 5 cho mọi mã | Đặt mức tồn tối thiểu riêng từng mã |

## C. Đề xuất chưa làm (chờ anh quyết)

| # | Đề xuất | Lợi ích | Ưu tiên em gợi ý |
|---|---|---|---|
| C1 | Phân quyền chi tiết: kế toán bán, kế toán mua, thủ kho (chỉ xem), quản trị; quyền sửa phiếu đã ghi sổ, quyền xem giá mua | Giá mua và việc sửa phiếu cũ là thứ nhạy cảm | Cao |
| C2 | Sao lưu dữ liệu tự động hằng ngày + hướng dẫn khôi phục | Một máy chủ hỏng là mất toàn bộ sổ sách | Đã làm: bộ cài tự đặt lịch sao lưu 12:15 và 18:30 hằng ngày, có lệnh khôi phục. Còn lại: đặt thư mục lưu ngoài máy chủ (SAO_LUU_THU_MUC_2) trên máy thật |
| C3 | Nhập danh mục và tồn đầu kỳ từ Excel (hàng hóa, khách, NCC, tồn 4 kho, công nợ đầu kỳ) | Chuyển dữ liệu từ phần mềm cũ, không phải gõ tay vài nghìn mã | Cao |
| C4 | Khóa sổ theo kỳ | Tránh sửa nhầm số liệu đã báo cáo thuế | Trung bình |
| C5 | Mức tồn tối thiểu từng mã + cảnh báo | "Hàng sắp hết" sát thực tế hơn | Trung bình |
| C6 | Bảng giá theo khách hàng / nhớ giá bán lần trước cho từng khách | Khách quen có giá riêng | Trung bình |
| C7 | Báo cáo lãi gộp theo phiếu, theo mặt hàng, theo khách | Đã có giá vốn và giá bán | Trung bình |
| C8 | Hạn mức nợ và tuổi nợ (nợ quá 30/60/90 ngày), cảnh báo khi bán cho khách vượt hạn mức | Kiểm soát công nợ | Trung bình |
| C9 | Kiểm kê kho: phiếu kiểm kê, tự sinh chênh lệch thừa/thiếu | Hiện chỉ có nhập, xuất, chuyển kho | Trung bình |
| C10 | Quy đổi đơn vị tính (thùng ↔ kg, bao ↔ cái) | Ví dụ khách có "50c/bao", "Thùng 20kg" | Thấp – cần hỏi khách |
| C11 | Thuế GTGT trên phiếu và nối hóa đơn điện tử | File yêu cầu không nhắc tới thuế | Cần hỏi khách |
| C12 | Mẫu in theo mẫu riêng của công ty (logo, khổ giấy, in kim) | Hiện là mẫu chung A4/A5 | Thấp |
| C13 | HTTPS và truy cập từ ngoài văn phòng | Hiện thiết kế cho mạng nội bộ | Thấp |

## D. Cần máy và người thật của anh (em không tự kiểm được)
- Gõ tiếng Việt bằng Unikey/Telex trên Windows thật.
- In ra máy in thật (A4, A5).
- Mở file Excel/Word bằng Microsoft Office thật (em mới kiểm bằng thư viện đọc file).
- Hai máy trên mạng LAN thật (em mới giả lập bằng hai phiên trình duyệt).
- UAT với khách, biên bản bàn giao (mục 088, 089, 091).

## E. Thêm trong các vòng sửa lỗi sau kiểm thử trình duyệt (15/11/2026)

| # | Nội dung | Lý do |
|---|---|---|
| E1 | Hai máy cùng sửa một phiếu: gộp theo từng ô của từng dòng; cùng sửa một ô thì hỏi người dùng (mặc định giữ của máy kia) | Bản đầu gộp sai giá, lặp dòng tiền |
| E2 | Hết phiên đăng nhập hoặc tải lại trang khi đang gõ phiếu: khôi phục các dòng đang gõ dở (chỉ cho đúng người dùng đó) | Tránh mất công nhập |
| E3 | Phiếu thu/chi xuất Excel/Word có dòng "Bằng chữ"; file xuất trùng với bản in (mã DICHVU, ô ký, nhãn kho) | Bản in và file gửi khách phải giống nhau |
| E4 | Tìm khách/NCC/hàng theo nhiều từ, không cần đúng thứ tự, không dấu; từ khớp trọn được xếp trước | Gõ "thanh cong" từng ra nhầm "Tân Thành" |
| E5 | Nút In ở sổ chi tiết công nợ, thẻ kho, lịch sử bán; menu "Thêm ▾" trên màn hình hẹp | Tiện dùng |
| E6 | Script sao lưu / khôi phục và hướng dẫn cài đặt (`scripts/`, `docs/CAI_DAT.md`) | Bắt buộc trước khi chạy thật |

Câu hỏi thêm cho khách: mẫu phiếu của khách in "Nợ cũ : 10/8/26  2.000.000" — ngày đó là ngày gì, có cần in không?
(phần mềm đang in "Nợ cũ" không kèm ngày).
