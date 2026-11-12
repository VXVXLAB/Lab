"""Nhận thư qua SMTP, cổng gửi thư có xác thực, phát thư nội bộ và hàng đợi gửi thư ra ngoài."""
import asyncio
import logging
import smtplib
import ssl
import threading
import time
from email.utils import formatdate, parseaddr

from . import config, db, mime, security, spam

log = logging.getLogger("webmail")
RETRY_DELAYS = [60, 300, 900, 3600, 3 * 3600]  # giây; hết danh sách thì trả thư về
MAX_RCPTS = 100
_wake = threading.Event()


class PermanentError(Exception):
    pass


# ---------- phát thư ----------

def deliver_local(user, raw, auth=None):
    """Lưu thư vào hộp của người dùng. auth: kết quả spam.check_inbound với thư từ bên ngoài, None với thư nội bộ."""
    p = mime.parse(raw)
    folder = "inbox"
    toks = spam.tokens(p["subject"], p["text"], p["from_addr"]) if auth is not None else []
    if auth is not None:
        if auth["spam"]:
            folder = "spam"
        else:
            score = spam.bayes_score(db.conn(), user["id"], toks)
            if score is not None and score >= 0.92:
                folder = "spam"
    mid = db.insert_message(user["id"], folder, p, raw=raw)
    if auth is not None and folder == "inbox":
        # Coi thư vào hộp đến là thư thường; nếu người dùng báo rác, lần học này được đảo lại.
        with db.conn() as c:
            spam.train(c, user["id"], toks, False)
            c.execute("UPDATE messages SET spam_trained=2 WHERE id=?", (mid,))
    return mid


def bounce(mail_from, rcpt, reason):
    """Báo cho người gửi nội bộ biết thư không tới được."""
    sender = db.find_local_user(mail_from)
    if not sender:
        return
    text = (
        "Thư của bạn không gửi được tới địa chỉ sau:\n\n    %s\n\nLý do: %s\n\n"
        "Hãy kiểm tra lại địa chỉ người nhận rồi gửi lại." % (rcpt, str(reason)[:500])
    )
    raw = mime.build("Hệ thống thư", "postmaster@" + config.DOMAIN, [(sender["name"], sender["email"])], [],
                     "Không gửi được thư tới " + rcpt, text)
    deliver_local(sender, raw)


def route(mail_from, rcpt, raw):
    domain = rcpt.rpartition("@")[2].lower()
    if domain in config.DOMAINS:
        user = db.find_local_user(rcpt)
        if user:
            deliver_local(user, raw)
        else:
            bounce(mail_from, rcpt, "Hộp thư này không tồn tại.")
        return
    with db.conn() as c:
        c.execute("INSERT INTO outbox(mail_from,rcpt,raw,next_try) VALUES(?,?,?,?)",
                  (mail_from, rcpt, raw, time.time()))
    _wake.set()


def _unique(addresses):
    seen, out = set(), []
    for a in addresses:
        if a.lower() not in seen:
            seen.add(a.lower())
            out.append(a)
    return out


def rebuild_draft(c, user, did):
    """Dựng lại bản MIME của thư nháp (để IMAP đọc được) và cấp UID mới vì nội dung đã đổi."""
    d = c.execute("SELECT * FROM messages WHERE id=?", (did,)).fetchone()
    atts = c.execute("SELECT * FROM attachments WHERE message_id=? ORDER BY id", (did,)).fetchall()

    def lenient(value):
        try:
            return mime.split_addresses(value)
        except ValueError:
            return []
    try:
        raw = mime.build(user["name"], user["email"], lenient(d["to_addrs"]), lenient(d["cc_addrs"]), d["subject"],
                         d["body_text"], atts, d["in_reply_to"], d["refs"], html=d["body_html"])
    except Exception:
        raw = None
    c.execute("UPDATE messages SET raw=?, size=?, uid=? WHERE id=?",
              (raw, len(raw) if raw else 0, db.next_uid(c), did))


