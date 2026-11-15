"""Round 4: M-13 (to_warehouse_id), M-14 (factor >= 1, exact base qty), M-15/M-16 (LINE_IDS_REQUIRED / positional match).
API §11 (intro), QUYET_DINH Q17–Q19. Dates in 2016."""
from mr_lib import *


def units(pid, items):
    return admin().put(f"/products/{pid}/units", {"items": items})


def uprod(base="Lon", items=({"unit": "Thùng", "factor": 24},), sale=1000, purchase=0, vat=None):
    body = {"code": uid("R4"), "name": "Hàng vòng 4", "unit": base, "sale_price": sale, "purchase_price": purchase}
    if vat:
        body["vat_rate"] = vat
    p = admin().ok("POST", "/products", body)
    if items:
        r = units(p["id"], list(items))
        if r.status != 200:
            raise Fatal("units: " + r.short())
    return p


def figures(pids, partners, frm="2016-01-01", to="2016-12-31"):
    a = admin()
    out = {"stock": {pid: stock_of(pid)[1] for pid in pids}}
    for pid in partners:
        for side in ("receivable", "payable"):
            j = a.ok("GET", "/reports/debt-ledger", params={"partner_id": pid, "side": side})
            out[f"{pid}{side}"] = (j["closing"], [(r_["increase"], r_["decrease"]) for r_ in j["rows"]])
    for path in ("/reports/sales", "/reports/purchases"):
        j = a.ok("GET", path, params={"from": frm, "to": to, "include_returns": "true"})
        # (total_tax is absent when vat is off: base shape -> not compared)
        out[path] = (j["total_amount"], j["total_qty"], [(r_["qty"], r_.get("base_qty"), r_["amount"]) for r_ in j["rows"]])
    j = a.ok("GET", "/reports/profit", params={"from": frm, "to": to})
    out["profit"] = j["totals"]
    j = a.get("/reports/vat-summary", **{"from": frm, "to": to})
    if j.status == 200:  # 404 FEATURE_OFF while vat is switched off
        out["vat"] = json.dumps(j.json, sort_keys=True)
    out["nxt"] = [(i["product_id"], i["qty_in"], i["qty_out"], i["closing"]) for i in
                  a.ok("GET", "/reports/stock-nxt", params={"from": frm, "to": to})["items"] if i["product_id"] in pids]
    return out


def no_id_body(doc, **kw):
    """an 'old client' body: lines without id, without vat_rate (put_body_from sends unit + price)"""
    return put_body_from(doc, **kw)


def lids_err(r, label, doc_before):
    ok = expect_err(r, 400, "LINE_IDS_REQUIRED", label)
    g = get_doc(doc_before["id"])
    eq((g["version"], [(l["id"], l["qty"], l.get("unit"), l.get("vat_rate"), l["unit_price"]) for l in g["lines"]]),
       (doc_before["version"], [(l["id"], l["qty"], l.get("unit"), l.get("vat_rate"), l["unit_price"]) for l in doc_before["lines"]]),
       f"{label}: document untouched (version + lines)")
    return ok


# ------------------------------------------------------------------ M-13

@test("C9", "test_R4_M13_to_warehouse_only_on_transfer")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    p = mk_product(sale=10, purchase=5)
    c, s = mk_partner(cust=True), mk_partner(supp=True)
    posted("opening", "2016-01-01", k1, [L(p["id"], 100, 5)])
    for t, partner in [("sale", c), ("sale_return", c), ("purchase", s), ("purchase_return", s), ("opening", None), ("stocktake", None)]:
        b = doc_body(t, "2016-01-02", k1, [L(p["id"], 1, None if t == "stocktake" else 5) if t != "stocktake" else L(p["id"], 1)],
                     partner["id"] if partner else None, k2)
        if t == "stocktake":
            b["lines"] = [L(p["id"], 1)]
        r = a.post("/documents", b)
        eq(r.status, 400, f"{t} with to_warehouse_id -> 400")
        b["to_warehouse_id"] = None
        r = a.post("/documents", b)
        eq(r.status, 201, f"{t} with to_warehouse_id null -> 201")
        if r.status == 201:
            g = r.json
            eq(a.put(f"/documents/{g['id']}", {**put_body_from(g), "to_warehouse_id": k2}).status, 400, f"{t}: PUT adding to_warehouse_id -> 400")
            b0 = {**b, "to_warehouse_id": 0}
            r0 = a.post("/documents", b0)
            check(r0.status in (201, 400), f"{t}: to_warehouse_id 0 -> {r0.status}")
    eq(a.post("/documents", doc_body("transfer", "2016-01-02", k1, [L(p["id"], 1)], None, k2)).status, 201, "transfer still fine")


