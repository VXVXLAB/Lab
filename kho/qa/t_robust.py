"""Robustness: bad input, auth, search, huge numbers, decimals."""
from lib import *


@test("042", "test_ROBUST_auth_required_everywhere")
def _():
    anon = Client(None, "anon")
    paths = ["/auth/me", "/warehouses", "/products", "/partners", "/cash-accounts", "/product-groups", "/documents", "/documents/1",
             "/vouchers", "/reports/stock-summary", "/reports/stock-nxt", "/reports/stock-ledger?product_id=1", "/reports/sales",
             "/reports/purchases", "/reports/debt-summary", "/reports/debt-ledger?partner_id=1", "/reports/cash-book",
             "/reports/draft-demand", "/dashboard", "/users", "/documents/1/export", "/products/1/price-info", "/products/lookup?code=DV"]
    for p in paths:
        r = anon.req("GET", p)
        eq(r.status, 401, f"anon GET {p}")
        check(r.code == "UNAUTHORIZED", f"anon GET {p} code {r.code}")
    r = anon.req("POST", "/documents", {"doc_type": "sale"})
    eq(r.status, 401, "anon POST documents")
    bad = Client("deadbeef", "bad")
    eq(bad.req("GET", "/documents").status, 401, "bogus token")
    r = requests.post(BASE + "/auth/login", json={"username": "admin", "password": "sai"})
    eq(r.status_code, 401, "wrong password")
    check("mật khẩu" in r.text, "Vietnamese message")
    r = requests.post(BASE + "/auth/login", json={"username": "ADMIN", "password": "admin123"})
    eq(r.status_code, 200, "username case-insensitive")
    # logout invalidates
    c = login("admin", "admin123")
    eq(c.req("POST", "/auth/logout", {}).status, 200, "logout")
    eq(c.req("GET", "/auth/me").status, 401, "token invalid after logout")
    # non-admin cannot manage users
    a = admin()
    r = a.post("/users", {"username": "ketoan_x", "password": "123456", "full_name": "Kế toán X", "role": "ketoan"})
    eq(r.status, 201, "create user")
    k = login("ketoan_x", "123456")
    eq(k.req("GET", "/users").status, 403, "ketoan GET /users -> 403")
    r = a.put(f"/users/{r.json['id']}", {"active": False})
    eq(r.status, 200, "deactivate user")
    eq(k.req("GET", "/auth/me").status, 401, "deactivated user's session killed")
    rr = requests.post(BASE + "/auth/login", json={"username": "ketoan_x", "password": "123456"})
    eq(rr.status_code, 401, "inactive user cannot log in")
    r = a.post("/users", {"username": "short", "password": "123", "full_name": "x"})
    eq(r.status, 400, "password < 6")


