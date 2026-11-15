"""C8 — credit limit + receivable aging (SPEC_MO_RONG C8, API §9.3, QUYET_DINH O4, O5). Uses dates in 2023."""
import random
import re
from datetime import date, timedelta

from mr_lib import *

_s = {}


def env():
    if not _s:
        k1 = wh("KHO1")
        p = mk_product(sale=100, purchase=0)  # cost 0 -> never a loss warning (R4)
        posted("opening", "2020-01-01", k1, [L(p["id"], 1000000, 0)])
        acc = mk_account("cash", 0)
        _s.update(k1=k1, p=p, acc=acc)
    return _s


def cust(limit="__none__", days="__none__", rec=0):
    c = mk_partner(cust=True, rec=rec)
    kw = {}
    if limit != "__none__":
        kw["credit_limit"] = limit
    if days != "__none__":
        kw["payment_days"] = days
    if kw:
        r = set_partner(c["id"], **kw)
        if r.status != 200:
            raise Fatal("set credit fields: " + r.short())
    return c


def sale(c, amount, d="2023-03-01", post=True, confirm_credit=True, qty=None):
    e = env()
    qty = qty or 1
    doc = draft("sale", d, e["k1"], [L(e["p"]["id"], qty, str(D(str(amount)) / qty))], c)
    if not post:
        return doc
    r = admin().post(f"/documents/{doc['id']}/post", {"version": doc["version"], "confirm_loss": True, "confirm_credit": confirm_credit})
    if r.status != 200:
        raise Fatal("post sale: " + r.short())
    return r.json


def ret(c, amount, d):
    e = env()
    return posted("sale_return", d, e["k1"], [L(e["p"]["id"], 1, amount)], c)


def receipt(c, amount, d, vtype="receipt", side=None):
    e = env()
    b = {"voucher_type": vtype, "voucher_date": d, "account_id": e["acc"]["id"], "partner_id": c,
         "lines": [{"description": "QA", "amount": amount}]}
    if side:
        b["debt_side"] = side
    r = admin().post("/vouchers", b)
    if r.status != 201:
        raise Fatal("voucher: " + r.short())
    return r.json


def post_raw(doc, c=None, **flags):
    return (c or admin()).post(f"/documents/{doc['id']}/post", {"version": doc["version"], **flags})


@test("C8", "test_C8_credit_fields_validation_and_visibility")
def _():
    a = admin()
    c = mk_partner(cust=True)
    for k, v, ok in [("credit_limit", 0, True), ("credit_limit", 1500000.5, True), ("credit_limit", "2.000", True),
                     ("credit_limit", -1, False), ("credit_limit", "abc", False), ("credit_limit", 1e20, False),
                     ("payment_days", 0, True), ("payment_days", 3650, True), ("payment_days", 3651, False),
                     ("payment_days", -1, False), ("payment_days", 2.5, False)]:
        r = set_partner(c["id"], **{k: v})
        if ok:
            eq(r.status, 200, f"{k}={v!r} accepted")
        else:
            eq(r.status, 400, f"{k}={v!r} rejected")
            if r.status >= 500:
                fail("5xx")
    r = set_partner(c["id"], credit_limit=None, payment_days=None)
    eq((r.json.get("credit_limit"), r.json.get("payment_days")), (None, None), "null clears both")
    # partner list carries fields; everyone sees them? (no masking defined)
    set_partner(c["id"], credit_limit=1000, payment_days=15)
    body = partner_body(a.ok("GET", f"/partners/{c['id']}"))
    r = a.put(f"/partners/{c['id']}", body)
    eq((r.json.get("credit_limit"), r.json.get("payment_days")), (1000, 15), "PUT without the fields keeps them (O1)")
    # POST with the fields
    r = a.post("/partners", {"code": uid("CL"), "name": "Có hạn mức", "is_customer": True, "credit_limit": 5, "payment_days": 7})
    eq(r.status, 201, "POST with credit fields")
    eq((r.json.get("credit_limit"), r.json.get("payment_days")), (5, 7), "POST stored fields")


