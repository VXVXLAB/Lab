"""B. Kho & NXT: REQ-009..022, 076..078"""
from lib import *


@test("009,010,063,076", "test_REQ009_010_076_four_warehouses")
def _():
    a = admin()
    p = mk_product(unit="Cuộn", sale=100, purchase=80)
    s = mk_partner(supp=True)
    k = mk_partner(cust=True)
    k1, k2, k3, k4 = W()
    posted("purchase", "2026-02-01", k1, [L(p["id"], 10, 80)], s["id"])
    posted("purchase", "2026-02-02", k2, [L(p["id"], 20, 80)], s["id"])
    posted("opening", "2026-01-01", k3, [L(p["id"], 5, 80)])
    posted("purchase", "2026-02-03", k4, [L(p["id"], 7.5, 80)], s["id"])
    posted("sale", "2026-02-05", k2, [L(p["id"], 3, 100)], k["id"])
    bw, tot = stock_of(p["id"])
    eq(bw.get(k1), 10, "KHO1"); eq(bw.get(k2), 17, "KHO2"); eq(bw.get(k3), 5, "KHO3"); eq(bw.get(k4), 7.5, "KHO4")
    eq(tot, 39.5, "total of 4 warehouses")
    check(sum(bw.values()) == tot, f"sum by warehouse {sum(bw.values())} != total {tot}")
    # only one warehouse
    s2 = stock_summary(warehouse_id=k2, q=p["code"])
    it = [i for i in s2["items"] if i["product_id"] == p["id"]]
    check(len(it) == 1, f"warehouse filter: product missing {s2}")
    if it:
        eq(it[0]["total"], 17, "stock-summary warehouse_id=KHO2 total")
    # as_of before sale
    bw, tot = stock_of(p["id"], as_of="2026-02-04")
    eq(tot, 42.5, "as_of 2026-02-04 total")
    bw, tot = stock_of(p["id"], as_of="2026-01-15")
    eq(tot, 5, "as_of 2026-01-15 total (only opening)")
    # price-info independently
    pi = a.ok("GET", f"/products/{p['id']}/price-info", params={"date": "2026-03-01"})
    eq(pi["total_stock"], 39.5, "price-info total_stock")
    m = {x["warehouse_id"]: x["qty"] for x in pi["stock_by_warehouse"]}
    eq(m.get(k2), 17, "price-info KHO2")
    # totals_by_warehouse consistent with items
    full = stock_summary(only_with_data="false")
    for w in full["warehouses"]:
        ssum = sum(num(i["by_warehouse"][str(w["id"])]) for i in full["items"])
        eq(full["totals_by_warehouse"][str(w["id"])], ssum, f"totals_by_warehouse[{w['code']}]")
    eq(full["total_qty"], sum(num(i["total"]) for i in full["items"]), "total_qty = sum items")
    check(len(full["warehouses"]) >= 4, "4 warehouses listed")


