"""Second wave of targeted attacks across C1/C3/C4/C7/C8/F."""
import re

from mr_lib import *


# ------------------------------------------------------------------ C1

@test("C1", "test_C1_mask_sum_total_with_type_filter_variants")
def _():
    """sum_total_amount must stay masked whatever spelling of type= lets purchases into the sum."""
    k1 = wh("KHO1")
    p = mk_product(sale=10, purchase=1)
    s = mk_partner(supp=True)
    posted("purchase", "2026-04-01", k1, [L(p["id"], 1, 9876543)], s["id"])
    bh = user("banhang")
    for t in ["purchase", "Purchase", "PURCHASE", " purchase", "purchase,", ",purchase", "sale,purchase", "purchase,purchase",
              "sale, purchase", "opening", "purchase_return"]:
        r = bh.get("/documents", type=t, page_size=1)
        if r.status != 200:
            check(r.status == 400, f"type={t!r} -> {r.status}")
            continue
        body = r.content.decode()
        check(not find_secrets(body, [9876543]), f"type={t!r}: purchase amount leaked: {body[:300]}")
        if r.json.get("total"):
            check(r.json.get("sum_total_amount") is None or not any(i.get("doc_type") in ("purchase", "purchase_return", "opening") for i in r.json["items"])
                  or r.json.get("sum_total_amount") is None, f"type={t!r}: sum_total_amount {r.json.get('sum_total_amount')} with purchase items")
    # q search over documents must not allow probing amounts either
    r = bh.get("/documents", q="9876543")
    check(not find_secrets(r.content.decode(), [9876543]), "q=amount does not echo the amount")


@test("C1", "test_C1_debt_view_masking_on_sale_doc_and_purchase_export_columns")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=1000, purchase=1)
    c = mk_partner(cust=True, rec=5554443)
    s = mk_partner(supp=True)
    posted("opening", "2026-04-01", k1, [L(p["id"], 100, 1)])
    sale = posted("sale", "2026-04-02", k1, [L(p["id"], 1, 1000)], c["id"])
    pu = posted("purchase", "2026-04-03", k1, [L(p["id"], 1, 3332221)], s["id"])
    tk = user("thukho")  # no debt.view
    d = tk.ok("GET", f"/documents/{sale['id']}")
    eq((d.get("old_debt"), d.get("total_debt")), (None, None), "thukho: old_debt/total_debt null on sale")
    h = tk.ok("GET", f"/documents/{sale['id']}/history")
    check(not find_secrets(json.dumps(h), [5554443, 5555443]), "thukho: history has no debt figures")
    for fmt in ("xlsx", "docx"):
        r = tk.get(f"/documents/{sale['id']}/export", format=fmt)
        txt = file_text(r.content)
        check("Nợ cũ" not in txt and "Tổng nợ" not in txt, f"thukho sale export {fmt} without Nợ cũ/Tổng nợ")
        check(not find_secrets(txt, [5554443, 5555443]), f"thukho sale export {fmt} has no debt figures")
        r = user("banhang").get(f"/documents/{sale['id']}/export", format=fmt)
        check("Nợ cũ" in file_text(r.content), f"banhang (debt.view) sale export {fmt} keeps Nợ cũ")
        r = user("banhang").get(f"/documents/{pu['id']}/export", format=fmt)
        txt = file_text(r.content)
        check("Đơn giá" not in txt and "Thành tiền" not in txt, f"banhang purchase export {fmt} drops Đơn giá/Thành tiền")
        check("Nợ cũ" not in txt, f"banhang purchase export {fmt} drops Nợ cũ")
        check(not find_secrets(txt, [3332221]), f"banhang purchase export {fmt} has no price")
    lst = tk.ok("GET", "/partners", params={"q": c["code"]})["items"][0]
    eq(lst.get("opening_receivable"), None, "thukho: opening_receivable masked")
    expect_err(tk.get(f"/partners/{c['id']}/balance"), 403, "FORBIDDEN", "thukho balance")


