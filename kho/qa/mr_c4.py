"""C4 — period lock (SPEC_MO_RONG C4, API §8.3, QUYET_DINH N9–N11).
All scenarios use dates in 2024 and always clear the lock afterwards."""
from mr_lib import *

LOCK = "2024-06-30"
IN = "2024-06-30"      # boundary day: inside (<= L)
IN2 = "2024-06-10"
OUT = "2024-07-01"     # first day outside
OUT2 = "2024-07-15"


def lock_err(r, label, lock=LOCK):
    ok = expect_err(r, 422, "PERIOD_LOCKED", label)
    if ok:
        msg = r.json["error"]["message"]
        y, m, d = lock.split("-")
        check(f"{d}/{m}/{y}" in msg, f"{label}: message has dd/mm/yyyy lock date: {msg}")
        eq((r.details or {}).get("lock_date"), lock, f"{label}: details.lock_date")
    return ok


def snapshot(pids, partners, acc_ids):
    a = admin()
    s = {}
    ss = stock_summary(only_with_data="false")
    s["stock"] = {it["product_id"]: it["by_warehouse"] for it in ss["items"] if it["product_id"] in pids}
    for d in ["2024-06-30", "2024-12-31"]:
        ss = stock_summary(only_with_data="false", as_of=d)
        s["stock" + d] = {it["product_id"]: it["by_warehouse"] for it in ss["items"] if it["product_id"] in pids}
    for p in partners:
        s[f"rec{p}"] = a.ok("GET", "/reports/debt-ledger", params={"partner_id": p, "side": "receivable"})["closing"]
        s[f"pay{p}"] = a.ok("GET", "/reports/debt-ledger", params={"partner_id": p, "side": "payable"})["closing"]
        s[f"recL{p}"] = a.ok("GET", "/reports/debt-ledger", params={"partner_id": p, "side": "receivable", "to": LOCK})["closing"]
    for acc in acc_ids:
        cb = a.ok("GET", "/reports/cash-book", params={"account_id": acc})
        s[f"cash{acc}"] = (cb["closing"], len(cb["rows"]))
    s["docs"] = a.ok("GET", "/documents", params={"from": "2024-01-01", "to": "2024-12-31", "page_size": 500})["total"]
    s["vouchers"] = a.ok("GET", "/vouchers", params={"from": "2024-01-01", "to": "2024-12-31", "page_size": 500})["total"]
    return s


class World:
    def __init__(self):
        a = admin()
        self.k1, self.k2 = wh("KHO1"), wh("KHO2")
        self.p = mk_product(sale=100, purchase=60)
        self.c = mk_partner(cust=True)
        self.s = mk_partner(supp=True)
        self.acc = mk_account("cash", 0)
        k1, k2, p, c, s = self.k1, self.k2, self.p["id"], self.c["id"], self.s["id"]
        self.op_in = posted("opening", "2024-06-01", k1, [L(p, 100, 60)])
        self.pu_in = posted("purchase", IN2, k1, [L(p, 10, 60)], s)
        self.sa_in = posted("sale", "2024-06-20", k1, [L(p, 5, 100)], c)
        self.sr_in = posted("sale_return", "2024-06-21", k1, [L(p, 1, 100)], c)
        self.pr_in = posted("purchase_return", "2024-06-22", k1, [L(p, 1, 60)], s)
        self.tr_in = posted("transfer", IN, k1, [L(p, 2)], None, k2)
        self.sa_edge = posted("sale", IN, k1, [L(p, 1, 100)], c)
        self.dr_in = draft("sale", "2024-06-25", k1, [L(p, 3, 100)], c)
        self.dr_in2 = draft("purchase", "2024-06-26", k1, [L(p, 3, 60)], s)
        self.sa_out = posted("sale", OUT, k1, [L(p, 2, 100)], c)
        self.pu_out = posted("purchase", OUT2, k1, [L(p, 2, 60)], s)
        self.dr_out = draft("sale", OUT2, k1, [L(p, 1, 100)], c)
        self.v_in = mk_voucher("receipt", self.acc["id"], c, [{"description": "thu", "amount": 100}], IN).json
        self.v_out = mk_voucher("receipt", self.acc["id"], c, [{"description": "thu", "amount": 50}], OUT).json
        self.pids = [p]
        self.partners = [c, s]


