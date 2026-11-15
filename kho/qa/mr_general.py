"""G — general robustness of the new endpoints: NUL / garbage / huge input, wrong methods, Vietnamese errors,
feature switched off while in use, exports with real numbers."""
import re
import threading

from mr_lib import *

NEW_GETS = ["/features", "/role-permissions", "/period-lock", "/import/products/template", "/reports/low-stock",
            "/reports/debt-aging", "/reports/profit", "/products/sale-price?partner_id=1&ids=1"]


@test("G", "test_G_nul_garbage_and_methods_on_new_endpoints")
def _():
    a = admin()
    c = mk_partner(cust=True)
    p = mk_product(sale=1)
    msgs = []

    def bad(r, label, allowed=(400,)):
        ok = check(r.status in allowed, f"{label}: expected {allowed}, got {r.short()[:250]}")
        if r.json and r.status >= 400:
            msgs.append((label, r.json.get("error", {}).get("message", "")))
        return ok
    # NUL in query params
    for path in ["/reports/debt-aging?q=a%00b", "/reports/debt-aging?as_of=2026-01-01%00", "/reports/profit?group_by=document%00",
                 f"/products/sale-price?partner_id={c['id']}&ids=1%00", "/reports/low-stock?format=xlsx%00",
                 f"/import/products/template?x=%00"]:
        bad(a.req("GET", path), f"NUL in {path}")
    # NUL in JSON bodies
    bad(a.put("/features", {"features": {"min_stock": True}, "x": "\u0000"}), "NUL in features body")
    bad(a.put("/role-permissions", {"matrix": {"thukho": ["stock.write\u0000"]}}), "NUL in permission")
    bad(a.put("/period-lock", {"lock_date": "2024-01-01\u0000", "reason": "x"}), "NUL in lock date")
    bad(a.put(f"/partners/{c['id']}/prices", {"items": [{"product_code": "A\u0000", "price": 1}]}), "NUL in product_code")
    bad(a.put(f"/partners/{c['id']}", {**partner_body(a.ok("GET", f"/partners/{c['id']}")), "credit_limit": "1\u0000"}), "NUL in credit_limit")
    # garbage ids / paths
    for path in ["/partners/abc/prices", "/partners/99999999999999999999/prices", "/partners/-1/prices",
                 f"/partners/{c['id']}/prices/abc", f"/partners/{c['id']}/prices/0"]:
        r = a.get(path) if path.endswith("prices") else a.delete(path)
        bad(r, f"garbage {path}", (400, 404))
    # wrong methods
    for m, path in [("DELETE", "/features"), ("POST", "/features"), ("DELETE", "/period-lock"), ("POST", "/role-permissions"),
                    ("PUT", "/reports/profit"), ("DELETE", "/import/products"), ("GET", "/import/products"),
                    ("POST", "/import/products/template"), ("POST", f"/partners/{c['id']}/prices")]:
        r = a.req(m, path, body={} if m != "GET" else None)
        bad(r, f"{m} {path}", (404, 405))
    # huge JSON body (> 5 MB)
    huge = {"items": [{"product_id": p["id"], "price": 1, "note": "x" * 1000}] * 6000}
    bad(a.put(f"/partners/{c['id']}/prices", huge), "6 MB prices body", (400, 413))
    # very long note but small body
    r = a.put(f"/partners/{c['id']}/prices", {"items": [{"product_id": p["id"], "price": 1, "note": "ư" * 100000}]})
    check(r.status in (200, 400), f"100k-char note -> {r.status}")
    # deep JSON
    deep = {"matrix": {"thukho": ["stock.write"]}}
    cur = deep
    for _ in range(5000):
        cur["x"] = {}
        cur = cur["x"]
    r = a.put("/role-permissions", deep)
    check(r.status < 500, f"deep JSON -> {r.status}")
    restore_matrix()
    # unauthenticated on new endpoints
    anon = Client(None)
    for path in NEW_GETS + [f"/partners/{c['id']}/prices"]:
        eq(anon.req("GET", path).status, 401, f"anon GET {path}")
    r = upload(anon, "products", xlsx_bytes(["Mã hàng"], [["A"]]))
    eq(r.status, 401, "anon import")
    for label, m in msgs:
        check(has_vietnamese(m), f"Vietnamese message for {label}: {m!r}")


