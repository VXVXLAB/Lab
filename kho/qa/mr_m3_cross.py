"""Cross-feature M3 scenarios (dates in 2017)."""
from mr_lib import *


@test("C11", "test_X_one_sale_unit_vat_dv_customer_price_credit_loss")
def _():
    """Lon (base), Thùng = 24 Lon; sale price 1000/Lon, purchase 600; product VAT 10; customer price 900/Lon;
    customer opening receivable 5000, credit limit 28000. Opening 100 Lon @600; purchase 1 Thùng @14400 (+10%).
    Sale lines: 1 Thùng (auto 900x24 = 21600, tax 2160) ; 2 Lon @550 (loss: 550 < 600, tax 110) ; DV discount -1000 (tax -100).
    goods 21700, tax 2170, total 23870 ; receivable 5000 + 23870 = 28870 > 28000 -> CREDIT_WARNING over 870 + loss line 2.
    Profit: avg 600/Lon (pre-tax) -> cost 26 x 600 = 15600, revenue 21700."""
    a = admin()
    k1 = wh("KHO1")
    p = a.ok("POST", "/products", {"code": uid("X"), "name": "Bia lon QA", "unit": "Lon", "sale_price": 1000, "purchase_price": 600, "vat_rate": "10"})
    a.put(f"/products/{p['id']}/units", {"items": [{"unit": "Thùng", "factor": 24}]})
    k = mk_partner(cust=True, rec=5000)
    s = mk_partner(supp=True)
    set_partner(k["id"], credit_limit=28000)
    a.put(f"/partners/{k['id']}/prices", {"items": [{"product_id": p["id"], "price": 900}]})
    posted("opening", "2017-01-01", k1, [L(p["id"], 100, 600)])
    pu = posted("purchase", "2017-01-05", k1, [L(p["id"], 1, unit="Thùng")], s["id"])
    eq((pu["lines"][0]["unit_price"], pu["lines"][0].get("tax_amount"), pu["total_amount"]), (14400, 1440, 15840), "purchase: 600x24, tax 10%")
    d = draft("sale", "2017-01-10", k1, [L(p["id"], 1, unit="Thùng"), L(p["id"], 2, 550),
                                          {"product_code": "DV", "description": "Chiết khấu", "qty": 1, "unit_price": -1000, "vat_rate": 10}], k["id"])
    eq([l["unit_price"] for l in d["lines"]], [21600, 550, -1000], "prices")
    eq([l.get("tax_amount") for l in d["lines"]], [2160, 110, -100], "taxes")
    eq((d.get("goods_amount"), d.get("tax_amount"), d["total_amount"]), (21700, 2170, 23870), "totals")
    eq([w["line_no"] for w in d.get("warnings") or []], [2], "loss warning only on the 550/Lon line")
    w = (d.get("warnings") or [{}])[0]
    eq(w.get("cost_price"), 600, "cost_price per selected unit (Lon)")
    r = post_doc(d)
    if expect_err(r, 409, "CREDIT_WARNING", "credit + loss"):
        cr = r.details["credit"]
        eq((cr["receivable"], cr["document_amount"], cr["total_after"], cr["over"]), (5000, 23870, 28870, 870), "credit figures with tax")
        eq(sorted(r.details["confirm"]), ["confirm_credit", "confirm_loss"], "both flags")
    r = a.post(f"/documents/{d['id']}/post", {"version": d["version"], "confirm_loss": True, "confirm_credit": True})
    eq(r.status, 200, "posted with both confirmations")
    eq(stock_of(p["id"], as_of="2017-01-10")[1], 98, "stock 100 + 24 - 24 - 2")
    eq(debt_closing(k["id"]), 28870, "receivable")
    pr = profit(group_by="document", **{"from": "2017-01-10", "to": "2017-01-10"})
    row = {x["document_id"]: x for x in pr["items"]}.get(d["id"], {})
    eq((row.get("revenue"), row.get("cost")), (21700, 15600), "profit pre-tax, base-unit average")
    # conflict-style update: ids kept, unit/vat omitted -> kept
    g = get_doc(d["id"])
    body = {k_: g[k_] for k_ in ("doc_type", "doc_date", "partner_id", "warehouse_id", "note")}
    body.update(version=g["version"], confirm_loss=True, confirm_credit=True,
                lines=[{"id": l["id"], "product_id": l["product_id"], "qty": l["qty"], "unit_price": l["unit_price"],
                        "description": l["description"]} for l in g["lines"]])
    r = a.put(f"/documents/{d['id']}", body)
    eq(r.status, 200, "re-save with ids, no unit / vat fields")
    if r.status == 200:
        eq([(l["unit"], l.get("vat_rate")) for l in r.json["lines"]], [("Thùng", 10), ("Lon", 10), ("", 10)], "unit and vat kept")
        eq(r.json["total_amount"], 23870, "total kept")
    # export shows the selected unit and tax totals
    txt = file_text(a.get(f"/documents/{d['id']}/export", format="xlsx").content)
    check("Thùng" in txt and "Tổng thanh toán" in txt, "export: unit + totals")


@test("C9", "test_X_import_opening_stock_then_stocktake")
def _():
    a = admin()
    p = mk_product(sale=10, purchase=7)
    r = upload(a, "opening_stock", xlsx_bytes(["Mã hàng", "Mã kho", "Số lượng"], [[p["code"], "KHO3", 10]]), dry=False, date="2017-02-01")
    eq(r.status, 200, "import opening stock")
    for dd in (r.json or {}).get("documents") or []:
        eq(post_doc(get_doc(dd["id"])).status, 200, "post imported opening")
    k3 = wh("KHO3")
    load = a.ok("GET", "/documents/stocktake-load", params={"warehouse_id": k3, "date": "2017-02-02"})["items"]
    row = [x for x in load if x["product_id"] == p["id"]]
    eq(row[0]["book_qty"] if row else None, 10, "load shows the imported stock")
    st = a.ok("POST", "/documents", {"doc_type": "stocktake", "doc_date": "2017-02-02", "warehouse_id": k3, "lines": [L(p["id"], 8)]})
    eq(post_doc(st).status, 200, "post stocktake")
    eq(stock_of(p["id"], as_of="2017-02-02")[0].get(k3), 8, "stock 8")
