# 91 đầu việc triển khai & nghiệm thu (trích từ "TODO Quản lý kho.pdf")

Mã yêu cầu `REQ-001` … `REQ-091`. Mọi test nghiệm thu phải gắn mã này.

## A. Phân tích nghiệp vụ & chốt quy tắc (001–008) — chốt trong `docs/SPEC.md` mục 2
| Mã | Đầu việc | Phạm vi |
|---|---|---|
| 001 | Mô hình 4 kho | Tồn tổng 4 kho, tồn từng kho, chuyển kho nội bộ |
| 002 | Nhập-Xuất-Tồn theo mã hàng | Ngày hạch toán, chứng từ, diễn giải, ĐVT, nhập, xuất, tồn, đối tượng giao dịch |
| 003 | Sửa chứng từ quá khứ | Trường được sửa; cách cập nhật tồn, công nợ, báo cáo sau sửa |
| 004 | Cảnh báo bán lỗ | Cách xác định giá mua để so với giá bán |
| 005 | Phiếu tạm | Trạng thái tạm, thời điểm ghi sổ, tác động tồn/công nợ |
| 006 | Mã Dịch vụ (DV) | Diễn giải, tiền cộng/trừ, công nợ, không theo dõi NXT |
| 007 | Thu - chi | Quỹ, ngân hàng, nhiều dòng cho cùng KH/NCC |
| 008 | Báo cáo & xuất file | Báo cáo mở chi tiết, mẫu Excel/Word |

## B. Quản lý kho & Nhập-Xuất-Tồn (009–022)
| Mã | Đầu việc | Phạm vi |
|---|---|---|
| 009 | Tồn tổng 4 kho | Tổng hợp tồn từng mã hàng trên toàn bộ 4 kho |
| 010 | Tồn từng kho | Hiển thị tồn từng mã hàng tại từng kho |
| 011 | Chuyển kho nội bộ | Kho nguồn giảm, kho nhận tăng, tổng tồn không đổi |
| 012 | Tra cứu theo mã hàng | Xem lịch sử NXT trong thời gian dài |
| 013 | Tồn đầu kỳ | Hiển thị số dư đầu kỳ |
| 014 | Thông tin giao dịch | Ngày hạch toán, số chứng từ, diễn giải, ĐVT |
| 015 | SL Nhập-Xuất-Tồn | SL nhập, xuất và tồn sau từng giao dịch |
| 016 | Mua của ai | Dòng nhập thể hiện NCC/đối tượng |
| 017 | Bán cho ai | Dòng xuất thể hiện Khách hàng |
| 018 | Khách trả hàng | Dòng trả hàng thể hiện rõ Khách hàng trả |
| 019 | Lọc thời gian | Tra cứu theo khoảng thời gian |
| 020 | Nhóm VTHH | Xem tồn nhiều mặt hàng cùng nhóm VTHH |
| 021 | Lịch sử bán từng mặt hàng | Tra cứu các lần bán của từng mã |
| 022 | Xuất tồn Excel | Xuất toàn bộ mã hàng và dữ liệu tồn ra Excel (đã thống nhất: không bắt buộc mã chỉ có trong danh mục mà chưa có tồn/phát sinh) |

## C. Nhập hàng - Bán hàng - Giá - Sửa chứng từ (023–039)
| Mã | Đầu việc | Phạm vi |
|---|---|---|
| 023 | Phiếu nhập hàng | Phiếu nhiều mặt hàng, gắn NCC, số lượng, giá mua |
| 024 | Ghi sổ phiếu nhập | Hoàn tất phiếu và tăng tồn kho |
| 025 | Phiếu bán hàng | Phiếu nhiều mặt hàng, gắn Khách hàng |
| 026 | Giá bán mặc định | Tự điền đơn giá bán đã thiết lập |
| 027 | Sửa giá bán | Kế toán nhập giá cao/thấp hơn giá mặc định |
| 028 | So sánh giá bán - giá mua | Theo quy tắc đã chốt |
| 029 | Cảnh báo bán lỗ | Cảnh báo khi giá bán < giá mua |
| 030 | Kiểm tra tồn | Kiểm tra tồn trước ghi sổ |
| 031 | Chặn ghi sổ khi tồn = 0 | Không cho ghi sổ khi hết tồn |
| 032 | Chặn in khi tồn = 0 | Không cho in phiếu chính thức khi hết tồn (phân biệt phiếu nháp/đã ghi sổ) |
| 033 | Trừ tồn khi bán | Phiếu bán đã ghi sổ làm giảm tồn |
| 034 | Công nợ bán hàng | Phiếu bán phát sinh công nợ Khách hàng |
| 035 | Mở phiếu nhập cũ | Tìm và mở chứng từ nhập quá khứ |
| 036 | Sửa phiếu nhập cũ | Sửa số lượng/thông tin |
| 037 | Mở phiếu bán cũ | Tìm và mở chứng từ bán quá khứ |
| 038 | Sửa phiếu bán cũ | Sửa số lượng/đơn giá |
| 039 | Cập nhật sau sửa | Cập nhật lại tồn kho, công nợ, báo cáo |

