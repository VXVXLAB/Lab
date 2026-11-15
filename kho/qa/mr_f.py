"""F — feature switches (SPEC_MO_RONG §0, API §8.1, QUYET_DINH N1, N3, N11, N14, O1)."""
from mr_lib import *


@test("F", "test_F_defaults_extended_edition")
def _():
    f = features()
    eq(f.get("edition"), "extended", "edition")
    eq(sorted(f["features"].keys()), sorted(ALL_KEYS), "11 feature keys")
    for k in AVAILABLE:
        eq(f["features"].get(k), True, f"default ON in extended: {k}")
    for k in UNAVAILABLE:
        eq(f["features"].get(k), False, f"unavailable OFF: {k}")
    items = {i["key"]: i for i in f["items"]}
    eq(len(f["items"]), 11, "items has 11 entries")
    for k in UNAVAILABLE:
        check(items.get(k, {}).get("available") is False and items[k]["enabled"] is False, f"item {k} unavailable")
    for k in AVAILABLE:
        check(items.get(k, {}).get("available") is True, f"item {k} available")
        check(has_vietnamese(items.get(k, {}).get("name", "")) or items.get(k, {}).get("name"), f"item {k} has name")
    m = me(admin())
    eq(sorted(m.get("permissions") or []), sorted(PERMS), "admin /auth/me permissions = all 10")
    check(isinstance(m.get("features"), dict), "/auth/me carries features")
    # every logged-in role can read features
    for role in ["ketoan", "banhang", "muahang", "thukho"]:
        r = user(role).get("/features")
        eq(r.status, 200, f"{role} GET /features")
        r = user(role).get("/period-lock")
        eq(r.status, 200, f"{role} GET /period-lock")
    eq(Client(None).get("/features").status, 401, "anonymous GET /features")


@test("F", "test_F_only_admin_can_switch")
def _():
    for role in ["ketoan", "banhang", "muahang", "thukho"]:
        r = set_features(c=user(role), min_stock=False)
        expect_err(r, 403, "FORBIDDEN", f"{role} PUT /features")
    eq(features()["features"]["min_stock"], True, "min_stock still on after forbidden attempts")


@test("F", "test_F_unknown_unavailable_and_garbage_keys")
def _():
    a = admin()
    for k in UNAVAILABLE:
        r = set_features(**{k: True})
        eq(r.status, 400, f"PUT unavailable {k}=true")
        r = set_features(**{k: False})
        check(r.status in (200, 400), f"PUT unavailable {k}=false -> {r.status}")
    eq(set_features(khong_co=True).status, 400, "unknown key")
    eq(set_features(permissions="có").status, 400, "non-bool value")
    eq(set_features(permissions=None).status, 400, "null value")
    eq(a.req("PUT", "/features", raw=b"{oops").status, 400, "malformed JSON")
    eq(a.req("PUT", "/features", raw=b"[]").status, 400, "array body")
    eq(a.put("/features", {"features": {"min\u0000stock": True}}).status, 400, "NUL in key")
    eq(a.put("/features", {"features": "all"}).status, 400, "features not an object")
    # atomic: one bad key -> nothing changes
    r = set_features(min_stock=False, vat=True)
    eq(r.status, 400, "mixed valid+unavailable")
    eq(features()["features"]["min_stock"], True, "min_stock unchanged after rejected mixed PUT")
    r = a.put("/features", {"features": {}})
    check(r.status in (200, 400), f"empty features map -> {r.status}")
    check(r.status < 500, "no 5xx")
    for k in UNAVAILABLE:
        eq(features()["features"][k], False, f"{k} still off")


def _feature_off_404(c, method, path, label, body=None):
    r = c.req(method, path, body=body)
    expect_err(r, 404, "FEATURE_OFF", label)