@test("G", "test_G_feature_switched_off_while_in_use")
def _():
    a = admin()
    bh = raw_client(user("banhang"))
    kt = raw_client(user("ketoan"))
    stop = [False]
    seen = {"profit": set(), "aging": set(), "import": set(), "prices": set()}
    c = mk_partner(cust=True)
    p = mk_product(sale=5)
    content = xlsx_bytes(["Mã hàng", "Tên hàng", "ĐVT"], [[uid("SW"), "Đang tắt", "Cái"]])

    def hammer():
        while not stop[0]:
            seen["profit"].add(kt.get("/reports/profit").status)
            seen["aging"].add(bh.get("/reports/debt-aging").status)
            seen["import"].add(upload(kt, "products", content, dry=True).status)
            seen["prices"].add(bh.put(f"/partners/{c['id']}/prices", {"items": [{"product_id": p["id"], "price": 3}]}).status)
    ts = [threading.Thread(target=hammer) for _ in range(3)]
    for t in ts:
        t.start()
    try:
        for i in range(6):
            set_features(profit_report=False, credit_limit=False, import_excel=False, price_list=False)
            time.sleep(0.1)
            set_features(profit_report=True, credit_limit=True, import_excel=True, price_list=True)
            time.sleep(0.1)
    finally:
        stop[0] = True
        for t in ts:
            t.join(30)
        all_features_on()
    for k, sts in seen.items():
        check(sts <= {200, 404}, f"{k}: only 200 / 404 FEATURE_OFF while toggling: {sts}")
        check(not any(s >= 500 for s in sts), f"{k}: no 5xx")


@test("G", "test_G_permissions_switched_off_while_masked_user_works")
def _():
    """A masked user keeps reading while admin flips permissions off/on: responses are either masked or (when off) full;
    never a 5xx."""
    bh = raw_client(user("banhang"))
    p = mk_product(sale=10, purchase=424242)
    stop = [False]
    statuses = set()

    def reader():
        while not stop[0]:
            r = bh.get(f"/products/{p['id']}")
            statuses.add(r.status)
    t = threading.Thread(target=reader)
    t.start()
    try:
        for _ in range(4):
            set_features(permissions=False, confirm=True)
            time.sleep(0.05)
            set_features(permissions=True)
            time.sleep(0.05)
    finally:
        stop[0] = True
        t.join(30)
        all_features_on()
    check(statuses <= {200}, f"statuses while toggling permissions: {statuses}")
    eq(user("banhang").ok("GET", f"/products/{p['id']}")["purchase_price"], None, "masked again when back on")


@test("G", "test_G_new_report_exports_are_real_numbers")
def _():
    a = admin()
    for path, params in [("/reports/low-stock", {}), ("/reports/debt-aging", {"as_of": "2023-12-31"}),
                         ("/reports/profit", {"from": "2025-01-01", "to": "2025-01-31", "group_by": "product"}),
                         ("/reports/draft-demand", {})]:
        r = a.get(path, format="xlsx", **params)
        if not check(r.status == 200, f"{path} xlsx -> {r.status}"):
            continue
        wb = xlsx_basic_checks(r.content, f"{path} xlsx")
        if not wb:
            continue
        ws = wb.worksheets[0]
        # numbers must not be stored as text that looks like a number ("1.500.000" / "1500000")
        txt_nums = [c.value for row in ws.iter_rows() for c in row
                    if isinstance(c.value, str) and re.fullmatch(r"-?[\d.,]+", c.value.strip() or "x") and len(c.value) > 2]
        check(not txt_nums, f"{path}: numbers stored as text: {txt_nums[:5]}")
        formulas = [c for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("=")]
        vals = open_xlsx_values(r.content).worksheets[0]
        for f_ in formulas:
            v = vals.cell(f_.row, f_.column).value
            check(isinstance(v, (int, float)), f"{path}: formula {f_.coordinate} {f_.value} has a cached numeric value: {v!r}")
        js = a.ok("GET", path, params=params)
        tot = js.get("totals") or {}
        for k in ("total", "revenue", "cost", "profit"):
            if k in tot and tot[k]:
                nums = xlsx_numbers(r.content)
                check(any(abs(x - float(tot[k])) < 0.01 for x in nums), f"{path}: xlsx total {k}={tot[k]} present")
        # check SUM formula cached values equal the column sums above them
        for f_ in formulas:
            m = re.fullmatch(r"=SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)", f_.value.replace("$", ""))
            if m and m.group(1) == m.group(3):
                col = m.group(1)
                s = 0
                for rr in range(int(m.group(2)), int(m.group(4)) + 1):
                    v = vals[f"{col}{rr}"].value
                    s += v if isinstance(v, (int, float)) else 0
                cached = vals.cell(f_.row, f_.column).value
                check(isinstance(cached, (int, float)) and abs(cached - s) < 0.01, f"{path}: {f_.coordinate} cached {cached} = SUM {s}")
        d = a.get(path, format="docx", **params)
        eq(d.status, 200, f"{path} docx")
        if d.status == 200:
            docx_basic_checks(d.content, f"{path} docx")


@test("G", "test_G_server_5xx_count_so_far")
def _():
    check(len(lib.SERVER_ERRORS) == 0, f"HTTP 5xx seen during the extended suite: {len(lib.SERVER_ERRORS)}: {lib.SERVER_ERRORS[:5]}")
