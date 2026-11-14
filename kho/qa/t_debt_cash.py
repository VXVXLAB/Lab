"""E. Công nợ - Thu chi: REQ-052..062, 084, 085"""
from lib import *


def ledger_consistent(dl, label):
    bal = num(dl["opening"])
    for r in dl["rows"]:
        bal = bal + num(r["increase"]) - num(r["decrease"])
        eq(r["balance"], bal, f"{label}: running balance at {r['ref_no']}")
        check((r["document_id"] is None) != (r["voucher_id"] is None), f"{label}: exactly one of document_id/voucher_id {r}")
    eq(dl["closing"], bal, f"{label}: closing")
    eq(dl["total_increase"], sum(num(r["increase"]) for r in dl["rows"]), f"{label}: total_increase")
    eq(dl["total_decrease"], sum(num(r["decrease"]) for r in dl["rows"]), f"{label}: total_decrease")


@test("052,053,056,058,060,062,084,085,007", "test_REQ052_060_customer_debt_and_multiline_receipts")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=100000, purchase=50000)
    posted("opening", "2026-01-01", k1, [L(p["id"], 1000, 50000)])
    c = mk_partner(name="Công ty Đông Hưng", cust=True, rec=1000000)
    tm = mk_account("cash", 10000000); nh = mk_account("bank", 50000000)
    s1 = posted("sale", "2026-03-01", k1, [L(p["id"], 50)], c["id"])          # 5,000,000
    s2 = posted("sale", "2026-03-10", k1, [L(p["id"], 30)], c["id"])          # 3,000,000
    rt = posted("sale_return", "2026-03-12", k1, [L(p["id"], 5)], c["id"])    # 500,000
    r = mk_voucher("receipt", tm["id"], c["id"], [{"description": "Thu nợ cũ", "amount": 1000000},
                                                  {"description": "Thu tiền phiếu " + s1["doc_no"], "amount": 2000000, "document_id": s1["id"]},
                                                  {"description": "Thu tiền phiếu " + s2["doc_no"], "amount": 500000, "document_id": s2["id"]}],
                   date="2026-03-15", note="Thu nợ tháng 3")
    eq(r.status, 201, "multi-line cash receipt")
    v1 = r.json
    check(v1["voucher_no"].startswith("PT"), f"PT number {v1['voucher_no']}")
    eq(v1["total_amount"], 3500000, "voucher total")
    eq(v1["lines"][1]["document_no"], s1["doc_no"], "line linked doc number")
    r = mk_voucher("receipt", nh["id"], c["id"], [{"description": "Chuyển khoản", "amount": 700000}], date="2026-03-20")
    eq(r.status, 201, "bank receipt"); v2 = r.json
    check(v2["voucher_no"].startswith("BC"), f"BC number {v2['voucher_no']}")
    exp = 1000000 + 8000000 - 500000 - 3500000 - 700000
    dl = debt_ledger(c["id"])
    eq(dl["opening"], 1000000, "opening"); eq(dl["closing"], exp, "closing 4,300,000")
    ledger_consistent(dl, "customer ledger")
    eq([x["ref_type"] for x in dl["rows"]], ["sale", "sale", "sale_return", "receipt", "receipt"], "row types in date order")
    rec = [x for x in dl["rows"] if x["ref_type"] == "receipt"]
    eq(num(rec[0]["decrease"]) if rec else None, 3500000, "receipt shown as one ledger row (sum of lines)")
    it = debt_summary_item(c["id"])
    eq(it["closing"], exp, "summary closing"); eq(it["increase"], 8000000, "summary increase")
    eq(it["decrease"], 4700000, "summary decrease")
    # period filter: March 11..31
    it = debt_summary_item(c["id"], **{"from": "2026-03-11", "to": "2026-03-31"})
    eq(it["opening"], 9000000, "opening before 03-11"); eq(it["increase"], 0, "increase in period")
    eq(it["decrease"], 4700000, "decrease in period"); eq(it["closing"], exp, "closing in period")
    dl = debt_ledger(c["id"], **{"from": "2026-03-11", "to": "2026-03-31"})
    eq(dl["opening"], 9000000, "ledger opening 03-11"); ledger_consistent(dl, "ledger period")
    # drill-down from debt ledger (REQ-053/069)
    for x in debt_ledger(c["id"])["rows"]:
        if x["document_id"]:
            d = get_doc(x["document_id"]); eq(d["doc_no"], x["ref_no"], "ledger row opens document")
            eq(d["total_amount"], max(num(x["increase"]), num(x["decrease"])), "document amount = ledger amount")
        else:
            v = a.ok("GET", f"/vouchers/{x['voucher_id']}"); eq(v["voucher_no"], x["ref_no"], "ledger row opens voucher")
    # edit voucher: remove a line & change amount
    b = {"voucher_type": "receipt", "voucher_date": "2026-03-15", "account_id": tm["id"], "partner_id": c["id"], "note": "sửa",
         "lines": [{"description": "Thu nợ cũ", "amount": 1200000}, {"description": "Thu " + s1["doc_no"], "amount": 2000000, "document_id": s1["id"]}],
         "version": v1["version"]}
    r = a.put(f"/vouchers/{v1['id']}", b)
    eq(r.status, 200, "edit voucher")
    eq(r.json["voucher_no"], v1["voucher_no"], "voucher number unchanged on edit")
    eq(debt_closing(c["id"]), exp + 300000, "debt after voucher edit (3.5M -> 3.2M)")
    r = a.put(f"/vouchers/{v1['id']}", b)
    eq(r.status, 409, "stale voucher version -> 409")
    r = a.delete(f"/vouchers/{v2['id']}", version=v2["version"])
    eq(r.status, 200, "delete voucher")
    eq(debt_closing(c["id"]), exp + 300000 + 700000, "debt after voucher delete")
    eq(a.get(f"/vouchers/{v2['id']}").status, 404, "deleted voucher 404")
    # cash book of TM: opening 10,000,000 + 3,200,000
    cb = a.ok("GET", "/reports/cash-book", params={"account_id": tm["id"]})
    eq(cb["opening"], 10000000, "cash opening"); eq(cb["closing"], 13200000, "cash closing")
    eq(len(cb["rows"]), 2, "one cash-book row per voucher line")
    bal = num(cb["opening"])
    for x in cb["rows"]:
        bal += num(x["receipt"]) - num(x["payment"]); eq(x["balance"], bal, "cash-book running balance")
        eq(a.ok("GET", f"/vouchers/{x['voucher_id']}")["voucher_no"], x["voucher_no"], "cash row drill-down")
    cb = a.ok("GET", "/reports/cash-book", params={"account_id": nh["id"]})
    eq(cb["closing"], 50000000, "bank closing after delete")
    # voucher validation
    r = mk_voucher("receipt", tm["id"], c["id"], [])
    eq(r.status, 400, "voucher without lines")
    r = mk_voucher("receipt", tm["id"], c["id"], [{"description": "x", "amount": 0}])
    eq(r.status, 400, "voucher amount 0")
    r = mk_voucher("receipt", tm["id"], c["id"], [{"description": "x", "amount": -5}])
    eq(r.status, 400, "voucher amount negative")
    other = mk_partner(cust=True)
    r = mk_voucher("receipt", tm["id"], other["id"], [{"description": "x", "amount": 5, "document_id": s1["id"]}])
    eq(r.status, 400, "linked document of another partner")
    r = mk_voucher("receipt", 999999, c["id"], [{"description": "x", "amount": 5}])
    check(r.status in (400, 404), f"unknown account: {r.status}")
    r = mk_voucher("transfer", tm["id"], c["id"], [{"description": "x", "amount": 5}])
    eq(r.status, 400, "unknown voucher_type")
    # search vouchers without diacritics
    lst = a.ok("GET", "/vouchers", params={"q": "dong hung"})
    check(any(x["id"] == v1["id"] for x in lst["items"]), "voucher search by partner without diacritics")
    lst = a.ok("GET", "/vouchers", params={"partner_id": c["id"], "type": "receipt"})
    eq(lst["total"], 1, "vouchers filter by partner")