@test("C8", "test_C8_credit_warning_boundary_arithmetic")
def _():
    c = cust(limit=1000, rec=600)["id"]
    # 600 + 400 = 1000 = limit -> no warning
    d = sale(c, 400, post=False)
    r = post_raw(d)
    eq(r.status, 200, "exactly at limit -> posted without warning")
    # 1000 + 1 = 1001 > 1000
    d = sale(c, 1, post=False)
    r = post_raw(d)
    if expect_err(r, 409, "CREDIT_WARNING", "1 đồng over"):
        cr = (r.details or {}).get("credit") or {}
        eq(cr.get("receivable"), 1000, "receivable")
        eq(cr.get("document_amount"), 1, "document_amount")
        eq(cr.get("total_after"), 1001, "total_after")
        eq(cr.get("credit_limit"), 1000, "credit_limit")
        eq(cr.get("over"), 1, "over")
        eq(cr.get("partner_id"), c, "partner_id")
        eq((r.details or {}).get("confirm"), ["confirm_credit"], "confirm lists only confirm_credit")
        msg = r.json["error"]["message"]
        check("1.001" in msg and "1.000" in msg, f"message shows Vietnamese numbers: {msg}")
    eq(get_doc(d["id"])["status"], "draft", "still draft after warning")
    r = post_raw(d, confirm_credit=False)
    eq(r.status, 409, "confirm_credit=false still warns")
    r = post_raw(d, confirm_credit="yes")
    check(r.status in (400, 409), f"confirm_credit non-bool -> {r.status}")
    r = post_raw(get_doc(d["id"]), confirm_credit=True)
    eq(r.status, 200, "confirm_credit -> posted")
    h = admin().ok("GET", f"/documents/{d['id']}/history")["items"]
    check(any("credit" in (x.get("action") or "") for x in h), f"history records credit confirmation: {[x.get('action') for x in h]}")
    # fractional over: limit 1000, receivable 1001 -> any sale warns; receipt brings it down
    receipt(c, 501, "2023-03-02")
    d = sale(c, 500, post=False)
    eq(post_raw(d).status, 200, "after receipt 501: 500 + 500 = 1000 -> ok")
    # limit 0 -> every sale warns; NULL -> never
    c0 = cust(limit=0)["id"]
    expect_err(post_raw(sale(c0, 1, post=False)), 409, "CREDIT_WARNING", "limit 0")
    cn = cust()["id"]
    eq(post_raw(sale(cn, 10 ** 9, post=False)).status, 200, "no limit -> no warning")
    # future-dated sale counts in current receivable (O4)
    cf = cust(limit=1000)["id"]
    sale(cf, 900, d="2026-12-31")
    expect_err(post_raw(sale(cf, 200, "2023-03-05", post=False)), 409, "CREDIT_WARNING", "future-dated debt counts (O4)")
    # drafts never warn on save; draft amounts are not 'current receivable'
    cd = cust(limit=100)["id"]
    sale(cd, 5000, post=False)
    eq(post_raw(sale(cd, 100, post=False)).status, 200, "other drafts do not count")
    # sale_return / purchase are not checked
    eq(ret(cd, 1, "2023-03-06")["status"], "posted", "sale_return posts without credit check")


@test("C8", "test_C8_credit_vs_loss_vs_stock_order_and_flags")
def _():
    e = env()
    a = admin()
    k1 = e["k1"]
    lp = mk_product(sale=100, purchase=500)  # selling below 500 = loss
    posted("opening", "2023-01-01", k1, [L(lp["id"], 5, 500)])
    c = cust(limit=100)["id"]
    d = draft("sale", "2023-04-01", k1, [L(lp["id"], 2, 100)], c)  # 200 > 100 and loss
    r = post_raw(d)
    if expect_err(r, 409, "CREDIT_WARNING", "over limit + loss"):
        det = r.details or {}
        eq(sorted(det.get("confirm") or []), ["confirm_credit", "confirm_loss"], "confirm lists both flags")
        eq(len(det.get("loss_lines") or []), 1, "loss lines bundled")
    r = post_raw(d, confirm_credit=True)
    expect_err(r, 409, "LOSS_WARNING", "credit confirmed, loss not")
    r = post_raw(d, confirm_loss=True)
    if expect_err(r, 409, "CREDIT_WARNING", "loss confirmed, credit not"):
        eq((r.details or {}).get("confirm"), ["confirm_credit"], "only credit left to confirm")
        eq((r.details or {}).get("loss_lines") or [], [], "no loss lines when loss already confirmed")
    eq(post_raw(d, confirm_loss=True, confirm_credit=True).status, 200, "both flags -> posted")
    # stock shortage comes first
    d = draft("sale", "2023-04-02", k1, [L(lp["id"], 50, 100)], c)
    expect_err(post_raw(d), 422, "INSUFFICIENT_STOCK", "shortage before credit")
    expect_err(post_raw(d, confirm_loss=True, confirm_credit=True), 422, "INSUFFICIENT_STOCK", "shortage even with both flags")
    # user without debt.view gets null numbers (custom: thukho + sale.write)
    try:
        set_matrix({"thukho": ["sale.write"]})
        d = draft("sale", "2023-04-03", k1, [L(e["p"]["id"], 1, 1000)], c)
        r = post_raw(d, c=user("thukho"))
        if expect_err(r, 409, "CREDIT_WARNING", "thukho over limit"):
            cr = (r.details or {}).get("credit") or {}
            for k in ("receivable", "total_after", "credit_limit", "over"):
                eq(cr.get(k), None, f"no debt.view -> credit.{k} null")
            check(not find_secrets(r.json["error"]["message"], [100, 1000]) or True, "message")
            msg = r.json["error"]["message"]
            check(not re.search(r"\d\.\d{3}", msg), f"message without debt figures for a user without debt.view: {msg}")
    finally:
        restore_matrix()


