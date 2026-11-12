"""Máy chủ IMAP4rev1 và POP3 để dùng hộp thư bằng Outlook, Thunderbird, ứng dụng thư trên điện thoại."""
import asyncio
import base64
import fnmatch
import logging
import re
import threading
import time
from datetime import datetime, timezone
from email import policy
from email.parser import BytesHeaderParser
from email.utils import collapse_rfc2231_value, getaddresses

from . import config, db, mime, security, spam

log = logging.getLogger("webmail")

MAILBOXES = [("INBOX", "inbox", ""), ("Sent", "sent", "\\Sent"), ("Drafts", "drafts", "\\Drafts"),
             ("Junk", "spam", "\\Junk"), ("Trash", "trash", "\\Trash")]
FLAGS = "\\Answered \\Flagged \\Deleted \\Seen \\Draft $Forwarded"
MAX_LINE = 65536
MAX_PER_IP = 20
MAX_CONNS = 400          # tổng số kết nối IMAP/POP3 đồng thời
PREAUTH_LITERAL = 4096   # trước khi đăng nhập chỉ nhận literal nhỏ (tên, mật khẩu)
MAX_FETCH_ITEMS = 40
_conns = {}
_MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


class Bad(Exception):
    pass


class No(Exception):
    pass


# ---------- cấu trúc MIME trên byte gốc ----------

class Part:
    def __init__(self, raw, start, end, depth=0):
        self.raw, self.start, self.end = raw, start, end
        m = re.compile(rb"\r?\n\r?\n").search(raw, start, end)
        if raw[start:start + 2] == b"\r\n":      # phần không có tiêu đề
            self.head_end, self.body_start = start, start + 2
        elif raw[start:start + 1] == b"\n":
            self.head_end, self.body_start = start, start + 1
        elif m:
            first_nl = 2 if raw[m.start():m.start() + 1] == b"\r" else 1
            self.head_end, self.body_start = m.start() + first_nl, m.end()
        else:
            self.head_end = self.body_start = end
        self.hdr = BytesHeaderParser(policy=policy.compat32).parsebytes(raw[start:self.head_end])
        self.children = []
        self.message = None
        try:
            self.maintype, self.subtype = self.hdr.get_content_type().split("/", 1)
        except Exception:
            self.maintype, self.subtype = "text", "plain"
        if depth > 12:
            return
        if self.maintype == "multipart":
            try:
                boundary = self.hdr.get_boundary()
            except Exception:
                boundary = None
            if boundary:
                self._split(boundary.encode("utf-8", "surrogateescape"), depth)
            if not self.children:
                self.maintype, self.subtype = "text", "plain"
        elif self.maintype == "message" and self.subtype == "rfc822":
            self.message = Part(raw, self.body_start, end, depth + 1)

    def _split(self, boundary, depth):
        pat = re.compile(rb"(?:^|\r?\n)--" + re.escape(boundary) + rb"(--)?[ \t]*(?=\r?\n|$)")
        # Lùi 2 byte để dòng phân cách đầu tiên (ngay sau dòng trống) cũng có ký tự xuống dòng đứng trước.
        pos, prev = max(self.start, self.body_start - 2), None
        while True:
            m = pat.search(self.raw, pos, self.end)
            if not m:
                break
            if prev is not None:
                self.children.append(Part(self.raw, prev, m.start(), depth + 1))
            if m.group(1) or len(self.children) > 500:
                prev = None
                break
            nl = re.compile(rb"\r?\n").match(self.raw, m.end(), self.end)
            prev = nl.end() if nl else m.end()
            pos = prev
        if prev is not None:
            self.children.append(Part(self.raw, prev, self.end, depth + 1))

    @property
    def header(self):
        return self.raw[self.start:self.head_end] + b"\r\n"

    @property
    def body(self):
        return self.raw[self.body_start:self.end]

    def header_fields(self, names, invert=False):
        names = {n.lower() for n in names}
        out, keep = [], False
        for line in self.raw[self.start:self.head_end].splitlines(keepends=True):
            if line[:1] in b" \t":
                if keep:
                    out.append(line)
                continue
            name = line.split(b":", 1)[0].strip().decode("latin-1").lower()
            keep = (name in names) != invert and b":" in line
            if keep:
                out.append(line)
        return b"".join(out) + b"\r\n"

    def section(self, spec):
        """Phần dữ liệu cho BODY[spec]; None nếu không có."""
        part, spec = self, spec.strip()
        m = re.match(r"^(\d+(?:\.\d+)*)(?:\.(.+))?$", spec)
        if m:
            for n in (int(x) for x in m.group(1).split(".")):
                node = part.message if (part.message is not None and part is not self) else part
                if node.children:
                    if not 1 <= n <= len(node.children):
                        return None
                    part = node.children[n - 1]
                elif n == 1:
                    part = node
                else:
                    return None
            rest = (m.group(2) or "").strip()
            if not rest:
                return part.body
            if rest.upper() == "MIME":
                return part.header
            if part.message is None:
                return None
            part, spec = part.message, rest
        up = spec.upper()
        if up == "":
            return part.raw[part.start:part.end]
        if up == "HEADER":
            return part.header
        if up == "TEXT":
            return part.body
        m = re.match(r"(?is)^HEADER\.FIELDS(\.NOT)?\s*\((.*)\)$", spec)
        if m:
            return part.header_fields(m.group(2).split(), bool(m.group(1)))
        return None


def q(value):
    """Chuỗi IMAP: NIL, "quoted" hoặc {n} literal."""
    if value is None:
        return b"NIL"
    if isinstance(value, str):
        value = value.encode("utf-8", "surrogateescape")
    if len(value) < 500 and not re.search(rb'[\r\n"\\\x00-\x1f\x7f-\xff]', value):
        return b'"' + value + b'"'
    return b"{%d}\r\n" % len(value) + value


def _unfold(v):
    return None if v is None else re.sub(r"\r?\n[ \t]+", " ", str(v)).strip()


def _addr_list(hdr, name):
    values = [_unfold(v) for v in hdr.get_all(name) or []]
    pairs = [(n, a) for n, a in getaddresses(values) if a]
    if not pairs:
        return b"NIL"
    out = []
    for n, a in pairs[:200]:
        local, _, host = a.rpartition("@")
        out.append(b"(" + b" ".join([q(n or None), b"NIL", q(local or host), q(host if local else None)]) + b")")
    return b"(" + b"".join(out) + b")"


