"""C11 — VAT on documents (SPEC_MO_RONG C11, API §11.3, QUYET_DINH Q5–Q8). Dates in 2018."""
from mr_lib import *

DV = {"product_code": "DV"}


def dv(desc, price, rate):
    return {"product_code": "DV", "description": desc, "qty": 1, "unit_price": price, "vat_rate": rate}


def set_default_vat(v):
    return admin().put("/settings/vat", {"default_vat_rate": v})


def snapshot(pids, partners):
    """JSON of figures that must not move when vat is toggled (generated_at stripped)."""
    a = admin()
    out = {}
    for pid in partners:
        for side in ("receivable", "payable"):
            out[f"ledger{pid}{side}"] = a.ok("GET", "/reports/debt-ledger", params={"partner_id": pid, "side": side})
    for path, params in [("/reports/sales", {"from": "2018-01-01", "to": "2018-12-31", "include_returns": "true"}),
                         ("/reports/purchases", {"from": "2018-01-01", "to": "2018-12-31", "include_returns": "true"}),
                         ("/reports/debt-summary", {"side": "receivable"}), ("/reports/debt-summary", {"side": "payable"}),
                         ("/reports/stock-summary", {"as_of": "2018-12-31"}), ("/reports/debt-aging", {"as_of": "2018-12-31"}),
                         ("/reports/profit", {"from": "2018-01-01", "to": "2018-12-31"})]:
        j = a.ok("GET", path, params=params)
        j.pop("generated_at", None)
        out[path + json.dumps(params)] = j
    d = a.ok("GET", "/dashboard")
    for k in ("generated_at", "today", "recent_drafts", "low_stock_rule"):
        d.pop(k, None)
    out["dashboard"] = d
    return out


@test("C11", "test_C11_line_rounding_mixed_rates_totals_and_words")
def _():
    """goods 15@10% -> 1.5 -> 2 ; 25@10% -> 2.5 -> 3 ; DV -25@10% -> -2.5 -> -3 (half away from zero) ; 30@5% -> 1.5 -> 2 ;
    3x100@8% -> 24 ; 100@0% -> 0 ; 100 null -> 0.  goods 545, tax 28, total 573."""
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=0)
    posted("opening", "2018-01-01", k1, [L(p["id"], 100, 0)])
    c = mk_partner(cust=True)
    lines = [L(p["id"], 1, 15, vat_rate=10), L(p["id"], 1, 25, vat_rate=10), dv("Chiết khấu", -25, 10), L(p["id"], 1, 30, vat_rate=5),
             L(p["id"], 3, 100, vat_rate=8), L(p["id"], 1, 100, vat_rate=0), L(p["id"], 1, 100, vat_rate=None)]
    d = draft("sale", "2018-01-10", k1, lines, c["id"])
    eq([l.get("tax_amount") for l in d["lines"]], [2, 3, -3, 2, 24, 0, 0], "per-line tax, half away from zero")
    eq([l.get("vat_rate") for l in d["lines"]], [10, 10, 10, 5, 8, 0, None], "rates incl. 0 vs null")
    eq([l.get("amount_with_tax") for l in d["lines"]], [17, 28, -28, 32, 324, 100, 100], "amount_with_tax")
    eq((d.get("goods_amount"), d.get("tax_amount"), d.get("total_amount")), (545, 28, 573), "goods / tax / grand total")
    eq(d.get("amount_in_words"), "Năm trăm bảy mươi ba đồng", "amount in words of the grand total")
    for fmt in ("xlsx", "docx"):
        r = admin().get(f"/documents/{d['id']}/export", format=fmt)
        txt = file_text(r.content)
        for lab in ("Thuế suất", "Tiền thuế", "Cộng tiền hàng", "Tổng thanh toán", "Năm trăm bảy mươi ba đồng"):
            check(lab in txt, f"{fmt}: '{lab}' present")
        if fmt == "xlsx":
            nums = xlsx_numbers(r.content)
            for v in (545, 28, 573, 24, -3):
                check(any(abs(x - v) < 0.001 for x in nums), f"xlsx numeric {v}")
            wb = open_xlsx_values(r.content)
            check(not any(isinstance(c.value, str) and c.value.strip() in ("573", "545", "28") for ws in wb.worksheets
                          for row in ws.iter_rows() for c in row), "totals are numbers, not text")


