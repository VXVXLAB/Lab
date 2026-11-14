"""F. Báo cáo, mở chi tiết, xuất Excel/Word: REQ-063..075, 086, 087"""
from lib import *

TITLES = {"sale": "PHIẾU XUẤT KHO BÁN HÀNG", "purchase": "PHIẾU NHẬP KHO MUA HÀNG",
          "sale_return": "PHIẾU NHẬP HÀNG BÁN BỊ TRẢ LẠI", "purchase_return": "PHIẾU XUẤT TRẢ HÀNG NHÀ CUNG CẤP",
          "transfer": "PHIẾU CHUYỂN KHO NỘI BỘ", "opening": "PHIẾU NHẬP TỒN ĐẦU KỲ"}


@test("071,072,073,074,087,008", "test_REQ071_074_document_exports_every_type")
def _():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    p = mk_product(name="Kìm hàn 500A – loại tốt", unit="Cái", sale=150000, purchase=100000)
    c = mk_partner(name="Cửa hàng Ngọc Ánh", cust=True); s = mk_partner(name="Nhà phân phối Đức Thành", supp=True)
    docs = {
        "opening": posted("opening", "2026-01-02", k1, [L(p["id"], 50, 100000)]),
        "purchase": posted("purchase", "2026-01-03", k1, [L(p["id"], 20, 100000), L(p["id"], 0.5, 100001)], s["id"], note="Ghi chú nhập"),
        "sale": posted("sale", "2026-01-04", k1, [L(p["id"], 7, 150000)], c["id"]),
        "sale_return": posted("sale_return", "2026-01-05", k1, [L(p["id"], 1, 150000)], c["id"]),
        "purchase_return": posted("purchase_return", "2026-01-06", k1, [L(p["id"], 2, 100000)], s["id"]),
        "transfer": posted("transfer", "2026-01-07", k1, [L(p["id"], 3)], to_wh=k2),
    }
    eq(docs["purchase"]["lines"][1]["amount"], 50001, "0.5 x 100001 = 50000.5 rounds half-up to 50001")
    for t, d in docs.items():
        for fmt in ("xlsx", "docx"):
            r = a.get(f"/documents/{d['id']}/export", format=fmt)
            if not eq(r.status, 200, f"{t} {fmt} export"):
                continue
            ct = r.headers.get("Content-Type", "")
            check(("spreadsheet" in ct) if fmt == "xlsx" else ("wordprocessing" in ct), f"{t} {fmt} content-type {ct}")
            check(f'{d["doc_no"]}.{fmt}' in r.headers.get("Content-Disposition", ""), f"{t} {fmt} filename")
            if fmt == "xlsx":
                wb = xlsx_basic_checks(r.content, f"{t}.xlsx")
                if not wb:
                    continue
                txt = xlsx_text(wb)
                ws = wb.worksheets[0]
                row = xlsx_find_row(ws, p["code"])
                if check(row, f"{t}.xlsx product row"):
                    nums = [c.value for c in row if c.data_type == "n"]
                    check(num(d["lines"][0]["qty"]) in [num(x) for x in nums], f"{t}.xlsx qty numeric {[c.value for c in row]}")
                    if d["lines"][0]["unit_price"] is not None:
                        check(num(d["lines"][0]["amount"]) in [num(x) for x in nums], f"{t}.xlsx amount numeric")
                # editable: insert a row/column and save
                ws.insert_rows(3); ws.insert_cols(2)
                buf = io.BytesIO(); wb.save(buf)
                check(open_xlsx(buf.getvalue()) is not None, f"{t}.xlsx editable & re-savable")
            else:
                dd = docx_basic_checks(r.content, f"{t}.docx")
                if not dd:
                    continue
                txt = docx_text(dd)
                check(len(dd.tables) >= 1, f"{t}.docx has table")
            check(TITLES[t] in txt, f"{t} {fmt} title {TITLES[t]}")
            check("Kìm hàn 500A – loại tốt" in txt, f"{t} {fmt} Vietnamese product name intact")
            check(d["doc_no"] in txt, f"{t} {fmt} contains doc_no")
            if d["partner_id"]:
                check(d["partner_name"] in txt, f"{t} {fmt} contains partner name")
            if t == "transfer":
                check("Kho 1" in txt or "KHO1" in txt, f"transfer {fmt} shows source warehouse")
                check("Kho 2" in txt or "KHO2" in txt, f"transfer {fmt} shows destination warehouse")
            if t == "purchase" and fmt == "xlsx":
                vals = [v for (_, _, _, v, ty) in xlsx_cells(wb) if ty == "n"]
                check(any(abs(float(v) - 0.5) < 1e-9 for v in vals), "decimal qty 0.5 exported as number")
    # draft export: title + filename
    d = draft("sale", "2026-01-08", k1, [L(p["id"], 999)], c["id"])
    for fmt in ("xlsx", "docx"):
        r = a.get(f"/documents/{d['id']}/export", format=fmt)
        eq(r.status, 200, f"draft {fmt}")
        txt = xlsx_text(open_xlsx(r.content)) if fmt == "xlsx" else docx_text(open_docx(r.content))
        check("PHIẾU TẠM (chưa ghi sổ)" in txt, f"draft {fmt} title")
        check(f"PHIEU_TAM_{d['draft_no']}.{fmt}" in r.headers.get("Content-Disposition", ""), f"draft filename {r.headers.get('Content-Disposition')}")
    # unposted doc that already had an official number -> must show as PHIẾU TẠM again
    sd = docs["sale"]
    u = a.ok("POST", f"/documents/{sd['id']}/unpost", {"version": sd["version"]})
    r = a.get(f"/documents/{sd['id']}/export", format="xlsx")
    txt = xlsx_text(open_xlsx(r.content))
    check("PHIẾU TẠM (chưa ghi sổ)" in txt and TITLES["sale"] not in txt, "unposted doc exported as PHIẾU TẠM")
    post_doc(u, True)
    r = a.get(f"/documents/{sd['id']}/export", format="pdf")
    check(r.status == 400, f"unsupported format -> 400: {r.status}")


