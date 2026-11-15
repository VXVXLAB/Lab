"""C9 — stocktake (SPEC_MO_RONG C9, API §11.1, QUYET_DINH Q9–Q11). Dates in 2021."""
import re

from mr_lib import *


def st_body(date, whid, lines, **kw):
    b = {"doc_type": "stocktake", "doc_date": date, "warehouse_id": whid, "lines": lines}
    b.update(kw)
    return b


def mk_st(date, whid, lines, c=None):
    r = (c or admin()).post("/documents", st_body(date, whid, lines))
    if r.status != 201:
        raise Fatal("stocktake draft: " + r.short())
    return r.json


def line_of(doc, pid):
    for l in doc["lines"]:
        if l["product_id"] == pid:
            return l
    return {}


def day_stock(pid, whid, d):
    byw, _ = stock_of(pid, as_of=d)
    return byw.get(whid, D(0))


@test("C9", "test_C9_book_qty_recomputed_and_posting_movements")
def _():
    """opening 03-01 10 ; sale 03-05 3 -> draft stocktake 03-05 counted 9: book 7, diff +2.
    A second sale 03-05 of 1 posted later -> draft now shows book 6, diff +3 -> posting stores book 6 and moves +3 -> stock 9.
    Back-dated purchase 03-04 of 5 after posting -> book_changed, current_book 11, adjustment stays +3 -> stock 14."""
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=10, purchase=5)
    c, s = mk_partner(cust=True), mk_partner(supp=True)
    posted("opening", "2021-03-01", k1, [L(p["id"], 10, 5)])
    posted("sale", "2021-03-05", k1, [L(p["id"], 3, 10)], c["id"])
    d = mk_st("2021-03-05", k1, [L(p["id"], 9)])
    l = line_of(d, p["id"])
    eq((l.get("book_qty"), l.get("counted_qty"), l.get("diff_qty")), (7, 9, 2), "draft: book/counted/diff")
    eq(d.get("total_amount"), 0, "stocktake total 0")
    eq(d.get("doc_type_name") and has_vietnamese(d["doc_type_name"]), True, "Vietnamese doc_type_name")
    eq(day_stock(p["id"], k1, "2021-03-05"), 7, "draft does not move stock")
    posted("sale", "2021-03-05", k1, [L(p["id"], 1, 10)], c["id"])
    d = get_doc(d["id"])
    eq(line_of(d, p["id"]).get("book_qty"), 6, "draft book recomputed at view (same-day sale posted later included)")
    r = post_doc(d)
    eq(r.status, 200, "post stocktake")
    pd_ = r.json
    check(re.fullmatch(r"KK\d{5}", pd_.get("doc_no") or ""), f"official number KK00001-style: {pd_.get('doc_no')}")
    l = line_of(pd_, p["id"])
    eq((l.get("book_qty"), l.get("diff_qty"), l.get("book_changed")), (6, 3, False), "posted: stored book 6, diff +3")
    eq(day_stock(p["id"], k1, "2021-03-05"), 9, "stock after posting = counted")
    led = ledger(p["id"], warehouse_id=k1)
    rows = [x for x in led["rows"] if x.get("document_id") == pd_["id"]]
    if check(len(rows) == 1, "one stock-card row for the stocktake"):
        eq((rows[0]["qty_in"], rows[0]["qty_out"]), (3, 0), "surplus = inbound 3")
        check("Kiểm kê thừa" in rows[0]["description"], f"label 'Kiểm kê thừa': {rows[0]['description']}")
    # back-dated purchase after posting
    posted("purchase", "2021-03-04", k1, [L(p["id"], 5, 5)], s["id"])
    g = get_doc(pd_["id"])
    l = line_of(g, p["id"])
    eq((l.get("book_qty"), l.get("current_book_qty"), l.get("book_changed")), (6, 11, True), "book_changed indicator after back-dated purchase")
    eq(g.get("book_changed_lines"), 1, "book_changed_lines")
    eq(day_stock(p["id"], k1, "2021-03-05"), 14, "adjustment stays +3 (not re-adjusted)")
    # shortage, zero-diff, counted 0
    q, z = mk_product(purchase=5), mk_product(purchase=5)
    posted("opening", "2021-03-01", k1, [L(q["id"], 10, 5), L(z["id"], 4, 5)])
    sd = post_doc(mk_st("2021-03-06", k1, [L(q["id"], 6), L(z["id"], 4), L(p["id"], 0)])).json
    eq(day_stock(q["id"], k1, "2021-03-06"), 6, "shortage 4 -> out")
    eq(day_stock(p["id"], k1, "2021-03-06"), 0, "counted 0 empties the warehouse")
    zr = [x for x in ledger(z["id"], warehouse_id=k1)["rows"] if x.get("document_id") == sd["id"]]
    eq(zr, [], "zero-difference line produces no stock-card row")
    qr = [x for x in ledger(q["id"], warehouse_id=k1)["rows"] if x.get("document_id") == sd["id"]]
    check(qr and qr[0]["qty_out"] == 4 and "Kiểm kê thiếu" in qr[0]["description"], f"'Kiểm kê thiếu' out 4: {qr}")
    # unpost clears book, re-post recomputes
    g = get_doc(sd["id"])
    eq(a.post(f"/documents/{sd['id']}/unpost", {"version": g["version"]}).status, 200, "unpost stocktake")
    eq(day_stock(q["id"], k1, "2021-03-06"), 10, "unpost restores stock")
    g = get_doc(sd["id"])
    eq(g["doc_no"], sd["doc_no"], "number kept after unpost")


