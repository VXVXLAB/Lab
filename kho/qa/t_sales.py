"""C. Nhập-bán-giá-sửa chứng từ: REQ-023..039, 079..081"""
from lib import *


@test("023,024,025,026,027,033,034", "test_REQ023_027_purchase_sale_default_price")
def _():
    a = admin()
    k1 = wh("KHO1")
    pA = mk_product(name="Mặt hàng A", sale=6500, purchase=5000)
    pB = mk_product(sale=12000, purchase=9000)
    s = mk_partner(supp=True, pay=1000000); c = mk_partner(cust=True, rec=300000)
    d = draft("purchase", "2026-03-01", k1, [L(pA["id"], 100), L(pB["id"], 10, 9500)], s["id"])
    eq(d["lines"][0]["unit_price"], 5000, "purchase default price = purchase_price")
    eq(d["lines"][1]["unit_price"], 9500, "explicit purchase price kept")
    eq(d["total_amount"], 500000 + 95000, "purchase total")
    check(d["status"] == "draft" and d["draft_no"].startswith("TAM"), "created as draft with TAM number")
    eq(stock_of(pA["id"])[1] or 0, 0, "draft doesn't add stock")
    eq(debt_closing(s["id"], "payable"), 1000000, "draft doesn't add payable")
    p = post_doc(d)
    eq(p.status, 200, "post purchase")
    pd = p.json
    check(pd["doc_no"].startswith("NK"), "NK number")
    eq(stock_of(pA["id"])[1], 100, "stock after post")
    eq(debt_closing(s["id"], "payable"), 1595000, "payable after post")
    eq(pd["old_debt"], 1000000, "purchase old_debt"); eq(pd["total_debt"], 1595000, "purchase total_debt")
    pi = a.ok("GET", f"/products/{pA['id']}/price-info", params={"date": "2026-03-02"})
    eq(pi["sale_price"], 6500, "price-info default sale price")
    # sale: default price & edited price
    sd = draft("sale", "2026-03-05", k1, [L(pA["id"], 10), L(pA["id"], 5, 7000), L(pB["id"], 1, 11000)], c["id"])
    eq(sd["lines"][0]["unit_price"], 6500, "sale default = 6500 (customer example)")
    eq(sd["lines"][1]["unit_price"], 7000, "accountant can type higher price")
    eq(sd["lines"][2]["unit_price"], 11000, "accountant can type lower price")
    eq(sd["total_amount"], 65000 + 35000 + 11000, "sale total")
    r = post_doc(sd, confirm_loss=True)
    eq(r.status, 200, "post sale")
    eq(stock_of(pA["id"])[1], 85, "stock decreased by sale (2 lines same product)")
    eq(stock_of(pB["id"])[1], 9, "stock B")
    eq(debt_closing(c["id"]), 300000 + 111000, "receivable after sale")
    eq(r.json["old_debt"], 300000, "sale old_debt"); eq(r.json["total_debt"], 411000, "sale total_debt")
    # changing the default sale price afterwards does not change posted doc
    pa2 = dict(pA); pa2["sale_price"] = 9999
    a.ok("PUT", f"/products/{pA['id']}", pa2)
    eq(get_doc(r.json["id"])["lines"][0]["unit_price"], 6500, "posted line keeps its price after catalog change")