@test("C11", "test_C11_defaults_product_and_global_and_disallowed")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    c = mk_partner(cust=True)
    p8 = a.ok("POST", "/products", {"code": uid("VT"), "name": "Thuế 8", "unit": "Cái", "sale_price": 100, "vat_rate": "8"})
    pk = a.ok("POST", "/products", {"code": uid("VT"), "name": "KCT", "unit": "Cái", "sale_price": 100, "vat_rate": "KCT"})
    pn = a.ok("POST", "/products", {"code": uid("VT"), "name": "Theo chung", "unit": "Cái", "sale_price": 100})
    for bad in ["7", "11", 10, "abc", "-5"]:
        r = a.post("/products", {"code": uid("VT"), "name": "x", "unit": "c", "vat_rate": bad})
        check(r.status == 400 or (bad == 10 and r.status == 201), f"product vat_rate {bad!r} -> {r.status}")
    try:
        eq(set_default_vat("10").status, 200, "default 10")
        expect_err(user("ketoan").put("/settings/vat", {"default_vat_rate": "5"}), 403, "FORBIDDEN", "ketoan sets default vat")
        eq(set_default_vat("9").status, 400, "default 9 rejected")
        d = draft("sale", "2018-02-01", k1, [L(p8["id"], 1, 100), L(pk["id"], 1, 100), L(pn["id"], 1, 100), L(pn["id"], 1, 100, vat_rate=5)], c["id"])
        eq([l.get("vat_rate") for l in d["lines"]], [8, None, 10, 5], "product rate / KCT / global default / explicit")
        set_default_vat("KCT")
        d = draft("sale", "2018-02-01", k1, [L(pn["id"], 1, 100)], c["id"])
        eq(d["lines"][0].get("vat_rate"), None, "global KCT -> no tax")
    finally:
        set_default_vat(None)
    for t, extra in [("transfer", {"to_warehouse_id": k2}), ("opening", {}), ("stocktake", {})]:
        b = {"doc_type": t, "doc_date": "2018-02-02", "warehouse_id": k1, "lines": [L(pn["id"], 1, vat_rate=10)], **extra}
        r = a.post("/documents", b)
        eq(r.status, 400, f"vat_rate on {t} -> 400")
    for bad in [7, "abc", -10, 100]:
        r = a.post("/documents", doc_body("sale", "2018-02-02", k1, [L(pn["id"], 1, 100, vat_rate=bad)], c["id"]))
        eq(r.status, 400, f"line vat_rate {bad!r}")
    r = a.post("/documents", doc_body("sale", "2018-02-02", k1, [L(pn["id"], 1, 100, vat_rate="10")], c["id"]))
    check(r.status in (201, 400), f"vat_rate '10' as string -> {r.status}")