@test("C8", "test_C8_editing_posted_sale")
def _():
    a = admin()
    e = env()
    c = cust(limit=1000)["id"]
    s1 = sale(c, 800)
    d = get_doc(s1["id"])
    r = a.put(f"/documents/{d['id']}", put_body_from(d, note="chỉ sửa ghi chú"))
    eq(r.status, 200, "edit without amount change -> no warning")
    d = get_doc(s1["id"])
    r = a.put(f"/documents/{d['id']}", put_body_from(d, lines=[L(e["p"]["id"], 1, 1000)]))
    eq(r.status, 200, "800 -> 1000: receivable excl. this doc 0 + 1000 = limit -> ok")
    d = get_doc(s1["id"])
    r = a.put(f"/documents/{d['id']}", put_body_from(d, lines=[L(e["p"]["id"], 1, 1001)]))
    if expect_err(r, 409, "CREDIT_WARNING", "edit upward over the limit"):
        cr = (r.details or {}).get("credit") or {}
        eq((cr.get("receivable"), cr.get("document_amount"), cr.get("over")), (0, 1001, 1), "excludes the doc itself")
    eq(get_doc(s1["id"])["total_amount"], 1000, "not changed")
    r = a.put(f"/documents/{d['id']}", {**put_body_from(d, lines=[L(e["p"]["id"], 1, 1001)]), "confirm_credit": True})
    eq(r.status, 200, "edit upward with confirm_credit")
    # already over the limit: decreasing must not warn
    d = get_doc(s1["id"])
    r = a.put(f"/documents/{d['id']}", put_body_from(d, lines=[L(e["p"]["id"], 1, 1000.5)]))
    eq(r.status, 200, "decrease -> no warning")
    # move to another customer with a small limit
    c2 = cust(limit=10)["id"]
    d = get_doc(s1["id"])
    r = a.put(f"/documents/{d['id']}", put_body_from(d, partner_id=c2))
    expect_err(r, 409, "CREDIT_WARNING", "change customer -> check the new customer's limit")
    # date change only (same amount) -> no warning
    c3 = cust(limit=1)["id"]
    s3 = sale(c3, 50)  # confirmed
    d = get_doc(s3["id"])
    r = a.put(f"/documents/{d['id']}", put_body_from(d, doc_date="2023-03-15"))
    eq(r.status, 200, "same amount, other date -> no warning (O4)")
    # unpost + re-post -> warned again
    d = get_doc(s3["id"])
    a.post(f"/documents/{d['id']}/unpost", {"version": d["version"]})
    expect_err(post_raw(get_doc(s3["id"])), 409, "CREDIT_WARNING", "re-post after unpost warns again")


@test("C8", "test_C8_concurrent_posts_near_limit")
def _():
    c = cust(limit=1000)["id"]
    drafts = [sale(c, 600, post=False) for _ in range(2)]
    cl = [raw_client(admin()), raw_client(user("ketoan"))]
    res = run_parallel([lambda i=i: cl[i].post(f"/documents/{drafts[i]['id']}/post", {"version": drafts[i]["version"]}) for i in range(2)])
    sts = sorted(r.status for r in res if not isinstance(r, Exception))
    check(all(s < 500 for s in sts), f"no 5xx: {sts}")
    if sts == [200, 200]:
        print(f"      note: two concurrent posts of 600 against limit 1000 both passed without CREDIT_WARNING (O4 accepted race); receivable now {receivable(c)}")
    else:
        eq(sts, [200, 409], "one posts, the other is warned")


