"""C1 — permissions: role x endpoint matrix, matrix editing, escalation, mid-session changes (SPEC_MO_RONG C1, API §8.2)."""
from mr_lib import *

DOC_PERM = {"sale": "sale.write", "sale_return": "sale.write", "purchase": "purchase.write",
            "purchase_return": "purchase.write", "transfer": "stock.write", "opening": "stock.write"}

_fx = {}


def fx():
    """shared fixtures, created by admin"""
    if not _fx:
        k1, k2 = wh("KHO1"), wh("KHO2")
        p = mk_product(sale=1000, purchase=600)
        c = mk_partner(cust=True)
        s = mk_partner(supp=True)
        posted("opening", "2026-01-01", k1, [L(p["id"], 100000, 600)])
        acc = mk_account("cash", 0)
        _fx.update(k1=k1, k2=k2, p=p, c=c, s=s, acc=acc)
    return _fx


def body_for(t, date="2026-05-10"):
    f = fx()
    partner = {"sale": f["c"], "sale_return": f["c"], "purchase": f["s"], "purchase_return": f["s"]}.get(t)
    return doc_body(t, date, f["k1"], [L(f["p"]["id"], 1, 1000 if t.startswith("sale") else 600)],
                    partner["id"] if partner else None, f["k2"] if t == "transfer" else None)


def adm_draft(t):
    r = admin().post("/documents", body_for(t))
    if r.status != 201:
        raise Fatal("fixture draft: " + r.short())
    return r.json


def adm_posted(t):
    d = adm_draft(t)
    r = post_doc(d, True)
    if r.status != 200:
        raise Fatal("fixture post: " + r.short())
    return r.json


def adm_voucher():
    f = fx()
    r = mk_voucher("receipt", f["acc"]["id"], f["c"]["id"], [{"description": "thu", "amount": 1000}], "2026-05-10")
    if r.status != 201:
        raise Fatal("fixture voucher: " + r.short())
    return r.json


def catalog_ops():
    """(name, required perms, fn(client)->Resp)"""
    ops = []

    def wh_post(c):
        return c.post("/warehouses", {"code": uid("WQ"), "name": "Kho QA", "active": True})

    def grp_post(c):
        return c.post("/product-groups", {"code": uid("GQ"), "name": "Nhóm QA", "active": True})

    def prod_post(c):
        return c.post("/products", {"code": uid("PQ"), "name": "Hàng QA", "unit": "Cái", "sale_price": 1, "purchase_price": 1})

    def part_post(c):
        return c.post("/partners", {"code": uid("DQ"), "name": "Đối tác QA", "is_customer": True})

    def acc_post(c):
        return c.post("/cash-accounts", {"code": uid("TQ"), "name": "TK QA", "kind": "cash"})

    for name, fn, path, mk in [("warehouse", wh_post, "/warehouses", lambda: wh_post(admin()).json),
                               ("product-group", grp_post, "/product-groups", lambda: grp_post(admin()).json),
                               ("product", prod_post, "/products", lambda: prod_post(admin()).json),
                               ("partner", part_post, "/partners", lambda: part_post(admin()).json),
                               ("cash-account", acc_post, "/cash-accounts", lambda: acc_post(admin()).json)]:
        ops.append((f"POST {path}", {"catalog.write"}, fn))

        def put(c, mk=mk, path=path):
            obj = mk()
            body = dict(obj)
            body["name"] = obj["name"] + " sửa"
            return c.put(f"{path}/{obj['id']}", body)

        def dele(c, mk=mk, path=path):
            obj = mk()
            return c.delete(f"{path}/{obj['id']}")
        ops.append((f"PUT {path}/id", {"catalog.write"}, put))
        ops.append((f"DELETE {path}/id", {"catalog.write"}, dele))
    return ops