@test("056,057,058,059,071,073,087", "test_REQ087_voucher_exports")
def _():
    a = admin()
    c = mk_partner(name="Anh Tuấn Đạt", cust=True, rec=5000000)
    tm = mk_account("cash"); nh = mk_account("bank")
    titles = {("receipt", "cash"): "PHIẾU THU", ("payment", "cash"): "PHIẾU CHI",
              ("receipt", "bank"): "GIẤY BÁO CÓ", ("payment", "bank"): "GIẤY BÁO NỢ"}
    for (vt, kind), title in titles.items():
        acc = tm if kind == "cash" else nh
        r = mk_voucher(vt, acc["id"], c["id"], [{"description": "Dòng một – thu nợ", "amount": 1234567},
                                                {"description": "Dòng hai", "amount": 1000}], date="2026-05-05")
        if not eq(r.status, 201, f"create {vt}/{kind}"):
            continue
        v = r.json
        for fmt in ("xlsx", "docx"):
            e = a.get(f"/vouchers/{v['id']}/export", format=fmt)
            if not eq(e.status, 200, f"{title} {fmt}"):
                continue
            if fmt == "xlsx":
                wb = xlsx_basic_checks(e.content, f"{title}.xlsx")
                if not wb:
                    continue
                txt = xlsx_text(wb)
                nums = [v_ for (_, _, _, v_, ty) in xlsx_cells(wb) if ty == "n"]
                check(1234567 in nums, f"{title}.xlsx amount numeric")
            else:
                dd = docx_basic_checks(e.content, f"{title}.docx")
                if not dd:
                    continue
                txt = docx_text(dd)
                check(dd.tables, f"{title}.docx table")
                check("1.234.567" in txt, f"{title}.docx amount formatted")
            check(title in txt, f"{fmt} title {title}")
            check("Dòng một – thu nợ" in txt and "Anh Tuấn Đạt" in txt, f"{title} {fmt} Vietnamese text")
            check(v["voucher_no"] in txt, f"{title} {fmt} voucher no")


def _reports_list(pid, partner, acc):
    rng = {"from": "2026-01-01", "to": "2026-12-31"}
    return [("stock-summary", {}), ("stock-summary", {"only_with_data": "false"}), ("stock-nxt", rng),
            ("stock-ledger", {"product_id": pid, **rng}), ("sales", rng), ("purchases", rng),
            ("debt-summary", {"side": "receivable"}), ("debt-summary", {"side": "payable"}),
            ("debt-ledger", {"partner_id": partner, "side": "receivable"}), ("cash-book", {"account_id": acc}),
            ("draft-demand", {})]