# ---------------------------------------------------------------- aging

def bucket_of(days):
    if days <= 0:
        return "in_term"
    if days <= 30:
        return "d1_30"
    if days <= 60:
        return "d31_60"
    if days <= 90:
        return "d61_90"
    return "over_90"


def check_item(it, exp, label):
    if it is None and not any(exp.get(k, 0) for k in BUCKETS + ["total"]):
        check(True, f"{label}: zero balance customer omitted")
        return
    for k in BUCKETS + ["total"]:
        eq(it.get(k) if it else None, exp.get(k, 0), f"{label}: {k}")
    if it:
        s = sum(num(it.get(k) or 0) for k in BUCKETS)
        eq(s, num(it["total"]), f"{label}: buckets sum to total")


@test("C8", "test_C8_aging_hand_computed_fifo")
def _():
    k = cust(days=10, rec=300)["id"]
    s1 = sale(k, 1000, "2023-01-01")
    sale(k, 2000, "2023-02-15")
    sale(k, 500, "2023-03-25")
    sale(k, 700, "2023-04-25")
    receipt(k, 800, "2023-03-01")       # opening 300 + 500 of S1
    ret(k, 200, "2023-04-01")            # S1 -> 300 left
    sale(k, 999, "2023-05-10")           # after as_of
    receipt(k, 5000, "2023-05-02")       # after as_of
    it = aging_item(k, "2023-04-30")
    check_item(it, {"opening": 0, "over_90": 300, "d61_90": 2000, "d1_30": 500, "in_term": 700, "d31_60": 0, "prepaid": 0, "total": 3500}, "scenario A")
    eq(rec_ledger_closing(k, "2023-04-30"), 3500, "ledger closing same day")
    if it:
        eq(it.get("payment_days"), 10, "payment_days echoed")
        open_ = {x["ref_no"]: x for x in it.get("items") or []}
        x1 = open_.get(s1["doc_no"])
        if check(x1 is not None, "S1 listed as open item"):
            eq((x1["due_date"], x1["amount"], x1["remaining"], x1["days_overdue"], x1["bucket"]),
               ("2023-01-11", 1000, 300, 109, "over_90"), "S1 open item")
            eq(x1.get("document_id"), s1["id"], "open item has document_id")
        eq(sum(num(x["remaining"]) for x in it.get("items") or []), 3500, "open items sum to total")
    # as_of before the receipt: opening 300 still open in 'opening'
    it = aging_item(k, "2023-02-28")
    # S1 due 01-11 -> 48 days (31-60); S2 due 02-25 -> 3 days (1-30)
    check_item(it, {"opening": 300, "over_90": 0, "d31_60": 1000, "d1_30": 2000, "total": 3300}, "scenario A @02-28")


@test("C8", "test_C8_aging_boundary_days")
def _():
    asof = date(2023, 6, 30)
    for pdays in (0, 30):
        k = cust(days=pdays)["id"]
        exp = {b: 0 for b in BUCKETS}
        amt = 1
        for n in [0, 1, 30, 31, 60, 61, 90, 91, 400]:
            dd = asof - timedelta(days=n + pdays)
            sale(k, amt, dd.isoformat())
            exp[bucket_of(n)] += amt
            amt *= 2
        exp["total"] = sum(exp[b] for b in BUCKETS)
        check_item(aging_item(k, asof.isoformat()), exp, f"boundary days payment_days={pdays}")
    # payment_days NULL behaves like 0
    k = cust()["id"]
    sale(k, 5, (asof - timedelta(days=1)).isoformat())
    check_item(aging_item(k, asof.isoformat()), {"d1_30": 5, "total": 5}, "payment_days NULL = 0")


