"""BASE edition (server started WITHOUT KHO_EDITION): every extended feature is off by default, its endpoints answer
404 FEATURE_OFF, and base responses carry none of the new fields (SPEC_MO_RONG §0)."""
from mr_lib import *

NEW_PRODUCT_FIELDS = {"min_stock"}
NEW_PARTNER_FIELDS = {"credit_limit", "payment_days"}


def off(r, label):
    return expect_err(r, 404, "FEATURE_OFF", label)


@test("F", "test_BASE_edition_defaults_all_off")
def _():
    f = features()  # runs first: nothing has been switched yet
    eq(f.get("edition"), "base", "edition base")
    for k in ALL_KEYS:
        eq(f["features"].get(k), False, f"{k} off in base edition")
    items = {i["key"]: i for i in f["items"]}
    for k in AVAILABLE:
        check(items.get(k, {}).get("available") is True and items[k]["enabled"] is False, f"{k} available but disabled")
    m = me(admin())
    eq(sorted(m.get("permissions") or []), sorted(PERMS), "admin has the 10 permissions (API §8.1)")


@test("F", "test_BASE_feature_endpoints_404_FEATURE_OFF")
def _():
    a = admin()
    c = mk_partner(cust=True)
    p = mk_product(sale=10, purchase=5)
    off(a.get("/role-permissions"), "GET role-permissions")
    off(a.put("/role-permissions", {"matrix": {"thukho": []}}), "PUT role-permissions")
    off(a.get("/period-lock"), "GET period-lock")
    off(a.put("/period-lock", {"lock_date": "2024-01-01"}), "PUT period-lock")
    for kind in ["products", "partners", "opening_stock", "opening_debt", "partner_prices"]:
        off(a.get(f"/import/{kind}/template"), f"template {kind}")
        off(upload(a, kind, xlsx_bytes(["Mã hàng"], [["A"]])), f"import {kind} dry-run")
        off(upload(a, kind, xlsx_bytes(["Mã hàng"], [["A"]]), dry=False), f"import {kind}")
    off(a.get(f"/partners/{c['id']}/prices"), "GET prices")
    off(a.put(f"/partners/{c['id']}/prices", {"items": [{"product_id": p["id"], "price": 1}]}), "PUT prices")
    off(a.delete(f"/partners/{c['id']}/prices/{p['id']}"), "DELETE price")
    off(a.get("/products/sale-price", partner_id=c["id"], ids=p["id"]), "sale-price")
    for path in ["/reports/low-stock", "/reports/debt-aging", "/reports/profit"]:
        off(a.get(path), path)
        off(a.get(path, format="xlsx"), path + " xlsx")
    # non-admin too
    off(user("ketoan").get("/reports/profit"), "ketoan profit")
    # anonymous still 401 (auth before feature)
    eq(Client(None).get("/reports/profit").status, 401, "anon profit -> 401")


@test("F", "test_BASE_responses_have_no_new_fields")
def _():
    a = admin()
    k1 = wh("KHO1")
    r = a.post("/products", {"code": uid("B"), "name": "Bản chuẩn", "unit": "Cái", "sale_price": 1000, "purchase_price": 600, "min_stock": 50})
    eq(r.status, 201, "POST product with min_stock in base (field ignored)")
    p = r.json
    check(not (NEW_PRODUCT_FIELDS & set(p)), f"POST response without min_stock: {sorted(p)}")
    for obj, label in [(a.ok("GET", f"/products/{p['id']}"), "GET product"),
                       (a.ok("GET", "/products", params={"q": p["code"]})["items"][0], "product list"),
                       (a.ok("GET", "/products", params={"q": p["code"], "with_stock": "true"})["items"][0], "product list with_stock"),
                       (a.ok("GET", "/products/lookup", params={"code": p["code"]}), "lookup")]:
        check(not (NEW_PRODUCT_FIELDS & set(obj)), f"{label} without min_stock: {sorted(obj)}")
    r = a.post("/partners", {"code": uid("BK"), "name": "Khách bản chuẩn", "is_customer": True, "credit_limit": 1, "payment_days": 9})
    eq(r.status, 201, "POST partner with credit fields (ignored)")
    c = r.json
    check(not (NEW_PARTNER_FIELDS & set(c)), f"partner without credit fields: {sorted(c)}")
    for obj, label in [(a.ok("GET", f"/partners/{c['id']}"), "GET partner"), (a.ok("GET", "/partners", params={"q": c["code"]})["items"][0], "partner list")]:
        check(not (NEW_PARTNER_FIELDS & set(obj)), f"{label} without credit fields")
    # behaviour: no credit warning, default auto price
    posted("opening", "2026-01-01", k1, [L(p["id"], 10, 600)])
    d = draft("sale", "2026-02-01", k1, [L(p["id"], 1)], c["id"])
    eq(d["lines"][0]["unit_price"], 1000, "omitted unit_price -> default sale price")
    eq(post_doc(d).status, 200, "posting ignores the (ignored) credit limit")
    dash = a.ok("GET", "/dashboard")
    check("low_stock_rule" not in dash, "dashboard without low_stock_rule")
    eq(dash.get("low_stock_threshold"), 5, "threshold 5")
    draft("sale", "2026-02-02", k1, [L(p["id"], 50)], c["id"])
    for it in a.ok("GET", "/reports/draft-demand")["items"]:
        check("min_stock" not in it and "order_more" not in it, "draft-demand without new fields")
    r = a.get("/reports/draft-demand", format="xlsx")
    check("Cần đặt thêm" not in xlsx_text(open_xlsx(r.content)), "draft-demand xlsx without new columns")
    # no period lock: old dates, opening balances freely editable
    eq(set_partner(c["id"], opening_receivable=123).status, 200, "opening balance editable")
    eq(create_doc("sale", "2001-01-01", k1, [L(p["id"], 1, 1000)], c["id"]).status, 201, "any date allowed")
    # users: new roles rejected
    r = a.post("/users", {"username": uid("bu").lower(), "password": "123456", "full_name": "x", "role": "banhang"})
    eq(r.status, 400, "cannot create banhang user in base (feature off)")
    eq(a.post("/users", {"username": uid("bu").lower(), "password": "123456", "full_name": "x", "role": "ketoan"}).status, 201, "ketoan ok")
    # ketoan can do everything incl. seeing cost
    kt = user("ketoan")
    eq(kt.get(f"/products/{p['id']}").json.get("purchase_price"), 600, "ketoan sees cost in base")
    eq(kt.get("/reports/purchases").status, 200, "ketoan purchases report")


