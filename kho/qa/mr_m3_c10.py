"""C10 — unit conversion (SPEC_MO_RONG C10, API §11.2, QUYET_DINH Q2–Q4). Dates in 2019."""
from mr_lib import *


def units(pid, items):
    return admin().put(f"/products/{pid}/units", {"items": items})


def prod_with_units(base="Lon", sale=1000, purchase=600, items=({"unit": "Thùng", "factor": 24},)):
    p = admin().ok("POST", "/products", {"code": uid("UC"), "name": "Hàng quy đổi", "unit": base, "sale_price": sale, "purchase_price": purchase})
    r = units(p["id"], list(items))
    if r.status != 200:
        raise Fatal("units: " + r.short())
    return p


def base_stock(pid, d="2019-12-31"):
    return stock_of(pid, as_of=d)[1]


@test("C10", "test_C10_units_crud_validation_and_in_use")
def _():
    a = admin()
    p = a.ok("POST", "/products", {"code": uid("UC"), "name": "Bia", "unit": "Lon", "sale_price": 10})
    pid = p["id"]
    for items, label in [([{"unit": "Thùng", "factor": 0}], "factor 0"), ([{"unit": "Thùng", "factor": -24}], "negative"),
                         ([{"unit": "Thùng", "factor": 1.0000001}], "7 decimals"), ([{"unit": "Vỉ", "factor": 0.5}], "factor < 1 (Q18)"),
                         ([{"unit": "Vỉ", "factor": 0.999999}], "factor 0.999999 (Q18)"), ([{"unit": "Thùng", "factor": 1e9}], ">= 1e9"),
                         ([{"unit": "lon", "factor": 2}], "same as base unit (case)"), ([{"unit": " Lon ", "factor": 2}], "base unit with spaces"),
                         ([{"unit": "Thùng", "factor": 24}, {"unit": "THÙNG", "factor": 12}], "duplicate (case)"),
                         ([{"unit": "", "factor": 2}], "empty name"), ([{"unit": "A\u0000", "factor": 2}], "NUL"),
                         ([{"unit": "Thùng", "factor": "abc"}], "text factor"), ([{"unit": "Thùng"}], "missing factor")]:
        r = units(pid, items)
        check(r.status == 400, f"units {label}: expected 400, got {r.short()[:200]}")
    r = units(pid, [{"unit": "Thùng", "factor": 24}, {"unit": "Lốc", "factor": 6}, {"unit": "Két", "factor": 20.5}])
    eq(r.status, 200, "valid units")
    g = a.ok("GET", f"/products/{pid}")
    eq(sorted((u["unit"], u["factor"]) for u in g.get("units", [])), [("Két", 20.5), ("Lốc", 6), ("Thùng", 24)], "product JSON has units")
    eq(len(a.ok("GET", "/products/lookup", params={"code": p["code"]}).get("units") or []), 3, "lookup has units")
    expect_err(user("banhang").put(f"/products/{pid}/units", {"items": []}), 403, "FORBIDDEN", "banhang edits units")
    eq(user("banhang").get(f"/products/{pid}/units").status, 200, "everyone reads units")
    # in use
    k1 = wh("KHO1")
    posted("opening", "2019-01-01", k1, [L(pid, 2, 100, unit="Thùng")])
    u = a.ok("GET", f"/products/{pid}/units")
    check(any(x["unit"] == "Thùng" and x["in_use"] for x in u["items"]), "Thùng in_use")
    expect_err(units(pid, [{"unit": "Lốc", "factor": 6}]), 409, "IN_USE", "drop a used unit")
    expect_err(units(pid, [{"unit": "Thùng", "factor": 12}, {"unit": "Lốc", "factor": 6}]), 409, "IN_USE", "change factor of a used unit")
    r = units(pid, [{"unit": "thùng", "factor": 24}, {"unit": "Lốc", "factor": 6}, {"unit": "Két", "factor": 20.5}])
    check(r.status in (200, 409), f"re-send used unit with other case + add a unit -> {r.status}")
    eq(units(pid, [{"unit": "Thùng", "factor": 24}, {"unit": "Két", "factor": 20}]).status, 200, "drop unused Lốc, change unused Két")
    # change base unit with factor != 1 lines
    body = {k: g[k] for k in ("code", "name", "group_id", "sale_price", "purchase_price", "is_service", "active")}
    eq(a.put(f"/products/{pid}", {**body, "unit": "Chai"}).status, 400, "change base unit after factor lines")
    eq(a.put(f"/products/{pid}", {**body, "unit": "Lon"}).status, 200, "same base unit ok")
    # same name but factor 1 typed earlier does not lock (Q4) - with feature off a free-text 'Hộp' line has factor 1
    q = a.ok("POST", "/products", {"code": uid("UC"), "name": "Que", "unit": "Que", "sale_price": 1})
    try:
        set_features(unit_conversion=False)
        posted("opening", "2019-01-01", k1, [L(q["id"], 5, 1, unit="Hộp")])
    finally:
        all_features_on()
    eq(units(q["id"], [{"unit": "Hộp", "factor": 50}]).status, 200, "free-text 'Hộp' factor-1 line does not lock unit Hộp 50")
    eq(units(q["id"], []).status, 200, "and can be removed again")


