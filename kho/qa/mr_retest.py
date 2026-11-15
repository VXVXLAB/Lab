"""Re-test round after the fixes for M-01..M-10 and rule changes Q-01..Q-12 (QUYET_DINH P1-P13, API §10).
Every expected number below is computed by hand in the docstring/comments (not taken from the builder)."""
import re
import unicodedata

from mr_lib import *

AUG = {"from": "2025-08-01", "to": "2025-08-31"}


def nfd(s):
    return unicodedata.normalize("NFD", s)


def nfc(s):
    return unicodedata.normalize("NFC", s)


def prow(group_by="document", **rng):
    return {it["document_id"]: it for it in profit(group_by=group_by, **(rng or AUG))["items"]}


def cost_of(doc, **rng):
    it = prow(**rng).get(doc["id"]) or {}
    return it.get("cost"), it.get("estimated")


# ====================================================================== C7 moving average (Q-01 / P1)

@test("C7", "test_RT_C7_same_day_inbound_before_outbound")
def _():
    """opening 08-01 10@10 ; on 08-05 a sale of 5 is POSTED FIRST, a purchase 10@40 posted later the same day.
    Inbound first: q20 v500 avg 25 -> sale cost 125 (posting order would give 50)."""
    k1 = wh("KHO1")
    p = mk_product(sale=50, purchase=999)
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    posted("opening", "2025-08-01", k1, [L(p["id"], 10, 10)])
    sa = posted("sale", "2025-08-05", k1, [L(p["id"], 5, 50)], c["id"])
    posted("purchase", "2025-08-05", k1, [L(p["id"], 10, 40)], s["id"])
    eq(cost_of(sa), (125, False), "same-day purchase posted after the sale is still processed first")


@test("C7", "test_RT_C7_backdated_purchase_reprices_later_sale")
def _():
    """08-01 purchase 10@10 ; 08-10 sale 4 -> 40. Then a purchase dated 08-05 10@30 is posted:
    at 08-10 q20 v400 avg 20 -> 80. Unposting it again -> 40."""
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=1)
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    posted("purchase", "2025-08-01", k1, [L(p["id"], 10, 10)], s["id"])
    sa = posted("sale", "2025-08-10", k1, [L(p["id"], 4, 100)], c["id"])
    eq(cost_of(sa)[0], 40, "before the back-dated purchase")
    bp = posted("purchase", "2025-08-05", k1, [L(p["id"], 10, 30)], s["id"])
    eq(cost_of(sa)[0], 80, "back-dated purchase re-prices the later sale")
    bp = get_doc(bp["id"])
    admin().post(f"/documents/{bp['id']}/unpost", {"version": bp["version"]})
    eq(cost_of(sa)[0], 40, "unposting it restores the cost")


@test("C7", "test_RT_C7_supplier_return_value_floor_zero")
def _():
    """08-01 purchase 2@10 (q2 v20) ; 08-02 supplier return 1@50: v = max(0, 20-50) = 0, q1 ;
    08-03 purchase 1@30 (q was 1 > 0): q2 v30 avg 15 ; 08-04 sale 2 -> 30. (Without the floor: v -30+30 = 0 -> cost 0.)"""
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=1)
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    posted("purchase", "2025-08-01", k1, [L(p["id"], 2, 10)], s["id"])
    posted("purchase_return", "2025-08-02", k1, [L(p["id"], 1, 50)], s["id"])
    posted("purchase", "2025-08-03", k1, [L(p["id"], 1, 30)], s["id"])
    sa = posted("sale", "2025-08-04", k1, [L(p["id"], 2, 100)], c["id"])
    eq(cost_of(sa), (30, False), "value floored at 0 after an over-priced supplier return")


@test("C7", "test_RT_C7_customer_return_reenters_at_current_average_and_window")
def _():
    """08-01 purchase 10@10 ; 08-02 sale 5 -> 50 (q5 v50) ; 08-03 purchase 5@40 -> q10 v250 avg 25 ;
    08-04 customer return 1 (of the 08-02 sale) re-enters at 25 (not 10): cost -25, revenue -100 ; q11 v275 ;
    08-05 sale 11 -> 275. A report window starting mid-history (08-04..08-05) must give the same numbers."""
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=1)
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    posted("purchase", "2025-08-01", k1, [L(p["id"], 10, 10)], s["id"])
    s1 = posted("sale", "2025-08-02", k1, [L(p["id"], 5, 100)], c["id"])
    posted("purchase", "2025-08-03", k1, [L(p["id"], 5, 40)], s["id"])
    r1 = posted("sale_return", "2025-08-04", k1, [L(p["id"], 1, 100)], c["id"])
    s2 = posted("sale", "2025-08-05", k1, [L(p["id"], 11, 100)], c["id"])
    full = prow()
    eq(full.get(s1["id"], {}).get("cost"), 50, "first sale")
    eq((full.get(r1["id"], {}).get("revenue"), full.get(r1["id"], {}).get("cost")), (-100, -25), "return at current average 25")
    eq(full.get(s2["id"], {}).get("cost"), 275, "sale after return")
    win = prow(**{"from": "2025-08-04", "to": "2025-08-05"})
    eq(win.get(r1["id"], {}).get("cost"), -25, "window from 08-04: cost still from full history")
    eq(win.get(s2["id"], {}).get("cost"), 275, "window from 08-04: sale cost")
    eq(set(win) & {s1["id"]}, set(), "window excludes the 08-02 sale")
    one = prow(**{"from": "2025-08-05", "to": "2025-08-05"})
    eq(one.get(s2["id"], {}).get("cost"), 275, "single-day window")
    pr = profit(group_by="product", product_id=p["id"], **{"from": "2025-08-04", "to": "2025-08-05"})
    eq((pr["totals"]["revenue"], pr["totals"]["cost"]), (1000, 250), "product grouping in the window: -100+1100, -25+275")


