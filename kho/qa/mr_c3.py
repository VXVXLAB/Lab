"""C3 — Excel import (SPEC_MO_RONG C3, API §8.4, §9.1/9.2, QUYET_DINH N12, N13, O7)."""
import re
import unicodedata
import zipfile

from mr_lib import *

PH = ["Mã hàng", "Tên hàng", "ĐVT", "Nhóm VTHH", "Giá bán", "Giá mua"]


def prod_by_code(code):
    r = admin().get("/products/lookup", code=code)
    return r.json if r.status == 200 else None


def imp(kind, header, rows, dry=True, c=None, date=None, **kw):
    return upload(c or admin(), kind, xlsx_bytes(header, rows, **kw), dry=dry, date=date)


def with_cached_formula(content, cell, cached):
    """openpyxl writes formulas without cached values; inject <v>cached</v> like Excel would"""
    zin = zipfile.ZipFile(io.BytesIO(content))
    bio = io.BytesIO()
    zout = zipfile.ZipFile(bio, "w", zipfile.ZIP_DEFLATED)
    for n in zin.namelist():
        data = zin.read(n)
        if n.startswith("xl/worksheets/sheet"):
            s = data.decode()
            s = re.sub(r'(<c r="%s"[^>]*>)(<f>[^<]*</f>)(<v\s*/>|<v></v>)?' % cell, lambda m: m.group(1) + m.group(2) + f"<v>{cached}</v>", s)
            data = s.encode()
        zout.writestr(n, data)
    zout.close()
    return bio.getvalue()


@test("C3", "test_C3_templates_round_trip")
def _():
    a = admin()
    # make sure the catalog has >= 2 products / customers so templates use real codes (N13)
    for _ in range(2):
        mk_product(sale=10, purchase=5)
        mk_partner(cust=True, supp=True)
    for kind, cols in [("products", ["Mã hàng", "Tên hàng", "ĐVT", "Nhóm VTHH", "Giá bán", "Giá mua", "Tồn tối thiểu"]),
                       ("partners", ["Mã đối tác", "Tên đối tác", "Là KH", "Là NCC", "Địa chỉ", "Điện thoại", "MST"]),
                       ("opening_stock", ["Mã hàng", "Mã kho", "Số lượng", "Đơn giá"]),
                       ("opening_debt", ["Mã đối tác", "Phải thu", "Phải trả"]),
                       ("partner_prices", ["Mã khách hàng", "Mã hàng", "Giá", "Ghi chú"])]:
        r = a.get(f"/import/{kind}/template")
        eq(r.status, 200, f"template {kind}")
        if r.status != 200:
            continue
        check("Mau_nhap_" + kind in (r.headers.get("Content-Disposition") or ""), f"{kind}: file name")
        wb = xlsx_basic_checks(r.content, f"template {kind}")
        if not wb:
            continue
        names = wb.sheetnames
        check("Hướng dẫn" in names, f"{kind}: has 'Hướng dẫn' sheet: {names}")
        data = [ws for ws in wb.worksheets if ws.title != "Hướng dẫn"][0]
        rows = [r_ for r_ in xlsx_rows(data) if any(v not in (None, "") for v in r_)]
        hdr = [str(v).replace("*", "").strip() for v in rows[0] if v not in (None, "")]
        eq(hdr, cols, f"{kind}: header columns")
        eq(len(rows) - 1, 2, f"{kind}: exactly 2 example rows")
        # send back unchanged -> dry-run OK, no errors
        res = upload(a, kind, r.content, dry=True, date="2026-10-01")
        eq(res.status, 200, f"{kind}: template dry-run status")
        if res.status == 200:
            eq(res.json.get("errors"), [], f"{kind}: unchanged template dry-run has no errors")
            eq(res.json.get("rows"), 2, f"{kind}: 2 rows")
            eq(res.json.get("dry_run"), True, f"{kind}: dry_run flag")


