"""Lọc thư rác: kiểm tra SPF/DKIM/DMARC, danh sách đen DNS và bộ lọc Bayes học theo từng người dùng."""
import ipaddress
import logging
import math
import re
from email.utils import parseaddr

from . import config

log = logging.getLogger("webmail")
_TWO_LEVEL = {"com", "net", "org", "edu", "gov", "co", "ac", "or", "ne", "go", "mil", "int", "info", "biz", "name"}


def org_domain(domain):
    """Tên miền tổ chức (xấp xỉ, không dùng Public Suffix List): a.b.vidu.com.vn -> vidu.com.vn."""
    labels = (domain or "").lower().strip(".").split(".")
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in _TWO_LEVEL:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def _txt(name):
    import dns.resolver
    try:
        r = dns.resolver.Resolver()
        r.lifetime = 5
        return [b"".join(rd.strings).decode("ascii", "replace") for rd in r.resolve(name, "TXT")]
    except Exception:
        return []


def _public_ip(ip):
    try:
        a = ipaddress.ip_address(ip)
        return not (a.is_private or a.is_loopback or a.is_link_local or a.is_reserved)
    except ValueError:
        return False


def check_spf(ip, helo, mail_from):
    try:
        import spf
        sender = mail_from if "@" in (mail_from or "") else "postmaster@" + (helo or "unknown")
        return spf.check2(i=ip, s=sender, h=helo or "unknown", timeout=5)[0]
    except Exception:
        return "temperror"


def check_dkim(raw):
    """Trả về (kết quả, [tên miền ký hợp lệ])."""
    try:
        import dkim
        n = len(re.findall(rb"(?im)^dkim-signature:", raw.split(b"\r\n\r\n", 1)[0]))
        if not n:
            return "none", []
        good = []
        for i in range(min(n, 5)):
            d = dkim.DKIM(raw, timeout=5)
            try:
                if d.verify(idx=i) and d.domain:
                    good.append(d.domain.decode("ascii", "replace").lower())
            except Exception:
                continue
        return ("pass", good) if good else ("fail", [])
    except Exception:
        return "temperror", []


def dmarc_policy(domain):
    for name in dict.fromkeys([domain, org_domain(domain)]):
        for txt in _txt("_dmarc." + name):
            if txt.lower().replace(" ", "").startswith("v=dmarc1"):
                tags = dict(p.strip().split("=", 1) for p in txt.split(";") if "=" in p)
                tags = {k.strip().lower(): v.strip().lower() for k, v in tags.items()}
                if name != domain and tags.get("sp"):
                    return tags["sp"]
                return tags.get("p", "none")
    return None


def dnsbl_listed(ip):
    if not config.DNSBL:
        return False
    try:
        import dns.resolver
        a = ipaddress.ip_address(ip)
        if a.version != 4:
            return False
        rev = ".".join(reversed(ip.split(".")))
        r = dns.resolver.Resolver()
        r.lifetime = 4
        for zone in config.DNSBL:
            try:
                answers = r.resolve("%s.%s" % (rev, zone), "A")
                # 127.255.255.x là mã báo lỗi truy vấn của Spamhaus, không phải "bị liệt kê"
                if any(str(x).startswith("127.") and not str(x).startswith("127.255.") for x in answers):
                    return True
            except Exception:
                continue
    except Exception:
        pass
    return False


def check_inbound(ip, helo, mail_from, raw, from_addr):
    """Đánh giá xác thực của thư đến. Trả về dict gồm kết quả, cờ spam và dòng Authentication-Results."""
    res = {"spf": "none", "dkim": "none", "dmarc": "none", "spam": False, "reason": ""}
    if config.SPAM_CHECKS and _public_ip(ip):
        from_domain = (from_addr or "").rpartition("@")[2].lower()
        res["spf"] = check_spf(ip, helo, mail_from)
        res["dkim"], dkim_domains = check_dkim(raw)
        if from_domain:
            env_domain = (mail_from or "").rpartition("@")[2].lower() or (helo or "").lower()
            aligned = ((res["spf"] == "pass" and org_domain(env_domain) == org_domain(from_domain)) or
                       any(org_domain(d) == org_domain(from_domain) for d in dkim_domains))
            policy = dmarc_policy(from_domain)
            if policy is not None:
                res["dmarc"] = "pass" if aligned else "fail"
                if not aligned and policy in ("quarantine", "reject"):
                    res["spam"], res["reason"] = True, "DMARC không đạt (chính sách %s)" % policy
        if not res["spam"] and res["spf"] == "fail" and res["dkim"] != "pass":
            res["spam"], res["reason"] = True, "SPF không đạt"
        if not res["spam"] and dnsbl_listed(ip):
            res["spam"], res["reason"] = True, "Máy gửi nằm trong danh sách đen"
    res["header"] = "Authentication-Results: %s; spf=%s smtp.mailfrom=%s; dkim=%s; dmarc=%s\r\n" % (
        config.HOSTNAME, res["spf"], re.sub(r"[^\w.@+\-]", "", mail_from or "") or "<>", res["dkim"], res["dmarc"])
    return res


