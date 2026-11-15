"""C1 — cost masking: a user without cost.view must never see purchase prices / costs anywhere
(JSON, errors, history, exports xlsx+docx, dashboard, price-info, SSE), and saving as a masked user must not wipe hidden values."""
from mr_lib import *

_m = {}


def secrets_fixture():
    if _m:
        return _m
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    M = mk_product(sale=2000000, purchase=864197, name="Hàng che giá QA")
    N = mk_product(sale=1000000, purchase=864203, name="Hàng chưa mua QA")
    S = mk_partner(supp=True, pay=777331, name="NCC che giá QA")
    C = mk_partner(cust=True, name="Khách che giá QA")
    op = posted("opening", "2026-03-01", k2, [L(M["id"], 2, 802469)])
    pu = posted("purchase", "2026-03-02", k1, [L(M["id"], 3, 913579)], S["id"])
    pr = posted("purchase_return", "2026-03-05", k1, [L(M["id"], 1, 701359)], S["id"])
    dp = draft("purchase", "2026-03-06", k1, [L(M["id"], 1, 655553)], S["id"])
    sa = posted("sale", "2026-03-10", k1, [L(M["id"], 1, 500000)], C["id"], confirm_loss=True)
    sec = [913579, 864197, 802469, 1604938, 2740737, 701359, 655553, 777331, 864203, 2816709, 869135, 911079,
           # weighted average / cost of the sale line (profit report), and opening+purchase totals
           4345675, 3644316]
    _m.update(k1=k1, k2=k2, M=M, N=N, S=S, C=C, docs=[op, pu, pr, dp, sa], op=op, pu=pu, pr=pr, dp=dp, sa=sa, secrets=sec)
    return _m


def crawl(c):
    """GET every readable endpoint (JSON + exports). Returns list of (label, status, text)."""
    f = secrets_fixture()
    M, N, S, C = f["M"], f["N"], f["S"], f["C"]
    out = []
    gets = [
        ("/auth/me", {}), ("/features", {}), ("/period-lock", {}), ("/settings", {}), ("/warehouses", {}),
        ("/product-groups", {}), ("/products", {"q": M["code"]}), ("/products", {"page_size": 1000}),
        ("/products", {"q": M["code"], "with_stock": "true", "warehouse_id": f["k1"]}),
        (f"/products/{M['id']}", {}), (f"/products/{N['id']}", {}), ("/products/lookup", {"code": M["code"]}),
        ("/products/lookup", {"code": N["code"], "optional": "1"}), (f"/products/{M['id']}/price-info", {}),
        (f"/products/{M['id']}/price-info", {"date": "2026-03-10", "warehouse_id": f["k1"]}),
        (f"/products/{N['id']}/price-info", {}), ("/products/price-info", {"ids": f"{M['id']},{N['id']}", "date": "2026-03-10"}),
        ("/products/sale-price", {"partner_id": C["id"], "ids": f"{M['id']},{N['id']}", "date": "2026-03-10"}),
        ("/partners", {"page_size": 1000}), ("/partners", {"q": S["code"]}), (f"/partners/{S['id']}", {}),
        (f"/partners/{C['id']}", {}), (f"/partners/{S['id']}/balance", {}), (f"/partners/{C['id']}/prices", {}),
        ("/cash-accounts", {}), ("/documents", {}), ("/documents", {"type": "purchase"}),
        ("/documents", {"type": "purchase,sale"}), ("/documents", {"type": "opening"}), ("/documents", {"product_id": M["id"]}),
        ("/documents", {"partner_id": S["id"]}), ("/documents", {"status": "draft"}),
        ("/documents", {"q": f["pu"]["doc_no"]}), ("/documents", {"type": "purchase_return"}),
        ("/vouchers", {}),
        ("/reports/stock-summary", {}), ("/reports/stock-nxt", {"from": "2026-01-01"}),
        ("/reports/stock-ledger", {"product_id": M["id"]}), ("/reports/stock-ledger", {"product_id": M["id"], "warehouse_id": f["k1"]}),
        ("/reports/stock-ledger", {"product_id": M["id"], "warehouse_id": f["k2"], "from": "2026-01-01"}),
        ("/reports/sales", {"from": "2026-01-01", "include_returns": "true"}), ("/reports/purchases", {"from": "2026-01-01"}),
        ("/reports/debt-summary", {"side": "receivable"}), ("/reports/debt-summary", {"side": "payable"}),
        ("/reports/debt-ledger", {"partner_id": S["id"], "side": "payable"}),
        ("/reports/debt-ledger", {"partner_id": S["id"], "side": "receivable"}),
        ("/reports/debt-ledger", {"partner_id": C["id"], "side": "receivable"}),
        ("/reports/cash-book", {}), ("/reports/draft-demand", {}), ("/reports/low-stock", {}),
        ("/reports/debt-aging", {}), ("/reports/profit", {"from": "2026-01-01", "group_by": "document"}),
        ("/reports/profit", {"from": "2026-01-01", "group_by": "product"}),
        ("/reports/profit", {"from": "2026-01-01", "group_by": "customer"}),
        ("/dashboard", {}),
    ]
    for kind in ["products", "partners", "opening_stock", "opening_debt", "partner_prices"]:
        gets.append((f"/import/{kind}/template", {}))
    for d in f["docs"]:
        for sfx in ["", "/check", "/history"]:
            gets.append((f"/documents/{d['id']}{sfx}", {}))
        for fmt in ["xlsx", "docx"]:
            gets.append((f"/documents/{d['id']}/export", {"format": fmt}))
    for path, params in list(gets):
        if path.startswith("/reports/"):
            for fmt in ["xlsx", "docx"]:
                gets.append((path, {**params, "format": fmt}))
    for path, params in gets:
        r = c.req("GET", path, params=params or None)
        txt = file_text(r.content) if r.content[:2] == b"PK" else r.content.decode("utf-8", "replace")
        out.append((f"GET {path} {params}", r.status, txt))
    return out