@test("F", "test_BASE_admin_can_switch_a_feature_on_and_off")
def _():
    a = admin()
    p = mk_product(sale=1)
    try:
        r = set_features(min_stock=True)
        eq(r.status, 200, "enable min_stock in base edition")
        eq(features()["features"]["min_stock"], True, "now on")
        eq(set_product(p["id"], min_stock=4).status, 200, "set min_stock")
        eq(a.ok("GET", f"/products/{p['id']}").get("min_stock"), 4, "field appears")
        eq(a.get("/reports/low-stock").status, 200, "low-stock available")
        eq(set_features(khong_co=True).status, 400, "unknown feature key rejected")
    finally:
        set_features(**{k: False for k in ALL_KEYS})
    check("min_stock" not in a.ok("GET", f"/products/{p['id']}"), "field hidden again")
    eq(features()["features"]["min_stock"], False, "off again")


@test("F", "test_BASE_audit_endpoint_admin_only")
def _():
    """P8: GET /api/audit exists in the base edition too (admin only, read-only)."""
    a = admin()
    mk_product(sale=1)
    r = a.get("/audit", limit=5)
    eq(r.status, 200, "admin GET /audit in base")
    if r.status == 200:
        check(len(r.json["items"]) >= 1 and r.json["items"][0].get("entity"), "rows present")
    expect_err(user("ketoan").get("/audit"), 403, "FORBIDDEN", "ketoan GET /audit in base")
    eq(Client(None).get("/audit").status, 401, "anon")
    j = requests.post(lib.BASE + "/auth/login", json={"username": "admin", "password": "admin123"}).json()
    eq(sorted(j.get("permissions") or []), sorted(PERMS), "login permissions in base = all 10")
    eq(j.get("features"), features()["features"], "login features = effective features (independent of other tests)")


@test("F", "test_BASE_m3_endpoints_off_and_no_m3_fields")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=10)
    c = mk_partner(cust=True)
    for path in [f"/products/{p['id']}/units", f"/documents/stocktake-load?warehouse_id={k1}", "/reports/vat-summary",
                 "/settings/vat", "/print-template", "/print-template/logo"]:
        off(a.get(path), path)
    off(a.put(f"/products/{p['id']}/units", {"items": []}), "PUT units")
    eq(a.post("/documents", {"doc_type": "stocktake", "doc_date": "2026-01-02", "warehouse_id": k1, "lines": [L(p["id"], 1)]}).status, 400,
       "stocktake doc_type -> 400 like the original base")
    g = a.ok("GET", f"/products/{p['id']}")
    check(not ({"units", "vat_rate"} & set(g)), f"product without units / vat_rate: {sorted(g)}")
    posted("opening", "2026-01-01", k1, [L(p["id"], 10, 10)])
    d = posted("sale", "2026-01-02", k1, [L(p["id"], 2, 100, unit="Thùng")], c["id"])
    new_doc = {"goods_amount", "tax_amount", "amount_in_words", "book_changed_lines"}
    new_line = {"factor", "base_qty", "base_unit", "vat_rate", "tax_amount", "amount_with_tax", "book_qty", "counted_qty", "diff_qty"}
    check(not (new_doc & set(d)), f"document without M3 fields: {sorted(new_doc & set(d))}")
    check(not (new_line & set(d["lines"][0])), f"line without M3 fields: {sorted(new_line & set(d['lines'][0]))}")
    eq(d["lines"][0]["unit"], "Thùng", "free-text unit as in base")
    eq(stock_of(p["id"])[1], 8, "factor 1")
    rep = a.ok("GET", "/reports/sales", params={"from": "2026-01-01", "to": "2026-01-31"})
    check(not ({"total_tax", "total_with_tax", "vat_summary"} & set(rep)), "sales report without VAT fields")
    check(not ({"base_qty", "vat_rate", "tax_amount"} & set(rep["rows"][0])), "sales report rows without M3 fields")
    r = a.post("/documents", doc_body("sale", "2026-01-03", k1, [L(p["id"], 1, 100, vat_rate=10)], c["id"]))
    check(r.status in (201, 400), f"vat_rate sent to base -> {r.status}")
    if r.status == 201:
        check("vat_rate" not in r.json["lines"][0] and r.json["total_amount"] == 100, "vat_rate ignored in base")