@test("C3", "test_C3_dry_run_writes_nothing")
def _():
    a = admin()
    pc = uid("DRY")
    cust = mk_partner(cust=True, rec=0)
    prod = mk_product(sale=10, purchase=5)
    n_docs = a.ok("GET", "/documents", params={"type": "opening", "page_size": 1})["total"]
    res = imp("products", PH, [[pc, "Hàng thử khô", "Cái", "Nhóm thử khô " + pc, "1.000", "500"]])
    eq(res.status, 200, "products dry")
    eq(import_result(res).get("creates"), 1, "creates=1")
    check(prod_by_code(pc) is None, "dry-run created no product")
    grp = a.ok("GET", "/product-groups", params={"q": "Nhóm thử khô " + pc})["items"]
    eq(len(grp), 0, "dry-run created no product group")
    res = imp("partners", ["Mã đối tác", "Tên đối tác", "Là KH"], [[pc, "Đối tác khô", "x"]])
    eq(res.status, 200, "partners dry")
    eq(a.ok("GET", "/partners", params={"q": pc})["total"], 0, "dry-run created no partner")
    res = imp("opening_stock", ["Mã hàng", "Mã kho", "Số lượng"], [[prod["code"], "KHO1", 5]], date="2026-10-02")
    eq(res.status, 200, "opening_stock dry")
    eq(a.ok("GET", "/documents", params={"type": "opening", "page_size": 1})["total"], n_docs, "dry-run created no opening doc")
    res = imp("opening_debt", ["Mã đối tác", "Phải thu"], [[cust["code"], 999]])
    eq(res.status, 200, "opening_debt dry")
    eq(a.ok("GET", f"/partners/{cust['id']}")["opening_receivable"], 0, "dry-run did not change opening debt")
    res = imp("partner_prices", ["Mã khách hàng", "Mã hàng", "Giá"], [[cust["code"], prod["code"], 7]])
    eq(res.status, 200, "partner_prices dry")
    eq(a.ok("GET", f"/partners/{cust['id']}/prices")["items"], [], "dry-run set no customer price")


@test("C3", "test_C3_all_or_nothing")
def _():
    a = admin()
    codes = [uid("AON") for _ in range(3)]
    rows = [[codes[0], "Hàng 1", "Cái", "", 100, 50], [codes[1], "Hàng 2", "Cái", "", "abc", 50],
            [codes[2], "Hàng 3", "Cái", "", 300, 50]]
    r = imp("products", PH, rows, dry=False)
    expect_err(r, 422, "IMPORT_INVALID", "real import with one bad row")
    res = import_result(r)
    errs = res.get("errors") or []
    check(len(errs) == 1 and errs[0].get("row") == 3 and errs[0].get("column") == "Giá bán",
          f"error points at row 3 / Giá bán: {errs}")
    for c in codes:
        check(prod_by_code(c) is None, f"nothing written ({c})")
    # opening stock with one bad row -> no draft docs
    p = mk_product(purchase=5)
    n = a.ok("GET", "/documents", params={"type": "opening", "page_size": 1})["total"]
    r = imp("opening_stock", ["Mã hàng", "Mã kho", "Số lượng"], [[p["code"], "KHO1", 5], [p["code"], "KHO2", 5], ["KHONGCO", "KHO1", 1]],
            dry=False, date="2026-10-03")
    expect_err(r, 422, "IMPORT_INVALID", "opening stock with unknown product")
    eq(a.ok("GET", "/documents", params={"type": "opening", "page_size": 1})["total"], n, "no opening drafts created")
    # opening debt with one unknown partner -> nothing changed
    c1 = mk_partner(cust=True)
    r = imp("opening_debt", ["Mã đối tác", "Phải thu"], [[c1["code"], 1000], ["KHONGCO-DT", 5]], dry=False)
    expect_err(r, 422, "IMPORT_INVALID", "opening debt with unknown partner")
    eq(a.ok("GET", f"/partners/{c1['id']}")["opening_receivable"], 0, "opening debt untouched")


@test("C3", "test_C3_vietnamese_numbers")
def _():
    cases = [("1.500.000", 1500000), ("2,5", 2.5), ("1.200.000,5", 1200000.5), ("1.500", 1500), ("1.250", 1250),
             (" 1.500.000 ", 1500000), ("1500000", 1500000), (1500000, 1500000), (2.5, 2.5), ("0", 0),
             ("1.234,567", 1234.57), ("12.345.678,90", 12345678.9), ("\u00a01.000\u00a0", 1000),
             ("1 500 000đ", 1500000), ("1.500.000 đ", 1500000)]  # currency suffix / space grouping: lenient, fine
    bad = ["150k", "abc", "1.5.0", "1,2,3", "--5", "1e3x", "NaN", "Infinity", "12.34.5", "-5", "-1.000", "1,500,000", "1.000,", "0x10",
           "2.5", "1.25", "12.5", "0.5"]  # P6: one dot + 1-2 digits in a TEXT cell -> row error
    rows, exp = [], {}
    for v, want in cases:
        c = uid("VN")
        rows.append([c, "Số kiểu Việt " + str(v), "Cái", "", v, ""])
        exp[c] = (v, want)
    badrows = {}
    for v in bad:
        c = uid("VNB")
        badrows[c] = v
    r = imp("products", PH, rows, dry=False)
    eq(r.status, 200, "import good numbers: " + errs_text(import_result(r))[:500])
    for c, (v, want) in exp.items():
        p = prod_by_code(c)
        if check(p is not None, f"{v!r} imported"):
            eq(p["sale_price"], want, f"Giá bán {v!r}")
    r = imp("products", PH, [[c, "Số sai " + v, "Cái", "", v, ""] for c, v in badrows.items()], dry=True)
    res = import_result(r)
    err_rows = {e["row"] for e in res.get("errors") or []}
    for i, (c, v) in enumerate(badrows.items()):
        check(i + 2 in err_rows, f"bad number {v!r} (row {i + 2}) must be an error; errors={errs_text(res)[:300]}")
    # quantities in opening stock
    p = mk_product(purchase=10)
    for v, want in [("2,5", 2.5), ("1.000", 1000), ("0,125", 0.125), ("1,0005", 1.001)]:
        r = imp("opening_stock", ["Mã hàng", "Mã kho", "Số lượng"], [[p["code"], "KHO1", v]], dry=True, date="2026-10-04")
        check(r.status == 200 and import_result(r).get("errors") == [], f"qty {v!r} accepted: {r.short()[:300]}")
    for v in ["0", "0,0004", "-1", "abc", "1e400", "2.5", "1.25"]:  # P6 applies to quantities too
        r = imp("opening_stock", ["Mã hàng", "Mã kho", "Số lượng"], [[p["code"], "KHO1", v]], dry=True, date="2026-10-04")
        check(r.status in (200, 400) and (import_result(r).get("errors") or r.status == 400), f"qty {v!r} rejected: {r.short()[:300]}")


