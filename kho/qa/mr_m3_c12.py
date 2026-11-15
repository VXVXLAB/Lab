"""C12 — print template + logo (SPEC_MO_RONG C12, API §11.4, QUYET_DINH Q12); C13 HTTPS; user audit (M-12 follow-up)."""
import os
import re
import subprocess
import struct
import tempfile
import zlib

from mr_lib import *


def png(w, h, color=(255, 0, 0)):
    from PIL import Image
    bio = io.BytesIO()
    Image.new("RGB", (w, h), color).save(bio, "PNG")
    return bio.getvalue()


def jpg(w, h):
    from PIL import Image
    bio = io.BytesIO()
    Image.new("RGB", (w, h), (0, 128, 0)).save(bio, "JPEG")
    return bio.getvalue()


def png_header_only(w, h):
    """valid PNG signature + IHDR with large dimensions + tiny zero IDAT (a decompression-bomb shaped header)"""
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    raw = zlib.compress(b"\x00" * (w + 1) * min(h, 1), 9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


def put_logo(c, content, ctype="image/png", multipart=False, method="PUT"):
    h = {"Authorization": "Bearer " + c.token}
    if multipart:
        r = c.s.request(method, lib.BASE + "/print-template/logo", files={"file": ("logo.png", content, ctype)}, headers=h, timeout=60)
    else:
        r = c.s.request(method, lib.BASE + "/print-template/logo", data=content, headers={**h, "Content-Type": ctype}, timeout=60)
    resp = lib.Resp(r, method, "/print-template/logo", f"<{len(content)} bytes>")
    if resp.status >= 500:
        lib.SERVER_ERRORS.append(resp.short())
        fail("HTTP 5xx: " + resp.short())
    return resp


def tpl():
    return admin().ok("GET", "/print-template")


def export_text(path, fmt="xlsx"):
    r = admin().get(path, format=fmt)
    t = file_text(r.content)
    return re.sub(r"Xuất file lúc [^\n·]*", "Xuất file lúc <t>", t)


@test("C12", "test_C12_template_roundtrip_validation_permissions")
def _():
    a = admin()
    base = tpl()["template"]
    try:
        body = {"paper_size_document": "A5", "paper_size_voucher": "A4", "footer": "Cảm ơn quý khách — hẹn gặp lại",
                "hide_unit_column": True, "hide_code_column": False, "signatures": {"sale": ["Người bán QA", "Người mua QA"]}}
        r = a.put("/print-template", body)
        eq(r.status, 200, "PUT template")
        t = tpl()["template"]
        for k, v in body.items():
            eq(t.get(k), v, f"round-trip {k}")
        eq(user("banhang").get("/print-template").status, 200, "everyone reads the template")
        expect_err(user("ketoan").put("/print-template", body), 403, "FORBIDDEN", "ketoan PUT template")
        for patch, label in [({"paper_size_document": "A3"}, "paper A3"), ({"footer": "x" * 301}, "footer 301 chars"),
                             ({"signatures": {"sale": [f"Ô {i}" for i in range(7)]}}, "7 signature boxes"),
                             ({"signatures": {"sale": []}}, "0 boxes"), ({"signatures": {"sale": ["x" * 61]}}, "61-char name"),
                             ({"signatures": {"khongco": ["A"]}}, "unknown doc key"), ({"hide_unit_column": "yes"}, "non-bool"),
                             ({"footer": "a\u0000b"}, "NUL"), ({"signatures": "abc"}, "signatures not object")]:
            r = a.put("/print-template", {**body, **patch})
            check(r.status == 400, f"template {label}: expected 400, got {r.short()[:200]}")
        eq(tpl()["template"]["footer"], body["footer"], "unchanged after rejected PUTs")
        r = a.put("/print-template", {**body, "footer": "ư" * 300})
        eq(r.status, 200, "300 Vietnamese characters (not bytes) accepted")
        rows = a.ok("GET", "/audit", params={"entity": "print_template", "limit": 5})["items"]
        check(len(rows) >= 1, "template change audited")
    finally:
        a.put("/print-template", {k: base[k] for k in ("paper_size_document", "paper_size_voucher", "footer", "hide_unit_column", "hide_code_column", "signatures")})


@test("C12", "test_C12_logo_validation")
def _():
    a = admin()
    ok_png = png(200, 80)
    for label, content, ctype, mp in [("png raw", ok_png, "image/png", False), ("png multipart", ok_png, "image/png", True),
                                      ("jpg", jpg(300, 100), "image/jpeg", False)]:
        r = put_logo(a, content, ctype, mp)
        eq(r.status, 200, f"upload {label}")
        g = a.req("GET", "/print-template/logo")
        eq(g.status, 200, f"download after {label}")
        eq(g.content, content, f"{label}: bytes round-trip")
        eq(g.headers.get("X-Content-Type-Options"), "nosniff", "nosniff header")
        check((g.headers.get("Content-Type") or "").startswith("image/"), f"image content type: {g.headers.get('Content-Type')}")
    eq(user("thukho").get("/print-template/logo").status, 200, "any logged-in user downloads")
    eq(Client(None).get("/print-template/logo").status, 401, "anonymous download -> 401")
    expect_err(put_logo(user("ketoan"), ok_png), 403, "FORBIDDEN", "ketoan uploads")
    big = png(10, 10) + b"\x00" * (500 * 1024)   # trailing garbage pushes it over 500 KB
    from PIL import Image
    import random as _r
    rnd = _r.Random(1)
    img = Image.frombytes("RGB", (420, 420), bytes(rnd.getrandbits(8) for _ in range(420 * 420 * 3)))
    bio = io.BytesIO(); img.save(bio, "PNG"); noisy = bio.getvalue()
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    poly = b"\x89PNG\r\n\x1a\n<html><script>alert(1)</script></html>"
    gif = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
    before = a.req("GET", "/print-template/logo").content
    for label, content, ctype in [("> 500 KB random PNG (%d KB)" % (len(noisy) // 1024), noisy, "image/png"),
                                  ("PNG + 500 KB trailing garbage", big, "image/png"),
                                  ("4001 x 1", png(4001, 1), "image/png"), ("1 x 4001", png(1, 4001), "image/png"),
                                  ("header claims 30000 x 30000", png_header_only(30000, 30000), "image/png"),
                                  ("SVG with script", svg, "image/svg+xml"), ("SVG sent as image/png", svg, "image/png"),
                                  ("PNG/HTML polyglot", poly, "image/png"), ("GIF", gif, "image/gif"),
                                  ("zero bytes", b"", "image/png"), ("text renamed", b"day khong phai anh", "image/png")]:
        r = put_logo(a, content, ctype)
        check(r.status == 400, f"logo {label}: expected 400, got {r.short()[:200]}")
        if r.json and r.status == 400:
            check(has_vietnamese(r.json["error"]["message"]), f"{label}: Vietnamese message")
    eq(a.req("GET", "/print-template/logo").content, before, "rejected uploads did not replace the logo")
    eq(put_logo(a, png(4000, 1)).status, 200, "4000 x 1 accepted (limit inclusive)")
    t = tpl()["template"]
    eq((t["has_logo"], t["logo_type"]), (True, "image/png"), "template reports logo")
    eq(a.req("DELETE", "/print-template/logo").status, 200, "delete logo")
    eq(a.req("GET", "/print-template/logo").status, 404, "no logo -> 404")
    eq(tpl()["template"]["has_logo"], False, "has_logo false")


def all_doc_types():
    a = admin()
    k1, k2 = wh("KHO1"), wh("KHO2")
    p = mk_product(sale=100, purchase=10)
    c, s = mk_partner(cust=True), mk_partner(supp=True)
    acc = mk_account("cash", 0)
    docs = {"opening": posted("opening", "2026-07-01", k1, [L(p["id"], 100, 10)]),
            "purchase": posted("purchase", "2026-07-02", k1, [L(p["id"], 5, 10)], s["id"]),
            "sale": posted("sale", "2026-07-03", k1, [L(p["id"], 2, 100)], c["id"]),
            "sale_return": posted("sale_return", "2026-07-04", k1, [L(p["id"], 1, 100)], c["id"]),
            "purchase_return": posted("purchase_return", "2026-07-05", k1, [L(p["id"], 1, 10)], s["id"]),
            "transfer": posted("transfer", "2026-07-06", k1, [L(p["id"], 1)], None, k2),
            "stocktake": post_doc({**a.ok("POST", "/documents", {"doc_type": "stocktake", "doc_date": "2026-07-07", "warehouse_id": k1,
                                                                 "lines": [L(p["id"], 100)]})}).json}
    paths = {t: f"/documents/{d['id']}/export" for t, d in docs.items()}
    for vt in ("receipt", "payment"):
        v = a.ok("POST", "/vouchers", {"voucher_type": vt, "voucher_date": "2026-07-08", "account_id": acc["id"], "partner_id": c["id"],
                                       "lines": [{"description": "QA", "amount": 10}]})
        paths[vt] = f"/vouchers/{v['id']}/export"
    return paths


@test("C12", "test_C12_signatures_footer_hidden_columns_in_every_export_and_off_equals_base")
def _():
    a = admin()
    paths = all_doc_types()
    base_txt = {(t, f): export_text(p_, f) for t, p_ in paths.items() for f in ("xlsx", "docx")}
    sigs = {t: [f"Ký {t} một", f"Ký {t} hai"] for t in paths}
    body = {"paper_size_document": "A4", "paper_size_voucher": "A5", "footer": "CHÂN TRANG QA 123", "hide_unit_column": True,
            "hide_code_column": True, "signatures": sigs}
    try:
        eq(a.put("/print-template", body).status, 200, "set template")
        for t, p_ in paths.items():
            for f in ("xlsx", "docx"):
                txt = export_text(p_, f)
                for name in sigs[t]:
                    check(name in txt, f"{t} {f}: signature '{name}'")
                check("CHÂN TRANG QA 123" in txt, f"{t} {f}: footer")
                i, j = txt.find("CHÂN TRANG QA 123"), txt.find("Xuất file lúc")
                check(i >= 0 and j >= 0 and i < j, f"{t} {f}: footer before 'Xuất file lúc'")
                if t not in ("receipt", "payment"):
                    check("ĐVT" not in txt, f"{t} {f}: ĐVT column hidden")
                    check("Mã hàng" not in txt, f"{t} {f}: Mã hàng column hidden")
        # feature off -> identical to base
        set_features(print_template=False)
        expect_err(a.get("/print-template"), 404, "FEATURE_OFF", "template endpoint off")
        expect_err(a.get("/print-template/logo"), 404, "FEATURE_OFF", "logo endpoint off")
        for t, p_ in paths.items():
            for f in ("xlsx", "docx"):
                eq(export_text(p_, f), base_txt[(t, f)], f"{t} {f}: off -> export identical to the untemplated one")
    finally:
        all_features_on()
        a.put("/print-template", {"paper_size_document": "A4", "paper_size_voucher": "A5", "footer": "", "hide_unit_column": False,
                                  "hide_code_column": False, "signatures": {}})
    for t, p_ in list(paths.items())[:3]:
        eq(export_text(p_, "xlsx"), base_txt[(t, "xlsx")], f"{t}: cleared template -> same as never set")


# ---------------------------------------------------------------- C13 HTTPS

def _start(env_extra, port, wait=8):
    env = dict(os.environ)
    env.pop("KHO_EDITION", None)
    env.update({"DATABASE_URL": os.environ.get("MR_DATABASE_URL", ""), "LISTEN_ADDR": f"127.0.0.1:{port}", "ADMIN_PASSWORD": "admin123",
                "KHO_EDITION": "extended"})
    env.update(env_extra)
    binp = os.environ.get("KHOSERVER") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", "bin", "khoserver")
    return subprocess.Popen([binp], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


@test("C13", "test_C13_https_with_self_signed_cert")
def _():
    if not os.environ.get("MR_DATABASE_URL"):
        fail("MR_DATABASE_URL not set (run via run_mr.sh)")
        return
    port = int(os.environ.get("MR_TLS_PORT", "18396"))
    d = tempfile.mkdtemp(prefix="mr_tls_")
    crt, key = os.path.join(d, "kho.crt"), os.path.join(d, "kho.key")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "30", "-nodes", "-keyout", key, "-out", crt,
                    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], check=True, capture_output=True)
    other_key = os.path.join(d, "other.key")
    subprocess.run(["openssl", "genrsa", "-out", other_key, "2048"], check=True, capture_output=True)
    garbage = os.path.join(d, "garbage.pem")
    open(garbage, "w").write("not a certificate")
    # bad combinations: process must exit quickly with a clear message
    for env_extra, label in [({"TLS_CERT": crt}, "only TLS_CERT"), ({"TLS_KEY": key}, "only TLS_KEY"),
                             ({"TLS_CERT": crt, "TLS_KEY": other_key}, "cert/key mismatch"),
                             ({"TLS_CERT": "/khong/co.crt", "TLS_KEY": key}, "missing file"), ({"TLS_CERT": garbage, "TLS_KEY": key}, "garbage cert")]:
        pr = _start(env_extra, port)
        try:
            out, _ = pr.communicate(timeout=15)
            txt = out.decode("utf-8", "replace")
            check(pr.returncode != 0, f"{label}: process exits non-zero (rc={pr.returncode})")
            check("HTTPS" in txt and has_vietnamese(txt), f"{label}: clear Vietnamese startup error: {txt[-300:]!r}")
        except subprocess.TimeoutExpired:
            pr.kill()
            fail(f"{label}: server kept running instead of refusing to start")
    pr = _start({"TLS_CERT": crt, "TLS_KEY": key}, port)
    try:
        ok = False
        for _ in range(50):
            try:
                if requests.get(f"https://127.0.0.1:{port}/api/health", verify=crt, timeout=1).status_code == 200:
                    ok = True
                    break
            except Exception:
                time.sleep(0.2)
        if not check(ok, "HTTPS health with the self-signed cert"):
            return
        r = requests.post(f"https://127.0.0.1:{port}/api/auth/login", json={"username": "admin", "password": "admin123"}, verify=crt)
        eq(r.status_code, 200, "login over HTTPS")
        sc = r.headers.get("Set-Cookie", "")
        check("Secure" in sc and "HttpOnly" in sc, f"cookie has Secure + HttpOnly: {sc}")
        tok = r.cookies.get("session")
        eq(requests.get(f"https://127.0.0.1:{port}/api/auth/me", cookies={"session": tok}, verify=crt).status_code, 200, "session works over HTTPS")
        try:
            rr = requests.get(f"http://127.0.0.1:{port}/api/health", timeout=3)
            check(rr.status_code == 400, f"plain HTTP on the HTTPS port answered {rr.status_code} (expected a clean 400 / refusal)")
        except requests.exceptions.RequestException:
            check(True, "plain HTTP refused")
        import ssl
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ctx.maximum_version = ssl.TLSVersion.TLSv1_1
        import socket
        try:
            ctx.minimum_version = ssl.TLSVersion.TLSv1
            with socket.create_connection(("127.0.0.1", port), timeout=3) as sk:
                with ctx.wrap_socket(sk) as ss:
                    fail(f"TLS {ss.version()} accepted (Q13 says >= 1.2)")
        except (ssl.SSLError, OSError, ValueError):
            check(True, "TLS <= 1.1 refused (or not supported by the client)")
        eq(requests.get(f"https://127.0.0.1:{port}/api/health", verify=True if False else crt).status_code, 200, "still up")
    finally:
        pr.kill()
        pr.wait(10)


# ---------------------------------------------------------------- user audit (M-12) / audit to < from (M-11)

@test("G", "test_M11_M12_user_audit_rows_without_passwords")
def _():
    a = admin()
    last = (a.ok("GET", "/audit", params={"limit": 1})["items"] or [{"id": 0}])[0]["id"]
    pw1, pw2, pw3 = "MatKhauQA#1", "MatKhauQA#2", "MatKhauQA#3"
    r = a.post("/users", {"username": uid("au").lower(), "password": pw1, "full_name": "Người kiểm audit", "role": "banhang"})
    u = r.json
    a.put(f"/users/{u['id']}", {"role": "muahang"})
    a.put(f"/users/{u['id']}", {"active": False})
    a.put(f"/users/{u['id']}", {"active": True})
    a.put(f"/users/{u['id']}", {"password": pw2})
    a.put(f"/users/{u['id']}", {"full_name": "Đổi tên"})
    c = login(u["username"], pw2)
    c.post("/auth/change-password", {"old_password": pw2, "new_password": pw3})
    rows = [x for x in a.ok("GET", "/audit", params={"entity": "user", "limit": 1000})["items"] if x["id"] > last and x.get("entity_id") == u["id"]]
    acts = [x["action"] for x in rows]
    for want in ("created", "role_changed", "deactivated", "activated", "password_reset", "password_changed"):
        check(want in acts, f"user audit action {want}: {acts}")
    rc = [x for x in rows if x["action"] == "role_changed"]
    if rc:
        eq(((rc[0].get("before") or {}).get("role"), (rc[0].get("after") or {}).get("role")), ("banhang", "muahang"), "role before/after")
    pc = [x for x in rows if x["action"] == "password_changed"]
    if pc:
        eq(pc[0].get("user_id"), u["id"], "self password change by the user")
    blob = json.dumps(rows, ensure_ascii=False)
    for secret in (pw1, pw2, pw3, "$2a$", "$2b$", "password_hash"):
        check(secret not in blob, f"audit rows contain {secret!r}")
    for x in rows:
        for side in ("before", "after"):
            for k, v in (x.get(side) or {}).items():
                if "password" in k:
                    check(isinstance(v, bool), f"{x['action']} {side}.{k} is only a flag, got {v!r}")
    expect_err(a.get("/audit", **{"from": "2026-02-01", "to": "2026-01-01"}), 400, "VALIDATION", "audit to < from (M-11)")
    eq(a.get("/audit", **{"from": "2026-02-01", "to": "2026-02-01"}).status, 200, "from = to")
