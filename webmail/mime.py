"""Phân tích thư đến, dựng thư đi và làm sạch HTML trước khi hiển thị."""
import html
import re
from email import message_from_bytes, policy
from email.headerregistry import Address
from email.message import EmailMessage
from email.utils import formatdate, getaddresses, make_msgid, parseaddr
from html.parser import HTMLParser

from . import config

ADDR_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.?[A-Za-z0-9\-]+$")


def split_addresses(value):
    """'A <a@x>, b@y' -> [(tên, địa chỉ)]; báo lỗi nếu có địa chỉ sai."""
    out = []
    for name, addr in getaddresses([value or ""]):
        addr = addr.strip()
        if not addr and not name:
            continue
        if not ADDR_RE.match(addr):
            raise ValueError("Địa chỉ không hợp lệ: %s" % (addr or name))
        out.append((name.strip(), addr))
    return out


def _clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


MAX_HTML = 3 * 1024 * 1024   # phần HTML dài hơn mức này bị cắt bớt trước khi xử lý
MAX_PARTS = 1000             # số phần MIME tối đa được duyệt trong một thư
MAX_ATTACHMENTS = 200


class _TextExtractor(HTMLParser):
    """HTML -> văn bản. Dùng bộ phân tích tuyến tính thay cho biểu thức chính quy (tránh treo máy với thư cố ý)."""
    _SKIP = {"script", "style", "head", "title"}
    _BREAK = {"p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self.skip += 1
        elif tag == "br":
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in self._BREAK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_to_text(doc):
    t = _TextExtractor()
    try:
        t.feed((doc or "")[:MAX_HTML])
        t.close()
    except Exception:
        pass
    lines, blank = [], True
    for line in "".join(t.out).replace("\xa0", " ").split("\n"):
        line = " ".join(line.split())
        if line:
            lines.append(line)
            blank = False
        elif not blank:
            lines.append("")
            blank = True
    return "\n".join(lines).strip()


def _content(part):
    try:
        return part.get_content()
    except Exception:
        data = part.get_payload(decode=True) or b""
        return data.decode("utf-8", "replace")


def parse_from(raw):
    """Địa chỉ trong tiêu đề From; rỗng nếu thiếu hoặc có nhiều dòng From (dấu hiệu giả mạo)."""
    from email.parser import BytesHeaderParser
    try:
        head = BytesHeaderParser(policy=policy.default).parsebytes(raw.split(b"\r\n\r\n", 1)[0])
        values = head.get_all("From") or []
        if len(values) != 1:
            return ""
        addrs = getaddresses([str(values[0])])
        return addrs[0][1].strip() if len(addrs) == 1 else ""
    except Exception:
        return ""


def parse(raw):
    """Phân tích thư thành các trường để lưu. Thư có cấu trúc bất thường vẫn được lưu ở dạng tối giản."""
    try:
        return _parse(raw)
    except (RecursionError, Exception):
        from email.parser import BytesHeaderParser
        try:
            head = BytesHeaderParser(policy=policy.compat32).parsebytes(raw.split(b"\r\n\r\n", 1)[0][:65536])
            name, addr = parseaddr(_clean(str(head.get("From", "") or ""))[:500])
            subject = _clean(str(head.get("Subject", "") or ""))[:500]
            to = _clean(str(head.get("To", "") or ""))[:2000]
        except Exception:
            name = addr = subject = to = ""
        text = "(Thư này có cấu trúc không hợp lệ nên không hiển thị được nội dung.)"
        return {"msgid": None, "in_reply_to": None, "refs": None, "from_addr": addr, "from_name": name,
                "reply_to": "", "to": to, "cc": "", "subject": subject, "text": text, "html": None,
                "snippet": text, "attachments": []}


def _parse(raw):
    msg = message_from_bytes(raw, policy=policy.default)

    def hdr(name):
        try:
            return _clean(str(msg.get(name, "") or ""))
        except Exception:
            return ""

    from_name, from_addr = parseaddr(hdr("From"))
    try:
        text_part = msg.get_body(preferencelist=("plain",))
        html_part = msg.get_body(preferencelist=("html",))
    except Exception:
        text_part = html_part = None
    text = _content(text_part) if text_part is not None else ""
    body_html = _content(html_part) if html_part is not None else None
    if not isinstance(text, str):
        text = ""
    if body_html is not None and not isinstance(body_html, str):
        body_html = None
    if body_html is not None:
        body_html = body_html[:MAX_HTML]
    if not text.strip() and body_html:
        text = html_to_text(body_html)

    attachments = []
    for count, part in enumerate(msg.walk()):
        if count >= MAX_PARTS or len(attachments) >= MAX_ATTACHMENTS:
            break
        if part.is_multipart() or part is text_part or part is html_part:
            continue
        data = part.get_payload(decode=True)
        if data is None:
            continue
        cid = (part.get("Content-ID") or "").strip().strip("<>") or None
        try:
            filename = part.get_filename()
        except Exception:
            filename = None
        inline = bool(cid and body_html and ("cid:" + cid) in body_html)
        attachments.append({
            "filename": _clean(filename)[:200] or "tep-dinh-kem",
            "ctype": part.get_content_type(),
            "data": data,
            "cid": cid,
            "inline": inline,
        })

    return {
        "msgid": hdr("Message-ID")[:998] or None,
        "in_reply_to": hdr("In-Reply-To")[:998] or None,
        "refs": hdr("References")[-4000:] or None,
        "from_addr": from_addr, "from_name": from_name,
        "reply_to": parseaddr(hdr("Reply-To"))[1],
        "to": hdr("To")[:20000], "cc": hdr("Cc")[:20000],
        "subject": hdr("Subject")[:998],
        "text": text, "html": body_html,
        "snippet": _clean(text)[:200],
        "attachments": attachments,
    }


def build(from_name, from_addr, to, cc, subject, text, attachments=(), in_reply_to=None, refs=None, html=None):
    """to/cc: [(tên, địa chỉ)]; attachments: các dòng có filename/ctype/data. Trả về bytes."""
    def addrs(pairs):
        return [Address(display_name=n, addr_spec=a) for n, a in pairs]

    m = EmailMessage()
    m["From"] = Address(display_name=from_name, addr_spec=from_addr)
    if to:
        m["To"] = addrs(to)
    if cc:
        m["Cc"] = addrs(cc)
    m["Subject"] = _clean(subject)
    m["Date"] = formatdate(localtime=True)
    m["Message-ID"] = make_msgid(domain=config.DOMAIN)
    if in_reply_to:
        m["In-Reply-To"] = in_reply_to
    if refs:
        m["References"] = refs
    m.set_content(text or "")
    embedded = [a for a in attachments if html and a["inline"] and a["cid"] and ("cid:" + a["cid"]) in html]
    if html:
        m.add_alternative("<!doctype html><html><body>%s</body></html>" % html, subtype="html")
        html_part = m.get_payload()[1]
        for a in embedded:  # ảnh chèn trong nội dung: đi kèm phần HTML (multipart/related)
            main, _, sub = a["ctype"].partition("/")
            html_part.add_related(bytes(a["data"]), maintype=main, subtype=sub, cid="<%s>" % a["cid"],
                                  filename=a["filename"])
    for a in attachments:
        if a["inline"]:
            continue
        main, _, sub = (a["ctype"] or "application/octet-stream").partition("/")
        m.add_attachment(bytes(a["data"]), maintype=main, subtype=sub or "octet-stream", filename=a["filename"])
    return m.as_bytes(policy=policy.SMTP.clone(cte_type="7bit"))


# ---------- làm sạch HTML ----------

_DROP_WITH_CONTENT = {"script", "iframe", "object", "embed", "applet", "svg", "math", "title", "noscript",
                      "frame", "frameset", "template"}
_DROP_TAG = {"html", "head", "body", "meta", "link", "base", "form", "input", "button", "textarea", "select",
             "option"}
_URL_ATTRS = {"href", "src", "background", "poster", "action", "cite", "longdesc"}
_VOID = {"br", "hr", "img", "col", "wbr", "area", "source", "track"}
_REMOTE = re.compile(r"^(https?:)?//", re.I)
_CSS_RISKY = re.compile(r"(?i)url|image-set|@import|@font-face|expression|\\")


class _Sanitizer(HTMLParser):
    def __init__(self, cid_urls, allow_remote):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = 0
        self.in_style = False
        self.cid_urls = cid_urls
        self.allow_remote = allow_remote
        self.blocked = False

    def _url(self, tag, name, value):
        v = re.sub(r"[\x00-\x20]", "", value)
        if v.lower().startswith("cid:"):
            return self.cid_urls.get(v[4:])
        if tag == "a" and name == "href":
            return value if re.match(r"(?i)^(https?:|mailto:|tel:|#)", v) else None
        if _REMOTE.match(v):
            if self.allow_remote:
                return value
            self.blocked = True
            return None
        if tag == "img" and re.match(r"(?i)^data:image/(png|jpe?g|gif|webp);", v):
            return value
        return None

    def handle_starttag(self, tag, attrs):
        if tag in _DROP_WITH_CONTENT:
            self.skip += 1
            return
        if self.skip or tag in _DROP_TAG:
            return
        if tag == "style":
            self.in_style = True
        parts = [tag]
        for name, value in attrs:
            name = name.lower()
            if name.startswith("on") or name in ("srcdoc", "formaction", "srcset", "target", "rel", "ping"):
                continue
            if not re.match(r"^[a-z][a-z0-9\-_:]*$", name):
                continue
            value = value or ""
            if name in _URL_ATTRS:
                value = self._url(tag, name, value)
                if value is None:
                    continue
            if name == "style" and _CSS_RISKY.search(value):
                # CSS có thể tải tài nguyên từ xa (url, image-set, mã thoát \75rl…): bỏ cả thuộc tính.
                if not self.allow_remote or "expression" in value.lower() or "\\" in value:
                    if not self.allow_remote:
                        self.blocked = True
                    continue
            parts.append('%s="%s"' % (name, html.escape(value, quote=True)))
        if tag == "a":
            parts.append('target="_blank" rel="noopener noreferrer"')
        self.out.append("<%s>" % " ".join(parts))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag in _DROP_WITH_CONTENT:
            self.skip = max(0, self.skip - 1)

    def handle_endtag(self, tag):
        if tag in _DROP_WITH_CONTENT:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip or tag in _DROP_TAG or tag in _VOID:
            return
        if tag == "style":
            self.in_style = False
        self.out.append("</%s>" % tag)

    def handle_data(self, data):
        if self.skip:
            return
        if self.in_style:
            if _CSS_RISKY.search(data):
                if not self.allow_remote or "expression" in data.lower() or "\\" in data:
                    if not self.allow_remote:
                        self.blocked = True
                    return  # bỏ cả khối <style> có khả năng tải tài nguyên từ xa
            self.out.append(data.replace("<", ""))
        else:
            self.out.append(html.escape(data, quote=False))


def sanitize_html(doc, cid_urls=None, allow_remote=False):
    """Trả về (tài liệu HTML an toàn, có nội dung từ xa bị chặn hay không)."""
    s = _Sanitizer(cid_urls or {}, allow_remote)
    try:
        s.feed(doc[:MAX_HTML])
        s.close()
    except Exception:
        return "<pre>%s</pre>" % html.escape(html_to_text(doc)), False
    page = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<style>html{background:#fff;color:#1f2328}body{font:15px/1.55 system-ui,-apple-system,'Segoe UI',"
        "Roboto,sans-serif;margin:0;padding:2px;overflow-wrap:anywhere}img{max-width:100%;height:auto}"
        "table{max-width:100%}blockquote{margin:0 0 0 .8em;padding-left:.8em;border-left:3px solid #d0d7de;"
        "color:#57606a}</style></head><body>" + "".join(s.out) + "</body></html>"
    )
    return page, s.blocked


# ---------- HTML do người dùng soạn: chỉ giữ một số thẻ định dạng ----------

_FRAG_TAGS = {"b", "strong", "i", "em", "u", "s", "strike", "p", "br", "div", "span", "ul", "ol", "li", "a",
              "blockquote", "h1", "h2", "h3", "pre", "code", "hr"}


class _Fragment(HTMLParser):
    def __init__(self, img_src=None):
        super().__init__(convert_charrefs=True)
        self.img_src = img_src
        self.out = []
        self.skip = 0
        self.open = []

    def handle_starttag(self, tag, attrs):
        if tag in _DROP_WITH_CONTENT or tag == "style":
            self.skip += 1
            return
        if tag == "img" and not self.skip and self.img_src:
            # Chỉ giữ ảnh mà máy chủ nhận ra là ảnh đã tải lên cho chính thư nháp này.
            src = self.img_src(dict(attrs).get("src") or "")
            if src:
                self.out.append('<img src="%s" alt="">' % html.escape(src, quote=True))
            return
        if self.skip or tag not in _FRAG_TAGS:
            return
        extra = ""
        if tag == "a":
            href = re.sub(r"[\x00-\x20]", "", dict(attrs).get("href") or "")
            if re.match(r"(?i)^(https?://|mailto:)", href):
                extra = ' href="%s" target="_blank" rel="noopener noreferrer"' % html.escape(href, quote=True)
        self.out.append("<%s%s>" % (tag, extra))
        if tag not in ("br", "hr"):
            self.open.append(tag)

    def handle_startendtag(self, tag, attrs):
        if tag == "img":
            self.handle_starttag(tag, attrs)
        elif tag in ("br", "hr") and not self.skip:
            self.out.append("<%s>" % tag)

    def handle_endtag(self, tag):
        if tag in _DROP_WITH_CONTENT or tag == "style":
            self.skip = max(0, self.skip - 1)
            return
        if self.skip or tag not in self.open:
            return
        while self.open:  # đóng cả các thẻ con còn mở để HTML luôn cân bằng
            t = self.open.pop()
            self.out.append("</%s>" % t)
            if t == tag:
                break

    def handle_data(self, data):
        if not self.skip:
            self.out.append(html.escape(data, quote=False))


def image_type(data):
    """Loại ảnh theo chữ ký tệp (không tin phần mở rộng hay Content-Type do máy khách gửi), hoặc None."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def sanitize_fragment(doc, img_src=None):
    """Làm sạch HTML soạn trong trình duyệt: chỉ giữ thẻ định dạng cơ bản, không thuộc tính (trừ liên kết).

    img_src: hàm đổi địa chỉ ảnh thành địa chỉ được phép (hoặc None để bỏ ảnh); không truyền thì bỏ mọi ảnh.
    """
    f = _Fragment(img_src)
    try:
        f.feed(doc or "")
        f.close()
    except Exception:
        return html.escape(html_to_text(doc or ""))
    while f.open:
        f.out.append("</%s>" % f.open.pop())
    return "".join(f.out)
