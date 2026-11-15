"""Helpers for the extended-edition (bản mở rộng, M1 + M2) black-box QA suite.

Builds on lib.py (runner, HTTP client, domain helpers). Tests are tagged with the feature they cover:
F (feature switches), C1 (permissions), C3 (Excel import), C4 (period lock), C5 (min stock),
C6 (customer prices), C7 (gross profit), C8 (credit limit + aging), G (general robustness).
"""
import io
import json
import re
import threading
from decimal import Decimal, ROUND_HALF_UP

import requests

import lib
from lib import *  # noqa: F401,F403

# M3 built: every key is available now (QUYET_DINH Q14)
AVAILABLE = ["permissions", "period_lock", "import_excel", "min_stock", "price_list", "credit_limit", "profit_report",
             "stocktake", "unit_conversion", "vat", "print_template"]
UNAVAILABLE = []
ALL_KEYS = AVAILABLE + UNAVAILABLE
PERMS = ["sale.write", "purchase.write", "stock.write", "cash.write", "catalog.write", "posted.edit", "cost.view",
         "debt.view", "cash.view", "report.view"]
DEFAULT_MATRIX = {
    "ketoan": list(PERMS),
    "banhang": ["sale.write", "cash.write", "debt.view", "report.view"],
    "muahang": ["purchase.write", "stock.write", "cash.write", "cost.view", "debt.view", "report.view"],
    "thukho": ["stock.write"],
}
ROLES = ["admin", "ketoan", "banhang", "muahang", "thukho"]

D = Decimal

# unique codes even when the suite is re-run against the same database
import time as _time
lib._seq[0] = (int(_time.time()) % 86400) * 10
RUN = str(lib._seq[0])


def test(tag, name=None):
    """Like lib.test, but a Fatal raised by a helper (ok(), posted(), draft()...) is recorded as a failure.
    (lib.run_all silently swallows Fatal, so a broken fixture would otherwise look like a PASS.)"""
    def deco(fn):
        def wrapped():
            try:
                fn()
            except Fatal as e:
                c = lib.ctx()
                if c is None or not c.failures or c.failures[-1] != str(e):
                    fail("FATAL (test aborted): " + str(e)[:600])
        wrapped.__name__ = fn.__name__
        lib.TESTS.append((name or fn.__name__, [tag], wrapped))
        return fn
    return deco


# --------------------------------------------------------------------------- users / roles

_users = {}


def mk_user(role, username=None, password="123456", full_name=None):
    username = username or uid("u_" + role + "_").lower()
    r = admin().post("/users", {"username": username, "password": password,
                                "full_name": full_name or f"QA {role} {username}", "role": role, "active": True})
    if r.status != 201:
        raise Fatal("create user failed: " + r.short())
    c = login(username, password)
    c.user = r.json
    return c


def user(role):
    """Cached logged-in client for a role (admin -> admin())."""
    if role == "admin":
        return admin()
    if role not in _users:
        _users[role] = mk_user(role, username=f"qa_{role}_{RUN}")
    return _users[role]


def relogin_cached():
    for role in list(_users):
        _users[role] = login(f"qa_{role}_{RUN}", "123456")


def me(c):
    return c.ok("GET", "/auth/me")


def matrix():
    return admin().ok("GET", "/role-permissions")["matrix"]


def set_matrix(m):
    return admin().put("/role-permissions", {"matrix": m})


def restore_matrix():
    r = set_matrix({k: list(v) for k, v in DEFAULT_MATRIX.items()})
    if r.status != 200:
        fail("restore matrix failed: " + r.short())


# --------------------------------------------------------------------------- features / lock

def features():
    return admin().ok("GET", "/features")


def set_features(confirm=None, c=None, **kw):
    body = {"features": kw}
    if confirm is not None:
        body["confirm"] = confirm
    return (c or admin()).put("/features", body)


def all_features_on():
    r = set_features(confirm=True, **{k: True for k in AVAILABLE})
    if r.status != 200:
        fail("could not switch features back on: " + r.short())


def set_lock(date, reason="QA khóa sổ", c=None):
    return (c or admin()).put("/period-lock", {"lock_date": date, "reason": reason})


def clear_lock():
    r = set_lock(None, "QA bỏ khóa")
    if r.status != 200:
        # feature may be off - switch on, clear, leave on
        set_features(period_lock=True)
        r = set_lock(None, "QA bỏ khóa")
        if r.status != 200:
            fail("could not clear lock: " + r.short())


def expect_err(r, status, code, label):
    ok = check(r.status == status and r.code == code, f"{label}: expected {status} {code}, got {r.short()[:500]}")
    if ok and r.json:
        msg = r.json["error"].get("message") or ""
        check(has_vietnamese(msg), f"{label}: message not Vietnamese: {msg!r}")
    return ok


VN_CHARS = set("ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ")


def has_vietnamese(s):
    return any(ch in VN_CHARS for ch in (s or "").lower())


def is_ok(r):
    return 200 <= r.status < 300


# --------------------------------------------------------------------------- xlsx building / import

