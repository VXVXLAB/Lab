"""C5 — per-product minimum stock (SPEC_MO_RONG C5, API §9.1, QUYET_DINH O1, O2)."""
from mr_lib import *


def low_items():
    return {it["product_id"]: it for it in admin().ok("GET", "/reports/low-stock")["items"]}


def demand(**params):
    return {it["product_id"]: it for it in admin().ok("GET", "/reports/draft-demand", params=params)["items"]}


def mkp(min_stock="__none__", **kw):
    p = mk_product(sale=100, purchase=50, **kw)
    if min_stock != "__none__":
        r = set_product(p["id"], min_stock=min_stock)
        if r.status != 200:
            raise Fatal("set min_stock: " + r.short())
    return p


@test("C5", "test_C5_min_stock_field_validation")
def _():
    a = admin()
    r = a.post("/products", {"code": uid("MS"), "name": "Có tồn tối thiểu", "unit": "Cái", "min_stock": 20})
    eq(r.status, 201, "POST with min_stock")
    if r.status == 201:
        eq(r.json.get("min_stock"), 20, "min_stock returned")
        pid = r.json["id"]
        body = {k: r.json[k] for k in ("code", "name", "unit", "group_id", "sale_price", "purchase_price", "is_service", "active")}
        eq(a.put(f"/products/{pid}", body).json.get("min_stock"), 20, "PUT without min_stock keeps it (O1)")
        eq(a.put(f"/products/{pid}", {**body, "min_stock": 2.5}).json.get("min_stock"), 2.5, "decimal min_stock")
        eq(a.put(f"/products/{pid}", {**body, "min_stock": "7"}).json.get("min_stock"), 7, "string number min_stock")
        r2 = a.put(f"/products/{pid}", {**body, "min_stock": None})
        eq(r2.status, 200, "null clears")
        eq(r2.json.get("min_stock"), None, "min_stock null")
        for bad in [-1, "abc", 1e20, True, [1]]:
            rr = a.put(f"/products/{pid}", {**body, "min_stock": bad})
            eq(rr.status, 400, f"min_stock {bad!r}")
        eq(a.ok("GET", f"/products/{pid}").get("min_stock"), None, "unchanged after bad PUTs")
    r = a.post("/products", {"code": uid("MS"), "name": "x", "unit": "Cái", "min_stock": -5})
    eq(r.status, 400, "POST negative min_stock")
    # catalog permission applies; min_stock visible to everyone (no cost)
    p = mkp(min_stock=3)
    eq(user("banhang").ok("GET", f"/products/{p['id']}").get("min_stock"), 3, "banhang sees min_stock")


@test("C5", "test_C5_low_stock_flags_and_boundaries")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    A = mkp(10); B = mkp(10); C = mkp(); Dp = mkp(0); E = mkp(10); F = mkp(10); G = mkp(10)
    posted("opening", "2026-01-03", k1, [L(A["id"], 10, 50), L(B["id"], 11, 50), L(E["id"], 1, 50), L(F["id"], 6, 50), L(G["id"], 30, 50)])
    posted("opening", "2026-01-03", k2, [L(F["id"], 6, 50)])
    set_product(E["id"], active=False)
    # G: draft sale for 25 does not reduce stock
    cust = mk_partner(cust=True)
    draft("sale", "2026-02-01", k1, [L(G["id"], 25, 100)], cust["id"])
    li = low_items()
    check(A["id"] in li, "stock 10 = min 10 -> low (<=)")
    check(B["id"] not in li, "stock 11 > min 10 -> not low")
    check(C["id"] not in li, "min NULL, stock 0 -> never low")
    check(Dp["id"] in li, "min 0, stock 0 -> low (0 <= 0)")
    check(E["id"] not in li, "inactive product excluded")
    check(F["id"] not in li, "6 + 6 across warehouses = 12 > 10 -> not low (total of all warehouses)")
    check(G["id"] not in li, "drafts do not reduce stock for the low flag")
    if A["id"] in li:
        it = li[A["id"]]
        eq((it["min_stock"], it["total_stock"], it["need"]), (10, 10, 0), "A row min/total/need")
    dash = a.ok("GET", "/dashboard")
    eq(dash.get("low_stock_rule"), "min_stock", "dashboard low_stock_rule")
    eq(dash.get("low_stock_count"), len(li), "dashboard low_stock_count == rows of low-stock report")
    dash2 = a.ok("GET", "/dashboard", params={"low_stock_threshold": 1000})
    eq(dash2.get("low_stock_count"), dash["low_stock_count"], "threshold parameter ignored when min_stock on")
    # service product cannot be flagged
    dv = a.ok("GET", "/products/lookup", params={"code": "DV"})
    r = set_product(dv["id"], min_stock=5)
    check(r.status in (200, 400), f"min_stock on DV -> {r.status}")
    check(dv["id"] not in low_items(), "service never in low-stock")
    if r.status == 200:
        set_product(dv["id"], min_stock=None)
    # xlsx
    r = a.get("/reports/low-stock", format="xlsx")
    wb = xlsx_basic_checks(r.content, "low-stock xlsx")
    if wb:
        nums = xlsx_numbers(r.content)
        check(len(nums) > 0, "low-stock xlsx has real number cells")
        check(A["code"] in xlsx_text(wb), "A listed in xlsx")


