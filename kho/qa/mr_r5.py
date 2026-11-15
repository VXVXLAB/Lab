"""Round 5: the single line-id rule (API §11 decision table, QUYET_DINH Q20). Every 'unintended' save must either be refused
with 400 LINE_IDS_REQUIRED leaving the document untouched, or keep totals / stock / debt. Dates in 2015."""
from mr_lib import *

_ctr = [0]


def mkdoc(post=True, doc_type="sale"):
    """[P 2 Thùng x 24000 VAT 10 ; Q 3 x 500 ; P 5 Lon x 1000 ; DV 'Phí' 100 VAT 10]  goods 54600, tax 4810, total 59410"""
    a = admin()
    k1 = wh("KHO1")
    p = a.ok("POST", "/products", {"code": uid("R5"), "name": "Bia R5", "unit": "Lon", "sale_price": 1000, "purchase_price": 0})
    a.put(f"/products/{p['id']}/units", {"items": [{"unit": "Thùng", "factor": 24}]})
    q = mk_product(sale=500, purchase=0)
    c = mk_partner(cust=True)
    posted("opening", "2015-01-01", k1, [L(p["id"], 1000, 0), L(q["id"], 1000, 0)])
    lines = [L(p["id"], 2, 24000, unit="Thùng", vat_rate=10), L(q["id"], 3, 500), L(p["id"], 5, 1000),
             {"product_code": "DV", "description": "Phí", "qty": 1, "unit_price": 100, "vat_rate": 10}]
    d = posted(doc_type, "2015-01-02", k1, lines, c["id"]) if post else draft(doc_type, "2015-01-02", k1, lines, c["id"])
    return p, q, c, get_doc(d["id"])


def state(d, p, q, c):
    g = get_doc(d["id"])
    return {"version": g["version"], "total": g["total_amount"], "tax": g.get("tax_amount"),
            "lines": [(l["product_id"], l["qty"], l.get("unit"), l.get("factor"), l.get("vat_rate"), l["unit_price"]) for l in g["lines"]],
            "stock": (stock_of(p["id"])[1], stock_of(q["id"])[1]), "debt": debt_closing(c["id"])}


INTENT = ("unit: null", "vat_rate: null everywhere")  # keys present (even null) = user intent per the decision table


def guard(label, send, d, p, q, c):
    """send(doc) -> Resp. Accept: 400 LINE_IDS_REQUIRED with nothing changed, or 200 with total/tax/stock/debt unchanged."""
    before = state(d, p, q, c)
    r = send(get_doc(d["id"]))
    after = state(d, p, q, c)
    if r.status == 400 and r.code == "LINE_IDS_REQUIRED":
        eq(after, before, f"{label}: refused and untouched")
    elif r.status == 200 and any(x in label for x in INTENT):
        check(True, f"{label}: accepted as explicit intent (table row 'khóa có mặt'); change documented in the report")
    elif r.status == 200:
        for k in ("total", "tax", "stock", "debt"):
            eq(after[k], before[k], f"{label}: accepted but {k} changed without being asked")
    else:
        check(r.status in (400, 409), f"{label}: unexpected {r.short()[:200]}")
        skip = ("version",) if r.status == 409 else ()   # the stale-version case bumps the version itself before sending
        eq({k: v for k, v in after.items() if k not in skip}, {k: v for k, v in before.items() if k not in skip},
           f"{label}: rejected ({r.status}) and untouched")
    return r


def body_ids(g, keep_ids=True, **kw):
    """modern-client body: every field explicit, ids on existing lines"""
    b = {k: g[k] for k in ("doc_type", "doc_date", "partner_id", "warehouse_id", "to_warehouse_id", "note")}
    b["version"] = g["version"]
    b["confirm_loss"] = True
    b["lines"] = []
    for l in g["lines"]:
        x = {"product_id": l["product_id"], "qty": l["qty"], "unit_price": l["unit_price"], "description": l["description"],
             "unit": l["unit"], "note": l["note"]}
        if "vat_rate" in l:
            x["vat_rate"] = l["vat_rate"]
        if keep_ids:
            x["id"] = l["id"]
        b["lines"].append(x)
    b.update(kw)
    return b


def strip(x, *keys):
    for k in keys:
        x.pop(k, None)
    return x


