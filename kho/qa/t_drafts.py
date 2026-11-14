"""D. Phiếu tạm nhiều máy, hàng cần đặt, đồng thời: REQ-040..046, 082"""
import concurrent.futures as cf
from lib import *

_users = {}


def users():
    if not _users:
        a = admin()
        for u, n in (("may1", "Nguyễn Thị Lan (Máy 1)"), ("may2", "Trần Thị Hoa (Máy 2)")):
            r = a.post("/users", {"username": u, "password": "matkhau1", "full_name": n, "role": "ketoan", "active": True})
            if r.status not in (200, 201):
                raise Fatal("create user: " + r.short())
        _users["m1"] = login("may1", "matkhau1")
        _users["m2"] = login("may2", "matkhau1")
    return _users["m1"], _users["m2"]


@test("040,041,042,043,044,045,046,005,082", "test_REQ043_044_082_two_machines_shared_draft")
def _():
    m1, m2 = users()
    k1 = wh("KHO1")
    c = mk_partner(name="Khách gọi điện Phúc", cust=True)
    s = mk_partner(supp=True)
    p = mk_product(sale=50000, purchase=40000)   # no stock at all
    q = mk_product(sale=1000, purchase=500)
    posted("opening", "2026-01-01", k1, [L(q["id"], 100, 500)])
    rec0 = debt_closing(c["id"])
    sse1 = SSE(m1)
    # machine 1 creates draft with product without stock
    r = create_doc("sale", "2026-11-14", k1, [L(p["id"], 10)], c["id"], note="Khách A gọi đặt", c=m1)
    eq(r.status, 201, "machine 1 creates draft with out-of-stock product")
    d = r.json
    eq(stock_of(p["id"])[1] or 0, 0, "draft does not change stock")
    eq(debt_closing(c["id"]), rec0, "draft does not change debt")
    # machine 2 sees it
    lst = m2.ok("GET", "/documents", params={"status": "draft"})
    mine = [x for x in lst["items"] if x["id"] == d["id"]]
    if check(mine, "machine 2 sees machine 1's draft in draft list"):
        eq(mine[0]["created_by_name"], "Nguyễn Thị Lan (Máy 1)", "list shows who created it")
    lst = m2.ok("GET", "/documents", params={"status": "draft", "q": "phuc"})
    check(any(x["id"] == d["id"] for x in lst["items"]), "machine 2 finds it by customer name without diacritics")
    # machine 2 continues: adds a line (customer called back)
    d2 = m2.ok("GET", f"/documents/{d['id']}")
    b = put_body_from(d2)
    b["lines"].append({"product_id": q["id"], "qty": 5})
    b["lines"][0]["qty"] = 12
    r = m2.put(f"/documents/{d['id']}", b)
    eq(r.status, 200, "machine 2 edits the draft")
    eq(r.json["updated_by_name"], "Trần Thị Hoa (Máy 2)", "updated_by machine 2")
    eq(r.json["version"], d["version"] + 1, "version incremented")
    ev = sse1.wait_for(lambda e: e.get("type") == "document.changed" and e.get("id") == d["id"] and e.get("action") == "updated")
    check(ev is not None, f"machine 1 receives SSE update event (got {sse1.events[-5:]})")
    if ev:
        eq(ev.get("by"), "Trần Thị Hoa (Máy 2)", "SSE 'by'")
    # machine 1 with stale version
    b1 = put_body_from(d); b1["note"] = "ghi đè của máy 1"
    r = m1.put(f"/documents/{d['id']}", b1)
    eq(r.status, 409, "stale version -> 409"); eq(r.code, "VERSION_CONFLICT", "code")
    det = r.details or {}
    eq(det.get("updated_by"), "Trần Thị Hoa (Máy 2)", "conflict says who changed it")
    eq(det.get("current_version"), d["version"] + 1, "conflict current_version")
    cur = m1.ok("GET", f"/documents/{d['id']}")
    eq(len(cur["lines"]), 2, "machine 2's change not overwritten"); eq(cur["note"], "Khách A gọi đặt", "note unchanged")
    r = m1.post(f"/documents/{d['id']}/post", {"version": d["version"], "confirm_loss": True})
    eq(r.status, 409, "stale post -> 409")
    # REQ-046: purchasing view
    dd = admin().ok("GET", "/reports/draft-demand")
    it = [i for i in dd["items"] if i["product_id"] == p["id"]]
    if check(it, "draft-demand lists product"):
        eq(it[0]["qty_in_drafts"], 12, "qty in drafts"); eq(it[0]["total_stock"], 0, "stock"); eq(it[0]["shortage"], 12, "to order")
        check(any(x["document_id"] == d["id"] for x in it[0]["drafts"]), "demand drills down to the draft")
    itq = [i for i in dd["items"] if i["product_id"] == q["id"]]
    if check(itq, "draft-demand lists q too"):
        eq(itq[0]["shortage"], 0, "q no shortage")
    dd2 = admin().ok("GET", "/reports/draft-demand", params={"only_shortage": "true"})
    check(not any(i["product_id"] == q["id"] for i in dd2["items"]), "only_shortage hides q")
    # purchasing buys 8 to KHO1 -> shortage 4
    posted("purchase", "2026-11-14", k1, [L(p["id"], 8, 40000)], s["id"])
    it = [i for i in admin().ok("GET", "/reports/draft-demand")["items"] if i["product_id"] == p["id"]]
    if it:
        eq(it[0]["shortage"], 4, "shortage after partial purchase")
    # REQ-045 post: still short
    cur = m2.ok("GET", f"/documents/{d['id']}")
    eq(m2.post(f"/documents/{d['id']}/post", {"version": cur["version"]}).status, 422, "cannot post while short")
    posted("purchase", "2026-11-14", k1, [L(p["id"], 4, 40000)], s["id"])
    r = m2.post(f"/documents/{d['id']}/post", {"version": cur["version"]})
    eq(r.status, 200, "machine 2 posts the draft created on machine 1")
    eq(r.json["created_by_name"], "Nguyễn Thị Lan (Máy 1)", "created_by kept"); eq(r.json["posted_by_name"], "Trần Thị Hoa (Máy 2)", "posted_by")
    ev = sse1.wait_for(lambda e: e.get("id") == d["id"] and e.get("action") == "posted")
    check(ev is not None, "SSE posted event")
    it = [i for i in admin().ok("GET", "/reports/draft-demand")["items"] if i["product_id"] == p["id"]]
    check(not it, "posted doc no longer in draft-demand")
    eq(debt_closing(c["id"]), rec0 + 12 * 50000 + 5 * 1000, "debt after post")
    # machine 2 deletes another draft, machine 1 then edits it -> 404
    d3 = draft("sale", "2026-11-14", k1, [L(q["id"], 1)], c["id"], c=m1)
    eq(m2.delete(f"/documents/{d3['id']}").status, 200, "machine 2 deletes draft")
    ev = sse1.wait_for(lambda e: e.get("id") == d3["id"] and e.get("action") == "deleted")
    check(ev is not None, "SSE deleted event")
    r = m1.put(f"/documents/{d3['id']}", put_body_from(d3))
    eq(r.status, 404, "editing a deleted draft -> 404")
    sse1.stop()
    # SSE requires login
    r = requests.get(BASE + "/events", timeout=5, stream=True)
    eq(r.status_code, 401, "SSE without login 401")
    r.close()