# ------------------------------------------------------------------ M-14

@test("C10", "test_R4_M14_factor_rules_and_exact_base_qty")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    c, s = mk_partner(cust=True), mk_partner(supp=True)
    g = uprod(base="Gram", items=[{"unit": "Kg", "factor": 1000}, {"unit": "Gói", "factor": 20.5}])
    for f_, ok in [(1, None), (0.5, False), (0.999999, False), (1.000001, True), (999999999, True)]:
        r = units(g["id"], [{"unit": "Kg", "factor": 1000}, {"unit": "Gói", "factor": 20.5}, {"unit": "Thử", "factor": f_}])
        if ok is None:
            check(r.status in (200, 400), f"factor exactly 1 -> {r.status}")
        else:
            eq(r.status, 200 if ok else 400, f"factor {f_}")
    units(g["id"], [{"unit": "Kg", "factor": 1000}, {"unit": "Gói", "factor": 20.5}])
    cases = [("0.5", "Kg", 500), ("0.001", "Kg", 1), ("0.125", "Kg", 125), ("1.0005", "Kg", 1001), ("0.002", "Gói", 0.041),
             ("0.001", "Gói", None), ("3", "Gói", 61.5), ("0.333", "Gói", None), ("2.5", None, 2.5)]
    for q_, unit_, want in cases:
        r = a.post("/documents", doc_body("purchase", "2016-02-01", k1, [L(g["id"], q_, 1, **({"unit": unit_} if unit_ else {}))], s["id"]))
        if want is None:
            check(r.status == 400, f"{q_} {unit_}: base not exact to 3 decimals -> 400, got {r.short()[:200]}")
            if r.status == 400:
                check("3" in r.json["error"]["message"] and has_vietnamese(r.json["error"]["message"]), f"message: {r.json['error']['message']}")
        else:
            l = r.json["lines"][0] if r.status == 201 else {}
            eq(l.get("base_qty"), want, f"{q_} {unit_} -> base {want}")
            if r.status == 201:
                eq(num(l["base_qty"]), num(l["qty"]) * num(l["factor"]), "base_qty == qty x factor exactly")
    # many small sales empty the stock exactly: buy 1.5 Kg, sell 12 x 0.125 Kg
    posted("purchase", "2016-02-02", k1, [L(g["id"], "1.5", 100000, unit="Kg")], s["id"])
    before = stock_of(g["id"])[1]
    for i in range(12):
        r = post_doc(draft("sale", "2016-02-03", k1, [L(g["id"], "0.125", 200000, unit="Kg")], c["id"]), True)
        if r.status != 200:
            fail(f"small sale {i + 1} -> {r.short()[:200]}")
    eq(stock_of(g["id"])[1], before - 1500, "12 x 125 g = 1500 g exactly")
    # returns / transfer / stocktake with units
    r = post_doc(draft("sale_return", "2016-02-04", k1, [L(g["id"], "0.25", 200000, unit="Kg")], c["id"]))
    eq(r.status, 200, "return 0.25 Kg")
    r = a.post("/documents", doc_body("transfer", "2016-02-05", k1, [L(g["id"], "0.0005", unit="Kg")], None, k2))
    if r.status == 201:
        eq(r.json["lines"][0]["base_qty"], 1, "0.0005 Kg: qty rounds to 0.001 (B12, half away) -> 1 g exact")
        a.delete(f"/documents/{r.json['id']}")
    print(f"      note: qty '1.0005' Kg is silently rounded to 1.001 Kg by the base 3-decimal rule before the exactness check")
    t = a.post("/documents", doc_body("transfer", "2016-02-05", k1, [L(g["id"], "0.1", unit="Kg")], None, k2))
    eq((t.status, t.json["lines"][0].get("base_qty") if t.status == 201 else None), (201, 100), "transfer 0.1 Kg = 100 g")
    eq(a.post("/documents", {"doc_type": "stocktake", "doc_date": "2016-02-06", "warehouse_id": k1, "lines": [L(g["id"], "0.001", unit="Gói")]}).status,
       400, "stocktake 0.001 Gói (0.0205 g) -> 400")
    st = a.post("/documents", {"doc_type": "stocktake", "doc_date": "2016-02-06", "warehouse_id": k1, "lines": [L(g["id"], "0.2", unit="Kg")]})
    eq((st.status, st.json["lines"][0].get("counted_qty") if st.status == 201 else None), (201, 200), "stocktake 0.2 Kg = 200 g")
    # import product_units refuses < 1
    r = upload(a, "product_units", xlsx_bytes(["Mã hàng", "Đơn vị", "Hệ số"], [[g["code"], "Hạt", "0,01"], [g["code"], "Bao", 50000]]))
    errs = {e["row"] for e in import_result(r).get("errors") or []}
    eq((2 in errs, 3 in errs), (True, False), f"import: 0,01 refused, 50000 ok: {errs_text(import_result(r))[:200]}")
    # unchanged stored line is not re-checked: posted Gói line re-saved with id (factor 20.5, qty 3 = 61.5 exact anyway)
    d = posted("purchase", "2016-02-07", k1, [L(g["id"], 3, 10, unit="Gói")], s["id"])
    gd = get_doc(d["id"])
    b = put_body_from(gd, note="sửa ghi chú")
    b["lines"][0]["id"] = gd["lines"][0]["id"]
    eq(a.put(f"/documents/{d['id']}", b).status, 200, "re-save stored unit line with id")