def masked_hits(c, label):
    f = secrets_fixture()
    leaks = []
    statuses = {}
    for lbl, st, txt in crawl(c):
        statuses[lbl] = st
        h = find_secrets(txt, f["secrets"])
        if h:
            leaks.append(f"{lbl} -> {st}: {h}")
    for l in leaks:
        fail(f"[{label}] cost value leaked: {l}")
    check(True, f"[{label}] crawled {len(statuses)} URLs")
    return statuses


@test("C1", "test_C1_mask_positive_control_admin_sees_costs")
def _():
    """the crawl must be able to detect the secrets (otherwise the masking tests prove nothing)"""
    f = secrets_fixture()
    found = set()
    for lbl, st, txt in crawl(admin()):
        for h in find_secrets(txt, f["secrets"]):
            found.add(h)
    for n in [913579, 864197, 802469, 2740737, 701359, 655553, 777331, 864203]:
        check(any(x in found for x in secret_forms(n)), f"admin crawl should see {n}")


@test("C1", "test_C1_mask_crawl_banhang")
def _():
    st = masked_hits(user("banhang"), "banhang")
    for k, v in st.items():
        check(v < 500, f"banhang {k} -> {v}")


@test("C1", "test_C1_mask_crawl_thukho")
def _():
    st = masked_hits(user("thukho"), "thukho")
    for k, v in st.items():
        check(v < 500, f"thukho {k} -> {v}")


@test("C1", "test_C1_mask_custom_role_with_reports_but_no_cost")
def _():
    """thukho temporarily gets every permission except cost.view (report.view, debt.view, cash.view, catalog, purchase...)"""
    try:
        r = set_matrix({"thukho": [p for p in PERMS if p != "cost.view"]})
        eq(r.status, 200, "custom matrix")
        masked_hits(user("thukho"), "thukho-all-but-cost")
        # purchases / profit / payable must still be forbidden
        tk = user("thukho")
        expect_err(tk.get("/reports/purchases"), 403, "FORBIDDEN", "purchases report without cost.view")
        expect_err(tk.get("/reports/profit"), 403, "FORBIDDEN", "profit without cost.view")
        expect_err(tk.get("/reports/debt-summary", side="payable"), 403, "FORBIDDEN", "payable summary without cost.view")
    finally:
        restore_matrix()


