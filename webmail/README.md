# Webmail + máy chủ thư

Một ứng dụng gọn nhẹ gồm cả **máy chủ thư** (SMTP nhận/gửi, IMAP, POP3) và **webmail** tiếng Việt chạy trên trình duyệt. Dữ liệu nằm trong một tệp SQLite, không cần cài thêm dịch vụ nào.

## Chạy thử

```bash
pip install -r webmail/requirements.txt
MAIL_DOMAIN=congty.vn python -m webmail      # chạy từ thư mục gốc của repo
```

Khi khởi động, màn hình in ra **mã thiết lập lần đầu**. Mở http://127.0.0.1:8080, nhập mã đó để tạo tài khoản quản trị; sau đó thêm người dùng trong mục **Quản lý người dùng** (bấm ảnh đại diện góc trên bên phải).

Gửi thử một thư vào hộp thư qua SMTP:

```bash
python - <<'EOF'
import smtplib
smtplib.SMTP("127.0.0.1", 2525).sendmail("ban@vidu.vn", ["ten@congty.vn"],
    "Subject: Xin chao\r\nFrom: ban@vidu.vn\r\nTo: ten@congty.vn\r\n\r\nThu thu nghiem.")
EOF
```

## Tính năng

**Webmail**
- Hộp thư đến, Có gắn sao, Thư đã gửi, Thư nháp, Thư rác, Thùng rác (khôi phục được); **thư mục tự tạo** (tạo, đổi tên, xóa, chuyển thư vào); tìm kiếm; chọn nhiều thư để xử lý.
- Soạn thư có định dạng (đậm, nghiêng, gạch chân, danh sách, trích dẫn, liên kết, **chèn hoặc dán ảnh vào giữa nội dung**), trả lời, trả lời tất cả, chuyển tiếp, Cc/Bcc, đính kèm tệp, tự lưu nháp khi đóng, `Ctrl+Enter` để gửi.
- Thư HTML được làm sạch và hiển thị trong khung cách ly; hình ảnh từ bên ngoài bị chặn cho tới khi bạn bấm "Hiện hình ảnh".
- Thông báo thư mới, giao diện sáng/tối theo hệ thống, dùng tốt trên điện thoại.
- Quản trị: tạo/xóa hộp thư, đặt lại mật khẩu, xem các bản ghi DNS cần khai báo.

**Máy chủ thư**
- **IMAP và POP3** (STARTTLS và TLS) để dùng với Outlook, Thunderbird, ứng dụng thư trên điện thoại; thông số kết nối xem trong mục **Kết nối ứng dụng thư** của webmail. Thay đổi trên ứng dụng thư và webmail đồng bộ với nhau, kể cả thư mục tự tạo (tên có dấu hiển thị đúng).
- **Cổng gửi thư có xác thực** (submission): bắt buộc TLS và đăng nhập, chỉ gửi được dưới địa chỉ của chính mình.
- Chỉ nhận thư cho tên miền của mình (không trung chuyển hộ), hỗ trợ địa chỉ `ten+nhan@`, hàng đợi gửi có thử lại, tự báo lại khi thư không tới.
- **Ký DKIM** mọi thư gửi đi (khóa tự tạo trong thư mục dữ liệu).
- **Lọc thư rác**: kiểm tra SPF, DKIM, DMARC của thư đến (xác định tên miền tổ chức theo Public Suffix List); chặn thư giả mạo tên miền nội bộ; bộ lọc Bayes học riêng cho từng người dùng từ các lần bấm "Báo thư rác" / "Không phải thư rác" (kể cả khi kéo thư vào/ra thư mục Junk trên ứng dụng thư); tùy chọn danh sách đen DNS. Thư trong Thư rác và Thùng rác tự xóa sau 30 ngày.