@test("C3", "test_C3_ambiguous_comma_thousands")
def _():
    """'1,500,000' (English thousands) must not silently become 1.5 (or 1.5 million with a wrong decimal)."""
    c = uid("EN")
    r = imp("products", PH, [[c, "Giá kiểu Anh", "Cái", "", "1,500,000", ""]], dry=True)
    res = import_result(r)
    ok = bool(res.get("errors"))
    check(True, "ambiguous number examined")
    if not ok:
        r = imp("products", PH, [[c, "Giá kiểu Anh", "Cái", "", "1,500,000", ""]], dry=False)
        p = prod_by_code(c)
        check(p is not None and num(p["sale_price"]) == 1500000, f"'1,500,000' imported as {p and p['sale_price']} (expected error or 1500000)")


@test("C3", "test_C3_layout_blank_rows_spaces_headers")
def _():
    a = admin()
    c1, c2, c3 = uid("LAY"), uid("LAY"), uid("LAY")
    # reordered + accent-less/case-insensitive headers with '*', extra column, blank rows, spaces, title rows above,
    # guide sheet first
    header = ["gia ban", "  TEN HANG* ", "Ghi chú lạ", "ma hang*", "dvt"]
    rows = [["1.000", "  Hàng có khoảng trắng  ", "bỏ qua", f"  {c1}  ", " Cái "], [None, None, None, None, None],
            ["", "", "", "", ""], ["2.000", "Hàng 2", "", c2, "Hộp"], ["   ", "  ", None, "  ", " "], ["3.000", "Hàng 3", "", c3, "Cuộn"]]
    content = xlsx_bytes(header, rows, before=[["DANH MỤC HÀNG HÓA"], ["Công ty QA"], []], guide_first=True)
    r = upload(a, "products", content, dry=False)
    eq(r.status, 200, "layout import: " + errs_text(import_result(r))[:400])
    eq(import_result(r).get("rows"), 3, "blank rows skipped, 3 rows")
    p = prod_by_code(c1)
    if check(p is not None, "code with spaces trimmed"):
        eq(p["code"], c1, "code trimmed")
        eq(p["name"], "Hàng có khoảng trắng", "name trimmed")
        eq(p["unit"], "Cái", "unit trimmed")
        eq(p["sale_price"], 1000, "price by header, not position")
    p3 = prod_by_code(c3)
    check(p3 is not None and p3["unit"] == "Cuộn", "row after whitespace-only row imported")
    # header beyond row 30 -> error
    content = xlsx_bytes(PH, [[uid("LAY"), "x", "Cái", "", 1, 1]], before=[[f"dòng {i}"] for i in range(31)])
    r = upload(a, "products", content, dry=True)
    check(r.status == 400 or (r.status == 200 and import_result(r).get("errors")), f"header after row 30 rejected: {r.short()[:200]}")
    # missing required column Mã hàng
    r = imp("products", ["Tên hàng", "ĐVT"], [["x", "Cái"]], dry=True)
    check(r.status == 400 or (r.status == 200 and import_result(r).get("errors")), f"missing 'Mã hàng' column rejected: {r.short()[:300]}")
    if r.json:
        check(has_vietnamese(r.content.decode()), "Vietnamese message for missing column")
    # header row only, no data
    r = imp("products", PH, [], dry=True)
    check(r.status in (200, 400) and r.status < 500, f"header only -> {r.status}")
    if r.status == 200:
        eq(import_result(r).get("rows"), 0, "header only: 0 rows")
    # duplicated header column
    r = imp("products", ["Mã hàng", "Tên hàng", "ĐVT", "Giá bán", "Giá bán"], [[uid("LAY"), "x", "Cái", 1, 2]], dry=True)
    eq(r.status, 400, "duplicated header column -> 400 (P9)")
    if r.json:
        check("Giá bán" in r.json["error"]["message"], f"message names the column: {r.json['error']['message']}")


