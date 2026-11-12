"""Cấu hình đọc từ biến môi trường (xem webmail/README.md)."""
import os
import socket


def _int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# Tên miền thư mà máy chủ này phục vụ, ví dụ "congty.vn". Có thể liệt kê nhiều, cách nhau bằng dấu phẩy.
DOMAINS = [d.strip().lower() for d in os.environ.get("MAIL_DOMAIN", "localhost").split(",") if d.strip()]
DOMAIN = DOMAINS[0]
HOSTNAME = os.environ.get("MAIL_HOSTNAME") or socket.getfqdn()

DATA_DIR = os.path.abspath(os.environ.get("MAIL_DATA_DIR", "data"))
DB_PATH = os.path.join(DATA_DIR, "mail.db")

WEB_HOST = os.environ.get("WEB_HOST", "127.0.0.1")
WEB_PORT = _int("WEB_PORT", 8080)
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"

TRUST_PROXY = os.environ.get("TRUST_PROXY", "0") == "1"  # webmail đứng sau reverse proxy

# Các dịch vụ thư cùng nghe trên SMTP_HOST. Đặt cổng = 0 để tắt một dịch vụ.
SMTP_HOST = os.environ.get("SMTP_HOST", "127.0.0.1")
SMTP_PORT = _int("SMTP_PORT", 2525)              # nhận thư từ máy chủ khác (thực tế: 25)
SUBMISSION_PORT = _int("SUBMISSION_PORT", 1587)  # ứng dụng thư gửi đi, STARTTLS + đăng nhập (587)
IMAP_PORT = _int("IMAP_PORT", 1143)              # IMAP + STARTTLS (143)
IMAPS_PORT = _int("IMAPS_PORT", 1993)            # IMAP qua TLS (993)
POP3_PORT = _int("POP3_PORT", 1110)              # POP3 + STLS (110)
POP3S_PORT = _int("POP3S_PORT", 1995)            # POP3 qua TLS (995)
# Cho phép đăng nhập không mã hóa từ máy khác (mặc định chỉ cho localhost). Không nên bật.
ALLOW_PLAIN_AUTH = os.environ.get("ALLOW_PLAIN_AUTH", "0") == "1"
TLS_CERT = os.environ.get("TLS_CERT")
TLS_KEY = os.environ.get("TLS_KEY")

# Gửi thư ra ngoài: qua máy chủ trung chuyển (khuyên dùng) hoặc gửi thẳng theo bản ghi MX.
SMARTHOST = os.environ.get("SMARTHOST")
SMARTHOST_PORT = _int("SMARTHOST_PORT", 587)
SMARTHOST_USER = os.environ.get("SMARTHOST_USER")
SMARTHOST_PASSWORD = os.environ.get("SMARTHOST_PASSWORD")
OUT_PORT = _int("OUT_PORT", 25)  # cổng khi gửi thẳng theo MX

DKIM_SELECTOR = os.environ.get("DKIM_SELECTOR", "mail")
SPAM_CHECKS = os.environ.get("SPAM_CHECKS", "1") == "1"   # kiểm tra SPF/DKIM/DMARC thư đến
DNSBL = [d.strip() for d in os.environ.get("DNSBL", "").split(",") if d.strip()]  # vd: zen.spamhaus.org
RETENTION_DAYS = _int("RETENTION_DAYS", 30)  # tự xóa thư trong Thư rác/Thùng rác sau số ngày này
SEND_LIMIT_PER_HOUR = _int("SEND_LIMIT_PER_HOUR", 300)  # số người nhận tối đa mỗi tài khoản mỗi giờ

MAX_SIZE = _int("MAX_SIZE_MB", 25) * 1024 * 1024
PAGE_SIZE = 50