@test("005,040,042", "test_REQ005_drafts_change_nothing")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    p = mk_product(sale=100, purchase=50)
    c = mk_partner(cust=True, rec=1000); s = mk_partner(supp=True, pay=2000)
    posted("opening", "2026-01-01", k1, [L(p["id"], 10, 50)])

    def snap():
        return (stock_summary(only_with_data="false")["items"] and stock_of(p["id"]),
                debt_closing(c["id"]), debt_closing(s["id"], "payable"),
                len(ledger(p["id"])["rows"]),
                a.ok("GET", "/reports/sales", params={"from": "2026-01-01", "to": "2026-12-31", "partner_id": c["id"]})["total_amount"],
                a.ok("GET", "/reports/stock-nxt", params={"from": "2026-01-01", "to": "2026-12-31", "q": p["code"]})["totals"])
    s0 = snap()
    ds = [draft("sale", "2026-02-01", k1, [L(p["id"], 100)], c["id"]),
          draft("purchase", "2026-02-01", k1, [L(p["id"], 100, 50)], s["id"]),
          draft("transfer", "2026-02-01", k1, [L(p["id"], 5)], to_wh=k2),
          draft("sale_return", "2026-02-01", k1, [L(p["id"], 5, 100)], c["id"]),
          draft("purchase_return", "2026-02-01", k1, [L(p["id"], 5, 50)], s["id"]),
          draft("opening", "2026-02-01", k1, [L(p["id"], 5, 50)])]
    eq(snap(), s0, "drafts of every type change nothing")
    b = put_body_from(ds[0]); b["lines"][0]["qty"] = 3
    a.put(f"/documents/{ds[0]['id']}", b)
    eq(snap(), s0, "editing draft changes nothing")
    for d in ds[1:]:
        a.delete(f"/documents/{d['id']}")
    eq(snap(), s0, "deleting drafts changes nothing")
    # an empty draft is allowed but cannot be posted
    r = create_doc("sale", "2026-02-01", k1, [], c["id"])
    eq(r.status, 201, "empty draft allowed")
    if r.status == 201:
        eq(post_doc(r.json).status, 400, "posting empty draft -> 400")
    dash = a.ok("GET", "/dashboard")
    lst = a.ok("GET", "/documents", params={"status": "draft", "page_size": 500})
    eq(dash["draft_count"], lst["total"], "dashboard draft_count = number of drafts")