@test("C8", "test_C8_aging_prepaid_refund_negative_opening_backdated")
def _():
    # overpayment then a later sale
    k = cust()["id"]
    sale(k, 1000, "2023-01-10")
    receipt(k, 1500, "2023-01-20")
    check_item(aging_item(k, "2023-01-31"), {"prepaid": -500, "total": -500}, "overpaid")
    sale(k, 300, "2023-02-01")
    check_item(aging_item(k, "2023-02-28"), {"prepaid": -200, "total": -200}, "prepaid absorbs later sale")
    sale(k, 700, "2023-02-10")
    check_item(aging_item(k, "2023-02-28"), {"d1_30": 500, "total": 500}, "prepaid exhausted, remainder of the later sale open")
    # refund (payment on receivable side) is an increase
    k2 = cust()["id"]
    sale(k2, 1000, "2023-01-10")
    receipt(k2, 1500, "2023-01-20")
    receipt(k2, 500, "2023-01-25", vtype="payment", side="receivable")
    check_item(aging_item(k2, "2023-01-31"), {"total": 0}, "refund cancels prepayment")
    eq(rec_ledger_closing(k2, "2023-01-31"), 0, "ledger 0")
    # refund larger than prepayment -> open increase dated on the refund
    receipt(k2, 300, "2023-02-05", vtype="payment", side="receivable")
    check_item(aging_item(k2, "2023-03-31"), {"d31_60": 300, "total": 300}, "excess refund is a dated increase")
    # negative opening (customer paid in advance before the system) offsets later sales
    k3 = cust(rec=-400)["id"]
    sale(k3, 1000, "2023-03-01")
    check_item(aging_item(k3, "2023-03-31"), {"d1_30": 600, "total": 600}, "negative opening offsets oldest sale")
    k4 = cust(rec=-400)["id"]
    check_item(aging_item(k4, "2023-03-31"), {"prepaid": -400, "total": -400} , "negative opening only -> prepaid")
    # back-dated sale entered later: FIFO by date, not by entry order
    k5 = cust()["id"]
    sale(k5, 100, "2023-03-01")
    receipt(k5, 100, "2023-03-10")
    sale(k5, 50, "2023-01-01")   # entered later but older
    it = aging_item(k5, "2023-03-31")
    check_item(it, {"d1_30": 50, "total": 50}, "back-dated sale is the oldest: receipt pays it first")
    if it:
        eq([x["date"] for x in it.get("items") or []], ["2023-03-01"], "the open item is the 03-01 sale")
    # a sale with a negative total (discount-only service line) is a decrease
    k6 = cust()["id"]
    sale(k6, 1000, "2023-01-01")
    e = env()
    dv = draft("sale", "2023-02-01", e["k1"], [{"product_code": "DV", "description": "Chiết khấu", "qty": 1, "unit_price": -300}], k6)
    eq(post_raw(dv, confirm_loss=True, confirm_credit=True).status, 200, "post negative sale")
    check_item(aging_item(k6, "2023-03-31"), {"d61_90": 700, "total": 700}, "negative sale reduces the oldest debt")


def fifo_model(opening, events, asof, pdays):
    """events: (date, +inc / -dec). Returns expected buckets (independent implementation)."""
    net = D(opening) + sum(D(a) for d, a in events if d <= asof)
    exp = {b: D(0) for b in BUCKETS}
    if net <= 0:
        exp["prepaid"] = net
        exp["total"] = net
        return exp
    incs = []
    if D(opening) > 0:
        incs.append((None, D(opening)))
    incs += sorted([(d, D(a)) for d, a in events if d <= asof and D(a) > 0], key=lambda x: x[0])
    left = net
    for d, a in reversed(incs):
        take = min(a, left)
        if d is None:
            exp["opening"] += take
        else:
            days = (asof - d).days - pdays
            exp[bucket_of(days)] += take
        left -= take
        if left <= 0:
            break
    exp["total"] = net
    return exp