@test("C7", "test_RT_C7_estimated_until_first_inbound")
def _():
    """Stock only from a customer return (08-01, 5 units, never bought, default purchase price 70):
    sale 08-02 of 2 -> estimated (cost 140 at default). Purchase 08-03 3@100. Sale 08-04 of 2 -> NOT estimated."""
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=70)
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    r0 = posted("sale_return", "2025-08-01", k1, [L(p["id"], 5, 100)], c["id"])
    a = posted("sale", "2025-08-02", k1, [L(p["id"], 2, 100)], c["id"])
    posted("purchase", "2025-08-03", k1, [L(p["id"], 3, 100)], s["id"])
    b = posted("sale", "2025-08-04", k1, [L(p["id"], 2, 100)], c["id"])
    rows = prow()
    eq((rows.get(r0["id"], {}).get("cost"), rows.get(r0["id"], {}).get("estimated")), (-350, True), "return before any inbound: default price, estimated")
    eq((rows.get(a["id"], {}).get("cost"), rows.get(a["id"], {}).get("estimated")), (140, True), "sale before any inbound: estimated")
    eq(rows.get(b["id"], {}).get("estimated"), False, "sale after the first purchase: not estimated")
    print(f"      note: sale after first purchase (pool had 3 returned units @70 + 3 @100) costed {rows.get(b['id'], {}).get('cost')} "
          f"(170 if the returned units entered the pool at 70, 200 if they did not)")


@test("C7", "test_RT_C7_service_lines_and_groupings_and_sales_report")
def _():
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=1)
    s, c1, c2 = mk_partner(supp=True), mk_partner(cust=True), mk_partner(cust=True)
    posted("purchase", "2025-08-20", k1, [L(p["id"], 10, 20), {"product_code": "DV", "description": "Cước", "qty": 1, "unit_price": 500}], s["id"])
    posted("sale", "2025-08-21", k1, [L(p["id"], 2, 100), {"product_code": "DV", "description": "Phí", "qty": 1, "unit_price": 30}], c1["id"])
    posted("sale", "2025-08-22", k1, [L(p["id"], 3, 90)], c2["id"])
    reps = {g: profit(group_by=g, **AUG) for g in ("document", "product", "customer")}
    for k in ("revenue", "cost", "profit"):
        vals = {g: num(r["totals"][k]) for g, r in reps.items()}
        check(len(set(vals.values())) == 1, f"Aug: groupings share totals.{k}: {vals}")
    sales = admin().ok("GET", "/reports/sales", params={**AUG, "include_returns": "true"})
    eq(reps["document"]["totals"]["revenue"], sales["total_amount"], "Aug revenue = sales report")
    x = profit(group_by="product", product_id=p["id"], **AUG)["totals"]
    eq((x["revenue"], x["cost"]), (470, 100), "freight DV line on the purchase does not enter the cost: 5 x 20")
    for g in ("document", "product", "customer"):
        whole = profit(group_by=g, **{"from": "2000-01-01", "to": "2100-12-31"})
        eq(sum(num(i["cost"]) for i in whole["items"]), num(whole["totals"]["cost"]), f"whole DB {g}: items sum to total cost")


# ====================================================================== Q-02 / P2 masked price changes