def doc_ops():
    ops = []
    for t, perm in DOC_PERM.items():
        ops.append((f"POST /documents {t}", {perm}, lambda c, t=t: c.post("/documents", body_for(t))))
        ops.append((f"POST /documents/check {t}", {perm}, lambda c, t=t: c.post("/documents/check", body_for(t))))

        def put_draft(c, t=t):
            d = adm_draft(t)
            return c.put(f"/documents/{d['id']}", put_body_from(d, note="sửa"))
        ops.append((f"PUT draft {t}", {perm}, put_draft))

        def post_draft(c, t=t):
            d = adm_draft(t)
            return c.post(f"/documents/{d['id']}/post", {"version": d["version"], "confirm_loss": True})
        ops.append((f"post draft {t}", {perm}, post_draft))

        def del_draft(c, t=t):
            d = adm_draft(t)
            return c.delete(f"/documents/{d['id']}", version=d["version"])
        ops.append((f"DELETE draft {t}", {perm}, del_draft))

        def put_posted(c, t=t):
            d = adm_posted(t)
            return c.put(f"/documents/{d['id']}", {**put_body_from(d, note="sửa ghi sổ"), "confirm_loss": True})
        ops.append((f"PUT posted {t}", {perm, "posted.edit"}, put_posted))

        def unpost(c, t=t):
            d = adm_posted(t)
            return c.post(f"/documents/{d['id']}/unpost", {"version": d["version"]})
        ops.append((f"unpost {t}", {perm, "posted.edit"}, unpost))
    return ops


def voucher_ops():
    f = fx()

    def vpost(c):
        return mk_voucher("receipt", f["acc"]["id"], f["c"]["id"], [{"description": "thu", "amount": 5}], "2026-05-10", c=c)

    def vput(c):
        v = adm_voucher()
        return c.put(f"/vouchers/{v['id']}", {"voucher_type": "receipt", "voucher_date": v["voucher_date"],
                                              "account_id": v["account_id"], "partner_id": v["partner_id"],
                                              "lines": [{"description": "sửa", "amount": 7}], "version": v["version"]})

    def vdel(c):
        v = adm_voucher()
        return c.delete(f"/vouchers/{v['id']}", version=v["version"])
    return [("POST /vouchers", {"cash.write"}, vpost), ("PUT /vouchers/id", {"cash.write"}, vput),
            ("DELETE /vouchers/id", {"cash.write"}, vdel)]


def price_ops():
    f = fx()

    def pput(c):
        return c.put(f"/partners/{f['c']['id']}/prices", {"items": [{"product_id": f["p"]["id"], "price": 990}]})

    def pdel(c):
        admin().put(f"/partners/{f['c']['id']}/prices", {"items": [{"product_id": f["p"]["id"], "price": 990}]})
        return c.delete(f"/partners/{f['c']['id']}/prices/{f['p']['id']}")
    return [("PUT /partners/id/prices", {"sale.write"}, pput), ("DELETE /partners/id/prices/pid", {"sale.write"}, pdel)]


def import_ops():
    f = fx()
    ops = []
    files = {
        "products": (["Mã hàng", "Tên hàng", "ĐVT"], [[uid("IMQ"), "Hàng nhập QA", "Cái"]], {"catalog.write"}),
        "partners": (["Mã đối tác", "Tên đối tác", "Là KH"], [[uid("IDQ"), "Đối tác nhập QA", "x"]], {"catalog.write"}),
        "opening_stock": (["Mã hàng", "Mã kho", "Số lượng", "Đơn giá"], [[f["p"]["code"], "KHO3", 1, 600]], {"stock.write"}),
        "partner_prices": (["Mã khách hàng", "Mã hàng", "Giá"], [[f["c"]["code"], f["p"]["code"], 995]], {"sale.write"}),
        "opening_debt": (["Mã đối tác", "Phải thu"], [[f["c"]["code"], 0]], {"admin"}),
    }
    for kind, (hdr, rows, req) in files.items():
        content = xlsx_bytes(hdr, rows)
        ops.append((f"import {kind} dry_run", req, lambda c, kind=kind, content=content: upload(c, kind, content, dry=True, date="2026-05-10")))
        ops.append((f"GET /import/{kind}/template", req, lambda c, kind=kind: c.get(f"/import/{kind}/template")))
    return ops


def admin_ops():
    def users_post(c):
        return c.post("/users", {"username": uid("uq").lower(), "password": "123456", "full_name": "x", "role": "ketoan"})

    def users_put(c):
        u = admin().post("/users", {"username": uid("uq").lower(), "password": "123456", "full_name": "x", "role": "ketoan"}).json
        return c.put(f"/users/{u['id']}", {"full_name": "y"})
    return [
        ("GET /users", {"admin"}, lambda c: c.get("/users")),
        ("POST /users", {"admin"}, users_post),
        ("PUT /users/id", {"admin"}, users_put),
        ("PUT /settings", {"admin"}, lambda c: c.put("/settings", admin().ok("GET", "/settings"))),
        ("PUT /features", {"admin"}, lambda c: c.put("/features", {"features": {"min_stock": True}})),
        ("GET /role-permissions", {"admin"}, lambda c: c.get("/role-permissions")),
        ("PUT /role-permissions", {"admin"}, lambda c: c.put("/role-permissions", {"matrix": {"thukho": DEFAULT_MATRIX["thukho"]}})),
        ("PUT /period-lock", {"admin"}, lambda c: c.put("/period-lock", {"lock_date": None, "reason": "x"})),
    ]