@test("C11", "test_C11_debt_uses_grand_total_both_sides_and_credit_loss_profit_pretax")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=50)
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    pu = posted("purchase", "2018-03-01", k1, [L(p["id"], 10, 100, vat_rate=10)], s["id"])   # 1000 + 100
    eq(pu["total_amount"], 1100, "purchase grand total")
    posted("purchase_return", "2018-03-02", k1, [L(p["id"], 1, 100, vat_rate=10)], s["id"])  # -110
    eq(debt_closing(s["id"], "payable"), 990, "payable = 1100 - 110")
    s1 = posted("sale", "2018-03-03", k1, [L(p["id"], 2, 105, vat_rate=10)], c["id"])       # 210 + 21 ; 105 > 100 cost pre-tax -> no loss
    eq(s1.get("warnings"), [], "no loss: pre-tax 105 vs cost 100 (with-tax cost would be 110)")
    eq(s1["total_amount"], 231, "sale grand total")
    posted("sale_return", "2018-03-04", k1, [L(p["id"], 1, 105, vat_rate=10)], c["id"])      # -(105 + 11) = -116 (10.5 -> 11)
    eq(debt_closing(c["id"]), 115, "receivable 231 - 116")
    s2 = draft("sale", "2018-03-05", k1, [L(p["id"], 1, 105, vat_rate=10)], c["id"])
    g = get_doc(s2["id"])
    eq((g["old_debt"], g["total_debt"]), (115, 231), "Nợ cũ / Tổng nợ use grand totals (115 + 116)")
    # credit limit uses the grand total: limit 230, receivable 115 + 116 = 231 > 230
    set_partner(c["id"], credit_limit=230)
    r = post_doc(g)
    if expect_err(r, 409, "CREDIT_WARNING", "credit uses grand total"):
        eq((r.details["credit"]["document_amount"], r.details["credit"]["over"]), (116, 1), "document_amount incl. tax")
    set_partner(c["id"], credit_limit=None)
    post_doc(get_doc(s2["id"]))
    # profit pre-tax: avg cost 100 (pre-tax purchase), revenue pre-tax
    pr = profit(group_by="document", **{"from": "2018-03-03", "to": "2018-03-05"})
    rows = {x["document_id"]: x for x in pr["items"]}
    eq((rows[s1["id"]]["revenue"], rows[s1["id"]]["cost"]), (210, 200), "profit pre-tax revenue and cost")
    # dashboard revenue pre-tax: compare sales report amount (pre-tax) for today is not testable on 2018 -> sales report columns
    rep = a.ok("GET", "/reports/sales", params={"from": "2018-03-03", "to": "2018-03-05", "partner_id": c["id"], "include_returns": "true"})
    eq((rep["total_amount"], rep.get("total_tax"), rep.get("total_with_tax")), (210, 21 - 11 + 11, 210 + 21), "sales report pre-tax / tax / with tax")
    row = rep["rows"][0]
    eq((row["amount"], row.get("vat_rate"), row.get("tax_amount"), row.get("amount_with_tax")), (210, 10, 21, 231), "sales report row")
    vs = rep.get("vat_summary") or []
    check(any(x.get("vat_rate") == 10 and num(x.get("tax_amount")) == 21 for x in vs), f"report vat_summary: {vs}")


@test("C11", "test_C11_vat_summary_equals_documents_and_masking")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=0)
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    posted("opening", "2018-04-01", k1, [L(p["id"], 1000, 0)])
    docs = [posted("sale", "2018-04-02", k1, [L(p["id"], 3, 101, vat_rate=10), L(p["id"], 1, 333, vat_rate=8), L(p["id"], 1, 50, vat_rate=None)], c["id"]),
            posted("sale", "2018-04-03", k1, [L(p["id"], 7, 99, vat_rate=10), dv("Phí", 40, 5)], c["id"]),
            posted("sale_return", "2018-04-04", k1, [L(p["id"], 1, 101, vat_rate=10)], c["id"])]
    pu = posted("purchase", "2018-04-05", k1, [L(p["id"], 2, 77, vat_rate=8)], s["id"])
    exp = {}
    for d in docs:
        sign = -1 if d["doc_type"] == "sale_return" else 1
        for l in d["lines"]:
            k = l.get("vat_rate")
            e = exp.setdefault(k, [D(0), D(0)])
            e[0] += sign * num(l["amount"])
            e[1] += sign * num(l["tax_amount"])
    vs = a.ok("GET", "/reports/vat-summary", params={"from": "2018-04-01", "to": "2018-04-04"})
    got = {r.get("vat_rate"): (num(r["goods_amount"]), num(r["tax_amount"]), num(r["total"])) for r in vs["sales"]["rows"]}
    for k, (g, t) in exp.items():
        eq(got.get(k), (g, t, g + t), f"vat-summary sales rate {k}")
    eq(num(vs["sales"]["totals"]["tax_amount"]), sum(e[1] for e in exp.values()), "sales tax total")
    vs2 = a.ok("GET", "/reports/vat-summary", params={"from": "2018-04-05", "to": "2018-04-05"})
    pr = {r.get("vat_rate"): r for r in (vs2.get("purchases") or {}).get("rows", [])}
    eq((pr.get(8) or {}).get("tax_amount"), 12, "purchase 154 @8% -> 12.32 -> 12")
    eq(a.get("/reports/vat-summary", format="xlsx").status, 200, "xlsx")
    # masking
    bh = user("banhang")
    j = bh.ok("GET", "/reports/vat-summary", params={"from": "2018-04-01", "to": "2018-04-05"})
    eq(j.get("purchases"), None, "banhang: purchases part null")
    pd_ = bh.ok("GET", f"/documents/{pu['id']}")
    for k in ("goods_amount", "tax_amount", "amount_in_words", "total_amount"):
        eq(pd_.get(k), None, f"banhang purchase {k} masked")
    check(all(l.get("tax_amount") is None and l.get("amount_with_tax") is None for l in pd_["lines"]), "purchase line tax masked")
    check(not find_secrets(json.dumps(pd_, ensure_ascii=False), [166, 154]), "no purchase figures")
    txt = file_text(bh.get(f"/documents/{pu['id']}/export", format="xlsx").content)
    check("166" not in txt and "Một trăm sáu mươi sáu" not in txt, "purchase export: no tax total / words for banhang")
    expect_err(user("thukho").get("/reports/vat-summary"), 403, "FORBIDDEN", "thukho vat-summary (report.view)")