def send_draft(user, draft):
    """Gửi một thư nháp: lưu vào Thư đã gửi rồi phát tới từng người nhận."""
    to = mime.split_addresses(draft["to_addrs"])
    cc = mime.split_addresses(draft["cc_addrs"])
    bcc = mime.split_addresses(draft["bcc_addrs"])
    rcpts = _unique([a for _, a in to + cc + bcc])
    if not rcpts:
        raise ValueError("Hãy nhập ít nhất một người nhận.")
    if len(rcpts) > MAX_RCPTS:
        raise ValueError("Mỗi thư chỉ gửi được tới tối đa %d người nhận." % MAX_RCPTS)
    atts = db.list_attachments(draft["id"], with_data=True)
    raw = mime.build(user["name"], user["email"], to, cc, draft["subject"], draft["body_text"], atts,
                     draft["in_reply_to"], draft["refs"], html=draft["body_html"])
    if len(raw) > config.MAX_SIZE:
        raise ValueError("Thư vượt quá dung lượng cho phép.")
    if not security.check_send_quota(user["id"], len(rcpts)):
        raise ValueError("Bạn đã gửi quá nhiều thư trong một giờ. Hãy thử lại sau.")
    raw = security.dkim_sign(raw, user["email"].rpartition("@")[2])
    with db.conn() as c:
        c.execute("DELETE FROM messages WHERE id=?", (draft["id"],))
    sent_id = db.insert_message(user["id"], "sent", mime.parse(raw), raw=raw, is_read=1,
                                bcc=draft["bcc_addrs"])
    for addr in rcpts:
        route(user["email"], addr, raw)
    return sent_id


# ---------- gửi ra ngoài ----------

def _mx_hosts(domain):
    import dns.resolver
    try:
        answers = dns.resolver.resolve(domain, "MX")
        hosts = [str(r.exchange).rstrip(".") for r in sorted(answers, key=lambda r: r.preference)]
        return [h for h in hosts if h] or [domain]
    except dns.resolver.NXDOMAIN:
        raise PermanentError("Tên miền %s không tồn tại." % domain)
    except (dns.resolver.NoAnswer, dns.resolver.NoNameservers):
        return [domain]


def _smtp_send(host, port, mail_from, rcpt, raw, smarthost):
    with smtplib.SMTP(host, port, timeout=30, local_hostname=config.HOSTNAME) as s:
        s.ehlo()
        if s.has_extn("starttls"):
            if smarthost:
                s.starttls(context=ssl.create_default_context())
            else:  # MX: mã hóa cơ hội, không bắt buộc chứng chỉ hợp lệ (như các máy chủ thư khác)
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                s.starttls(context=ctx)
            s.ehlo()
        elif smarthost and config.SMARTHOST_USER:
            raise RuntimeError("Máy chủ trung chuyển không hỗ trợ STARTTLS; không gửi mật khẩu qua kênh không mã hóa.")
        if smarthost and config.SMARTHOST_USER:
            s.login(config.SMARTHOST_USER, config.SMARTHOST_PASSWORD or "")
        s.sendmail(mail_from, [rcpt], raw)


def deliver_remote(mail_from, rcpt, raw):
    if config.SMARTHOST:
        targets, port, smarthost = [config.SMARTHOST], config.SMARTHOST_PORT, True
    else:
        targets, port, smarthost = _mx_hosts(rcpt.rpartition("@")[2]), config.OUT_PORT, False
    last = None
    for host in targets[:3]:
        try:
            _smtp_send(host, port, mail_from, rcpt, raw, smarthost)
            return
        except smtplib.SMTPRecipientsRefused as e:
            code, msg = next(iter(e.recipients.values()))
            text = "%s %s" % (code, msg.decode("utf-8", "replace") if isinstance(msg, bytes) else msg)
            if 500 <= code < 600:
                raise PermanentError(text)
            last = text
        except smtplib.SMTPResponseException as e:
            msg = e.smtp_error.decode("utf-8", "replace") if isinstance(e.smtp_error, bytes) else e.smtp_error
            text = "%s %s" % (e.smtp_code, msg)
            if 500 <= e.smtp_code < 600:
                raise PermanentError(text)
            last = text
        except (OSError, smtplib.SMTPException, RuntimeError) as e:
            last = "%s: %s" % (host, e)
    raise RuntimeError(last or "Không kết nối được máy chủ nhận.")