@test("C1", "test_RT_C1_masked_user_every_route_to_change_a_stored_price")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    A = mk_product(sale=10, purchase=111)
    B = mk_product(sale=10, purchase=222)
    S = mk_partner(supp=True)
    try:
        set_matrix({"thukho": ["stock.write", "purchase.write", "posted.edit", "catalog.write"]})
        tk = user("thukho")
        # posted purchase / purchase_return / opening: PUT and unpost forbidden
        posted("opening", "2026-05-01", k1, [L(A["id"], 50, 7)])
        docs = {"purchase": posted("purchase", "2026-05-02", k1, [L(A["id"], 2, 7001)], S["id"]),
                "purchase_return": posted("purchase_return", "2026-05-03", k1, [L(A["id"], 1, 7002)], S["id"]),
                "opening": posted("opening", "2026-05-04", k2, [L(A["id"], 1, 7003)])}
        for t, d in docs.items():
            td = get_doc(d["id"], tk)
            body = put_body_from(td)
            body["lines"] = [{"id": td["lines"][0]["id"], "product_id": A["id"], "qty": td["lines"][0]["qty"], "unit_price": None}]
            expect_err(tk.put(f"/documents/{d['id']}", body), 403, "FORBIDDEN", f"masked PUT posted {t}")
            expect_err(tk.put(f"/documents/{d['id']}", {**body, "note": "chỉ ghi chú"}), 403, "FORBIDDEN", f"masked PUT posted {t} (note only)")
            expect_err(tk.post(f"/documents/{d['id']}/unpost", {"version": td["version"]}), 403, "FORBIDDEN", f"masked unpost posted {t}")
            r = tk.req("PUT", f"/documents/{d['id']}", raw=b'{"lines":"garbage"')
            expect_err(r, 403, "FORBIDDEN", f"masked PUT posted {t} with broken JSON (permission first)")
            r = tk.delete(f"/documents/{d['id']}")
            check(r.status in (400, 403), f"masked DELETE posted {t} -> {r.status}")
            eq(get_doc(d["id"])["version"], d["version"], f"{t} untouched")
        # the same user CAN still post drafts and edit posted transfers
        dr = tk.post("/documents", doc_body("purchase", "2026-05-05", k1, [L(A["id"], 1)], S["id"])).json
        eq(tk.post(f"/documents/{dr['id']}/post", {"version": dr["version"]}).status, 200, "masked user may post a purchase draft")
        tr = posted("transfer", "2026-05-06", k1, [L(A["id"], 1)], None, k2)
        eq(tk.put(f"/documents/{tr['id']}", put_body_from(get_doc(tr["id"], tk), note="sửa")).status, 200, "masked user edits posted transfer")
        # a user WITH cost.view still edits posted purchases (regression)
        d = get_doc(docs["purchase"]["id"])
        eq(user("muahang").put(f"/documents/{d['id']}", put_body_from(d, note="mua hàng sửa")).status, 403, "muahang has no posted.edit by default")
        eq(a.put(f"/documents/{d['id']}", put_body_from(d, note="admin sửa")).status, 200, "admin edits posted purchase")
        # drafts: every way to send a price on a line with its id keeps the stored price
        dd = draft("purchase", "2026-05-07", k1, [L(A["id"], 1, 5555), L(B["id"], 1, 6666)], S["id"])
        ids = [l["id"] for l in dd["lines"]]
        variants = [("null", {"unit_price": None}), ("omitted", {}), ("0", {"unit_price": 0}), ("1", {"unit_price": 1}),
                    ("string", {"unit_price": "9.999"}), ("huge", {"unit_price": 9e9}), ("negative", {"unit_price": -5})]
        for label, extra in variants:
            cur = get_doc(dd["id"], tk)
            body = put_body_from(cur)
            body["lines"] = [{"id": ids[0], "product_id": A["id"], "qty": 3, **extra},
                             {"id": ids[1], "product_id": B["id"], "qty": 1, **extra}]
            r = tk.put(f"/documents/{dd['id']}", body)
            check(r.status in (200, 400), f"price {label} -> {r.status}")
            got = get_doc(dd["id"])
            eq([l["unit_price"] for l in got["lines"]], [5555, 6666], f"stored prices kept when sending {label}")
            if r.status == 200:
                eq(got["lines"][0]["amount"], 3 * 5555, f"{label}: amount = new qty x stored price")
        # swap ids between the two lines (each id now carries the other product) -> product changed -> new lines -> defaults
        cur = get_doc(dd["id"], tk)
        body = put_body_from(cur)
        body["lines"] = [{"id": ids[1], "product_id": A["id"], "qty": 1}, {"id": ids[0], "product_id": B["id"], "qty": 1}]
        r = tk.put(f"/documents/{dd['id']}", body)
        eq(r.status, 200, "swap ids")
        got = get_doc(dd["id"])
        eq([l["unit_price"] for l in got["lines"]], [111, 222], "product changed on an id -> new line at the default price (P2)")
        # reorder lines keeping their own ids -> prices follow the lines
        dd2 = draft("purchase", "2026-05-07", k1, [L(A["id"], 1, 5555), L(B["id"], 1, 6666)], S["id"])
        i2 = [l["id"] for l in dd2["lines"]]
        cur = get_doc(dd2["id"], tk)
        body = put_body_from(cur)
        body["lines"] = [{"id": i2[1], "product_id": B["id"], "qty": 1}, {"id": i2[0], "product_id": A["id"], "qty": 1}]
        tk.put(f"/documents/{dd2['id']}", body)
        got = get_doc(dd2["id"])
        eq([(l["product_id"], l["unit_price"]) for l in got["lines"]], [(B["id"], 6666), (A["id"], 5555)], "reorder keeps prices")
        # duplicate id (second occurrence = new line, API §3.4) must not copy/override the stored price
        cur = get_doc(dd2["id"], tk)
        body = put_body_from(cur)
        body["lines"] = [{"id": i2[0], "product_id": A["id"], "qty": 1, "unit_price": 1},
                         {"id": i2[0], "product_id": A["id"], "qty": 1, "unit_price": 1}]
        tk.put(f"/documents/{dd2['id']}", body)
        got = get_doc(dd2["id"])
        eq(got["lines"][0]["unit_price"], 5555, "duplicate id: first occurrence keeps 5555")
        check(got["lines"][1]["unit_price"] in (5555, 111, 1), "second occurrence")
        print(f"      note: duplicated line id from a masked user -> second line stored at {got['lines'][1]['unit_price']} (sent 1)")
        # id of a line of ANOTHER document -> new line -> default, never that line's price or the sent price
        cur = get_doc(dd2["id"], tk)
        body = put_body_from(cur)
        body["lines"] = [{"id": ids[0], "product_id": A["id"], "qty": 1, "unit_price": 1}]
        tk.put(f"/documents/{dd2['id']}", body)
        fp = get_doc(dd2["id"])["lines"][0]["unit_price"]
        check(fp != 5555, "foreign line id never copies the other document's price")
        print(f"      note: line id of another document + price 1 from a masked user -> stored {fp} (treated as a new line: blind price accepted)")
        # the effective route: drop the line and add a new one with a blind price
        cur = get_doc(dd["id"], tk)
        body = put_body_from(cur)
        body["lines"] = [{"product_id": A["id"], "qty": 1, "unit_price": 1}]
        tk.put(f"/documents/{dd['id']}", body)
        print(f"      note: masked user replaced a draft line (stored 111/5555) by a new line priced 1 -> stored "
              f"{get_doc(dd['id'])['lines'][0]['unit_price']}")
        # explicit price on a NEW line from a masked user (blind entry) - documented behaviour
        r = tk.post("/documents", doc_body("purchase", "2026-05-08", k1, [L(A["id"], 1, 4321)], S["id"]))
        if r.status == 201:
            print(f"      note: masked user's explicit price 4321 on a new purchase line stored as {get_doc(r.json['id'])['lines'][0]['unit_price']}")
        # opening drafts follow the same rule
        od = draft("opening", "2026-05-09", k1, [L(A["id"], 1, 8888)])
        cur = get_doc(od["id"], tk)
        body = put_body_from(cur)
        body["lines"] = [{"id": cur["lines"][0]["id"], "product_id": A["id"], "qty": 2, "unit_price": 1}]
        eq(tk.put(f"/documents/{od['id']}", body).status, 200, "masked PUT opening draft")
        eq(get_doc(od["id"])["lines"][0]["unit_price"], 8888, "opening draft price kept")
        # product purchase_price via catalog and import: unchanged
        tk.put(f"/products/{A['id']}", {**{k: tk.ok("GET", f"/products/{A['id']}")[k] for k in ("code", "name", "unit", "group_id", "sale_price", "is_service", "active")}, "purchase_price": 1})
        eq(a.ok("GET", f"/products/{A['id']}")["purchase_price"], 111, "catalog PUT cannot change purchase_price")
        r = upload(tk, "products", xlsx_bytes(["Mã hàng", "Giá mua"], [[A["code"], 1]]), dry=False)
        eq(r.status, 200, "masked products import")
        check(any("Giá mua" in n for n in (r.json or {}).get("notes") or []), "note: Giá mua ignored (Q-03)")
        eq(a.ok("GET", f"/products/{A['id']}")["purchase_price"], 111, "import cannot change purchase_price")
        # mass route: unposting via changing the doc date / partner of a posted purchase -> still 403
        d = get_doc(docs["purchase"]["id"], tk)
        expect_err(tk.put(f"/documents/{d['id']}", put_body_from(d, doc_date="2026-05-20")), 403, "FORBIDDEN", "move posted purchase date")
    finally:
        restore_matrix()


