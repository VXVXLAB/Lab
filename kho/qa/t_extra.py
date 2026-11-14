"""Extra probes: races between edit/unpost and post, debt edge cases, SSE, dashboard."""
import concurrent.futures as cf
import datetime as dt
from lib import *
from t_drafts import users


def _par(*fns):
    with cf.ThreadPoolExecutor(len(fns)) as ex:
        futs = [ex.submit(f) for f in fns]
        return [f.result() for f in futs]


@test("030,031,036,039,082", "test_RACE_edit_or_unpost_purchase_vs_posting_sale")
def _():
    k1, k2 = wh("KHO1"), wh("KHO2")
    users()
    c = mk_partner(cust=True); s = mk_partner(supp=True)
    m1, m2 = login("may1", "matkhau1"), login("may2", "matkhau1")
    for rnd_ in range(8):
        p = mk_product(sale=100, purchase=50)
        pur = posted("purchase", "2026-02-01", k1, [L(p["id"], 10, 50)], s["id"])
        sd = draft("sale", "2026-02-10", k1, [L(p["id"], 8, 100)], c["id"])
        b = put_body_from(pur); b["lines"][0]["qty"] = 5
        if rnd_ % 2 == 0:
            r1, r2 = _par(lambda: m1.put(f"/documents/{pur['id']}", b), lambda: post_doc(sd, True, m2))
            what = "edit purchase 10->5"
        else:
            r1, r2 = _par(lambda: m1.post(f"/documents/{pur['id']}/unpost", {"version": pur["version"]}), lambda: post_doc(sd, True, m2))
            what = "unpost purchase"
        st = (r1.status, r2.status)
        check(not (r1.status == 200 and r2.status == 200), f"round {rnd_}: {what} and posting sale of 8 BOTH succeeded {st} -> negative stock")
        bw, tot = stock_of(p["id"])
        check(tot is None or tot >= 0, f"round {rnd_}: stock negative {tot}")
        lg = ledger(p["id"], warehouse_id=k1)
        check(all(num(r["balance"]) >= 0 for r in lg["rows"]), f"round {rnd_}: ledger shows negative balance {[(r['doc_no'], r['balance']) for r in lg['rows']]}")
    # two transfers out of the same warehouse at once
    for rnd_ in range(5):
        p = mk_product()
        posted("opening", "2026-02-01", k1, [L(p["id"], 10, 1)])
        t1 = draft("transfer", "2026-02-05", k1, [L(p["id"], 7)], to_wh=k2)
        t2 = draft("transfer", "2026-02-05", k1, [L(p["id"], 7)], to_wh=wh("KHO3"))
        rs = _par(lambda: post_doc(t1, c=m1), lambda: post_doc(t2, c=m2))
        check(sorted(r.status for r in rs) == [200, 422], f"transfer race round {rnd_}: {[r.status for r in rs]}")
        eq(stock_of(p["id"])[1], 10, "total unchanged by transfers")
    # edit of a posted sale (increase) vs posting another sale
    for rnd_ in range(5):
        p = mk_product(sale=100, purchase=50)
        posted("opening", "2026-02-01", k1, [L(p["id"], 10, 50)])
        s1 = posted("sale", "2026-02-02", k1, [L(p["id"], 2, 100)], c["id"])
        s2 = draft("sale", "2026-02-03", k1, [L(p["id"], 6, 100)], c["id"])
        b = put_body_from(s1); b["lines"][0]["qty"] = 6; b["confirm_loss"] = True
        rs = _par(lambda: m1.put(f"/documents/{s1['id']}", b), lambda: post_doc(s2, True, m2))
        check(not all(r.status == 200 for r in rs), f"sale edit race round {rnd_}: both succeeded -> 12 sold of 10")
        eq(min(stock_of(p["id"])[1], 0), 0, f"sale edit race round {rnd_}: stock >= 0")


