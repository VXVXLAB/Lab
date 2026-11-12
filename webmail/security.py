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
#
# Hai lớp: (1) theo địa chỉ IP và theo từng nhóm giao thức, để web không khóa nhầm IMAP và ngược lại;
# (2) theo tài khoản, làm chậm dần mọi nơi đang đoán mật khẩu của cùng một tài khoản, trừ địa chỉ IP
# đã từng đăng nhập đúng tài khoản đó (để chủ tài khoản không bị kẻ tấn công khóa ngoài).

MAX_FAILS = 20       # số lần sai từ một IP trong WINDOW giây trước khi IP bị khóa
WINDOW = 300
LOCK_SECONDS = 300
ACCOUNT_FREE_FAILS = 10   # sau chừng này lần sai cho một tài khoản thì bắt đầu bắt chờ
_fails = {}          # "nhóm:ip" -> [số lần sai, khóa đến lúc, lần sai gần nhất]
_acct = {}           # email -> [số lần sai, lần sai gần nhất]
_good = {}           # (ip, email) -> lần đăng nhập đúng gần nhất
_fails_lock = threading.Lock()
# Băm một mật khẩu giả khi tài khoản không tồn tại để thời gian phản hồi không lộ tài khoản nào có thật.
_DUMMY_HASH = db.hash_password(secrets.token_hex(8))


def _key(ip, scope):
    return "%s:%s" % (scope, ip or "?")


def is_locked(ip, scope="web"):
    rec = _fails.get(_key(ip, scope))
    return bool(rec and rec[1] > time.time())


def _prune(table, now, age, index):
    if len(table) > 20000:  # giới hạn bộ nhớ khi bị quét từ rất nhiều địa chỉ
        for k in [k for k, v in table.items() if now - (v[index] if isinstance(v, list) else v) > age]:
            del table[k]
        if len(table) > 20000:
            table.clear()


def record_failure(ip, scope="web"):
    """Ghi một lần sai cho địa chỉ IP. Lần đăng nhập đúng KHÔNG xóa bộ đếm; nó chỉ tự giảm theo thời gian."""
    now = time.time()
    with _fails_lock:
        _prune(_fails, now, WINDOW, 2)
        rec = _fails.setdefault(_key(ip, scope), [0, 0, now])
        if now - rec[2] > WINDOW:
            rec[0] = 0
        rec[0] += 1
        rec[2] = now
        if rec[0] >= MAX_FAILS:
            rec[0], rec[1] = 0, now + LOCK_SECONDS


def _undo_failure(ip, scope):
    with _fails_lock:
        rec = _fails.get(_key(ip, scope))
        if rec and rec[0] > 0:
            rec[0] -= 1


def _account_wait(login, ip, now):
    """Số giây tài khoản này còn phải chờ trước lần thử tiếp theo từ một địa chỉ IP lạ."""
    rec = _acct.get(login)
    if not rec or (ip, login) in _good:
        return 0
    if now - rec[1] > 900:
        _acct.pop(login, None)
        return 0
    if rec[0] < ACCOUNT_FREE_FAILS:
        return 0
    return max(0, min(2 ** (rec[0] - ACCOUNT_FREE_FAILS), 60) - (now - rec[1]))


def authenticate(login, password, ip, scope="web"):
    """Trả về (user, lỗi). lỗi là 'locked' hoặc 'invalid'."""
    ip = ip or "?"
    now = time.time()
    login = (login or "").strip().lower()[:320]
    if "@" not in login:
        login = "%s@%s" % (login, config.DOMAIN)
    with _fails_lock:
        if is_locked(ip, scope) or _account_wait(login, ip, now) > 0:
            return None, "locked"
    # Tính trước lần thử này là sai, để nhiều kết nối song song không vượt được giới hạn.
    record_failure(ip, scope)
    user = db.user_by_email(login) if len(login) <= 254 else None
    password = (password or "")[:1024]
    ok = db.check_password(password, user["pw_hash"] if user else _DUMMY_HASH) and user is not None
    with _fails_lock:
        if ok:
            _good[(ip, login)] = now
            _acct.pop(login, None)
            _prune(_good, now, 30 * 86400, 0)
        else:
            _prune(_acct, now, 900, 1)
            rec = _acct.setdefault(login, [0, now])
            rec[0] += 1
            rec[1] = now
    if ok:
        _undo_failure(ip, scope)
    return (user, None) if ok else (None, "invalid")


# ---------- phiên đăng nhập web (lưu phía máy chủ để đăng xuất là hết hiệu lực thật) ----------

SESSION_DAYS = 14


def _sid(token):
    import hashlib
    return hashlib.sha256(token.encode()).hexdigest()


def new_session(user_id):
    token = secrets.token_urlsafe(32)
    with db.conn() as c:
        c.execute("INSERT INTO sessions(id,user_id,expires) VALUES(?,?,?)",
                  (_sid(token), user_id, time.time() + SESSION_DAYS * 86400))
    return token


def session_user(token):
    if not isinstance(token, str) or not token:
        return None
    return db.conn().execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires>?",
        (_sid(token), time.time())).fetchone()


def end_session(token):
    if isinstance(token, str) and token:
        with db.conn() as c:
            c.execute("DELETE FROM sessions WHERE id=?", (_sid(token),))


def end_other_sessions(user_id, keep_token=None):
    """Đổi/đặt lại mật khẩu: đăng xuất mọi thiết bị khác."""
    with db.conn() as c:
        c.execute("DELETE FROM sessions WHERE user_id=? AND id!=?", (user_id, _sid(keep_token or "")))


def purge_sessions():
    with db.conn() as c:
        c.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))


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
            # Các tiêu đề người đọc nhìn thấy được liệt kê thừa một lần ("oversign") để không ai chèn thêm
            # một dòng From/Subject khác vào thư đã ký mà chữ ký vẫn hợp lệ.
            include_headers=[b"from", b"from", b"to", b"to", b"cc", b"cc", b"subject", b"subject", b"date", b"date",
                             b"message-id", b"message-id", b"reply-to", b"reply-to", b"in-reply-to",
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