@test("C1", "test_C1_masked_credit_warning_with_bundled_loss_lines")
def _():
    """banhang (no cost.view) posts a sale that is both over the credit limit and below cost: the bundled loss lines
    inside CREDIT_WARNING must be masked like LOSS_WARNING."""
    k1 = wh("KHO1")
    p = mk_product(sale=10, purchase=7771119)
    c = mk_partner(cust=True)
    set_partner(c["id"], credit_limit=1)
    posted("opening", "2026-04-01", k1, [L(p["id"], 5, 7771119)])
    bh = user("banhang")
    d = bh.post("/documents", doc_body("sale", "2026-04-05", k1, [L(p["id"], 1, 100)], c["id"])).json
    r = bh.post(f"/documents/{d['id']}/post", {"version": d["version"]})
    if expect_err(r, 409, "CREDIT_WARNING", "over limit + loss"):
        check(not find_secrets(r.content.decode(), [7771119]), f"CREDIT_WARNING leaks cost: {r.content[:500]}")
        for ll in (r.details or {}).get("loss_lines") or []:
            eq(ll.get("cost_price"), None, "bundled loss line cost_price null")


# ------------------------------------------------------------------ C4

@test("C4", "test_C4_deleting_or_rekinding_opening_holders_while_locked")
def _():
    """Deleting a partner (no documents) that has an opening receivable, or a cash account with an opening balance,
    removes those undated figures from the locked period - must be blocked like editing them (N10)."""
    a = admin()
    c = mk_partner(cust=True, rec=1234)
    acc = mk_account("cash", 4321)
    acc2 = mk_account("cash", 999)
    try:
        eq(set_lock("2024-06-30").status, 200, "lock")
        r = a.delete(f"/partners/{c['id']}")
        check(r.status in (409, 422), f"delete partner with opening receivable while locked -> {r.short()[:250]}")
        r = a.delete(f"/cash-accounts/{acc['id']}")
        check(r.status in (409, 422), f"delete cash account with opening balance while locked -> {r.short()[:250]}")
        r = a.put(f"/cash-accounts/{acc2['id']}", {**acc2, "kind": "bank"})
        check(r.status in (409, 422), f"switch cash->bank of an account with opening balance while locked (moves the opening "
                                      f"between sổ quỹ and sổ ngân hàng of the locked period) -> {r.short()[:250]}")
    finally:
        clear_lock()


@test("C4", "test_C4_unchanged_opening_in_other_formats_and_masked_user_while_locked")
def _():
    a = admin()
    c = mk_partner(cust=True, supp=True, rec=1000, pay=500)
    acc = mk_account("bank", 2500.5)
    try:
        set_lock("2024-06-30")
        p = a.ok("GET", f"/partners/{c['id']}")
        for v in ["1000", "1000.00", 1000.0, "1000.004"]:  # 1000.004 rounds to 1000.00 (B12: round first, then compare)
            r = a.put(f"/partners/{c['id']}", partner_body(p, opening_receivable=v, address="x"))
            eq(r.status, 200, f"opening_receivable sent as {v!r} (same value) is not a change")
        r = a.put(f"/cash-accounts/{acc['id']}", {**acc, "opening_balance": "2500.50", "name": "đổi tên"})
        eq(r.status, 200, "opening_balance '2500.50' == 2500.5")
        # masked user (no debt.view / cost.view / cash.view) editing name while locked: masked fields kept -> allowed
        try:
            set_matrix({"thukho": ["stock.write", "catalog.write"]})
            tk = user("thukho")
            mp = tk.ok("GET", f"/partners/{c['id']}")
            r = tk.put(f"/partners/{c['id']}", partner_body(mp, name="Tên mới khi khóa"))
            eq(r.status, 200, "masked user edits partner name while locked")
            ta = [x for x in tk.ok("GET", "/cash-accounts")["items"] if x["id"] == acc["id"]][0]
            r = tk.put(f"/cash-accounts/{acc['id']}", {**ta, "name": "TK đổi bởi thủ kho"})
            eq(r.status, 200, "masked user renames account while locked")
        finally:
            restore_matrix()
        p = a.ok("GET", f"/partners/{c['id']}")
        eq((p["opening_receivable"], p["opening_payable"]), (1000, 500), "openings intact")
    finally:
        clear_lock()