@test("C9", "test_C9_R6_shortage_and_unposting_surplus")
def _():
    a = admin()
    k1 = wh("KHO1")
    c = mk_partner(cust=True)
    p = mk_product(sale=10, purchase=5)
    posted("opening", "2021-04-01", k1, [L(p["id"], 10, 5)])
    posted("sale", "2021-04-10", k1, [L(p["id"], 8, 10)], c["id"])
    d = mk_st("2021-04-05", k1, [L(p["id"], 5)])
    expect_err(post_doc(d), 422, "INSUFFICIENT_STOCK", "shortage 5 would make the 04-10 sale go negative (5-8)")
    eq(day_stock(p["id"], k1, "2021-12-31"), 2, "unchanged")
    # surplus that a later sale depends on
    p2 = mk_product(sale=10, purchase=5)
    posted("opening", "2021-04-01", k1, [L(p2["id"], 10, 5)])
    st = post_doc(mk_st("2021-04-05", k1, [L(p2["id"], 20)])).json
    posted("sale", "2021-04-10", k1, [L(p2["id"], 18, 10)], c["id"])
    g = get_doc(st["id"])
    expect_err(a.post(f"/documents/{st['id']}/unpost", {"version": g["version"]}), 422, "INSUFFICIENT_STOCK", "unpost surplus that a later sale uses")
    expect_err(a.put(f"/documents/{st['id']}", put_body_from(g, lines=[L(p2["id"], 12)])), 422, "INSUFFICIENT_STOCK", "lower counted on posted stocktake")
    r = a.put(f"/documents/{st['id']}", put_body_from(g, lines=[L(p2["id"], 18)]))
    eq(r.status, 200, "lower counted but still enough (18 -> 0 left)")
    eq(day_stock(p2["id"], k1, "2021-12-31"), 0, "stock 0")
    # moving the stocktake date later than the sale -> sale before it lacks stock
    g = get_doc(st["id"])
    r = a.put(f"/documents/{st['id']}", put_body_from(g, doc_date="2021-04-11"))
    expect_err(r, 422, "INSUFFICIENT_STOCK", "move surplus stocktake after the sale that needs it")


