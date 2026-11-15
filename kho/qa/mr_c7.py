"""C7 — gross profit with weighted-average cost (SPEC_MO_RONG C7, API §9.4, QUYET_DINH O6). Uses dates in 2025."""
from mr_lib import *

_w = {}
R25 = {"from": "2025-01-01", "to": "2025-01-31"}  # the hand-computed scenario lives in January 2025


def world():
    """Hand-computed scenario under the MOVING weighted average (SPEC_MO_RONG C7 rewritten, QUYET_DINH P1).
    All in January 2025 (nobody else uses it). Same day: inbound first, then outbound.
    X: 01-01 opening 10@40 (q10 v400) ; 01-05 purchase 10@60 (+DV freight, ignored) -> q20 v1000 avg 50 ;
       01-08 back-dated purchase 5@30 (posted last) -> q25 v1150 avg 46 ; 01-10 sale 5 -> cost 230, q20 v920 ;
       01-15 purchase 5@90 -> q25 v1370 ; 01-16 supplier return 2@64 (=128) -> q23 v1242 avg 54 ;
       01-20 sale 3 -> cost 162, q20 v1080 ; 01-25 customer return 1 -> re-enters at avg 54 -> cost -54.
       (return price 64 chosen so the average stays an integer: rounding of the removed value cannot matter)
    Y: only stock source = customer return 2024-12-31 (not an inbound) -> sale 01-22 2@100 cost 2x70=140, estimated.
    Z: purchase 2@50, supplier return 2@50 -> q0 v0 ; opening 01-29 1@0 (qty was 0 -> avg = 0) ; sale 01-30 -> cost 0.
    Totals: revenue 1200, cost 230+162+140-54+0 = 478, profit 722, margin 60.17.
    """
    if _w:
        return _w
    a = admin()
    k1, k2, k3, k4 = W()
    X = mk_product(sale=100, purchase=50, name="Lãi gộp X")
    Y = mk_product(sale=100, purchase=70, name="Lãi gộp Y")
    Z = mk_product(sale=100, purchase=80, name="Lãi gộp Z")
    S = mk_partner(supp=True)
    K1, K2 = mk_partner(cust=True, name="Khách lãi 1"), mk_partner(cust=True, name="Khách lãi 2")
    x, y, z = X["id"], Y["id"], Z["id"]
    posted("opening", "2025-01-01", k1, [L(x, 10, 40)])
    posted("purchase", "2025-01-05", k2, [L(x, 10, 60), {"product_code": "DV", "description": "Cước xe", "qty": 1, "unit_price": 1000}], S["id"])
    draft("purchase", "2025-01-02", k1, [L(x, 100, 1)], S["id"])
    posted("purchase", "2025-01-15", k2, [L(x, 5, 90)], S["id"])
    posted("purchase_return", "2025-01-16", k2, [L(x, 2, 64)], S["id"])
    posted("transfer", "2025-01-06", k1, [L(x, 3)], None, k3)
    # Y stock without any "input" for cost: a customer return (not an input for cost), dated before the 2025 range
    posted("sale_return", "2024-12-31", k4, [L(y, 5, 100)], K2["id"])
    posted("purchase", "2025-01-03", k4, [L(z, 2, 50)], S["id"])
    posted("purchase_return", "2025-01-04", k4, [L(z, 2, 50)], S["id"])
    posted("opening", "2025-01-29", k4, [L(z, 1, 0)])
    d1 = posted("sale", "2025-01-10", k1, [L(x, 5, 100), {"product_code": "DV", "description": "Phí lắp", "qty": 1, "unit_price": 200}], K1["id"])
    d2 = posted("sale", "2025-01-20", k2, [L(x, 3, 100)], K1["id"])
    d3 = posted("sale", "2025-01-22", k4, [L(y, 2, 100)], K2["id"])
    d4 = posted("sale_return", "2025-01-25", k2, [L(x, 1, 100)], K1["id"])
    d5 = posted("sale", "2025-01-30", k4, [L(z, 1, 100)], K2["id"])
    draft("sale", "2025-01-11", k1, [L(x, 1, 100)], K1["id"])
    # back-dated purchase posted last
    posted("purchase", "2025-01-08", k1, [L(x, 5, 30)], S["id"])
    _w.update(X=X, Y=Y, Z=Z, S=S, K1=K1, K2=K2, d1=d1, d2=d2, d3=d3, d4=d4, d5=d5)
    # expected per document: revenue, cost, estimated
    _w["exp_docs"] = {d1["id"]: (700, 230, False), d2["id"]: (300, 162, False), d3["id"]: (200, 140, True),
                      d4["id"]: (-100, -54, False), d5["id"]: (100, 0, False)}
    return _w