def read_ops():
    f = fx()
    s, c = f["s"], f["c"]
    return [
        ("GET /reports/sales", {"report.view"}, lambda cl: cl.get("/reports/sales")),
        ("GET /reports/sales xlsx", {"report.view"}, lambda cl: cl.get("/reports/sales", format="xlsx")),
        ("GET /reports/purchases", {"report.view", "cost.view"}, lambda cl: cl.get("/reports/purchases")),
        ("GET /reports/purchases xlsx", {"report.view", "cost.view"}, lambda cl: cl.get("/reports/purchases", format="xlsx")),
        ("GET /reports/debt-summary receivable", {"debt.view"}, lambda cl: cl.get("/reports/debt-summary", side="receivable")),
        ("GET /reports/debt-summary payable", {"debt.view", "cost.view"}, lambda cl: cl.get("/reports/debt-summary", side="payable")),
        ("GET /reports/debt-ledger receivable", {"debt.view"}, lambda cl: cl.get("/reports/debt-ledger", partner_id=c["id"], side="receivable")),
        ("GET /reports/debt-ledger payable", {"debt.view", "cost.view"}, lambda cl: cl.get("/reports/debt-ledger", partner_id=s["id"], side="payable")),
        ("GET /partners/id/balance", {"debt.view"}, lambda cl: cl.get(f"/partners/{c['id']}/balance")),
        ("GET /reports/cash-book", {"cash.view"}, lambda cl: cl.get("/reports/cash-book")),
        ("GET /reports/cash-book xlsx", {"cash.view"}, lambda cl: cl.get("/reports/cash-book", format="xlsx")),
        ("GET /vouchers", {"cash.view|cash.write"}, lambda cl: cl.get("/vouchers")),
        ("GET /reports/debt-aging", {"debt.view"}, lambda cl: cl.get("/reports/debt-aging")),
        ("GET /reports/debt-aging xlsx", {"debt.view"}, lambda cl: cl.get("/reports/debt-aging", format="xlsx")),
        ("GET /reports/profit", {"report.view", "cost.view"}, lambda cl: cl.get("/reports/profit")),
        ("GET /reports/profit xlsx", {"report.view", "cost.view"}, lambda cl: cl.get("/reports/profit", format="xlsx")),
        # everyone
        ("GET /reports/stock-summary", set(), lambda cl: cl.get("/reports/stock-summary")),
        ("GET /reports/stock-nxt", set(), lambda cl: cl.get("/reports/stock-nxt")),
        ("GET /reports/stock-ledger", set(), lambda cl: cl.get("/reports/stock-ledger", product_id=f["p"]["id"])),
        ("GET /reports/draft-demand", set(), lambda cl: cl.get("/reports/draft-demand")),
        ("GET /reports/low-stock", set(), lambda cl: cl.get("/reports/low-stock")),
        ("GET /dashboard", set(), lambda cl: cl.get("/dashboard")),
        ("GET /documents", set(), lambda cl: cl.get("/documents")),
        ("GET /products", set(), lambda cl: cl.get("/products")),
        ("GET /partners", set(), lambda cl: cl.get("/partners")),
        ("GET /partners/id/prices", set(), lambda cl: cl.get(f"/partners/{c['id']}/prices")),
        ("GET /products/sale-price", set(), lambda cl: cl.get("/products/sale-price", partner_id=c["id"], ids=f["p"]["id"])),
        ("GET /period-lock", set(), lambda cl: cl.get("/period-lock")),
        ("GET /features", set(), lambda cl: cl.get("/features")),
        ("GET /settings", set(), lambda cl: cl.get("/settings")),
    ]


def allowed(perms, req):
    for r in req:
        if r == "admin":
            return False  # handled by caller (admin role)
        if "|" in r:
            if not any(x in perms for x in r.split("|")):
                return False
        elif r not in perms:
            return False
    return True