@test("C10", "test_C10_lines_base_qty_rounding_and_boundary")
def _():
    a = admin()
    k1 = wh("KHO1")
    c = mk_partner(cust=True)
    p = prod_with_units(items=[{"unit": "Thùng", "factor": 24}, {"unit": "Két", "factor": 2.5}])
    pid = p["id"]
    posted("opening", "2019-02-01", k1, [L(pid, 48, 600)])
    d = draft("sale", "2019-02-02", k1, [L(pid, 1, 100, unit="thùng")], c["id"])
    l = d["lines"][0]
    eq((l["unit"], l["factor"], l["base_qty"], l["base_unit"], l["amount"]), ("Thùng", 24, 24, "Lon", 100), "unit name case-insensitive, stored as declared")
    expect_err(a.post("/documents", doc_body("sale", "2019-02-02", k1, [L(pid, 1, 100, unit="Bao")], c["id"])), 400, "VALIDATION", "undeclared unit")
    # Q18: base_qty = qty x factor must be exact to 3 decimals, otherwise 400 (no rounding)
    for q_, unit_, want in [("0.5", "Thùng", 12), ("0.125", "Thùng", 3), ("0.333", "Két", None), ("0.002", "Két", 0.005),
                            ("0.001", "Két", None)]:
        r = a.post("/documents", doc_body("sale", "2019-02-02", k1, [L(pid, q_, 1, unit=unit_)], c["id"]))
        if want is None:
            eq(r.status, 400, f"{q_} {unit_} -> base has > 3 decimals -> 400")
        else:
            eq(r.json["lines"][0]["base_qty"] if r.status == 201 else r.status, want, f"{q_} {unit_} -> base {want}")
    # 4-decimal quantities are first rounded to 3 decimals by the base rule (B12): 0.0417 -> 0.042 Thùng = 1.008 exact
    r = a.post("/documents", doc_body("sale", "2019-02-02", k1, [L(pid, "0.0417", 1, unit="Thùng")], c["id"]))
    if r.status == 201:
        l = r.json["lines"][0]
        eq((l["qty"], l["base_qty"]), (0.042, 1.008), "qty rounded to 3 decimals first (B12), base exact")
    # boundary: 48 Lon in stock; 2 Thùng exactly OK, 2.001 Thùng (48.024) short by 0.024
    chk = a.post("/documents/check", doc_body("sale", "2019-02-03", k1, [L(pid, 2, 1, unit="Thùng")], c["id"])).json
    eq(chk.get("stock_shortages"), [], "2 Thùng = 48 Lon exactly available")
    d = draft("sale", "2019-02-03", k1, [L(pid, "2.001", 1, unit="Thùng")], c["id"])
    r = post_doc(d, True)
    if expect_err(r, 422, "INSUFFICIENT_STOCK", "2.001 Thùng"):
        sh = (r.details or [{}])[0]
        eq((sh.get("required"), sh.get("shortage"), sh.get("unit")), (48.024, 0.024, "Lon"), "shortage in base units")
    eq(post_doc(draft("sale", "2019-02-03", k1, [L(pid, 2, 1, unit="Thùng")], c["id"]), True).status, 200, "exact boundary posts")
    eq(base_stock(pid), 0, "stock 0")
    # stock card in base units, unit price per base
    led = ledger(pid, warehouse_id=k1)
    row = [x for x in led["rows"] if x["qty_out"] == 48]
    if check(row, "stock-card row of 48"):
        eq((row[0]["unit"], row[0]["unit_price"]), ("Lon", 0.04), "stock card shows base unit and price/factor (1/24 -> 0.04)")


