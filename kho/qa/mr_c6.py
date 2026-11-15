"""C6 — customer prices (SPEC_MO_RONG C6, API §9.2, QUYET_DINH O3). Uses dates in 2022."""
from mr_lib import *


def sp(partner, pids, date=None, c=None):
    params = {"partner_id": partner, "ids": ",".join(str(x) for x in pids)}
    if date:
        params["date"] = date
    r = (c or admin()).ok("GET", "/products/sale-price", params=params)
    return {it["product_id"]: it for it in r["items"]}


def src(partner, pid, date):
    it = sp(partner, [pid], date)[pid]
    return it["source"], num(it["price"])


@test("C6", "test_C6_price_source_priority_and_tiebreaks")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    P = mk_product(sale=1000, purchase=10)
    K, K2 = mk_partner(cust=True), mk_partner(cust=True)
    posted("opening", "2022-01-01", k1, [L(P["id"], 1000, 10)])
    posted("opening", "2022-01-01", k2, [L(P["id"], 1000, 10)])
    pid, kid = P["id"], K["id"]
    eq(src(kid, pid, "2022-06-01"), ("default", D(1000)), "no history -> default")
    it = sp(kid, [pid], "2022-06-01")[pid]
    eq(it.get("default_price"), 1000, "default_price field")
    check(has_vietnamese(it.get("source_name", "")), "source_name Vietnamese")
    draft("sale", "2022-02-01", k1, [L(pid, 1, 950)], kid)
    eq(src(kid, pid, "2022-06-01"), ("default", D(1000)), "draft sale ignored")
    s1 = posted("sale", "2022-02-01", k1, [L(pid, 1, 950)], kid)
    eq(src(kid, pid, "2022-06-01"), ("last_sale", D(950)), "posted sale -> last_sale")
    it = sp(kid, [pid], "2022-06-01")[pid]
    eq((it.get("document_id"), it.get("doc_no"), it.get("doc_date")), (s1["id"], s1["doc_no"], "2022-02-01"), "last_sale refers to the doc")
    eq(src(kid, pid, "2022-01-31"), ("default", D(1000)), "date before the sale -> default")
    eq(src(kid, pid, "2022-02-01"), ("last_sale", D(950)), "same day (<= date) counts")
    posted("sale_return", "2022-02-05", k1, [L(pid, 1, 800)], kid)
    eq(src(kid, pid, "2022-06-01"), ("last_sale", D(950)), "customer return ignored")
    posted("sale", "2022-02-06", k1, [L(pid, 1, 1)], K2["id"])
    eq(src(kid, pid, "2022-06-01"), ("last_sale", D(950)), "sale to another customer ignored")
    # same-day: posting order decides; repost moves to the end (F1)
    a1 = posted("sale", "2022-03-01", k2, [L(pid, 1, 900)], kid)
    a2 = posted("sale", "2022-03-01", k1, [L(pid, 1, 920)], kid)
    eq(src(kid, pid, "2022-03-01"), ("last_sale", D(920)), "same day: later posting wins (other warehouse too)")
    d = get_doc(a1["id"])
    a.post(f"/documents/{a1['id']}/unpost", {"version": d["version"]})
    eq(src(kid, pid, "2022-03-01"), ("last_sale", D(920)), "unposted sale ignored")
    post_doc(get_doc(a1["id"]))
    eq(src(kid, pid, "2022-03-01"), ("last_sale", D(900)), "re-posted sale is now the latest posting")
    # back-dated sale posted later: newest DATE wins
    posted("sale", "2022-02-15", k1, [L(pid, 1, 970)], kid)
    eq(src(kid, pid, "2022-03-01"), ("last_sale", D(900)), "back-dated sale does not override newer date")
    eq(src(kid, pid, "2022-02-20"), ("last_sale", D(970)), "back-dated sale is latest for earlier date")
    # two lines same product in one doc
    t = posted("sale", "2022-04-01", k1, [L(pid, 1, 911), L(pid, 1, 912)], kid)
    s_, p_ = src(kid, pid, "2022-04-01")
    eq(s_, "last_sale", "multi-line doc")
    print(f"      note: one posted sale with two lines 911 then 912 -> auto price {p_}")
    # editing a posted sale price changes the result
    d = get_doc(t["id"])
    a.put(f"/documents/{t['id']}", put_body_from(d, lines=[L(pid, 1, 933)]))
    eq(src(kid, pid, "2022-04-01"), ("last_sale", D(933)), "edited posted sale price used")
    # customer price overrides all; delete falls back
    r = a.put(f"/partners/{kid}/prices", {"items": [{"product_id": pid, "price": 880, "note": "Hợp đồng"}]})
    eq(r.status, 200, "set customer price")
    eq(src(kid, pid, "2022-01-01"), ("customer", D(880)), "customer price wins (even before any sale)")
    eq(sp(kid, [pid], "2022-06-01")[pid].get("note"), "Hợp đồng", "note returned")
    eq(src(K2["id"], pid, "2022-06-01"), ("last_sale", D(1)), "other customer unaffected")
    r = a.delete(f"/partners/{kid}/prices/{pid}")
    eq(r.status, 200, "delete customer price")
    eq(src(kid, pid, "2022-06-01"), ("last_sale", D(933)), "after delete -> last_sale")
    eq(a.delete(f"/partners/{kid}/prices/{pid}").status, 404, "delete again -> 404")
    # default price changes are picked up
    set_product(pid, sale_price=1111)
    eq(src(mk_partner(cust=True)["id"], pid, "2022-06-01"), ("default", D(1111)), "default follows catalog")


