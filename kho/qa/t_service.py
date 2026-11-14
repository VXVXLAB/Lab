"""D. Mã dịch vụ DV / DICHVU: REQ-047..051, 083 + customer slip example"""
from lib import *

_slip = {}


def slip_products():
    if not _slip:
        for code, name, unit, price in [("4CA200A5", "Súng hàn CO2 200A-5.0M (EU)", "Bộ", 600000),
                                        ("CN249SS08", "Béc CO2 Sunshine 0.8 mm", "Cái", 13000),
                                        ("CN249SS10", "Béc CO2 Sunshine 1.0 mm", "Cái", 13000),
                                        ("COS10", "Đầu cos (khoen đồng) 10mm (50c/bao)", "Cái", 6000),
                                        ("K701832", "Que hàn Kiswel K7018-3.2 (20kg)", "Thùng", 1090000)]:
            _slip[code] = mk_product(code=code, name=name, unit=unit, sale=price, purchase=int(price * 0.8))
        s = mk_partner(supp=True)
        posted("purchase", "2026-07-01", wh("KHO1"), [L(p["id"], 1000, p["purchase_price"]) for p in _slip.values()], s["id"])
    return _slip


def slip_lines():
    P = slip_products()
    return [{"product_code": "4CA200A5", "qty": 1}, {"product_code": "CN249SS08", "qty": 50},
            {"product_code": "CN249SS10", "qty": 50}, {"product_code": "COS10", "qty": 100},
            {"product_code": "K701832", "qty": 1},
            {"product_code": "DICHVU", "description": "TRẢ 01 ĐỒNG HỒ", "qty": 1},
            {"product_code": "DICHVU", "description": "PHÍ SỬA XE", "qty": 1, "unit_price": 400000}]


def check_slip(doc, label):
    eq(doc["total_amount"], 3990000, f"{label}: Cộng 3.990.000")
    eq(doc["old_debt"], 2000000, f"{label}: Nợ cũ 2.000.000")
    eq(doc["total_debt"], 5990000, f"{label}: Tổng nợ 5.990.000")
    ls = doc["lines"]
    eq(len(ls), 7, f"{label}: 7 lines")
    if len(ls) == 7:
        eq([l["product_code"] for l in ls], ["4CA200A5", "CN249SS08", "CN249SS10", "COS10", "K701832", "DV", "DV"], f"{label}: codes")
        eq([num(l["amount"]) for l in ls], [600000, 650000, 650000, 600000, 1090000, 0, 400000], f"{label}: amounts")
        eq(ls[5]["unit_price"], None, f"{label}: note-only service line has empty price")
        eq(ls[5]["description"], "TRẢ 01 ĐỒNG HỒ", f"{label}: free text kept")
        eq(ls[5]["qty"], 1, f"{label}: qty 1,0")
        eq(ls[6]["description"], "PHÍ SỬA XE", f"{label}: service text")