def envelope(hdr):
    frm = _addr_list(hdr, "From")
    sender = _addr_list(hdr, "Sender")
    reply = _addr_list(hdr, "Reply-To")
    return b"(" + b" ".join([
        q(_unfold(hdr.get("Date"))), q(_unfold(hdr.get("Subject"))), frm,
        frm if sender == b"NIL" else sender, frm if reply == b"NIL" else reply,
        _addr_list(hdr, "To"), _addr_list(hdr, "Cc"), _addr_list(hdr, "Bcc"),
        q(_unfold(hdr.get("In-Reply-To"))), q(_unfold(hdr.get("Message-ID")))]) + b")"


def _params(pairs):
    out = []
    for k, v in pairs or []:
        try:
            v = collapse_rfc2231_value(v)
        except Exception:
            v = str(v)
        out += [q(str(k).upper()), q(v)]
    return b"(" + b" ".join(out) + b")" if out else b"NIL"


def bodystructure(part, ext=True):
    if part.children:
        s = b"(" + b"".join(bodystructure(c, ext) for c in part.children) + b" " + q(part.subtype.upper())
        if ext:
            try:
                params = part.hdr.get_params(failobj=[])[1:]
            except Exception:
                params = []
            s += b" " + _params(params) + b" NIL NIL NIL"
        return s + b")"
    hdr = part.hdr
    try:
        params = hdr.get_params(failobj=[])[1:]
    except Exception:
        params = []
    body = part.body
    lines = body.count(b"\n")
    fields = [q(part.maintype.upper()), q(part.subtype.upper()), _params(params),
              q(_unfold(hdr.get("Content-ID"))), q(_unfold(hdr.get("Content-Description"))),
              q((_unfold(hdr.get("Content-Transfer-Encoding")) or "7BIT").upper()), b"%d" % len(body)]
    if part.maintype == "text":
        fields.append(b"%d" % lines)
    elif part.message is not None:
        fields += [envelope(part.message.hdr), bodystructure(part.message, ext), b"%d" % lines]
    if ext:
        disp = b"NIL"
        try:
            dparams = hdr.get_params(header="content-disposition", failobj=[])
            if dparams:
                disp = b"(" + q(str(dparams[0][0]).upper()) + b" " + _params(dparams[1:]) + b")"
        except Exception:
            pass
        fields += [b"NIL", disp, b"NIL", b"NIL"]
    return b"(" + b" ".join(fields) + b")"


# ---------- tiện ích chung ----------

def _flags(row):
    f = []
    if row["is_read"]:
        f.append("\\Seen")
    if row["starred"]:
        f.append("\\Flagged")
    if row["folder"] == "drafts":
        f.append("\\Draft")
    f += [x for x in (row["imap_flags"] or "").split() if x not in f]
    return " ".join(f)


def _internaldate(ts):
    d = datetime.fromtimestamp(ts, timezone.utc)
    return '"%02d-%s-%04d %02d:%02d:%02d +0000"' % (d.day, _MONTHS[d.month - 1], d.year, d.hour, d.minute, d.second)


def mutf7_encode(name):
    """Tên thư mục -> UTF-7 sửa đổi của IMAP (RFC 3501 mục 5.1.3), để tên có dấu hiển thị đúng."""
    out, buf = [], ""

    def flush():
        nonlocal buf
        if buf:
            b64 = base64.b64encode(buf.encode("utf-16-be")).decode().rstrip("=").replace("/", ",")
            out.append("&" + b64 + "-")
            buf = ""
    for ch in name:
        if 0x20 <= ord(ch) <= 0x7e:
            flush()
            out.append("&-" if ch == "&" else ch)
        else:
            buf += ch
    flush()
    return "".join(out)


def mutf7_decode(name):
    def one(m):
        b64 = m.group(1)
        if not b64:
            return "&"
        b64 = b64.replace(",", "/")
        return base64.b64decode(b64 + "=" * (-len(b64) % 4)).decode("utf-16-be")
    try:
        return re.sub(r"&([A-Za-z0-9+,]*)-", one, name)
    except Exception:
        raise No("Invalid mailbox name")


def _text(tok):
    return tok.decode("utf-8", "replace") if isinstance(tok, bytes) else tok


def _train_for_move(c, user_id, ids, src, dst):
    if dst == "spam" or src == "spam":
        for mid in ids:
            row = c.execute("SELECT * FROM messages WHERE id=? AND user_id=?", (mid, user_id)).fetchone()
            if row:
                spam.set_trained(c, row, 1 if dst == "spam" else 2)


class Conn:
    """Phần chung của một kết nối: đọc/ghi, TLS, giới hạn số kết nối."""

    def __init__(self, reader, writer, tls):
        self.r, self.w, self.tls = reader, writer, tls
        peer = writer.get_extra_info("peername")
        self.ip = peer[0] if peer else "?"
        self.user = None

    def send(self, data):
        self.w.write(data if isinstance(data, bytes) else data.encode("utf-8", "surrogateescape"))

    async def readline(self, timeout):
        line = await asyncio.wait_for(self.r.readline(), timeout)
        if not line:
            raise ConnectionError("closed")
        if len(line) > MAX_LINE:
            raise ConnectionError("line too long")
        return line

    async def starttls(self):
        await self.w.drain()
        await self.w.start_tls(security.server_tls_context())
        self.tls = True

    async def login(self, name, password):
        if not security.plaintext_login_allowed(self.ip, self.tls):
            return None, "tls"
        loop = asyncio.get_running_loop()
        user, err = await loop.run_in_executor(None, security.authenticate, name, password, self.ip, "mail")
        if user:
            self.pw_hash = user["pw_hash"]
        return user, err

    def still_valid(self):
        """False nếu tài khoản đã bị xóa hoặc đổi mật khẩu sau khi phiên này đăng nhập."""
        row = db.get_user(self.user["id"])
        return bool(row) and row["pw_hash"] == self.pw_hash