@test("C7", "test_C7_hand_computed_by_document")
def _():
    w = world()
    rep = profit(group_by="document", **R25)
    rows = {it["document_id"]: it for it in rep["items"]}
    for did, (rev, cost, est) in w["exp_docs"].items():
        it = rows.get(did)
        if not check(it is not None, f"document {did} in profit report"):
            continue
        eq(it["revenue"], rev, f"doc {it.get('doc_no')} revenue")
        eq(it["cost"], cost, f"doc {it.get('doc_no')} cost")
        eq(it["profit"], rev - cost, f"doc {it.get('doc_no')} profit")
        eq(it["estimated"], est, f"doc {it.get('doc_no')} estimated")
        if rev:
            eq(it["margin"], round((rev - cost) / rev * 100, 2), f"doc {it.get('doc_no')} margin")
    eq(len(rows), 5, "exactly 5 posted sale/return documents in 2025 (drafts excluded)")
    t = rep["totals"]
    eq(t["revenue"], 1200, "total revenue")
    eq(t["cost"], 478, "total cost")
    eq(t["profit"], 722, "total profit")
    eq(t["margin"], 60.17, "total margin")
    eq(t.get("estimated"), True, "totals estimated flag (some line estimated)")
    eq(rep.get("estimated_lines"), 1, "estimated_lines")


@test("C7", "test_C7_three_groupings_same_total_and_sales_report")
def _():
    w = world()
    reps = {g: profit(group_by=g, **R25) for g in ("document", "product", "customer")}
    for k in ("revenue", "cost", "profit"):
        vals = {g: num(r["totals"][k]) for g, r in reps.items()}
        check(len(set(vals.values())) == 1, f"three groupings share totals.{k}: {vals}")
        for g, r in reps.items():
            eq(sum(num(i[k]) for i in r["items"]), num(r["totals"][k]), f"{g}: items sum to totals.{k}")
    prod = {it["product_id"]: it for it in reps["product"]["items"]}
    x = prod.get(w["X"]["id"])
    if check(x is not None, "X row"):
        eq((x["revenue"], x["cost"], x["qty"]), (700, 338, 7), "X: revenue 500+300-100, cost 230+162-54, net qty 7")
    dv = [it for it in reps["product"]["items"] if it.get("product_code") == "DV"]
    if check(len(dv) == 1, "DV row in product grouping"):
        eq((dv[0]["revenue"], dv[0]["cost"]), (200, 0), "service: revenue counted, cost 0")
    y = prod.get(w["Y"]["id"])
    if y:
        eq((y["cost"], y["estimated"]), (140, True), "Y estimated")
    cu = {it["partner_id"]: it for it in reps["customer"]["items"]}
    eq(cu.get(w["K1"]["id"], {}).get("revenue"), 900, "customer K1 revenue 700+300-100")
    eq(cu.get(w["K1"]["id"], {}).get("cost"), 338, "customer K1 cost")
    eq(cu.get(w["K2"]["id"], {}).get("revenue"), 300, "customer K2 revenue")
    sales = admin().ok("GET", "/reports/sales", params={**R25, "include_returns": "true"})
    eq(reps["document"]["totals"]["revenue"], sales["total_amount"], "profit revenue = sales report (include_returns) total")
    # filters
    r = profit(group_by="document", partner_id=w["K2"]["id"], **R25)
    eq(r["totals"]["revenue"], 300, "partner filter")
    r = profit(group_by="product", product_id=w["X"]["id"], **R25)
    eq((r["totals"]["revenue"], r["totals"]["cost"]), (700, 338), "product filter")


@test("C7", "test_C7_whole_database_consistency")
def _():
    reps = {g: profit(group_by=g, **{"from": "2000-01-01", "to": "2100-12-31"}) for g in ("document", "product", "customer")}
    for k in ("revenue", "cost", "profit"):
        vals = {g: num(r["totals"][k]) for g, r in reps.items()}
        check(len(set(vals.values())) == 1, f"all data: groupings share totals.{k}: {vals}")
    sales = admin().ok("GET", "/reports/sales", params={"from": "2000-01-01", "to": "2100-12-31", "include_returns": "true"})
    eq(reps["document"]["totals"]["revenue"], sales["total_amount"], "all data: revenue = sales report")
    for it in reps["document"]["items"]:
        eq(num(it["profit"]), num(it["revenue"]) - num(it["cost"]), f"doc {it['doc_no']} profit = revenue - cost")
        if num(it["revenue"]) == 0:
            eq(it["margin"], None, f"doc {it['doc_no']} margin null when revenue 0")