@test("C1", "test_C1_mask_write_responses_errors_and_warnings")
def _():
    f = secrets_fixture()
    M, C = f["M"], f["C"]
    bh = user("banhang")
    sec = f["secrets"]
    # sale below cost: draft response, check endpoints, post -> LOSS_WARNING
    body = doc_body("sale", "2026-03-20", f["k1"], [L(M["id"], 1, 400000)], C["id"])
    r = bh.post("/documents/check", body)
    eq(r.status, 200, "banhang check sale")
    check(not find_secrets(r.content.decode(), sec), f"check response leaks: {r.content[:300]}")
    ll = (r.json or {}).get("loss_lines") or []
    check(len(ll) == 1, "loss line still reported to banhang")
    if ll:
        eq(ll[0].get("cost_price"), None, "loss_lines cost_price null")
    r = bh.post("/documents", body)
    eq(r.status, 201, "banhang creates sale draft")
    d = r.json
    check(not find_secrets(r.content.decode(), sec), f"draft response leaks: {r.content[:400]}")
    w = (d.get("warnings") or [])
    check(len(w) == 1 and w[0].get("type") == "loss", f"loss warning present for banhang: {w}")
    if w:
        eq(w[0].get("cost_price"), None, "warning cost_price null")
        check(not find_secrets(w[0].get("message", ""), sec) and "913" not in w[0].get("message", ""),
              f"warning message has no cost figure: {w[0].get('message')}")
    r = bh.post(f"/documents/{d['id']}/post", {"version": d["version"]})
    expect_err(r, 409, "LOSS_WARNING", "banhang post below cost")
    check(not find_secrets(r.content.decode(), sec), f"LOSS_WARNING leaks: {r.content[:400]}")
    # insufficient stock error payload
    r = bh.post("/documents", doc_body("sale", "2026-03-20", f["k1"], [L(M["id"], 999, 400000)], C["id"]))
    d2 = r.json
    r = bh.post(f"/documents/{d2['id']}/post", {"version": d2["version"], "confirm_loss": True})
    expect_err(r, 422, "INSUFFICIENT_STOCK", "banhang post beyond stock")
    check(not find_secrets(r.content.decode(), sec), f"INSUFFICIENT_STOCK leaks: {r.content[:400]}")
    # version conflict payload on a purchase doc viewed by thukho (custom perms: purchase.write)
    try:
        set_matrix({"thukho": ["stock.write", "purchase.write", "posted.edit"]})
        tk = user("thukho")
        r = tk.put(f"/documents/{f['dp']['id']}", {**put_body_from(get_doc(f["dp"]["id"], tk)), "version": 999})
        eq(r.status, 409, "version conflict")
        check(not find_secrets(r.content.decode(), sec), f"VERSION_CONFLICT leaks: {r.content[:400]}")
        # transfer shortage error (thukho)
        r = tk.post("/documents", doc_body("transfer", "2026-03-21", f["k1"], [L(M["id"], 500)], None, f["k2"]))
        if r.status == 201:
            r2 = tk.post(f"/documents/{r.json['id']}/post", {"version": r.json["version"]})
            eq(r2.status, 422, "transfer shortage")
            check(not find_secrets(r2.content.decode(), sec), f"transfer shortage leaks: {r2.content[:400]}")
        # opening draft created by thukho without price -> server fills purchase price; response masked
        r = tk.post("/documents", doc_body("opening", "2026-03-22", f["k1"], [L(M["id"], 1)]))
        eq(r.status, 201, "thukho opening draft")
        check(not find_secrets(r.content.decode(), sec), f"opening draft response leaks: {r.content[:400]}")
        if r.status == 201:
            eq(r.json["lines"][0].get("unit_price"), None, "opening line unit_price masked")
            eq(r.json.get("total_amount"), None, "opening total masked")
            eq(get_doc(r.json["id"])["lines"][0]["unit_price"], 864197, "server filled default purchase price")
            # dry-run import of opening stock by thukho: result must not reveal prices
            res = upload(tk, "opening_stock", xlsx_bytes(["Mã hàng", "Mã kho", "Số lượng"], [[M["code"], "KHO3", 2]]), date="2026-03-22")
            eq(res.status, 200, "thukho opening_stock dry run")
            check(not find_secrets(res.content.decode(), sec), f"opening_stock dry-run leaks: {res.content[:400]}")
    finally:
        restore_matrix()