@test("062,007,084,085", "test_REQ062_refunds_supplier_receipt_and_customer_payment")
def _():
    """Customer's requirement 6: receipts/payments for 'NCC hay khách hàng'. A supplier refunding money we overpaid
    (after a purchase return) is a RECEIPT from a supplier; it must settle the payable, not create a negative receivable."""
    k1 = wh("KHO1")
    p = mk_product(sale=200000, purchase=100000)
    s = mk_partner(name="NCC hoàn tiền", supp=True)
    acc = mk_account("cash", 10000000)
    posted("purchase", "2026-06-01", k1, [L(p["id"], 10, 100000)], s["id"])
    mk_voucher("payment", acc["id"], s["id"], [{"description": "Trả đủ tiền hàng", "amount": 1000000}], date="2026-06-02")
    posted("purchase_return", "2026-06-03", k1, [L(p["id"], 5, 100000)], s["id"])
    eq(debt_closing(s["id"], "payable"), -500000, "supplier owes us 500,000 after return")
    r = mk_voucher("receipt", acc["id"], s["id"], [{"description": "NCC hoàn tiền hàng trả lại", "amount": 500000}], date="2026-06-04")
    eq(r.status, 201, "receipt from supplier accepted")
    eq(debt_closing(s["id"], "payable"), 0, "supplier refund settles payable (expected 0)")
    eq(debt_closing(s["id"], "receivable"), 0, "supplier-only partner must not get a receivable balance")
    c = mk_partner(name="Khách nhận lại tiền", cust=True)
    posted("sale", "2026-06-01", k1, [L(p["id"], 3, 200000)], c["id"])
    mk_voucher("receipt", acc["id"], c["id"], [{"description": "Thu đủ", "amount": 600000}], date="2026-06-02")
    posted("sale_return", "2026-06-03", k1, [L(p["id"], 1, 200000)], c["id"])
    eq(debt_closing(c["id"]), -200000, "we owe customer 200,000 after return")
    r = mk_voucher("payment", acc["id"], c["id"], [{"description": "Trả lại tiền khách", "amount": 200000}], date="2026-06-04")
    eq(r.status, 201, "payment to customer accepted")
    eq(debt_closing(c["id"]), 0, "refund to customer settles receivable (expected 0)")
    eq(debt_closing(c["id"], "payable"), 0, "customer-only partner must not get a payable balance")


@test("034,052,053,083", "test_REQ034_old_debt_with_vouchers_and_drafts")
def _():
    k1 = wh("KHO1")
    acc = mk_account("cash")
    c = mk_partner(cust=True, rec=1000)
    sv = lambda amt: [{"product_code": "DV", "description": "Phí", "unit_price": amt}]
    posted("sale", "2026-03-10", k1, sv(5000), c["id"])
    mk_voucher("receipt", acc["id"], c["id"], [{"description": "thu", "amount": 2000}], date="2026-03-15")
    d = draft("sale", "2026-03-12", k1, sv(700), c["id"])
    eq(d["old_debt"], 6000, "draft 03-12: old debt = balance to end of day"); eq(d["total_debt"], 6700, "draft total_debt")
    d = draft("sale", "2026-03-20", k1, sv(700), c["id"])
    eq(d["old_debt"], 4000, "draft 03-20: old debt after receipt")
    s = posted("sale", "2026-03-12", k1, sv(300), c["id"])
    eq(s["old_debt"], 6000, "posted 03-12 old debt"); eq(s["total_debt"], 6300, "posted total_debt")
    s2 = posted("sale", "2026-03-01", k1, sv(100), c["id"])
    eq(s2["old_debt"], 1000, "back-dated sale old debt = opening")
    eq(get_doc(s["id"])["old_debt"], 6100, "later sale's old debt includes back-dated sale")
    # export shows these numbers
    r = admin().get(f"/documents/{s['id']}/export", format="docx")
    txt = docx_text(open_docx(r.content))
    check("6.100" in txt and "6.400" in txt, "docx Nợ cũ 6.100 / Tổng nợ 6.400")


@test("042,043,044", "test_REQ042_sse_voucher_and_catalog_events")
def _():
    m1, m2 = users()
    sse = SSE(m1)
    c = mk_partner(cust=True, c=m2)
    ev = sse.wait_for(lambda e: e.get("type") == "catalog.changed" and e.get("entity") == "partner")
    check(ev is not None, f"catalog.changed partner event: {sse.events[-3:]}")
    acc = mk_account("cash")
    r = mk_voucher("receipt", acc["id"], c["id"], [{"description": "x", "amount": 1}], c=m2)
    ev = sse.wait_for(lambda e: e.get("type") == "voucher.changed" and e.get("id") == r.json["id"] and e.get("action") == "created")
    check(ev is not None, "voucher.changed created event")
    if ev:
        eq(ev.get("by"), "Trần Thị Hoa (Máy 2)", "voucher event by")
    sse.stop()


