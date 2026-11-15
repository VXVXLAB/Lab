"""Black-box QA harness: tiny test runner + HTTP client + domain helpers.

Only stdlib + requests + openpyxl + python-docx.
"""
import io
import json
import os
import sys
import threading
import time
import traceback
import zipfile
from decimal import Decimal, ROUND_HALF_UP

import requests

BASE = os.environ.get("QA_BASE", "http://127.0.0.1:18181") + "/api"

# --------------------------------------------------------------------------- runner

TESTS = []          # (name, reqs, fn)
_cur = threading.local()
SERVER_ERRORS = []  # every 5xx seen anywhere


class Fatal(Exception):
    pass


def test(reqs, name=None):
    """Register a test. reqs: '011,077' style string."""
    def deco(fn):
        TESTS.append((name or fn.__name__, [r.strip() for r in reqs.split(",") if r.strip()], fn))
        return fn
    return deco


class Ctx:
    def __init__(self, name):
        self.name = name
        self.failures = []
        self.checks = 0


def ctx():
    return getattr(_cur, "ctx", None)


def fail(msg):
    c = ctx()
    if c is None:
        print("FAIL (no ctx):", msg)
        return
    c.failures.append(msg)


def check(cond, msg):
    c = ctx()
    if c:
        c.checks += 1
    if not cond:
        fail(msg)
    return bool(cond)


def num(x):
    if x is None:
        return None
    try:
        return Decimal(str(x))
    except Exception:
        return x


def eq(actual, expected, msg):
    if isinstance(expected, (int, float, Decimal)) and not isinstance(expected, bool):
        ok = actual is not None and not isinstance(actual, (str, bool)) and abs(num(actual) - num(expected)) < Decimal("0.0005")
    else:
        ok = actual == expected
    return check(ok, f"{msg}: expected {expected!r}, got {actual!r}")


def require(cond, msg):
    if not check(cond, msg):
        raise Fatal(msg)


def run_all(selected=None):
    results = []
    t0 = time.time()
    for name, reqs, fn in TESTS:
        if selected and not any(s in name for s in selected):
            continue
        c = Ctx(name)
        _cur.ctx = c
        st = time.time()
        status = "PASS"
        try:
            fn()
        except Fatal as e:
            # require() records its failure before raising; helpers (ok(), posted(), draft(), login()...) do not.
            # A Fatal that was not recorded must still fail the test (it used to be swallowed -> false PASS).
            if not c.failures or c.failures[-1] != str(e):
                c.failures.append("FATAL (test aborted): " + str(e)[:1500])
        except Exception as e:  # noqa
            c.failures.append("EXCEPTION: " + "".join(traceback.format_exception(e))[-1500:])
        if c.failures:
            status = "FAIL"
        dur = time.time() - st
        _cur.ctx = None
        results.append({"name": name, "reqs": reqs, "status": status, "checks": c.checks,
                        "failures": c.failures, "seconds": round(dur, 2)})
        tag = ",".join("REQ-" + r for r in reqs)
        print(f"[{status}] {name} ({tag}) checks={c.checks} {dur:.1f}s", flush=True)
        for f in c.failures[:25]:
            print("      - " + f.replace("\x00", "\\0").replace("\n", "\n        "), flush=True)
        if len(c.failures) > 25:
            print(f"      ... {len(c.failures) - 25} more", flush=True)
    return results, time.time() - t0


# --------------------------------------------------------------------------- HTTP

class Resp:
    def __init__(self, r, method, path, body):
        self.status = r.status_code
        self.content = r.content
        self.headers = r.headers
        self.method = method
        self.path = path
        self.body = body
        try:
            self.json = r.json()
        except Exception:
            self.json = None

    @property
    def code(self):
        try:
            return self.json["error"]["code"]
        except Exception:
            return None

    @property
    def details(self):
        try:
            return self.json["error"].get("details")
        except Exception:
            return None

    def short(self):
        b = json.dumps(self.body, ensure_ascii=False)[:300] if self.body is not None else ""
        txt = self.content[:400].decode("utf-8", "replace") if self.json is not None or self.content[:1] in (b"{", b"[") else f"<{len(self.content)} bytes>"
        return f"{self.method} {self.path} {b} -> {self.status} {txt}".replace("\x00", "\\0")