@test("063,064,065,066,067,087,008", "test_REQ063_067_087_report_exports")
def _():
    a = admin()
    k1 = wh("KHO1")
    p = mk_product(name="Dây cáp hàn 35mm² – Việt Nam", unit="Mét", sale=50000, purchase=40000)
    c = mk_partner(name="Khách hàng Thiện Phúc", cust=True)
    s = mk_partner(supp=True)
    acc = mk_account("cash", 1000000)
    posted("purchase", "2026-05-01", k1, [L(p["id"], 123, 40000)], s["id"])
    sale = posted("sale", "2026-05-02", k1, [L(p["id"], 12.5, 50000)], c["id"])
    mk_voucher("receipt", acc["id"], c["id"], [{"description": "Thu tiền dây cáp", "amount": 250000}], date="2026-05-03")
    draft("sale", "2026-05-04", k1, [L(p["id"], 500)], c["id"])
    for name, params in _reports_list(p["id"], c["id"], acc["id"]):
        js = a.get("/reports/" + name, **params)
        eq(js.status, 200, f"{name} json")
        for fmt in ("xlsx", "docx"):
            r = a.get("/reports/" + name, format=fmt, **params)
            label = f"{name}{params}.{fmt}"
            if not eq(r.status, 200, label):
                continue
            check(r.headers.get("Content-Disposition", "").startswith("attachment"), f"{label} attachment")
            if fmt == "xlsx":
                wb = xlsx_basic_checks(r.content, label)
                if not wb:
                    continue
                txt = xlsx_text(wb)
                ncount = sum(1 for (_, _, _, v, t) in xlsx_cells(wb) if t == "n")
                check(ncount > 0, f"{label} has numeric cells")
                strs_with_digits = [v for (_, _, _, v, t) in xlsx_cells(wb) if t == "s" and isinstance(v, str) and v.replace(".", "").replace(",", "").replace("-", "").isdigit() and len(v) > 3]
                check(not strs_with_digits, f"{label}: numbers stored as text {strs_with_digits[:5]}")
            else:
                dd = docx_basic_checks(r.content, label)
                if not dd:
                    continue
                txt = docx_text(dd)
                check(len(dd.tables) >= 1, f"{label} has table")
            if name in ("stock-summary", "stock-nxt", "stock-ledger", "sales", "purchases", "draft-demand"):
                check(p["code"] in txt, f"{label} contains product code")
            if name == "stock-ledger" or name.startswith("stock-summary"):
                check("Dây cáp hàn 35mm² – Việt Nam" in txt or name == "stock-ledger", f"{label} Vietnamese name")
            if name in ("sales", "debt-ledger"):
                check(sale["doc_no"] in txt, f"{label} contains {sale['doc_no']}")
            if name == "debt-summary" and params["side"] == "receivable":
                check("Khách hàng Thiện Phúc" in txt, f"{label} contains customer")
            if name == "cash-book":
                check("Thu tiền dây cáp" in txt, f"{label} contains voucher line")
    # sales report xlsx: 12.5 qty numeric
    r = a.get("/reports/sales", format="xlsx", partner_id=c["id"], **{"from": "2026-05-01", "to": "2026-05-31"})
    wb = open_xlsx(r.content)
    nums = [v for (_, _, _, v, t) in xlsx_cells(wb) if t == "n"]
    check(12.5 in nums and 625000 in nums, f"sales xlsx qty 12.5 & amount 625000 numeric: {nums[:20]}")
    # purchases report JSON
    pr = a.ok("GET", "/reports/purchases", params={"from": "2026-05-01", "to": "2026-05-31", "partner_id": s["id"]})
    eq(pr["total_amount"], 4920000, "purchases report total"); eq(pr["rows"][0]["document_id"], get_doc(pr["rows"][0]["document_id"])["id"], "purchase drill")


