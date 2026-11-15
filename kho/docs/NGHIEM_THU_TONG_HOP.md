# NGHIỆM THU TỔNG HỢP — 91 đầu việc ↔ ba bộ kiểm thử

File này do `scripts/ma-tran-nghiem-thu.py` sinh ra từ mã nguồn test và kết quả lần chạy gần nhất; không sửa tay.

| Bộ kiểm thử | Do ai viết | Cách chạy | Kết quả lần chạy gần nhất |
|---|---|---|---|
| Backend (Go, qua HTTP trên PostgreSQL thật) — 56 test có gắn mã | Agent backend | `cd backend && go test ./... -count=1` | ĐẠT toàn bộ (15/11/2026) |
| QA hộp đen qua API (Python) — 45 test | Agent QA độc lập, không đọc mã backend | `cd qa && ./run.sh` | 45/45 ĐẠT, 0 phản hồi 5xx (15/11/2026) |
| Trình duyệt thật (Playwright) — 168 test | Agent kiểm thử độc lập, thao tác như người dùng | `cd e2e && ./run.sh` | 168 đạt, 0 hỏng, 0 chập chờn |

Cột số là **số test có gắn mã đầu việc đó** ở từng bộ. "Tự động: ĐẠT" nghĩa là mọi test gắn mã đó đều đạt ở lần chạy gần nhất.
Đạt tự động **chưa phải** nghiệm thu của khách: mục 088 (UAT) và 091 (bàn giao) vẫn cần khách làm.