@test("028,029,004,080", "test_REQ029_080_loss_warning_rules")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    p = mk_product(sale=6500, purchase=5000)
    s = mk_partner(supp=True); c = mk_partner(cust=True)
    posted("opening", "2026-01-01", k1, [L(p["id"], 1000, 5000)])
    posted("opening", "2026-01-01", k2, [L(p["id"], 1000, 5000)])

    def warn(date, price, whid=k1):
        d = draft("sale", date, whid, [L(p["id"], 1, price)], c["id"])
        ws = [w for w in d["warnings"] if w.get("type") == "loss"]
        return d, ws

    # never purchased -> default purchase_price 5000
    pi = a.ok("GET", f"/products/{p['id']}/price-info", params={"date": "2026-02-01"})
    eq(pi["cost_price"], 5000, "cost default"); eq(pi["cost_source"], "default", "cost_source default")
    d, w = warn("2026-02-01", 4999); check(len(w) == 1, f"below default price -> warning {d['warnings']}")
    if w:
        eq(w[0]["cost_price"], 5000, "warning cost_price"); eq(w[0]["line_no"], 1, "warning line_no")
    d, w = warn("2026-02-01", 5000); check(not w, "equal price -> no warning")
    d, w = warn("2026-02-01", 5001); check(not w, "above -> no warning")
    posted("purchase", "2026-03-01", k1, [L(p["id"], 10, 5500)], s["id"])
    posted("purchase", "2026-05-01", k2, [L(p["id"], 10, 4800)], s["id"])
    draft("purchase", "2026-04-01", k1, [L(p["id"], 10, 9000)], s["id"])  # draft not counted
    d, w = warn("2026-02-01", 4999); check(len(w) == 1, "sale dated before any purchase still uses default")
    d, w = warn("2026-04-15", 5400); check(len(w) == 1, "below last purchase 5500")
    if w:
        eq(w[0]["cost_price"], 5500, "cost = last purchase"); eq(w[0].get("cost_source"), "last_purchase", "source")
    d, w = warn("2026-04-15", 5500); check(not w, "equal last purchase -> none")
    d, w = warn("2026-04-15", 6000); check(not w, "draft purchase at 9000 must not be used")
    d, w = warn("2026-03-01", 5499); check(len(w) == 1, "purchase on same day counts (<= date)")
    d, w = warn("2026-06-01", 4900); check(not w, "latest purchase (4800, other warehouse) is used -> 4900 not a loss")
    d, w = warn("2026-06-01", 4700, k1); check(len(w) == 1, "4700 < 4800 loss from any warehouse")
    pi = a.ok("GET", f"/products/{p['id']}/price-info", params={"date": "2026-04-15"})
    eq(pi["cost_price"], 5500, "price-info cost at 04-15"); eq(pi["cost_source"], "last_purchase", "price-info source")
    # editing price on slip -> warning, post needs confirm
    d = draft("sale", "2026-04-15", k1, [L(p["id"], 2)], c["id"])
    check(not d["warnings"], "default price 6500 no warning")
    b = put_body_from(d); b["lines"][0]["unit_price"] = 5000
    r = a.put(f"/documents/{d['id']}", b)
    eq(r.status, 200, "edit draft price")
    d = r.json
    check(any(w["type"] == "loss" for w in d["warnings"]), "warning after editing price on slip")
    chk = a.ok("GET", f"/documents/{d['id']}/check")
    check(len(chk["loss_lines"]) == 1, f"/check loss_lines {chk}")
    r = post_doc(d)
    eq(r.status, 409, "post without confirm -> 409"); eq(r.code, "LOSS_WARNING", "code LOSS_WARNING")
    check(isinstance(r.details, list) and r.details and r.details[0].get("line_no") == 1, f"LOSS_WARNING details list lines: {r.details}")
    eq(get_doc(d["id"])["status"], "draft", "still draft after refused post")
    r = post_doc(d, confirm_loss=True)
    eq(r.status, 200, "post with confirm")
    sale = r.json
    # posted sale edited to loss price needs confirm
    b = put_body_from(sale); b["lines"][0]["unit_price"] = 4000
    r = a.put(f"/documents/{sale['id']}", b)
    eq(r.status, 409, "edit posted sale to lower loss price without confirm"); eq(r.code, "LOSS_WARNING", "code")
    eq(get_doc(sale["id"])["lines"][0]["unit_price"], 5000, "data untouched after refused edit")
    b["confirm_loss"] = True
    eq(a.put(f"/documents/{sale['id']}", b).status, 200, "edit with confirm")
    # service lines exempt
    d = draft("sale", "2026-04-15", k1, [L(p["id"], 1, 6000), {"product_code": "DV", "description": "Chiết khấu", "unit_price": -100000}], c["id"])
    check(not d["warnings"], f"negative service line not a loss: {d['warnings']}")
    eq(post_doc(d).status, 200, "post with service discount needs no confirm")
    # no purchase price at all -> no warning
    z = mk_product(sale=0, purchase=0)
    posted("opening", "2026-01-01", k1, [L(z["id"], 5, 0)])
    d = draft("sale", "2026-04-15", k1, [L(z["id"], 1, 1)], c["id"])
    check(not d["warnings"], "purchase price 0 & opening at 0 -> no warning")
    # stock check comes before loss check
    d = draft("sale", "2026-04-15", k1, [L(p["id"], 999999, 1)], c["id"])
    r = post_doc(d)
    eq(r.status, 422, "shortage reported before loss")