def run_matrix(ops, roles, label):
    for role in roles:
        c = user(role)
        perms = set(me(c)["permissions"])
        for name, req, fn in ops:
            exp = True if role == "admin" else allowed(perms, req)
            r = fn(c)
            if exp:
                check(r.status != 403 and 200 <= r.status < 300,
                      f"[{label}] {role} {name}: expected allowed (2xx), got {r.short()[:300]}")
            else:
                ok = check(r.status == 403 and r.code == "FORBIDDEN",
                           f"[{label}] {role} {name}: expected 403 FORBIDDEN (needs {sorted(req)}), got {r.short()[:300]}")
                if ok:
                    msg = r.json["error"].get("message", "")
                    check(has_vietnamese(msg), f"{role} {name}: 403 message Vietnamese")
                    dp = (r.details or {}).get("permission")
                    if "admin" not in req:
                        check(dp is not None and any(dp in x.split("|") for x in req),
                              f"{role} {name}: details.permission {dp!r} names one of {sorted(req)}")


@test("C1", "test_C1_default_matrix_values")
def _():
    m = matrix()
    for role, perms in DEFAULT_MATRIX.items():
        eq(sorted(m.get(role, [])), sorted(perms), f"default matrix {role}")
    eq(sorted(m.get("admin", [])), sorted(PERMS), "admin all")
    for role in ["ketoan", "banhang", "muahang", "thukho"]:
        eq(sorted(me(user(role))["permissions"]), sorted(DEFAULT_MATRIX[role]), f"/auth/me permissions of {role}")


@test("C1", "test_C1_matrix_documents_every_role")
def _():
    run_matrix(doc_ops(), ROLES, "documents")


@test("C1", "test_C1_matrix_catalog_vouchers_prices_every_role")
def _():
    run_matrix(catalog_ops() + voucher_ops() + price_ops(), ROLES, "catalog/vouchers/prices")


@test("C1", "test_C1_matrix_import_and_admin_only_every_role")
def _():
    run_matrix(import_ops() + admin_ops(), ROLES, "import/admin")


@test("C1", "test_C1_matrix_reads_every_role")
def _():
    run_matrix(read_ops(), ROLES, "reads")


@test("C1", "test_C1_permission_checked_before_data")
def _():
    f = fx()
    bh, tk = user("banhang"), user("thukho")
    # garbage purchase body from banhang -> 403, not 400
    r = bh.post("/documents", {"doc_type": "purchase", "warehouse_id": "xx", "lines": "x"})
    expect_err(r, 403, "FORBIDDEN", "banhang invalid purchase body")
    r = bh.post("/documents/check", {"doc_type": "purchase", "lines": [{"qty": -1}]})
    expect_err(r, 403, "FORBIDDEN", "banhang invalid purchase check body")
    r = tk.post("/vouchers", {"voucher_type": "zzz"})
    expect_err(r, 403, "FORBIDDEN", "thukho invalid voucher body")
    r = tk.put("/products/999999", {"code": ""})
    expect_err(r, 403, "FORBIDDEN", "thukho PUT unknown product")
    # sale doc posted by admin: banhang cannot edit posted (no posted.edit) even with bad version
    d = adm_posted("sale")
    r = bh.put(f"/documents/{d['id']}", {**put_body_from(d), "version": 999})
    expect_err(r, 403, "FORBIDDEN", "banhang edit posted sale (no posted.edit)")
    r = bh.post(f"/documents/{d['id']}/unpost", {"version": d["version"]})
    expect_err(r, 403, "FORBIDDEN", "banhang unpost")
    # banhang edit a sale draft but switch it into a purchase? doc_type cannot change; try to post a purchase draft
    pd = adm_draft("purchase")
    expect_err(bh.post(f"/documents/{pd['id']}/post", {"version": pd["version"]}), 403, "FORBIDDEN", "banhang post purchase draft")
    expect_err(bh.delete(f"/documents/{pd['id']}"), 403, "FORBIDDEN", "banhang delete purchase draft")
    # PUT a purchase draft pretending doc_type sale
    r = bh.put(f"/documents/{pd['id']}", {**put_body_from(pd), "doc_type": "sale", "partner_id": f["c"]["id"]})
    check(r.status in (403, 400), f"banhang PUT purchase draft with doc_type=sale -> {r.short()[:200]}")
    eq(get_doc(pd["id"])["doc_type"], "purchase", "purchase draft unchanged")


