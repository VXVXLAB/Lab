"""Kiểm thử đầu-cuối: chạy máy chủ thật trên cổng tạm rồi đi qua web API, SMTP, IMAP, POP3.

    python webmail/tests/test_end_to_end.py
"""
import email
import imaplib
import json
import os
import poplib
import re
import smtplib
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from email.message import EmailMessage
from http.cookiejar import CookieJar

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
PORTS = dict(WEB_PORT=18080, SMTP_PORT=12525, SUBMISSION_PORT=11587, IMAP_PORT=11143, IMAPS_PORT=11993,
             POP3_PORT=11110, POP3S_PORT=11995)
SINK_PORT = 12626
NOVERIFY = ssl.create_default_context()
NOVERIFY.check_hostname = False
NOVERIFY.verify_mode = ssl.CERT_NONE
checks = 0


def ok(cond, what):
    global checks
    checks += 1
    if not cond:
        raise AssertionError(what)
    print("  ok  " + what)


class Web:
    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))

    def call(self, method, path, body=None, csrf=True):
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORTS["WEB_PORT"], path), method=method,
                                     data=None if body is None else json.dumps(body).encode())
        req.add_header("Content-Type", "application/json")
        if csrf:
            req.add_header("X-Requested-With", "webmail")
        try:
            with self.opener.open(req) as r:
                data = r.read()
                return r.status, (json.loads(data) if r.headers.get_content_type() == "application/json" else data), r.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}"), e.headers


def wait_port(port):
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("port %d not up" % port)


def smtp_in(sender, rcpts, msg):
    with smtplib.SMTP("127.0.0.1", PORTS["SMTP_PORT"]) as s:
        return s.sendmail(sender, rcpts, msg.as_bytes() if hasattr(msg, "as_bytes") else msg)


def make(frm, to, subject, body):
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = frm, to, subject
    m["Message-ID"] = email.utils.make_msgid()
    m.set_content(body)
    return m


def main():
    data = tempfile.mkdtemp(prefix="webmail-test-")
    env = dict(os.environ, MAIL_DOMAIN="congty.test", MAIL_HOSTNAME="mail.congty.test", MAIL_DATA_DIR=data,
               SMARTHOST="127.0.0.1", SMARTHOST_PORT=str(SINK_PORT), **{k: str(v) for k, v in PORTS.items()})
    sink_file = os.path.join(data, "sink.out")
    sink = subprocess.Popen([sys.executable, "-c", """
import sys, time
from aiosmtpd.controller import Controller
class H:
    async def handle_DATA(self, server, session, envelope):
        open(sys.argv[1], 'ab').write(envelope.content + b'\\n=====END=====\\n')
        return '250 OK'
Controller(H(), hostname='127.0.0.1', port=int(sys.argv[2])).start()
time.sleep(600)
""", sink_file, str(SINK_PORT)])
    log = open(os.path.join(data, "server.log"), "w")
    server = subprocess.Popen([sys.executable, "-m", "webmail"], cwd=ROOT, env=env, stdout=log, stderr=log)
    try:
        for p in list(PORTS.values()) + [SINK_PORT]:
            wait_port(p)
        run(data, sink_file)
        print("\nTẤT CẢ %d KIỂM TRA ĐỀU ĐẠT" % checks)
    finally:
        server.terminate()
        sink.terminate()
        log.close()
        if "-v" in sys.argv:
            print(open(os.path.join(data, "server.log")).read()[-3000:])