@test("C4", "test_C4_set_lock_rules_admin_only_future_backwards")
def _():
    a = admin()
    try:
        for role in ["ketoan", "banhang", "muahang", "thukho"]:
            expect_err(set_lock("2024-01-31", c=user(role)), 403, "FORBIDDEN", f"{role} sets lock")
        eq(a.ok("GET", "/period-lock")["lock_date"], None, "lock still null")
        r = set_lock("2026-11-16")
        eq(r.status, 400, "lock date tomorrow (future) rejected")
        r = set_lock("2099-01-01")
        eq(r.status, 400, "lock date far future rejected")
        r = set_lock("2026-11-15")
        eq(r.status, 200, "lock date = today (VN) accepted")
        r = set_lock("2024-06-30")
        eq(r.status, 200, "move lock backwards (admin)")
        eq(a.ok("GET", "/period-lock")["lock_date"], "2024-06-30", "GET shows new lock")
        r = set_lock("30/06/2024")
        check(r.status in (200, 400), f"dd/mm/yyyy lock -> {r.status}")
        for bad in ["abc", "2024-02-30", "2024-6-1x", 20240630, True]:
            r = a.put("/period-lock", {"lock_date": bad, "reason": "x"})
            eq(r.status, 400, f"invalid lock_date {bad!r}")
        r = a.put("/period-lock", {"lock_date": "2024-06-30", "reason": "a\u0000b"})
        eq(r.status, 400, "NUL in reason")
        r = a.put("/period-lock", {"lock_date": "2024-06-30", "reason": "x" * 100000})
        check(r.status in (200, 400), f"huge reason -> {r.status}")
        r = a.put("/period-lock", {"reason": "no date"})
        eq(r.status, 400, "missing lock_date field -> 400 (P4)")
        eq(a.ok("GET", "/period-lock")["lock_date"], "2024-06-30", "lock unchanged after PUT without lock_date")
        r = set_lock("1999-12-31")
        check(r.status in (200, 400), f"lock before 2000 -> {r.status}")
    finally:
        clear_lock()
    eq(a.ok("GET", "/period-lock")["lock_date"], None, "lock cleared")


