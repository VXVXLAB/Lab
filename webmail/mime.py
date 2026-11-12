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


def html_to_text(doc):
    doc = re.sub(r"(?is)<(script|style|head|title)\b.*?</\1\s*>", " ", doc)
    doc = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|li|h[1-6])\s*>", "\n", doc)
    doc = html.unescape(re.sub(r"(?s)<[^>]*>", "", doc))
    doc = re.sub(r"[ \t\xa0]+", " ", doc)
    return re.sub(r"\n\s*\n\s*", "\n\n", doc).strip()


def _content(part):
    try:
        return part.get_content()
    except Exception:
        data = part.get_payload(decode=True) or b""
        return data.decode("utf-8", "replace")


def parse(raw):
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
    if not text.strip() and body_html:
        text = html_to_text(body_html)

    attachments = []
    for part in msg.walk():
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
            "filename": _clean(filename) or "tep-dinh-kem",
            "ctype": part.get_content_type(),
            "data": data,
            "cid": cid,
            "inline": inline,
        })

    return {
        "msgid": hdr("Message-ID") or None,
        "in_reply_to": hdr("In-Reply-To") or None,
        "refs": hdr("References") or None,
        "from_addr": from_addr, "from_name": from_name,
        "reply_to": parseaddr(hdr("Reply-To"))[1],
        "to": hdr("To"), "cc": hdr("Cc"),
        "subject": hdr("Subject"),
        "text": text, "html": body_html,
        "snippet": _clean(text)[:200],
        "attachments": attachments,
    }


def build(from_name, from_addr, to, cc, subject, text, attachments=(), in_reply_to=None, refs=None):
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
    for a in attachments:
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
            if name == "style" and re.search(r"(?i)url\s*\(|expression|@import", value) and not self.allow_remote:
                value = re.sub(r"(?i)url\s*\([^)]*\)", "none", value)
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
            if not self.allow_remote:
                data = re.sub(r"(?i)@import[^;]*;?", "", data)
            self.out.append(data.replace("<", ""))
        else:
            self.out.append(html.escape(data, quote=False))


def sanitize_html(doc, cid_urls=None, allow_remote=False):
    """Trả về (tài liệu HTML an toàn, có nội dung từ xa bị chặn hay không)."""
    s = _Sanitizer(cid_urls or {}, allow_remote)
    try:
        s.feed(doc)
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