@test("C6", "test_C6_server_autofill_unit_price")
def _():
    a = admin()
    k1 = wh("KHO1")
    P, Q, R = mk_product(sale=1000, purchase=10), mk_product(sale=500, purchase=10), mk_product(sale=300, purchase=10)
    K = mk_partner(cust=True)
    posted("opening", "2022-01-01", k1, [L(P["id"], 100, 10), L(Q["id"], 100, 10), L(R["id"], 100, 10)])
    a.put(f"/partners/{K['id']}/prices", {"items": [{"product_id": P["id"], "price": 777}]})
    posted("sale", "2022-05-01", k1, [L(Q["id"], 1, 444)], K["id"])
    d = draft("sale", "2022-05-10", k1, [L(P["id"], 1), L(Q["id"], 1), L(R["id"], 1), L(P["id"], 1, 1234)], K["id"])
    eq([l["unit_price"] for l in d["lines"]], [777, 444, 300, 1234], "auto-fill: customer / last_sale / default / explicit kept")
    eq(d["total_amount"], 777 + 444 + 300 + 1234, "total")
    d2 = draft("sale", "2022-04-30", k1, [L(Q["id"], 1)], K["id"])
    eq(d2["lines"][0]["unit_price"], 500, "auto-fill uses doc_date: sale on 05-01 not yet visible on 04-30")
    r = create_doc("sale_return", "2022-05-10", k1, [L(P["id"], 1)], K["id"])
    eq(r.json["lines"][0]["unit_price"], 1000, "sale_return keeps default sale price")
    # PUT draft: a new line without price is auto-filled; existing explicit prices untouched
    d = get_doc(d["id"])
    body = put_body_from(d)
    body["lines"].append(L(P["id"], 2))
    r = a.put(f"/documents/{d['id']}", body)
    eq(r.status, 200, "PUT draft")
    eq(r.json["lines"][-1]["unit_price"], 777, "new line on PUT auto-filled with customer price")
    # unit_price explicitly null for goods on a sale -> same as omitted?
    r = create_doc("sale", "2022-05-10", k1, [L(P["id"], 1, None)], K["id"])
    check(r.status in (201, 400), f"unit_price null -> {r.status}")
    if r.status == 201:
        eq(r.json["lines"][0]["unit_price"], 777, "null price auto-filled like omitted")
    # /documents/check loss warning works with the auto-filled price (customer price below cost)
    set_product(R["id"], purchase_price=5000)
    a.put(f"/partners/{K['id']}/prices", {"items": [{"product_id": R["id"], "price": 10}]})
    r = a.post("/documents/check", doc_body("sale", "2022-05-10", k1, [L(R["id"], 1)], K["id"]))
    eq(r.status, 200, "check")
    eq(len((r.json or {}).get("loss_lines") or []), 1, "loss detected on auto-filled customer price")
    # posting a sale created from auto-filled prices -> last_sale
    dd = draft("sale", "2022-06-01", k1, [L(Q["id"], 1)], K["id"])
    post_doc(dd)
    eq(src(K["id"], Q["id"], "2022-06-02"), ("last_sale", D(444)), "auto-filled price becomes last_sale")


