# CÀI ĐẶT, CHẠY VÀ SAO LƯU

Phần mềm gồm **một chương trình máy chủ** (`khoserver`) và **một cơ sở dữ liệu PostgreSQL**, cài trên một máy
trong văn phòng (gọi là máy chủ). Các máy kế toán không cài gì: mở trình duyệt Chrome/Edge, gõ
`http://<địa-chỉ-máy-chủ>:8080`.

> Hướng dẫn dưới đây em đã chạy thật trên Linux. Trên Windows các bước tương tự nhưng **em chưa chạy thử trên
> Windows thật** — cần làm thử một lần trên máy của anh trước khi giao khách.

## 1. Cần có
- PostgreSQL 16.
- Để build: Go 1.24 và Node.js 20+ (chỉ máy build cần; máy chủ chỉ cần file đã build).

## 2. Build
```bash
cd kho/frontend && npm ci && npm run build          # ra thư mục frontend/dist
cd ../backend  && go build -o bin/khoserver ./cmd/khoserver
```
Build cho máy chủ Windows từ máy Linux: `GOOS=windows GOARCH=amd64 go build -o bin/khoserver.exe ./cmd/khoserver`.

Mang sang máy chủ: file `khoserver` (hoặc `khoserver.exe`), thư mục `frontend/dist`, thư mục `scripts`.

## 3. Tạo cơ sở dữ liệu (làm một lần)
```sql
CREATE ROLE kho LOGIN PASSWORD '<mật-khẩu-riêng>';
CREATE DATABASE kho OWNER kho;
```

## 4. Chạy
```bash
export DATABASE_URL='postgres://kho:<mật-khẩu-riêng>@127.0.0.1:5432/kho'
export STATIC_DIR=/duong/dan/toi/dist
export ADMIN_PASSWORD='<mật-khẩu-admin-ban-đầu>'     # chỉ có tác dụng lần chạy đầu tiên
./khoserver
```
Lần chạy đầu, chương trình tự tạo bảng, tài khoản `admin`, 4 kho `KHO1…KHO4`, mã dịch vụ `DV`, quỹ tiền mặt và
ngân hàng. Đăng nhập `admin`, làm theo màn hình "Bắt đầu sử dụng" (thông tin công ty, người dùng, danh mục, tồn
đầu kỳ, công nợ đầu kỳ).

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | `postgres://kho:kho@127.0.0.1:5432/kho_dev` | Cơ sở dữ liệu |
| `LISTEN_ADDR` | `:8080` | Cổng lắng nghe |
| `STATIC_DIR` | `../frontend/dist` | Thư mục giao diện đã build |
| `ADMIN_PASSWORD` | `admin123` | Mật khẩu `admin` khi tạo lần đầu — **phải đổi** |
| `COOKIE_SECURE` | trống | `true` nếu chạy sau HTTPS |

**Tự chạy khi bật máy:** Linux dùng systemd (`Restart=always`); Windows dùng Task Scheduler "At startup" hoặc
NSSM để chạy `khoserver.exe` như một dịch vụ.

**Mạng:** mở cổng 8080 trên tường lửa máy chủ cho mạng nội bộ; đặt IP tĩnh cho máy chủ. Không mở cổng này ra
Internet (phần mềm thiết kế cho mạng nội bộ, chưa có HTTPS).

## 5. Sao lưu — bắt buộc trước khi dùng thật
Toàn bộ sổ sách nằm trong PostgreSQL. Hỏng ổ cứng máy chủ mà không có bản sao lưu là mất hết.

```bash
DATABASE_URL=... ./scripts/sao-luu.sh /duong/dan/luu      # tạo file kho-NGÀY-GIỜ.dump, giữ 30 ngày
```
- Script tự kiểm tra file đọc lại được rồi mới báo xong; tự xóa bản cũ hơn 30 ngày (đổi bằng `GIU_NGAY=90`).
- **Đặt lịch hằng ngày** (ví dụ 12:15 và 18:30). Linux, `crontab -e`:
  `15 12 * * * DATABASE_URL=... /opt/kho/scripts/sao-luu.sh /sao-luu >> /var/log/kho-sao-luu.log 2>&1`
- **Thư mục lưu phải nằm trên ổ khác máy chủ** (ổ USB, NAS, hoặc thư mục đồng bộ lên đám mây). Sao lưu cùng ổ
  với dữ liệu không cứu được khi hỏng ổ.
- Windows: chạy lệnh tương đương bằng Task Scheduler:
  `pg_dump --format=custom --no-owner --file=D:\sao-luu\kho-%date:~-4%%date:~3,2%%date:~0,2%.dump "postgres://kho:...@127.0.0.1:5432/kho"`

### Khôi phục
```bash
# 1) tắt khoserver   2) chạy:
DATABASE_URL=... ./scripts/khoi-phuc.sh /duong/dan/luu/kho-20261114-121500.dump
# 3) bật lại khoserver
```
Script hỏi xác nhận (gõ `CO`), **xóa sạch dữ liệu hiện có** rồi nạp lại từ file. Dữ liệu nhập sau thời điểm sao
lưu sẽ không còn.

Em đã thử một vòng: sao lưu CSDL demo → khôi phục sang CSDL mới → số chứng từ, số dòng sổ kho, danh mục khớp và
báo cáo tồn kho của hai bên giống hệt nhau.

**Nên diễn tập khôi phục một lần trên máy thật trước khi chạy chính thức, và mỗi quý một lần.**

## 6. Nâng cấp phiên bản
1. Sao lưu. 2. Tắt `khoserver`. 3. Thay file `khoserver` và thư mục `dist`. 4. Bật lại — chương trình tự cập
nhật cấu trúc dữ liệu. Các máy kế toán bấm Ctrl+F5 một lần.

## 7. Dữ liệu mẫu để tập
`go run ./cmd/seeddemo -reset` nạp dữ liệu mẫu vật tư hàn (có sẵn hai ví dụ trong file yêu cầu). Lệnh này **xóa
sạch** CSDL đang trỏ tới — chỉ dùng cho CSDL thử, không bao giờ chạy trên CSDL thật.

## 8. Chạy lại các bộ kiểm thử
```bash
cd kho/backend && go test ./... -count=1      # test tích hợp backend (CSDL kho_test)
cd kho/qa      && ./run.sh                    # kiểm thử hộp đen qua API
cd kho/e2e     && ./run.sh                    # kiểm thử trên trình duyệt thật
```