class Client:
    def __init__(self, token=None, label="admin"):
        self.s = requests.Session()
        self.token = token
        self.label = label

    def req(self, method, path, body=None, params=None, raw=None, headers=None):
        h = {}
        if self.token:
            h["Authorization"] = "Bearer " + self.token
        if headers:
            h.update(headers)
        url = BASE + path
        kw = {"params": params, "headers": h, "timeout": 60}
        if raw is not None:
            kw["data"] = raw
        elif body is not None:
            kw["data"] = json.dumps(body, ensure_ascii=False).encode("utf-8")
            h["Content-Type"] = "application/json"
        r = self.s.request(method, url, **kw)
        resp = Resp(r, method, path + (("?" + "&".join(f"{k}={v}" for k, v in params.items())) if params else ""), body)
        if resp.status >= 500:
            SERVER_ERRORS.append(resp.short())
            fail("HTTP 5xx: " + resp.short())
        return resp

    def get(self, path, **params):
        return self.req("GET", path, params=params or None)

    def post(self, path, body=None, **kw):
        return self.req("POST", path, body=body if body is not None else {}, **kw)

    def put(self, path, body):
        return self.req("PUT", path, body=body)

    def delete(self, path, **params):
        return self.req("DELETE", path, params=params or None)

    def ok(self, method, path, body=None, params=None, expect=(200, 201)):
        r = self.req(method, path, body=body, params=params)
        if r.status not in expect:
            raise Fatal(f"unexpected status: {r.short()}")
        return r.json


def login(username, password):
    r = requests.post(BASE + "/auth/login", json={"username": username, "password": password}, timeout=30)
    if r.status_code != 200:
        raise Fatal(f"login {username} failed {r.status_code} {r.text}")
    tok = r.cookies.get("session")
    return Client(tok, username)


_admin = None


def admin():
    global _admin
    if _admin is None:
        _admin = login("admin", os.environ.get("ADMIN_PASSWORD", "admin123"))
    return _admin


# --------------------------------------------------------------------------- domain helpers

_seq = [0]


def uid(prefix="Q"):
    _seq[0] += 1
    return f"{prefix}{_seq[0]:04d}"


_wh = {}


def wh(code):
    """warehouse id by code KHO1..KHO4"""
    if not _wh:
        for w in admin().ok("GET", "/warehouses", params={"page_size": 100})["items"]:
            _wh[w["code"]] = w["id"]
    return _wh[code]


def W():
    return [wh("KHO1"), wh("KHO2"), wh("KHO3"), wh("KHO4")]


def mk_group(code, name):
    return admin().ok("POST", "/product-groups", {"code": code, "name": name})


def mk_product(code=None, name=None, unit="Cái", sale=0, purchase=0, group_id=None, c=None):
    code = code or uid("P")
    return (c or admin()).ok("POST", "/products", {"code": code, "name": name or ("Hàng thử " + code), "unit": unit,
                                                   "group_id": group_id, "sale_price": sale, "purchase_price": purchase,
                                                   "is_service": False, "active": True})


def mk_partner(code=None, name=None, cust=False, supp=False, rec=0, pay=0, c=None):
    code = code or uid("DT")
    return (c or admin()).ok("POST", "/partners", {"code": code, "name": name or ("Đối tác " + code), "is_customer": cust,
                                                   "is_supplier": supp, "opening_receivable": rec,
                                                   "opening_payable": pay, "active": True})


def mk_account(kind="cash", opening=0, code=None):
    code = code or uid("TK")
    return admin().ok("POST", "/cash-accounts", {"code": code, "name": "Tài khoản " + code, "kind": kind,
                                                 "opening_balance": opening, "active": True})