@test("C6", "test_C6_validation_permissions_partner_kind")
def _():
    a = admin()
    P, P2 = mk_product(sale=10, purchase=1), mk_product(sale=20, purchase=1)
    K = mk_partner(cust=True)
    S = mk_partner(supp=True)
    KS = mk_partner(cust=True, supp=True)
    base = f"/partners/{K['id']}/prices"
    eq(a.put(base, {"items": [{"product_code": P["code"].lower(), "price": "1.000"}]}).status, 200 if True else 0, "product_code + string price")
    items = a.ok("GET", base)["items"]
    check(any(i["product_id"] == P["id"] for i in items), "set by product_code (case-insensitive)")
    v = [i for i in items if i["product_id"] == P["id"]]
    if v:
        print(f"      note: price \"1.000\" via JSON stored as {v[0]['price']}")
        check(v[0].get("updated_by_name"), "updated_by_name")
        eq(v[0].get("default_price"), 10, "default_price in list")
    for body, label in [({"items": [{"product_id": P["id"], "price": -1}]}, "negative price"),
                        ({"items": [{"product_id": P["id"], "price": 1}, {"product_id": P["id"], "price": 2}]}, "duplicate product"),
                        ({"items": [{"product_id": 9999999, "price": 1}]}, "unknown product"),
                        ({"items": [{"product_code": "KHONGCO", "price": 1}]}, "unknown code"),
                        ({"items": [{"product_id": P["id"], "price": 1e20}]}, "overflow"),
                        ({"items": [{"product_id": P["id"], "price": "abc"}]}, "text price"),
                        ({"items": [{"product_id": P["id"]}]}, "missing price"),
                        ({"items": [{"product_id": P["id"], "price": 1, "note": "a\u0000b"}]}, "NUL note"),
                        ({"items": "x"}, "items not list")]:
        r = a.put(base, body)
        check(r.status == 400, f"{label}: expected 400, got {r.short()[:200]}")
        if r.status == 400 and label in ("negative price", "duplicate product", "unknown product"):
            check((r.details or {}).get("line_no") is not None, f"{label}: details.line_no")
    before = a.ok("GET", base)["items"]
    r = a.put(base, {})
    check(r.status in (200, 400), f"empty body -> {r.status}")
    eq(len(a.ok("GET", base)["items"]), len(before), "empty body changes nothing")
    # second item wrong -> nothing saved (atomic)
    r = a.put(base, {"items": [{"product_id": P2["id"], "price": 5}, {"product_id": P["id"], "price": -5}]})
    eq(r.status, 400, "bad second item")
    check(all(i["product_id"] != P2["id"] for i in a.ok("GET", base)["items"]), "first item not saved (atomic)")
    # service product price? if accepted, a DV note line (no price, R7) must NOT be auto-priced
    dv = a.ok("GET", "/products/lookup", params={"code": "DV"})
    r = a.put(base, {"items": [{"product_id": dv["id"], "price": 5}]})
    check(r.status in (200, 400), f"price for DV -> {r.status}")
    if r.status == 200:
        d = a.post("/documents", doc_body("sale", "2022-05-10", wh("KHO1"), [{"product_code": "DICHVU", "description": "TRẢ 01 ĐỒNG HỒ"}], K["id"]))
        if check(d.status == 201, "sale with DV note line"):
            eq(d.json["lines"][0]["unit_price"], None, "R7: DV note line keeps null price even when the customer has a DV price")
            eq(d.json["total_amount"], 0, "note line adds nothing to the total")
        a.delete(f"{base}/{dv['id']}")
    # replace
    a.put(base, {"items": [{"product_id": P["id"], "price": 7}, {"product_id": P2["id"], "price": 8}]})
    r = a.put(base, {"items": [{"product_id": P2["id"], "price": 9}], "replace": True})
    eq(r.status, 200, "replace")
    eq([(i["product_id"], i["price"]) for i in a.ok("GET", base)["items"]], [(P2["id"], 9)], "replace removed others")
    r = a.put(base, {"items": [], "replace": True})
    check(r.status in (200, 400), f"replace with empty -> {r.status}")
    if r.status == 200:
        eq(a.ok("GET", base)["items"], [], "replace with [] clears all")
    # partner kind
    expect_err(a.get(f"/partners/{S['id']}/prices"), 400, "VALIDATION", "GET prices of supplier")
    expect_err(a.put(f"/partners/{S['id']}/prices", {"items": [{"product_id": P["id"], "price": 1}]}), 400, "VALIDATION", "PUT prices of supplier")
    eq(a.put(f"/partners/{KS['id']}/prices", {"items": [{"product_id": P["id"], "price": 1}]}).status, 200, "customer+supplier ok")
    r = a.get("/products/sale-price", partner_id=S["id"], ids=P["id"])
    check(r.status in (200, 400), f"sale-price for supplier -> {r.status}")
    eq(a.get("/partners/9999999/prices").status, 404, "unknown partner")
    # sale-price params
    for params, label in [({"ids": P["id"]}, "missing partner_id"), ({"partner_id": K["id"]}, "missing ids"),
                          ({"partner_id": K["id"], "ids": "a,b"}, "bad ids"), ({"partner_id": K["id"], "ids": P["id"], "date": "2022-02-30"}, "bad date"),
                          ({"partner_id": K["id"], "ids": ",".join(str(i) for i in range(1, 503))}, "> 500 ids"),
                          ({"partner_id": "x", "ids": P["id"]}, "bad partner id")]:
        r = a.get("/products/sale-price", **params)
        eq(r.status, 400, f"sale-price {label}")
    r = a.get("/products/sale-price", partner_id=K["id"], ids="9999999")
    check(r.status in (400, 404), f"USABILITY: unknown product id should be reported like price-info (404 missing_ids), got {r.short()[:200]}")
    r = a.get("/products/sale-price", partner_id=9999999, ids=P["id"])
    check(r.status in (400, 404), f"unknown partner -> {r.status}")
    # permissions: everyone reads; sale.write writes
    for role in ["banhang", "muahang", "thukho", "ketoan"]:
        eq(user(role).get(f"/partners/{K['id']}/prices").status, 200, f"{role} reads prices")
        eq(user(role).get("/products/sale-price", partner_id=K["id"], ids=P["id"]).status, 200, f"{role} reads sale-price")
    eq(user("banhang").put(base, {"items": [{"product_id": P["id"], "price": 3}]}).status, 200, "banhang writes")
    for role in ["muahang", "thukho"]:
        expect_err(user(role).put(base, {"items": [{"product_id": P["id"], "price": 3}]}), 403, "FORBIDDEN", f"{role} writes")
        expect_err(user(role).delete(f"{base}/{P['id']}"), 403, "FORBIDDEN", f"{role} deletes")