# ====================================================================== Q-05 / P5 credit-limit concurrency

@test("C8", "test_RT_C8_credit_limit_hammer_concurrent_posts")
def _():
    """limit 1000; 8 concurrent posts of 300 each (DV lines -> no stock locks) for the same customer, no confirm.
    At most 3 can pass (900); the 4th would be 1200 > 1000. Repeated 3 times, plus a cross-customer deadlock probe."""
    a = admin()
    k1 = wh("KHO1")
    for rnd_ in range(3):
        c = mk_partner(cust=True)
        set_partner(c["id"], credit_limit=1000)
        drafts = [draft("sale", "2023-09-01", k1, [{"product_code": "DV", "description": f"Dịch vụ {i}", "qty": 1, "unit_price": 300}], c["id"])
                  for i in range(8)]
        clients = [raw_client(a if i % 2 else user("ketoan")) for i in range(8)]
        res = run_parallel([lambda i=i: clients[i].post(f"/documents/{drafts[i]['id']}/post", {"version": drafts[i]["version"]})
                            for i in range(8)])
        sts = [r.status if not isinstance(r, Exception) else str(r) for r in res]
        check(all(isinstance(s, int) and s < 500 for s in sts), f"round {rnd_}: no 5xx: {sts}")
        ok = sts.count(200)
        eq(ok, 3, f"round {rnd_}: exactly 3 of 8 posts pass the 1000 limit, others CREDIT_WARNING: {sts}")
        eq(receivable(c["id"]), 900, f"round {rnd_}: receivable 900 <= limit")
    # two customers, goods lines in opposite order -> no deadlock / 5xx
    p1, p2 = mk_product(sale=10, purchase=0), mk_product(sale=10, purchase=0)
    posted("opening", "2023-01-01", k1, [L(p1["id"], 1000, 0), L(p2["id"], 1000, 0)])
    cs = [mk_partner(cust=True) for _ in range(2)]
    for c in cs:
        set_partner(c["id"], credit_limit=10 ** 9)
    ds = []
    for i in range(10):
        c = cs[i % 2]
        lines = [L(p1["id"], 1, 10), L(p2["id"], 1, 10)] if i % 2 else [L(p2["id"], 1, 10), L(p1["id"], 1, 10)]
        ds.append(draft("sale", "2023-09-02", k1, lines, c["id"]))
    res = run_parallel([lambda d=d: raw_client(a).post(f"/documents/{d['id']}/post", {"version": d["version"]}) for d in ds])
    sts = [r.status if not isinstance(r, Exception) else str(r) for r in res]
    eq(sts.count(200), 10, f"10 posts for 2 customers with crossing product order all succeed: {sts}")


# ====================================================================== audit / login / lock history