## D. Phiếu tạm - Mã Dịch vụ - Nhiều máy (040–051)
| Mã | Đầu việc | Phạm vi |
|---|---|---|
| 040 | Tạo phiếu tạm | Phiếu chưa ghi sổ/chưa hoàn thành |
| 041 | Hàng chưa có tồn | Vẫn đưa được vào phiếu tạm để gửi Khách hàng xem (phiếu tạm KHÔNG giữ hàng) |
| 042 | Dữ liệu dùng chung | Phiếu tạm lưu trên hệ thống chung |
| 043 | Máy khác nhìn thấy | Máy 2 thấy phiếu tạm do máy 1 tạo |
| 044 | Máy khác tiếp tục | Máy 2 mở, bổ sung, chỉnh sửa phiếu |
| 045 | Chốt phiếu tạm | Hoàn tất phiếu khi đủ điều kiện |
| 046 | Kế toán mua xem phiếu tạm | Dùng phiếu tạm để xác định hàng cần đặt |
| 047 | Mã Dịch vụ (DV) | Thêm dòng dịch vụ không phải hàng tồn |
| 048 | Diễn giải Dịch vụ | Nhập nội dung tự do |
| 049 | Dịch vụ cộng tiền | Cộng khoản dịch vụ vào tổng phiếu/công nợ |
| 050 | Dịch vụ trừ tiền | Trừ khoản dịch vụ khỏi tổng phiếu/công nợ |
| 051 | Không theo dõi NXT | Dịch vụ không làm thay đổi tồn kho |

## E. Công nợ - Thu chi (052–062)
| Mã | Đầu việc | Phạm vi |
|---|---|---|
| 052 | Công nợ Khách hàng | Số dư và phát sinh từng Khách hàng |
| 053 | Chi tiết công nợ KH | Mở các phiếu/giao dịch tạo công nợ |
| 054 | Công nợ NCC | Khoản phải trả và phát sinh |
| 055 | Chi tiết công nợ NCC | Mở các phiếu/giao dịch liên quan |
| 056 | Thu tiền quỹ | Khoản thu tiền mặt/quỹ |
| 057 | Chi tiền quỹ | Khoản chi tiền mặt/quỹ |
| 058 | Thu tiền ngân hàng | Khoản thu qua ngân hàng |
| 059 | Chi tiền ngân hàng | Khoản chi qua ngân hàng |
| 060 | Nhiều dòng cùng KH | Một lần nhập nhiều dòng tiền cho cùng Khách hàng |
| 061 | Nhiều dòng cùng NCC | Một lần nhập nhiều dòng tiền cho cùng NCC |
| 062 | Liên kết công nợ | Thu/chi cập nhật công nợ liên quan |

## F. Báo cáo - Mở chi tiết - Excel/Word (063–075)
| Mã | Đầu việc | Phạm vi |
|---|---|---|
| 063 | Báo cáo tồn kho | Dữ liệu tồn tổng hợp |
| 064 | Báo cáo NXT | Chi tiết theo từng mã hàng |
| 065 | Báo cáo công nợ | Công nợ KH/NCC |
| 066 | Báo cáo mua hàng | Chi tiết mua hàng |
| 067 | Báo cáo bán hàng | Chi tiết bán hàng |
| 068 | Mở chi tiết từ báo cáo tồn | Bấm số liệu mở giao dịch/chứng từ liên quan |
| 069 | Mở chi tiết từ công nợ | Bấm số liệu mở giao dịch/chứng từ liên quan |
| 070 | Mở chi tiết từ mua/bán | Bấm đơn hàng xem chi tiết ngay |
| 071 | Xuất phiếu nhập Excel | |
| 072 | Xuất phiếu xuất Excel | |
| 073 | Xuất phiếu Word | |
| 074 | File sau xuất chỉnh sửa được | Thêm/bớt dòng, cột, thông tin |
| 075 | Xuất tồn toàn bộ mã | Xuất toàn bộ mã hàng phục vụ báo cáo tồn |

## G. Kiểm thử - Nghiệm thu - Bàn giao (076–091)
| Mã | Đầu việc | Phạm vi |
|---|---|---|
| 076 | Kiểm thử tồn 4 kho | Đối chiếu tồn tổng và từng kho (kịch bản đủ 4 kho) |
| 077 | Kiểm thử chuyển kho | Kho nguồn giảm / kho nhận tăng |
| 078 | Kiểm thử NXT | Ngày, chứng từ, đối tượng, nhập, xuất, tồn |
| 079 | Kiểm thử hết tồn | Chặn ghi sổ/in khi tồn = 0 |
| 080 | Kiểm thử bán lỗ | Cảnh báo giá bán < giá mua |
| 081 | Kiểm thử sửa chứng từ cũ | Đối chiếu dữ liệu sau chỉnh sửa |
| 082 | Kiểm thử phiếu tạm nhiều máy | Máy 1 tạo; máy 2 xem, mở, chỉnh sửa |
| 083 | Kiểm thử Mã Dịch vụ | Cộng/trừ, công nợ, không tác động tồn |
| 084 | Kiểm thử công nợ | Đối chiếu phát sinh và số dư |
| 085 | Kiểm thử thu-chi nhiều dòng | Quỹ/ngân hàng, nhiều dòng cùng đối tượng |
| 086 | Kiểm thử mở chi tiết báo cáo | Bấm báo cáo mở đúng chứng từ |
| 087 | Kiểm thử Excel/Word | Dữ liệu và khả năng chỉnh sửa file |
| 088 | UAT | Khách hàng kiểm thử chấp nhận (ngoài phạm vi tự động — cần khách) |
| 089 | Sửa lỗi | Khắc phục lỗi phát sinh trong UAT |
| 090 | Hướng dẫn sử dụng | Tài liệu hướng dẫn người dùng |
| 091 | Bàn giao | Phiên bản hoàn thiện, tài liệu, biên bản |