@test("C4", "test_C4_every_operation_across_the_boundary")
def _():
    w = World()
    a = admin()
    k1, k2, p, c, s = w.k1, w.k2, w.p["id"], w.c["id"], w.s["id"]
    before = snapshot(w.pids, w.partners, [w.acc["id"]])
    try:
        eq(set_lock(LOCK).status, 200, "set lock")
        # --- create (incl. drafts) inside the lock, every doc type, both the boundary day and earlier
        for t, partner, to in [("sale", c, None), ("sale_return", c, None), ("purchase", s, None),
                               ("purchase_return", s, None), ("transfer", None, k2), ("opening", None, None)]:
            for d in (IN, IN2):
                lock_err(create_doc(t, d, k1, [L(p, 1, 50) if t != "transfer" else L(p, 1)], partner, to), f"create {t} draft on {d}")
            r = create_doc(t, OUT, k1, [L(p, 1, 50) if t != "transfer" else L(p, 1)], partner, to)
            eq(r.status, 201, f"create {t} on first day after lock")
            if r.status == 201:
                a.delete(f"/documents/{r.json['id']}")
        # /documents/check for a locked date: documented? must at least not 5xx
        r = a.post("/documents/check", doc_body("sale", IN, k1, [L(p, 1, 100)], c))
        check(r.status in (200, 422), f"check in locked period -> {r.status}")
        # vouchers
        for vt in ("receipt", "payment"):
            lock_err(mk_voucher(vt, w.acc["id"], c, [{"description": "x", "amount": 1}], IN), f"create {vt} on lock day")
        r = mk_voucher("receipt", w.acc["id"], c, [{"description": "x", "amount": 1}], OUT)
        eq(r.status, 201, "voucher on first day after lock")
        if r.status == 201:
            a.delete(f"/vouchers/{r.json['id']}")
        # --- posted docs inside: edit, edit note only, move out, unpost, delete
        for name in ["op_in", "pu_in", "sa_in", "sr_in", "pr_in", "tr_in", "sa_edge"]:
            d = get_doc(getattr(w, name)["id"])
            lock_err(a.put(f"/documents/{d['id']}", {**put_body_from(d, note="sửa"), "confirm_loss": True}), f"edit posted {name} (note only)")
            lock_err(a.put(f"/documents/{d['id']}", {**put_body_from(d, doc_date=OUT2), "confirm_loss": True}), f"move posted {name} out of lock")
            lock_err(a.post(f"/documents/{d['id']}/unpost", {"version": d["version"]}), f"unpost {name}")
            r = a.delete(f"/documents/{d['id']}", version=d["version"])
            check(r.status in (400, 422), f"delete posted {name} -> {r.status}")
        # posted outside moved into the lock (and to the boundary day)
        for name in ["sa_out", "pu_out"]:
            d = get_doc(getattr(w, name)["id"])
            lock_err(a.put(f"/documents/{d['id']}", {**put_body_from(d, doc_date=IN), "confirm_loss": True}), f"move posted {name} into lock (boundary)")
            lock_err(a.put(f"/documents/{d['id']}", {**put_body_from(d, doc_date="2023-01-01"), "confirm_loss": True}), f"move posted {name} far into lock")
        # posted outside, edit staying outside: OK (first day after lock)
        d = get_doc(w.sa_out["id"])
        r = a.put(f"/documents/{d['id']}", {**put_body_from(d, note="sửa ngoài kỳ"), "confirm_loss": True})
        eq(r.status, 200, "edit posted doc dated first day after lock")
        # --- drafts inside: edit OK, post forbidden, move out OK; draft outside cannot move in
        d = get_doc(w.dr_in["id"])
        r = a.put(f"/documents/{d['id']}", put_body_from(d, note="sửa phiếu tạm trong kỳ khóa"))
        eq(r.status, 200, "edit existing draft inside lock")
        d = get_doc(w.dr_in["id"])
        lock_err(post_doc(d), "post draft inside lock")
        r = a.put(f"/documents/{d['id']}", put_body_from(d, doc_date="2024-06-01"))
        check(r.status in (200, 422), f"move draft to another day inside lock -> {r.status}")
        d = get_doc(w.dr_in["id"])
        r = a.put(f"/documents/{d['id']}", put_body_from(d, doc_date=OUT2))
        eq(r.status, 200, "move draft out of lock")
        d = get_doc(w.dr_in["id"])
        eq(post_doc(d).status, 200, "post the draft after moving it out")
        d2 = get_doc(w.dr_in2["id"])
        r = a.delete(f"/documents/{d2['id']}", version=d2["version"])
        eq(r.status, 200, "delete existing draft inside lock")
        d = get_doc(w.dr_out["id"])
        lock_err(a.put(f"/documents/{d['id']}", put_body_from(d, doc_date=IN)), "move draft from outside into lock")
        # --- vouchers inside: edit / delete / move out; outside moved in
        v = a.ok("GET", f"/vouchers/{w.v_in['id']}")
        vb = {"voucher_type": "receipt", "voucher_date": v["voucher_date"], "account_id": v["account_id"],
              "partner_id": v["partner_id"], "lines": [{"description": "sửa", "amount": 100}], "version": v["version"]}
        lock_err(a.put(f"/vouchers/{v['id']}", vb), "edit voucher inside")
        lock_err(a.put(f"/vouchers/{v['id']}", {**vb, "voucher_date": OUT2}), "move voucher out")
        lock_err(a.delete(f"/vouchers/{v['id']}", version=v["version"]), "delete voucher inside")
        vo = a.ok("GET", f"/vouchers/{w.v_out['id']}")
        lock_err(a.put(f"/vouchers/{vo['id']}", {**vb, "voucher_date": IN, "version": vo["version"]}), "move voucher into lock")
        # --- opening figures without a date
        lock_err(set_partner(c, opening_receivable=1), "change opening_receivable")
        lock_err(set_partner(s, opening_payable=1), "change opening_payable")
        lock_err(a.post("/partners", {"code": uid("LK"), "name": "Mới", "is_customer": True, "opening_receivable": 5}),
                 "create partner with opening")
        r = a.post("/partners", {"code": uid("LK"), "name": "Mới", "is_customer": True, "opening_receivable": 0})
        eq(r.status, 201, "create partner with 0 opening")
        eq(set_partner(c, address="Đổi địa chỉ khi khóa sổ").status, 200, "edit other partner fields")
        lock_err(a.put(f"/cash-accounts/{w.acc['id']}", {**w.acc, "opening_balance": 9}), "change cash opening_balance")
        lock_err(a.post("/cash-accounts", {"code": uid("LKA"), "name": "TK", "kind": "cash", "opening_balance": 9}),
                 "create account with opening")
        eq(a.put(f"/cash-accounts/{w.acc['id']}", {**w.acc, "name": "Đổi tên"}).status, 200, "rename account")
        # --- imports
        lock_err(upload(a, "opening_debt", xlsx_bytes(["Mã đối tác", "Phải thu"], [[w.c["code"], 5]])), "import opening_debt dry-run")
        lock_err(upload(a, "opening_debt", xlsx_bytes(["Mã đối tác", "Phải thu"], [[w.c["code"], 5]]), dry=False), "import opening_debt")
        st = xlsx_bytes(["Mã hàng", "Mã kho", "Số lượng", "Đơn giá"], [[w.p["code"], "KHO3", 5, 60]])
        lock_err(upload(a, "opening_stock", st, date=IN), "import opening_stock dry-run date in lock")
        lock_err(upload(a, "opening_stock", st, dry=False, date=IN), "import opening_stock date in lock")
        r = upload(a, "opening_stock", st, dry=True, date=OUT)
        eq(r.status, 200, "import opening_stock dry-run after lock")
        # catalog-only imports do not touch periods
        r = upload(a, "products", xlsx_bytes(["Mã hàng", "Tên hàng", "ĐVT"], [[uid("LKP"), "Hàng khi khóa", "Cái"]]), dry=True)
        eq(r.status, 200, "product import allowed while locked")
        # permission before lock: banhang creating a purchase in the locked period -> 403
        expect_err(create_doc("purchase", IN, k1, [L(p, 1, 60)], s, c=user("banhang")), 403, "FORBIDDEN", "banhang purchase in lock")
        # sale by banhang inside lock -> 422
        lock_err(create_doc("sale", IN, k1, [L(p, 1, 100)], c, c=user("banhang")), "banhang sale in lock")
    finally:
        clear_lock()
    after = snapshot(w.pids, w.partners, [w.acc["id"]])
    for k in before:
        if k in ("docs",):
            continue
        # (current stock legitimately changes: the draft moved out of the lock was posted on 2024-07-15)
        if k == "stock2024-06-30" or k.startswith("recL") or k.startswith("cash"):
            eq(after[k], before[k], f"figures inside the locked period unchanged: {k}")