@test("C1", "test_C1_mask_sse_events_carry_no_money")
def _():
    f = secrets_fixture()
    bh = user("banhang")
    sse = SSE(bh)
    try:
        d = draft("purchase", "2026-03-25", f["k1"], [L(f["M"]["id"], 1, 913579)], f["S"]["id"])
        post_doc(d)
        set_product(f["M"]["id"], purchase_price=864197)
        time.sleep(0.8)
        evs = json.dumps(sse.events, ensure_ascii=False)
        check(len(sse.events) >= 2, f"SSE events received: {len(sse.events)}")
        check(not find_secrets(evs, f["secrets"]), f"SSE leaks money: {evs[:500]}")
        for e in sse.events:
            for k in ("total_amount", "amount", "unit_price", "purchase_price"):
                check(k not in e, f"SSE event has money field {k}: {e}")
    finally:
        sse.stop()


@test("C1", "test_C1_mask_saving_as_masked_user_keeps_hidden_values")
def _():
    f = secrets_fixture()
    a = admin()
    M, S = f["M"], f["S"]
    try:
        r = set_matrix({"thukho": ["stock.write", "catalog.write", "purchase.write", "posted.edit"]})
        eq(r.status, 200, "thukho gets catalog/purchase/posted.edit but not cost/debt/cash view")
        tk = user("thukho")
        # product
        p = tk.ok("GET", f"/products/{M['id']}")
        eq(p["purchase_price"], None, "masked purchase_price")
        body = {k: p.get(k) for k in ("code", "name", "unit", "group_id", "sale_price", "purchase_price", "is_service", "active", "min_stock")}
        body["name"] = M["name"] + " (sửa bởi thủ kho)"
        r = tk.put(f"/products/{M['id']}", body)
        eq(r.status, 200, "masked PUT product")
        eq(a.ok("GET", f"/products/{M['id']}")["purchase_price"], 864197, "purchase_price kept after masked PUT (null sent)")
        body2 = dict(body)
        body2.pop("purchase_price")
        tk.put(f"/products/{M['id']}", body2)
        eq(a.ok("GET", f"/products/{M['id']}")["purchase_price"], 864197, "purchase_price kept after masked PUT (field omitted)")
        body3 = dict(body, purchase_price=1)
        tk.put(f"/products/{M['id']}", body3)
        eq(a.ok("GET", f"/products/{M['id']}")["purchase_price"], 864197, "blind value from masked user does not overwrite purchase_price")
        r = tk.post("/products", {"code": uid("MK"), "name": "Mới thủ kho", "unit": "Cái", "sale_price": 1, "purchase_price": 5000})
        eq(r.status, 201, "masked POST product")
        if r.status == 201:
            eq(a.ok("GET", f"/products/{r.json['id']}")["purchase_price"], 0, "masked create -> purchase_price 0 (API §8.2)")
        set_product(M["id"], name=M["name"])
        # partner (opening_payable hidden: no cost.view, no debt.view)
        sp = tk.ok("GET", f"/partners/{S['id']}")
        eq(sp.get("opening_payable"), None, "masked opening_payable")
        r = tk.put(f"/partners/{S['id']}", partner_body(sp, address="Địa chỉ mới"))
        eq(r.status, 200, "masked PUT partner")
        eq(a.ok("GET", f"/partners/{S['id']}")["opening_payable"], 777331, "opening_payable kept after masked PUT")
        # cash account
        acc = mk_account("bank", 4242421)
        ta = [x for x in tk.ok("GET", "/cash-accounts")["items"] if x["id"] == acc["id"]][0]
        eq(ta.get("opening_balance"), None, "masked opening_balance")
        r = tk.put(f"/cash-accounts/{acc['id']}", {**ta, "name": "Ngân hàng sửa"})
        eq(r.status, 200, "masked PUT cash account")
        eq([x for x in a.ok("GET", "/cash-accounts")["items"] if x["id"] == acc["id"]][0]["opening_balance"], 4242421,
           "opening_balance kept")
        # draft purchase line with id + null price keeps price
        dp = get_doc(f["dp"]["id"], tk)
        eq(dp["lines"][0]["unit_price"], None, "masked draft line price")
        body = put_body_from(dp)
        body["lines"] = [{"id": dp["lines"][0]["id"], "product_id": M["id"], "qty": 2, "unit_price": None}]
        r = tk.put(f"/documents/{dp['id']}", body)
        eq(r.status, 200, "masked PUT draft purchase")
        ad = get_doc(dp["id"])
        eq(ad["lines"][0]["unit_price"], 655553, "draft line price kept (id + null)")
        eq(ad["lines"][0]["amount"], 1311106, "amount recomputed from kept price")
        # new line without id -> default purchase price
        dp = get_doc(dp["id"], tk)
        body = put_body_from(dp)
        body["lines"] = [{"id": dp["lines"][0]["id"], "product_id": M["id"], "qty": 2, "unit_price": None},
                         {"product_id": M["id"], "qty": 1}]
        r = tk.put(f"/documents/{dp['id']}", body)
        eq(r.status, 200, "masked PUT draft with new line")
        ad = get_doc(dp["id"])
        eq(ad["lines"][1]["unit_price"], 864197, "new line -> default purchase price")
        eq(ad["lines"][0]["unit_price"], 655553, "old line still kept")
        # restore the draft to 1 line @655553 for the crawl
        a.put(f"/documents/{ad['id']}", {**put_body_from(ad), "lines": [L(M["id"], 1, 655553)]})
        f["dp"] = get_doc(ad["id"])
        # posted purchase (Q-02 / P2): a user without cost.view may neither edit nor unpost it -> 403
        pu = posted("purchase", "2026-03-03", f["k1"], [L(M["id"], 3, 913579)], S["id"])
        tp = get_doc(pu["id"], tk)
        body = put_body_from(tp)
        body["lines"] = [{"id": tp["lines"][0]["id"], "product_id": M["id"], "qty": 4, "unit_price": None}]
        expect_err(tk.put(f"/documents/{tp['id']}", body), 403, "FORBIDDEN", "masked PUT posted purchase (P2)")
        expect_err(tk.put(f"/documents/{tp['id']}", put_body_from(tp)), 403, "FORBIDDEN", "masked PUT posted purchase without line ids (P2)")
        expect_err(tk.post(f"/documents/{tp['id']}/unpost", {"version": tp["version"]}), 403, "FORBIDDEN", "masked unpost posted purchase (P2)")
        ap = get_doc(pu["id"])
        eq((ap["lines"][0]["unit_price"], ap["lines"][0]["qty"], ap["version"]), (913579, 3, pu["version"]), "posted purchase untouched")
        u = a.post(f"/documents/{pu['id']}/unpost", {"version": ap["version"]})
        if u.status == 200:
            a.delete(f"/documents/{pu['id']}")
        # explicit price from a masked user on a new purchase
        r = tk.post("/documents", doc_body("purchase", "2026-03-04", f["k1"], [L(M["id"], 1, 1234)], S["id"]))
        eq(r.status, 201, "masked POST purchase with explicit price")
        if r.status == 201:
            check(r.json["lines"][0]["unit_price"] is None, "response masks explicit price")
            # P2: once stored, a line re-sent with its id keeps the stored price whatever price is sent
            stored = get_doc(r.json["id"])["lines"][0]["unit_price"]
            dd = get_doc(r.json["id"], tk)
            for v in [1, 0, None, "999", 5e6]:
                bb = put_body_from(dd)
                bb["lines"] = [{"id": dd["lines"][0]["id"], "product_id": M["id"], "qty": 1, "unit_price": v}]
                rr = tk.put(f"/documents/{dd['id']}", bb)
                eq(rr.status, 200, f"masked PUT draft line id + price {v!r}")
                eq(get_doc(dd["id"])["lines"][0]["unit_price"], stored, f"stored price kept when sending {v!r}")
                dd = get_doc(dd["id"], tk)
            a.delete(f"/documents/{r.json['id']}")
    finally:
        restore_matrix()