# ------------------------------------------------------------------ C3

@test("C3", "test_C3_group_matching_and_single_creation")
def _():
    a = admin()
    g = a.post("/product-groups", {"code": uid("GQ"), "name": "Que hàn đặc biệt " + RUN}).json
    hdr = ["Mã hàng", "Tên hàng", "ĐVT", "Nhóm VTHH"]
    rows = [[uid("GM"), "theo mã", "Cái", g["code"]], [uid("GM"), "theo tên", "Cái", g["name"]],
            [uid("GM"), "tên khác hoa", "Cái", g["name"].upper()], [uid("GM"), "không dấu", "Cái", "que han dac biet " + RUN]]
    newg = "Nhóm mới QA " + RUN
    rows += [[uid("GM"), f"nhóm mới {i}", "Cái", newg] for i in range(5)]
    r = upload(a, "products", xlsx_bytes(hdr, rows), dry=True)
    res = import_result(r)
    eq(res.get("errors"), [], "no errors")
    notes = " ".join(res.get("notes") or [])
    m = re.search(r"tạo (\d+) nhóm", notes)
    n_new = int(m.group(1)) if m else 0
    check(n_new == 1, f"only 1 new group expected (existing group matched by code/name/case/accents): notes={res.get('notes')}")
    r = upload(a, "products", xlsx_bytes(hdr, rows), dry=False)
    eq(r.status, 200, "import")
    grp = a.ok("GET", "/product-groups", params={"q": "nhom moi qa " + RUN})["items"]
    eq(len(grp), 1, "exactly one group created for 5 rows")
    for row in rows[:4]:
        p = a.ok("GET", "/products/lookup", params={"code": row[0]})
        check(p.get("group_id") == g["id"], f"row '{row[1]}' ({row[3]!r}) linked to existing group, got {p.get('group_name')!r}")


@test("C3", "test_C3_opening_stock_price_column_for_user_without_cost_view")
def _():
    """products import ignores 'Giá mua' for users without cost.view (API §8.4). The opening-stock 'Đơn giá' is the same
    kind of figure (N5 treats opening docs as cost documents) - check it is handled consistently."""
    p = mk_product(purchase=111)
    tk = user("thukho")
    r = upload(tk, "opening_stock", xlsx_bytes(["Mã hàng", "Mã kho", "Số lượng", "Đơn giá"], [[p["code"], "KHO1", 1, 999]]),
               dry=False, date="2026-10-20")
    eq(r.status, 200, "thukho imports opening stock with a price column")
    if r.status == 200:
        d = get_doc(r.json["documents"][0]["id"])
        price = num(d["lines"][0]["unit_price"])
        notes = (r.json or {}).get("notes") or []
        print(f"      note: thukho (no cost.view) opening-stock import with Đơn giá 999 stored {price}; notes={notes}")
        check(price == 999 or any("Đơn giá" in n for n in notes), "either stored as given or a note explains it was ignored")
        admin().delete(f"/documents/{d['id']}")


# ------------------------------------------------------------------ G / F

@test("G", "test_G_formula_injection_in_exports")
def _():
    """Names starting with '=' entered via API/import must be exported as text cells, never as live formulas."""
    a = admin()
    k1 = wh("KHO1")
    evil = '=HYPERLINK("http://evil.example","bấm")'
    p = a.post("/products", {"code": uid("INJ"), "name": evil, "unit": "Cái", "sale_price": 1}).json
    posted("opening", "2026-04-10", k1, [L(p["id"], 1, 1)])
    c = mk_partner(cust=True, name="=1+2")
    s = posted("sale", "2026-04-11", k1, [L(p["id"], 1, 1, note="=SUM(A1:A9)")], c["id"])
    for path, params in [("/reports/stock-summary", {}), (f"/documents/{s['id']}/export", {}), ("/reports/sales", {"from": "2026-04-01"})]:
        r = a.get(path, format="xlsx", **params)
        wb = open_xlsx(r.content)
        for ws in wb.worksheets:
            for row in ws.iter_rows():
                for cell in row:
                    if isinstance(cell.value, str) and ("evil.example" in cell.value or cell.value in ("=1+2", "=SUM(A1:A9)")):
                        check(cell.data_type == "s", f"{path}: {cell.coordinate} {cell.value!r} exported as {cell.data_type} (formula!)")