def L(pid, qty=None, price="__none__", desc=None, **kw):
    d = {"product_id": pid}
    if qty is not None:
        d["qty"] = qty
    if price != "__none__":
        d["unit_price"] = price
    if desc is not None:
        d["description"] = desc
    d.update(kw)
    return d


def doc_body(doc_type, date, whid, lines, partner=None, to_wh=None, note=""):
    return {"doc_type": doc_type, "doc_date": date, "partner_id": partner, "warehouse_id": whid,
            "to_warehouse_id": to_wh, "note": note, "lines": lines}


def create_doc(doc_type, date, whid, lines, partner=None, to_wh=None, note="", c=None):
    return (c or admin()).req("POST", "/documents", doc_body(doc_type, date, whid, lines, partner, to_wh, note))


def post_doc(doc, confirm_loss=False, c=None):
    return (c or admin()).req("POST", f"/documents/{doc['id']}/post", {"version": doc["version"], "confirm_loss": confirm_loss})


def posted(doc_type, date, whid, lines, partner=None, to_wh=None, note="", confirm_loss=True, c=None):
    r = create_doc(doc_type, date, whid, lines, partner, to_wh, note, c)
    if r.status != 201:
        raise Fatal("create failed: " + r.short())
    p = post_doc(r.json, confirm_loss, c)
    if p.status != 200:
        raise Fatal("post failed: " + p.short())
    return p.json


def draft(doc_type, date, whid, lines, partner=None, to_wh=None, note="", c=None):
    r = create_doc(doc_type, date, whid, lines, partner, to_wh, note, c)
    if r.status != 201:
        raise Fatal("create draft failed: " + r.short())
    return r.json


def get_doc(did, c=None):
    return (c or admin()).ok("GET", f"/documents/{did}")


def put_body_from(doc, **override):
    """Build a PUT body from a Document response."""
    lines = []
    for l in doc["lines"]:
        d = {"product_id": l["product_id"], "qty": l["qty"], "unit_price": l["unit_price"],
             "description": l.get("description", ""), "unit": l.get("unit", ""), "note": l.get("note", "")}
        lines.append(d)
    b = {"doc_type": doc["doc_type"], "doc_date": doc["doc_date"], "partner_id": doc["partner_id"],
         "warehouse_id": doc["warehouse_id"], "to_warehouse_id": doc["to_warehouse_id"], "note": doc["note"],
         "lines": lines, "version": doc["version"]}
    b.update(override)
    return b


def stock_summary(c=None, **params):
    params.setdefault("page_size", 100000)
    return (c or admin()).ok("GET", "/reports/stock-summary", params=params)


def stock_of(pid, as_of=None):
    """{wh_id: qty} + total from stock-summary (as_of optional)."""
    p = {"only_with_data": "false"}
    if as_of:
        p["as_of"] = as_of
    s = stock_summary(**p)
    for it in s["items"]:
        if it["product_id"] == pid:
            return {int(k): num(v) for k, v in it["by_warehouse"].items()}, num(it["total"])
    return {}, None


def ledger(pid, **params):
    params["product_id"] = pid
    return admin().ok("GET", "/reports/stock-ledger", params=params)


def debt_ledger(pid, side="receivable", **params):
    params.update(partner_id=pid, side=side)
    return admin().ok("GET", "/reports/debt-ledger", params=params)


def debt_closing(pid, side="receivable", **params):
    return num(debt_ledger(pid, side, **params)["closing"])


def debt_summary_item(pid, side="receivable", **params):
    params.update(side=side, include_zero="true")
    s = admin().ok("GET", "/reports/debt-summary", params=params)
    for it in s["items"]:
        if it["partner_id"] == pid:
            return it
    return None


def mk_voucher(vtype, account_id, partner_id, lines, date=None, note="", c=None):
    b = {"voucher_type": vtype, "voucher_date": date, "account_id": account_id, "partner_id": partner_id,
         "note": note, "lines": lines}
    return (c or admin()).req("POST", "/vouchers", b)