@test("023,025,036", "test_ROBUST_bad_document_input_never_500")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=50)
    c = mk_partner(cust=True); s = mk_partner(supp=True)
    posted("opening", "2026-01-01", k1, [L(p["id"], 10, 50)])
    base = doc_body("sale", "2026-02-01", k1, [L(p["id"], 1, 100)], c["id"])

    def bad(mut, label, allowed=(400,)):
        b = json.loads(json.dumps(base)); mut(b)
        r = a.req("POST", "/documents", b)
        check(r.status in allowed, f"{label}: expected {allowed}, got {r.short()[:300]}")
        if r.status == 400:
            check(r.code == "VALIDATION" and r.json["error"].get("message"), f"{label}: error format")
        return r

    bad(lambda b: b.__setitem__("doc_type", "xyz"), "unknown doc_type")
    bad(lambda b: b.pop("doc_type"), "missing doc_type")
    bad(lambda b: b.pop("warehouse_id"), "missing warehouse")
    bad(lambda b: b.__setitem__("warehouse_id", 99999), "unknown warehouse", (400, 404))
    bad(lambda b: b.__setitem__("partner_id", 99999), "unknown partner", (400, 404))
    bad(lambda b: b["lines"][0].__setitem__("product_id", 99999), "unknown product", (400, 404))
    bad(lambda b: b["lines"][0].pop("product_id"), "line without product")
    bad(lambda b: (b["lines"][0].pop("product_id"), b["lines"][0].__setitem__("product_code", "KHONGCO")), "unknown product_code", (400, 404))
    bad(lambda b: b["lines"][0].__setitem__("qty", 0), "qty 0")
    bad(lambda b: b["lines"][0].__setitem__("qty", -1), "qty negative")
    bad(lambda b: b["lines"][0].__setitem__("qty", "abc"), "qty text")
    bad(lambda b: b["lines"][0].__setitem__("qty", "1.000,5"), "qty Vietnamese format string")
    bad(lambda b: b["lines"][0].__setitem__("unit_price", -1), "goods negative price")
    bad(lambda b: b["lines"][0].__setitem__("qty", 1e15), "qty 1e15 overflow numeric(18,3)")
    bad(lambda b: b["lines"][0].__setitem__("unit_price", 1e17), "price 1e17 overflow")
    bad(lambda b: b["lines"][0].update(qty=1e9, unit_price=1e12), "amount 1e21 overflow")
    bad(lambda b: b.__setitem__("lines", [L(p["id"], 1e6, 9e9)] * 2000), "total overflow via many lines", (400, 413))
    bad(lambda b: b.__setitem__("doc_date", "2026-13-45"), "invalid date")
    bad(lambda b: b.__setitem__("doc_date", "hôm qua"), "text date")
    bad(lambda b: b.__setitem__("lines", "x"), "lines not array")
    bad(lambda b: b.__setitem__("warehouse_id", "KHO1"), "warehouse as string code")
    bad(lambda b: b["lines"][0].__setitem__("qty", 1e-7), "qty smaller than 0.001", (400, 201))
    r = a.req("POST", "/documents", raw=b"{not json")
    eq(r.status, 400, "malformed JSON")
    r = a.req("POST", "/documents", raw=b"")
    eq(r.status, 400, "empty body")
    r = a.req("POST", "/documents", raw=json.dumps([1, 2]).encode())
    eq(r.status, 400, "JSON array body")
    # string numbers accepted per API.md
    b = json.loads(json.dumps(base)); b["lines"][0]["qty"] = "2.5"; b["lines"][0]["unit_price"] = "100.5"
    r = a.req("POST", "/documents", b)
    eq(r.status, 201, "numbers as strings accepted")
    if r.status == 201:
        eq(r.json["lines"][0]["qty"], 2.5, "qty from string"); eq(r.json["lines"][0]["amount"], 251, "251.25 -> 251")
    # qty with 3 decimals
    b = json.loads(json.dumps(base)); b["lines"][0]["qty"] = 0.125
    r = a.req("POST", "/documents", b)
    eq(r.status, 201, "qty 0.125 accepted")
    # ids
    for path in ("/documents/999999", "/documents/abc", "/vouchers/999999", "/products/999999", "/partners/0", "/documents/-1",
                 "/documents/99999999999999999999"):
        r = a.get(path)
        check(r.status in (400, 404), f"GET {path}: {r.status}")
    for path in ("/documents/999999/post", "/documents/999999/unpost"):
        r = a.post(path, {"version": 1})
        eq(r.status, 404, f"POST {path}")
    r = a.put("/documents/999999", {**base, "version": 1})
    eq(r.status, 404, "PUT unknown doc")
    d = draft("sale", "2026-02-01", k1, [L(p["id"], 1, 100)], c["id"])
    r = a.put(f"/documents/{d['id']}", base)  # no version
    eq(r.status, 400, "PUT without version")
    r = a.post(f"/documents/{d['id']}/post", {})
    check(r.status in (400, 409), f"post without version: {r.status}")
    r = a.post(f"/documents/{d['id']}/post", {"version": "x"})
    eq(r.status, 400, "post with text version")
    # wrong method
    r = a.req("PATCH", f"/documents/{d['id']}", {})
    check(r.status in (404, 405), f"PATCH -> {r.status}")
    r = a.get("/khong-ton-tai")
    eq(r.status, 404, "unknown API path")


@test("012,019,063,065", "test_ROBUST_report_params")
def _():
    a = admin()
    for path, params in [("/reports/stock-ledger", {}), ("/reports/stock-ledger", {"product_id": "abc"}),
                         ("/reports/debt-ledger", {}), ("/reports/debt-ledger", {"partner_id": "x"}),
                         ("/reports/stock-summary", {"as_of": "2026-02-30"}), ("/reports/sales", {"from": "abc"}),
                         ("/reports/debt-summary", {"side": "both"}), ("/reports/cash-book", {"account_id": "x"}),
                         ("/reports/sales", {"from": "2026-05-01", "to": "2026-04-01"}),
                         ("/reports/stock-summary", {"warehouse_id": "abc"}), ("/reports/stock-nxt", {"group_id": "x"}),
                         ("/reports/stock-summary", {"format": "pdf"})]:
        r = a.get(path, **params)
        eq(r.status, 400, f"{path} {params}")
    for path, params in [("/reports/stock-ledger", {"product_id": 999999}), ("/reports/debt-ledger", {"partner_id": 999999}),
                         ("/reports/cash-book", {"account_id": 999999})]:
        r = a.get(path, **params)
        check(r.status in (400, 404), f"{path} {params}: {r.status}")
    r = a.get("/documents", page_size=100000)
    check(r.status in (200, 400), f"huge page_size: {r.status}")
    if r.status == 200:
        check(r.json["page_size"] <= 500, f"page_size capped {r.json['page_size']}")
    r = a.get("/documents", page=-3)
    check(r.status in (200, 400), "negative page")
    for q in ("' OR 1=1 --", "%", "_", "\\", "😀", "a" * 5000, "Ơ ơ Ư ư Đ đ"):
        for path in ("/products", "/partners", "/documents", "/vouchers", "/reports/stock-summary"):
            r = a.get(path, q=q)
            eq(r.status, 200, f"{path} q={q[:10]!r}")
    r = a.get("/products", q="%")
    check(r.status == 200 and r.json["total"] == 0, f"q='%' must not act as wildcard: total={r.json and r.json.get('total')}")