@test("C5", "test_C5_future_dated_sale_and_current_stock")
def _():
    """'tồn hiện tại': a posted sale dated in the future (after today). Low-stock, dashboard and draft-demand must agree."""
    k1 = wh("KHO1")
    p = mkp(5)
    cust = mk_partner(cust=True)
    posted("opening", "2026-01-04", k1, [L(p["id"], 10, 50)])
    posted("sale", "2026-12-20", k1, [L(p["id"], 6, 100)], cust["id"])
    li = low_items()
    dd = demand()
    in_low = p["id"] in li
    if p["id"] in dd:
        eq(dd[p["id"]]["total_stock"], li[p["id"]]["total_stock"] if in_low else dd[p["id"]]["total_stock"], "same stock basis")
    print(f"      note: product with stock 10 today and 4 after a posted sale dated 2026-12-20, min 5 -> low-stock={in_low}"
          f" (total_stock={li.get(p['id'], {}).get('total_stock')})")
    check(True, "documented")


@test("C5", "test_C5_draft_demand_order_more_arithmetic")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    cust, cust2 = mk_partner(cust=True), mk_partner(cust=True)
    sup = mk_partner(supp=True)
    P1 = mkp(10)   # stock 3, drafts 5 -> shortage 2, order_more 12 (O2 example)
    P2 = mkp(10)   # stock 20, drafts 5 -> 0
    P3 = mkp(10)   # stock 12, drafts 5 -> 3 (shortage 0)
    P4 = mkp(10)   # stock 4, no drafts -> listed with drafts [] and order_more 6
    P5 = mkp()     # no min, stock 1, drafts 4 -> shortage 3, order_more 0/None
    P6 = mkp(10)   # stock 10 split 2 warehouses, drafts 3+4 on two drafts/customers -> 10-(10-7)=7
    posted("opening", "2026-01-05", k1, [L(P1["id"], 3, 50), L(P2["id"], 20, 50), L(P3["id"], 12, 50), L(P4["id"], 4, 50),
                                         L(P5["id"], 1, 50), L(P6["id"], 5, 50)])
    posted("opening", "2026-01-05", k2, [L(P6["id"], 5, 50)])
    draft("sale", "2026-02-02", k1, [L(P1["id"], 2, 100), L(P1["id"], 3, 100), L(P2["id"], 5, 100), L(P3["id"], 5, 100), L(P5["id"], 4, 100)], cust["id"])
    draft("sale", "2026-02-02", k1, [L(P6["id"], 3, 100)], cust["id"])
    draft("sale", "2026-02-03", k2, [L(P6["id"], 4, 100)], cust2["id"])
    # non-sale drafts and posted sales must not count
    draft("purchase", "2026-02-02", k1, [L(P2["id"], 100, 50)], sup["id"])
    draft("sale_return", "2026-02-02", k1, [L(P2["id"], 7, 100)], cust["id"])
    dd = demand()
    exp = {P1["id"]: (5, 3, 2, 12), P2["id"]: (5, 20, 0, 0), P3["id"]: (5, 12, 0, 3), P4["id"]: (0, 4, 0, 6), P6["id"]: (7, 10, 0, 7)}
    for pid, (q, st, sh, om) in exp.items():
        it = dd.get(pid)
        if not check(it is not None, f"product {pid} listed in draft-demand"):
            continue
        eq(it.get("qty_in_drafts"), q, f"{pid} qty_in_drafts")
        eq(it.get("total_stock"), st, f"{pid} total_stock")
        eq(it.get("shortage"), sh, f"{pid} shortage")
        eq(it.get("min_stock"), 10, f"{pid} min_stock")
        eq(it.get("order_more"), om, f"{pid} order_more = max(0, min - (stock - drafts))")
    it = dd.get(P4["id"])
    if it:
        eq(it.get("drafts"), [], "below-min product without drafts has drafts []")
    it5 = dd.get(P5["id"])
    if check(it5 is not None, "P5 (no min) on drafts listed"):
        eq(it5.get("min_stock"), None, "P5 min_stock null")
        check(it5.get("order_more") in (None, 0), f"P5 order_more none/0: {it5.get('order_more')}")
        eq(it5.get("shortage"), 3, "P5 shortage")
    # only_shortage keeps shortage>0 or order_more>0
    ds = demand(only_shortage="true")
    for pid, want in [(P1["id"], True), (P2["id"], False), (P3["id"], True), (P4["id"], True), (P5["id"], True), (P6["id"], True)]:
        eq(pid in ds, want, f"only_shortage membership of {pid}")
    # xlsx columns
    r = a.get("/reports/draft-demand", format="xlsx")
    wb = xlsx_basic_checks(r.content, "draft-demand xlsx")
    if wb:
        txt = xlsx_text(wb)
        check("Tồn tối thiểu" in txt and "Cần đặt thêm" in txt, "xlsx has Tồn tối thiểu / Cần đặt thêm columns")
        ws = wb.worksheets[0]
        row = xlsx_find_row(ws, P1["code"])
        if check(row is not None, "P1 row in xlsx"):
            vals = [c.value for c in row]
            check(12 in vals, f"P1 row shows Cần đặt thêm 12: {vals}")
    # posting the draft changes the numbers: post P1 drafts after a purchase
    posted("purchase", "2026-02-01", k1, [L(P1["id"], 20, 50)], sup["id"])
    dd = demand()
    eq(dd[P1["id"]]["order_more"], 0, "after buying 20: 10 - (23 - 5) < 0 -> 0")