@test("011,077,001", "test_REQ011_077_internal_transfer")
def _():
    a = admin()
    p = mk_product()
    k1, k2, k3, k4 = W()
    posted("opening", "2026-03-01", k2, [L(p["id"], 20, 1000)])
    k = mk_partner(cust=True, rec=0)
    before_debt = debt_closing(k["id"])
    t = posted("transfer", "2026-03-05", k2, [L(p["id"], 4)], to_wh=k3, note="chuyển gấp")
    check(t["doc_no"] and t["doc_no"].startswith("CK"), f"transfer number CK..: {t['doc_no']}")
    bw, tot = stock_of(p["id"])
    eq(bw.get(k2), 16, "source decreased"); eq(bw.get(k3), 4, "destination increased"); eq(tot, 20, "total unchanged")
    eq(debt_closing(k["id"]), before_debt, "transfer has no debt effect")
    # ledger all warehouses hides transfer rows
    lg = ledger(p["id"])
    check(all(r["doc_type"] != "transfer" for r in lg["rows"]), "all-warehouse ledger must hide transfer rows")
    eq(lg["closing"], 20, "all-wh ledger closing")
    lg3 = ledger(p["id"], warehouse_id=k3)
    rows = [r for r in lg3["rows"] if r["doc_type"] == "transfer"]
    check(len(rows) == 1 and num(rows[0]["qty_in"]) == 4, f"KHO3 ledger transfer in row: {lg3['rows']}")
    if rows:
        d = rows[0]["description"]
        check("Chuyển kho" in d and "→" in d, f"transfer description: {d}")
        check(d.endswith(" - chuyển gấp"), f"transfer description should append note: {d}")
    lg2 = ledger(p["id"], warehouse_id=k2)
    rows = [r for r in lg2["rows"] if r["doc_type"] == "transfer"]
    check(len(rows) == 1 and num(rows[0]["qty_out"]) == 4, "KHO2 ledger transfer out row")
    # NXT: no warehouse -> transfer not counted; with warehouse -> counted
    n = a.ok("GET", "/reports/stock-nxt", params={"from": "2026-03-01", "to": "2026-03-31", "q": p["code"]})
    it = [i for i in n["items"] if i["product_id"] == p["id"]]
    if check(it, "NXT row"):
        eq(it[0]["qty_in"], 20, "NXT all qty_in (opening only)"); eq(it[0]["qty_out"], 0, "NXT all qty_out")
    n = a.ok("GET", "/reports/stock-nxt", params={"from": "2026-03-01", "to": "2026-03-31", "q": p["code"], "warehouse_id": k3})
    it = [i for i in n["items"] if i["product_id"] == p["id"]]
    if check(it, "NXT KHO3 row"):
        eq(it[0]["qty_in"], 4, "NXT KHO3 qty_in")
    # transfer more than available
    r = create_doc("transfer", "2026-03-06", k2, [L(p["id"], 17)], to_wh=k1)
    d = r.json
    r2 = post_doc(d)
    eq(r2.status, 422, "transfer exceeding source stock refused")
    eq(r2.code, "INSUFFICIENT_STOCK", "error code")
    # transfer before stock existed in source
    r = create_doc("transfer", "2026-02-28", k2, [L(p["id"], 1)], to_wh=k1)
    eq(post_doc(r.json).status, 422, "transfer dated before opening refused")
    # same warehouse
    r = create_doc("transfer", "2026-03-06", k2, [L(p["id"], 1)], to_wh=k2)
    check(r.status == 400, f"transfer to same warehouse must be 400: {r.short()}")
    r = create_doc("transfer", "2026-03-06", k2, [L(p["id"], 1)], to_wh=None)
    check(r.status == 400, f"transfer without destination must be 400: {r.short()}")
    r = create_doc("transfer", "2026-03-06", k2, [L(p["id"], 1)], partner=k["id"], to_wh=k1)
    check(r.status == 400, f"transfer with partner must be 400: {r.short()}")
    # spending transferred stock at destination, then editing transfer to smaller qty must be refused
    posted("sale", "2026-03-10", k3, [L(p["id"], 3, 5000)], k["id"])
    body = put_body_from(get_doc(t["id"]))
    body["lines"][0]["qty"] = 2
    r = a.put(f"/documents/{t['id']}", body)
    eq(r.status, 422, "shrinking transfer below what destination already sold")
    bw, tot = stock_of(p["id"])
    eq(bw.get(k3), 1, "KHO3 after sale"); eq(tot, 17, "total after sale")
    # move the transfer to another destination warehouse -> refused (KHO3 sold 3)
    body = put_body_from(get_doc(t["id"]), to_warehouse_id=k4)
    eq(a.put(f"/documents/{t['id']}", body).status, 422, "changing transfer destination after sale at destination")