@test("C9", "test_C9_validation_and_load")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    p, q = mk_product(sale=10, purchase=5), mk_product(sale=10, purchase=5)
    posted("opening", "2021-05-01", k1, [L(p["id"], 3, 5), L(q["id"], 2, 5)])
    posted("opening", "2021-05-01", k2, [L(q["id"], 9, 5)])
    s = mk_partner(supp=True)
    bad = [(st_body("2021-05-02", k1, [L(p["id"], 1, 5)]), "unit_price on a line"),
           (st_body("2021-05-02", k1, [L(p["id"], 1, vat_rate=10)]), "vat_rate on a line"),
           (st_body("2021-05-02", k1, [L(p["id"], 1)], partner_id=s["id"]), "partner"),
           (st_body("2021-05-02", k1, [L(p["id"], 1)], to_warehouse_id=k2), "to_warehouse"),
           (st_body("2021-05-02", k1, [L(p["id"], 1), L(p["id"], 2)]), "same product twice"),
           (st_body("2021-05-02", k1, [{"product_code": "DV", "description": "x", "qty": 1}]), "service line"),
           (st_body("2021-05-02", k1, [L(p["id"], -1)]), "negative counted"),
           (st_body("2021-05-02", k1, [L(p["id"])]), "missing counted qty"),
           (st_body("2021-05-02", None, [L(p["id"], 1)]), "no warehouse"),
           (st_body("2021-05-02", k1, [L(p["id"], "abc")]), "text qty")]
    for b, label in bad:
        r = a.post("/documents", b)
        check(r.status == 400, f"stocktake {label}: expected 400, got {r.short()[:200]}")
    r = a.post("/documents", st_body("2021-05-02", k1, [L(p["id"], 0)]))
    eq(r.status, 201, "counted 0 allowed")
    r = a.post("/documents", st_body("2021-05-02", k1, []))
    eq(r.status, 201, "empty draft allowed")
    if r.status == 201:
        check(post_doc(r.json).status == 400, "posting an empty stocktake -> 400")
    # load endpoint
    r = a.ok("GET", "/documents/stocktake-load", params={"warehouse_id": k1, "date": "2021-05-01"})
    got = {x["product_id"]: x["book_qty"] for x in r["items"]}
    eq((got.get(p["id"]), got.get(q["id"])), (3, 2), "load lists products with stock at KHO1")
    check(all(x["product_code"] != "DV" for x in r["items"]), "no service")
    r = a.ok("GET", "/documents/stocktake-load", params={"warehouse_id": k1, "date": "2021-04-30"})
    check(p["id"] not in {x["product_id"] for x in r["items"]}, "before the opening -> not listed")
    for params, label in [({}, "no params"), ({"warehouse_id": "x"}, "bad warehouse"), ({"warehouse_id": k1, "date": "abc"}, "bad date"),
                          ({"warehouse_id": 99999}, "unknown warehouse")]:
        rr = a.get("/documents/stocktake-load", **params)
        check(rr.status in (400, 404), f"stocktake-load {label} -> {rr.status}")
    eq(user("banhang").get("/documents/stocktake-load", warehouse_id=k1).status in (200, 403), True, "banhang load")
    # list filter
    eq(a.get("/documents", type="stocktake").status, 200, "type=stocktake filter")