@test("C10", "test_R5_holes_in_the_line_id_rule")
def _():
    a = admin()
    cases = []

    def case(label):
        def deco(fn):
            cases.append((label, fn))
            return fn
        return deco

    # 1. mixed: Thùng line dropped, id-less P line given by product_CODE (not product_id), no vat_rate key
    @case("id-less same product via product_code, missing vat_rate")
    def _(g, p, q):
        b = body_ids(g)
        x = strip(dict(b["lines"][0]), "id", "vat_rate", "product_id")
        x["product_code"] = p["code"].lower()
        b["lines"][0] = x
        return a.put(f"/documents/{g['id']}", b)

    # 2. the special DV line (VAT) re-sent without id via 'DICHVU', no vat_rate key
    @case("DV special line id-less via DICHVU alias, missing vat_rate")
    def _(g, p, q):
        b = body_ids(g)
        x = strip(dict(b["lines"][3]), "id", "vat_rate", "product_id")
        x["product_code"] = "DICHVU"
        b["lines"][3] = x
        return a.put(f"/documents/{g['id']}", b)

    # 3. id of a line of ANOTHER document on the P Thùng line (API: foreign id = new line), keys missing
    @case("foreign line id on the special line, keys missing")
    def _(g, p, q):
        other = get_doc(mkdoc(post=False)[3]["id"])
        b = body_ids(g)
        b["lines"][0] = strip(dict(b["lines"][0], id=other["lines"][1]["id"]), "vat_rate", "unit")
        return a.put(f"/documents/{g['id']}", b)

    # 4. same id twice: P Thùng's id on both P lines (second = new line), the Lon line's own id not mentioned
    @case("same id twice (special id reused for the Lon line), keys missing on the 2nd")
    def _(g, p, q):
        b = body_ids(g)
        b["lines"][2] = strip(dict(b["lines"][2], id=b["lines"][0]["id"]), "vat_rate", "unit")
        return a.put(f"/documents/{g['id']}", b)

    # 5. ids of the same doc but swapped products: Q's id carried by the P Thùng line and vice versa, keys missing
    @case("ids swapped between products, keys missing")
    def _(g, p, q):
        b = body_ids(g)
        i0, i1 = b["lines"][0]["id"], b["lines"][1]["id"]
        b["lines"][0] = strip(dict(b["lines"][0], id=i1), "vat_rate", "unit")
        b["lines"][1] = strip(dict(b["lines"][1], id=i0), "vat_rate", "unit")
        return a.put(f"/documents/{g['id']}", b)

    # 6. explicit unit: null on the id-less replacement (key present -> 'user intent') : does null mean base unit?
    @case("id-less replacement with unit: null and vat_rate: null")
    def _(g, p, q):
        b = body_ids(g)
        b["lines"][0] = dict(strip(dict(b["lines"][0]), "id"), unit=None, vat_rate=None)
        return a.put(f"/documents/{g['id']}", b)

    # 7. all lines id-less, same sequence, unit omitted but vat_rate null explicit (old client that nulls unknown keys)
    @case("all id-less, same sequence, vat_rate: null everywhere")
    def _(g, p, q):
        b = body_ids(g, keep_ids=False)
        for x in b["lines"]:
            x["vat_rate"] = None
            x.pop("unit")
        return a.put(f"/documents/{g['id']}", b)

    # 8. id on a line with id given as a string / float
    @case("line ids as strings")
    def _(g, p, q):
        b = body_ids(g)
        for x in b["lines"]:
            x["id"] = str(x["id"])
            strip(x, "vat_rate", "unit")
        return a.put(f"/documents/{g['id']}", b)

    # 9. wrong-typed keys
    for lbl, patch in [("unit: 123", {"unit": 123}), ("vat_rate: '10'", {"vat_rate": "10"}), ("vat_rate: true", {"vat_rate": True}),
                       ("unit: []", {"unit": []}), ("id: -1", {"id": -1}), ("id: 1.5", {"id": 1.5})]:
        @case(f"wrong type {lbl}")
        def _(g, p, q, patch=patch):
            b = body_ids(g)
            b["lines"][0].update(patch)
            return a.put(f"/documents/{g['id']}", b)

    # 10. stale version + LINE_IDS-violating body -> version conflict must win
    @case("stale version + bad shape")
    def _(g, p, q):
        b = body_ids(g, keep_ids=False)
        b["lines"] = list(reversed(b["lines"]))
        ok = a.put(f"/documents/{g['id']}", body_ids(g, note="làm cũ version"))   # bump version -> g is now stale
        check(ok.status == 200, "bump version")
        b["version"] = g["version"]
        r = a.put(f"/documents/{g['id']}", b)
        check(r.status == 409 and r.code == "VERSION_CONFLICT", f"stale version must give 409 first, got {r.short()[:150]}")
        return r

    for post in (True, False):
        for label, fn in cases:
            p, q, c, d = mkdoc(post=post)
            if post:
                eq((d["goods_amount"], d["tax_amount"], d["total_amount"]), (54600, 4810, 59410), "fixture totals")
            r = guard(f"[{'posted' if post else 'draft'}] {label}", lambda g, fn=fn: fn(g, p, q), d, p, q, c)
            print(f"      [{'posted' if post else 'draft'}] {label}: {r.status} {r.code or ''}")