@test("F", "test_F_switch_off_hides_endpoints_and_fields_data_stays")
def _():
    a = admin()
    k1 = wh("KHO1")
    prod = mk_product(sale=1000, purchase=600)
    cust = mk_partner(cust=True)
    r = set_product(prod["id"], min_stock=7)
    eq(r.status, 200, "set min_stock")
    r = set_partner(cust["id"], credit_limit=500, payment_days=10)
    eq(r.status, 200, "set credit limit")
    r = a.put(f"/partners/{cust['id']}/prices", {"items": [{"product_id": prod["id"], "price": 1234, "note": "HĐ"}]})
    eq(r.status, 200, "set customer price")
    posted("opening", "2026-01-02", k1, [L(prod["id"], 50, 600)])
    sse = SSE(user("banhang"))
    try:
        r = set_features(min_stock=False, price_list=False, credit_limit=False, profit_report=False, import_excel=False,
                         period_lock=False)
        eq(r.status, 200, "switch 6 features off")
        ev = sse.wait_for(lambda e: e.get("type") == "features", 5)
        check(ev is not None, "SSE 'features' event received by another user")
        f = features()["features"]
        for k in ["min_stock", "price_list", "credit_limit", "profit_report", "import_excel", "period_lock"]:
            eq(f[k], False, f"{k} off")
        # endpoints -> 404 FEATURE_OFF
        for m, p in [("GET", "/reports/low-stock"), ("GET", f"/partners/{cust['id']}/prices"),
                     ("PUT", f"/partners/{cust['id']}/prices"), ("DELETE", f"/partners/{cust['id']}/prices/{prod['id']}"),
                     ("GET", f"/products/sale-price?partner_id={cust['id']}&ids={prod['id']}"),
                     ("GET", "/reports/debt-aging"), ("GET", "/reports/profit"), ("GET", "/reports/profit?format=xlsx"),
                     ("GET", "/import/products/template"), ("GET", "/period-lock"), ("PUT", "/period-lock"),
                     ("GET", "/reports/debt-aging?format=xlsx"), ("GET", "/reports/low-stock?format=xlsx")]:
            _feature_off_404(a, m, p, f"{m} {p} with feature off", body={} if m == "PUT" else None)
        r = upload(a, "products", xlsx_bytes(["Mã hàng", "Tên hàng", "ĐVT"], [["OFF1", "x", "c"]]))
        expect_err(r, 404, "FEATURE_OFF", "POST /import/products with import_excel off")
        # fields hidden
        p = a.ok("GET", f"/products/{prod['id']}")
        check("min_stock" not in p, f"product JSON without min_stock when off: {sorted(p)}")
        pl = a.ok("GET", "/products", params={"q": prod["code"]})["items"][0]
        check("min_stock" not in pl, "product list without min_stock when off")
        c = a.ok("GET", f"/partners/{cust['id']}")
        check("credit_limit" not in c and "payment_days" not in c, f"partner JSON without credit fields when off: {sorted(c)}")
        d = a.ok("GET", "/dashboard")
        check("low_stock_rule" not in d, "dashboard has no low_stock_rule when min_stock off")
        dd = a.ok("GET", "/reports/draft-demand")
        for it in dd["items"]:
            check("min_stock" not in it and "order_more" not in it, "draft-demand without min_stock fields when off")
            break
        # behaviour = base edition: auto price is default sale price, no credit warning
        s = draft("sale", "2026-02-01", k1, [L(prod["id"], 1)], cust["id"])
        eq(s["lines"][0]["unit_price"], 1000, "price_list off: omitted unit_price -> default sale price")
        s2 = draft("sale", "2026-02-01", k1, [L(prod["id"], 1, 1000)], cust["id"])
        r = post_doc(s2)
        eq(r.status, 200, "credit_limit off: posting over limit (1000 > 500) is not warned")
        # PUT product/partner with new fields while off -> ignored, value kept
        r = set_product(prod["id"], min_stock=99)
        eq(r.status, 200, "PUT product with min_stock while off")
        r = set_partner(cust["id"], credit_limit=1)
        eq(r.status, 200, "PUT partner with credit_limit while off")
    finally:
        all_features_on()
        sse.stop()
    p = a.ok("GET", f"/products/{prod['id']}")
    eq(p.get("min_stock"), 7, "min_stock kept after off/on (and not changed by PUT while off)")
    c = a.ok("GET", f"/partners/{cust['id']}")
    eq(c.get("credit_limit"), 500, "credit_limit kept after off/on")
    eq(c.get("payment_days"), 10, "payment_days kept")
    pr = a.ok("GET", f"/partners/{cust['id']}/prices")["items"]
    check(any(i["product_id"] == prod["id"] and num(i["price"]) == 1234 for i in pr), "customer price kept after off/on")
    eq(a.get("/reports/low-stock").status, 200, "low-stock back")