@test("C10", "test_C10_selling_a_case_unit_by_unit_drift")
def _():
    """(M-14 re-test, Q18) factor < 1 is refused; with base = smallest unit (Lon, Thùng = 24) buying 1 Thùng and selling
    24 single cans empties the stock exactly; a 25th can is refused."""
    k1 = wh("KHO1")
    c = mk_partner(cust=True)
    q = admin().ok("POST", "/products", {"code": uid("UC"), "name": "Thùng gốc", "unit": "Thùng", "sale_price": 1})
    eq(units(q["id"], [{"unit": "Lon", "factor": 0.041667}]).status, 400, "factor 0.041667 (< 1) refused")
    p = prod_with_units(base="Lon", sale=1000, purchase=0, items=[{"unit": "Thùng", "factor": 24}])
    posted("opening", "2019-03-01", k1, [L(p["id"], 1, 0, unit="Thùng")])
    fails = []
    for i in range(24):
        d = draft("sale", "2019-03-02", k1, [L(p["id"], 1, 1000)], c["id"])
        r = post_doc(d, True)
        if r.status != 200:
            fails.append((i + 1, r.status))
    check(not fails, f"selling 24 single cans out of one case: failed sales {fails}; stock left {base_stock(p['id'])} Thùng")
    st = base_stock(p["id"])
    eq(st, 0, "a case sold can by can leaves 0 (no drift)")
    expect_err(post_doc(draft("sale", "2019-03-02", k1, [L(p["id"], 1, 1000)], c["id"]), True), 422, "INSUFFICIENT_STOCK", "25th can refused")