@test("054,055,057,059,061,062,084,085", "test_REQ054_061_supplier_debt_and_multiline_payments")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(sale=100000, purchase=50000)
    s = mk_partner(name="Công ty Sunshine Welding", supp=True, pay=2000000)
    tm = mk_account("cash", 30000000); nh = mk_account("bank", 0)
    p1 = posted("purchase", "2026-04-01", k1, [L(p["id"], 100, 50000)], s["id"])   # 5,000,000
    p2 = posted("purchase", "2026-04-05", k1, [L(p["id"], 20, 52500)], s["id"])    # 1,050,000
    pr = posted("purchase_return", "2026-04-06", k1, [L(p["id"], 10, 50000)], s["id"])  # 500,000
    r = mk_voucher("payment", tm["id"], s["id"], [{"description": "Trả tiền " + p1["doc_no"], "amount": 3000000, "document_id": p1["id"]},
                                                  {"description": "Trả nợ cũ", "amount": 2000000},
                                                  {"description": "Trả bớt " + p2["doc_no"], "amount": 50000, "document_id": p2["id"]}], date="2026-04-10")
    eq(r.status, 201, "multi-line cash payment"); v = r.json
    check(v["voucher_no"].startswith("PC"), f"PC number {v['voucher_no']}")
    r = mk_voucher("payment", nh["id"], s["id"], [{"description": "CK lần 1", "amount": 100000}, {"description": "CK lần 2", "amount": 200000}], date="2026-04-11")
    eq(r.status, 201, "multi-line bank payment"); vb = r.json
    check(vb["voucher_no"].startswith("BN"), f"BN number {vb['voucher_no']}")
    exp = 2000000 + 6050000 - 500000 - 5050000 - 300000
    dl = debt_ledger(s["id"], "payable")
    eq(dl["closing"], exp, "payable closing"); ledger_consistent(dl, "supplier ledger")
    it = debt_summary_item(s["id"], "payable")
    eq(it["closing"], exp, "payable summary"); eq(it["opening"], 2000000, "payable opening")
    cb = a.ok("GET", "/reports/cash-book", params={"account_id": tm["id"]})
    eq(cb["closing"], 30000000 - 5050000, "cash after payment"); eq(len(cb["rows"]), 3, "3 cash-book lines")
    cb = a.ok("GET", "/reports/cash-book", params={"account_id": nh["id"]})
    eq(cb["closing"], -300000, "bank goes negative (no opening) – just arithmetic")
    # supplier payments do not touch receivable side
    eq(debt_closing(s["id"], "receivable"), 0, "receivable side untouched")
    # change voucher account cash->bank: number series changes
    b = {"voucher_type": "payment", "voucher_date": "2026-04-10", "account_id": nh["id"], "partner_id": s["id"], "note": "",
         "lines": [{"description": "Trả nợ", "amount": 5050000}], "version": v["version"]}
    r = a.put(f"/vouchers/{v['id']}", b)
    eq(r.status, 200, "move voucher to bank")
    if r.status == 200:
        check(r.json["voucher_no"].startswith("BN"), f"renumbered BN: {r.json['voucher_no']}")
    eq(debt_closing(s["id"], "payable"), exp, "payable unchanged by account move")
    # partner both customer & supplier: two separate ledgers
    both = mk_partner(name="Vừa mua vừa bán", cust=True, supp=True, rec=100, pay=200)
    posted("sale", "2026-04-12", k1, [L(p["id"], 1, 100000)], both["id"])
    posted("purchase", "2026-04-12", k1, [L(p["id"], 1, 40000)], both["id"])
    eq(debt_closing(both["id"], "receivable"), 100100, "both: receivable"); eq(debt_closing(both["id"], "payable"), 40200, "both: payable")
    # wrong partner kind on documents
    cust_only = mk_partner(cust=True)
    r = create_doc("purchase", "2026-04-12", k1, [L(p["id"], 1, 1)], cust_only["id"])
    eq(r.status, 400, "purchase with customer-only partner")
    r = create_doc("sale", "2026-04-12", k1, [L(p["id"], 1, 1)], s["id"])
    eq(r.status, 400, "sale with supplier-only partner")
    r = create_doc("sale", "2026-04-12", k1, [L(p["id"], 1, 1)], None)
    eq(r.status, 400, "sale without customer")
    # payment without partner (other expense) allowed, no debt effect
    r = mk_voucher("payment", tm["id"], None, [{"description": "Tiền điện", "amount": 1000000}], date="2026-04-15")
    eq(r.status, 201, "payment without partner")


@test("052,065,084", "test_REQ065_debt_summary_totals_and_dashboard")
def _():
    a = admin()
    for side in ("receivable", "payable"):
        s = a.ok("GET", "/reports/debt-summary", params={"side": side, "include_zero": "true"})
        for k in ("opening", "increase", "decrease", "closing"):
            eq(s["totals"][k], sum(num(i[k]) for i in s["items"]), f"{side} totals.{k}")
        for i in s["items"]:
            eq(num(i["closing"]), num(i["opening"]) + num(i["increase"]) - num(i["decrease"]), f"{side} {i['partner_code']} closing formula")
        tot = s["totals"]["closing"]
        d = a.ok("GET", "/dashboard")
        eq(d["total_" + side], tot, f"dashboard total_{side} = debt-summary closing")
        # each partner: summary closing = ledger closing
        for i in s["items"][:60]:
            eq(debt_closing(i["partner_id"], side), i["closing"], f"{side} {i['partner_code']}: summary = ledger")