## Cấu hình (biến môi trường)

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `MAIL_DOMAIN` | `localhost` | Tên miền thư; nhiều tên miền cách nhau bằng dấu phẩy |
| `MAIL_HOSTNAME` | tên máy | Tên máy chủ (dùng khi chào SMTP, trong chứng chỉ và hướng dẫn kết nối) |
| `MAIL_DATA_DIR` | `data` | Nơi lưu cơ sở dữ liệu, khóa phiên, khóa DKIM |
| `WEB_HOST` / `WEB_PORT` | `127.0.0.1` / `8080` | Địa chỉ webmail |
| `COOKIE_SECURE` | `0` | Đặt `1` khi webmail chạy sau HTTPS |
| `TRUST_PROXY` | `0` | Đặt `1` khi webmail đứng sau reverse proxy (để lấy đúng IP người dùng) |
| `SMTP_HOST` | `127.0.0.1` | Địa chỉ mà mọi dịch vụ thư lắng nghe |
| `SMTP_PORT` | `2525` | Nhận thư từ máy chủ khác (thực tế: 25) |
| `SUBMISSION_PORT` | `1587` | Ứng dụng thư gửi đi (thực tế: 587) |
| `IMAP_PORT` / `IMAPS_PORT` | `1143` / `1993` | IMAP với STARTTLS / TLS (thực tế: 143 / 993) |
| `POP3_PORT` / `POP3S_PORT` | `1110` / `1995` | POP3 với STLS / TLS (thực tế: 110 / 995) |
| `TLS_CERT` / `TLS_KEY` | – | Chứng chỉ TLS; không đặt thì máy chủ tự tạo chứng chỉ tự ký |
| `ALLOW_PLAIN_AUTH` | `0` | Cho đăng nhập không mã hóa từ máy khác (không nên bật) |
| `SMARTHOST`, `SMARTHOST_PORT`, `SMARTHOST_USER`, `SMARTHOST_PASSWORD` | – / `587` | Máy chủ trung chuyển để gửi thư ra ngoài |
| `DKIM_SELECTOR` | `mail` | Tên bộ chọn DKIM |
| `SPAM_CHECKS` | `1` | Kiểm tra SPF/DKIM/DMARC thư đến |
| `DNSBL` | – | Danh sách đen DNS, ví dụ `zen.spamhaus.org` |
| `RETENTION_DAYS` | `30` | Số ngày giữ thư trong Thư rác/Thùng rác (`0` = không tự xóa) |
| `SEND_LIMIT_PER_HOUR` | `300` | Số người nhận tối đa mỗi tài khoản mỗi giờ |
| `MAX_SIZE_MB` | `25` | Dung lượng tối đa một thư |

Đặt cổng bằng `0` để tắt một dịch vụ.

## Đưa lên Internet

1. Chạy `python -m webmail dns` (hoặc mở **Bản ghi DNS của tên miền** trong webmail) và khai báo các bản ghi MX, SPF, DKIM, DMARC ở nơi quản lý tên miền. Nên có thêm bản ghi PTR (reverse DNS) cho địa chỉ IP của máy chủ.
2. Đặt `SMTP_HOST=0.0.0.0` và các cổng chuẩn (25, 587, 143/993, 110/995; cần quyền mở cổng dưới 1024).
3. Đặt `TLS_CERT`/`TLS_KEY` bằng chứng chỉ thật (ví dụ Let's Encrypt) để ứng dụng thư không cảnh báo.
4. Gửi thư: gửi thẳng theo bản ghi MX cần nhà mạng cho phép cổng 25 đi ra; nếu không, đặt `SMARTHOST`.
5. Web: đặt sau một reverse proxy có HTTPS (Caddy, nginx), rồi bật `COOKIE_SECURE=1` và `TRUST_PROXY=1`.

## Dòng lệnh

```bash
python -m webmail adduser binh "Trần Thị Bình"   # thêm --admin để cấp quyền quản trị
python -m webmail passwd binh
python -m webmail users
python -m webmail dns                             # in các bản ghi DNS cần khai báo
```

## Kiểm thử

```bash
python webmail/tests/test_end_to_end.py
```

Bộ kiểm thử chạy một máy chủ thật trên cổng tạm rồi đi qua web API, SMTP, IMAP, POP3, kèm các kiểm tra bảo mật (phân quyền giữa người dùng, chống giả mạo người gửi, làm sạch HTML, khóa khi dò mật khẩu). Nếu có cài `imapclient` và `curl`, bộ kiểm thử dùng thêm hai client này.

## Giới hạn hiện tại

- IMAP/POP3/SMTP được kiểm thử tự động bằng bốn client độc lập (`imaplib`/`poplib`/`smtplib` của Python, `imapclient`, `curl`), nhưng chưa thử trực tiếp với Outlook, Thunderbird hay iOS Mail. Mỗi ứng dụng có thói quen riêng, nên hãy thử với ứng dụng bạn dùng trước khi triển khai rộng.
- Thư mục tự tạo chỉ có một cấp (chưa có thư mục con).