# ------------------------------------------------------------------ M-15 / M-16

def setup_doc(post=True, vat_on_line=True):
    a = admin()
    k1 = wh("KHO1")
    p = uprod(items=[{"unit": "Thùng", "factor": 24}])
    q = mk_product(sale=500, purchase=0)
    c = mk_partner(cust=True)
    posted("opening", "2016-03-01", k1, [L(p["id"], 1000, 0), L(q["id"], 1000, 0)])
    lines = [L(p["id"], 2, 24000, unit="Thùng", vat_rate=10 if vat_on_line else None), L(q["id"], 3, 500), L(p["id"], 5, 1000)]
    d = posted("sale", "2016-03-02", k1, lines, c["id"]) if post else draft("sale", "2016-03-02", k1, lines, c["id"])
    return p, q, c, get_doc(d["id"])


@test("C10", "test_R4_M15_M16_note_only_resave_without_ids_keeps_everything")
def _():
    a = admin()
    p, q, c, d = setup_doc()
    eq(d["total_amount"], 48000 + 4800 + 1500 + 5000, "setup total 59300")
    before = figures([p["id"], q["id"]], [c["id"]])
    for state in ({}, {"vat": False}, {"unit_conversion": False}, {"vat": False, "unit_conversion": False}):
        try:
            if state:
                set_features(**state)
            g = get_doc(d["id"])
            r = a.put(f"/documents/{d['id']}", no_id_body(g))
            eq(r.status, 200, f"features {state or 'all on'}: note-only re-save without ids")
            if r.status == 200:
                eq([(l["unit"], l.get("factor", 1), l.get("vat_rate"), l["unit_price"]) for l in r.json["lines"]],
                   [("Thùng", 24, 10, 24000), ("Cái", 1, None, 500), ("Lon", 1, None, 1000)], f"{state}: unit/factor/vat kept by position")
            after = figures([p["id"], q["id"]], [c["id"]])
            for k in before:
                if k in after:
                    eq(after[k], before[k], f"{state}: {k} unchanged")
        finally:
            all_features_on()