def rnd(qty, price):
    return (num(qty) * num(price)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------- files

def open_xlsx(content):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(content))
    return wb


def open_xlsx_values(content):
    import openpyxl
    return openpyxl.load_workbook(io.BytesIO(content), data_only=True)


def xlsx_cells(wb):
    out = []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if c.value is not None:
                    out.append((ws.title, c.row, c.column, c.value, c.data_type))
    return out


def xlsx_text(wb):
    return "\n".join(str(v) for (_, _, _, v, _) in xlsx_cells(wb))


def xlsx_rows(ws):
    return [[c.value for c in row] for row in ws.iter_rows()]


def xlsx_find_row(ws, value):
    """first row (list of cell objects) that contains a cell equal to value"""
    for row in ws.iter_rows():
        for c in row:
            if c.value == value:
                return row
    return None


def open_docx(content):
    import docx
    return docx.Document(io.BytesIO(content))


def docx_text(d):
    parts = [p.text for p in d.paragraphs]
    for t in d.tables:
        for r in t.rows:
            parts.append(" | ".join(c.text for c in r.cells))
    # headers/footers
    for s in d.sections:
        parts += [p.text for p in s.header.paragraphs]
    return "\n".join(parts)


def is_zip(content):
    try:
        zipfile.ZipFile(io.BytesIO(content)).testzip()
        return True
    except Exception:
        return False


def xlsx_basic_checks(content, label):
    """valid, opens, no sheet/workbook protection. Returns workbook or None."""
    if not check(is_zip(content), f"{label}: not a valid zip/xlsx"):
        return None
    try:
        wb = open_xlsx(content)
    except Exception as e:
        fail(f"{label}: openpyxl cannot open: {e}")
        return None
    for ws in wb.worksheets:
        check(not ws.protection.sheet, f"{label}: sheet {ws.title} is protected")
    sec = wb.security
    check(sec is None or not (sec.lockStructure or sec.lockWindows), f"{label}: workbook structure locked")
    z = zipfile.ZipFile(io.BytesIO(content))
    for n in z.namelist():
        check(not n.startswith("xl/media/"), f"{label}: contains embedded image {n}")
    return wb


def docx_basic_checks(content, label):
    if not check(is_zip(content), f"{label}: not a valid zip/docx"):
        return None
    try:
        d = open_docx(content)
    except Exception as e:
        fail(f"{label}: python-docx cannot open: {e}")
        return None
    z = zipfile.ZipFile(io.BytesIO(content))
    settings = z.read("word/settings.xml").decode("utf-8", "replace") if "word/settings.xml" in z.namelist() else ""
    check("documentProtection" not in settings, f"{label}: docx has documentProtection")
    for n in z.namelist():
        check(not n.startswith("word/media/"), f"{label}: contains embedded media {n}")
    return d


# --------------------------------------------------------------------------- SSE

class SSE:
    """Collects SSE events of a logged in client in a background thread."""

    def __init__(self, client):
        self.events = []
        self.client = client
        self._stop = False
        self.connected = threading.Event()
        self.t = threading.Thread(target=self._run, daemon=True)
        self.t.start()
        self.connected.wait(5)

    def _run(self):
        try:
            r = requests.get(BASE + "/events", headers={"Authorization": "Bearer " + self.client.token,
                                                        "Accept": "text/event-stream"}, stream=True, timeout=(5, 60))
            self.status = r.status_code
            self.connected.set()
            for line in r.iter_lines(decode_unicode=True):
                if self._stop:
                    break
                if line and line.startswith("data:"):
                    try:
                        self.events.append(json.loads(line[5:].strip()))
                    except Exception:
                        self.events.append({"raw": line})
            r.close()
        except Exception as e:  # noqa
            self.error = str(e)
            self.connected.set()

    def wait_for(self, pred, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            for e in list(self.events):
                if pred(e):
                    return e
            time.sleep(0.05)
        return None

    def stop(self):
        self._stop = True
