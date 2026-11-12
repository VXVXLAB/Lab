# Webmail + máy chủ thư

Một ứng dụng gọn nhẹ gồm cả **máy chủ thư** (nhận thư qua SMTP, gửi thư ra ngoài) và **webmail** tiếng Việt chạy trên trình duyệt. Dữ liệu nằm trong một tệp SQLite, không cần cài thêm dịch vụ nào.

## Chạy thử

```bash
pip install -r webmail/requirements.txt
MAIL_DOMAIN=congty.vn python -m webmail      # chạy từ thư mục gốc của repo
```

Mở http://127.0.0.1:8080. Lần đầu, trang sẽ mời bạn tạo tài khoản quản trị; sau đó thêm người dùng trong mục **Quản lý người dùng** (bấm ảnh đại diện góc trên bên phải).

Gửi thử một thư vào hộp thư qua SMTP:

```bash
python - <<'EOF'
import smtplib
smtplib.SMTP("127.0.0.1", 2525).sendmail("ban@vidu.vn", ["ten@congty.vn"],
    "Subject: Xin chao\r\nFrom: ban@vidu.vn\r\nTo: ten@congty.vn\r\n\r\nThu thu nghiem.")
EOF
```

## Tính năng

- Hộp thư đến, Có gắn sao, Thư đã gửi, Thư nháp, Thùng rác (khôi phục được); tìm kiếm; chọn nhiều thư để xử lý.
- Soạn thư, trả lời, trả lời tất cả, chuyển tiếp, Cc/Bcc, đính kèm tệp, tự lưu nháp khi đóng, `Ctrl+Enter` để gửi.
- Thư HTML được làm sạch và hiển thị trong khung cách ly; hình ảnh từ bên ngoài bị chặn cho tới khi bạn bấm "Hiện hình ảnh".
- Thông báo thư mới (tự kiểm tra 15 giây một lần), giao diện sáng/tối theo hệ thống, dùng tốt trên điện thoại.
- Quản trị: tạo/xóa hộp thư, đặt lại mật khẩu ngay trên web hoặc bằng dòng lệnh.
- Máy chủ: chỉ nhận thư cho tên miền của mình (không trung chuyển hộ), hỗ trợ địa chỉ `ten+nhan@`, hàng đợi gửi có thử lại, tự báo lại khi thư không tới.

## Cấu hình (biến môi trường)

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `MAIL_DOMAIN` | `localhost` | Tên miền thư; nhiều tên miền cách nhau bằng dấu phẩy |
| `MAIL_HOSTNAME` | tên máy | Tên máy chủ dùng khi chào SMTP |
| `MAIL_DATA_DIR` | `data` | Nơi lưu cơ sở dữ liệu và khóa phiên |
| `WEB_HOST` / `WEB_PORT` | `127.0.0.1` / `8080` | Địa chỉ webmail |
| `SMTP_HOST` / `SMTP_PORT` | `127.0.0.1` / `2525` | Địa chỉ nhận thư SMTP |
| `TLS_CERT` / `TLS_KEY` | – | Chứng chỉ để bật STARTTLS khi nhận thư |
| `SMARTHOST`, `SMARTHOST_PORT`, `SMARTHOST_USER`, `SMARTHOST_PASSWORD` | – / `587` | Máy chủ trung chuyển để gửi thư ra ngoài |
| `MAX_SIZE_MB` | `25` | Dung lượng tối đa một thư |
| `COOKIE_SECURE` | `0` | Đặt `1` khi webmail chạy sau HTTPS |

## Đưa lên Internet

1. DNS: bản ghi `MX` của tên miền trỏ về máy chủ; thêm bản ghi SPF.
2. Nhận thư: `SMTP_HOST=0.0.0.0 SMTP_PORT=25` (cần quyền mở cổng 25) và nên đặt `TLS_CERT`/`TLS_KEY`.
3. Gửi thư: nên đặt `SMARTHOST` (dịch vụ SMTP của nhà cung cấp tên miền, Amazon SES, Mailgun…). Không đặt thì máy chủ gửi thẳng theo bản ghi MX, nhưng thư dễ vào mục rác vì ứng dụng chưa ký DKIM.
4. Web: đặt sau một reverse proxy có HTTPS (Caddy, nginx), rồi bật `COOKIE_SECURE=1`.

## Dòng lệnh

```bash
python -m webmail adduser binh "Trần Thị Bình"   # thêm --admin để cấp quyền quản trị
python -m webmail passwd binh
python -m webmail users
```

## Giới hạn hiện tại

- Chưa có IMAP/POP3 và cổng gửi thư có xác thực, nên chưa dùng được với Outlook, Thunderbird hay ứng dụng thư trên điện thoại; chỉ đọc và gửi qua webmail.
- Chưa lọc thư rác, chưa kiểm tra SPF/DKIM của thư đến, chưa ký DKIM cho thư đi.
- Soạn thư dạng văn bản thuần (thư HTML nhận về vẫn hiển thị đầy đủ).
- Trang thiết lập lần đầu ai truy cập trước sẽ tạo được tài khoản quản trị: hãy thiết lập ngay sau khi cài.