@test("G", "test_RT_audit_api_and_entries")
def _():
    a = admin()
    t0 = a.ok("GET", "/audit", params={"limit": 1})["items"]
    last_id = t0[0]["id"] if t0 else 0

    def new(**params):
        r = a.ok("GET", "/audit", params={"limit": 1000, **params})
        return [x for x in r["items"] if x["id"] > last_id]
    # permissions
    for role in ["ketoan", "banhang", "muahang", "thukho"]:
        expect_err(user(role).get("/audit"), 403, "FORBIDDEN", f"{role} GET /audit")
    eq(Client(None).get("/audit").status, 401, "anon /audit")
    # actions
    set_features(min_stock=False)
    set_features(min_stock=True)
    set_matrix({"thukho": ["stock.write", "sale.write"]})
    restore_matrix()
    set_lock("2020-03-31", reason="Chốt sổ QA lý do riêng")
    clear_lock()
    c = mk_partner(cust=True)
    p = mk_product(sale=1)
    upload(a, "products", xlsx_bytes(["Mã hàng", "Tên hàng", "ĐVT"], [[uid("AU"), "Hàng audit", "Cái"]]), dry=True)
    n_import_before = len(new(entity="import"))
    upload(a, "products", xlsx_bytes(["Mã hàng", "Tên hàng", "ĐVT"], [[uid("AU"), "Hàng audit", "Cái"]]), dry=False)
    a.put(f"/partners/{c['id']}/prices", {"items": [{"product_id": p["id"], "price": 5}]})
    eq(n_import_before, 0, "dry-run import writes no audit row")
    feats = new(entity="features")
    check(len(feats) >= 2, f"features audited: {len(feats)}")
    if feats:
        x = feats[0]
        check(x.get("user_name") and x.get("before") is not None and x.get("after") is not None, f"features row has user/before/after: {x}")
        check("min_stock" in json.dumps(x, ensure_ascii=False), "features row mentions the key")
    rp = new(entity="role_permissions")
    check(len(rp) >= 2, f"role matrix changes audited: {len(rp)}")
    pl = new(entity="period_lock")
    check(len(pl) >= 2, f"lock changes audited: {len(pl)}")
    check(any("Chốt sổ QA lý do riêng" in json.dumps(x, ensure_ascii=False) for x in pl), "lock reason stored in audit")
    imp_ = new(entity="import")
    eq(len(imp_), 1, "one audit row per real import")
    check(len(new(entity="partner_prices")) >= 1, "partner prices audited")
    # period-lock history
    h = a.ok("GET", "/period-lock").get("history") or []
    check(len(h) >= 2 and h[0].get("new_lock_date") is None and h[1].get("new_lock_date") == "2020-03-31",
          f"period-lock history newest first: {h[:2]}")
    if len(h) >= 2:
        eq(h[1].get("reason"), "Chốt sổ QA lý do riêng", "history reason")
        check(h[0].get("user_name"), "history user_name")
    bh_hist = user("banhang").ok("GET", "/period-lock").get("history")
    print(f"      note: non-admin GET /period-lock history visible: {bool(bh_hist)}")
    # filters & params
    r = a.ok("GET", "/audit", params={"entity": "features,period_lock", "limit": 1000})
    check(all(x["entity"] in ("features", "period_lock") for x in r["items"]), "multi-entity filter")
    r = a.ok("GET", "/audit", params={"limit": 2, "offset": 1})
    eq((r["limit"], r["offset"], len(r["items"]) <= 2), (2, 1, True), "limit/offset echoed")
    ids = [x["id"] for x in a.ok("GET", "/audit", params={"limit": 50})["items"]]
    eq(ids, sorted(ids, reverse=True), "newest first")
    for params, label in [({"limit": 0}, "limit 0"), ({"limit": 1001}, "limit 1001"), ({"limit": "x"}, "limit text"),
                          ({"offset": -1}, "negative offset"), ({"from": "abc"}, "bad from"), ({"user_id": "x"}, "bad user_id"),
                          ({"entity": "a%00b"}, "NUL"), ({"from": "2026-02-01", "to": "2026-01-01"}, "to < from (reports: 400)")]:
        r = a.get("/audit", **params) if label != "NUL" else a.req("GET", "/audit?entity=a%00b")
        if label.startswith("to < from") and r.status == 200:
            fail("LOW: GET /audit?from=2026-02-01&to=2026-01-01 -> 200 (every report answers to < from with 400, API §5)")
            continue
        eq(r.status, 400, f"audit {label}")
    r = a.ok("GET", "/audit", params={"from": "2099-01-01"})
    eq(r["items"], [], "future from -> nothing")
    # user / role changes: are they audited? (spec §0 'mọi thay đổi có audit')
    u = mk_user("banhang")
    a.put(f"/users/{u.user['id']}", {"role": "muahang"})
    ua = [x for x in new() if x.get("entity") == "user" or (x.get("entity_id") == u.user["id"] and "role" in json.dumps(x.get("after")))]
    check(len(ua) >= 1, "SPEC §0 'mọi thay đổi có audit': creating a user and changing a user's ROLE leave no audit row "
                        "(privilege changes untraceable)")


@test("C8", "test_RT_audit_credit_confirmation")
def _():
    a = admin()
    k1 = wh("KHO1")
    c = mk_partner(cust=True)
    set_partner(c["id"], credit_limit=1)
    d = draft("sale", "2023-09-05", k1, [{"product_code": "DV", "description": "x", "qty": 1, "unit_price": 50}], c["id"])
    eq(a.post(f"/documents/{d['id']}/post", {"version": d["version"], "confirm_credit": True}).status, 200, "confirmed")
    rows = a.ok("GET", "/audit", params={"entity": "document", "entity_id": d["id"], "limit": 100})["items"]
    acts = [x["action"] for x in rows]
    check(any("credit" in x for x in acts), f"credit confirmation in /audit: {acts}")
    cr = [x for x in rows if "credit" in x["action"]]
    if cr:
        txt = json.dumps(cr[0], ensure_ascii=False)
        check("50" in txt and cr[0].get("user_name"), f"credit audit row has figures and user: {txt[:300]}")


@test("C1", "test_RT_login_returns_permissions_and_features")
def _():
    u = mk_user("banhang")
    r = requests.post(lib.BASE + "/auth/login", json={"username": u.user["username"], "password": "123456"})
    eq(r.status_code, 200, "login")
    j = r.json()
    eq(sorted(j.get("permissions") or []), sorted(DEFAULT_MATRIX["banhang"]), "login permissions")
    eq(sorted((j.get("features") or {}).keys()), sorted(ALL_KEYS), "login features")
    eq(j.get("user", {}).get("role"), "banhang", "login user")
    check("password" not in json.dumps(j) and "password_hash" not in json.dumps(j), "no password fields")