@test("C10", "test_R4_M15_M16_mismatch_is_refused_and_untouched")
def _():
    a = admin()
    p, q, c, d = setup_doc()
    g = get_doc(d["id"])
    b = no_id_body(g)
    lids_err(a.put(f"/documents/{d['id']}", {**b, "lines": [b["lines"][1], b["lines"][0], b["lines"][2]]}), "reordered", g)
    lids_err(a.put(f"/documents/{d['id']}", {**b, "lines": b["lines"][:2]}), "line dropped", g)
    lids_err(a.put(f"/documents/{d['id']}", {**b, "lines": b["lines"] + [L(q["id"], 1, 500)]}), "line added", g)
    b2 = no_id_body(g)
    b2["lines"][1]["product_id"] = p["id"]
    lids_err(a.put(f"/documents/{d['id']}", b2), "product changed at a position", g)
    if expect_err(a.put(f"/documents/{d['id']}", {**b, "lines": b["lines"][:2]}), 400, "LINE_IDS_REQUIRED", "msg"):
        check(has_vietnamese(a.put(f"/documents/{d['id']}", {**b, "lines": b["lines"][:2]}).json["error"]["message"]), "Vietnamese message")
    # same product twice in different units, positions kept: units stay per position; explicit unit swap is honoured
    b3 = no_id_body(g)
    r = a.put(f"/documents/{d['id']}", b3)
    eq(r.status, 200, "identical sequence with duplicate product (P Thùng, Q, P Lon)")
    if r.status == 200:
        eq([l["unit"] for l in r.json["lines"]], ["Thùng", "Cái", "Lon"], "units per position")
    # with ids everything is allowed (reorder / drop / add)
    g = get_doc(d["id"])
    ids = [l["id"] for l in g["lines"]]
    bi = put_body_from(g)
    for l, i in zip(bi["lines"], ids):
        l["id"] = i
    bi["lines"] = [bi["lines"][2], bi["lines"][0]]
    r = a.put(f"/documents/{d['id']}", bi)
    eq(r.status, 200, "reorder + drop WITH ids")
    if r.status == 200:
        eq([(l["unit"], l.get("vat_rate")) for l in r.json["lines"]], [("Lon", None), ("Thùng", 10)], "ids keep fields")


@test("C10", "test_R4_mixed_ids_and_plain_docs")
def _():
    """Mixed body: the line that carries the factor/VAT is sent WITHOUT id while another line keeps its id.
    The rule only covers 'all lines without id' -> the factor line becomes a new line: does it silently lose Thùng/VAT?"""
    a = admin()
    p, q, c, d = setup_doc()
    before = figures([p["id"], q["id"]], [c["id"]])
    g = get_doc(d["id"])
    b = put_body_from(g, note="trộn id")
    b["lines"][1]["id"] = g["lines"][1]["id"]       # Q keeps id; P lines (Thùng+VAT, Lon) go without id, unit sent, no vat_rate
    r = a.put(f"/documents/{d['id']}", b)
    if r.status == 200:
        got = [(l["unit"], l.get("factor", 1), l.get("vat_rate")) for l in r.json["lines"]]
        eq(got[0], ("Thùng", 24, 10), f"mixed ids: the id-less Thùng line keeps factor and VAT (got {got[0]})")
        after = figures([p["id"], q["id"]], [c["id"]])
        for k in ("stock", f"{c['id']}receivable"):
            eq(after[k], before[k], f"mixed ids: {k} unchanged by a note-only edit")
    else:
        check(r.status == 400, f"mixed ids -> {r.short()[:200]}")
    # plain document (no factor, no VAT, nothing masked) keeps the old behaviour: id-less lines = new lines, any order
    k1 = wh("KHO1")
    p2, q2 = mk_product(sale=1), mk_product(sale=2)
    posted("opening", "2016-03-01", k1, [L(p2["id"], 10, 0), L(q2["id"], 10, 0)])
    pd_ = posted("sale", "2016-03-03", k1, [L(p2["id"], 1, 1), L(q2["id"], 1, 2)], c["id"])
    g = get_doc(pd_["id"])
    b = put_body_from(g)
    b["lines"] = [b["lines"][1], b["lines"][0], L(p2["id"], 1, 1)]
    r = a.put(f"/documents/{pd_['id']}", b)
    eq(r.status, 200, "plain document: reorder + add without ids still allowed")
    if r.status == 200:
        check(all(l["id"] not in [x["id"] for x in g["lines"]] for l in r.json["lines"]), "plain: new line ids (old behaviour)")