@test("F", "test_F_sse_on_matrix_and_lock_change")
def _():
    sse = SSE(user("thukho"))
    try:
        set_matrix({"thukho": ["stock.write"]})
        e1 = sse.wait_for(lambda e: e.get("type") == "features", 4)
        check(e1 is not None, "SSE 'features' after role-permissions change")
        n = len(sse.events)
        set_lock("2020-01-31")
        time.sleep(0.5)
        check(any(e.get("type") == "features" for e in sse.events[n:]), "SSE 'features' after lock change")
    finally:
        clear_lock()
        sse.stop()


# ------------------------------------------------------------------ C8 / C7

@test("C8", "test_C8_aging_supplier_only_partner_with_receivable")
def _():
    """A supplier-only partner can carry a receivable (payment with debt_side=receivable, API §4). The aging must still
    equal the receivable ledger for that partner."""
    a = admin()
    s = mk_partner(supp=True)
    acc = mk_account("cash", 0)
    r = a.post("/vouchers", {"voucher_type": "payment", "voucher_date": "2023-05-01", "account_id": acc["id"], "partner_id": s["id"],
                             "debt_side": "receivable", "lines": [{"description": "ứng trước cho NCC", "amount": 700}]})
    eq(r.status, 201, "payment on receivable side to a supplier")
    led = rec_ledger_closing(s["id"], "2023-12-31")
    eq(led, 700, "receivable ledger 700")
    it = aging_item(s["id"], "2023-12-31")
    check(it is not None and num(it["total"]) == led, f"aging includes the supplier's receivable: {it and it['total']}")


@test("C7", "test_C7_same_day_purchase_and_sale_and_reentry_after_zero")
def _():
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=999)
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    posted("purchase", "2025-06-01", k1, [L(p["id"], 2, 50)], s["id"])
    d1 = posted("sale", "2025-06-01", k1, [L(p["id"], 1, 100)], c["id"])
    posted("purchase_return", "2025-06-02", k1, [L(p["id"], 1, 50)], s["id"])  # qty 1 left (cum. qty 1, value 50)
    posted("purchase", "2025-06-03", k1, [L(p["id"], 1, 80)], s["id"])  # cum qty 2, value 130 -> 65
    d2 = posted("sale", "2025-06-03", k1, [L(p["id"], 1, 100)], c["id"])
    rows = {it["document_id"]: it for it in profit(group_by="document", **{"from": "2025-06-01", "to": "2025-06-30"})["items"]}
    eq((rows.get(d1["id"], {}).get("cost"), rows.get(d1["id"], {}).get("estimated")), (50, False), "same-day purchase counts")
    # inputs up to 06-03: 2@50 (100) - return 1@50 (50) + 1@80 (80) -> qty 2, value 130 -> avg 65
    eq(rows.get(d2["id"], {}).get("cost"), 65, "avg after a supplier return and a re-purchase")


@test("C8", "test_C8_credit_confirmation_history_masked_for_user_without_debt_view")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=10, purchase=0)
    posted("opening", "2023-01-01", k1, [L(p["id"], 100, 0)])
    c = mk_partner(cust=True, rec=8887776)
    set_partner(c["id"], credit_limit=1000)
    d = draft("sale", "2023-06-01", k1, [L(p["id"], 1, 10)], c["id"])
    r = a.post(f"/documents/{d['id']}/post", {"version": d["version"], "confirm_credit": True})
    eq(r.status, 200, "admin confirms credit")
    h = a.ok("GET", f"/documents/{d['id']}/history")
    check(find_secrets(json.dumps(h, ensure_ascii=False), [8887776]), "positive control: admin history shows the receivable")
    tk = user("thukho")  # no debt.view
    ht = tk.ok("GET", f"/documents/{d['id']}/history")
    leaks = find_secrets(json.dumps(ht, ensure_ascii=False), [8887776, 8887786, 8886786, 1000])
    leaks = [x for x in leaks if x not in ("1000", "1.000", "1,000", "1 000")]  # 1000 too common; only real debt figures
    check(not leaks, f"thukho history of a credit-confirmed sale leaks debt figures: {leaks}")