@test("030,031,032,079,041", "test_REQ031_032_079_out_of_stock")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    c = mk_partner(cust=True); s = mk_partner(supp=True)
    p0 = mk_product(sale=1000, purchase=500)
    # --- stock 0
    d = draft("sale", "2026-05-10", k1, [L(p0["id"], 5)], c["id"])
    eq(d["status"], "draft", "draft allowed for product with no stock (REQ-041)")
    chk = a.ok("GET", f"/documents/{d['id']}/check")
    eq(chk.get("can_post"), False, "check can_post false")
    r = post_doc(d)
    eq(r.status, 422, "post with stock 0 refused"); eq(r.code, "INSUFFICIENT_STOCK", "code")
    det = r.details or []
    if check(len(det) == 1, f"one shortage {det}"):
        x = det[0]
        eq(x["product_id"], p0["id"], "shortage product"); eq(x["warehouse_id"], k1, "shortage wh")
        eq(x["required"], 5, "required"); eq(x["available"], 0, "available"); eq(x["shortage"], 5, "shortage")
        eq(x["date"], "2026-05-10", "date")
        check("tồn" in x.get("message", ""), "Vietnamese message")
    d2 = get_doc(d["id"])
    eq(d2["status"], "draft", "still draft"); eq(d2["version"], d["version"], "version unchanged"); eq(d2["doc_no"], None, "no official number consumed")
    # official export refused / clearly marked as draft
    for fmt in ("xlsx", "docx"):
        r = a.get(f"/documents/{d['id']}/export", format=fmt)
        if r.status == 200:
            txt = xlsx_text(open_xlsx(r.content)) if fmt == "xlsx" else docx_text(open_docx(r.content))
            check("PHIẾU TẠM (chưa ghi sổ)" in txt, f"{fmt} of unposted sale marked PHIẾU TẠM")
            check("PHIẾU XUẤT KHO BÁN HÀNG" not in txt, f"{fmt} of unposted sale must not carry official title")
            cd = r.headers.get("Content-Disposition", "")
            check("PHIEU_TAM" in cd, f"draft file name: {cd}")
        else:
            check(r.status in (400, 409, 422), f"export draft {fmt}: {r.short()}")
    # --- insufficient
    posted("purchase", "2026-05-01", k1, [L(p0["id"], 3, 500)], s["id"])
    r = post_doc(get_doc(d["id"]))
    eq(r.status, 422, "stock 3 < 5")
    if r.details:
        eq(r.details[0]["available"], 3, "available 3"); eq(r.details[0]["shortage"], 2, "shortage 2")
    # --- several lines of same product: 2 + 2 with stock 3
    d3 = draft("sale", "2026-05-10", k1, [L(p0["id"], 2), L(p0["id"], 2)], c["id"])
    r = post_doc(d3)
    eq(r.status, 422, "2+2 lines > stock 3 refused (lines aggregated)")
    if r.details:
        eq(r.details[0]["required"], 4, "aggregated required 4"); eq(r.details[0]["shortage"], 1, "shortage 1")
    eq(stock_of(p0["id"])[1], 3, "stock untouched")
    # --- wrong warehouse
    d4 = draft("sale", "2026-05-10", k2, [L(p0["id"], 1)], c["id"])
    r = post_doc(d4)
    eq(r.status, 422, "selling from warehouse without stock refused")
    if r.details:
        eq(r.details[0]["warehouse_id"], k2, "shortage at KHO2")
    # --- back-dated before purchase
    d5 = draft("sale", "2026-04-30", k1, [L(p0["id"], 1)], c["id"])
    r = post_doc(d5)
    eq(r.status, 422, "sale dated before purchase refused")
    # --- exact stock allowed
    d6 = draft("sale", "2026-05-10", k1, [L(p0["id"], 1.5), L(p0["id"], 1.5)], c["id"])
    r = post_doc(d6)
    eq(r.status, 200, "selling exactly available 3 (1.5+1.5) allowed")
    eq(stock_of(p0["id"])[1], 0, "stock now 0")
    r = a.get(f"/documents/{d6['id']}/export", format="xlsx")
    txt = xlsx_text(open_xlsx(r.content))
    check("PHIẾU XUẤT KHO BÁN HÀNG" in txt and "PHIẾU TẠM" not in txt, "posted export official title")
    # --- new sale earlier than a later posted sale which would break the later day
    p1 = mk_product(sale=1000, purchase=500)
    posted("purchase", "2026-06-01", k1, [L(p1["id"], 10, 500)], s["id"])
    posted("sale", "2026-06-10", k1, [L(p1["id"], 8, 1000)], c["id"])
    d7 = draft("sale", "2026-06-05", k1, [L(p1["id"], 5, 1000)], c["id"])
    r = post_doc(d7)
    eq(r.status, 422, "back-dated sale making a LATER day negative refused")
    if r.details:
        eq(r.details[0]["date"], "2026-06-10", "first negative day"); eq(r.details[0]["shortage"], 3, "shortage 3")
    d8 = draft("sale", "2026-06-05", k1, [L(p1["id"], 2, 1000)], c["id"])
    eq(post_doc(d8).status, 200, "back-dated sale that keeps all days >= 0 allowed")
    # unposting the purchase now must be refused
    pur = [x for x in a.ok("GET", "/documents", params={"product_id": p1["id"], "type": "purchase"})["items"]][0]
    r = a.post(f"/documents/{pur['id']}/unpost", {"version": pur["version"]})
    eq(r.status, 422, "unpost purchase with later sales refused")
    eq(get_doc(pur["id"])["status"], "posted", "purchase still posted")