# ====================================================================== M-09 / P7 NFC

@test("C3", "test_RT_nfc_everywhere")
def _():
    a = admin()
    code = "HÀN" + uid("N")
    # NFD code via JSON (raw UTF-8 and \\u escapes)
    r = a.post("/products", {"code": nfd(code), "name": nfd("Que hàn điện Việt"), "unit": nfd("Hộp"), "sale_price": 1})
    eq(r.status, 201, "NFD product via JSON")
    if r.status == 201:
        eq(r.json["code"], code, "code stored NFC")
        eq(r.json["name"], nfc("Que hàn điện Việt"), "name stored NFC")
        eq(r.json["unit"], "Hộp", "unit stored NFC")
    r2 = a.req("POST", "/products", raw=json.dumps({"code": nfd(code), "name": "x", "unit": "c"}, ensure_ascii=True).encode(),
               headers={"Content-Type": "application/json"})
    eq(r2.status, 400, "same code again in NFD via \\u escapes -> duplicate")
    eq(a.post("/products", {"code": code, "name": "x", "unit": "c"}).status, 400, "same code in NFC -> duplicate")
    eq(a.get("/products/lookup", code=nfd(code)).status, 200, "lookup with NFD code (query string)")
    eq(a.get("/products/lookup", code=nfd(code.lower())).status, 200, "lookup NFD lower-case")
    found = a.ok("GET", "/products", params={"q": nfd("hàn điện")})["items"]
    check(any(x["code"] == code for x in found), "search q in NFD")
    found = a.ok("GET", "/products", params={"q": "han dien viet"})["items"]
    check(any(x["code"] == code for x in found), "search without accents")
    # documents / notes
    k1 = wh("KHO1")
    c = a.post("/partners", {"code": uid("NP"), "name": nfd("Khách Đông Hưng"), "is_customer": True}).json
    d = a.post("/documents", doc_body("sale", "2026-06-01", k1, [{"product_code": nfd(code), "qty": 1, "unit_price": 1, "note": nfd("ghi chú")}],
                                      c["id"], note=nfd("Giao hàng tận nơi"))).json
    eq(d["note"], nfc("Giao hàng tận nơi"), "document note NFC")
    eq(d["lines"][0]["note"], nfc("ghi chú"), "line note NFC")
    lst = a.ok("GET", "/documents", params={"q": nfd("tận nơi")})["items"]
    check(any(x["id"] == d["id"] for x in lst), "document q NFD finds note")
    lst = a.ok("GET", "/partners", params={"q": "dong hung"})["items"]
    check(any(x["id"] == c["id"] for x in lst), "partner NFD name searchable without accents")
    # import: NFD code equal to an existing NFC code -> update, not a new product
    r = upload(a, "products", xlsx_bytes(["Mã hàng", "Giá bán"], [[nfd(code), 77]]), dry=True)
    eq((import_result(r).get("creates"), import_result(r).get("updates")), (0, 1), "import NFD code = existing NFC code -> update")
    # users: NFD username / password still log in, in either form
    un = "lân" + uid("u").lower()
    pw = "mậtkhẩuQA1"
    r = a.post("/users", {"username": nfd(un), "password": nfd(pw), "full_name": nfd("Nguyễn Thị Lân"), "role": "ketoan"})
    eq(r.status, 201, "create user with NFD username/password")
    for uu, pp, label in [(un, pw, "NFC/NFC"), (nfd(un), nfd(pw), "NFD/NFD"), (nfd(un), pw, "NFD/NFC"), (un, nfd(pw), "NFC/NFD"),
                          (un.upper(), pw, "upper username")]:
        rr = requests.post(lib.BASE + "/auth/login", json={"username": uu, "password": pp})
        eq(rr.status_code, 200, f"login {label}")
    lg = requests.post(lib.BASE + "/auth/login", json={"username": un, "password": pw}).cookies.get("session")
    cl = Client(lg, "lan")
    eq(cl.post("/auth/change-password", {"old_password": nfd(pw), "new_password": nfd("mớiQA123")}).status, 200, "change password NFD")
    eq(requests.post(lib.BASE + "/auth/login", json={"username": un, "password": "mớiQA123"}).status_code, 200, "login with new NFC password")
    eq(a.post("/users", {"username": un, "password": "123456", "full_name": "x"}).status, 400, "NFC duplicate of an NFD-created username")
    # NUL still rejected after normalisation; combining marks alone
    eq(a.post("/products", {"code": "A\u0000̀", "name": "x", "unit": "c"}).status, 400, "NUL + combining mark")
    r = a.post("/products", {"code": "̀́", "name": "chỉ dấu", "unit": "c"})
    check(r.status in (201, 400), f"code made of combining marks only -> {r.status}")
    # Excel import with the NFD partner created earlier is still the same record
    r = upload(a, "opening_debt", xlsx_bytes(["Mã đối tác", "Phải thu"], [[nfd(c["code"]), 5]]), dry=True)
    eq(import_result(r).get("errors"), [], "opening_debt finds partner by NFD code")


# ====================================================================== the M-fixes, adversarially