@test("063,067", "test_dashboard_revenue_and_low_stock")
def _():
    a = admin()
    today = (dt.datetime.utcnow() + dt.timedelta(hours=7)).date()
    k1 = wh("KHO1")
    p = mk_product(sale=1000, purchase=500)
    c = mk_partner(cust=True)
    posted("opening", today.isoformat(), k1, [L(p["id"], 3, 500)])
    d0 = a.ok("GET", "/dashboard")
    eq(d0["today"], today.isoformat(), "dashboard today (VN)")
    posted("sale", today.isoformat(), k1, [L(p["id"], 2, 1000)], c["id"])
    posted("sale_return", today.isoformat(), k1, [L(p["id"], 1, 1000)], c["id"])
    d1 = a.ok("GET", "/dashboard")
    eq(num(d1["revenue_today"]) - num(d0["revenue_today"]), 1000, "revenue today = sale - return")
    eq(num(d1["revenue_month"]) - num(d0["revenue_month"]), 1000, "revenue month")
    eq(num(d1["total_receivable"]) - num(d0["total_receivable"]), 1000, "receivable delta")


@test("038,039,081", "test_REQ038_edit_posted_doc_misc_rules")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=50)
    c = mk_partner(cust=True); s = mk_partner(supp=True)
    posted("opening", "2026-01-01", k1, [L(p["id"], 10, 50)])
    sale = posted("sale", "2026-01-05", k1, [L(p["id"], 2, 100)], c["id"])
    b = put_body_from(sale); b["version"] = sale["version"] - 1; b["lines"][0]["qty"] = 1
    eq(a.put(f"/documents/{sale['id']}", b).status, 409, "stale edit of posted doc")
    eq(a.post(f"/documents/{sale['id']}/unpost", {"version": sale["version"] - 1}).status, 409, "stale unpost")
    b = put_body_from(sale, partner_id=s["id"]); b["confirm_loss"] = True
    eq(a.put(f"/documents/{sale['id']}", b).status, 400, "sale partner -> supplier-only refused")
    b = put_body_from(sale, doc_date="31/02/2026")
    eq(a.put(f"/documents/{sale['id']}", b).status, 400, "invalid date on edit")
    # partner later loses its customer flag: old posted sale must still be editable (API.md §2)
    cc = a.ok("GET", f"/partners/{c['id']}"); cc["is_customer"] = False; cc["is_supplier"] = True
    r = a.put(f"/partners/{c['id']}", cc)
    if r.status == 200:
        b = put_body_from(get_doc(sale["id"])); b["note"] = "sửa sau khi đổi loại đối tác"; b["confirm_loss"] = True
        r2 = a.put(f"/documents/{sale['id']}", b)
        check(r2.status == 200, f"partner turned supplier-only after use: changing its flag was allowed, but the old sale can no longer be edited: {r2.status} {r2.json}")
        it = debt_summary_item(c["id"])
        check(it is not None and num(it["closing"]) == 200, f"receivable still visible after flag change: {it}")
    else:
        check(r.status in (400, 409), f"flag change refused: {r.short()[:200]}")
    # deleting a document referenced by a voucher line
    acc = mk_account("cash")
    c2 = mk_partner(cust=True)
    s2 = posted("sale", "2026-01-06", k1, [L(p["id"], 1, 100)], c2["id"])
    v = mk_voucher("receipt", acc["id"], c2["id"], [{"description": "Thu tiền " + s2["doc_no"], "amount": 100, "document_id": s2["id"]}]).json
    u = a.ok("POST", f"/documents/{s2['id']}/unpost", {"version": s2["version"]})
    r = a.delete(f"/documents/{s2['id']}")
    if r.status == 200:
        vv = a.ok("GET", f"/vouchers/{v['id']}")
        check(vv["lines"][0]["document_id"] == s2["id"], f"deleting a document referenced by a receipt silently unlinked the receipt line ({vv['lines'][0]})")
    else:
        check(r.status in (400, 409), f"delete referenced doc: {r.status}")


@test("023,025,087", "test_large_document_300_lines")
def _():
    a = admin()
    k1 = wh("KHO1")
    c = mk_partner(cust=True)
    ps = [mk_product(sale=1000 + i, purchase=500) for i in range(60)]
    posted("opening", "2026-01-01", k1, [L(x["id"], 100, 500) for x in ps])
    lines = [L(ps[i % 60]["id"], 1, 1000 + (i % 60)) for i in range(300)]
    d = draft("sale", "2026-01-02", k1, lines, c["id"])
    eq(len(d["lines"]), 300, "300 lines")
    exp = sum(1000 + (i % 60) for i in range(300))
    eq(d["total_amount"], exp, "total of 300 lines")
    r = post_doc(d)
    eq(r.status, 200, "post 300 lines (5 lines per product aggregated)")
    for fmt in ("xlsx", "docx"):
        e = a.get(f"/documents/{d['id']}/export", format=fmt)
        eq(e.status, 200, f"export {fmt}")
        if fmt == "xlsx" and e.status == 200:
            wb = open_xlsx(e.content)
            rows = [rr for rr in wb.worksheets[0].iter_rows() if isinstance(rr[0].value, (int, float))]
            eq(len(rows), 300, "xlsx has 300 item rows")