@test("002,012,013,014,015,016,017,018,019,078", "test_REQ002_078_customer_stock_card_WW829HT107k")
def _():
    """Reproduce customer's stock card example exactly."""
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(code="WW829HT107k", name="Dây hàn lõi thuốc WW829 1.2mm (15kg)", unit="Cuộn", sale=820000, purchase=700000)
    ncc = mk_partner(name="Công ty Hùng Phát", supp=True)
    vp = mk_partner(name="CTY TNHH TM DV VĨNH PHONG", cust=True)
    nm = mk_partner(name="CHÚ NGỌC MINH", cust=True)
    pg = mk_partner(name="CÔNG TY TNHH NHỰA PHẠM GIA", cust=True)
    pur = posted("purchase", "2026-03-15", k1, [L(p["id"], 27, 700000)], ncc["id"])
    s1 = posted("sale", "2026-04-03", k1, [L(p["id"], 4)], vp["id"])
    s2 = posted("sale", "2026-04-14", k1, [L(p["id"], 3)], vp["id"])
    r1 = posted("sale_return", "2026-04-17", k1, [L(p["id"], 1)], nm["id"])
    s3 = posted("sale", "2026-05-26", k1, [L(p["id"], 1)], pg["id"], note="Phường Bình Hưng Hòa B")
    # a later movement outside the period must not show
    posted("purchase", "2026-06-02", k1, [L(p["id"], 5, 700000)], ncc["id"])
    lg = ledger(p["id"], **{"from": "2026-04-01", "to": "2026-05-31", "warehouse_id": k1})
    eq(lg["opening"], 27, "Số dư đầu kỳ")
    exp = [("2026-04-03", s1, "Xuất kho bán hàng CTY TNHH TM DV VĨNH PHONG", 0, 4, 23),
           ("2026-04-14", s2, "Xuất kho bán hàng CTY TNHH TM DV VĨNH PHONG", 0, 3, 20),
           ("2026-04-17", r1, "CHÚ NGỌC MINH - trả hàng", 1, 0, 21),
           ("2026-05-26", s3, "Xuất kho bán hàng CÔNG TY TNHH NHỰA PHẠM GIA - Phường Bình Hưng Hòa B", 0, 1, 20)]
    eq(len(lg["rows"]), 4, "4 rows in period")
    for i, (d, doc, desc, qi, qo, bal) in enumerate(exp):
        if i >= len(lg["rows"]):
            break
        r = lg["rows"][i]
        eq(r["date"], d, f"row {i+1} date"); eq(r["doc_no"], doc["doc_no"], f"row {i+1} doc_no")
        eq(r["document_id"], doc["id"], f"row {i+1} document_id")
        eq(r["description"], desc, f"row {i+1} description")
        eq(r["unit"], "Cuộn", f"row {i+1} ĐVT")
        eq(r["qty_in"], qi, f"row {i+1} in"); eq(r["qty_out"], qo, f"row {i+1} out"); eq(r["balance"], bal, f"row {i+1} balance")
    eq(lg["total_in"], 1, "Cộng nhập"); eq(lg["total_out"], 8, "Cộng xuất"); eq(lg["closing"], 20, "tồn cuối")
    check(s1["doc_no"].startswith("XK") and r1["doc_no"].startswith("NK"), "XK/NK prefixes")
    # whole history (long period) – REQ-012
    lg = ledger(p["id"])
    eq(lg["opening"], 0, "no from => opening 0")
    eq(len(lg["rows"]), 6, "6 rows full history"); eq(lg["closing"], 25, "closing full history")
    check(lg["rows"][0]["description"] == "Nhập kho mua hàng Công ty Hùng Phát", f"purchase description shows supplier: {lg['rows'][0]['description']}")
    # only 'to'
    lg = ledger(p["id"], to="2026-04-14")
    eq(lg["closing"], 20, "to=2026-04-14 closing")
    # only 'from'
    lg = ledger(p["id"], **{"from": "2026-05-01"})
    eq(lg["opening"], 21, "from=2026-05-01 opening"); eq(lg["closing"], 25, "from=2026-05-01 closing")
    # DD/MM/YYYY accepted per API.md
    r = a.get("/reports/stock-ledger", product_id=p["id"], **{"from": "01/04/2026", "to": "31/05/2026"})
    check(r.status == 200 and num(r.json["closing"]) == 20, f"DD/MM/YYYY dates: {r.short()[:200]}")
    # excel in customer's layout
    r = a.get("/reports/stock-ledger", product_id=p["id"], warehouse_id=k1, format="xlsx", **{"from": "2026-04-01", "to": "2026-05-31"})
    eq(r.status, 200, "ledger xlsx status")
    wb = xlsx_basic_checks(r.content, "stock-ledger.xlsx")
    if wb:
        txt = xlsx_text(wb)
        for h in ["Mã hàng", "Ngày hạch toán", "Số chứng từ", "Diễn giải", "ĐVT", "Nhập", "Xuất", "Tồn", "Số dư đầu kỳ",
                  "CHÚ NGỌC MINH - trả hàng", "WW829HT107k", s3["doc_no"]]:
            check(h in txt, f"ledger xlsx contains {h!r}")
        ws = wb.worksheets[0]
        row = xlsx_find_row(ws, r1["doc_no"])
        if check(row is not None, "ledger xlsx row for return"):
            nums = [c.value for c in row if c.data_type == "n" and c.value is not None]
            check(1 in nums and 21 in nums, f"ledger xlsx return row numeric in=1 balance=21: {[c.value for c in row]}")
        op = xlsx_find_row(ws, "Số dư đầu kỳ")
        if check(op is not None, "opening row"):
            check(27 in [c.value for c in op], f"opening row has numeric 27: {[c.value for c in op]}")


