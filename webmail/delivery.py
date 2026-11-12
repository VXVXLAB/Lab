"""Nhận thư qua SMTP, phát thư nội bộ và hàng đợi gửi thư ra ngoài."""
import logging
import smtplib
import ssl
import threading
import time
from email.utils import formatdate

from . import config, db, mime

log = logging.getLogger("webmail")
RETRY_DELAYS = [60, 300, 900, 3600, 3 * 3600]  # giây; hết danh sách thì trả thư về
_wake = threading.Event()


class PermanentError(Exception):
    pass


# ---------- phát thư ----------

def deliver_local(user, raw):
    return db.insert_message(user["id"], "inbox", mime.parse(raw), raw=raw)


def bounce(mail_from, rcpt, reason):
    """Báo cho người gửi nội bộ biết thư không tới được."""
    sender = db.find_local_user(mail_from)
    if not sender:
        return
    text = (
        "Thư của bạn không gửi được tới địa chỉ sau:\n\n    %s\n\nLý do: %s\n\n"
        "Hãy kiểm tra lại địa chỉ người nhận rồi gửi lại." % (rcpt, reason)
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


def send_draft(user, draft):
    """Gửi một thư nháp: lưu vào Thư đã gửi rồi phát tới từng người nhận."""
    to = mime.split_addresses(draft["to_addrs"])
    cc = mime.split_addresses(draft["cc_addrs"])
    bcc = mime.split_addresses(draft["bcc_addrs"])
    if not (to or cc or bcc):
        raise ValueError("Hãy nhập ít nhất một người nhận.")
    atts = db.list_attachments(draft["id"], with_data=True)
    raw = mime.build(user["name"], user["email"], to, cc, draft["subject"], draft["body_text"], atts,
                     draft["in_reply_to"], draft["refs"])
    if len(raw) > config.MAX_SIZE:
        raise ValueError("Thư vượt quá dung lượng cho phép.")
    with db.conn() as c:
        c.execute("DELETE FROM messages WHERE id=?", (draft["id"],))
    sent_id = db.insert_message(user["id"], "sent", mime.parse(raw), raw=raw, is_read=1,
                                bcc=draft["bcc_addrs"])
    seen = set()
    for _, addr in to + cc + bcc:
        if addr.lower() not in seen:
            seen.add(addr.lower())
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
            else:  # MX: mã hóa cơ hội, không bắt buộc chứng chỉ hợp lệ
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                s.starttls(context=ctx)
            s.ehlo()
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
        except (OSError, smtplib.SMTPException) as e:
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


def outbox_worker():
    while True:
        _wake.wait(timeout=30)
        _wake.clear()
        try:
            process_outbox()
        except Exception:
            log.exception("Lỗi hàng đợi gửi thư")


# ---------- nhận thư SMTP ----------

class InboundHandler:
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        if address.rpartition("@")[2].lower() not in config.DOMAINS:
            return "550 5.7.1 Relaying denied"
        if not db.find_local_user(address):
            return "550 5.1.1 User unknown"
        envelope.rcpt_tos.append(address)
        return "250 OK"

    async def handle_DATA(self, server, session, envelope):
        peer = session.peer[0] if session.peer else "unknown"
        received = "Received: from %s ([%s]) by %s with ESMTP; %s\r\n" % (
            session.host_name or "unknown", peer, config.HOSTNAME, formatdate(localtime=True))
        raw = received.encode("ascii", "replace") + envelope.content
        try:
            done = set()
            for rcpt in envelope.rcpt_tos:
                user = db.find_local_user(rcpt)
                if user and user["id"] not in done:
                    done.add(user["id"])
                    deliver_local(user, raw)
        except Exception:
            log.exception("Lỗi lưu thư đến")
            return "451 4.3.0 Temporary failure"
        log.info("Nhận thư từ %s cho %s", envelope.mail_from, ", ".join(envelope.rcpt_tos))
        return "250 2.0.0 OK"


def start_smtp():
    from aiosmtpd.controller import Controller
    from aiosmtpd.smtp import SMTP

    class TolerantSMTP(SMTP):
        line_length_limit = 100_000  # nhiều máy gửi vượt mốc 998 byte/dòng; nhận thay vì từ chối

    class MailController(Controller):
        def factory(self):
            return TolerantSMTP(self.handler, **self.SMTP_kwargs)

    logging.getLogger("mail.log").setLevel(logging.WARNING)
    kwargs = {}
    if config.TLS_CERT and config.TLS_KEY:
        ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ctx.load_cert_chain(config.TLS_CERT, config.TLS_KEY)
        kwargs["tls_context"] = ctx
    controller = MailController(InboundHandler(), hostname=config.SMTP_HOST, port=config.SMTP_PORT,
                            server_hostname=config.HOSTNAME, data_size_limit=config.MAX_SIZE, **kwargs)
    controller.start()
    return controller