@test("C10", "test_C10_prices_conversion_customer_last_sale_loss")
def _():
    a = admin()
    k1 = wh("KHO1")
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    p = prod_with_units(sale=1234.56, purchase=600, items=[{"unit": "Thùng", "factor": 24}, {"unit": "Lốc", "factor": 6}, {"unit": "Két", "factor": 2.5}])
    pid = p["id"]
    posted("opening", "2019-04-01", k1, [L(pid, 1000, 600)])
    d = draft("sale", "2019-04-02", k1, [L(pid, 1, unit="Thùng"), L(pid, 1, unit="Két"), L(pid, 1)], c["id"])
    # 1234.56 x 24 = 29629.44 ; 1234.56 x 2.5 = 3086.40
    eq([l["unit_price"] for l in d["lines"]], [29629.44, 3086.4, 1234.56], "default price x factor, 2 decimals")
    # customer price is per base unit
    a.put(f"/partners/{c['id']}/prices", {"items": [{"product_id": pid, "price": 900}]})
    d = draft("sale", "2019-04-02", k1, [L(pid, 1, unit="Thùng"), L(pid, 1, unit="Lốc")], c["id"])
    eq([l["unit_price"] for l in d["lines"]], [21600, 5400], "customer price 900/Lon x factor")
    a.delete(f"/partners/{c['id']}/prices/{pid}")
    # last sale
    posted("sale", "2019-04-03", k1, [L(pid, 1, 25001, unit="Thùng")], c["id"])
    d = draft("sale", "2019-04-04", k1, [L(pid, 1, unit="Thùng"), L(pid, 1, unit="Lốc"), L(pid, 1)], c["id"])
    # same unit -> 25001 ; Lốc -> 25001/24*6 = 6250.25 ; base -> 25001/24 = 1041.708.. -> 1041.71
    eq([l["unit_price"] for l in d["lines"]], [25001, 6250.25, 1041.71], "last sale: same unit exact, other units converted")
    sp = a.ok("GET", "/products/sale-price", params={"partner_id": c["id"], "ids": pid, "date": "2019-04-04"})["items"][0]
    eq((sp["source"], sp["price"]), ("last_sale", 1041.71), "sale-price endpoint returns the base-unit price")
    # loss warning per base unit: last purchase Thùng @14400 = 600/Lon
    posted("purchase", "2019-04-05", k1, [L(pid, 1, 14400, unit="Thùng")], s["id"])
    r = a.post("/documents/check", doc_body("sale", "2019-04-06", k1, [L(pid, 1, 3500, unit="Lốc"), L(pid, 1, 3600, unit="Lốc")], c["id"])).json
    ll = r.get("loss_lines") or []
    eq([x["line_no"] for x in ll], [1], "only 3500/6 = 583.33 < 600 is a loss (3600/6 = 600 is not)")
    if ll:
        eq(ll[0].get("cost_price"), 3600, "cost_price shown per selected unit (600 x 6)")
    # sales report keeps the unit, total_qty in base
    posted("sale", "2019-04-07", k1, [L(pid, 2, 30000, unit="Thùng"), L(pid, 3, 1300)], c["id"])
    rep = a.ok("GET", "/reports/sales", params={"from": "2019-04-07", "to": "2019-04-07", "product_id": pid})
    rows = [(x["unit"], x["qty"], x.get("base_qty")) for x in rep["rows"]]
    eq(sorted(rows), sorted([("Thùng", 2, 48), ("Lon", 3, 3)]), "sales report rows keep the unit + base_qty")
    eq(rep["total_qty"], 51, "total_qty in base units")
    # profit uses base units: avg cost at 04-07: opening 1000@600 + 1 Thùng(24)@14400 -> 600/Lon ; sold 51 -> 30600
    pr = profit(group_by="product", product_id=pid, **{"from": "2019-04-07", "to": "2019-04-07"})["totals"]
    eq(pr["cost"], 30600, "profit cost in base units: 51 x 600")


@test("C10", "test_C10_old_client_keeps_unit_and_feature_off")
def _():
    a = admin()
    k1 = wh("KHO1")
    c = mk_partner(cust=True)
    p = prod_with_units()
    pid = p["id"]
    posted("opening", "2019-05-01", k1, [L(pid, 500, 600)])
    d = draft("sale", "2019-05-02", k1, [L(pid, 2, 25000, unit="Thùng")], c["id"])
    lid = d["lines"][0]["id"]
    body = {k: d[k] for k in ("doc_type", "doc_date", "partner_id", "warehouse_id", "note")}
    body["version"] = d["version"]
    body["lines"] = [{"id": lid, "product_id": pid, "qty": 3, "unit_price": 25000}]   # old client: no unit
    r = a.put(f"/documents/{d['id']}", body)
    eq((r.json["lines"][0]["unit"], r.json["lines"][0]["factor"], r.json["lines"][0]["base_qty"]), ("Thùng", 24, 72), "id + no unit keeps Thùng")
    body["version"] = r.json["version"]
    body["lines"] = [{"id": lid, "product_id": pid, "qty": 3, "unit_price": 25000, "unit": "thùng"}]
    r = a.put(f"/documents/{d['id']}", body)
    eq(r.json["lines"][0]["factor"], 24, "stored unit (other case) keeps")
    body["version"] = r.json["version"]
    body["lines"] = [{"product_id": pid, "qty": 3, "unit_price": 25000}]
    r = a.put(f"/documents/{d['id']}", body)
    eq((r.json["lines"][0]["unit"], r.json["lines"][0]["factor"]), ("Thùng", 24), "no id + no unit, same product sequence -> stored unit kept (Q19)")
    post_doc(get_doc(d["id"]))
    old = posted("sale", "2019-05-03", k1, [L(pid, 1, 25000, unit="Thùng")], c["id"])
    before = base_stock(pid)
    try:
        eq(set_features(unit_conversion=False).status, 200, "off")
        expect_err(a.get(f"/products/{pid}/units"), 404, "FEATURE_OFF", "units endpoint off")
        g = a.ok("GET", f"/products/{pid}")
        check("units" not in g, "product JSON without units when off")
        r = a.post("/documents", doc_body("sale", "2019-05-04", k1, [L(pid, 2, 1000, unit="Thùng")], c["id"]))
        eq(r.status, 201, "free-text unit when off")
        l = r.json["lines"][0]
        eq(l["unit"], "Thùng", "text kept")
        check("factor" not in l and "base_qty" not in l, f"new line has no factor fields when off: {sorted(l)}")
        post_doc(r.json, True)
        eq(base_stock(pid), before - 2, "factor 1 when off: 2 'Thùng' = 2 Lon")
        g = get_doc(old["id"])
        eq((g["lines"][0].get("factor"), g["lines"][0].get("base_qty")), (24, 24), "old line keeps factor (fields still shown)")
        # re-save WITH line ids (current UI) -> keeps
        b2 = put_body_from(g, note="sửa khi tắt (có id)")
        b2["lines"][0]["id"] = g["lines"][0]["id"]
        r = a.put(f"/documents/{old['id']}", b2)
        eq((r.status, r.json["lines"][0].get("factor")), (200, 24), "re-save with line id keeps factor when off")
        eq(base_stock(pid), before - 2, "stock unchanged by the re-save with id")
        # re-save WITHOUT line ids (base-edition client, API §3.4 'không gửi id') sending the same unit text 'Thùng':
        # a note-only edit must not change the posted quantity (spec §0: switching off never changes posted figures)
        g = get_doc(old["id"])
        r = a.put(f"/documents/{old['id']}", put_body_from(g, note="sửa khi tắt (không id)"))
        eq(r.status, 200, "re-save without line ids when off")
        eq(r.json["lines"][0].get("base_qty", r.json["lines"][0]["qty"]), 24, "note-only re-save keeps 24 Lon (got factor "
           f"{r.json['lines'][0].get('factor')})")
    finally:
        all_features_on()
    eq(base_stock(pid), before - 2, "stock unchanged by note-only re-saves")