async def _serve(cls, tls, reader, writer):
    peer = writer.get_extra_info("peername")
    ip = peer[0] if peer else "?"
    if _conns.get(ip, 0) >= MAX_PER_IP or sum(_conns.values()) >= MAX_CONNS:
        writer.close()
        return
    _conns[ip] = _conns.get(ip, 0) + 1
    try:
        await cls(reader, writer, tls).run()
    except (ConnectionError, asyncio.TimeoutError, asyncio.IncompleteReadError, OSError, ValueError):
        pass
    except Exception:
        log.exception("Lỗi kết nối %s", cls.__name__)
    finally:
        _conns[ip] -= 1
        if not _conns[ip]:
            del _conns[ip]
        try:
            writer.close()
        except Exception:
            pass


# ---------- IMAP ----------

def tokenize(chunks):
    """chunks: [bytes dòng lệnh, bytes literal, bytes dòng tiếp…] -> danh sách token lồng nhau."""
    root = []
    stack = [root]
    for i, chunk in enumerate(chunks):
        if i % 2:
            stack[-1].append(chunk)  # literal giữ nguyên dạng bytes
            continue
        s = chunk.decode("utf-8", "surrogateescape")
        pos, n = 0, len(s)
        while pos < n:
            ch = s[pos]
            if ch in " \r\n":
                pos += 1
            elif ch == "(":
                new = []
                stack[-1].append(new)
                stack.append(new)
                pos += 1
            elif ch == ")":
                if len(stack) < 2:
                    raise Bad("Unbalanced parenthesis")
                stack.pop()
                pos += 1
            elif ch == '"':
                pos += 1
                buf = []
                while pos < n and s[pos] != '"':
                    if s[pos] == "\\" and pos + 1 < n:
                        pos += 1
                    buf.append(s[pos])
                    pos += 1
                if pos >= n:
                    raise Bad("Unterminated string")
                pos += 1
                stack[-1].append("".join(buf))
            else:
                start = pos
                while pos < n and s[pos] not in " ()\r\n":
                    if s[pos] == "[":
                        end = s.find("]", pos)
                        if end < 0:
                            raise Bad("Unterminated section")
                        pos = end
                    pos += 1
                stack[-1].append(s[start:pos])
    if len(stack) != 1:
        raise Bad("Unbalanced parenthesis")
    return root