@test("002,015,016,017,078", "test_REQ002_customer_text_example_lan_hoa_hung")
def _():
    """A: opening 10, sell Lan 5, sell Hoa 3, buy from Hùng 2 -> details show partner names."""
    k1 = wh("KHO1")
    p = mk_product(name="Mặt hàng A")
    lan = mk_partner(name="Lan", cust=True); hoa = mk_partner(name="Hoa", cust=True); hung = mk_partner(name="Hùng", supp=True)
    posted("opening", "2026-01-01", k1, [L(p["id"], 10, 1000)])
    posted("sale", "2026-01-05", k1, [L(p["id"], 5, 2000)], lan["id"])
    posted("sale", "2026-01-06", k1, [L(p["id"], 3, 2000)], hoa["id"])
    posted("purchase", "2026-01-07", k1, [L(p["id"], 2, 1000)], hung["id"])
    lg = ledger(p["id"], **{"from": "2026-01-02"})
    eq(lg["opening"], 10, "opening 10")
    descs = [r["description"] for r in lg["rows"]]
    eq(descs, ["Xuất kho bán hàng Lan", "Xuất kho bán hàng Hoa", "Nhập kho mua hàng Hùng"], "descriptions name partner")
    eq([r.get("partner_name") for r in lg["rows"]], ["Lan", "Hoa", "Hùng"], "partner_name field")
    eq(lg["closing"], 4, "closing 4")
    lg = ledger(p["id"])
    eq(lg["rows"][0]["description"], "Nhập tồn đầu kỳ", "opening document description")


@test("015,030,078", "test_REQ015_same_day_in_before_out_and_purchase_return_text")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product()
    s = mk_partner(name="NCC Đông Á", supp=True); c = mk_partner(cust=True)
    # sale created & posted first, purchase of same day posted after: end-of-day balance >= 0 => must be allowed
    sale = draft("sale", "2026-02-10", k1, [L(p["id"], 5, 100)], c["id"])
    pur = posted("purchase", "2026-02-10", k1, [L(p["id"], 5, 80)], s["id"])
    r = post_doc(sale, confirm_loss=True)
    eq(r.status, 200, "same-day sale allowed when end-of-day stock >= 0")
    lg = ledger(p["id"], warehouse_id=k1)
    eq([r["doc_type"] for r in lg["rows"]], ["purchase", "sale"], "same day: nhập trước xuất")
    check(all(num(r["balance"]) >= 0 for r in lg["rows"]), "running balance never negative")
    posted("purchase", "2026-02-11", k1, [L(p["id"], 3, 80)], s["id"])
    pr = posted("purchase_return", "2026-02-12", k1, [L(p["id"], 1, 80)], s["id"])
    lg = ledger(p["id"])
    eq(lg["rows"][-1]["description"], "Trả hàng NCC Đông Á", "purchase return description")
    check(pr["doc_no"].startswith("XK"), f"purchase_return numbered XK: {pr['doc_no']}")