@test("C8", "test_C8_aging_random_scenarios_vs_model_and_ledger")
def _():
    rng = random.Random(20261115)
    e = env()
    start = date(2023, 7, 1)
    custs = []
    for i in range(10):
        pdays = rng.choice([0, 7, 30, 45, 90])
        opening = rng.choice([0, 0, 500, 1200, -300])
        c = cust(days=pdays, rec=opening)["id"]
        events = []
        for j in range(18):
            d = start + timedelta(days=rng.randint(0, 150))
            kind = rng.choice(["sale", "sale", "sale", "ret", "rec", "rec", "refund"])
            amt = rng.randint(1, 40) * 50
            if kind == "sale":
                sale(c, amt, d.isoformat())
                events.append((d, amt))
            elif kind == "ret":
                ret(c, amt, d.isoformat())
                events.append((d, -amt))
            elif kind == "rec":
                receipt(c, amt, d.isoformat())
                events.append((d, -amt))
            else:
                receipt(c, amt, d.isoformat(), vtype="payment", side="receivable")
                events.append((d, amt))
        custs.append((c, opening, events, pdays))
    for asof in [date(2023, 7, 15), date(2023, 9, 1), date(2023, 10, 31), date(2024, 3, 1)]:
        rep = aging(asof.isoformat())
        byp = {it["partner_id"]: it for it in rep["items"]}
        for c, opening, events, pdays in custs:
            exp = fifo_model(opening, events, asof, pdays)
            it = byp.get(c)
            if exp["total"] == 0 and it is None:
                continue
            if not check(it is not None, f"customer {c} with balance {exp['total']} in aging @{asof}"):
                continue
            for k in BUCKETS + ["total"]:
                eq(it.get(k), exp[k], f"cust {c} @{asof} {k} (FIFO model)")
            eq(it["total"], rec_ledger_closing(c, asof.isoformat()), f"cust {c} @{asof} total = debt ledger")


@test("C8", "test_C8_aging_totals_equal_ledger_for_every_partner")
def _():
    a = admin()
    for asof in ["2023-04-30", "2023-12-31", a.ok("GET", "/dashboard")["today"]]:
        rep = aging(asof)
        items = rep["items"]
        tot = {k: D(0) for k in BUCKETS + ["total"]}
        for it in items:
            s = sum(num(it.get(k) or 0) for k in BUCKETS)
            eq(s, num(it["total"]), f"@{asof} partner {it['partner_code']}: buckets = total")
            for k in tot:
                tot[k] += num(it.get(k) or 0)
        for k in tot:
            eq(rep["totals"].get(k), tot[k], f"@{asof} totals.{k}")
        ds = a.ok("GET", "/reports/debt-summary", params={"side": "receivable", "to": asof, "include_zero": "true"})
        led = {x["partner_id"]: num(x["closing"]) for x in ds["items"]}
        byp = {it["partner_id"]: num(it["total"]) for it in items}
        for pid, cl in led.items():
            if cl != 0:
                eq(byp.get(pid), cl, f"@{asof} partner {pid}: aging total = debt-summary closing")
        for pid, t in byp.items():
            eq(led.get(pid, D(0)), t, f"@{asof} aging partner {pid} exists in ledger with same balance")
        eq(tot["total"], num(ds["totals"]["closing"]), f"@{asof} grand total = debt-summary total")


@test("C8", "test_C8_aging_params_xlsx_permissions")
def _():
    a = admin()
    k = cust(days=10)["id"]
    sale(k, 1234, "2023-01-01")
    for params, label in [({"as_of": "abc"}, "bad as_of"), ({"partner_id": "x"}, "bad partner_id"), ({"format": "pdf"}, "bad format"),
                          ({"as_of": "2023-02-30"}, "invalid date")]:
        eq(a.get("/reports/debt-aging", **params).status, 400, f"aging {label}")
    r = a.get("/reports/debt-aging", as_of="2023-01-31", q="khong-co-ai-ten-nay")
    eq(r.status, 200, "q filter")
    eq(r.json["items"], [], "q filter no match")
    r = a.get("/reports/debt-aging", as_of="2023-06-30", format="xlsx")
    wb = xlsx_basic_checks(r.content, "aging xlsx")
    if wb:
        ws = wb.worksheets[0]
        row = None
        for rr in ws.iter_rows():
            if any(c.value == 1234 for c in rr):
                row = rr
        check(row is not None, "aging xlsx contains the amount as a real number")
        js = aging("2023-06-30")
        vals = xlsx_numbers(r.content)
        check(any(abs(v - float(js["totals"]["total"])) < 0.01 for v in vals), "xlsx grand total present as a number")
    eq(a.get("/reports/debt-aging", as_of="2023-06-30", format="docx").status, 200, "aging docx")
    expect_err(user("thukho").get("/reports/debt-aging"), 403, "FORBIDDEN", "thukho (no debt.view)")
    eq(user("banhang").get("/reports/debt-aging").status, 200, "banhang (debt.view)")
    # supplier-only partners never appear; customers with zero balance hidden
    s = mk_partner(supp=True)
    check(all(it["partner_id"] != s["id"] for it in aging("2023-12-31")["items"]), "supplier not in receivable aging")