@test("C11", "test_C11_toggle_vat_keeps_every_figure_and_feature_off_rules")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=0)
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    posted("opening", "2018-05-01", k1, [L(p["id"], 100, 0)])
    sd = posted("sale", "2018-05-02", k1, [L(p["id"], 2, 100, vat_rate=10)], c["id"])
    posted("purchase", "2018-05-03", k1, [L(p["id"], 1, 50, vat_rate=8)], s["id"])
    before = snapshot([p["id"]], [c["id"], s["id"]])
    try:
        eq(set_features(vat=False).status, 200, "vat off")
        mid = snapshot([p["id"]], [c["id"], s["id"]])
        for k in before:
            check(before[k] == mid[k], f"vat off: {k} changed")
        g = get_doc(sd["id"])
        eq((g.get("tax_amount"), g["total_amount"]), (20, 220), "old taxed doc still shows tax when off")
        expect_err(a.get("/reports/vat-summary"), 404, "FEATURE_OFF", "vat-summary off")
        expect_err(a.get("/settings/vat"), 404, "FEATURE_OFF", "settings/vat off")
        n = draft("sale", "2018-05-04", k1, [L(p["id"], 1, 100)], c["id"])
        check("vat_rate" not in n["lines"][0] and "tax_amount" not in n, f"new doc without vat fields when off: {sorted(n)}")
        eq(n["total_amount"], 100, "no tax")
        # re-save with id keeps the rate; another rate -> 400
        b = put_body_from(g)  # same note: the ledger description carries the note
        b["lines"][0]["id"] = g["lines"][0]["id"]
        b["lines"][0].pop("vat_rate", None)
        r = a.put(f"/documents/{g['id']}", b)
        eq((r.status, r.json["lines"][0].get("vat_rate"), r.json["total_amount"]), (200, 10, 220), "re-save keeps tax")
        g = get_doc(sd["id"])
        b = put_body_from(g)
        b["lines"][0]["id"] = g["lines"][0]["id"]
        b["lines"][0]["vat_rate"] = 5
        eq(a.put(f"/documents/{g['id']}", b).status, 400, "other rate while off -> 400")
        eq(set_features(vat=True).status, 200, "vat on")
        a.delete(f"/documents/{n['id']}")
        after = snapshot([p["id"]], [c["id"], s["id"]])
        for k in before:
            if k.startswith("ledger") or "debt" in k or "stock" in k:
                check(before[k] == after[k], f"off->on: {k} changed")
        eq(get_doc(sd["id"])["tax_amount"], 20, "on again: tax not recomputed")
    finally:
        all_features_on()


@test("C11", "test_C11_off_resave_without_line_ids_keeps_posted_tax")
def _():
    """API §3.4: a client may omit line ids. With vat OFF, a note-only re-save of a posted taxed sale (base-edition style
    body: same lines, no ids, no vat_rate) must not change the posted grand total / receivable (spec §0)."""
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=0)
    c = mk_partner(cust=True)
    posted("opening", "2018-06-01", k1, [L(p["id"], 10, 0)])
    sd = posted("sale", "2018-06-02", k1, [L(p["id"], 2, 100, vat_rate=10)], c["id"])
    try:
        set_features(vat=False)
        g = get_doc(sd["id"])
        b = put_body_from(g, note="máy khách không gửi id dòng")
        for l in b["lines"]:
            l.pop("vat_rate", None)
        r = a.put(f"/documents/{g['id']}", b)
        eq(r.status, 200, "re-save")
        eq(r.json["total_amount"] if r.status == 200 else None, 220, "posted grand total kept (was 220)")
        eq(debt_closing(c["id"]), 220, "receivable unchanged")
    finally:
        all_features_on()