@test("C8", "test_RT_M01_no_debt_figures_anywhere_without_debt_view")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=10, purchase=6543210)
    posted("opening", "2023-01-01", k1, [L(p["id"], 10, 6543210)])
    c = mk_partner(cust=True, rec=4433221)
    set_partner(c["id"], credit_limit=1234567)
    sec = [4433221, 1234567, 6543210]
    try:
        set_matrix({"thukho": ["sale.write", "posted.edit"]})
        tk = user("thukho")
        d = tk.post("/documents", doc_body("sale", "2023-10-01", k1, [L(p["id"], 1, 9)], c["id"])).json
        r = tk.post(f"/documents/{d['id']}/post", {"version": d["version"]})
        expect_err(r, 409, "CREDIT_WARNING", "credit+loss for thukho")
        txt = r.content.decode()
        check(not find_secrets(txt, sec + [4433230, 3198663]), f"no debt/cost figures for thukho: {txt[:400]}")
        r = tk.post(f"/documents/{d['id']}/post", {"version": d["version"], "confirm_credit": True, "confirm_loss": True})
        eq(r.status, 200, "post with both flags")
        # edit path upward
        d = get_doc(d["id"], tk)
        r = tk.put(f"/documents/{d['id']}", {**put_body_from(d, lines=[L(p["id"], 2, 9)]), "confirm_loss": True})
        expect_err(r, 409, "CREDIT_WARNING", "edit upward by thukho")
        check(not find_secrets(r.content.decode(), sec + [4433230, 4433239]), f"edit-path message masked: {r.content[:300]}")
        check(not re.search(r"\d\.\d{3}", r.json["error"]["message"]), f"no formatted numbers: {r.json['error']['message']}")
    finally:
        restore_matrix()
    # banhang (debt.view, no cost.view): debt figures shown, cost not
    bh = user("banhang")
    d = bh.post("/documents", doc_body("sale", "2023-10-02", k1, [L(p["id"], 1, 9)], c["id"])).json
    r = bh.post(f"/documents/{d['id']}/post", {"version": d["version"]})
    if expect_err(r, 409, "CREDIT_WARNING", "banhang"):
        check("4.433.2" in r.json["error"]["message"], f"banhang sees the debt: {r.json['error']['message']}")
        check(not find_secrets(r.content.decode(), [6543210]), "banhang does not see the cost")


@test("C4", "test_RT_M02_M03_M07_variants")
def _():
    a = admin()
    pz = mk_partner(cust=True, supp=True, pay=300)          # payable only
    p0 = mk_partner(cust=True)                               # zero
    pr = mk_partner(cust=True, rec="0.004")                  # rounds to 0
    a0 = mk_account("cash", 0)
    a1 = mk_account("cash", 0)
    ab = mk_account("bank", 50)
    x1 = mk_partner(cust=True, rec=1000)
    try:
        set_lock("2024-06-30")
        expect_err(a.delete(f"/partners/{pz['id']}"), 422, "PERIOD_LOCKED", "delete partner with opening payable only")
        eq(a.delete(f"/partners/{p0['id']}").status, 200, "delete partner with zero openings")
        eq(a.delete(f"/partners/{pr['id']}").status, 200, "delete partner whose opening rounded to 0")
        eq(a.delete(f"/cash-accounts/{a0['id']}").status, 200, "delete account with zero opening")
        eq(a.put(f"/cash-accounts/{a1['id']}", {**a1, "kind": "bank"}).status, 200, "kind change with zero opening")
        expect_err(a.put(f"/cash-accounts/{ab['id']}", {**ab, "kind": "cash"}), 422, "PERIOD_LOCKED", "bank -> cash with opening")
        eq(set_partner(pz["id"], active=False).status, 200, "deactivating is not a figure change")
        pp = a.ok("GET", f"/partners/{x1['id']}")
        for v, st in [("999.995", 200), ("1000.005", 422), ("1000.0049", 200), (" 1000 ", None)]:
            r = a.put(f"/partners/{x1['id']}", partner_body(pp, opening_receivable=v))
            if st:
                eq(r.status, st, f"opening {v!r}")
            else:
                check(r.status in (200, 400), f"opening {v!r} -> {r.status}")
        eq(a.ok("GET", f"/partners/{x1['id']}")["opening_receivable"], 1000, "unchanged")
        # feature off -> no lock
        set_features(period_lock=False)
        eq(a.delete(f"/partners/{pz['id']}").status, 200, "lock feature off -> delete allowed")
    finally:
        all_features_on()
        clear_lock()


@test("C6", "test_RT_M04_M10_variants")
def _():
    a = admin()
    K = mk_partner(cust=True)
    P, P2 = mk_product(sale=1), mk_product(sale=2)
    base = f"/partners/{K['id']}/prices"
    a.put(base, {"items": [{"product_id": P["id"], "price": 1}, {"product_id": P2["id"], "price": 2}]})
    eq(a.put(base, {"items": [], "replace": False}).status in (200, 400), True, "replace false + []")
    eq(len(a.ok("GET", base)["items"]), 2, "replace false + [] keeps everything")
    expect_err(user("thukho").put(base, {"items": [], "replace": True}), 403, "FORBIDDEN", "thukho cannot wipe the price list")
    eq(a.put(base, {"items": [], "replace": True}).status, 200, "replace []")
    eq(a.ok("GET", base)["items"], [], "replace [] wipes")
    r = a.get("/products/sale-price", partner_id=K["id"], ids=f"{P['id']},999999,888888")
    expect_err(r, 404, "NOT_FOUND", "sale-price missing ids")
    eq(sorted((r.details or {}).get("missing_ids") or []), [888888, 999999], "missing_ids lists both")
    r = a.get("/products/sale-price", partner_id=K["id"], ids=f"{P['id']},{P['id']}")
    eq(r.status, 200, "duplicate ids")
    if r.status == 200 and len(r.json["items"]) != 1:
        print(f"      note: sale-price returns duplicate ids twice ({len(r.json['items'])} items); price-info collapses them")