def process_outbox():
    rows = db.conn().execute("SELECT * FROM outbox WHERE next_try<=? ORDER BY id LIMIT 50",
                             (time.time(),)).fetchall()
    for row in rows:
        try:
            deliver_remote(row["mail_from"], row["rcpt"], bytes(row["raw"]))
            failure = None
        except PermanentError as e:
            failure, final = str(e), True
        except Exception as e:  # lỗi tạm thời: thử lại sau
            failure, final = str(e), row["attempts"] >= len(RETRY_DELAYS)
        with db.conn() as c:
            if failure is None:
                c.execute("DELETE FROM outbox WHERE id=?", (row["id"],))
                log.info("Đã gửi thư tới %s", row["rcpt"])
            elif final:
                c.execute("DELETE FROM outbox WHERE id=?", (row["id"],))
            else:
                c.execute("UPDATE outbox SET attempts=attempts+1,next_try=?,last_error=? WHERE id=?",
                          (time.time() + RETRY_DELAYS[row["attempts"]], failure, row["id"]))
        if failure is not None:
            log.warning("Gửi tới %s thất bại (%s): %s", row["rcpt"], "bỏ" if final else "sẽ thử lại", failure)
            if final:
                bounce(row["mail_from"], row["rcpt"], failure)


def purge_old():
    """Xóa hẳn thư đã nằm trong Thư rác/Thùng rác quá thời hạn."""
    if config.RETENTION_DAYS <= 0:
        return
    cutoff = time.time() - config.RETENTION_DAYS * 86400
    with db.conn() as c:
        c.execute("DELETE FROM messages WHERE folder IN ('trash','spam') AND COALESCE(moved,date)<?", (cutoff,))


def outbox_worker():
    last_purge = 0
    while True:
        _wake.wait(timeout=30)
        _wake.clear()
        try:
            process_outbox()
            if time.time() - last_purge > 3600:
                last_purge = time.time()
                purge_old()
        except Exception:
            log.exception("Lỗi hàng đợi gửi thư")


# ---------- nhận thư SMTP (cổng 25) ----------

def _store_inbound(peer, helo, mail_from, rcpts, content):
    from_addr = mime.parse_from(content)
    content = spam.strip_auth_results(content)
    auth = spam.check_inbound(peer, helo, mail_from, content, from_addr)
    # Thư từ Internet tự nhận là của tên miền nội bộ mà không có chữ ký hợp lệ: nhiều khả năng giả mạo.
    if (not auth["spam"] and from_addr.rpartition("@")[2].lower() in config.DOMAINS
            and spam._public_ip(peer) and auth["dkim"] != "pass"):
        auth["spam"], auth["reason"] = True, "Giả mạo địa chỉ nội bộ"
    received = "Received: from %s ([%s]) by %s with ESMTP; %s\r\n" % (
        "".join(ch for ch in (helo or "unknown") if ch.isalnum() or ch in ".-_[]:")[:255] or "unknown",
        peer, config.HOSTNAME, formatdate(localtime=True))
    raw = auth["header"].encode("ascii", "replace") + received.encode("ascii", "replace") + content
    done = set()
    for rcpt in rcpts:
        user = db.find_local_user(rcpt)
        if user and user["id"] not in done:
            done.add(user["id"])
            deliver_local(user, raw, auth)
    return auth


class InboundHandler:
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        if len(envelope.rcpt_tos) >= MAX_RCPTS:
            return "452 4.5.3 Too many recipients"
        if address.rpartition("@")[2].lower() not in config.DOMAINS:
            return "550 5.7.1 Relaying denied"
        if not db.find_local_user(address):
            return "550 5.1.1 User unknown"
        envelope.rcpt_tos.append(address)
        return "250 OK"

    async def handle_DATA(self, server, session, envelope):
        peer = session.peer[0] if session.peer else "unknown"
        try:
            auth = await asyncio.get_running_loop().run_in_executor(
                None, _store_inbound, peer, session.host_name, envelope.mail_from, list(envelope.rcpt_tos),
                envelope.content)
        except Exception:
            log.exception("Lỗi lưu thư đến")
            return "451 4.3.0 Temporary failure"
        log.info("Nhận thư từ %s cho %s%s", envelope.mail_from, ", ".join(envelope.rcpt_tos),
                 " [thư rác: %s]" % auth["reason"] if auth["spam"] else "")
        return "250 2.0.0 OK"