@test("C11", "test_R4_vat_on_old_client_keeps_stored_rate")
def _():
    """The case not testable in round 3: VAT ON, line with an explicit 10% on a product whose default is none;
    old client re-saves without ids and without vat_rate -> positional match keeps 10%."""
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=0)
    c = mk_partner(cust=True)
    posted("opening", "2016-04-01", k1, [L(p["id"], 10, 0)])
    d = posted("sale", "2016-04-02", k1, [L(p["id"], 2, 100, vat_rate=10)], c["id"])
    g = get_doc(d["id"])
    r = a.put(f"/documents/{d['id']}", put_body_from(g, note="máy khách cũ"))
    eq(r.status, 200, "re-save")
    if r.status == 200:
        eq((r.json["lines"][0].get("vat_rate"), r.json["total_amount"]), (10, 220), "stored 10% kept with VAT on")
    eq(debt_closing(c["id"]), 220, "receivable unchanged")
    # a product default changed in between must not leak into the stored line either
    a.put(f"/products/{p['id']}", {**{k: g["lines"][0][k] for k in ()}, **{k: a.ok("GET", f"/products/{p['id']}")[k] for k in
                                   ("code", "name", "unit", "group_id", "sale_price", "purchase_price", "is_service", "active")}, "vat_rate": "5"})
    g = get_doc(d["id"])
    r = a.put(f"/documents/{d['id']}", put_body_from(g, note="sau khi đổi thuế mặc định"))
    if r.status == 200:
        eq(r.json["lines"][0].get("vat_rate"), 10, "product default changed to 5%: stored 10% kept")


@test("C1", "test_R4_masked_user_and_drafts_and_stocktake_without_ids")
def _():
    a = admin()
    k1 = wh("KHO1")
    p, q = mk_product(sale=10, purchase=111), mk_product(sale=10, purchase=222)
    s = mk_partner(supp=True)
    dr = draft("purchase", "2016-05-01", k1, [L(p["id"], 1, 5555), L(q["id"], 1, 6666)], s["id"])
    try:
        set_matrix({"thukho": ["stock.write", "purchase.write"]})
        tk = user("thukho")
        g = get_doc(dr["id"], tk)
        r = tk.put(f"/documents/{dr['id']}", put_body_from(g, note="thủ kho, không id"))
        eq(r.status, 200, "masked user re-saves draft without ids (same sequence)")
        eq([l["unit_price"] for l in get_doc(dr["id"])["lines"]], [5555, 6666], "masked prices kept by position")
        g = get_doc(dr["id"], tk)
        b = put_body_from(g)
        b["lines"] = [b["lines"][1], b["lines"][0]]
        r = tk.put(f"/documents/{dr['id']}", b)
        check(r.status == 400 and r.code == "LINE_IDS_REQUIRED", f"masked user reorders without ids -> {r.short()[:200]}")
        eq([l["unit_price"] for l in get_doc(dr["id"])["lines"]], [5555, 6666], "still kept")
        b["lines"] = b["lines"][:1]
        r = tk.put(f"/documents/{dr['id']}", b)
        check(r.status == 400, f"masked user drops a line without ids -> {r.status}")
    finally:
        restore_matrix()
    # stocktake with a unit line, re-saved without ids
    u = uprod(items=[{"unit": "Thùng", "factor": 24}])
    posted("opening", "2016-05-01", k1, [L(u["id"], 100, 0)])
    st = a.ok("POST", "/documents", {"doc_type": "stocktake", "doc_date": "2016-05-02", "warehouse_id": k1, "lines": [L(u["id"], 4, unit="Thùng")]})
    st = post_doc(st).json
    g = get_doc(st["id"])
    r = a.put(f"/documents/{st['id']}", put_body_from(g, note="kiểm kê, không id"))
    eq(r.status, 200, "stocktake re-save without ids")
    eq(stock_of(u["id"], as_of="2016-05-02")[1], 96, "stocktake still 4 Thùng = 96")
    # draft with VAT, no ids, lines [P Thùng 10%, Q, P Lon] reversed -> [P Lon, Q, P Thùng]: the PRODUCT sequence is the
    # same (P, Q, P) so positional matching applies, but every sent unit differs from the stored unit at its position.
    p3, q3, c3, d3 = setup_doc(post=False)
    b = no_id_body(d3)
    b["lines"] = list(reversed(b["lines"]))
    lids_err(a.put(f"/documents/{d3['id']}", b), "draft with a repeated product reversed without ids (units differ per position)", d3)