@test("F", "test_RT_M06_feature_values_strict")
def _():
    for v in [None, "true", 1, 0, "false", [], {}]:
        r = set_features(permissions=v)
        if expect_err(r, 400, "VALIDATION", f"permissions={v!r}"):
            eq((r.details or {}).get("field"), "features.permissions", "details.field")
    eq(features()["features"]["permissions"], True, "still on")
    r = admin().put("/features", {"features": {"permissions": None}, "confirm": True})
    eq(r.status, 400, "null with confirm still 400")


@test("C1", "test_RT_M05_permission_before_body_everywhere")
def _():
    bh = user("banhang")
    pd = draft("purchase", "2026-06-02", wh("KHO1"), [], mk_partner(supp=True)["id"])
    # (syntactically broken JSON cannot reveal doc_type -> 400 is acceptable; only well-formed JSON with wrong types here)
    for m, path, raw in [("POST", "/documents", b'{"warehouse_id":1,"doc_type":"purchase","lines":"x"}'),
                         ("PUT", f"/documents/{pd['id']}", b'{"version":"x"}'),
                         ("POST", f"/documents/{pd['id']}/post", b'{"version":[1]}'),
                         ("POST", "/documents/check", b'{"doc_type":"purchase","lines":[{"qty":"abc"}]}'),
                         ("POST", "/documents/check", b'{"id":' + str(pd["id"]).encode() + b',"doc_type":"sale"}')]:
        r = bh.req(m, path, raw=raw, headers={"Content-Type": "application/json"})
        expect_err(r, 403, "FORBIDDEN", f"banhang {m} {path} {raw[:40]!r}")
    # the trick: doc_type key duplicated - first sale, then purchase
    r = bh.req("POST", "/documents", raw=b'{"doc_type":"sale","doc_type":"purchase","warehouse_id":1,"partner_id":null,"lines":[]}',
               headers={"Content-Type": "application/json"})
    check(r.status in (400, 403), f"duplicated doc_type key -> {r.short()[:200]}")
    if r.status == 201:
        fail(f"banhang created a {r.json.get('doc_type')} via a duplicated doc_type key")


@test("C3", "test_RT_Q06_Q08_Q11_Q12_import_and_masking_rules")
def _():
    a = admin()
    hdr = ["Mã hàng", "Tên hàng", "ĐVT", "Giá bán"]
    cases = {"2.5": False, "1.25": False, "12.50": False, "1.250": 1250, "2,5": 2.5, "1.250,5": 1250.5, "10.000.000": 10000000}
    for v, want in cases.items():
        code = uid("Q6")
        r = upload(a, "products", xlsx_bytes(hdr, [[code, "Q6", "Cái", v]]), dry=False)
        if want is False:
            eq(r.status, 422, f"text {v!r} -> row error")
            if r.status == 422:
                check("phẩy" in errs_text(import_result(r)) or "dấu" in errs_text(import_result(r)), f"message explains the decimal comma: {errs_text(import_result(r))[:200]}")
        else:
            eq(r.status, 200, f"text {v!r} accepted")
            p = admin().get("/products/lookup", code=code).json
            eq(p and p["sale_price"], want, f"text {v!r} value")
    code = uid("Q6")
    r = upload(a, "products", xlsx_bytes(hdr, [[code, "ô số", "Cái", 2.5]]), dry=False)
    eq(r.status, 200, "numeric cell 2.5 fine")
    eq(admin().get("/products/lookup", code=code).json["sale_price"], 2.5, "numeric 2.5")
    # template guide mentions the rule
    wb = open_xlsx(a.get("/import/products/template").content)
    g = "\n".join(str(c.value) for row in wb["Hướng dẫn"].iter_rows() for c in row if c.value) if "Hướng dẫn" in wb.sheetnames else ""
    check("1.25" in g or "2.5" in g or "dấu phẩy" in g, "guide sheet explains the decimal rule")
    # Q-11 duplicate header (also with accent/case variants)
    for h in (["Mã hàng", "Giá bán", "gia ban"], ["Mã hàng", "MÃ HÀNG*"]):
        r = upload(a, "products", xlsx_bytes(h, [["A"] * len(h)]), dry=True)
        eq(r.status, 400, f"duplicate header {h}")
    # Q-08 notes on re-import same date
    p = mk_product(purchase=1)
    f = xlsx_bytes(["Mã hàng", "Mã kho", "Số lượng"], [[p["code"], "KHO4", 1]])
    r1 = upload(a, "opening_stock", f, dry=False, date="2026-10-28")
    r2 = upload(a, "opening_stock", f, dry=True, date="2026-10-28")
    r3 = upload(a, "opening_stock", f, dry=True, date="2026-10-29")
    check(bool((r2.json or {}).get("notes")), f"same date -> warning note: {(r2.json or {}).get('notes')}")
    print(f"      note: other date -> notes {(r3.json or {}).get('notes')}")
    for d in (r1.json or {}).get("documents") or []:
        a.delete(f"/documents/{d['id']}")
    # Q-12 cost_source masked (single and batch)
    k1 = wh("KHO1")
    pp = mk_product(sale=1, purchase=5)
    posted("purchase", "2026-06-03", k1, [L(pp["id"], 1, 5)], mk_partner(supp=True)["id"])
    for role in ("banhang", "thukho"):
        j = user(role).ok("GET", f"/products/{pp['id']}/price-info")
        eq(j.get("cost_source"), None, f"{role} cost_source null")
        jb = user(role).ok("GET", "/products/price-info", params={"ids": pp["id"]})
        eq(jb["items"][0].get("cost_source"), None, f"{role} batch cost_source null")
    eq(user("muahang").ok("GET", f"/products/{pp['id']}/price-info")["cost_source"], "last_purchase", "muahang sees cost_source")