@test("C10", "test_R5_modern_client_always_accepted")
def _():
    """ids on existing lines + explicit keys on new lines: reorder, drop, add, change unit/vat explicitly."""
    a = admin()
    p, q, c, d = mkdoc()
    g = get_doc(d["id"])
    b = body_ids(g, note="đảo, bỏ, thêm")
    b["lines"] = [b["lines"][2], b["lines"][0], b["lines"][3],
                  {"product_id": q["id"], "qty": 1, "unit_price": 500, "unit": "Cái", "vat_rate": 5, "description": "", "note": ""}]
    r = a.put(f"/documents/{g['id']}", b)
    eq(r.status, 200, "reorder + drop Q + add new Q with explicit keys")
    if r.status == 200:
        eq([(l["unit"], l.get("vat_rate")) for l in r.json["lines"]], [("Lon", None), ("Thùng", 10), ("", 10), ("Cái", 5)], "fields as sent")
        # 5000 + 48000 + 100 + 500 ; tax 4800 + 10 + 25
        eq((r.json["goods_amount"], r.json["tax_amount"], r.json["total_amount"]), (53600, 4835, 58435), "totals recomputed as asked")
    g = get_doc(d["id"])
    b = body_ids(g)
    b["lines"][0]["unit"] = "Lon"          # explicit unit change on an id-ed line
    b["lines"][1]["vat_rate"] = None       # explicit removal of VAT on an id-ed line
    r = a.put(f"/documents/{g['id']}", b)
    eq(r.status, 200, "explicit changes on id-ed lines")
    if r.status == 200:
        eq((r.json["lines"][0]["unit"], r.json["lines"][0]["base_qty"], r.json["lines"][1].get("vat_rate")), ("Lon", 5, None), "applied")
    # duplicates of the same product in different units, modern client swaps the two P lines by id: fields follow ids
    p2, q2, c2, d2 = mkdoc()
    g = get_doc(d2["id"])
    b = body_ids(g)
    b["lines"] = [b["lines"][2], b["lines"][1], b["lines"][0], b["lines"][3]]
    r = a.put(f"/documents/{g['id']}", b)
    eq(r.status, 200, "swap duplicate-product lines by id")
    if r.status == 200:
        eq((r.json["total_amount"], [l["unit"] for l in r.json["lines"]]), (59410, ["Lon", "Cái", "Thùng", ""]), "fields follow ids, total same")


@test("C1", "test_R5_masked_unit_price_null_absent_typed")
def _():
    a = admin()
    k1 = wh("KHO1")
    P = mk_product(sale=10, purchase=111)
    S = mk_partner(supp=True)
    try:
        set_matrix({"thukho": ["stock.write", "purchase.write", "posted.edit"]})
        tk = user("thukho")
        for variant, extra, expect in [("null", {"unit_price": None}, "400"), ("absent", {}, 111), ("typed 7", {"unit_price": 7}, 7)]:
            d = draft("purchase", "2015-02-01", k1, [L(P["id"], 1, 5555)], S["id"])
            g = get_doc(d["id"], tk)
            b = {k: g[k] for k in ("doc_type", "doc_date", "partner_id", "warehouse_id", "note")}
            b.update(version=g["version"], lines=[{"product_id": P["id"], "qty": 2, **extra}, {"product_id": P["id"], "qty": 1, "id": 999999999}])
            # line 1: id-less same product as the dropped priced line ; line 2: foreign id
            r = tk.put(f"/documents/{d['id']}", b)
            prices = [l["unit_price"] for l in get_doc(d["id"])["lines"]]
            if expect == "400":
                check(r.status == 400 and r.code == "LINE_IDS_REQUIRED", f"masked {variant}: expected LINE_IDS_REQUIRED, got {r.short()[:150]}")
                eq(prices, [5555], f"masked {variant}: untouched")
            else:
                eq(r.status, 200, f"masked {variant}")
                print(f"      masked {variant}: stored prices {prices}")
                check(prices[0] == expect, f"masked {variant}: first line price {prices[0]} (expected {expect})")
                check(prices[1] != 5555, "foreign-id line never inherits the hidden price")
        # posted purchase: masked user may not edit at all (P2) - also with id-less bodies
        pd_ = posted("purchase", "2015-02-02", k1, [L(P["id"], 1, 5555)], S["id"])
        g = get_doc(pd_["id"], tk)
        expect_err(tk.put(f"/documents/{pd_['id']}", put_body_from(g)), 403, "FORBIDDEN", "masked id-less PUT on posted purchase")
    finally:
        restore_matrix()