# ---------- cổng gửi thư cho ứng dụng thư (587) ----------

def _smtp_authenticator(server, session, envelope, mechanism, auth_data):
    from aiosmtpd.smtp import AuthResult, LoginPassword
    if not isinstance(auth_data, LoginPassword):
        return AuthResult(success=False, handled=False)
    peer = session.peer[0] if session.peer else "?"
    try:
        user, _ = security.authenticate(auth_data.login.decode("utf-8", "replace"),
                                        auth_data.password.decode("utf-8", "replace"), peer)
    except Exception:
        log.exception("Lỗi xác thực SMTP")
        user = None
    if not user:
        return AuthResult(success=False, handled=False)
    return AuthResult(success=True, auth_data={"id": user["id"], "email": user["email"]})


def _submit(user, rcpts, content):
    from_addr = mime.parse_from(content).lower()
    if from_addr != user["email"]:
        return "550 5.7.1 From header must be %s" % user["email"]
    if not security.check_send_quota(user["id"], len(rcpts)):
        return "451 4.7.1 Sending limit reached, try again later"
    raw = security.dkim_sign(content, user["email"].rpartition("@")[2])
    for rcpt in rcpts:
        route(user["email"], rcpt, raw)
    return "250 2.0.0 OK"


class SubmissionHandler:
    async def handle_MAIL(self, server, session, envelope, address, mail_options):
        user = session.auth_data
        if not user or address.lower() != user["email"]:
            return "553 5.7.1 Sender address rejected: not owned by user"
        envelope.mail_from = address
        envelope.mail_options.extend(mail_options)
        return "250 OK"

    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        if len(envelope.rcpt_tos) >= MAX_RCPTS:
            return "452 4.5.3 Too many recipients"
        if not mime.ADDR_RE.match(address):
            return "553 5.1.3 Bad recipient address"
        envelope.rcpt_tos.append(address)
        return "250 OK"

    async def handle_DATA(self, server, session, envelope):
        user = session.auth_data
        if not user:
            return "530 5.7.0 Authentication required"
        try:
            return await asyncio.get_running_loop().run_in_executor(
                None, _submit, user, _unique(envelope.rcpt_tos), envelope.content)
        except Exception:
            log.exception("Lỗi gửi thư qua cổng submission")
            return "451 4.3.0 Temporary failure"


def start_smtp():
    from aiosmtpd.controller import Controller
    from aiosmtpd.smtp import SMTP

    class TolerantSMTP(SMTP):
        line_length_limit = 100_000  # nhiều máy gửi vượt mốc 998 byte/dòng; nhận thay vì từ chối

    class MailController(Controller):
        def factory(self):
            return TolerantSMTP(self.handler, **self.SMTP_kwargs)

    logging.getLogger("mail.log").setLevel(logging.WARNING)
    tls = security.server_tls_context()
    controllers = []
    if config.SMTP_PORT:
        controllers.append(MailController(
            InboundHandler(), hostname=config.SMTP_HOST, port=config.SMTP_PORT, server_hostname=config.HOSTNAME,
            data_size_limit=config.MAX_SIZE, tls_context=tls, timeout=120, ident="ESMTP"))
    if config.SUBMISSION_PORT:
        controllers.append(MailController(
            SubmissionHandler(), hostname=config.SMTP_HOST, port=config.SUBMISSION_PORT,
            server_hostname=config.HOSTNAME, data_size_limit=config.MAX_SIZE, tls_context=tls, timeout=120,
            ident="ESMTP", authenticator=_smtp_authenticator, auth_required=True,
            auth_require_tls=not config.ALLOW_PLAIN_AUTH))
    for c in controllers:
        c.start()
    return controllers