@test("068,069,070,086,010,053,055", "test_REQ086_every_drilldown_id_opens_right_record")
def _():
    """Runs over the WHOLE database (all data created by previous tests)."""
    a = admin()
    rng = {"from": "2000-01-01", "to": "2030-12-31"}
    doc_cache = {}

    def doc(i):
        if i not in doc_cache:
            r = a.get(f"/documents/{i}")
            doc_cache[i] = r.json if r.status == 200 else None
        return doc_cache[i]

    ss = stock_summary(only_with_data="false")
    nx = {i["product_id"]: i for i in a.ok("GET", "/reports/stock-nxt", params=rng)["items"]}
    checked = 0
    for it in ss["items"]:
        lg = ledger(it["product_id"])
        eq(lg["product"]["id"], it["product_id"], "stock row -> ledger of same product")
        eq(lg["closing"], it["total"], f"{it['code']}: stock-summary total = ledger closing")
        s = sum(num(v) for v in it["by_warehouse"].values())
        eq(it["total"], s, f"{it['code']}: total = sum of 4 warehouses")
        if it["product_id"] in nx:
            eq(nx[it["product_id"]]["closing"], it["total"], f"{it['code']}: NXT closing = stock total")
        elif num(it["total"]) != 0:
            fail(f"{it['code']} has stock but missing from NXT")
        for w, q in it["by_warehouse"].items():
            if num(q) != 0 or checked < 40:
                lw = ledger(it["product_id"], warehouse_id=int(w))
                eq(lw["closing"], q, f"{it['code']} wh {w}: by_warehouse = per-warehouse ledger closing")
        for r in lg["rows"]:
            d = doc(r["document_id"])
            if not check(d is not None, f"ledger row document {r['document_id']} opens"):
                continue
            eq(d["doc_no"], r["doc_no"], "ledger row doc_no"); eq(d["doc_date"], r["date"], "ledger row date")
            eq(d["status"], "posted", "ledger only has posted docs")
            check(any(l["product_id"] == it["product_id"] for l in d["lines"]), "doc has the product")
            if d["partner_name"]:
                check(d["partner_name"] in r["description"], f"description names partner: {r['description']}")
        checked += 1
    for kind in ("sales", "purchases"):
        rep = a.ok("GET", f"/reports/{kind}", params={**rng, "include_returns": "true"})
        for r in rep["rows"]:
            d = doc(r["document_id"])
            if not check(d is not None, f"{kind} row opens"):
                continue
            eq(d["doc_no"], r["doc_no"], f"{kind} doc_no"); eq(d["partner_id"], r["partner_id"], f"{kind} partner")
            ln = [l for l in d["lines"] if l["line_no"] == r["line_no"]]
            if check(ln, f"{kind} line_no exists"):
                eq(abs(num(ln[0]["amount"])), abs(num(r["amount"])), f"{kind} {r['doc_no']} line amount")
        eq(rep["total_amount"], sum(num(r["amount"]) for r in rep["rows"]), f"{kind} total_amount")
    for side in ("receivable", "payable"):
        ds = a.ok("GET", "/reports/debt-summary", params={"side": side})
        for it in ds["items"]:
            dl = debt_ledger(it["partner_id"], side)
            eq(dl["partner"]["id"], it["partner_id"], "debt row -> ledger of same partner")
            eq(dl["closing"], it["closing"], f"{side} {it['partner_code']}: summary = ledger")
            for r in dl["rows"]:
                if r["document_id"]:
                    d = doc(r["document_id"])
                    if check(d, "debt doc opens"):
                        eq(d["doc_no"], r["ref_no"], "debt doc ref"); eq(d["partner_id"], it["partner_id"], "debt doc partner")
                        eq(d["status"], "posted", "debt only posted docs")
                else:
                    v = a.get(f"/vouchers/{r['voucher_id']}")
                    if check(v.status == 200, "debt voucher opens"):
                        eq(v.json["voucher_no"], r["ref_no"], "voucher ref"); eq(v.json["partner_id"], it["partner_id"], "voucher partner")
                        eq(v.json["total_amount"], max(num(r["increase"]), num(r["decrease"])), "voucher amount")
    cb = a.ok("GET", "/reports/cash-book", params={})
    for r in cb["rows"]:
        v = a.get(f"/vouchers/{r['voucher_id']}")
        if check(v.status == 200, "cash voucher opens"):
            eq(v.json["voucher_no"], r["voucher_no"], "cash voucher no")
            ln = [l for l in v.json["lines"] if l["line_no"] == r["line_no"]]
            if check(ln, "cash line exists"):
                eq(ln[0]["amount"], num(r["receipt"]) + num(r["payment"]), "cash line amount")
    dd = a.ok("GET", "/reports/draft-demand")
    for it in dd["items"]:
        tot = 0
        for x in it["drafts"]:
            d = doc(x["document_id"])
            if check(d, "draft-demand doc opens"):
                eq(d["status"], "draft", "demand only from drafts"); eq(d["doc_type"], "sale", "demand only from sale drafts")
                tot += sum(num(l["qty"]) for l in d["lines"] if l["product_id"] == it["product_id"])
        eq(it["qty_in_drafts"], tot, f"draft-demand {it['product_code']} qty = sum of draft lines")
        eq(it["shortage"], max(0, num(it["qty_in_drafts"]) - num(it["total_stock"])), "shortage formula")