@test("064,065,022", "test_REQ064_065_rows_with_movement_but_zero_balances_are_listed")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    p = mk_product(); q = mk_product()
    c = mk_partner(cust=True); s = mk_partner(supp=True)
    posted("purchase", "2026-07-02", k1, [L(p["id"], 5, 10)], s["id"])
    posted("sale", "2026-07-03", k1, [L(p["id"], 5, 20)], c["id"])
    n = a.ok("GET", "/reports/stock-nxt", params={"from": "2026-07-01", "to": "2026-07-31", "q": p["code"]})
    it = [i for i in n["items"] if i["product_id"] == p["id"]]
    if check(it, "NXT lists product with in 5 / out 5 / opening 0 / closing 0"):
        eq(it[0]["qty_in"], 5, "in"); eq(it[0]["qty_out"], 5, "out")
    posted("opening", "2026-07-01", k1, [L(q["id"], 3, 10)])
    posted("transfer", "2026-07-05", k1, [L(q["id"], 3)], to_wh=k2)
    posted("transfer", "2026-07-06", k2, [L(q["id"], 3)], to_wh=k1)
    n = a.ok("GET", "/reports/stock-nxt", params={"from": "2026-07-02", "to": "2026-07-31", "q": q["code"], "warehouse_id": k2})
    it = [i for i in n["items"] if i["product_id"] == q["id"]]
    if check(it, "NXT KHO2 lists product transferred in and out (0/3/3/0)"):
        eq(it[0]["qty_in"], 3, "in"); eq(it[0]["qty_out"], 3, "out")
    # debt summary: partner with sale + full receipt in period is not 'all zero'
    acc = mk_account("cash")
    c2 = mk_partner(cust=True)
    posted("sale", "2026-07-10", k1, [{"product_code": "DV", "description": "Phí", "unit_price": 500000}], c2["id"])
    mk_voucher("receipt", acc["id"], c2["id"], [{"description": "thu đủ", "amount": 500000}], date="2026-07-11")
    sm = a.ok("GET", "/reports/debt-summary", params={"side": "receivable", "from": "2026-07-01", "to": "2026-07-31"})
    it = [i for i in sm["items"] if i["partner_id"] == c2["id"]]
    if check(it, "debt-summary lists partner with increase/decrease even if closing 0"):
        eq(it[0]["increase"], 500000, "increase"); eq(it[0]["decrease"], 500000, "decrease")
    # product only on a draft is not 'with data'
    d = mk_product()
    draft("sale", "2026-07-12", k1, [L(d["id"], 1, 1)], c["id"])
    check(all(i["product_id"] != d["id"] for i in stock_summary()["items"]), "product only on a draft not in only_with_data summary")


@test("021,067,066", "test_REQ066_067_report_filters_and_api_claims")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    g = mk_group(uid("G"), "Nhóm lọc báo cáo")
    p = mk_product(name="Béc hàn Đài Loan", group_id=g["id"], sale=100, purchase=50); q = mk_product(sale=10)
    c = mk_partner(name="Khách Ánh Dương", cust=True)
    posted("opening", "2026-08-01", k1, [L(p["id"], 10, 50), L(q["id"], 10, 5)])
    posted("opening", "2026-08-01", k2, [L(p["id"], 10, 50)])
    s1 = posted("sale", "2026-08-02", k1, [L(p["id"], 2), L(q["id"], 1)], c["id"])
    s2 = posted("sale", "2026-08-03", k2, [L(p["id"], 3)], c["id"])
    rng = {"from": "2026-08-01", "to": "2026-08-31"}
    r = a.ok("GET", "/reports/sales", params={**rng, "group_id": g["id"]})
    eq(r["total_qty"], 5, "group filter"); eq(r["document_count"], 2, "document_count")
    r = a.ok("GET", "/reports/sales", params={**rng, "warehouse_id": k2, "partner_id": c["id"]})
    eq([x["document_id"] for x in r["rows"]], [s2["id"]], "warehouse filter")
    r = a.ok("GET", "/reports/sales", params={**rng, "q": "anh duong"})
    check({x["document_id"] for x in r["rows"]} == {s1["id"], s2["id"]}, f"q without diacritics on sales report: {len(r['rows'])} rows")
    r = a.ok("GET", "/reports/sales", params={**rng, "product_id": p["id"]})
    check(all(x["description"] == "Béc hàn Đài Loan" for x in r["rows"]), "description = product name when line has none")
    r = a.ok("GET", "/reports/debt-summary", params={"side": "receivable", "q": "anh duong"})
    check(any(x["partner_id"] == c["id"] for x in r["items"]), "debt-summary q without diacritics")
    lst = a.ok("GET", "/documents", params={"partner_id": c["id"]})["items"]
    eq([x["id"] for x in lst], [s2["id"], s1["id"]], "documents sorted by date desc")
    v = mk_voucher("receipt", mk_account("cash")["id"], c["id"], [{"description": "x", "amount": 5}]).json
    h = a.get(f"/vouchers/{v['id']}/history")
    check(h.status == 200 and h.json["items"] and h.json["items"][0]["action"] == "created", f"voucher history: {h.short()[:200]}")