@test("C3", "test_C3_duplicates_unknowns_and_rules")
def _():
    a = admin()
    c = uid("DUP")
    r = imp("products", PH, [[c, "A", "Cái", "", 1, 1], [c.lower(), "B", "Cái", "", 1, 1], [f" {c} ", "C", "Cái", "", 1, 1]])
    res = import_result(r)
    msgs = " | ".join(e["message"] for e in res.get("errors") or [])
    check(len(res.get("errors") or []) >= 2 and "trùng" in msgs, f"duplicate codes (case/space variants) flagged: {msgs}")
    check("dòng 2" in msgs, f"message names the first row: {msgs}")
    for code in ["DV", "dichvu", "DICHVU"]:
        r = imp("products", PH, [[code, "Dịch vụ giả", "Cái", "", 1, 1]])
        check(bool(import_result(r).get("errors")), f"code {code} rejected")
    # new product without name / unit
    r = imp("products", PH, [[uid("NONAME"), "", "Cái", "", 1, 1], [uid("NOUNIT"), "Có tên", "", "", 1, 1]])
    eq(len(import_result(r).get("errors") or []), 2, "new code without name / without unit -> errors")
    # negative / absurd prices
    r = imp("products", PH, [[uid("NEG"), "Âm", "Cái", "", -1, 1], [uid("BIG"), "Lớn", "Cái", "", 1e20, 1],
                             [uid("BIG"), "Lớn 2", "Cái", "", "999.999.999.999.999.999", 1], [uid("NEG"), "Mua âm", "Cái", "", 1, "-5"]])
    eq(len(import_result(r).get("errors") or []), 4, f"negative/overflow prices -> 4 errors: {errs_text(import_result(r))[:400]}")
    r = imp("products", PH, [[uid("BIG"), "Lớn", "Cái", "", 1e20, 1]], dry=False)
    check(r.status in (400, 422), f"overflow real import -> {r.status}")
    # partners
    r = imp("partners", ["Mã đối tác", "Tên đối tác", "Là KH", "Là NCC"], [[uid("P0"), "Không cờ", "", ""], [uid("P1"), "Cờ lạ", "maybe", ""]])
    errs = import_result(r).get("errors") or []
    check(len(errs) >= 1, f"new partner without KH/NCC flag rejected: {errs}")
    for v in ["x", "X", "có", "Có", "1", "TRUE"]:
        r = imp("partners", ["Mã đối tác", "Tên đối tác", "Là KH"], [[uid("PF"), "Cờ " + v, v]])
        res = import_result(r)
        if v in ("x", "X", "có", "Có", "1"):
            eq(res.get("errors"), [], f"flag {v!r} accepted")
    # opening stock rules
    p = mk_product(purchase=10)
    svc = admin().ok("GET", "/products/lookup", params={"code": "DV"})
    w5 = a.post("/warehouses", {"code": uid("KX"), "name": "Kho ngừng", "active": False}).json
    hdr = ["Mã hàng", "Mã kho", "Số lượng", "Đơn giá"]
    for row, label in [([p["code"], "KHONGCO", 1, 1], "unknown warehouse"), (["KHONGCO", "KHO1", 1, 1], "unknown product"),
                       ([svc["code"], "KHO1", 1, 1], "service product"), ([p["code"], w5["code"], 1, 1], "inactive warehouse"),
                       ([p["code"], "KHO1", 1, -5], "negative unit price"), ([p["code"], "KHO1", "", 1], "blank qty")]:
        r = imp("opening_stock", hdr, [row], date="2026-10-05")
        check(bool(import_result(r).get("errors")), f"opening stock {label} rejected: {r.short()[:200]}")
    r = imp("opening_stock", hdr, [[p["code"], "KHO1", 1, 1], [p["code"].lower(), "kho1", 2, 1]], date="2026-10-05")
    check(bool(import_result(r).get("errors")), "duplicate product+warehouse pair (case variant) rejected")
    pi = mk_product(purchase=1)
    set_product(pi["id"], active=False)
    r = imp("opening_stock", hdr, [[pi["code"], "KHO1", 1, 1]], date="2026-10-05")
    check(bool(import_result(r).get("errors")), "inactive product rejected")
    for d in ["1999-12-31", "abc", "2101-01-01"]:
        r = imp("opening_stock", hdr, [[p["code"], "KHO1", 1, 1]], date=d)
        check(r.status == 400 or bool(import_result(r).get("errors")), f"opening stock date {d} rejected -> {r.status}")