@test("C9", "test_C9_permissions_lock_export_reports")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=10, purchase=5)
    posted("opening", "2021-06-01", k1, [L(p["id"], 10, 5)])
    expect_err(user("banhang").post("/documents", st_body("2021-06-02", k1, [L(p["id"], 9)])), 403, "FORBIDDEN", "banhang stocktake")
    tk = user("thukho")
    d = mk_st("2021-06-02", k1, [L(p["id"], 12)], c=tk)
    r = tk.post(f"/documents/{d['id']}/post", {"version": d["version"]})
    eq(r.status, 200, "thukho posts stocktake")
    g = get_doc(r.json["id"], tk)
    expect_err(tk.put(f"/documents/{g['id']}", put_body_from(g, note="x")), 403, "FORBIDDEN", "thukho edits posted stocktake (no posted.edit)")
    eq(user("muahang").post("/documents", st_body("2021-06-03", k1, [L(p["id"], 12)])).status, 201, "muahang (stock.write) creates")
    # not in sales / purchases / debt
    for path in ["/reports/sales", "/reports/purchases"]:
        rep = a.ok("GET", path, params={"from": "2021-06-01", "to": "2021-06-30", "include_returns": "true"})
        check(all(x["document_id"] != g["id"] for x in rep["rows"]), f"stocktake not in {path}")
    nxt = a.ok("GET", "/reports/stock-nxt", params={"from": "2021-06-01", "to": "2021-06-30", "q": p["code"]})["items"]
    eq((nxt[0]["qty_in"], nxt[0]["closing"]) if nxt else None, (12, 12), "NXT counts opening 10 + surplus 2 as inbound")
    # export
    for fmt in ("xlsx", "docx"):
        r = a.get(f"/documents/{g['id']}/export", format=fmt)
        eq(r.status, 200, f"export {fmt}")
        txt = file_text(r.content)
        check("BIÊN BẢN KIỂM KÊ KHO" in txt, f"{fmt}: title")
        for col in ("Tồn sổ sách", "Thực tế", "Chênh lệch"):
            check(col in txt, f"{fmt}: column {col}")
        if fmt == "xlsx":
            nums = xlsx_numbers(r.content)
            check(10 in nums and 12 in nums and 2 in nums, f"xlsx numeric book/counted/diff: {nums[:20]}")
            check("Đơn giá" not in txt, "no price column")
    # period lock
    try:
        set_lock("2021-06-30")
        expect_err(a.post("/documents", st_body("2021-06-15", k1, [L(p["id"], 1)])), 422, "PERIOD_LOCKED", "stocktake in locked period")
        g = get_doc(g["id"])
        expect_err(a.put(f"/documents/{g['id']}", put_body_from(g, note="x")), 422, "PERIOD_LOCKED", "edit posted stocktake in lock")
        expect_err(a.post(f"/documents/{g['id']}/unpost", {"version": g["version"]}), 422, "PERIOD_LOCKED", "unpost stocktake in lock")
    finally:
        clear_lock()


@test("C9", "test_C9_profit_treatment")
def _():
    """purchase 05-01 10@10 ; stocktake 05-02 counted 12 (+2 enters at avg 10) -> q12 v120 ; purchase 05-03 12@20 ->
    q24 v360 avg 15 ; sale 05-04 4 -> cost 60 ; stocktake 05-05 counted 10 (book 20, -10 out at 15) -> q10 v150 ;
    sale 05-06 1 -> 15. No profit line for the stocktake itself."""
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=999)
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    posted("purchase", "2021-05-01", k1, [L(p["id"], 10, 10)], s["id"])
    st1 = post_doc(mk_st("2021-05-02", k1, [L(p["id"], 12)])).json
    posted("purchase", "2021-05-03", k1, [L(p["id"], 12, 20)], s["id"])
    a1 = posted("sale", "2021-05-04", k1, [L(p["id"], 4, 100)], c["id"])
    post_doc(mk_st("2021-05-05", k1, [L(p["id"], 10)]))
    a2 = posted("sale", "2021-05-06", k1, [L(p["id"], 1, 100)], c["id"])
    rows = {it["document_id"]: it for it in profit(group_by="document", **{"from": "2021-05-01", "to": "2021-05-31"})["items"]}
    eq(rows.get(a1["id"], {}).get("cost"), 60, "surplus at current average")
    eq(rows.get(a2["id"], {}).get("cost"), 15, "shortage out at current average")
    check(st1["id"] not in rows, "stocktake has no profit line")
    # never purchased: surplus enters at default purchase price (Q10)
    n = mk_product(sale=100, purchase=70)
    post_doc(mk_st("2021-05-10", k1, [L(n["id"], 3)]))
    b = posted("sale", "2021-05-11", k1, [L(n["id"], 1, 100)], c["id"])
    it = profit(group_by="document", **{"from": "2021-05-11", "to": "2021-05-11"})["items"]
    it = {x["document_id"]: x for x in it}.get(b["id"], {})
    eq(it.get("cost"), 70, "never-bought surplus at default purchase price")
    print(f"      note: sale of goods that only came from a stocktake surplus -> estimated={it.get('estimated')}")