@test("C10", "test_C10_import_product_units_and_transfer")
def _():
    a = admin()
    p = a.ok("POST", "/products", {"code": uid("UC"), "name": "Dây", "unit": "Mét", "sale_price": 10})
    hdr = ["Mã hàng", "Đơn vị", "Hệ số"]
    r = upload(a, "product_units", xlsx_bytes(hdr, [[p["code"], "Cuộn", "100"], [p["code"], "Đoạn", "2,5"]]), dry=False)
    eq(r.status, 200, "import units: " + errs_text(import_result(r)))
    eq(sorted((u["unit"], u["factor"]) for u in a.ok("GET", f"/products/{p['id']}/units")["items"]), [("Cuộn", 100), ("Đoạn", 2.5)], "imported")
    r = upload(a, "product_units", xlsx_bytes(hdr, [[p["code"], "Bó", "2.5"], ["KHONGCO", "X", 2], [p["code"], "mét", 3],
                                                   [p["code"], "Bó", 0], [p["code"], "Cuộn", 100], [p["code"], "CUỘN", 50], [p["code"], "Mẩu", "0,5"]]))
    errs = {e["row"] for e in import_result(r).get("errors") or []}
    for row, label in [(2, "'2.5' text (P6)"), (3, "unknown product"), (4, "same as base unit"), (5, "factor 0"), (7, "duplicate in file"), (8, "factor 0,5 < 1 (Q18)")]:
        check(row in errs, f"product_units import rejects {label}: {errs_text(import_result(r))[:300]}")
    # transfer in a converted unit moves base qty between warehouses
    k1, k2 = wh("KHO1"), wh("KHO2")
    posted("opening", "2019-06-01", k1, [L(p["id"], 1000, 1)])
    t = posted("transfer", "2019-06-02", k1, [L(p["id"], 3, unit="Cuộn")], None, k2)
    byw, tot = stock_of(p["id"], as_of="2019-06-02")
    eq((byw.get(k1), byw.get(k2), tot), (700, 300, 1000), "transfer 3 Cuộn = 300 Mét")