| Mã | Đầu việc | Go | QA | Trình duyệt | Kết quả |
|---|---|---|---|---|---|
| 001 | Mô hình 4 kho | 3 | 1 | – | Tự động: ĐẠT · quy tắc cần khách xác nhận |
| 002 | Nhập-Xuất-Tồn theo mã hàng | 2 | 2 | 3 | Tự động: ĐẠT · quy tắc cần khách xác nhận |
| 003 | Sửa chứng từ quá khứ | 3 | 2 | 2 | Tự động: ĐẠT · quy tắc cần khách xác nhận |
| 004 | Cảnh báo bán lỗ | 1 | 1 | 1 | Tự động: ĐẠT · quy tắc cần khách xác nhận |
| 005 | Phiếu tạm | 2 | 2 | 2 | Tự động: ĐẠT · quy tắc cần khách xác nhận |
| 006 | Mã Dịch vụ (DV) | 1 | 2 | – | Tự động: ĐẠT · quy tắc cần khách xác nhận |
| 007 | Thu - chi | 2 | 2 | 3 | Tự động: ĐẠT · quy tắc cần khách xác nhận |
| 008 | Báo cáo & xuất file | 5 | 2 | 2 | Tự động: ĐẠT · quy tắc cần khách xác nhận |
| 009 | Tồn tổng 4 kho | 2 | 3 | 3 | Tự động: ĐẠT |
| 010 | Tồn từng kho | 2 | 4 | 3 | Tự động: ĐẠT |
| 011 | Chuyển kho nội bộ | 2 | 2 | 3 | Tự động: ĐẠT |
| 012 | Tra cứu theo mã hàng | 4 | 4 | 5 | Tự động: ĐẠT |
| 013 | Tồn đầu kỳ | 2 | 2 | 3 | Tự động: ĐẠT |
| 014 | Thông tin giao dịch | 1 | 1 | 1 | Tự động: ĐẠT |
| 015 | SL Nhập-Xuất-Tồn | 1 | 3 | 1 | Tự động: ĐẠT |
| 016 | Mua của ai | 1 | 2 | 1 | Tự động: ĐẠT |
| 017 | Bán cho ai | 1 | 2 | 3 | Tự động: ĐẠT |
| 018 | Khách trả hàng | 1 | 1 | 3 | Tự động: ĐẠT |
| 019 | Lọc thời gian | 2 | 5 | 1 | Tự động: ĐẠT |
| 020 | Nhóm VTHH | 4 | 2 | 3 | Tự động: ĐẠT |
| 021 | Lịch sử bán từng mặt hàng | 2 | 2 | 3 | Tự động: ĐẠT |
| 022 | Xuất tồn Excel | 1 | 2 | 1 | Tự động: ĐẠT |
| 023 | Phiếu nhập hàng | 4 | 4 | 4 | Tự động: ĐẠT |
| 024 | Ghi sổ phiếu nhập | 1 | 1 | 3 | Tự động: ĐẠT |
| 025 | Phiếu bán hàng | 6 | 3 | 8 | Tự động: ĐẠT |
| 026 | Giá bán mặc định | 3 | 1 | 3 | Tự động: ĐẠT |
| 027 | Sửa giá bán | 1 | 1 | 1 | Tự động: ĐẠT |
| 028 | So sánh giá bán - giá mua | 3 | 1 | 2 | Tự động: ĐẠT |
| 029 | Cảnh báo bán lỗ | 2 | 1 | 2 | Tự động: ĐẠT |
| 030 | Kiểm tra tồn | 4 | 5 | 2 | Tự động: ĐẠT |
| 031 | Chặn ghi sổ khi tồn = 0 | 2 | 3 | 3 | Tự động: ĐẠT |
| 032 | Chặn in khi tồn = 0 | 1 | 1 | 3 | Tự động: ĐẠT |
| 033 | Trừ tồn khi bán | 1 | 2 | 3 | Tự động: ĐẠT |
| 034 | Công nợ bán hàng | 4 | 4 | 4 | Tự động: ĐẠT |
| 035 | Mở phiếu nhập cũ | 2 | 2 | 2 | Tự động: ĐẠT |
| 036 | Sửa phiếu nhập cũ | 3 | 3 | 1 | Tự động: ĐẠT |
| 037 | Mở phiếu bán cũ | 2 | 1 | 4 | Tự động: ĐẠT |
| 038 | Sửa phiếu bán cũ | 3 | 2 | 2 | Tự động: ĐẠT |
| 039 | Cập nhật sau sửa | 4 | 5 | 2 | Tự động: ĐẠT |
| 040 | Tạo phiếu tạm | 2 | 2 | 4 | Tự động: ĐẠT |
| 041 | Hàng chưa có tồn | 3 | 2 | 1 | Tự động: ĐẠT |
| 042 | Dữ liệu dùng chung | 4 | 4 | 3 | Tự động: ĐẠT |
| 043 | Máy khác nhìn thấy | 2 | 2 | 2 | Tự động: ĐẠT |
| 044 | Máy khác tiếp tục | 3 | 3 | 2 | Tự động: ĐẠT |
| 045 | Chốt phiếu tạm | 2 | 1 | 2 | Tự động: ĐẠT |
| 046 | Kế toán mua xem phiếu tạm | 1 | 1 | 2 | Tự động: ĐẠT |
| 047 | Mã Dịch vụ (DV) | 3 | 2 | 4 | Tự động: ĐẠT |
| 048 | Diễn giải Dịch vụ | 1 | 2 | 2 | Tự động: ĐẠT |
| 049 | Dịch vụ cộng tiền | 2 | 2 | 4 | Tự động: ĐẠT |
| 050 | Dịch vụ trừ tiền | 2 | 1 | 2 | Tự động: ĐẠT |
| 051 | Không theo dõi NXT | 2 | 2 | 4 | Tự động: ĐẠT |
| 052 | Công nợ Khách hàng | 5 | 4 | 5 | Tự động: ĐẠT |
| 053 | Chi tiết công nợ KH | 1 | 3 | 1 | Tự động: ĐẠT |
| 054 | Công nợ NCC | 4 | 2 | 5 | Tự động: ĐẠT |
| 055 | Chi tiết công nợ NCC | 1 | 2 | 1 | Tự động: ĐẠT |
| 056 | Thu tiền quỹ | 6 | 3 | 2 | Tự động: ĐẠT |
| 057 | Chi tiền quỹ | 3 | 2 | 2 | Tự động: ĐẠT |
| 058 | Thu tiền ngân hàng | 1 | 2 | 2 | Tự động: ĐẠT |
| 059 | Chi tiền ngân hàng | 1 | 2 | 2 | Tự động: ĐẠT |
| 060 | Nhiều dòng cùng KH | 4 | 1 | 10 | Tự động: ĐẠT |
| 061 | Nhiều dòng cùng NCC | 2 | 1 | 1 | Tự động: ĐẠT |
| 062 | Liên kết công nợ | 5 | 4 | 7 | Tự động: ĐẠT |
| 063 | Báo cáo tồn kho | 3 | 5 | 2 | Tự động: ĐẠT |
| 064 | Báo cáo NXT | 1 | 5 | 1 | Tự động: ĐẠT |
| 065 | Báo cáo công nợ | 2 | 4 | 2 | Tự động: ĐẠT |
| 066 | Báo cáo mua hàng | 2 | 2 | 1 | Tự động: ĐẠT |
| 067 | Báo cáo bán hàng | 2 | 4 | 3 | Tự động: ĐẠT |
| 068 | Mở chi tiết từ báo cáo tồn | 1 | 1 | 3 | Tự động: ĐẠT |
| 069 | Mở chi tiết từ công nợ | 1 | 1 | 3 | Tự động: ĐẠT |
| 070 | Mở chi tiết từ mua/bán | 1 | 2 | 3 | Tự động: ĐẠT |
| 071 | Xuất phiếu nhập Excel | 5 | 3 | 9 | Tự động: ĐẠT |
| 072 | Xuất phiếu xuất Excel | 4 | 2 | 11 | Tự động: ĐẠT |
| 073 | Xuất phiếu Word | 4 | 3 | 14 | Tự động: ĐẠT |
| 074 | File sau xuất chỉnh sửa được | 2 | 1 | 4 | Tự động: ĐẠT |
| 075 | Xuất tồn toàn bộ mã | 1 | 1 | 1 | Tự động: ĐẠT |
| 076 | Kiểm thử tồn 4 kho | 2 | 2 | 2 | Tự động: ĐẠT |
| 077 | Kiểm thử chuyển kho | 1 | 2 | 2 | Tự động: ĐẠT |
| 078 | Kiểm thử NXT | 1 | 3 | 1 | Tự động: ĐẠT |
| 079 | Kiểm thử hết tồn | 1 | 1 | 2 | Tự động: ĐẠT |
| 080 | Kiểm thử bán lỗ | 1 | 1 | 2 | Tự động: ĐẠT |
| 081 | Kiểm thử sửa chứng từ cũ | 2 | 4 | 3 | Tự động: ĐẠT |
| 082 | Kiểm thử phiếu tạm nhiều máy | 2 | 4 | 20 | Tự động: ĐẠT |
| 083 | Kiểm thử Mã Dịch vụ | 2 | 3 | 1 | Tự động: ĐẠT |
| 084 | Kiểm thử công nợ | 3 | 5 | 1 | Tự động: ĐẠT |
| 085 | Kiểm thử thu-chi nhiều dòng | 4 | 4 | 3 | Tự động: ĐẠT |
| 086 | Kiểm thử mở chi tiết báo cáo | 1 | 1 | 2 | Tự động: ĐẠT |
| 087 | Kiểm thử Excel/Word | 5 | 5 | 17 | Tự động: ĐẠT |
| 088 | UAT | – | – | – | Cần khách: UAT với dữ liệu thật |
| 089 | Sửa lỗi | – | – | – | Quy trình: sửa lỗi sau UAT (đã chạy 4 vòng sửa lỗi nội bộ, xem e2e/BAO_CAO_E2E.md) |
| 090 | Hướng dẫn sử dụng | – | – | 3 | Tài liệu: docs/HUONG_DAN_SU_DUNG.md (có trong phần mềm, mục Hướng dẫn) + docs/CAI_DAT.md |
| 091 | Bàn giao | – | – | – | Cần khách: biên bản bàn giao |

Tổng: 91 đầu việc — 87 có test tự động và đạt, 4 cần người/khách, 0 chưa có test.
