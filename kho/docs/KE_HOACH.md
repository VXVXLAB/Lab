# KẾ HOẠCH XÂY DỰNG

## Lựa chọn công nghệ
| Hạng mục | Chọn | Lý do |
|---|---|---|
| Backend | **Go 1.24** + PostgreSQL 16 | Nghiệp vụ CRUD + báo cáo kế toán: Go đủ nhanh, build ra 1 file chạy, dễ bảo trì và dễ tuyển người hơn Rust; thư viện Excel (excelize) rất chín. Rust không đem lại lợi ích tương xứng cho bài toán này. |
| Frontend | React + TypeScript + Ant Design (tiếng Việt) | Bộ bảng/biểu mẫu sẵn cho phần mềm kế toán; nhập liệu bằng bàn phím; chạy trên trình duyệt nên mọi máy trong mạng dùng chung dữ liệu. |
| Triển khai | 1 máy chủ nội bộ, các máy mở trình duyệt | Giải quyết gốc rễ yêu cầu "máy 2 thấy phiếu tạm của máy 1". |

## Vai trò
- **Kiểm soát (controller)**: viết đặc tả, chia việc, tự chạy lại toàn bộ test, review, quyết định đạt/không đạt từng giai đoạn. Không tin báo cáo của agent nếu chưa tự kiểm chứng.
- **Agent thực thi (Opus 5.5)**: mỗi agent một phạm vi rõ, đầu ra kiểm chứng được.

## Giai đoạn và cổng kiểm soát
| GĐ | Việc | Người làm | Cổng đạt (controller tự kiểm) |
|---|---|---|---|
| 0 | Đọc yêu cầu, chốt quy tắc REQ-001…008, đặc tả DB + API | Controller | `docs/SPEC.md` |
| 1 | Backend Go: migration, nghiệp vụ, API, xuất Excel/Word, test tích hợp theo mã REQ | Agent Backend | `go build`, `go vet`, `go test ./...` xanh trên Postgres thật; `docs/API.md` |
| 2a | Frontend React theo API thật | Agent Frontend | `npm run build` + typecheck sạch; chạy được với backend |
| 2b | Kiểm thử hộp đen độc lập: viết lại kịch bản từ file yêu cầu của khách (không đọc code backend), gọi API thật | Agent QA | Bộ test độc lập xanh; lỗi tìm được phải sửa |
| 3 | E2E Playwright trên trình duyệt thật: 2 phiên = 2 máy, in/xuất file, bấm báo cáo mở chi tiết | Agent E2E | E2E xanh, có ảnh chụp màn hình |
| 4 | Rà soát cuối: ma trận 91 mã ↔ test ↔ kết quả, hướng dẫn sử dụng, hướng dẫn cài đặt | Controller | `docs/NGHIEM_THU.md`, `docs/HUONG_DAN_SU_DUNG.md` |

## Ngoài phạm vi tự động
REQ-088 (UAT với khách), REQ-089 (sửa lỗi sau UAT), REQ-091 (biên bản bàn giao) cần người thật của hai bên.
Các quy tắc ở mục 2 của SPEC (REQ-001…008) là đề xuất kỹ thuật, **cần khách xác nhận**.