@test("F", "test_F_permissions_off_needs_confirm_and_new_roles_act_as_ketoan")
def _():
    a = admin()
    bh = mk_user("banhang", full_name="Nguyễn Văn Bán QA")
    sup = mk_partner(supp=True)
    prod = mk_product(sale=10, purchase=777123)
    k1 = wh("KHO1")
    eq(create_doc("purchase", "2026-03-01", k1, [L(prod["id"], 1)], sup["id"], c=bh).status, 403, "banhang cannot buy (on)")
    try:
        r = set_features(permissions=False)
        expect_err(r, 409, "IN_USE", "switch permissions off while banhang users exist")
        if r.status == 409:
            check("Nguyễn Văn Bán QA" in r.json["error"]["message"] or bh.user["username"] in r.json["error"]["message"],
                  f"409 message names the user: {r.json['error']['message'][:300]}")
            check(isinstance((r.details or {}).get("users"), list), "details.users is a list")
        eq(features()["features"]["permissions"], True, "still on after 409")
        r = set_features(permissions=False, confirm=False)
        eq(r.status, 409, "confirm=false still 409")
        r = set_features(permissions=True, confirm=False)
        eq(r.status, 200, "switching ON never needs confirm")
        r = set_features(permissions=False, confirm=True)
        eq(r.status, 200, "confirm=true switches off")
        m = me(bh)
        eq(sorted(m.get("permissions") or []), sorted(PERMS), "banhang has all 10 permissions when feature off")
        r = create_doc("purchase", "2026-03-01", k1, [L(prod["id"], 1)], sup["id"], c=bh)
        eq(r.status, 201, "banhang acts as ketoan when permissions off")
        if r.status == 201:
            eq(r.json["lines"][0]["unit_price"], 777123, "cost visible (not masked) when permissions off")
        eq(bh.get(f"/products/{prod['id']}").json.get("purchase_price"), 777123, "purchase_price visible when off")
        expect_err(a.get("/role-permissions"), 404, "FEATURE_OFF", "role-permissions when off")
        expect_err(a.put("/role-permissions", {"matrix": {"thukho": []}}), 404, "FEATURE_OFF", "PUT role-permissions when off")
        r = a.post("/users", {"username": uid("u_off").lower(), "password": "123456", "full_name": "x", "role": "thukho"})
        eq(r.status, 400, "cannot create a new-role user when permissions off (N3)")
        r = a.put(f"/users/{bh.user['id']}", {"role": "muahang"})
        eq(r.status, 400, "cannot change user to another new role when off (N3)")
        r = a.post("/users", {"username": uid("u_off").lower(), "password": "123456", "full_name": "x", "role": "ketoan"})
        eq(r.status, 201, "ketoan user creatable when off")
        # still admin-only things stay admin-only
        expect_err(bh.put("/settings", {"company_name": "x"}), 403, "FORBIDDEN", "banhang-as-ketoan cannot PUT settings")
        expect_err(set_features(c=bh, permissions=True), 403, "FORBIDDEN", "banhang-as-ketoan cannot switch features")
    finally:
        all_features_on()
    eq(create_doc("purchase", "2026-03-01", k1, [L(prod["id"], 1)], sup["id"], c=bh).status, 403,
       "banhang restricted again after permissions back on")
    eq(bh.get(f"/products/{prod['id']}").json.get("purchase_price"), None, "masked again after back on")
    # deactivate the extra user so later permission-off tests are not blocked by it
    a.put(f"/users/{bh.user['id']}", {"active": False})


@test("F", "test_F_permissions_off_with_only_inactive_new_role_users")
def _():
    """An inactive banhang user: does it still block switching permissions off? (documents behaviour)"""
    a = admin()
    # make sure every active new-role user is our known cached ones -> deactivate them temporarily
    users = a.ok("GET", "/users")["items"]
    active_new = [u for u in users if u["role"] in ("banhang", "muahang", "thukho") and u["active"]]
    for u in active_new:
        a.put(f"/users/{u['id']}", {"active": False})
    try:
        r = set_features(permissions=False)
        eq(r.status, 200, "only INACTIVE new-role users -> no 409 (API §10, P9)")
    finally:
        all_features_on()
        for u in active_new:
            a.put(f"/users/{u['id']}", {"active": True})
    relogin_cached()  # deactivation killed the cached sessions