@test("C1", "test_C1_edit_matrix_and_recheck")
def _():
    f = fx()
    tk = user("thukho")
    try:
        expect_err(tk.post("/documents", body_for("sale")), 403, "FORBIDDEN", "thukho sale before")
        r = set_matrix({"thukho": ["stock.write", "sale.write"]})
        eq(r.status, 200, "grant sale.write to thukho")
        eq(sorted(me(tk)["permissions"]), ["sale.write", "stock.write"], "same session sees new perms")
        eq(tk.post("/documents", body_for("sale")).status, 201, "thukho can sell now (same session)")
        r = set_matrix({"thukho": []})
        eq(r.status, 200, "empty perms for thukho")
        expect_err(tk.post("/documents", body_for("transfer")), 403, "FORBIDDEN", "thukho with no perms: transfer")
        eq(tk.get("/reports/stock-summary").status, 200, "thukho with no perms still reads stock")
        # admin row cannot be edited, unknown perm / role rejected
        eq(set_matrix({"admin": ["sale.write"]}).status, 400, "edit admin row")
        eq(set_matrix({"thukho": ["sale.write", "fly.write"]}).status, 400, "unknown permission")
        eq(set_matrix({"boss": ["sale.write"]}).status, 400, "unknown role")
        eq(set_matrix({"thukho": "sale.write"}).status, 400, "perms not a list")
        r = admin().put("/role-permissions", {"matrix": None})
        check(r.status in (200, 400), f"matrix null -> {r.status} (no-op or 400 both fine)")
        eq(admin().req("PUT", "/role-permissions", raw=b"{").status, 400, "malformed json")
        eq(sorted(matrix()["thukho"]), [], "thukho still empty after rejected PUTs")
        r = set_matrix({"thukho": ["stock.write", "stock.write"]})
        check(r.status in (200, 400), f"duplicate perm -> {r.status}")
        # ketoan can be reduced too
        r = set_matrix({"ketoan": ["sale.write"]})
        eq(r.status, 200, "reduce ketoan")
        expect_err(user("ketoan").post("/documents", body_for("purchase")), 403, "FORBIDDEN", "reduced ketoan purchase")
        expect_err(user("ketoan").get("/reports/purchases"), 403, "FORBIDDEN", "reduced ketoan purchases report")
    finally:
        restore_matrix()
    eq(user("ketoan").post("/documents", body_for("purchase")).status, 201, "ketoan restored")
    expect_err(tk.post("/documents", body_for("sale")), 403, "FORBIDDEN", "thukho sale after restore")


@test("C1", "test_C1_privilege_escalation_attempts")
def _():
    bh = mk_user("banhang")
    kt = user("ketoan")
    uid_ = bh.user["id"]
    for path, body in [(f"/users/{uid_}", {"role": "admin"}), (f"/users/{uid_}", {"role": "ketoan"}),
                       (f"/users/{uid_}", {"active": True, "full_name": "x"})]:
        expect_err(bh.put(path, body), 403, "FORBIDDEN", f"banhang PUT {path} {body}")
    eq(me(bh)["user"]["role"], "banhang", "role unchanged")
    expect_err(bh.post("/users", {"username": "hacker1", "password": "123456", "role": "admin"}), 403, "FORBIDDEN", "banhang create admin")
    for c, who in [(bh, "banhang"), (kt, "ketoan")]:
        expect_err(c.put("/role-permissions", {"matrix": {who: PERMS}}), 403, "FORBIDDEN", f"{who} grants itself all")
        expect_err(c.get("/role-permissions"), 403, "FORBIDDEN", f"{who} GET role-permissions")
        expect_err(c.put("/period-lock", {"lock_date": "2020-01-01"}), 403, "FORBIDDEN", f"{who} set lock")
        expect_err(c.put("/features", {"features": {"permissions": False}, "confirm": True}), 403, "FORBIDDEN", f"{who} disable permissions")
        r = upload(c, "opening_debt", xlsx_bytes(["Mã đối tác", "Phải thu"], [["X", 1]]))
        expect_err(r, 403, "FORBIDDEN", f"{who} import opening_debt")
    # extra fields in body should not grant anything: role/permissions in change-password or login
    r = bh.post("/auth/change-password", {"old_password": "123456", "new_password": "123456", "role": "admin", "permissions": PERMS})
    check(r.status in (200, 400), f"change-password with extra fields -> {r.status}")
    eq(me(bh)["user"]["role"], "banhang", "still banhang after change-password with role field")
    eq(sorted(me(bh)["permissions"]), sorted(DEFAULT_MATRIX["banhang"]), "perms unchanged")
    # header spoofing
    r = bh.req("POST", "/documents", body_for("purchase"), headers={"X-Role": "admin", "X-User": "admin"})
    expect_err(r, 403, "FORBIDDEN", "header spoofing")
    # role names are case-sensitive / unknown roles
    for bad in ["Admin", "ADMIN", "banhang ", "root", ""]:
        r = admin().post("/users", {"username": uid("ux").lower(), "password": "123456", "full_name": "x", "role": bad})
        if bad == "":
            check(r.status in (201, 400), f"role '' -> {r.status}")
            if r.status == 201:
                eq(r.json["role"], "ketoan", "empty role defaults to ketoan")
        else:
            eq(r.status, 400, f"create user with role {bad!r}")