@test("C4", "test_C4_feature_off_disables_lock_and_keeps_date")
def _():
    w_p = mk_product(sale=100, purchase=60)
    c = mk_partner(cust=True)
    k1 = wh("KHO1")
    posted("opening", "2024-03-01", k1, [L(w_p["id"], 10, 60)])
    try:
        eq(set_lock("2024-03-31").status, 200, "lock")
        expect_err(create_doc("sale", "2024-03-15", k1, [L(w_p["id"], 1, 100)], c["id"]), 422, "PERIOD_LOCKED", "locked")
        eq(set_features(period_lock=False).status, 200, "feature off")
        r = create_doc("sale", "2024-03-15", k1, [L(w_p["id"], 1, 100)], c["id"])
        eq(r.status, 201, "feature off: no lock applied")
        if r.status == 201:
            eq(post_doc(r.json).status, 200, "post in old period with feature off")
        eq(set_features(period_lock=True).status, 200, "feature on")
        eq(admin().ok("GET", "/period-lock")["lock_date"], "2024-03-31", "lock date kept across off/on")
        expect_err(create_doc("sale", "2024-03-16", k1, [L(w_p["id"], 1, 100)], c["id"]), 422, "PERIOD_LOCKED", "locked again")
    finally:
        all_features_on()
        clear_lock()