def strip_auth_results(raw):
    """Bỏ các dòng Authentication-Results mang tên máy chủ này mà người gửi tự chèn để giả mạo kết quả."""
    head, sep, body = raw.partition(b"\r\n\r\n")
    pat = re.compile(rb"(?im)^authentication-results:[ \t]*" + re.escape(config.HOSTNAME.encode()) +
                     rb"\b.*(?:\r\n[ \t].*)*(?:\r\n|$)")
    return pat.sub(b"", head) + sep + body


# ---------- bộ lọc Bayes ----------

MIN_TRAIN = 8  # cần ít nhất chừng này thư mỗi loại trước khi bộ lọc được phép tự phân loại


def tokens(subject, text, from_addr):
    out = set()
    for w in re.findall(r"[^\W_]{3,24}", (subject or "").lower()):
        out.add("s:" + w)
    for w in re.findall(r"[^\W_]{3,24}", (text or "")[:20000].lower()):
        out.add(w)
    domain = (from_addr or "").rpartition("@")[2].lower()
    if domain:
        out.add("f:" + domain)
    if re.search(r"https?://", text or ""):
        out.add("has:url")
    return list(out)[:1500]


def row_tokens(row):
    return tokens(row["subject"], row["body_text"], row["from_addr"])


def train(c, user_id, toks, is_spam, sign=1):
    col = "spam" if is_spam else "ham"
    c.execute("INSERT OR IGNORE INTO spam_stats(user_id) VALUES(?)", (user_id,))
    c.execute("UPDATE spam_stats SET %s=MAX(0,%s+?) WHERE user_id=?" % (col, col), (sign, user_id))
    for t in toks:
        if sign > 0:
            c.execute("INSERT INTO spam_tokens(user_id,token,%s) VALUES(?,?,1) "
                      "ON CONFLICT(user_id,token) DO UPDATE SET %s=%s+1" % (col, col, col), (user_id, t))
        else:
            c.execute("UPDATE spam_tokens SET %s=MAX(0,%s-1) WHERE user_id=? AND token=?" % (col, col),
                      (user_id, t))


def set_trained(c, row, label):
    """Ghi nhận thư là rác (1) hay thư thường (2), gỡ lần học trước nếu khác nhãn."""
    old = row["spam_trained"]
    if old == label:
        return
    toks = row_tokens(row)
    if old:
        train(c, row["user_id"], toks, old == 1, -1)
    train(c, row["user_id"], toks, label == 1, 1)
    c.execute("UPDATE messages SET spam_trained=? WHERE id=?", (label, row["id"]))


def bayes_score(c, user_id, toks):
    """Xác suất là thư rác (0..1), hoặc None nếu chưa đủ dữ liệu học."""
    st = c.execute("SELECT spam,ham FROM spam_stats WHERE user_id=?", (user_id,)).fetchone()
    if not st or st["spam"] < MIN_TRAIN or st["ham"] < MIN_TRAIN or not toks:
        return None
    probs = []
    for i in range(0, len(toks), 400):
        chunk = toks[i:i + 400]
        q = "SELECT spam,ham FROM spam_tokens WHERE user_id=? AND token IN (%s)" % ",".join("?" * len(chunk))
        for r in c.execute(q, [user_id] + chunk):
            n = r["spam"] + r["ham"]
            if n < 2:
                continue
            ps, ph = r["spam"] / st["spam"], r["ham"] / st["ham"]
            p = ps / (ps + ph) if ps + ph else 0.5
            probs.append((0.5 + n * p) / (1 + n))
    probs = sorted(probs, key=lambda p: abs(p - 0.5), reverse=True)[:20]
    if len(probs) < 3:
        return None
    ls = sum(math.log(min(max(p, 0.01), 0.99)) for p in probs)
    lh = sum(math.log(1 - min(max(p, 0.01), 0.99)) for p in probs)
    return 1 / (1 + math.exp(min(max(lh - ls, -700), 700)))