@test("C3", "test_C3_absurd_lengths_and_reimport_opening_stock_twice")
def _():
    a = admin()
    r = upload(a, "products", xlsx_bytes(["Mã hàng", "Tên hàng", "ĐVT"], [["X" * 1000, "Tên", "Cái"], [uid("LEN"), "T" * 30000, "Cái"],
                                                                                [uid("LEN"), "Tên", "Đ" * 1000]]), dry=False)
    check(r.status in (200, 422), f"absurd lengths -> {r.status}")
    if r.status == 200:
        print("      note: product code of 1000 chars / name of 30000 chars / unit of 1000 chars accepted by import")
    # same opening stock file imported twice -> two sets of drafts; is the user warned?
    p = mk_product(purchase=1)
    f = xlsx_bytes(["Mã hàng", "Mã kho", "Số lượng"], [[p["code"], "KHO1", 5]])
    r1 = upload(a, "opening_stock", f, dry=False, date="2026-10-25")
    r2 = upload(a, "opening_stock", f, dry=True, date="2026-10-25")
    eq((r1.status, r2.status), (200, 200), "both accepted")
    notes = (r2.json or {}).get("notes") or []
    print(f"      note: re-importing the same opening stock: dry-run notes={notes}")
    check(True, "documented")
    for d in (r1.json or {}).get("documents") or []:
        a.delete(f"/documents/{d['id']}")


@test("C4", "test_C4_lock_today_blocks_today")
def _():
    a = admin()
    today = a.ok("GET", "/dashboard")["today"]
    k1 = wh("KHO1")
    p = mk_product(sale=1)
    c = mk_partner(cust=True)
    try:
        eq(set_lock(today).status, 200, "lock today")
        r = create_doc("sale", None, k1, [L(p["id"], 1, 1)], c["id"])
        expect_err(r, 422, "PERIOD_LOCKED", "doc_date omitted (= today) inside lock")
        r = a.post("/vouchers", {"voucher_type": "receipt", "account_id": mk_account()["id"], "partner_id": c["id"], "lines": [{"description": "x", "amount": 1}]})
        expect_err(r, 422, "PERIOD_LOCKED", "voucher_date omitted (= today) inside lock")
    finally:
        clear_lock()


@test("C7", "test_C7_cumulative_average_ignores_stock_on_hand_documented")
def _():
    """Spec C7: average over ALL purchases + opening up to the sale date, regardless of what was sold in between.
    Bought 100 @10 (2025-07-01), sold all 100 (07-02), bought 1 @100 (07-03), sold 1 @120 (07-04).
    Spec value: avg = (1000+100)/101 = 10.89 -> cost 11, profit 109 although the unit really cost 100 (true profit 20).
    The test asserts the SPEC value (so it passes) and prints the gap for the report."""
    k1 = wh("KHO1")
    p = mk_product(sale=120, purchase=10)
    s, c = mk_partner(supp=True), mk_partner(cust=True)
    posted("purchase", "2025-07-01", k1, [L(p["id"], 100, 10)], s["id"])
    posted("sale", "2025-07-02", k1, [L(p["id"], 100, 12)], c["id"])
    posted("purchase", "2025-07-03", k1, [L(p["id"], 1, 100)], s["id"])
    d = posted("sale", "2025-07-04", k1, [L(p["id"], 1, 120)], c["id"])
    row = {it["document_id"]: it for it in profit(group_by="document", **{"from": "2025-07-01", "to": "2025-07-31"})["items"]}.get(d["id"])
    if check(row is not None, "row"):
        eq(row["cost"], 11, "spec rule: cumulative average 1100/101 -> cost 11")
        print(f"      note: last unit bought at 100 is costed at {row['cost']} -> profit {row['profit']} (moving average would give cost 100, profit 20)")