def run(data, sink_file):
    print("Thiết lập & đăng nhập")
    w = Web()
    st, r, _ = w.call("POST", "/api/setup", {"email": "an", "password": "matkhau-an-1", "name": "An", "token": "sai"})
    ok(st == 403, "thiết lập bị từ chối khi sai mã")
    token = open(os.path.join(data, "setup.token")).read().strip()
    st, r, _ = w.call("POST", "/api/setup", {"email": "an", "password": "matkhau-an-1", "name": "Nguyễn Văn An", "token": token})
    ok(st == 200 and r["user"]["is_admin"], "thiết lập với mã đúng tạo quản trị viên")
    ok(not os.path.exists(os.path.join(data, "setup.token")), "mã thiết lập bị hủy sau khi dùng")
    st, _, _ = w.call("POST", "/api/setup", {"email": "x", "password": "matkhau-an-1", "token": token})
    ok(st == 403, "không thiết lập lại được")
    st, r, _ = w.call("POST", "/api/admin/users", {"email": "binh", "name": "Bình", "password": "matkhau-binh-1"})
    ok(st == 200, "quản trị tạo người dùng")
    st, _, _ = w.call("POST", "/api/logout", {}, csrf=False)
    ok(st == 403, "yêu cầu thiếu tiêu đề chống CSRF bị chặn")
    wb = Web()
    st, _, _ = wb.call("POST", "/api/login", {"email": "binh", "password": "matkhau-binh-1"})
    ok(st == 200, "người dùng thường đăng nhập")
    st, _, _ = wb.call("GET", "/api/admin/users")
    ok(st == 403, "người dùng thường không vào được trang quản trị")
    st, _, _ = Web().call("GET", "/api/folders")
    ok(st == 401, "chưa đăng nhập thì không đọc được thư")

    print("Nhận thư SMTP")
    smtp_in("minh@doitac.test", ["an@congty.test"], make("Minh <minh@doitac.test>", "an@congty.test", "Báo giá", "Xin chào An"))
    for bad, code in (("khongco@congty.test", 550), ("x@noikhac.test", 550)):
        try:
            smtp_in("a@b.test", [bad], b"Subject: x\r\n\r\nhi")
            ok(False, "phải từ chối " + bad)
        except smtplib.SMTPRecipientsRefused as e:
            ok(list(e.recipients.values())[0][0] == code, "từ chối %s (không trung chuyển hộ)" % bad)
    st, r, _ = w.call("GET", "/api/messages?folder=inbox")
    subjects = [m["subject"] for m in r["items"]]
    ok("Báo giá" in subjects, "thư đến nằm trong Hộp thư đến")
    mid = next(m["id"] for m in r["items"] if m["subject"] == "Báo giá")
    st, _, _ = wb.call("GET", "/api/messages/%d" % mid)
    ok(st == 404, "người dùng khác không đọc được thư của mình")
    st, _, _ = wb.call("POST", "/api/messages/action", {"ids": [mid], "action": "delete"})
    st, r, _ = w.call("GET", "/api/messages/%d" % mid)
    ok(st == 200 and r["folder"] == "inbox", "người dùng khác không xóa được thư của mình")

    print("Thư HTML độc hại")
    m = make("x@doitac.test", "an@congty.test", "HTML", "plain")
    m.add_alternative('<html><body onload="a()"><script>alert(1)</script><img src="https://t.test/p.gif">'
                      '<a href="javascript:alert(1)" onclick="b()">x</a><iframe src="//e"></iframe><p>Nội dung</p>'
                      '<form action="https://e.test"><input name=p></form></body></html>', subtype="html")
    smtp_in("x@doitac.test", ["an@congty.test"], m)
    st, r, _ = w.call("GET", "/api/messages?folder=inbox")
    hid = next(x["id"] for x in r["items"] if x["subject"] == "HTML")
    st, page, headers = w.call("GET", "/api/messages/%d/html" % hid)
    page = page.decode()
    ok("Nội dung" in page and not re.search(r"<script|onload|onclick|javascript:|<iframe|<form|t\.test", page),
       "HTML được làm sạch (script, sự kiện, iframe, form, ảnh theo dõi)")
    ok("sandbox" in headers["Content-Security-Policy"] and "default-src 'none'" in headers["Content-Security-Policy"],
       "trang thư có CSP cách ly")

    print("Soạn & gửi thư (webmail)")
    st, r, _ = w.call("POST", "/api/drafts", {"to": "binh@congty.test, khach@ngoai.test", "subject": "Chào",
                                              "body": "", "html": '<b>Đậm</b><script>x()</script><img src=x onerror=y()><a href="javascript:1">l</a>'})
    did = r["id"]
    st, r, _ = w.call("GET", "/api/messages/%d" % did)
    ok(r["html"] == "<b>Đậm</b><a>l</a>", "HTML soạn thảo chỉ còn thẻ định dạng an toàn")
    st, _, _ = wb.call("POST", "/api/drafts/%d/send" % did, {})
    ok(st == 404, "người khác không gửi được thư nháp của mình")
    st, r, _ = w.call("POST", "/api/drafts/%d/send" % did, {})
    ok(st == 200, "gửi thư")
    for _ in range(50):
        if os.path.exists(sink_file) and b"END" in open(sink_file, "rb").read():
            break
        time.sleep(0.2)
    out = open(sink_file, "rb").read()
    ok(b"DKIM-Signature:" in out and b"d=congty.test" in out, "thư gửi ra ngoài có chữ ký DKIM")
    import dkim
    from webmail import security  # noqa: dùng lại hàm tính bản ghi DNS trên cùng thư mục dữ liệu
    os.environ["MAIL_DATA_DIR"] = data
    from webmail import config
    config.DATA_DIR = data
    txt = security.dkim_dns_value().encode()
    one = out.split(b"\n=====END=====\n")[0]
    ok(dkim.verify(one, dnsfunc=lambda name, timeout=5: txt), "chữ ký DKIM kiểm tra đúng với khóa công khai")
    st, r, _ = wb.call("GET", "/api/messages?folder=inbox")
    ok(any(x["subject"] == "Chào" for x in r["items"]), "người nhận nội bộ nhận được thư")

    print("Thư rác")
    st, _, _ = w.call("POST", "/api/messages/action", {"ids": [mid], "action": "spam"})
    st, r, _ = w.call("GET", "/api/messages/%d" % mid)
    ok(r["folder"] == "spam", "báo thư rác chuyển thư sang Thư rác")
    st, _, _ = w.call("POST", "/api/messages/action", {"ids": [mid], "action": "notspam"})
    st, r, _ = w.call("GET", "/api/messages/%d" % mid)
    ok(r["folder"] == "inbox", "bỏ đánh dấu thư rác đưa thư về Hộp thư đến")
    for i in range(10):
        smtp_in("qc%d@rac.test" % i, ["binh@congty.test"], make("qc%d@rac.test" % i, "binh@congty.test", "Trúng thưởng lớn %d" % i,
                "Chúc mừng bạn trúng thưởng xổ số casino khuyến mãi vay tiền nhanh lãi suất thấp bấm ngay http://rac.test/%d" % i))
        smtp_in("dn%d@doitac.test" % i, ["binh@congty.test"], make("dn%d@doitac.test" % i, "binh@congty.test", "Lịch họp dự án %d" % i,
                "Kính gửi anh chị, biên bản cuộc họp và kế hoạch triển khai hợp đồng tuần tới %d" % i))
    st, r, _ = wb.call("GET", "/api/messages?folder=inbox")
    junk = [x["id"] for x in r["items"] if x["subject"].startswith("Trúng thưởng")]
    wb.call("POST", "/api/messages/action", {"ids": junk, "action": "spam"})
    smtp_in("moi@rac.test", ["binh@congty.test"], make("moi@rac.test", "binh@congty.test", "Trúng thưởng lớn hôm nay",
            "Chúc mừng bạn trúng thưởng casino khuyến mãi vay tiền nhanh bấm ngay http://rac.test/z"))
    smtp_in("sep@doitac.test", ["binh@congty.test"], make("sep@doitac.test", "binh@congty.test", "Lịch họp dự án mới",
            "Kính gửi anh chị, kế hoạch triển khai hợp đồng và biên bản cuộc họp"))
    st, r, _ = wb.call("GET", "/api/messages?folder=spam")
    ok(any(x["subject"] == "Trúng thưởng lớn hôm nay" for x in r["items"]), "bộ lọc đã học tự chuyển thư rác mới vào Thư rác")
    st, r, _ = wb.call("GET", "/api/messages?folder=inbox")
    ok(any(x["subject"] == "Lịch họp dự án mới" for x in r["items"]), "thư công việc vẫn vào Hộp thư đến")

    print("IMAP")
    try:
        imaplib.IMAP4("127.0.0.1", PORTS["IMAP_PORT"]).login("an@congty.test", "sai-mat-khau")
        ok(False, "phải từ chối mật khẩu sai")
    except imaplib.IMAP4.error:
        ok(True, "IMAP từ chối mật khẩu sai")
    im = imaplib.IMAP4("127.0.0.1", PORTS["IMAP_PORT"])
    ok("STARTTLS" in im.capabilities, "IMAP quảng bá STARTTLS")
    im.starttls(NOVERIFY)
    im.login("an@congty.test", "matkhau-an-1")
    typ, boxes = im.list()
    names = b" ".join(boxes)
    ok(all(n in names for n in (b"INBOX", b"Sent", b"Drafts", b"Junk", b"Trash")) and b"\\Junk" in names, "IMAP liệt kê đủ thư mục")
    typ, d = im.select("INBOX")
    n = int(d[0])
    ok(n >= 3, "IMAP SELECT trả về số thư")
    typ, d = im.uid("SEARCH", None, "SUBJECT", '"HTML"')
    uid = d[0].split()[0]
    typ, d = im.uid("FETCH", uid, "(FLAGS RFC822.SIZE ENVELOPE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)] BODY.PEEK[1])")
    blob = b" ".join(x if isinstance(x, bytes) else b" ".join(x) for x in d)
    ok(b"ENVELOPE" in blob and b'"ALTERNATIVE"' in blob.upper() and b"Subject: HTML" in blob and b"plain" in blob,
       "IMAP FETCH trả ENVELOPE, BODYSTRUCTURE, phần tiêu đề và phần thân")
    typ, d = im.uid("FETCH", uid, "(RFC822)")
    parsed = email.message_from_bytes(d[0][1])
    ok(parsed["Subject"] == "HTML" and parsed.is_multipart() and "Authentication-Results" in parsed, "IMAP trả nguyên văn thư")
    typ, d = im.uid("FETCH", uid, "(FLAGS)")
    ok(b"\\Seen" in d[0], "đọc toàn văn đánh dấu đã đọc")
    im.uid("STORE", uid, "+FLAGS", "(\\Flagged)")
    st, r, _ = w.call("GET", "/api/messages?folder=starred")
    ok(any(x["id"] == hid for x in r["items"]), "gắn cờ qua IMAP hiện thành gắn sao trên webmail")
    typ, d = im.uid("MOVE", uid, "Junk")
    ok(typ == "OK", "IMAP MOVE sang Junk")
    st, r, _ = w.call("GET", "/api/messages/%d" % hid)
    ok(r["folder"] == "spam", "chuyển thư qua IMAP đồng bộ với webmail")
    typ, d = im.append("Sent", "(\\Seen)", None, make("an@congty.test", "z@ngoai.test", "Lưu từ ứng dụng", "x").as_bytes().replace(b"\n", b"\r\n"))
    ok(typ == "OK" and b"APPENDUID" in d[0], "IMAP APPEND lưu thư vào Sent")
    st, r, _ = w.call("GET", "/api/messages?folder=sent")
    ok(any(x["subject"] == "Lưu từ ứng dụng" for x in r["items"]), "thư APPEND hiện trên webmail")
    im.select("Trash")
    wb2 = w.call("POST", "/api/messages/action", {"ids": [mid], "action": "delete"})
    typ, d = im.noop()
    typ, d = im.search(None, "ALL")
    ok(len(d[0].split()) == 1, "thư xóa trên webmail xuất hiện trong Trash của IMAP")
    im.store("1", "+FLAGS", "(\\Deleted)")
    im.expunge()
    st, r, _ = w.call("GET", "/api/messages/%d" % mid)
    ok(st == 404, "EXPUNGE xóa hẳn thư")
    im2 = imaplib.IMAP4_SSL("127.0.0.1", PORTS["IMAPS_PORT"], ssl_context=NOVERIFY)
    im2.login("binh@congty.test", "matkhau-binh-1")
    im2.select("INBOX")
    typ, d = im2.search(None, "SUBJECT", '"HTML"')
    ok(d[0] == b"", "IMAP: người dùng chỉ thấy thư của mình")
    im2.logout()
    im.logout()

    print("Thư mục tự tạo")
    st, r, _ = w.call("POST", "/api/folders", {"name": "Dự án & Hợp đồng"})
    ok(st == 200, "tạo thư mục trên webmail")
    fkey = r["id"]
    st, _, _ = w.call("POST", "/api/folders", {"name": "dự án & hợp đồng"})
    ok(st == 400, "không tạo trùng tên (không phân biệt hoa thường)")
    st, _, _ = w.call("POST", "/api/folders", {"name": "Inbox"})
    ok(st == 400, "không dùng được tên thư mục hệ thống")
    st, _, _ = wb.call("PUT", "/api/folders/%s" % fkey[1:], {"name": "Của tôi"})
    ok(st == 404, "người khác không đổi tên được thư mục của mình")
    st, _, _ = wb.call("GET", "/api/messages?folder=%s" % fkey)
    ok(st == 404, "người khác không mở được thư mục của mình")
    smtp_in("kh@doitac.test", ["an@congty.test"], make("kh@doitac.test", "an@congty.test", "Hợp đồng số 7", "Nội dung hợp đồng"))
    st, r, _ = w.call("GET", "/api/messages?folder=inbox")
    cid_ = next(x["id"] for x in r["items"] if x["subject"] == "Hợp đồng số 7")
    st, _, _ = wb.call("POST", "/api/messages/action", {"ids": [cid_], "action": "move", "folder": fkey})
    st, _, _ = w.call("POST", "/api/messages/action", {"ids": [cid_], "action": "move", "folder": "f99999"})
    ok(st == 400, "không chuyển được vào thư mục không tồn tại")
    st, _, _ = w.call("POST", "/api/messages/action", {"ids": [cid_], "action": "move", "folder": fkey})
    st, r, _ = w.call("GET", "/api/messages?folder=%s" % fkey)
    ok(st == 200 and [x["subject"] for x in r["items"]] == ["Hợp đồng số 7"], "chuyển thư vào thư mục tự tạo")
    im = imaplib.IMAP4_SSL("127.0.0.1", PORTS["IMAPS_PORT"], ssl_context=NOVERIFY)
    im.login("an@congty.test", "matkhau-an-1")
    typ, boxes = im.list()
    from webmail.mailaccess import mutf7_encode
    enc = mutf7_encode("Dự án & Hợp đồng")
    ok(any(enc.encode() in b for b in boxes), "IMAP liệt kê thư mục tự tạo (tên có dấu mã hóa UTF-7 sửa đổi)")
    typ, d = im.select('"%s"' % enc)
    ok(typ == "OK" and int(d[0]) == 1, "IMAP mở được thư mục tự tạo")
    typ, d = im.create('"Kh&AOE-ch h&AOA-ng"')
    ok(typ == "OK", "IMAP CREATE")
    typ, d = im.uid("COPY", "1:*", '"Kh&AOE-ch h&AOA-ng"')
    ok(typ == "OK", "IMAP COPY sang thư mục mới")
    st, r, _ = w.call("GET", "/api/folders")
    names = {f["name"]: f["id"] for f in r["custom"]}
    ok("Khách hàng" in names, "thư mục tạo qua IMAP hiện trên webmail với tên đúng")
    typ, d = im.rename('"Kh&AOE-ch h&AOA-ng"', '"Doi tac"')
    typ, d = im.create("Sent")
    ok(typ == "NO", "IMAP không cho tạo trùng thư mục hệ thống")
    typ, d = im.delete("INBOX")
    ok(typ == "NO", "IMAP không cho xóa thư mục hệ thống")
    typ, d = im.delete('"Doi tac"')
    ok(typ == "OK", "IMAP RENAME rồi DELETE thư mục tự tạo")
    st, r, _ = w.call("GET", "/api/messages?folder=trash")
    ok(any(x["subject"] == "Hợp đồng số 7" for x in r["items"]), "xóa thư mục thì thư bên trong vào Thùng rác")
    im.logout()

    print("Ảnh chèn trong nội dung thư")
    png = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                        "1f15c4890000000d49444154789c6360f8cf00000301010018dd8db00000000049454e44ae426082")
    st, r, _ = w.call("POST", "/api/drafts", {"to": "binh@congty.test", "subject": "Có ảnh", "body": "x", "html": "x"})
    did = r["id"]

    def upload(web, did, data, inline):
        boundary = "----t"
        body = (("--%s\r\nContent-Disposition: form-data; name=\"inline\"\r\n\r\n%s\r\n" % (boundary, inline)).encode() +
                ("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\n"
                 "Content-Type: image/png\r\n\r\n" % boundary).encode() + data + ("\r\n--%s--\r\n" % boundary).encode())
        req = urllib.request.Request("http://127.0.0.1:%d/api/drafts/%d/attachments" % (PORTS["WEB_PORT"], did), data=body, method="POST")
        req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
        req.add_header("X-Requested-With", "webmail")
        try:
            with web.opener.open(req) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")
    st, r = upload(w, did, b"<svg onload=alert(1)>", "1")
    ok(st == 400, "tệp không phải ảnh bị từ chối khi chèn vào nội dung")
    st, r = upload(wb, did, png, "1")
    ok(st == 404, "người khác không tải được ảnh vào thư nháp của mình")
    st, r = upload(w, did, png, "1")
    ok(st == 200, "tải ảnh chèn vào thư nháp")
    url = r["url"]
    html = 'Xem ảnh: <img src="%s" onerror="x()"><img src="https://t.test/p.gif"><img src="/api/messages/1/attachments/1">' % url
    st, _, _ = w.call("POST", "/api/drafts", {"id": did, "to": "binh@congty.test", "subject": "Có ảnh", "body": "Xem ảnh", "html": html})
    st, r, _ = w.call("GET", "/api/messages/%d" % did)
    ok(r["html"] == 'Xem ảnh: <img src="%s" alt="">' % url, "chỉ giữ ảnh của chính thư nháp, bỏ ảnh ngoài và thuộc tính lạ")
    st, _, _ = w.call("POST", "/api/drafts/%d/send" % did, {})
    st, r, _ = wb.call("GET", "/api/messages?folder=inbox")
    got = next(x for x in r["items"] if x["subject"] == "Có ảnh")
    st, page, _ = wb.call("GET", "/api/messages/%d/html" % got["id"])
    m = re.search(r'<img src="(/api/messages/%d/attachments/\d+)"' % got["id"], page.decode())
    ok(m is not None, "người nhận thấy ảnh nằm trong nội dung thư")
    st, img, _ = wb.call("GET", m.group(1))
    ok(img == png, "ảnh nhận được đúng nguyên bản")
    st, r, _ = wb.call("GET", "/api/messages/%d" % got["id"])
    ok(r["attachments"] == [], "ảnh trong nội dung không bị liệt kê như tệp đính kèm")

    print("Client độc lập")
    try:
        import imapclient
    except ImportError:
        print("  bỏ qua imapclient (chưa cài)")
    else:
        ic = imapclient.IMAPClient("127.0.0.1", PORTS["IMAPS_PORT"], ssl=True, ssl_context=NOVERIFY)
        ic.login("binh@congty.test", "matkhau-binh-1")
        names = [f[2] for f in ic.list_folders()]
        ok({"INBOX", "Sent", "Drafts", "Junk", "Trash"} <= set(names), "imapclient: liệt kê thư mục")
        info = ic.select_folder("INBOX")
        uids = ic.search(["ALL"])
        ok(info[b"EXISTS"] == len(uids) > 5, "imapclient: SELECT và SEARCH khớp nhau")
        data = ic.fetch(uids, ["ENVELOPE", "BODYSTRUCTURE", "FLAGS", "RFC822.SIZE", "INTERNALDATE"])
        ok(len(data) == len(uids) and all(d[b"ENVELOPE"].subject is not None and d[b"BODYSTRUCTURE"] for d in data.values()),
           "imapclient: phân tích được ENVELOPE và BODYSTRUCTURE của mọi thư")
        pic = ic.search(["SUBJECT", "Có ảnh"], charset="UTF-8")
        ok(len(pic) == 1, "imapclient: SEARCH tiếng Việt (UTF-8)")
        part = ic.fetch(pic, ["BODY.PEEK[1]", "BODY.PEEK[2.2]<0.8>"])[pic[0]]
        ok(part.get(b"BODY[2.2]<0>") == __import__("base64").b64encode(png)[:8], "imapclient: tải một đoạn của phần MIME lồng nhau (ảnh trong thư)")
        ic.add_flags(uids[:2], [imapclient.SEEN, b"$Forwarded"])
        ok(all(imapclient.SEEN in f and b"$Forwarded" in f for f in ic.get_flags(uids[:2]).values()), "imapclient: đặt cờ")
        ic.idle()
        smtp_in("idle@doitac.test", ["binh@congty.test"], make("idle@doitac.test", "binh@congty.test", "Thư khi đang IDLE", "x"))
        got_push = ic.idle_check(timeout=12)
        ic.idle_done()
        ok(any(len(x) > 1 and x[1] == b"EXISTS" for x in got_push), "imapclient: IDLE báo thư mới")
        ic.logout()
    import shutil
    if not shutil.which("curl"):
        print("  bỏ qua curl (không có)")
    else:
        def curl(*args, data=None):
            return subprocess.run(["curl", "-sS", "-k", "--max-time", "20", "--user", "binh@congty.test:matkhau-binh-1", *args],
                                  capture_output=True, input=data)
        r = curl("imaps://127.0.0.1:%d/" % PORTS["IMAPS_PORT"])
        ok(r.returncode == 0 and b"INBOX" in r.stdout, "curl IMAPS: liệt kê thư mục")
        r = curl("imaps://127.0.0.1:%d/INBOX;MAILINDEX=1" % PORTS["IMAPS_PORT"])
        ok(r.returncode == 0 and b"Subject:" in r.stdout, "curl IMAPS: tải một thư")
        r = curl("--ssl-reqd", "pop3://127.0.0.1:%d/1" % PORTS["POP3_PORT"])
        ok(r.returncode == 0 and b"Subject:" in r.stdout, "curl POP3 + STLS: tải một thư")
        r = curl("--ssl-reqd", "smtp://127.0.0.1:%d" % PORTS["SUBMISSION_PORT"], "--mail-from", "binh@congty.test",
                 "--mail-rcpt", "an@congty.test", "-T", "-",
                 data=b"From: binh@congty.test\r\nTo: an@congty.test\r\nSubject: Tu curl\r\n\r\nxin chao\r\n")
        ok(r.returncode == 0, "curl SMTP + STARTTLS + đăng nhập: gửi thư")
        st, r, _ = w.call("GET", "/api/messages?folder=inbox")
        ok(any(x["subject"] == "Tu curl" for x in r["items"]), "thư gửi bằng curl tới nơi")

    print("POP3")
    pp = poplib.POP3_SSL("127.0.0.1", PORTS["POP3S_PORT"], context=NOVERIFY)
    pp.user("binh@congty.test")
    pp.pass_("matkhau-binh-1")
    count, size = pp.stat()
    ok(count > 5, "POP3 STAT")
    resp, lines, _ = pp.retr(1)
    ok(any(l.startswith(b"Subject:") for l in lines), "POP3 RETR")
    resp, lines, _ = pp.top(1, 0)
    ok(any(l.startswith(b"Subject:") for l in lines), "POP3 TOP")
    ok(len(pp.uidl()[1]) == count, "POP3 UIDL")
    pp.quit()
    pp = poplib.POP3("127.0.0.1", PORTS["POP3_PORT"])
    pp.stls(NOVERIFY)
    try:
        pp.user("binh@congty.test")
        pp.pass_("sai")
        ok(False, "phải từ chối")
    except poplib.error_proto:
        ok(True, "POP3 từ chối mật khẩu sai")

    print("Cổng gửi thư cho ứng dụng (submission)")
    s = smtplib.SMTP("127.0.0.1", PORTS["SUBMISSION_PORT"])
    s.ehlo()
    try:
        s.sendmail("an@congty.test", ["khach@ngoai.test"], b"Subject: x\r\n\r\nx")
        ok(False, "phải đòi đăng nhập")
    except smtplib.SMTPException:
        ok(True, "không đăng nhập thì không gửi được (không phải open relay)")
    s.close()
    s = smtplib.SMTP("127.0.0.1", PORTS["SUBMISSION_PORT"])
    s.ehlo()
    ok("auth" not in s.esmtp_features, "chưa có TLS thì không cho đăng nhập")
    s.starttls(context=NOVERIFY)
    s.ehlo()
    s.login("an@congty.test", "matkhau-an-1")
    try:
        s.sendmail("binh@congty.test", ["khach@ngoai.test"], make("binh@congty.test", "khach@ngoai.test", "giả", "x").as_bytes())
        ok(False, "phải từ chối giả mạo người gửi")
    except smtplib.SMTPException:
        ok(True, "không gửi được dưới địa chỉ của người khác (MAIL FROM)")
    s.rset()
    try:
        s.sendmail("an@congty.test", ["khach@ngoai.test"], make("Sếp <binh@congty.test>", "khach@ngoai.test", "giả", "x").as_bytes())
        ok(False, "phải từ chối giả mạo From")
    except smtplib.SMTPException:
        ok(True, "không gửi được với tiêu đề From của người khác")
    s.rset()
    before = open(sink_file, "rb").read().count(b"=====END=====")
    s.sendmail("an@congty.test", ["khach@ngoai.test", "binh@congty.test"], make("An <an@congty.test>", "khach@ngoai.test", "Từ ứng dụng thư", "x").as_bytes())
    s.quit()
    for _ in range(50):
        if open(sink_file, "rb").read().count(b"=====END=====") > before:
            break
        time.sleep(0.2)
    ok(open(sink_file, "rb").read().count(b"=====END=====") == before + 1, "thư từ ứng dụng thư được chuyển ra ngoài")

    print("Chống dò mật khẩu & phiên đăng nhập")
    st, _, _ = w.call("POST", "/api/password", {"old": "matkhau-an-1", "new": "matkhau-an-2"})
    ok(st == 200, "đổi mật khẩu")
    w2 = Web()
    w2.call("POST", "/api/login", {"email": "an", "password": "matkhau-an-2"})
    w.call("POST", "/api/password", {"old": "matkhau-an-2", "new": "matkhau-an-3"})
    st, _, _ = w2.call("GET", "/api/folders")
    ok(st == 401, "đổi mật khẩu làm các phiên đăng nhập khác mất hiệu lực")
    codes = [Web().call("POST", "/api/login", {"email": "an", "password": "sai%d" % i})[0] for i in range(10)]
    ok(codes[0] == 401 and codes[-1] == 429, "sai mật khẩu nhiều lần thì bị khóa tạm")
    st, _, _ = Web().call("POST", "/api/login", {"email": "an", "password": "matkhau-an-3"})
    ok(st == 429, "đang bị khóa thì cả mật khẩu đúng cũng phải chờ")


if __name__ == "__main__":
    main()