@test("C3", "test_C3_formulas_in_cells")
def _():
    c = uid("FOR")
    content = xlsx_bytes(PH, [[c, "Công thức", "Cái", "", "=1000*2", "=500+1"]])
    content = with_cached_formula(content, "E2", 2000)
    content = with_cached_formula(content, "F2", 501)
    r = upload(admin(), "products", content, dry=False)
    eq(r.status, 200, "formula cells with cached values import: " + errs_text(import_result(r))[:300])
    p = prod_by_code(c)
    if p:
        eq(p["sale_price"], 2000, "formula cached value used for Giá bán")
        eq(p["purchase_price"], 501, "formula cached value used for Giá mua")
    # formula without cached value (file produced by a script): must not silently import 0 / formula text
    c2 = uid("FOR")
    r = imp("products", PH, [[c2, "Công thức không giá trị", "Cái", "", "=1000*2", ""]], dry=True)
    res = import_result(r)
    if not res.get("errors"):
        r = imp("products", PH, [[c2, "Công thức không giá trị", "Cái", "", "=1000*2", ""]], dry=False)
        p2 = prod_by_code(c2)
        check(p2 is None or num(p2["sale_price"]) == 2000,
              f"formula without cached value imported silently as {p2 and p2['sale_price']} (expected 2000 or an error)")