@test("C7", "test_C7_recompute_after_backdated_edit_and_xlsx")
def _():
    w = world()
    a = admin()
    # xlsx: real numbers and correct totals
    for g in ("document", "product", "customer"):
        r = a.get("/reports/profit", group_by=g, format="xlsx", **R25)
        wb = xlsx_basic_checks(r.content, f"profit xlsx {g}")
        if not wb:
            continue
        nums = xlsx_numbers(r.content)
        for v in (1200, 478, 722):
            check(any(abs(x - v) < 0.001 for x in nums), f"profit xlsx {g}: total {v} present as number")
        txt = xlsx_text(wb)
        check("ước tính" in txt.lower() or "Ước tính" in txt, f"profit xlsx {g}: estimated marker present")
        eq(a.get("/reports/profit", group_by=g, format="docx", **R25).status, 200, f"profit docx {g}")
    # params
    for params, label in [({"group_by": "month"}, "bad group_by"), ({"from": "abc"}, "bad from"),
                          ({"from": "2025-02-01", "to": "2025-01-01"}, "to < from"), ({"partner_id": "x"}, "bad partner_id")]:
        eq(a.get("/reports/profit", **params).status, 400, f"profit {label}")
    # masking / permission
    for role in ("banhang", "thukho"):
        expect_err(user(role).get("/reports/profit", **R25), 403, "FORBIDDEN", f"{role} profit")
        expect_err(user(role).get("/reports/profit", format="xlsx", **R25), 403, "FORBIDDEN", f"{role} profit xlsx")
    eq(user("muahang").get("/reports/profit", **R25).status, 200, "muahang (report.view + cost.view)")
    # O6: editing a back-dated purchase changes past profit
    lst = a.ok("GET", "/documents", params={"type": "purchase", "from": "2025-01-08", "to": "2025-01-08", "product_id": w["X"]["id"]})["items"]
    if check(len(lst) == 1, "back-dated purchase found"):
        d = get_doc(lst[0]["id"])
        r = a.put(f"/documents/{d['id']}", put_body_from(d, lines=[L(w["X"]["id"], 5, 130)]))
        eq(r.status, 200, "edit back-dated purchase price 30 -> 130")
        rep = profit(group_by="document", **R25)
        rows = {it["document_id"]: it for it in rep["items"]}
        # moving avg at 01-10 = (400+600+650)/25 = 66 -> 5 x 66 = 330
        eq(rows[w["d1"]["id"]]["cost"], 330, "d1 cost recomputed after editing the back-dated purchase")
        r = a.put(f"/documents/{d['id']}", put_body_from(get_doc(d["id"]), lines=[L(w["X"]["id"], 5, 30)]))
        eq(r.status, 200, "restore")
        eq({it["document_id"]: it for it in profit(group_by="document", **R25)["items"]}[w["d1"]["id"]]["cost"], 230, "restored")


@test("C7", "test_C7_fractional_qty_rounding_and_large_numbers")
def _():
    k1 = wh("KHO1")
    p = mk_product(sale=0, purchase=0)
    s = mk_partner(supp=True)
    c = mk_partner(cust=True)
    posted("purchase", "2025-03-01", k1, [L(p["id"], 3, "33.33")], s["id"])          # amount round(99.99)=100
    posted("purchase", "2025-03-02", k1, [L(p["id"], "0.5", "1000000000")], s["id"])  # amount 500.000.000
    d = posted("sale", "2025-03-03", k1, [L(p["id"], "1.25", "400000000")], c["id"], confirm_loss=True)
    # moving avg = (100 + 500000000) / 3.5 = 142857171.428571... ; cost = round(1.25 * avg) = round(178571464.2857) = 178571464
    rep = profit(group_by="document", **{"from": "2025-03-01", "to": "2025-03-31"})
    row = {it["document_id"]: it for it in rep["items"]}.get(d["id"])
    if check(row is not None, "row present"):
        eq(row["revenue"], 500000000, "revenue 1.25 x 400.000.000")
        eq(row["cost"], 178571464, "cost uses line amounts (rounded) and an unrounded average (P1)")