def xlsx_bytes(header, rows, sheet="Dữ liệu", before=None, guide_first=False, extra=None):
    """Build an xlsx file. rows: list of lists; values may be str/int/float/None or ('=', formula)."""
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    if guide_first:
        ws.title = "Hướng dẫn"
        ws.append(["Đây là trang hướng dẫn"])
        ws = wb.create_sheet(sheet)
    else:
        ws.title = sheet
    for b in before or []:
        ws.append(b)
    if header is not None:
        ws.append(header)
    for r in rows:
        ws.append(list(r))
    for name, data in (extra or {}).items():
        w2 = wb.create_sheet(name)
        for r in data:
            w2.append(r)
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def upload(c, kind, content, dry=True, date=None, filename="nhap.xlsx", ctype=XLSX_CT, field="file", extra_params=None):
    params = {}
    if dry:
        params["dry_run"] = "1"
    if date:
        params["date"] = date
    params.update(extra_params or {})
    h = {"Authorization": "Bearer " + c.token} if c.token else {}
    files = {field: (filename, content, ctype)} if content is not None else None
    r = c.s.post(lib.BASE + f"/import/{kind}", params=params, files=files, headers=h, timeout=300)
    resp = lib.Resp(r, "POST", f"/import/{kind}?" + "&".join(f"{k}={v}" for k, v in params.items()), f"<file {filename} {len(content or b'')} bytes>")
    if resp.status >= 500:
        lib.SERVER_ERRORS.append(resp.short())
        fail("HTTP 5xx: " + resp.short())
    return resp


def import_result(r):
    """the result object of an import call (200 body or 422 details)"""
    if r.status == 200:
        return r.json
    return r.details or {}


def errs_text(res):
    return json.dumps((res or {}).get("errors"), ensure_ascii=False)


# --------------------------------------------------------------------------- misc domain

def set_product(pid, **fields):
    """PUT product keeping other fields (PUT is full replace)."""
    p = admin().ok("GET", f"/products/{pid}")
    body = {k: p.get(k) for k in ("code", "name", "unit", "group_id", "sale_price", "purchase_price", "is_service", "active")}
    body.update(fields)
    return admin().put(f"/products/{pid}", body)


def partner_body(p, **fields):
    body = {k: p.get(k) for k in ("code", "name", "address", "phone", "tax_code", "is_customer", "is_supplier",
                                   "opening_receivable", "opening_payable", "active")}
    body.update(fields)
    return body


def set_partner(pid, c=None, **fields):
    p = admin().ok("GET", f"/partners/{pid}")
    return (c or admin()).put(f"/partners/{pid}", partner_body(p, **fields))


def receivable(pid, date=None):
    params = {}
    if date:
        params["date"] = date
    return num(admin().ok("GET", f"/partners/{pid}/balance", params=params)["receivable"])


def rec_ledger_closing(pid, to=None):
    params = {"partner_id": pid, "side": "receivable"}
    if to:
        params["to"] = to
    return num(admin().ok("GET", "/reports/debt-ledger", params=params)["closing"])


def aging(as_of=None, c=None, **params):
    if as_of:
        params["as_of"] = as_of
    return (c or admin()).ok("GET", "/reports/debt-aging", params=params)


def aging_item(pid, as_of):
    rep = aging(as_of, partner_id=pid)
    for it in rep["items"]:
        if it["partner_id"] == pid:
            return it
    return None


BUCKETS = ["opening", "in_term", "d1_30", "d31_60", "d61_90", "over_90", "prepaid"]


def profit(c=None, **params):
    return (c or admin()).ok("GET", "/reports/profit", params=params)


def r0(x):
    return D(str(x)).quantize(D("1"), rounding=ROUND_HALF_UP)


def strip_noise(txt):
    """remove timestamps (microseconds could collide with secret numbers)"""
    txt = re.sub(r"\d{4}-\d\d-\d\dT[0-9:.]+(Z|[+-]\d\d:\d\d)?", "<ts>", txt)
    txt = re.sub(r"\b\d\d:\d\d(:\d\d)?\b", "<hm>", txt)
    return txt


def secret_forms(n):
    """textual forms of an integer amount: 913579, 913.579, 913,579, 913 579"""
    n = int(n)
    s = str(n)
    g = f"{n:,}"
    return {s, g.replace(",", "."), g, g.replace(",", " "), g.replace(",", "\u00a0")}


def find_secrets(text, secrets):
    text = strip_noise(text)
    hits = []
    for n in secrets:
        for f in secret_forms(n):
            if len(f) >= 5 and re.search(r"(?<![\d.,])" + re.escape(f) + r"(?![\d])", text):
                hits.append(f)
                break
    return hits


def xlsx_numbers(content):
    out = []
    try:
        wb = open_xlsx_values(content)
    except Exception:
        return out
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, (int, float)) and not isinstance(c.value, bool):
                    out.append(c.value)
    return out


def file_text(content):
    """all text of an xlsx/docx (best effort)"""
    try:
        if content[:2] == b"PK":
            import zipfile
            z = zipfile.ZipFile(io.BytesIO(content))
            names = z.namelist()
            if any(n.startswith("word/") for n in names):
                return docx_text(open_docx(content))
            return xlsx_text(open_xlsx(content)) + "\n" + "\n".join(str(v) for v in xlsx_numbers(content))
    except Exception as e:  # noqa
        return f"<unreadable {e}>"
    return content.decode("utf-8", "replace")


def run_parallel(fns):
    """run callables concurrently, return list of results (exceptions captured)"""
    res = [None] * len(fns)
    barrier = threading.Barrier(len(fns))

    def w(i, f):
        try:
            barrier.wait(5)
        except Exception:
            pass
        try:
            res[i] = f()
        except Exception as e:  # noqa
            res[i] = e
    ts = [threading.Thread(target=w, args=(i, f)) for i, f in enumerate(fns)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(120)
    return res


def raw_client(c):
    """an independent HTTP session with the same token (for threads)"""
    return Client(c.token, c.label)