@test("C4", "test_C4_lock_and_unlock_restores_editing")
def _():
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=60)
    c = mk_partner(cust=True)
    posted("opening", "2024-02-01", k1, [L(p["id"], 10, 60)])
    sa = posted("sale", "2024-02-10", k1, [L(p["id"], 1, 100)], c["id"])
    try:
        set_lock("2024-02-28")
        d = get_doc(sa["id"])
        lock_err(admin().put(f"/documents/{d['id']}", put_body_from(d, note="x")), "edit while locked", "2024-02-28")
        eq(set_lock("2024-02-09").status, 200, "move lock backwards to before the doc")
        r = admin().put(f"/documents/{d['id']}", put_body_from(d, note="sửa sau khi lùi khóa"))
        eq(r.status, 200, "edit allowed after moving lock backwards")
        d = get_doc(sa["id"])
        lock_err(admin().put(f"/documents/{d['id']}", put_body_from(d, doc_date="2024-02-09")), "but cannot move it onto the new lock day", "2024-02-09")
    finally:
        clear_lock()


@test("C4", "test_C4_unpost_outside_cannot_break_locked_stock")
def _():
    """Purchase AFTER the lock, sale inside... no: purchase INSIDE lock + sale OUTSIDE. Editing the outside sale is fine;
    but editing an outside purchase that a locked-period sale... cannot depend on (later dates). Check R6 still applies."""
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=60)
    c, s = mk_partner(cust=True), mk_partner(supp=True)
    pu = posted("purchase", "2024-04-20", k1, [L(p["id"], 5, 60)], s["id"])
    sa = posted("sale", "2024-05-05", k1, [L(p["id"], 5, 100)], c["id"])
    try:
        set_lock("2024-04-30")
        d = get_doc(sa["id"])
        r = admin().post(f"/documents/{d['id']}/unpost", {"version": d["version"]})
        eq(r.status, 200, "unpost sale after the lock")
        r = post_doc(get_doc(sa["id"]))
        eq(r.status, 200, "re-post sale after lock")
        d = get_doc(sa["id"])
        r = admin().put(f"/documents/{d['id']}", put_body_from(d, lines=[L(p["id"], 6, 100)]))
        expect_err(r, 422, "INSUFFICIENT_STOCK", "R6 still applies after lock")
    finally:
        clear_lock()


@test("C4", "test_C4_concurrent_lock_vs_post")
def _():
    """admin sets the lock while another user posts a document on the lock day: either the post wins (posted before
    the lock) or it is rejected - but never a posted doc dated <= L that was posted AFTER the lock was set."""
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=60)
    c = mk_partner(cust=True)
    posted("opening", "2024-08-01", k1, [L(p["id"], 1000, 60)])
    kt = raw_client(user("ketoan"))
    drafts = [draft("sale", "2024-08-31", k1, [L(p["id"], 1, 100)], c["id"]) for _ in range(8)]
    try:
        fns = [lambda: raw_client(admin()).put("/period-lock", {"lock_date": "2024-08-31", "reason": "đua"})]
        for d in drafts:
            fns.append(lambda d=d: kt.post(f"/documents/{d['id']}/post", {"version": d["version"]}))
        res = run_parallel(fns)
        for r in res:
            check(not isinstance(r, Exception) and r.status < 500, f"no exception/5xx: {r if isinstance(r, Exception) else r.status}")
        statuses = [r.status for r in res[1:] if not isinstance(r, Exception)]
        check(all(s in (200, 422) for s in statuses), f"post results 200/422 only: {statuses}")
        eq(res[0].status if not isinstance(res[0], Exception) else None, 200, "lock set")
    finally:
        clear_lock()