class Imap(Conn):
    def __init__(self, *a):
        super().__init__(*a)
        self.folder = None
        self.readonly = False
        self.uids = []   # ảnh chụp thư mục đang mở: vị trí i -> UID
        self.ids = {}    # UID -> id thư

    def boxes(self):
        """Mọi thư mục của người dùng: [(tên IMAP đã mã hóa, khóa thư mục, thuộc tính đặc biệt)]."""
        custom = [(mutf7_encode(f["name"]), db.folder_key(f["id"]), "") for f in db.list_folders(self.user["id"])]
        return MAILBOXES + custom

    def mbox(self, name):
        """Tên thư mục do máy khách gửi -> khóa thư mục; báo NO nếu không có."""
        name = _text(name)
        if name.upper() == "INBOX":
            return "inbox"
        for imap_name, key, _ in self.boxes():
            if name == imap_name or mutf7_decode(name) == mutf7_decode(imap_name):
                return key
        raise No("[TRYCREATE] Mailbox does not exist")

    def box_name(self, key):
        return next(n for n, k, _ in self.boxes() if k == key)

    def caps(self):
        c = "IMAP4rev1 LITERAL+ IDLE NAMESPACE UIDPLUS MOVE SPECIAL-USE UNSELECT ID CHILDREN SASL-IR"
        if self.user is None:
            if not self.tls:
                c += " STARTTLS"
            c += " AUTH=PLAIN" if security.plaintext_login_allowed(self.ip, self.tls) else " LOGINDISABLED"
        return c

    async def run(self):
        self.send("* OK [CAPABILITY %s] IMAP4rev1 ready\r\n" % self.caps())
        while True:
            await self.w.drain()
            chunks = await self.read_command()
            if chunks is None:
                continue
            if self.user is not None and not self.still_valid():
                self.send("* BYE Password changed, please log in again\r\n")
                await self.w.drain()
                return
            first = chunks[0].split(None, 2)
            if len(first) < 2:
                self.send("* BAD Invalid command\r\n")
                continue
            tag = first[0].decode("ascii", "replace")
            if not re.match(r"^[^\s(){%*\"\\+]{1,64}$", tag):
                self.send("* BAD Invalid tag\r\n")
                continue
            cmd = first[1].decode("ascii", "replace").upper()
            chunks[0] = first[2] if len(first) > 2 else b""
            try:
                args = tokenize(chunks)
                uid = False
                if cmd == "UID":
                    if not args or not isinstance(args[0], str):
                        raise Bad("Missing UID command")
                    cmd, args, uid = args[0].upper(), args[1:], True
                    if cmd not in ("FETCH", "STORE", "SEARCH", "COPY", "MOVE", "EXPUNGE"):
                        raise Bad("Unknown UID command")
                handler = getattr(self, "do_" + cmd, None)
                if handler is None:
                    raise Bad("Unknown command")
                if cmd not in ("CAPABILITY", "NOOP", "LOGOUT", "ID", "STARTTLS", "LOGIN", "AUTHENTICATE"):
                    if self.user is None:
                        raise No("Please log in first")
                    if cmd in SELECTED_ONLY and self.folder is None:
                        raise No("No mailbox selected")
                done = await (handler(tag, args, uid) if cmd in UID_CMDS else handler(tag, args))
                if done == "logout":
                    await self.w.drain()
                    return
                if done != "sent":
                    self.send("%s OK %s%s completed\r\n" % (tag, (done + " ") if done else "", cmd))
            except Bad as e:
                self.send("%s BAD %s\r\n" % (tag, e))
            except No as e:
                self.send("%s NO %s\r\n" % (tag, e))
            except (IndexError, TypeError, AttributeError, KeyError, ValueError):
                self.send("%s BAD Invalid arguments\r\n" % tag)

    async def read_command(self):
        chunks, total = [], 0
        line = await self.readline(1800 if self.user else 120)
        while True:
            m = re.search(rb"\{(\d{1,10})(\+?)\}\r?\n$", line)
            if not m:
                chunks.append(line)
                return chunks
            size = int(m.group(1))
            total += size
            # Chưa đăng nhập thì không nhận literal lớn: tránh bị nhồi đầy bộ nhớ bởi người lạ.
            if total > (config.MAX_SIZE + 65536 if self.user else PREAUTH_LITERAL) or len(chunks) > 64:
                tag = line.split(None, 1)[0].decode("ascii", "replace") if not chunks else "*"
                self.send("%s BAD Literal too large\r\n" % tag)
                await self.w.drain()
                raise ConnectionError("literal too large")
            if not m.group(2):
                self.send("+ Ready\r\n")
                await self.w.drain()
            chunks.append(line[:m.start()])
            chunks.append(await asyncio.wait_for(self.r.readexactly(size), 300))
            line = await self.readline(300)

    # --- trạng thái bất kỳ ---

    async def do_CAPABILITY(self, tag, args):
        self.send("* CAPABILITY %s\r\n" % self.caps())

    async def do_ID(self, tag, args):
        self.send('* ID ("name" "webmail")\r\n')

    async def do_NOOP(self, tag, args):
        if self.folder:
            self.sync()

    do_CHECK = do_NOOP

    async def do_LOGOUT(self, tag, args):
        self.send("* BYE Logging out\r\n%s OK LOGOUT completed\r\n" % tag)
        return "logout"

    async def do_STARTTLS(self, tag, args):
        if self.tls or self.user is not None:
            raise Bad("STARTTLS not available")
        self.send("%s OK Begin TLS negotiation\r\n" % tag)
        await self.starttls()
        return "sent"

    async def _finish_login(self, tag, name, password):
        if self.user is not None:
            raise Bad("Already logged in")
        user, err = await self.login(_text(name), _text(password))
        if err == "tls":
            raise No("[PRIVACYREQUIRED] Use TLS (STARTTLS or the IMAPS port) before logging in")
        if err == "locked":
            raise No("[AUTHENTICATIONFAILED] Too many failed attempts, try again later")
        if not user:
            await asyncio.sleep(1)
            raise No("[AUTHENTICATIONFAILED] Invalid credentials")
        self.user = {"id": user["id"], "email": user["email"]}
        self.send("%s OK [CAPABILITY %s] Logged in\r\n" % (tag, self.caps()))
        return "sent"

    async def do_LOGIN(self, tag, args):
        if len(args) != 2:
            raise Bad("LOGIN needs a user name and a password")
        return await self._finish_login(tag, args[0], args[1])

    async def do_AUTHENTICATE(self, tag, args):
        if not args or _text(args[0]).upper() != "PLAIN":
            raise No("Unsupported authentication mechanism")
        if len(args) > 1:
            data = _text(args[1])
        else:
            self.send("+ \r\n")
            await self.w.drain()
            data = (await self.readline(120)).strip().decode("ascii", "replace")
        if data == "*":
            raise Bad("Authentication cancelled")
        try:
            parts = base64.b64decode("" if data == "=" else data, validate=True).split(b"\0")
            name, password = parts[1].decode("utf-8"), parts[2].decode("utf-8")
        except Exception:
            raise Bad("Invalid SASL data")
        return await self._finish_login(tag, name, password)

    # --- đã đăng nhập ---

    async def do_NAMESPACE(self, tag, args):
        self.send('* NAMESPACE (("" "/")) NIL NIL\r\n')

    async def do_ENABLE(self, tag, args):
        self.send("* ENABLED\r\n")

    def _custom(self, name):
        key = self.mbox(name)
        row = db.custom_folder(self.user["id"], key)
        if not row:
            raise No("This mailbox cannot be changed")
        return key, row

    async def do_CREATE(self, tag, args):
        name = mutf7_decode(_text(args[0])).rstrip("/")
        try:
            db.create_folder(self.user["id"], name)
        except ValueError:
            raise No("Cannot create mailbox with that name")

    async def do_DELETE(self, tag, args):
        key, row = self._custom(args[0])
        if self.folder == key:
            self.folder = None
        db.delete_folder(self.user["id"], row["id"])

    async def do_RENAME(self, tag, args):
        key, row = self._custom(args[0])
        try:
            db.rename_folder(self.user["id"], row["id"], mutf7_decode(_text(args[1])).rstrip("/"))
        except ValueError:
            raise No("Cannot rename mailbox to that name")

    async def _ok(self, tag, args):
        return None

    do_SUBSCRIBE = do_UNSUBSCRIBE = _ok

    async def _list(self, kind, args):
        args = [a for a in args if not isinstance(a, list)]  # bỏ các tùy chọn (SPECIAL-USE) / RETURN (...)
        args = [a for a in args if _text(a).upper() != "RETURN"]
        if len(args) < 2:
            raise Bad("LIST needs a reference and a pattern")
        pattern = _text(args[0]) + _text(args[1])
        if _text(args[1]) == "":
            self.send('* %s (\\Noselect) "/" ""\r\n' % kind)
            return
        glob = re.sub(r"[%*]+", "*", pattern.replace("[", "[[]"))
        for name, _, special in self.boxes():
            if fnmatch.fnmatchcase(name, glob) or (name == "INBOX" and fnmatch.fnmatchcase(name, glob.upper())):
                attrs = "\\HasNoChildren" + (" " + special if special and kind == "LIST" else "")
                self.send(b"* " + kind.encode() + b" (" + attrs.encode() + b') "/" ' + q(name) + b"\r\n")

    async def do_LIST(self, tag, args):
        await self._list("LIST", args)

    async def do_LSUB(self, tag, args):
        await self._list("LSUB", args)

    def _counts(self, folder):
        r = db.conn().execute(
            "SELECT COUNT(*) n, COALESCE(SUM(is_read=0),0) unseen FROM messages "
            "WHERE user_id=? AND folder=? AND raw IS NOT NULL", (self.user["id"], folder)).fetchone()
        return r["n"], r["unseen"]

    async def do_STATUS(self, tag, args):
        folder = self.mbox(args[0])
        n, unseen = self._counts(folder)
        vals = {"MESSAGES": n, "RECENT": 0, "UNSEEN": unseen, "UIDNEXT": db.peek_next_uid(), "UIDVALIDITY": 1}
        items = [_text(i).upper() for i in args[1]]
        out = " ".join("%s %d" % (i, vals[i]) for i in items if i in vals)
        self.send(b"* STATUS " + q(self.box_name(folder)) + b" (" + out.encode() + b")\r\n")

    def _load(self):
        rows = db.conn().execute(
            "SELECT id, uid FROM messages WHERE user_id=? AND folder=? AND raw IS NOT NULL ORDER BY uid",
            (self.user["id"], self.folder)).fetchall()
        return [r["uid"] for r in rows], {r["uid"]: r["id"] for r in rows}

    def sync(self):
        """Báo cho máy khách thư bị xóa/thư mới do phiên khác (hoặc webmail) tạo ra."""
        uids, ids = self._load()
        current = set(uids)
        for i in range(len(self.uids) - 1, -1, -1):
            if self.uids[i] not in current:
                self.send("* %d EXPUNGE\r\n" % (i + 1))
                del self.uids[i]
        if uids != self.uids:
            self.send("* %d EXISTS\r\n" % len(uids))
        self.uids, self.ids = uids, ids

    async def _select(self, tag, args, readonly):
        self.folder = None
        folder = self.mbox(args[0])
        self.folder, self.readonly = folder, readonly
        self.uids, self.ids = self._load()
        self.send("* FLAGS (%s)\r\n" % FLAGS)
        self.send("* OK [PERMANENTFLAGS (%s)] Flags\r\n" % ("" if readonly else FLAGS + " \\*"))
        self.send("* %d EXISTS\r\n* 0 RECENT\r\n" % len(self.uids))
        r = db.conn().execute(
            "SELECT MIN(uid) FROM messages WHERE user_id=? AND folder=? AND is_read=0 AND raw IS NOT NULL",
            (self.user["id"], folder)).fetchone()[0]
        if r in self.ids:
            self.send("* OK [UNSEEN %d] First unseen\r\n" % (self.uids.index(r) + 1))
        self.send("* OK [UIDVALIDITY 1] UIDs valid\r\n* OK [UIDNEXT %d] Predicted next UID\r\n" % db.peek_next_uid())
        return "[READ-ONLY]" if readonly else "[READ-WRITE]"

    async def do_SELECT(self, tag, args):
        return await self._select(tag, args, False)

    async def do_EXAMINE(self, tag, args):
        return await self._select(tag, args, True)

    async def do_UNSELECT(self, tag, args):
        self.folder = None

    async def do_CLOSE(self, tag, args):
        if not self.readonly:
            self._expunge(None, silent=True)
        self.folder = None

    async def do_APPEND(self, tag, args):
        folder = self.mbox(args[0])
        raw = args[-1]
        if not isinstance(raw, bytes):
            raise Bad("APPEND needs a message literal")
        if len(raw) > config.MAX_SIZE:
            raise No("[TOOBIG] Message too large")
        if db.over_quota(self.user["id"], len(raw)):
            raise No("[OVERQUOTA] Mailbox is full")
        flags, date = [], None
        for a in args[1:-1]:
            if isinstance(a, list):
                flags = [_text(f) for f in a]
            else:
                try:
                    date = datetime.strptime(_text(a).strip(), "%d-%b-%Y %H:%M:%S %z").timestamp()
                except ValueError:
                    raise Bad("Invalid date")
        low = {f.lower() for f in flags}
        extra = " ".join(f for f in flags if f.lower() in ("\\answered", "$forwarded"))
        def store():   # phân tích và lưu ở luồng phụ để không chặn các kết nối khác
            return db.insert_message(self.user["id"], folder, mime.parse(raw), raw=raw, is_read=int("\\seen" in low),
                                     date=date, starred=int("\\flagged" in low), imap_flags=extra)
        mid = await asyncio.get_running_loop().run_in_executor(None, store)
        uid = db.conn().execute("SELECT uid FROM messages WHERE id=?", (mid,)).fetchone()[0]
        if self.folder:
            self.sync()
        return "[APPENDUID 1 %d]" % uid

    async def do_IDLE(self, tag, args):
        self.send("+ idling\r\n")
        deadline = time.time() + 1740
        while time.time() < deadline:
            await self.w.drain()
            try:
                line = await asyncio.wait_for(self.r.readline(), 5)
            except asyncio.TimeoutError:
                if self.folder:
                    self.sync()
                continue
            if not line:
                raise ConnectionError("closed")
            if line.strip().upper() == b"DONE":
                return None
            raise Bad("Expected DONE")
        self.send("* BYE Idle timeout\r\n")
        return "logout"

    # --- thư mục đang mở ---

    def _set(self, spec, uid):
        """Tập thứ tự/UID -> danh sách vị trí (0-based) trong ảnh chụp, theo thứ tự tăng."""
        spec = _text(spec)
        if not re.match(r"^[\d:*,]+$", spec):
            raise Bad("Invalid message set")
        n = len(self.uids)
        top = (self.uids[-1] if n else 0) if uid else n
        picked = set()
        for piece in spec.split(","):
            a, _, b = piece.partition(":")
            try:
                lo = top if a == "*" else int(a)
                hi = lo if not b else (top if b == "*" else int(b))
            except ValueError:
                raise Bad("Invalid message set")
            if lo > hi:
                lo, hi = hi, lo
            if not uid and n == 0 and "*" in piece:
                continue
            if uid:
                picked.update(i for i, u in enumerate(self.uids) if lo <= u <= hi)
            else:
                if lo < 1 or (hi > n and not ("*" in piece)):
                    raise Bad("Message sequence number out of range")
                picked.update(range(lo - 1, min(hi, n)))
        return sorted(picked)

    def _rows(self, idx, cols="*"):
        c = db.conn()
        for i in idx:
            row = c.execute("SELECT %s FROM messages WHERE id=? AND user_id=? AND folder=?" % cols,
                            (self.ids[self.uids[i]], self.user["id"], self.folder)).fetchone()
            if row:
                yield i, row

    async def do_FETCH(self, tag, args, uid):
        idx = self._set(args[0], uid)
        items = args[1] if isinstance(args[1], list) else [args[1]]
        items = list(dict.fromkeys(_text(i) for i in items))   # bỏ mục lặp: mỗi mục chỉ trả một lần
        if len(items) > MAX_FETCH_ITEMS:
            raise Bad("Too many FETCH items")
        macro = {"ALL": ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE"],
                 "FAST": ["FLAGS", "INTERNALDATE", "RFC822.SIZE"],
                 "FULL": ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE", "BODY"]}
        if len(items) == 1 and items[0].upper() in macro:
            items = macro[items[0].upper()]
        if uid and not any(i.upper() == "UID" for i in items):
            items.insert(0, "UID")
        light = all(i.upper() in ("FLAGS", "UID", "INTERNALDATE", "RFC822.SIZE") for i in items)
        cols = "id,uid,folder,is_read,starred,imap_flags,date,size" if light else "*"
        count = 0
        for i, row in self._rows(idx, cols):
            raw = None if light else bytes(row["raw"] or b"")
            part = None
            out, seen = [], False
            for item in items:
                up = item.upper()
                if up == "UID":
                    out.append(b"UID %d" % row["uid"])
                elif up == "FLAGS":
                    out.append(None)  # điền sau, vì BODY[] có thể bật \Seen
                elif up == "INTERNALDATE":
                    out.append(b"INTERNALDATE " + _internaldate(row["date"]).encode())
                elif up == "RFC822.SIZE":
                    out.append(b"RFC822.SIZE %d" % row["size"])
                else:
                    part = part or Part(raw, 0, len(raw))
                    if up == "ENVELOPE":
                        out.append(b"ENVELOPE " + envelope(part.hdr))
                    elif up == "BODYSTRUCTURE":
                        out.append(b"BODYSTRUCTURE " + bodystructure(part, True))
                    elif up == "BODY":
                        out.append(b"BODY " + bodystructure(part, False))
                    elif up in ("RFC822", "RFC822.TEXT", "RFC822.HEADER"):
                        data = {"RFC822": raw, "RFC822.TEXT": part.body, "RFC822.HEADER": part.header}[up]
                        out.append(up.encode() + b" {%d}\r\n" % len(data) + data)
                        seen = seen or up != "RFC822.HEADER"
                    else:
                        m = re.match(r"(?is)^BODY(\.PEEK)?\[(.*)\](?:<(\d+)(?:\.(\d+))?>)?$", item)
                        if not m:
                            raise Bad("Unknown FETCH item " + item[:40])
                        data = part.section(m.group(2))
                        label = b"BODY[" + m.group(2).encode("utf-8", "surrogateescape") + b"]"
                        if data is None:
                            out.append(label + b" NIL")
                            continue
                        if m.group(3) is not None:
                            start = int(m.group(3))
                            data = data[start:start + int(m.group(4))] if m.group(4) else data[start:]
                            label += b"<%d>" % start
                        out.append(label + b" {%d}\r\n" % len(data) + data)
                        seen = seen or not m.group(1)
            flags_row = row
            if seen and not row["is_read"] and not self.readonly:
                with db.conn() as c:
                    c.execute("UPDATE messages SET is_read=1 WHERE id=?", (row["id"],))
                    spam.learn_ham_on_read(c, row)
                flags_row = dict(row, is_read=1)
                if None not in out:
                    out.append(None)
            out = [b"FLAGS (" + _flags(flags_row).encode() + b")" if o is None else o for o in out]
            self.send(b"* %d FETCH (" % (i + 1) + b" ".join(out) + b")\r\n")
            count += 1
            if not light or count % 50 == 0:
                await self.w.drain()   # chờ máy khách nhận xong rồi mới nạp thư kế tiếp, không dồn vào bộ nhớ

    async def do_STORE(self, tag, args, uid):
        if self.readonly:
            raise No("Mailbox is read-only")
        idx = self._set(args[0], uid)
        m = re.match(r"(?i)^([+-]?)FLAGS(\.SILENT)?$", _text(args[1]))
        if not m:
            raise Bad("Invalid STORE item")
        flags = args[2] if isinstance(args[2], list) else args[2:]
        flags = [_text(f) for f in flags]
        if any(not re.match(r"^\\?[A-Za-z0-9$_.\-]{1,40}$", f) for f in flags) or len(flags) > 20:
            raise Bad("Invalid flag")
        low = {f.lower() for f in flags}
        mode = m.group(1)
        with db.conn() as c:
            for i, row in list(self._rows(idx, "id,uid,folder,is_read,starred,imap_flags")):
                other = [f for f in (row["imap_flags"] or "").split()]
                new_other = [f for f in flags if f.lower() not in ("\\seen", "\\flagged", "\\draft", "\\recent")]
                if mode == "+":
                    other += [f for f in new_other if f.lower() not in {o.lower() for o in other}]
                    read, star = row["is_read"] or "\\seen" in low, row["starred"] or "\\flagged" in low
                elif mode == "-":
                    other = [o for o in other if o.lower() not in low]
                    read = row["is_read"] and "\\seen" not in low
                    star = row["starred"] and "\\flagged" not in low
                else:
                    other, read, star = new_other, "\\seen" in low, "\\flagged" in low
                other = " ".join(other[:20])
                c.execute("UPDATE messages SET is_read=?, starred=?, imap_flags=? WHERE id=?",
                          (int(bool(read)), int(bool(star)), other, row["id"]))
                if not m.group(2):
                    shown = dict(row, is_read=read, starred=star, imap_flags=other)
                    self.send("* %d FETCH (%sFLAGS (%s))\r\n" % (
                        i + 1, "UID %d " % row["uid"] if uid else "", _flags(shown)))

    def _expunge(self, only_uids, silent=False):
        c = db.conn()
        gone = []
        for i, u in enumerate(self.uids):
            if only_uids is not None and u not in only_uids:
                continue
            r = c.execute("SELECT imap_flags FROM messages WHERE id=? AND user_id=? AND folder=?",
                          (self.ids[u], self.user["id"], self.folder)).fetchone()
            if r and "\\deleted" in (r["imap_flags"] or "").lower().split():
                gone.append(i)
        with c:
            for i in gone:
                c.execute("DELETE FROM messages WHERE id=? AND user_id=?", (self.ids[self.uids[i]], self.user["id"]))
        for i in reversed(gone):
            if not silent:
                self.send("* %d EXPUNGE\r\n" % (i + 1))
            self.ids.pop(self.uids[i], None)
            del self.uids[i]

    async def do_EXPUNGE(self, tag, args, uid):
        if self.readonly:
            raise No("Mailbox is read-only")
        only = None
        if uid:
            only = {self.uids[i] for i in self._set(args[0], True)}
        self._expunge(only)
        self.sync()

    async def do_COPY(self, tag, args, uid):
        idx = self._set(args[0], uid)
        dst = self.mbox(args[1])
        src_uids, dst_uids = [], []
        with db.conn() as c:
            for i, row in list(self._rows(idx, "id,uid")):
                new_uid = db.next_uid(c)
                cols = ("user_id,msgid,in_reply_to,refs,from_addr,from_name,reply_to,to_addrs,cc_addrs,bcc_addrs,"
                        "subject,date,snippet,body_text,body_html,raw,size,is_read,starred,has_attach")
                cur = c.execute("INSERT INTO messages(%s,folder,uid,moved) SELECT %s,?,?,? FROM messages WHERE id=?"
                                % (cols, cols), (dst, new_uid, time.time(), row["id"]))
                c.execute("INSERT INTO attachments(message_id,filename,ctype,size,cid,inline,data) "
                          "SELECT ?,filename,ctype,size,cid,inline,data FROM attachments WHERE message_id=?",
                          (cur.lastrowid, row["id"]))
                src_uids.append(row["uid"])
                dst_uids.append(new_uid)
        if not src_uids:
            return None
        return "[COPYUID 1 %s %s]" % (",".join(map(str, src_uids)), ",".join(map(str, dst_uids)))

    async def do_MOVE(self, tag, args, uid):
        if self.readonly:
            raise No("Mailbox is read-only")
        idx = self._set(args[0], uid)
        dst = self.mbox(args[1])
        if dst == self.folder:
            raise No("Source and destination are the same mailbox")
        rows = list(self._rows(idx, "id,uid"))
        with db.conn() as c:
            moved = db.move_messages(c, self.user["id"], [r["id"] for _, r in rows], dst)
            _train_for_move(c, self.user["id"], list(moved), self.folder, dst)
        pairs = [(r["uid"], moved[r["id"]]) for _, r in rows if r["id"] in moved]
        if pairs:
            self.send("* OK [COPYUID 1 %s %s] Moved\r\n" % (",".join(str(a) for a, _ in pairs),
                                                           ",".join(str(b) for _, b in pairs)))
        self.sync()

    async def do_SEARCH(self, tag, args, uid):
        if args and _text(args[0]).upper() == "CHARSET":
            if _text(args[1]).upper() not in ("UTF-8", "US-ASCII"):
                raise No("[BADCHARSET (UTF-8)] Unsupported charset")
            args = args[2:]
        test = self._criteria(list(args) or ["ALL"])
        cols = ("id,uid,folder,is_read,starred,imap_flags,date,size,subject,from_addr,from_name,to_addrs,cc_addrs,"
                "bcc_addrs,body_text,msgid")
        hits = []
        for i, row in self._rows(range(len(self.uids)), cols):
            if test(i, row):
                hits.append(row["uid"] if uid else i + 1)
        self.send("* SEARCH%s\r\n" % "".join(" %d" % h for h in hits))

    def _criteria(self, toks):
        """Biên dịch điều kiện SEARCH thành hàm (vị trí, dòng) -> bool; các điều kiện nối với nhau bằng AND."""
        tests = []
        while toks:
            tests.append(self._criterion(toks))
        return lambda i, r: all(t(i, r) for t in tests)

    def _criterion(self, toks):
        tok = toks.pop(0)
        if isinstance(tok, list):
            return self._criteria(list(tok))
        key = _text(tok).upper()

        def arg():
            if not toks:
                raise Bad("Missing SEARCH argument")
            return _text(toks.pop(0))

        def has(flag):
            return lambda i, r: flag in _flags(r).lower().split()

        def contains(*cols):
            needle = arg().lower()
            return lambda i, r: any(needle in (r[c] or "").lower() for c in cols)

        def day(text):
            try:
                return datetime.strptime(text, "%d-%b-%Y").replace(tzinfo=timezone.utc).timestamp()
            except ValueError:
                raise Bad("Invalid date")

        simple = {"ALL": lambda i, r: True, "SEEN": has("\\seen"), "FLAGGED": has("\\flagged"),
                  "ANSWERED": has("\\answered"), "DELETED": has("\\deleted"), "DRAFT": has("\\draft"),
                  "RECENT": lambda i, r: False, "NEW": lambda i, r: False, "OLD": lambda i, r: True}
        if key in simple:
            return simple[key]
        if key in ("UNSEEN", "UNFLAGGED", "UNANSWERED", "UNDELETED", "UNDRAFT"):
            inner = simple[key[2:]]
            return lambda i, r: not inner(i, r)
        if key == "NOT":
            inner = self._criterion(toks)
            return lambda i, r: not inner(i, r)
        if key == "OR":
            a, b = self._criterion(toks), self._criterion(toks)
            return lambda i, r: a(i, r) or b(i, r)
        if key in ("KEYWORD", "UNKEYWORD"):
            inner = has(arg().lower())
            return inner if key == "KEYWORD" else (lambda i, r: not inner(i, r))
        if key == "SUBJECT":
            return contains("subject")
        if key == "FROM":
            return contains("from_addr", "from_name")
        if key == "TO":
            return contains("to_addrs")
        if key == "CC":
            return contains("cc_addrs")
        if key == "BCC":
            return contains("bcc_addrs")
        if key == "BODY":
            return contains("body_text")
        if key == "TEXT":
            return contains("subject", "from_addr", "from_name", "to_addrs", "cc_addrs", "body_text")
        if key == "HEADER":
            name = arg().lower()
            col = {"subject": "subject", "from": "from_addr", "to": "to_addrs", "cc": "cc_addrs",
                   "message-id": "msgid"}.get(name)
            needle = arg().lower()
            if col is None:
                return lambda i, r: False
            return lambda i, r: needle in (r[col] or "").lower()
        if key in ("LARGER", "SMALLER"):
            n = int(arg())
            return (lambda i, r: r["size"] > n) if key == "LARGER" else (lambda i, r: r["size"] < n)
        if key in ("SINCE", "SENTSINCE"):
            t = day(arg())
            return lambda i, r: r["date"] >= t
        if key in ("BEFORE", "SENTBEFORE"):
            t = day(arg())
            return lambda i, r: r["date"] < t
        if key in ("ON", "SENTON"):
            t = day(arg())
            return lambda i, r: t <= r["date"] < t + 86400
        if key == "UID":
            picked = set(self._set(arg(), True))
            return lambda i, r: i in picked
        if re.match(r"^[\d:*,]+$", key):
            picked = set(self._set(key, False))
            return lambda i, r: i in picked
        raise Bad("Unsupported SEARCH key " + key[:30])


SELECTED_ONLY = {"CHECK", "CLOSE", "UNSELECT", "EXPUNGE", "SEARCH", "FETCH", "STORE", "COPY", "MOVE"}
UID_CMDS = {"FETCH", "STORE", "SEARCH", "COPY", "MOVE", "EXPUNGE"}


# ---------- POP3 ----------

class Pop3(Conn):
    async def run(self):
        self.send("+OK POP3 ready\r\n")
        name, msgs, deleted = None, [], set()
        while True:
            await self.w.drain()
            line = await self.readline(600 if self.user else 120)
            parts = line.decode("utf-8", "replace").strip().split(" ", 1)
            cmd, arg = parts[0].upper(), parts[1] if len(parts) > 1 else ""
            if cmd == "QUIT":
                if self.user and deleted:
                    with db.conn() as c:
                        db.move_messages(c, self.user["id"], [msgs[i]["id"] for i in deleted], "trash")
                self.send("+OK Bye\r\n")
                await self.w.drain()
                return
            if cmd == "CAPA":
                caps = ["TOP", "UIDL", "RESP-CODES", "PIPELINING"]
                if not self.tls:
                    caps.append("STLS")
                if security.plaintext_login_allowed(self.ip, self.tls):
                    caps.append("USER")
                self.send("+OK Capability list follows\r\n%s\r\n.\r\n" % "\r\n".join(caps))
            elif cmd == "NOOP":
                self.send("+OK\r\n")
            elif self.user is None:
                if cmd == "STLS" and not self.tls:
                    self.send("+OK Begin TLS negotiation\r\n")
                    await self.starttls()
                elif cmd == "USER":
                    name = arg
                    self.send("+OK Send PASS\r\n")
                elif cmd == "PASS" and name is not None:
                    user, err = await self.login(name, arg)
                    if err == "tls":
                        self.send("-ERR Use TLS (STLS or the POP3S port) before logging in\r\n")
                    elif err == "locked":
                        self.send("-ERR [AUTH] Too many failed attempts, try again later\r\n")
                    elif not user:
                        await asyncio.sleep(1)
                        self.send("-ERR [AUTH] Invalid credentials\r\n")
                    else:
                        self.user = {"id": user["id"]}
                        msgs = db.conn().execute(
                            "SELECT id, uid, size FROM messages WHERE user_id=? AND folder='inbox' "
                            "AND raw IS NOT NULL ORDER BY uid", (user["id"],)).fetchall()
                        self.send("+OK Logged in, %d messages\r\n" % len(msgs))
                    name = None
                else:
                    self.send("-ERR Log in first\r\n")
            else:
                if not self.still_valid():
                    self.send("-ERR Password changed, please log in again\r\n")
                    await self.w.drain()
                    return
                live = [i for i in range(len(msgs)) if i not in deleted]

                def pick(text):
                    try:
                        i = int(text) - 1
                    except ValueError:
                        return None
                    return i if 0 <= i < len(msgs) and i not in deleted else None

                if cmd == "STAT":
                    self.send("+OK %d %d\r\n" % (len(live), sum(msgs[i]["size"] for i in live)))
                elif cmd in ("LIST", "UIDL"):
                    field = "size" if cmd == "LIST" else "uid"
                    if arg:
                        i = pick(arg)
                        self.send("+OK %d %d\r\n" % (i + 1, msgs[i][field]) if i is not None else "-ERR No such message\r\n")
                    else:
                        self.send("+OK\r\n%s.\r\n" % "".join("%d %d\r\n" % (i + 1, msgs[i][field]) for i in live))
                elif cmd in ("RETR", "TOP"):
                    bits = arg.split()
                    i = pick(bits[0]) if bits else None
                    row = None
                    if i is not None:
                        row = db.conn().execute("SELECT raw FROM messages WHERE id=? AND user_id=? AND folder='inbox'",
                                                (msgs[i]["id"], self.user["id"])).fetchone()
                    if row is None or row["raw"] is None:
                        self.send("-ERR No such message\r\n")
                        continue
                    raw = bytes(row["raw"])
                    if cmd == "TOP":
                        try:
                            n = max(0, int(bits[1]))
                        except (IndexError, ValueError):
                            self.send("-ERR Usage: TOP msg lines\r\n")
                            continue
                        head, sep, body = raw.partition(b"\r\n\r\n")
                        raw = head + sep + b"".join(body.splitlines(keepends=True)[:n])
                    lines = raw.splitlines()
                    data = b"\r\n".join((b"." + ln) if ln.startswith(b".") else ln for ln in lines)
                    self.send(b"+OK %d octets\r\n" % len(raw) + data + b"\r\n.\r\n")
                    await self.w.drain()
                elif cmd == "DELE":
                    i = pick(arg)
                    if i is None:
                        self.send("-ERR No such message\r\n")
                    else:
                        deleted.add(i)
                        self.send("+OK Marked for deletion\r\n")
                elif cmd == "RSET":
                    deleted.clear()
                    self.send("+OK\r\n")
                else:
                    self.send("-ERR Unknown command\r\n")


# ---------- khởi động ----------

def start():
    """Chạy IMAP/POP3 trong một luồng riêng với vòng lặp asyncio riêng. Trả về danh sách (tên, cổng)."""
    tls = security.server_tls_context()
    plan = [("IMAP", Imap, config.IMAP_PORT, None), ("IMAPS", Imap, config.IMAPS_PORT, tls),
            ("POP3", Pop3, config.POP3_PORT, None), ("POP3S", Pop3, config.POP3S_PORT, tls)]
    plan = [p for p in plan if p[2]]
    ready = threading.Event()
    errors = []

    def runner():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def boot():
            for name, cls, port, ctx in plan:
                def handler(r, w, cls=cls, secure=ctx is not None):
                    return _serve(cls, secure, r, w)
                await asyncio.start_server(handler, config.SMTP_HOST, port, ssl=ctx, limit=MAX_LINE * 2)
        try:
            loop.run_until_complete(boot())
        except Exception as e:
            errors.append(e)
        ready.set()
        if not errors:
            loop.run_forever()

    threading.Thread(target=runner, daemon=True, name="mail-access").start()
    ready.wait(15)
    if errors:
        raise errors[0]
    return [(p[0], p[2]) for p in plan]
