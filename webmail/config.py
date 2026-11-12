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

SMTP_HOST = os.environ.get("SMTP_HOST", "127.0.0.1")
SMTP_PORT = _int("SMTP_PORT", 2525)
TLS_CERT = os.environ.get("TLS_CERT")
TLS_KEY = os.environ.get("TLS_KEY")

# Gửi thư ra ngoài: qua máy chủ trung chuyển (khuyên dùng) hoặc gửi thẳng theo bản ghi MX.
SMARTHOST = os.environ.get("SMARTHOST")
SMARTHOST_PORT = _int("SMARTHOST_PORT", 587)
SMARTHOST_USER = os.environ.get("SMARTHOST_USER")
SMARTHOST_PASSWORD = os.environ.get("SMARTHOST_PASSWORD")
OUT_PORT = _int("OUT_PORT", 25)  # cổng khi gửi thẳng theo MX

MAX_SIZE = _int("MAX_SIZE_MB", 25) * 1024 * 1024
PAGE_SIZE = 50