@test("035,036,037,038,039,081,003", "test_REQ036_081_edit_january_purchase_in_september")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    s1 = mk_partner(name="NCC Tháng Một", supp=True); s2 = mk_partner(name="NCC Đúng", supp=True)
    c = mk_partner(cust=True)
    X = mk_product(sale=15000, purchase=10000); Y = mk_product(sale=25000, purchase=20000)
    Z = mk_product(sale=7000, purchase=5000); Wp = mk_product(sale=3000, purchase=2000)
    pur = posted("purchase", "2026-01-15", k1, [L(X["id"], 100, 10000), L(Y["id"], 50, 20000), L(Z["id"], 10, 5000)], s1["id"], note="Hàng đầu năm")
    sale = posted("sale", "2026-09-10", k1, [L(X["id"], 30, 15000), L(Y["id"], 10, 25000)], c["id"])
    eq(debt_closing(s1["id"], "payable"), 1000000 + 1000000 + 50000, "payable before fix")
    # REQ-035: find the old purchase
    lst = a.ok("GET", "/documents", params={"type": "purchase", "from": "2026-01-01", "to": "2026-01-31", "partner_id": s1["id"]})
    check(any(x["id"] == pur["id"] for x in lst["items"]), "find January purchase by date+partner")
    lst = a.ok("GET", "/documents", params={"q": pur["doc_no"]})
    check(any(x["id"] == pur["id"] for x in lst["items"]), "find by doc_no")
    lst = a.ok("GET", "/documents", params={"product_id": Z["id"]})
    check(any(x["id"] == pur["id"] for x in lst["items"]), "find by product")
    lst = a.ok("GET", "/documents", params={"q": "thang mot"})
    check(any(x["id"] == pur["id"] for x in lst["items"]), "find by supplier name without diacritics")
    old = get_doc(pur["id"])

    def snapshot():
        return (stock_of(X["id"]), stock_of(Y["id"]), stock_of(Z["id"]), debt_closing(s1["id"], "payable"),
                debt_closing(s2["id"], "payable"), get_doc(pur["id"])["version"], get_doc(pur["id"])["total_amount"])

    snap0 = snapshot()
    # --- refused edits leave data untouched
    refused = [
        ("X qty 100->20 (sale of 30 in Sept)", lambda b: b["lines"][0].__setitem__("qty", 20)),
        ("date moved after the sale", lambda b: b.__setitem__("doc_date", "2026-10-01")),
        ("warehouse KHO1->KHO2", lambda b: b.__setitem__("warehouse_id", k2)),
        ("remove line X", lambda b: b.__setitem__("lines", b["lines"][1:])),
        ("swap product of line 1 X->W", lambda b: b["lines"][0].__setitem__("product_id", Wp["id"])),
    ]
    for label, mut in refused:
        b = put_body_from(get_doc(pur["id"]))
        mut(b)
        r = a.put(f"/documents/{pur['id']}", b)
        eq(r.status, 422, f"refused edit: {label}")
        eq(r.code, "INSUFFICIENT_STOCK", f"code for {label}")
        check(snapshot() == snap0, f"data untouched after refused edit {label}")
    # --- the real fix: X 100->80, Y price 20000->21000, remove Z, add W 5 @2000, change partner, date earlier
    b = put_body_from(get_doc(pur["id"]))
    b["lines"][0]["qty"] = 80
    b["lines"][1]["unit_price"] = 21000
    b["lines"] = b["lines"][:2] + [{"product_id": Wp["id"], "qty": 5, "unit_price": 2000}]
    b["partner_id"] = s2["id"]
    b["doc_date"] = "2026-01-10"
    b["note"] = "Sửa lại số lượng"
    r = a.put(f"/documents/{pur['id']}", b)
    eq(r.status, 200, "valid fix of January purchase in September")
    new = r.json
    eq(new["doc_no"], old["doc_no"], "official number unchanged")
    eq(new["version"], old["version"] + 1, "version +1")
    eq(new["total_amount"], 800000 + 1050000 + 10000, "new total")
    eq(stock_of(X["id"])[1], 50, "X = 80 - 30"); eq(stock_of(Y["id"])[1], 40, "Y unchanged")
    eq(stock_of(Z["id"])[1] or 0, 0, "Z removed"); eq(stock_of(Wp["id"])[1], 5, "W added")
    eq(debt_closing(s1["id"], "payable"), 0, "old supplier payable back to 0")
    eq(debt_closing(s2["id"], "payable"), 1860000, "new supplier payable")
    lg = ledger(X["id"])
    eq(lg["rows"][0]["date"], "2026-01-10", "ledger shows new date")
    eq(lg["rows"][0]["description"], "Nhập kho mua hàng NCC Đúng - Sửa lại số lượng", "ledger shows new partner + note")
    eq(lg["rows"][0]["qty_in"], 80, "ledger new qty")
    n = a.ok("GET", "/reports/stock-nxt", params={"from": "2026-01-01", "to": "2026-12-31", "q": X["code"]})
    it = [i for i in n["items"] if i["product_id"] == X["id"]]
    if it:
        eq(it[0]["qty_in"], 80, "NXT in after edit"); eq(it[0]["closing"], 50, "NXT closing after edit")
    pr = a.ok("GET", "/reports/purchases", params={"from": "2026-01-01", "to": "2026-01-31", "partner_id": s2["id"]})
    eq(pr["total_amount"], 1860000, "purchase report after edit")
    lst = a.ok("GET", "/reports/purchases", params={"from": "2026-01-01", "to": "2026-01-31", "partner_id": s1["id"]})
    eq(len(lst["rows"]), 0, "old supplier no longer in purchase report")
    # loss cost follows the edited purchase price
    pi = a.ok("GET", f"/products/{Y['id']}/price-info", params={"date": "2026-09-30"})
    eq(pi["cost_price"], 21000, "cost price follows edited purchase")
    # history
    h = a.ok("GET", f"/documents/{pur['id']}/history")["items"]
    acts = [x["action"] for x in h]
    check("updated" in acts and "posted" in acts and "created" in acts, f"history actions {acts}")
    upd = [x for x in h if x["action"] == "updated"]
    if upd:
        check(upd[-1]["before"] and upd[-1]["after"] and upd[-1]["before"]["total_amount"] != upd[-1]["after"]["total_amount"],
              "history keeps before/after")
    # --- edit the old sale: qty, price, customer, warehouse
    c2 = mk_partner(cust=True)
    b = put_body_from(get_doc(sale["id"]))
    b["lines"][0]["qty"] = 40; b["lines"][0]["unit_price"] = 16000; b["partner_id"] = c2["id"]
    b["confirm_loss"] = True
    r = a.put(f"/documents/{sale['id']}", b)
    eq(r.status, 200, "edit old sale qty/price/customer")
    eq(stock_of(X["id"])[1], 40, "X after sale edit")
    eq(debt_closing(c["id"]), 0, "old customer debt removed"); eq(debt_closing(c2["id"]), 640000 + 250000, "new customer debt")
    b = put_body_from(get_doc(sale["id"]), warehouse_id=k2); b["confirm_loss"] = True
    eq(a.put(f"/documents/{sale['id']}", b).status, 422, "moving sale to empty warehouse refused")
    b = put_body_from(get_doc(sale["id"])); b["lines"][0]["qty"] = 81; b["confirm_loss"] = True
    eq(a.put(f"/documents/{sale['id']}", b).status, 422, "sale qty > stock refused")
    # posted doc cannot lose all lines
    b = put_body_from(get_doc(sale["id"]), lines=[]); b["confirm_loss"] = True
    eq(a.put(f"/documents/{sale['id']}", b).status, 400, "posted doc with 0 lines -> 400")
    # changing doc_type not allowed
    b = put_body_from(get_doc(sale["id"]), doc_type="purchase"); b["confirm_loss"] = True
    r = a.put(f"/documents/{sale['id']}", b)
    check(r.status == 400, f"doc_type change refused: {r.short()[:200]}")
    eq(get_doc(sale["id"])["doc_type"], "sale", "still a sale")