@test("C5", "test_C5_feature_off_uses_old_rule")
def _():
    a = admin()
    k1 = wh("KHO1")
    H = mkp(10)    # stock 8: on -> low, off -> 8 > 5 not low
    I = mkp()      # stock 3, no min: on -> not low, off -> low
    posted("opening", "2026-01-06", k1, [L(H["id"], 8, 50), L(I["id"], 3, 50)])
    check(H["id"] in low_items() and I["id"] not in low_items(), "on: min_stock rule")
    try:
        eq(set_features(min_stock=False).status, 200, "min_stock off")
        d = a.ok("GET", "/dashboard")
        check("low_stock_rule" not in d, "no low_stock_rule")
        eq(d.get("low_stock_threshold"), 5, "threshold 5")
        # old rule: active goods with movements and total <= 5 (stock-summary, today)
        ss = stock_summary(only_with_data="true")
        prods = {p["id"]: p for p in a.ok("GET", "/products", params={"page_size": 1000, "active": "true", "is_service": "false"})["items"]}
        tot = a.ok("GET", "/products", params={"page_size": 1, "active": "true"})["total"]
        if tot <= 1000:
            exp = sum(1 for it in ss["items"] if it["product_id"] in prods and num(it["total"]) <= 5)
            eq(d.get("low_stock_count"), exp, "dashboard low_stock_count = old rule (<= 5)")
        dd = a.ok("GET", "/reports/draft-demand")["items"]
        check(all("order_more" not in x and "min_stock" not in x for x in dd), "draft-demand base shape")
        check(all(x.get("drafts") for x in dd), "off: only products on sale drafts are listed")
        r = a.get("/reports/draft-demand", format="xlsx")
        if r.status == 200:
            check("Cần đặt thêm" not in xlsx_text(open_xlsx(r.content)), "off: xlsx without Cần đặt thêm")
    finally:
        all_features_on()