@test("C9", "test_C9_units_on_lines_and_concurrency_invariant")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=10, purchase=5)
    a.put(f"/products/{p['id']}/units", {"items": [{"unit": "Thùng", "factor": 24}]})
    posted("opening", "2021-07-01", k1, [L(p["id"], 50, 5)])
    d = mk_st("2021-07-02", k1, [L(p["id"], 2, unit="Thùng")])
    l = line_of(d, p["id"])
    eq((l.get("counted_qty"), l.get("book_qty"), l.get("diff_qty"), l.get("qty"), l.get("unit")), (48, 50, -2, 2, "Thùng"),
       "counted in Thùng -> base 48; book/diff in base")
    eq(post_doc(d).status, 200, "post")
    eq(day_stock(p["id"], k1, "2021-07-02"), 48, "stock 48")
    # concurrency: stocktake vs same-day sale on the same product, 5 rounds
    c = mk_partner(cust=True)
    for i in range(5):
        q = mk_product(sale=10, purchase=0)
        posted("opening", "2021-07-01", k1, [L(q["id"], 100, 0)])
        st = mk_st("2021-07-03", k1, [L(q["id"], 90)])
        sa = draft("sale", "2021-07-03", k1, [L(q["id"], 7, 10)], c["id"])
        res = run_parallel([lambda: raw_client(a).post(f"/documents/{st['id']}/post", {"version": st["version"]}),
                            lambda: raw_client(user("ketoan")).post(f"/documents/{sa['id']}/post", {"version": sa["version"]})])
        sts = [r.status if not isinstance(r, Exception) else str(r) for r in res]
        check(all(isinstance(s, int) and s == 200 for s in sts), f"round {i}: both posted: {sts}")
        g = get_doc(st["id"])
        l = line_of(g, q["id"])
        cur = l.get("current_book_qty") if l.get("current_book_qty") is not None else l.get("book_qty")
        final = day_stock(q["id"], k1, "2021-07-03")
        # identity: end-of-day stock = current book + (counted - stored book)
        eq(final, num(cur) + num(l["counted_qty"]) - num(l["book_qty"]), f"round {i}: stock = current_book + diff (book {l['book_qty']}, now {cur})")


@test("C9", "test_C9_feature_off")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=10, purchase=5)
    posted("opening", "2021-08-01", k1, [L(p["id"], 10, 5)])
    st = post_doc(mk_st("2021-08-02", k1, [L(p["id"], 15)])).json
    dr = mk_st("2021-08-03", k1, [L(p["id"], 15)])
    try:
        eq(set_features(stocktake=False).status, 200, "stocktake off")
        eq(day_stock(p["id"], k1, "2021-08-02"), 15, "posted stocktake still counts in stock")
        eq(a.post("/documents", st_body("2021-08-04", k1, [L(p["id"], 1)])).status, 400, "create -> 400 like base")
        eq(a.get("/documents", type="stocktake").status, 400, "type=stocktake filter -> 400 like base")
        expect_err(a.get("/documents/stocktake-load", warehouse_id=k1), 404, "FEATURE_OFF", "load endpoint")
        g = get_doc(st["id"])
        expect_err(a.put(f"/documents/{g['id']}", put_body_from(g, note="x")), 404, "FEATURE_OFF", "edit old stocktake")
        expect_err(post_doc(get_doc(dr["id"])), 404, "FEATURE_OFF", "post old draft")
        eq(a.delete(f"/documents/{dr['id']}").status, 200, "delete old draft allowed")
        eq(a.post(f"/documents/{g['id']}/unpost", {"version": g["version"]}).status, 200, "unpost allowed")
        eq(day_stock(p["id"], k1, "2021-08-02"), 10, "unposted")
    finally:
        all_features_on()