@test("C3", "test_C3_bad_files_never_500")
def _():
    a = admin()
    for label, content, fname, ctype in [
        ("text renamed .xlsx", b"day khong phai excel", "a.xlsx", XLSX_CT),
        ("empty file", b"", "a.xlsx", XLSX_CT),
        ("csv", "Mã hàng,Tên hàng\nA,B\n".encode(), "a.csv", "text/csv"),
        ("random zip", b"PK\x03\x04" + b"\x00" * 100, "a.xlsx", XLSX_CT),
        ("old xls header", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 500, "a.xls", "application/vnd.ms-excel"),
        ("png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 100, "a.png", "image/png"),
    ]:
        r = upload(a, "products", content, dry=True, filename=fname, ctype=ctype)
        check(r.status == 400 and r.code == "VALIDATION", f"{label}: expected 400 VALIDATION, got {r.short()[:200]}")
        if r.json:
            check(has_vietnamese(r.json["error"]["message"]), f"{label}: Vietnamese message")
    # docx renamed
    docx_bytes = a.get(f"/documents/{a.ok('GET', '/documents', params={'page_size': 1})['items'][0]['id']}/export", format="docx").content
    r = upload(a, "products", docx_bytes, dry=True)
    eq(r.status, 400, "docx renamed to xlsx")
    # no file field / wrong field / not multipart
    r = upload(a, "products", None, dry=True)
    eq(r.status, 400, "no file")
    r = upload(a, "products", xlsx_bytes(PH, [["A", "B", "C", "", 1, 1]]), field="tep")
    eq(r.status, 400, "wrong multipart field name")
    r = a.req("POST", "/import/products", raw=b'{"x":1}', params={"dry_run": "1"}, headers={"Content-Type": "application/json"})
    eq(r.status, 400, "JSON body instead of multipart")
    r = upload(a, "khong_co", xlsx_bytes(PH, []), dry=True)
    eq(r.status, 404, "unknown import kind")
    r = upload(a, "products", xlsx_bytes(PH, []), extra_params={"dry_run": "maybe"})
    check(r.status in (200, 400), f"dry_run=maybe -> {r.status}")
    if r.status == 200:
        check(import_result(r).get("dry_run") is True, "unrecognised dry_run must not mean 'write'")
    # > 10 MB
    big = b"PK\x03\x04" + os.urandom(10 * 1024 * 1024 + 10)
    r = upload(a, "products", big, dry=True)
    eq(r.status, 400, "file > 10 MB -> 400 (N12)")
    # only a guide sheet
    content = xlsx_bytes(None, [], sheet="Hướng dẫn")
    r = upload(a, "products", content, dry=True)
    check(r.status in (200, 400) and r.status < 500, f"only guide sheet -> {r.status}")


@test("C3", "test_C3_row_limit_and_big_file")
def _():
    import openpyxl
    a = admin()
    wb = openpyxl.Workbook(write_only=True)
    ws = wb.create_sheet("Dữ liệu")
    ws.append(PH)
    pre = uid("BIG")
    for i in range(20001):
        ws.append([f"{pre}-{i}", f"Hàng số {i}", "Cái", "", 1000 + i, 500])
    bio = io.BytesIO()
    wb.save(bio)
    t = time.time()
    r = upload(a, "products", bio.getvalue(), dry=True)
    eq(r.status, 400, "20.001 data rows -> 400")
    check(has_vietnamese((r.json or {}).get("error", {}).get("message", "")), "Vietnamese message for row limit")
    check(time.time() - t < 60, "row-limit rejection under 60 s")
    # exactly 20.000 rows dry run is accepted
    wb = openpyxl.Workbook(write_only=True)
    ws = wb.create_sheet("Dữ liệu")
    ws.append(PH)
    for i in range(20000):
        ws.append([f"{pre}-{i}", f"Hàng số {i}", "Cái", "", 1000 + i, 500])
    bio = io.BytesIO()
    wb.save(bio)
    t = time.time()
    r = upload(a, "products", bio.getvalue(), dry=True)
    eq(r.status, 200, "20.000 rows dry run accepted")
    if r.status == 200:
        eq(r.json.get("creates"), 20000, "20.000 creates")
    check(time.time() - t < 60, f"20.000 rows dry run time {time.time() - t:.1f}s")


@test("C3", "test_C3_unicode_nfc_nfd")
def _():
    a = admin()
    nfc = "Công ty Hàn Việt QA"
    nfd = unicodedata.normalize("NFD", nfc)
    c = uid("NFD")
    r = imp("partners", ["Mã đối tác", "Tên đối tác", "Là KH"], [[c, nfd, "x"]], dry=False)
    eq(r.status, 200, "NFD name import")
    p = a.ok("GET", "/partners", params={"q": c})["items"]
    if check(len(p) == 1, "partner imported"):
        check(p[0]["name"] == nfc, f"name stored NFC (NFD input normalised): {p[0]['name']!r}")
        found = a.ok("GET", "/partners", params={"q": "han viet qa"})["items"]
        check(any(x["code"] == c for x in found), "NFD-imported partner findable by 'han viet qa'")
        found = a.ok("GET", "/partners", params={"q": "Hàn Việt QA"})["items"]
        check(any(x["code"] == c for x in found), "NFD-imported partner findable by NFC 'Hàn Việt QA'")
    # NFD product code vs NFC code (same visual code) -> must be treated as the same code
    code_nfc = "HÀN" + uid("X")
    code_nfd = unicodedata.normalize("NFD", code_nfc)
    r = imp("products", PH, [[code_nfc, "A", "Cái", "", 1, 1], [code_nfd, "B", "Cái", "", 1, 1]], dry=True)
    check(bool(import_result(r).get("errors")), "NFC and NFD spellings of one code flagged as duplicates")


@test("C3", "test_C3_reimport_updates_and_blank_cells_keep")
def _():
    a = admin()
    c = uid("UPD")
    r = imp("products", PH + ["Tồn tối thiểu"], [[c, "Tên gốc", "Cái", "Nhóm A " + c, "1.000", "600", 5]], dry=False)
    eq(r.status, 200, "first import")
    p = prod_by_code(c)
    if not p:
        return
    check(p["group_name"] == "Nhóm A " + c, "group auto-created (N12)")
    eq(p.get("min_stock"), 5, "Tồn tối thiểu imported")
    r = imp("products", PH, [[c, "", "", "", "1.100", ""]], dry=True)
    res = import_result(r)
    eq((res.get("creates"), res.get("updates")), (0, 1), "dry-run: 0 creates, 1 update")
    r = imp("products", PH, [[c, "", "", "", "1.100", ""]], dry=False)
    eq(r.status, 200, "update import")
    p2 = prod_by_code(c)
    eq(p2["name"], "Tên gốc", "blank name keeps")
    eq(p2["unit"], "Cái", "blank unit keeps")
    eq(p2["sale_price"], 1100, "price updated")
    eq(p2["purchase_price"], 600, "blank purchase keeps")
    eq(p2["group_name"], "Nhóm A " + c, "blank group keeps")
    eq(p2.get("min_stock"), 5, "absent min-stock column keeps")
    # only code + one column (O7)
    r = imp("products", ["Mã hàng", "Tồn tối thiểu"], [[c, 9]], dry=False)
    eq(r.status, 200, "update with code + Tồn tối thiểu only")
    eq(prod_by_code(c).get("min_stock"), 9, "min stock updated")
    # partners: blank flags keep
    pc = uid("UPDP")
    imp("partners", ["Mã đối tác", "Tên đối tác", "Là KH", "Là NCC", "Điện thoại"], [[pc, "Đối tác gốc", "x", "x", "0909"]], dry=False)
    imp("partners", ["Mã đối tác", "Tên đối tác", "Là KH", "Là NCC", "Điện thoại"], [[pc, "", "", "", "0918"]], dry=False)
    pp = a.ok("GET", "/partners", params={"q": pc})["items"]
    if check(len(pp) == 1, "partner exists"):
        eq((pp[0]["is_customer"], pp[0]["is_supplier"]), (True, True), "blank flags keep")
        eq(pp[0]["phone"], "0918", "phone updated")
        eq(pp[0]["name"], "Đối tác gốc", "name kept")


@test("C3", "test_C3_opening_stock_import_then_post")
def _():
    a = admin()
    ps = [mk_product(purchase=100 + i) for i in range(3)]
    hdr = ["Mã hàng", "Mã kho", "Số lượng", "Đơn giá"]
    rows = [[ps[0]["code"], "KHO3", "10", "1.500"], [ps[1]["code"], "KHO3", "2,5", ""], [ps[2]["code"], "KHO4", 7, 99.999],
            [ps[0]["code"], "KHO4", 1, 0]]
    r = imp("opening_stock", hdr, rows, dry=False, date="2026-10-10")
    eq(r.status, 200, "opening stock import: " + errs_text(import_result(r))[:300])
    docs = (r.json or {}).get("documents") or []
    eq(len(docs), 2, "one draft per warehouse")
    for d in docs:
        doc = get_doc(d["id"])
        eq(doc["status"], "draft", "draft (TẠM)")
        eq(doc["doc_type"], "opening", "opening type")
        eq(doc["doc_date"], "2026-10-10", "date param used")
    allp = {}
    for d in docs:
        doc = get_doc(d["id"])
        for l in doc["lines"]:
            allp[(l["product_id"], doc["warehouse_code"])] = (num(l["qty"]), num(l["unit_price"]))
    eq(allp.get((ps[0]["id"], "KHO3")), (D(10), D(1500)), "line 1 qty/price")
    eq(allp.get((ps[1]["id"], "KHO3")), (D("2.5"), D(101)), "blank price -> default purchase price")
    eq(allp.get((ps[2]["id"], "KHO4")), (D(7), D("100.00")), "price 99.999 rounded to 2 decimals")
    eq(allp.get((ps[0]["id"], "KHO4")), (D(1), D(0)), "explicit 0 price kept")
    _, before = stock_of(ps[0]["id"])
    for d in docs:
        eq(post_doc(get_doc(d["id"])).status, 200, "post imported draft")
    byw, tot = stock_of(ps[0]["id"])
    eq(tot, 11, "stock after posting (10 KHO3 + 1 KHO4)")
    eq(byw.get(wh("KHO3")), 10, "KHO3")
    _, t1 = stock_of(ps[1]["id"])
    eq(t1, D("2.5"), "decimal qty stock")
    # default date = today
    r = imp("opening_stock", hdr, [[ps[0]["code"], "KHO2", 1, 1]], dry=False)
    if r.status == 200:
        d = get_doc(r.json["documents"][0]["id"])
        eq(d["doc_date"], a.ok("GET", "/dashboard")["today"], "default date = today")
        a.delete(f"/documents/{d['id']}")


@test("C3", "test_C3_opening_stock_split_1000_lines")
def _():
    a = admin()
    pre = uid("SPL")
    rows = [[f"{pre}-{i}", f"Hàng tách {i}", "Cái", "", 10, 5] for i in range(1001)]
    r = imp("products", PH, rows, dry=False)
    eq(r.status, 200, "1001 products imported")
    r = imp("opening_stock", ["Mã hàng", "Mã kho", "Số lượng"], [[f"{pre}-{i}", "KHO2", 1] for i in range(1001)], dry=False, date="2026-10-11")
    eq(r.status, 200, "1001-line opening stock")
    docs = (r.json or {}).get("documents") or []
    eq(len(docs), 2, "split into 2 drafts (1000 + 1)")
    eq(sorted(d["lines"] for d in docs), [1, 1000], "line counts")
    for d in docs:
        rr = post_doc(get_doc(d["id"]))
        eq(rr.status, 200, f"post split draft {d['draft_no']}")


@test("C3", "test_C3_opening_debt_import_and_ledger")
def _():
    a = admin()
    c = mk_partner(cust=True, supp=True)
    c2 = mk_partner(cust=True, rec=300)
    k1 = wh("KHO1")
    p = mk_product(sale=100, purchase=50)
    posted("opening", "2026-01-01", k1, [L(p["id"], 10, 50)])
    posted("sale", "2026-02-01", k1, [L(p["id"], 2, 100)], c["id"])
    r = imp("opening_debt", ["Mã đối tác", "Phải thu", "Phải trả"], [[c["code"], "1.500.000", "-200"], [c2["code"], "", 50]], dry=False)
    eq(r.status, 200, "opening debt import: " + errs_text(import_result(r))[:300])
    eq(a.ok("GET", f"/partners/{c['id']}")["opening_receivable"], 1500000, "receivable set")
    eq(a.ok("GET", f"/partners/{c['id']}")["opening_payable"], -200, "negative payable allowed")
    eq(a.ok("GET", f"/partners/{c2['id']}")["opening_receivable"], 0, "blank cell -> 0 (replaces 300)")
    led = debt_ledger(c["id"])
    eq(led["opening"], 1500000, "ledger opening")
    eq(led["closing"], 1500200, "ledger closing = opening + sale")
    # re-run with only Phải thu column: payable kept
    r = imp("opening_debt", ["Mã đối tác", "Phải thu"], [[c["code"], 700]], dry=False)
    eq(r.status, 200, "re-import")
    pp = a.ok("GET", f"/partners/{c['id']}")
    eq(pp["opening_receivable"], 700, "replaced")
    eq(pp["opening_payable"], -200, "absent column keeps")
    eq(debt_closing(c["id"]), 900, "ledger follows")
    # duplicates
    r = imp("opening_debt", ["Mã đối tác", "Phải thu"], [[c["code"], 1], [c["code"], 2]])
    check(bool(import_result(r).get("errors")), "duplicate partner in opening debt flagged")


@test("C3", "test_C3_permissions_and_masked_purchase_price_column")
def _():
    p = mk_product(sale=10, purchase=4321)
    hdr = ["Mã hàng", "Mã kho", "Số lượng"]
    expect_err(upload(user("muahang"), "products", xlsx_bytes(PH, [[uid("X"), "x", "Cái", "", 1, 1]])), 403, "FORBIDDEN", "muahang import products")
    eq(upload(user("muahang"), "opening_stock", xlsx_bytes(hdr, [[p["code"], "KHO1", 1]]), date="2026-10-12").status, 200, "muahang opening stock")
    eq(upload(user("thukho"), "opening_stock", xlsx_bytes(hdr, [[p["code"], "KHO1", 1]]), date="2026-10-12").status, 200, "thukho opening stock")
    expect_err(upload(user("banhang"), "opening_stock", xlsx_bytes(hdr, [[p["code"], "KHO1", 1]])), 403, "FORBIDDEN", "banhang opening stock")
    expect_err(upload(user("ketoan"), "opening_debt", xlsx_bytes(["Mã đối tác"], [["X"]])), 403, "FORBIDDEN", "ketoan opening_debt (admin only)")
    try:
        set_matrix({"thukho": ["stock.write", "catalog.write"]})
        r = upload(user("thukho"), "products", xlsx_bytes(PH, [[p["code"], "", "", "", "", "1"]]), dry=False)
        eq(r.status, 200, "masked user imports products")
        res = r.json or {}
        check(any("Giá mua" in n for n in res.get("notes") or []), f"note says Giá mua ignored: {res.get('notes')}")
        eq(admin().ok("GET", f"/products/{p['id']}")["purchase_price"], 4321, "Giá mua column ignored for masked user")
    finally:
        restore_matrix()


@test("C3", "test_C3_concurrent_imports")
def _():
    a = admin()
    pre = uid("CON")
    rows = [[f"{pre}-{i}", f"Đồng thời {i}", "Cái", "", 10 + i, 5] for i in range(300)]
    content = xlsx_bytes(PH, rows)
    c1, c2 = raw_client(a), raw_client(a)
    res = run_parallel([lambda: upload(c1, "products", content, dry=False), lambda: upload(c2, "products", content, dry=False)])
    sts = [r.status if not isinstance(r, Exception) else str(r) for r in res]
    check(all(isinstance(s, int) and s < 500 for s in sts), f"no 5xx/exception: {sts}")
    check(any(s == 200 for s in sts), f"at least one import succeeded: {sts}")
    lst = a.ok("GET", "/products", params={"q": pre, "page_size": 1000})
    eq(lst["total"], 300, "exactly 300 products, no duplicates")
    # two opening stock imports at once -> two separate drafts each, numbers unique
    p = mk_product(purchase=1)
    st = xlsx_bytes(["Mã hàng", "Mã kho", "Số lượng"], [[p["code"], "KHO1", 1]])
    res = run_parallel([lambda: upload(raw_client(a), "opening_stock", st, dry=False, date="2026-10-13") for _ in range(4)])
    ok = [r for r in res if not isinstance(r, Exception) and r.status == 200]
    eq(len(ok), 4, "4 concurrent opening-stock imports")
    nos = [d["draft_no"] for r in ok for d in r.json["documents"]]
    eq(len(set(nos)), len(nos), f"unique draft numbers: {nos}")