@test("C6", "test_C6_deleting_product_or_partner_cascades")
def _():
    a = admin()
    P = mk_product(sale=10, purchase=1)
    K = mk_partner(cust=True)
    K2 = mk_partner(cust=True)
    a.put(f"/partners/{K['id']}/prices", {"items": [{"product_id": P["id"], "price": 5}]})
    a.put(f"/partners/{K2['id']}/prices", {"items": [{"product_id": P["id"], "price": 6}]})
    r = a.delete(f"/products/{P['id']}")
    eq(r.status, 200, "delete product with customer prices but no documents")
    eq(a.ok("GET", f"/partners/{K['id']}/prices")["items"], [], "customer price removed with the product")
    P2 = mk_product(sale=10, purchase=1)
    a.put(f"/partners/{K2['id']}/prices", {"items": [{"product_id": P2["id"], "price": 6}]})
    eq(a.delete(f"/partners/{K2['id']}").status, 200, "delete partner with prices")
    # product still deletable & no orphan rows visible
    eq(a.delete(f"/products/{P2['id']}").status, 200, "delete product afterwards")


@test("C6", "test_C6_partner_prices_excel_import")
def _():
    a = admin()
    P, P2 = mk_product(sale=10, purchase=1), mk_product(sale=20, purchase=1)
    K = mk_partner(cust=True)
    S = mk_partner(supp=True)
    hdr = ["Mã khách hàng", "Mã hàng", "Giá", "Ghi chú"]
    r = upload(a, "partner_prices", xlsx_bytes(hdr, [[K["code"], P["code"], "1.500", "HĐ 2022"], [K["code"], P2["code"], "2,5", ""]]), dry=False)
    eq(r.status, 200, "import prices: " + errs_text(import_result(r)))
    got = {i["product_id"]: i for i in a.ok("GET", f"/partners/{K['id']}/prices")["items"]}
    eq(got.get(P["id"], {}).get("price"), 1500, "1.500 -> 1500")
    eq(got.get(P2["id"], {}).get("price"), 2.5, "2,5 -> 2.5")
    eq(got.get(P["id"], {}).get("note"), "HĐ 2022", "note")
    r = upload(a, "partner_prices", xlsx_bytes(hdr, [[S["code"], P["code"], 1, ""], [K["code"], P["code"], 1, ""], [K["code"], P["code"].lower(), 2, ""],
                                                     [K["code"], "KHONGCO", 1, ""], [K["code"], P2["code"], -1, ""], [K["code"], P2["code"], "", ""]]))
    res = import_result(r)
    rows = sorted({e["row"] for e in res.get("errors") or []})
    check(2 in rows, f"supplier-only partner rejected: {errs_text(res)[:400]}")
    check(4 in rows or 3 in rows, "duplicate (customer, product) flagged")
    check(5 in rows and 6 in rows, "unknown product / negative price flagged")
    check(7 in rows, "blank price flagged (Giá* required)")
    try:
        set_features(price_list=False)
        r = upload(a, "partner_prices", xlsx_bytes(hdr, [[K["code"], P["code"], 1, ""]]))
        check(r.status == 404 or r.status == 400, f"partner_prices import with price_list off -> {r.status}")
        r = a.get("/import/partner_prices/template")
        check(r.status in (400, 404), f"partner_prices template with price_list off -> {r.status}")
    finally:
        all_features_on()