@test("012,020,035", "test_ROBUST_vietnamese_search_without_diacritics")
def _():
    a = admin()
    g = mk_group(uid("G"), "Nhóm tìm kiếm")
    p = mk_product(name="Que hàn Kim Tín KT-421 3.2mm", group_id=g["id"])
    p2 = mk_product(name="Đồng hồ đo áp Đức", group_id=g["id"])
    c = mk_partner(name="CTY TNHH TM DV VĨNH PHONG", cust=True)
    c2 = mk_partner(name="Cửa hàng Đông Đô", cust=True, supp=True)
    for q, pid in (("que han kim tin", p["id"]), ("QUE HÀN", p["id"]), ("dong ho do ap duc", p2["id"]), ("đồng hồ", p2["id"]), ("DONG HO", p2["id"])):
        r = a.ok("GET", "/products", params={"q": q, "page_size": 1000})
        check(any(x["id"] == pid for x in r["items"]), f"product search {q!r}")
    for q, pid in (("vinh phong", c["id"]), ("VĨNH PHONG", c["id"]), ("dong do", c2["id"]), ("cua hang", c2["id"])):
        r = a.ok("GET", "/partners", params={"q": q, "page_size": 1000})
        check(any(x["id"] == pid for x in r["items"]), f"partner search {q!r}")
    r = a.ok("GET", "/partners", params={"q": "dong do", "type": "supplier"})
    check(any(x["id"] == c2["id"] for x in r["items"]), "partner type filter")
    posted("opening", "2026-01-01", wh("KHO1"), [L(p2["id"], 1, 1)])
    s = stock_summary(q="dong ho do")
    check(any(i["product_id"] == p2["id"] for i in s["items"]), "stock-summary q without diacritics")
    d = draft("sale", "2026-01-02", wh("KHO1"), [L(p2["id"], 1, 1)], c2["id"], note="Giao hàng Thủ Đức")
    for q in ("dong do", "Thủ Đức", "thu duc", d["draft_no"]):
        r = a.ok("GET", "/documents", params={"q": q})
        check(any(x["id"] == d["id"] for x in r["items"]), f"document search {q!r}")


@test("009,010", "test_ROBUST_catalog_rules")
def _():
    a = admin()
    p = mk_product()
    r = a.post("/products", {"code": p["code"].lower(), "name": "x", "unit": "Cái"})
    eq(r.status, 400, "duplicate code case-insensitive")
    check((r.details or {}).get("field") == "code", f"details.field=code {r.details}")
    r = a.post("/products", {"code": "", "name": "x", "unit": "Cái"})
    eq(r.status, 400, "empty code")
    r = a.post("/products", {"code": uid("P"), "name": "x", "unit": ""})
    eq(r.status, 400, "goods without unit")
    r = a.post("/products", {"code": uid("P"), "name": "x", "unit": "Cái", "sale_price": -1})
    eq(r.status, 400, "negative price")
    r = a.post("/partners", {"code": uid("D"), "name": "x"})
    eq(r.status, 400, "partner neither customer nor supplier")
    c = mk_partner(cust=True)
    posted("opening", "2026-01-01", wh("KHO1"), [L(p["id"], 5, 1)])
    eq(a.delete(f"/products/{p['id']}").status, 409, "delete used product -> IN_USE")
    q = mk_product()
    eq(a.delete(f"/products/{q['id']}").status, 200, "delete unused product")
    # deactivate -> new doc refused, old doc still editable
    d = posted("sale", "2026-01-02", wh("KHO1"), [L(p["id"], 1, 10)], c["id"])
    pp = dict(p); pp["active"] = False
    eq(a.put(f"/products/{p['id']}", pp).status, 200, "deactivate product")
    r = create_doc("sale", "2026-01-03", wh("KHO1"), [L(p["id"], 1, 10)], c["id"])
    eq(r.status, 400, "inactive product refused on new doc")
    b = put_body_from(get_doc(d["id"])); b["lines"][0]["unit_price"] = 11; b["confirm_loss"] = True
    eq(a.put(f"/documents/{d['id']}", b).status, 200, "old doc with inactive product still editable")
    s = stock_summary()
    check(any(i["product_id"] == p["id"] for i in s["items"]), "inactive product with stock still in stock summary")
    w = a.post("/warehouses", {"code": uid("KHO"), "name": "Kho Bình Dương"})
    eq(w.status, 201, "add a 5th warehouse")
    ww = a.ok("GET", "/warehouses", params={"q": "binh duong"})
    check(ww["total"] >= 1, "warehouse search without diacritics")
    a.ok("PUT", f"/warehouses/{w.json['id']}", {"code": w.json["code"], "name": "Kho Bình Dương", "active": False})