@test("C1", "test_C1_role_change_mid_session_and_disabled_user")
def _():
    a = admin()
    f = fx()
    c = mk_user("banhang")
    u = c.user
    expect_err(c.post("/documents", body_for("purchase")), 403, "FORBIDDEN", "banhang purchase")
    r = a.put(f"/users/{u['id']}", {"role": "muahang"})
    eq(r.status, 200, "admin changes role to muahang")
    r = c.get("/auth/me")
    if r.status == 200:
        eq(r.json["user"]["role"], "muahang", "session sees new role")
        eq(c.post("/documents", body_for("purchase")).status, 201, "same token: muahang can now buy")
        expect_err(c.post("/documents", body_for("sale")), 403, "FORBIDDEN", "same token: muahang cannot sell")
        eq(c.get(f"/products/{f['p']['id']}").json.get("purchase_price"), 600, "muahang sees cost")
    else:
        check(r.status == 401, f"role change killed session (acceptable) -> {r.status}")
        c = login(u["username"], "123456")
    r = a.put(f"/users/{u['id']}", {"role": "thukho"})
    eq(r.status, 200, "admin changes role to thukho")
    c2 = c if c.get("/auth/me").status == 200 else login(u["username"], "123456")
    expect_err(c2.post("/documents", body_for("purchase")), 403, "FORBIDDEN", "thukho cannot buy any more")
    eq(c2.get(f"/products/{f['p']['id']}").json.get("purchase_price"), None, "thukho cost masked")
    r = a.put(f"/users/{u['id']}", {"active": False})
    eq(r.status, 200, "disable")
    eq(c2.get("/auth/me").status, 401, "disabled user's session killed")
    eq(c2.post("/documents", body_for("transfer")).status, 401, "disabled user cannot write")
    r = requests.post(lib.BASE + "/auth/login", json={"username": u["username"], "password": "123456"})
    eq(r.status_code, 401, "disabled user cannot log in")
    # admin cannot demote / disable the last admin
    admins = [x for x in a.ok("GET", "/users")["items"] if x["role"] == "admin" and x["active"]]
    if len(admins) == 1:
        eq(a.put(f"/users/{admins[0]['id']}", {"role": "banhang"}).status, 400, "demote last admin to banhang")
        eq(a.put(f"/users/{admins[0]['id']}", {"active": False}).status, 400, "disable last admin")


@test("C1", "test_C1_banhang_flow_with_own_vouchers")
def _():
    """banhang (cash.write, no cash.view) creates a receipt; can read it back; cannot read cash-book; balance fields hidden"""
    f = fx()
    bh = user("banhang")
    r = mk_voucher("receipt", f["acc"]["id"], f["c"]["id"], [{"description": "Thu QA", "amount": 12345}], "2026-05-11", c=bh)
    eq(r.status, 201, "banhang creates receipt")
    if r.status == 201:
        v = r.json
        eq(bh.get(f"/vouchers/{v['id']}").status, 200, "banhang reads own voucher")
        eq(bh.get(f"/vouchers/{v['id']}/export", format="xlsx").status, 200, "banhang exports own voucher")
    expect_err(bh.get("/reports/cash-book"), 403, "FORBIDDEN", "banhang cash-book")
    accs = bh.ok("GET", "/cash-accounts")["items"]
    check(all(x.get("opening_balance") is None for x in accs), "cash account opening_balance masked for banhang")
    d = bh.ok("GET", "/dashboard")
    check(d.get("cash_balance") is None and d.get("bank_balance") is None, "dashboard cash/bank balance masked for banhang")
    check(d.get("total_payable") is None, "dashboard total_payable masked (no cost.view)")
    check(d.get("revenue_today") is not None, "banhang (report.view) sees revenue")
    t = user("thukho").ok("GET", "/dashboard")
    for k in ["revenue_today", "revenue_month", "total_receivable", "total_payable", "cash_balance", "bank_balance"]:
        check(t.get(k) is None, f"thukho dashboard {k} masked: {t.get(k)!r}")