@test("C9", "test_R5_stocktake_transfer_and_feature_toggle_between_load_and_save")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    p = a.ok("POST", "/products", {"code": uid("R5"), "name": "Bia", "unit": "Lon", "sale_price": 1})
    a.put(f"/products/{p['id']}/units", {"items": [{"unit": "Thùng", "factor": 24}]})
    posted("opening", "2015-03-01", k1, [L(p["id"], 1000, 0)])
    st = post_doc(a.ok("POST", "/documents", {"doc_type": "stocktake", "doc_date": "2015-03-02", "warehouse_id": k1,
                                              "lines": [L(p["id"], 40, unit="Thùng")]})).json
    tr = posted("transfer", "2015-03-03", k1, [L(p["id"], 2, unit="Thùng")], None, k2)
    before = stock_of(p["id"], as_of="2015-03-03")[0]
    for d, label in [(st, "stocktake"), (tr, "transfer")]:
        g = get_doc(d["id"])
        b = put_body_from(g)
        for x in b["lines"]:
            x.pop("unit")
        r = a.put(f"/documents/{d['id']}", b)
        eq(r.status, 200, f"{label}: all id-less, unit omitted, same sequence")
        b = put_body_from(get_doc(d["id"]))
        b["lines"] = [dict(b["lines"][0], unit="Lon")]
        r = a.put(f"/documents/{d['id']}", b)
        check(r.status == 400 and r.code == "LINE_IDS_REQUIRED", f"{label}: id-less with a different unit -> {r.short()[:150]}")
    eq(stock_of(p["id"], as_of="2015-03-03")[0], before, "stock by warehouse unchanged")
    # loaded with VAT on, saved after VAT was switched off (modern client sends ids + the loaded vat_rate)
    pp, q, c, d = mkdoc()
    g = get_doc(d["id"])
    try:
        set_features(vat=False, unit_conversion=False)
        r = a.put(f"/documents/{d['id']}", body_ids(g, note="lưu sau khi tắt"))
        eq(r.status, 200, "loaded with features on, saved after off (same values)")
        if r.status == 200:
            eq(r.json["total_amount"], 59410, "total kept")
        g2 = get_doc(d["id"])
        b = body_ids(g2)
        b["lines"].append({"product_id": q["id"], "qty": 1, "unit_price": 500, "vat_rate": 10, "unit": "Cái"})
        r = a.put(f"/documents/{d['id']}", b)
        eq(r.status, 400, "new line with a VAT rate while vat is off -> 400")
        eq(get_doc(d["id"])["version"], g2["version"], "untouched")
    finally:
        all_features_on()


@test("C10", "test_R5_concurrent_saves_version_wins")
def _():
    a = admin()
    for i in range(3):
        p, q, c, d = mkdoc()
        g = get_doc(d["id"])
        good = body_ids(g, note=f"máy A {i}")
        bad = body_ids(g, keep_ids=False)
        bad["lines"] = list(reversed(bad["lines"]))
        other = body_ids(g, note=f"máy B {i}")
        res = run_parallel([lambda: raw_client(a).put(f"/documents/{g['id']}", good),
                            lambda: raw_client(user("ketoan")).put(f"/documents/{g['id']}", other),
                            lambda: raw_client(a).put(f"/documents/{g['id']}", bad)])
        sts = sorted((r.status, r.code) for r in res if not isinstance(r, Exception))
        oks = [s for s in sts if s[0] == 200]
        eq(len(oks), 1, f"round {i}: exactly one of two same-version saves wins: {sts}")
        check(all(s[0] in (200, 400, 409) for s in sts), f"no 5xx: {sts}")
        eq(get_doc(d["id"])["version"], g["version"] + 1, "version +1 only")
        eq(get_doc(d["id"])["total_amount"], 59410, "total intact")