@test("019,064", "test_REQ019_064_nxt_period_and_opening")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    g = mk_group(uid("G"), "Nhóm NXT")
    p = mk_product(group_id=g["id"]); q = mk_product(group_id=g["id"])
    s = mk_partner(supp=True); c = mk_partner(cust=True)
    posted("purchase", "2025-12-20", k1, [L(p["id"], 10, 10), L(q["id"], 4, 10)], s["id"])
    posted("purchase", "2026-01-10", k2, [L(p["id"], 6, 10)], s["id"])
    posted("sale", "2026-01-15", k1, [L(p["id"], 7, 20), L(q["id"], 4, 20)], c["id"])
    posted("sale_return", "2026-01-20", k1, [L(p["id"], 2, 20)], c["id"])
    posted("sale", "2026-02-02", k2, [L(p["id"], 1, 20)], c["id"])
    n = a.ok("GET", "/reports/stock-nxt", params={"from": "2026-01-01", "to": "2026-01-31", "group_id": g["id"]})
    m = {i["product_id"]: i for i in n["items"]}
    ip = m.get(p["id"])
    if check(ip, "NXT has p"):
        eq(ip["opening"], 10, "p opening"); eq(ip["qty_in"], 8, "p in (6 purchase + 2 return)")
        eq(ip["qty_out"], 7, "p out"); eq(ip["closing"], 11, "p closing")
    iq = m.get(q["id"])
    if check(iq, "NXT has q (closing 0 but had movement)"):
        eq(iq["opening"], 4, "q opening"); eq(iq["qty_out"], 4, "q out"); eq(iq["closing"], 0, "q closing")
    check(set(m) == {p["id"], q["id"]}, f"group filter returns only group products: {list(m)}")
    eq(n["totals"]["closing"], 11, "totals closing")
    # closing must equal stock-summary as_of 'to'
    bw, tot = stock_of(p["id"], as_of="2026-01-31")
    eq(tot, 11, "stock-summary as_of=to equals NXT closing")
    lg = ledger(p["id"], **{"from": "2026-01-01", "to": "2026-01-31"})
    eq(lg["closing"], 11, "ledger closing equals NXT closing"); eq(lg["opening"], 10, "ledger opening = NXT opening")
    r = a.get("/reports/stock-nxt", **{"from": "2026-02-01", "to": "2026-01-01"})
    eq(r.status, 400, "to < from => 400")


@test("020,063", "test_REQ020_group_filter_stock_summary")
def _():
    a = admin()
    g1 = mk_group(uid("G"), "Que hàn QA"); g2 = mk_group(uid("G"), "Béc hàn QA")
    k1 = wh("KHO1")
    ps = [mk_product(group_id=g1["id"]) for _ in range(3)] + [mk_product(group_id=g2["id"])]
    posted("opening", "2026-01-01", k1, [L(x["id"], i + 1, 10) for i, x in enumerate(ps)])
    s = stock_summary(group_id=g1["id"])
    ids = {i["product_id"] for i in s["items"]}
    eq(ids, {x["id"] for x in ps[:3]}, "group 1 products only")
    check(all(i.get("group_name") == "Que hàn QA" for i in s["items"]), "group_name shown")
    eq(s["total_qty"], 6, "group total qty")
    pl = a.ok("GET", "/products", params={"group_id": g1["id"]})
    eq(pl["total"], 3, "product list filter group_id")


@test("021,067,070", "test_REQ021_sales_history_per_product")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=500); other = mk_product(sale=10)
    c1 = mk_partner(name="Khách Bình", cust=True); c2 = mk_partner(name="Khách An", cust=True)
    posted("opening", "2025-01-01", k1, [L(p["id"], 100, 100), L(other["id"], 100, 1)])
    s1 = posted("sale", "2025-03-01", k1, [L(p["id"], 2, 500), L(other["id"], 1)], c1["id"])
    s2 = posted("sale", "2025-11-20", k1, [L(p["id"], 3, 550)], c2["id"])
    s3 = posted("sale", "2026-06-01", k1, [L(p["id"], 1, 450)], c1["id"])
    draft("sale", "2026-06-02", k1, [L(p["id"], 9)], c1["id"])  # drafts excluded
    rt = posted("sale_return", "2026-06-05", k1, [L(p["id"], 1, 450)], c1["id"])
    r = a.ok("GET", "/reports/sales", params={"from": "2025-01-01", "to": "2026-12-31", "product_id": p["id"]})
    rows = r["rows"]
    eq([x["document_id"] for x in rows], [s1["id"], s2["id"], s3["id"]], "3 sales of the product over 2 years")
    eq([x["partner_name"] for x in rows], ["Khách Bình", "Khách An", "Khách Bình"], "customers")
    eq([num(x["unit_price"]) for x in rows], [500, 550, 450], "prices")
    eq(r["total_qty"], 6, "total qty"); eq(r["total_amount"], 1000 + 1650 + 450, "total amount")
    r = a.ok("GET", "/reports/sales", params={"from": "2025-01-01", "to": "2026-12-31", "product_id": p["id"], "include_returns": "true"})
    eq(r["total_qty"], 5, "with returns qty"); eq(r["total_amount"], 3100 - 450, "with returns amount")
    r = a.ok("GET", "/reports/sales", params={"from": "2025-01-01", "to": "2026-12-31", "partner_id": c1["id"]})
    eq(len(r["rows"]), 3, "partner filter rows (2 lines s1 + s3)")
    # drill-down
    for x in rows:
        d = get_doc(x["document_id"])
        eq(d["doc_no"], x["doc_no"], "drill-down opens the right document")