@test("003,039,081", "test_REQ003_unpost_repost_delete")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=50)
    s = mk_partner(supp=True); c = mk_partner(cust=True)
    pur = posted("purchase", "2026-02-01", k1, [L(p["id"], 10, 50)], s["id"])
    sale = posted("sale", "2026-02-05", k1, [L(p["id"], 4, 100)], c["id"])
    r = a.post(f"/documents/{sale['id']}/unpost", {"version": sale["version"]})
    eq(r.status, 200, "unpost sale")
    u = r.json
    eq(u["status"], "draft", "back to draft"); eq(u["doc_no"], sale["doc_no"], "keeps doc_no")
    eq(stock_of(p["id"])[1], 10, "stock restored"); eq(debt_closing(c["id"]), 0, "debt restored")
    lg = ledger(p["id"]); eq(len(lg["rows"]), 1, "ledger without unposted sale")
    r = post_doc(u)
    eq(r.status, 200, "repost"); eq(r.json["doc_no"], sale["doc_no"], "same number on repost")
    eq(stock_of(p["id"])[1], 6, "stock after repost")
    # delete posted -> 400
    r = a.delete(f"/documents/{sale['id']}")
    eq(r.status, 400, "delete posted refused")
    # post already posted
    r = a.post(f"/documents/{sale['id']}/post", {"version": r.json and get_doc(sale["id"])["version"]})
    eq(r.status, 400, "post twice -> 400")
    # delete draft
    d = draft("sale", "2026-02-06", k1, [L(p["id"], 1)], c["id"])
    r = a.delete(f"/documents/{d['id']}", version=d["version"])
    eq(r.status, 200, "delete draft")
    eq(a.get(f"/documents/{d['id']}").status, 404, "deleted -> 404")
    h = a.get(f"/documents/{d['id']}/history")
    check(h.status == 200 and any(x["action"] == "deleted" for x in h.json["items"]), "history of deleted doc available")
    r = a.delete(f"/documents/{d['id']}")
    eq(r.status, 404, "delete twice -> 404")
    # stale version delete
    d = draft("sale", "2026-02-06", k1, [L(p["id"], 1)], c["id"])
    b = put_body_from(d); a.put(f"/documents/{d['id']}", b)
    eq(a.delete(f"/documents/{d['id']}", version=d["version"]).status, 409, "delete with stale version -> 409")
    # numbering unique and increasing
    nums = [posted("purchase", "2026-02-07", k1, [L(p["id"], 1, 50)], s["id"])["doc_no"] for _ in range(3)]
    check(len(set(nums)) == 3 and nums == sorted(nums), f"NK numbers increasing: {nums}")
    check(all(len(n) == 7 for n in nums), f"prefix + 5 digits: {nums}")