@test("030,031,082", "test_REQ030_concurrent_postings_same_stock")
def _():
    k1 = wh("KHO1")
    c = mk_partner(cust=True)
    m1, m2 = users()
    for round_ in range(6):
        p = mk_product(sale=100, purchase=50)
        posted("opening", "2026-01-01", k1, [L(p["id"], 10, 50)])
        d1 = draft("sale", "2026-03-01", k1, [L(p["id"], 6)], c["id"], c=m1)
        d2 = draft("sale", "2026-03-01", k1, [L(p["id"], 6)], c["id"], c=m2)
        clients = [login("may1", "matkhau1"), login("may2", "matkhau1")]
        with cf.ThreadPoolExecutor(2) as ex:
            res = list(ex.map(lambda t: post_doc(t[0], True, t[1]).status, [(d1, clients[0]), (d2, clients[1])]))
        check(sorted(res) == [200, 422], f"round {round_}: exactly one posting wins, got {res}")
        eq(stock_of(p["id"])[1], 4, f"round {round_}: stock 4 never negative")
    # many concurrent postings: unique official numbers
    p = mk_product(sale=100, purchase=50)
    posted("opening", "2026-01-01", k1, [L(p["id"], 1000, 50)])
    ds = [draft("sale", "2026-03-02", k1, [L(p["id"], 1)], c["id"]) for _ in range(16)]
    cls = [login("may1", "matkhau1") for _ in range(8)]
    with cf.ThreadPoolExecutor(8) as ex:
        rs = list(ex.map(lambda i: post_doc(ds[i], True, cls[i % 8]), range(16)))
    check(all(r.status == 200 for r in rs), f"16 concurrent postings succeed: {[r.status for r in rs]}")
    nos = [r.json["doc_no"] for r in rs if r.status == 200]
    eq(len(set(nos)), len(nos), "official numbers unique under concurrency")
    eq(stock_of(p["id"])[1], 1000 - len(nos), "stock after concurrent sales")
    # 10 parallel sales of 150 each with 1000 stock -> max 6 succeed
    p = mk_product(sale=100, purchase=50)
    posted("opening", "2026-01-01", k1, [L(p["id"], 1000, 50)])
    ds = [draft("sale", "2026-03-02", k1, [L(p["id"], 150)], c["id"]) for _ in range(10)]
    with cf.ThreadPoolExecutor(8) as ex:
        rs = list(ex.map(lambda i: post_doc(ds[i], True, cls[i % 8]).status, range(10)))
    eq(rs.count(200), 6, f"exactly 6 of 10 competing sales win: {rs}")
    eq(stock_of(p["id"])[1], 100, "stock 100 left")


@test("044,082", "test_REQ044_concurrent_edits_same_version")
def _():
    k1 = wh("KHO1")
    c = mk_partner(cust=True)
    p = mk_product(sale=100)
    cls = [login("may1", "matkhau1"), login("may2", "matkhau1")] if users() else None
    for i in range(5):
        d = draft("sale", "2026-03-01", k1, [L(p["id"], 1)], c["id"])
        bodies = []
        for j in range(2):
            b = put_body_from(d); b["note"] = f"máy {j}"; bodies.append(b)
        with cf.ThreadPoolExecutor(2) as ex:
            res = list(ex.map(lambda j: cls[j].put(f"/documents/{d['id']}", bodies[j]).status, range(2)))
        check(sorted(res) == [200, 409], f"concurrent edits with same version: one 200 one 409, got {res}")
        eq(get_doc(d["id"])["version"], d["version"] + 1, "version advanced exactly once")