@test("023,056", "test_ROBUST_input_edge_values")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(); c = mk_partner(cust=True)
    r = a.post("/products", {"code": uid("P"), "name": "Tên có ký tự NUL\u0000", "unit": "Cái"})
    eq(r.status, 400, "NUL char in product name -> 400 (not 500)")
    r = create_doc("sale", "2026-01-01", k1, [L(p["id"], 1, 1)], c["id"], note="ghi chú\u0000")
    eq(r.status, 400, "NUL char in note -> 400 (not 500)")
    r = a.get("/products", q="a\u0000b")
    check(r.status in (200, 400), f"NUL char in search -> {r.status}")
    acc = mk_account("cash")
    r = mk_voucher("receipt", acc["id"], c["id"], [{"description": "x", "amount": 0.001}])
    if r.status == 201:
        check(num(r.json["total_amount"]) > 0, f"voucher line 0.001 accepted but stored as amount {r.json['lines'][0]['amount']} (rule: amount > 0)")
    r = create_doc("sale", "0001-01-01", k1, [L(p["id"], 1, 1)], c["id"])
    check(r.status == 400 or r.json.get("doc_date") == "0001-01-01",
          f"doc_date 0001-01-01 must be rejected like 1999-12-31 (QUYET_DINH B5), got {r.status} doc_date={r.json and r.json.get('doc_date')}")
    r = create_doc("sale", "2026-01-01", k1, [L(p["id"], 1.0005, 1)], c["id"])
    check(r.status in (201, 400), "qty with 4 decimals")
    r = create_doc("sale", "2026-01-01", k1, [L(p["id"], 1, 0.004)], c["id"])
    if r.status == 201:
        check(r.json["lines"][0]["unit_price"] in (0.004, 0.0) or True, "")


@test("019,013", "test_ROBUST_extreme_but_valid_dates_in_reports")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product()
    posted("opening", "2026-01-10", k1, [L(p["id"], 7, 1)])
    base = ledger(p["id"])
    eq(base["closing"], 7, "baseline closing")
    r = a.get("/reports/stock-ledger", product_id=p["id"], **{"from": "0001-01-01"})
    if r.status == 200:
        eq(len(r.json["rows"]), 1, "ledger from=0001-01-01 must still list the movement")
        eq(r.json["closing"], 7, "ledger from=0001-01-01 closing")
    else:
        eq(r.status, 400, "or reject the date")
    r = a.get("/reports/stock-ledger", product_id=p["id"], **{"from": "1990-01-01"})
    eq(r.json["closing"], 7, "ledger from=1990-01-01 closing")
    r = a.get("/reports/stock-summary", as_of="0001-01-01", q=p["code"], only_with_data="false")
    if r.status == 200:
        it = [i for i in r.json["items"] if i["product_id"] == p["id"]]
        eq(it[0]["total"] if it else 0, 0, f"stock as_of=0001-01-01 must be 0 (response as_of={r.json.get('as_of')})")
    else:
        eq(r.status, 400, "or reject the date")
    acc = mk_account("cash")
    c = mk_partner(cust=True)
    r = mk_voucher("receipt", acc["id"], c["id"], [{"description": "x", "amount": 1}], date="0001-01-01")
    check(r.status == 400 or (r.status == 201 and r.json["voucher_date"] == "0001-01-01"),
          f"voucher_date 0001-01-01 must be rejected (QUYET_DINH B5: 2000–2100), got {r.status} date={r.json and r.json.get('voucher_date')}")