@test("006,047,048,049,051,083,034,073,071,072", "test_REQ047_083_customer_sale_slip_example")
def _():
    a = admin()
    k1 = wh("KHO1")
    P = slip_products()
    stock_before = {c: stock_of(p["id"])[1] for c, p in P.items()}
    # variant 1: old debt declared as opening receivable
    c = mk_partner(name="Xưởng cơ khí Thành Công", cust=True, rec=2000000)
    d = draft("sale", "2026-09-25", k1, slip_lines(), c["id"])
    check_slip(d, "draft")
    r = post_doc(d)
    eq(r.status, 200, "post slip")
    doc = r.json
    check_slip(doc, "posted")
    eq(debt_closing(c["id"]), 5990000, "debt ledger 5.990.000")
    for code, p in P.items():
        qty = {"4CA200A5": 1, "CN249SS08": 50, "CN249SS10": 50, "COS10": 100, "K701832": 1}[code]
        eq(stock_of(p["id"])[1], stock_before[code] - qty, f"stock {code}")
    # DV not in stock reports
    dv = a.ok("GET", "/products/lookup", params={"code": "DICHVU"})
    eq(dv["code"], "DV", "DICHVU -> DV")
    ss = stock_summary(only_with_data="false")
    check(all(i["product_id"] != dv["id"] for i in ss["items"]), "DV not in stock summary")
    nx = a.ok("GET", "/reports/stock-nxt", params={"from": "2026-01-01", "to": "2026-12-31"})
    check(all(i["product_id"] != dv["id"] for i in nx["items"]), "DV not in NXT")
    # variant 2: old debt from a real sale on 10/08/2026
    c2 = mk_partner(name="Khách nợ cũ 10/8", cust=True)
    posted("sale", "2026-08-10", k1, [{"product_code": "K701832", "qty": 2, "unit_price": 1000000}], c2["id"])
    d2 = posted("sale", "2026-09-25", k1, slip_lines(), c2["id"])
    check_slip(d2, "variant old sale 10/08")
    dl = debt_ledger(c2["id"])
    eq(dl["closing"], 5990000, "variant 2 ledger closing")
    eq([num(x["balance"]) for x in dl["rows"]], [2000000, 5990000], "variant 2 balances")
    # sales report: service rows and totals
    sr = a.ok("GET", "/reports/sales", params={"from": "2026-09-25", "to": "2026-09-25", "partner_id": c["id"]})
    eq(sr["total_amount"], 3990000, "sales report total incl. service"); eq(sr["total_qty"], 202, "sales report qty excludes service")
    # exports
    for fmt in ("xlsx", "docx"):
        r = a.get(f"/documents/{doc['id']}/export", format=fmt)
        eq(r.status, 200, f"export {fmt}")
        cd = r.headers.get("Content-Disposition", "")
        check(doc["doc_no"] in cd, f"{fmt} filename has doc_no: {cd}")
        if fmt == "xlsx":
            wb = xlsx_basic_checks(r.content, "slip.xlsx")
            if not wb:
                continue
            txt = xlsx_text(wb)
            for t in ["PHIẾU XUẤT KHO BÁN HÀNG", "Xưởng cơ khí Thành Công", "Súng hàn CO2 200A-5.0M (EU)", "TRẢ 01 ĐỒNG HỒ", "PHÍ SỬA XE",
                      "Đầu cos (khoen đồng) 10mm (50c/bao)", "Nợ cũ", "Tổng nợ", "STT", "Mã hàng", "Tên hàng", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền", doc["doc_no"]]:
                check(t in txt, f"slip xlsx contains {t!r}")
            ws = wb.worksheets[0]
            row = xlsx_find_row(ws, "K701832")
            if check(row, "K701832 row"):
                ns = [c.value for c in row if c.data_type == "n"]
                check(1090000 in ns, f"amount numeric cell: {[c.value for c in row]}")
            row = xlsx_find_row(ws, "TRẢ 01 ĐỒNG HỒ")
            if check(row, "service note row"):
                vals = [c.value for c in row]
                check(not any(isinstance(v, (int, float)) and v != 0 and v not in (1, 6) for v in vals), f"note row: price/amount empty: {vals}")
            # total: numeric or SUM formula with cached value
            tot = xlsx_find_row(ws, "Cộng")
            if check(tot, "Cộng row"):
                vals = [c.value for c in tot if c.value not in (None, "", "Cộng")]
                ok = 3990000 in vals
                fv = [v for v in vals if isinstance(v, str) and v.startswith("=")]
                if fv:
                    wbv = open_xlsx_values(r.content)
                    cached = [c.value for c in xlsx_find_row(wbv.worksheets[0], "Cộng") if c.value not in (None, "", "Cộng")]
                    check(3990000 in cached, f"Cộng is formula {fv} whose cached result is not a number (cached={cached!r}; cell t=\"str\") – viewers that don't recalc show text")
                    ok = True
                check(ok, f"Cộng value 3.990.000: {vals}")
            # old debt / total debt numeric?
            nums = [v for (_, _, _, v, t) in xlsx_cells(wb) if t == "n"]
            check(2000000 in nums, "Nợ cũ 2.000.000 is a numeric cell (editable number), not text")
            # Tổng nợ may be a formula (Nợ cũ + Cộng) so it follows edits; its cached value must be a number.
            # (Controller decision after QA finding B5.)
            cached_nums = [v for (_, _, _, v, t) in xlsx_cells(open_xlsx_values(r.content)) if t == "n"]
            check(5990000 in nums or 5990000 in cached_nums, "Tổng nợ 5.990.000 is a numeric cell or a formula with numeric cached value, not text")
            check("2.000.000" in txt or 2000000 in nums, "Nợ cũ value present")
            check("5.990.000" in txt or 5990000 in nums or 5990000 in cached_nums, "Tổng nợ value present")
        else:
            dd = docx_basic_checks(r.content, "slip.docx")
            if not dd:
                continue
            check(len(dd.tables) >= 1, "docx has a real table")
            txt = docx_text(dd)
            for t in ["PHIẾU XUẤT KHO BÁN HÀNG", "Súng hàn CO2 200A-5.0M (EU)", "TRẢ 01 ĐỒNG HỒ", "PHÍ SỬA XE", "3.990.000", "2.000.000", "5.990.000", "Nợ cũ", "Tổng nợ"]:
                check(t in txt, f"slip docx contains {t!r}")
            # table row for K701832 contains its amount
            found = False
            for t in dd.tables:
                for row in t.rows:
                    cells = [c.text.strip() for c in row.cells]
                    if "K701832" in cells:
                        found = True
                        check("1.090.000" in cells, f"docx K701832 row amount: {cells}")
            check(found, "docx table row K701832")
            # editable: add a row and save
            import io as _io
            t = dd.tables[0]
            t.add_row()
            buf = _io.BytesIO(); dd.save(buf)
            check(len(buf.getvalue()) > 0, "docx can be edited & saved")


@test("047,048,049,050,051,006,083", "test_REQ049_050_service_plus_minus_debt_no_stock")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    p = mk_product(sale=100000, purchase=80000)
    posted("opening", "2026-01-01", k1, [L(p["id"], 10, 80000)])
    c = mk_partner(cust=True); s = mk_partner(supp=True)
    for code in ("DV", "dv", "DICHVU", "dichvu", "Dịch vụ", "dịch vụ"):
        r = a.get("/products/lookup", code=code)
        check(r.status == 200 and r.json.get("code") == "DV", f"lookup {code!r} -> DV: {r.short()[:150]}")
    d = posted("sale", "2026-02-01", k1, [L(p["id"], 2), {"product_code": "DV", "description": "Phí vận chuyển", "unit_price": 50000},
                                         {"product_code": "dichvu", "description": "Chiết khấu 5%", "unit_price": -10000},
                                         {"product_code": "DV", "description": "Phí lắp đặt 3 giờ", "qty": 3, "unit_price": 20000}], c["id"])
    eq(d["total_amount"], 200000 + 50000 - 10000 + 60000, "total with + and - service")
    eq(debt_closing(c["id"]), 300000, "debt includes service amounts")
    eq(stock_of(p["id"])[1], 8, "stock only for goods")
    # service in purchase increases payable, not stock
    posted("purchase", "2026-02-02", k1, [L(p["id"], 1, 80000), {"product_code": "DV", "description": "Cước xe", "unit_price": 30000}], s["id"])
    eq(debt_closing(s["id"], "payable"), 110000, "payable incl. service")
    # service-only sale posts without stock
    d = posted("sale", "2026-02-03", k1, [{"product_code": "DV", "description": "Phí sửa máy", "unit_price": 150000}], c["id"])
    eq(debt_closing(c["id"]), 450000, "service-only sale debt")
    # service-only credit (negative) reduces debt
    d = draft("sale", "2026-02-04", k1, [{"product_code": "DV", "description": "Giảm trừ công nợ", "unit_price": -50000}], c["id"])
    r = post_doc(d)
    check(r.status in (200, 400), f"negative-total service sale: {r.short()[:200]}")
    if r.status == 200:
        eq(debt_closing(c["id"]), 400000, "negative service lowers debt")
    # service never in transfer/opening
    r = create_doc("transfer", "2026-02-05", k1, [{"product_code": "DV", "description": "x", "qty": 1}], to_wh=k2)
    eq(r.status, 400, "service in transfer -> 400")
    r = create_doc("opening", "2026-02-05", k1, [{"product_code": "DV", "description": "x", "unit_price": 1}])
    eq(r.status, 400, "service in opening -> 400")
    # service via product_id with description, qty default 1
    dv = a.ok("GET", "/products/lookup", params={"code": "DV"})
    dr = draft("sale", "2026-02-05", k1, [{"product_id": dv["id"], "description": "Ghi chú: giao trước 9h"}], c["id"])
    eq(dr["lines"][0]["qty"], 1, "service qty default 1"); eq(dr["lines"][0]["amount"], 0, "note line amount 0")
    eq(dr["total_amount"], 0, "note-only total 0")
    # DV not deletable, DICHVU reserved
    r = a.delete(f"/products/{dv['id']}")
    check(r.status in (400, 409), f"DV cannot be deleted: {r.short()[:150]}")
    r = a.post("/products", {"code": "DICHVU", "name": "x", "unit": "Cái"})
    eq(r.status, 400, "DICHVU code reserved")
    # stock ledger of DV
    r = a.get("/reports/stock-ledger", product_id=dv["id"])
    check(r.status in (200, 400), f"stock-ledger of service: {r.short()[:150]}")
    if r.status == 200:
        eq(len(r.json["rows"]), 0, "service has no NXT rows")
    # service on a loss-free slip next to goods sold below cost: only goods flagged
    d = draft("sale", "2026-02-06", k1, [L(p["id"], 1, 70000), {"product_code": "DV", "description": "Giảm giá", "unit_price": -99999}], c["id"])
    lw = [w for w in d["warnings"] if w["type"] == "loss"]
    eq([w["line_no"] for w in lw], [1], "only goods line flagged as loss")
    # dashboard / revenue counts service
