"""Đăng nhập dùng chung cho mọi giao thức, chống dò mật khẩu, TLS, DKIM và mã thiết lập."""
import base64
import datetime
import hmac
import ipaddress
import os
import secrets
import ssl
import threading
import time

from . import config, db

# ---------- chống dò mật khẩu ----------

MAX_FAILS = 8        # số lần sai liên tiếp từ một địa chỉ IP trước khi bị khóa
LOCK_SECONDS = 300
_fails = {}          # ip -> [số lần sai, khóa đến lúc, lần sai gần nhất]
_fails_lock = threading.Lock()
# Băm một mật khẩu giả khi tài khoản không tồn tại để thời gian phản hồi không lộ tài khoản nào có thật.
_DUMMY_HASH = db.hash_password(secrets.token_hex(8))


def is_locked(ip):
    rec = _fails.get(ip)
    return bool(rec and rec[1] > time.time())


def _record(ip, ok):
    with _fails_lock:
        if ok:
            _fails.pop(ip, None)
            return
        now = time.time()
        if len(_fails) > 20000:  # giới hạn bộ nhớ khi bị quét từ rất nhiều địa chỉ
            for k in [k for k, v in _fails.items() if v[1] < now and now - v[2] > LOCK_SECONDS]:
                del _fails[k]
        rec = _fails.setdefault(ip, [0, 0, now])
        if now - rec[2] > LOCK_SECONDS:
            rec[0] = 0
        rec[0] += 1
        rec[2] = now
        if rec[0] >= MAX_FAILS:
            rec[0], rec[1] = 0, now + LOCK_SECONDS


def authenticate(login, password, ip):
    """Trả về (user, lỗi). lỗi là 'locked' hoặc 'invalid'."""
    ip = ip or "?"
    if is_locked(ip):
        return None, "locked"
    login = (login or "").strip().lower()
    if "@" not in login:
        login = "%s@%s" % (login, config.DOMAIN)
    user = db.user_by_email(login) if len(login) <= 254 else None
    password = (password or "")[:1024]
    ok = db.check_password(password, user["pw_hash"] if user else _DUMMY_HASH) and user is not None
    _record(ip, ok)
    return (user, None) if ok else (None, "invalid")


def is_local_peer(ip):
    try:
        return ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return False


def plaintext_login_allowed(ip, tls_active):
    return tls_active or config.ALLOW_PLAIN_AUTH or is_local_peer(ip)


# ---------- giới hạn số thư gửi ----------

_sent = {}  # user_id -> [(thời điểm, số người nhận)]
_sent_lock = threading.Lock()


def check_send_quota(user_id, recipients):
    """Chặn tài khoản (có thể đã bị lộ mật khẩu) gửi thư hàng loạt."""
    now = time.time()
    with _sent_lock:
        log = [e for e in _sent.get(user_id, []) if now - e[0] < 3600]
        if sum(n for _, n in log) + recipients > config.SEND_LIMIT_PER_HOUR:
            _sent[user_id] = log
            return False
        log.append((now, recipients))
        _sent[user_id] = log
        return True


# ---------- tệp bí mật ----------

def _private_file(name, make):
    """Đọc tệp trong thư mục dữ liệu; nếu chưa có thì tạo với quyền chỉ chủ sở hữu đọc được."""
    os.makedirs(config.DATA_DIR, mode=0o700, exist_ok=True)
    path = os.path.join(config.DATA_DIR, name)
    if not os.path.exists(path):
        data = make()
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
    with open(path, "rb") as f:
        return f.read()


def session_secret():
    return _private_file("secret.key", lambda: secrets.token_hex(32).encode()).decode().strip()


# ---------- mã thiết lập lần đầu ----------

def setup_token():
    return _private_file("setup.token", lambda: secrets.token_urlsafe(9).encode()).decode().strip()


def check_setup_token(value):
    return hmac.compare_digest((value or "").strip().encode(), setup_token().encode())


def clear_setup_token():
    try:
        os.remove(os.path.join(config.DATA_DIR, "setup.token"))
    except OSError:
        pass


# ---------- TLS ----------

_tls = None


def _self_signed():
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, config.HOSTNAME[:64])])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(config.HOSTNAME)]), critical=False)
            .sign(key, hashes.SHA256()))
    return (key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                              serialization.NoEncryption()) + cert.public_bytes(serialization.Encoding.PEM))


def tls_self_signed():
    return not (config.TLS_CERT and config.TLS_KEY)


def server_tls_context():
    """Ngữ cảnh TLS cho SMTP/IMAP/POP3. Không cấu hình chứng chỉ thì tự tạo chứng chỉ tự ký."""
    global _tls
    if _tls is None:
        ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        if tls_self_signed():
            _private_file("tls-selfsigned.pem", _self_signed)
            ctx.load_cert_chain(os.path.join(config.DATA_DIR, "tls-selfsigned.pem"))
        else:
            ctx.load_cert_chain(config.TLS_CERT, config.TLS_KEY)
        _tls = ctx
    return _tls


# ---------- DKIM ----------

def _new_dkim_key():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                             serialization.NoEncryption())


def dkim_key():
    return _private_file("dkim.key", _new_dkim_key)


def dkim_sign(raw, domain=None):
    """Thêm chữ ký DKIM vào đầu thư. Lỗi ký không được làm hỏng việc gửi thư."""
    try:
        import dkim
        header = dkim.sign(
            raw, config.DKIM_SELECTOR.encode(), (domain or config.DOMAIN).encode(), dkim_key(),
            include_headers=[b"from", b"to", b"cc", b"subject", b"date", b"message-id", b"in-reply-to",
                             b"references", b"mime-version", b"content-type"])
        return header + raw
    except Exception:
        import logging
        logging.getLogger("webmail").exception("Không ký được DKIM")
        return raw


def dkim_dns_value():
    from cryptography.hazmat.primitives import serialization
    key = serialization.load_pem_private_key(dkim_key(), password=None)
    pub = key.public_key().public_bytes(serialization.Encoding.DER,
                                        serialization.PublicFormat.SubjectPublicKeyInfo)
    return "v=DKIM1; k=rsa; p=" + base64.b64encode(pub).decode()


def dns_records():
    """Các bản ghi DNS cần khai báo để thư gửi đi được tin cậy."""
    out = []
    for d in config.DOMAINS:
        out += [
            {"type": "MX", "name": d, "value": "10 %s." % config.HOSTNAME,
             "note": "Thư gửi tới @%s sẽ đi về máy chủ này." % d},
            {"type": "TXT", "name": d, "value": "v=spf1 mx ~all",
             "note": "SPF: cho phép máy chủ trong bản ghi MX gửi thư."},
            {"type": "TXT", "name": "%s._domainkey.%s" % (config.DKIM_SELECTOR, d), "value": dkim_dns_value(),
             "note": "DKIM: khóa công khai để bên nhận kiểm tra chữ ký."},
            {"type": "TXT", "name": "_dmarc." + d, "value": "v=DMARC1; p=quarantine; rua=mailto:postmaster@" + d,
             "note": "DMARC: cách bên nhận xử lý thư giả mạo tên miền."},
        ]
    return out