@test("022,075,087", "test_REQ022_075_full_stock_export_all_products")
def _():
    """Customer: 'Xuất được file qua excel để làm báo cáo tồn kho (xuất hết toàn bộ các mã)'."""
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    g = mk_group(uid("G"), "Nhóm xuất Excel")
    ps = [mk_product(name=f"Vật tư xuất số {i} – đồng hồ", group_id=g["id"], unit="Cái") for i in range(130)]
    posted("opening", "2026-01-01", k1, [L(x["id"], i + 1, 1000) for i, x in enumerate(ps[:120])])
    posted("opening", "2026-01-01", k2, [L(x["id"], 2, 1000) for x in ps[120:]])
    # one product sold to zero: still has data
    c = mk_partner(cust=True)
    posted("sale", "2026-01-02", k1, [L(ps[0]["id"], 1, 2000)], c["id"])
    js = stock_summary()
    json_codes = {i["code"] for i in js["items"]}
    for x in ps:
        check(x["code"] in json_codes, f"JSON stock-summary contains {x['code']}")
    r = a.get("/reports/stock-summary", format="xlsx")
    eq(r.status, 200, "xlsx status")
    wb = xlsx_basic_checks(r.content, "stock-summary.xlsx")
    if not wb:
        return
    ws = wb.worksheets[0]
    allvals = [c for row in ws.iter_rows() for c in row if c.value is not None]
    xcodes = {c.value for c in allvals if isinstance(c.value, str)}
    missing = [x for x in json_codes if x not in xcodes]
    check(not missing, f"xlsx missing {len(missing)} of {len(json_codes)} products with data, e.g. {missing[:5]}")
    txt = xlsx_text(wb)
    check("Vật tư xuất số 7 – đồng hồ" in txt, "Vietnamese names intact in xlsx")
    for h in ["Mã hàng", "Tên hàng", "ĐVT", "Nhóm VTHH", "Tổng tồn"]:
        check(h in txt, f"header {h}")
    row = xlsx_find_row(ws, ps[5]["code"])
    if check(row, "row of product 5"):
        vals = [c for c in row if c.value is not None]
        numeric = [c.value for c in vals if c.data_type == "n"]
        check(6 in numeric, f"qty 6 numeric cell in row {[c.value for c in row]}")
    row0 = xlsx_find_row(ws, ps[0]["code"])
    check(row0 is not None, "product sold to zero still exported (has data)")
    # only_with_data=false export contains every active goods product
    r = a.get("/reports/stock-summary", format="xlsx", only_with_data="false")
    wb2 = xlsx_basic_checks(r.content, "stock-summary-all.xlsx")
    if wb2:
        allp = a.ok("GET", "/products", params={"page_size": 1000, "is_service": "false", "active": "true"})
        cs = {c.value for row in wb2.worksheets[0].iter_rows() for c in row if isinstance(c.value, str)}
        miss = [p["code"] for p in allp["items"] if p["code"] not in cs]
        check(not miss, f"only_with_data=false xlsx missing products: {miss[:5]}")
        check("DV" not in {i["code"] for i in stock_summary(only_with_data="false")["items"]}, "service never in stock summary")


@test("012,019,064", "test_REQ012_long_period_and_multi_year")
def _():
    k1 = wh("KHO1")
    p = mk_product()
    c = mk_partner(cust=True); s = mk_partner(supp=True)
    bal = 0
    for y in (2023, 2024, 2025):
        for m in (1, 6, 12):
            posted("purchase", f"{y}-{m:02d}-15", k1, [L(p["id"], 10, 100)], s["id"]); bal += 10
            posted("sale", f"{y}-{m:02d}-20", k1, [L(p["id"], 7, 150)], c["id"]); bal -= 7
    lg = ledger(p["id"], **{"from": "2023-01-01", "to": "2025-12-31"})
    eq(len(lg["rows"]), 18, "18 rows over 3 years"); eq(lg["closing"], bal, "closing")
    lg = ledger(p["id"], **{"from": "2024-06-16", "to": "2024-12-31"})
    eq(lg["opening"], 3 * 4 + 10, "opening mid 2024")  # 2023: +9, 2024-01: +3 ; 2024-06-15 purchase 10 before
    eq(lg["closing"], 3 * 6, "closing end 2024")
