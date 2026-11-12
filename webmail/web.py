"""API web và phục vụ giao diện webmail."""
import hashlib
import hmac
import os
import threading
import re
import secrets
import time
from datetime import timedelta
from functools import wraps
from urllib.parse import quote

from flask import Flask, Response, g, jsonify, request, send_from_directory, session

from . import config, db, delivery, mime, security, spam

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
FOLDERS = ("inbox", "sent", "drafts", "spam", "trash")
LOCAL_RE = re.compile(r"^[a-z0-9][a-z0-9._\-]{0,62}$")

app = Flask(__name__, static_folder=STATIC, static_url_path="/static")
app.config.update(
    MAX_CONTENT_LENGTH=config.MAX_SIZE + 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=config.COOKIE_SECURE,
    SESSION_COOKIE_NAME="webmail",
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
)

if config.TRUST_PROXY:  # lấy địa chỉ IP thật của người dùng từ X-Forwarded-For do reverse proxy đặt
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)


def load_secret():
    app.secret_key = security.session_secret()


_setup_lock = threading.Lock()


def err(message, code=400):
    return jsonify(error=message), code


def pw_stamp(user):
    """Dấu vết của mật khẩu hiện tại; đổi mật khẩu thì mọi phiên đăng nhập cũ mất hiệu lực."""
    return hashlib.sha256(("%s|%s" % (app.secret_key, user["pw_hash"])).encode()).hexdigest()[:24]


def current_user():
    user = db.get_user(session.get("uid") or 0)
    if user and hmac.compare_digest(str(session.get("pw") or ""), pw_stamp(user)):
        return user
    return None


def login_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        user = current_user()
        if not user:
            return err("Phiên đăng nhập đã hết hạn.", 401)
        g.user = user
        return f(*a, **kw)
    return wrapper


def admin_required(f):
    @wraps(f)
    @login_required
    def wrapper(*a, **kw):
        if not g.user["is_admin"]:
            return err("Chỉ quản trị viên mới dùng được chức năng này.", 403)
        return f(*a, **kw)
    return wrapper


@app.before_request
def csrf_guard():
    if request.path.startswith("/api/") and request.method not in ("GET", "HEAD"):
        if request.headers.get("X-Requested-With") != "webmail":
            return err("Yêu cầu không hợp lệ.", 403)


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
    )
    if request.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


@app.errorhandler(413)
def too_large(_):
    return err("Tệp quá lớn (tối đa %d MB)." % (config.MAX_SIZE // 1024 // 1024), 413)


@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html", max_age=0)


# ---------- tài khoản ----------

def user_json(u):
    return {"id": u["id"], "email": u["email"], "name": u["name"], "is_admin": bool(u["is_admin"])}


def check_new_password(pw):
    if not isinstance(pw, str) or len(pw) < 8:
        raise ValueError("Mật khẩu cần ít nhất 8 ký tự.")
    if len(pw) > 256:
        raise ValueError("Mật khẩu quá dài.")


@app.get("/api/me")
def me():
    user = current_user()
    return jsonify(user=user_json(user) if user else None, setup=db.user_count() == 0, domain=config.DOMAIN,
                   max_mb=config.MAX_SIZE // 1024 // 1024)


@app.get("/api/client-settings")
@login_required
def client_settings():
    """Thông số để cài hộp thư vào Outlook, Thunderbird, điện thoại."""
    return jsonify(host=config.HOSTNAME, email=g.user["email"], self_signed=security.tls_self_signed(),
                   imaps=config.IMAPS_PORT, imap=config.IMAP_PORT, pop3s=config.POP3S_PORT, pop3=config.POP3_PORT,
                   submission=config.SUBMISSION_PORT)


@app.get("/api/admin/dns")
@admin_required
def admin_dns():
    return jsonify(records=security.dns_records())


@app.post("/api/setup")
def setup():
    """Lần chạy đầu tiên: tạo tài khoản quản trị."""
    if db.user_count():
        return err("Hệ thống đã được thiết lập.", 403)
    ip = request.remote_addr or "?"
    if security.is_locked(ip):
        return err("Nhập sai quá nhiều lần. Hãy thử lại sau vài phút.", 429)
    d = request.get_json(silent=True) or {}
    if not security.check_setup_token(str(d.get("token") or "")):
        security._record(ip, False)
        return err("Mã thiết lập không đúng. Mã được in ra màn hình khi khởi động máy chủ.", 403)
    local = str(d.get("email") or "").strip().lower().split("@")[0]
    try:
        if not LOCAL_RE.match(local):
            raise ValueError("Tên hộp thư chỉ gồm chữ thường, số, dấu chấm, gạch nối.")
        check_new_password(d.get("password"))
    except ValueError as e:
        return err(str(e))
    with _setup_lock:
        if db.user_count():
            return err("Hệ thống đã được thiết lập.", 403)
        uid = db.create_user("%s@%s" % (local, config.DOMAIN), str(d.get("name") or local)[:100], d["password"], True)
    security.clear_setup_token()
    session.clear()
    session.permanent = True
    session["uid"] = uid
    session["pw"] = pw_stamp(db.get_user(uid))
    welcome = mime.build(
        "Hệ thống thư", "postmaster@" + config.DOMAIN, [("", "%s@%s" % (local, config.DOMAIN))], [],
        "Chào mừng bạn đến với hộp thư mới",
        "Xin chào,\n\nHộp thư của bạn đã sẵn sàng. Một vài gợi ý:\n\n"
        "  • Bấm \"Soạn thư\" để viết thư mới, đính kèm tệp bằng nút kẹp giấy.\n"
        "  • Bấm ngôi sao để đánh dấu thư quan trọng.\n"
        "  • Vào biểu tượng tài khoản (góc trên bên phải) để thêm người dùng hoặc đổi mật khẩu.\n\n"
        "Chúc bạn làm việc hiệu quả!")
    delivery.deliver_local(db.get_user(uid), welcome)
    return jsonify(user=user_json(db.get_user(uid)))


@app.post("/api/login")
def login():
    d = request.get_json(silent=True) or {}
    user, why = security.authenticate(str(d.get("email") or ""), str(d.get("password") or ""),
                                      request.remote_addr)
    if why == "locked":
        return err("Sai mật khẩu quá nhiều lần. Hãy thử lại sau vài phút.", 429)
    if not user:
        return err("Địa chỉ thư hoặc mật khẩu không đúng.", 401)
    session.clear()
    session.permanent = True
    session["uid"] = user["id"]
    session["pw"] = pw_stamp(user)
    return jsonify(user=user_json(user))


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.post("/api/password")
@login_required
def change_password():
    d = request.get_json(silent=True) or {}
    if not db.check_password(str(d.get("old") or ""), g.user["pw_hash"]):
        return err("Mật khẩu hiện tại không đúng.")
    try:
        check_new_password(d.get("new"))
    except ValueError as e:
        return err(str(e))
    db.set_password(g.user["id"], d["new"])
    session["pw"] = pw_stamp(db.get_user(g.user["id"]))  # giữ phiên này, các phiên khác bị đăng xuất
    return jsonify(ok=True)


@app.get("/api/admin/users")
@admin_required
def admin_users():
    rows = db.conn().execute("SELECT * FROM users ORDER BY email").fetchall()
    return jsonify(users=[user_json(r) for r in rows])


@app.post("/api/admin/users")
@admin_required
def admin_create_user():
    d = request.get_json(silent=True) or {}
    local = str(d.get("email") or "").strip().lower().split("@")[0]
    try:
        if not LOCAL_RE.match(local) or local in ("postmaster", "mailer-daemon"):
            raise ValueError("Tên hộp thư chỉ gồm chữ thường, số, dấu chấm, gạch nối.")
        check_new_password(d.get("password"))
    except ValueError as e:
        return err(str(e))
    email = "%s@%s" % (local, config.DOMAIN)
    if db.user_by_email(email):
        return err("Hộp thư %s đã tồn tại." % email)
    uid = db.create_user(email, str(d.get("name") or local)[:100], d["password"], bool(d.get("is_admin")))
    return jsonify(user=user_json(db.get_user(uid)))


@app.post("/api/admin/users/<int:uid>/password")
@admin_required
def admin_reset_password(uid):
    d = request.get_json(silent=True) or {}
    try:
        check_new_password(d.get("password"))
    except ValueError as e:
        return err(str(e))
    if not db.get_user(uid):
        return err("Không tìm thấy người dùng.", 404)
    db.set_password(uid, d["password"])
    return jsonify(ok=True)


@app.delete("/api/admin/users/<int:uid>")
@admin_required
def admin_delete_user(uid):
    if uid == g.user["id"]:
        return err("Bạn không thể xóa chính mình.")
    with db.conn() as c:
        c.execute("DELETE FROM users WHERE id=?", (uid,))
    return jsonify(ok=True)


# ---------- thư ----------

def summary(r):
    return {
        "id": r["id"], "folder": r["folder"], "from_name": r["from_name"], "from_addr": r["from_addr"],
        "to": r["to_addrs"], "subject": r["subject"], "snippet": r["snippet"], "date": r["date"],
        "is_read": bool(r["is_read"]), "starred": bool(r["starred"]), "has_attach": bool(r["has_attach"]),
    }


@app.get("/api/folders")
@login_required
def folders():
    uid = g.user["id"]
    c = db.conn()
    counts = {f: 0 for f in FOLDERS}
    for r in c.execute("SELECT folder, COUNT(*) n, SUM(is_read=0) unread FROM messages WHERE user_id=? "
                       "GROUP BY folder", (uid,)):
        counts[r["folder"]] = r["n"] if r["folder"] == "drafts" else (r["unread"] or 0)
    counts["sent"] = 0
    counts["trash"] = 0
    custom = [{"id": db.folder_key(f["id"]), "name": f["name"], "unread": counts.pop(db.folder_key(f["id"]), 0)}
              for f in db.list_folders(uid)]
    counts = {k: v for k, v in counts.items() if k in FOLDERS}
    latest = c.execute("SELECT COALESCE(MAX(id),0) FROM messages WHERE user_id=? AND folder='inbox'",
                       (uid,)).fetchone()[0]
    return jsonify(counts=counts, latest=latest, custom=custom)


@app.post("/api/folders")
@login_required
def create_folder():
    d = request.get_json(silent=True) or {}
    try:
        fid = db.create_folder(g.user["id"], d.get("name"))
    except ValueError as e:
        return err(str(e))
    return jsonify(id=db.folder_key(fid))


@app.put("/api/folders/<int:fid>")
@login_required
def rename_folder(fid):
    if not db.custom_folder(g.user["id"], db.folder_key(fid)):
        return err("Thư mục không tồn tại.", 404)
    try:
        db.rename_folder(g.user["id"], fid, (request.get_json(silent=True) or {}).get("name"))
    except ValueError as e:
        return err(str(e))
    return jsonify(ok=True)


@app.delete("/api/folders/<int:fid>")
@login_required
def delete_folder(fid):
    if not db.custom_folder(g.user["id"], db.folder_key(fid)):
        return err("Thư mục không tồn tại.", 404)
    db.delete_folder(g.user["id"], fid)
    return jsonify(ok=True)


@app.get("/api/messages")
@login_required
def list_messages():
    folder = request.args.get("folder", "inbox")
    q = (request.args.get("q") or "").strip()
    page = max(0, request.args.get("page", 0, type=int))
    where, params = ["user_id=?"], [g.user["id"]]
    if q:
        like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where.append("(subject LIKE ? ESCAPE '\\' OR from_addr LIKE ? ESCAPE '\\' OR from_name LIKE ? ESCAPE '\\'"
                     " OR to_addrs LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\')")
        params += [like] * 5
        if folder != "trash":
            where.append("folder!='trash'")
    if folder == "starred":
        where.append("starred=1 AND folder!='trash'")
    elif not db.valid_folder(g.user["id"], folder):
        return err("Thư mục không tồn tại.", 404)
    elif not (q and folder != "trash"):
        where.append("folder=?")
        params.append(folder)
    sql = " FROM messages WHERE " + " AND ".join(where)
    c = db.conn()
    total = c.execute("SELECT COUNT(*)" + sql, params).fetchone()[0]
    rows = c.execute(
        "SELECT id,folder,from_name,from_addr,to_addrs,subject,snippet,date,is_read,starred,has_attach" + sql +
        " ORDER BY date DESC, id DESC LIMIT ? OFFSET ?", params + [config.PAGE_SIZE, page * config.PAGE_SIZE],
    ).fetchall()
    return jsonify(items=[summary(r) for r in rows], total=total, page=page, page_size=config.PAGE_SIZE)


def own_message(mid):
    return db.get_message(g.user["id"], mid)


@app.get("/api/messages/<int:mid>")
@login_required
def get_message(mid):
    r = own_message(mid)
    if not r:
        return err("Không tìm thấy thư.", 404)
    if not r["is_read"]:
        with db.conn() as c:
            c.execute("UPDATE messages SET is_read=1 WHERE id=?", (mid,))
    out = summary(r)
    out.update(
        is_read=True, cc=r["cc_addrs"], bcc=r["bcc_addrs"], reply_to=r["reply_to"], text=r["body_text"],
        has_html=bool(r["body_html"]),
        html=(mime.sanitize_fragment(r["body_html"], draft_images(mid)[1])
              if r["folder"] == "drafts" and r["body_html"] else None),
        attachments=[{"id": a["id"], "filename": a["filename"], "size": a["size"], "ctype": a["ctype"]}
                     for a in db.list_attachments(mid) if not a["inline"]],
    )
    return jsonify(out)


@app.get("/api/messages/<int:mid>/html")
@login_required
def message_html(mid):
    r = own_message(mid)
    if not r or not r["body_html"]:
        return err("Không tìm thấy thư.", 404)
    allow = request.args.get("images") == "1"
    cids = {a["cid"]: "/api/messages/%d/attachments/%d" % (mid, a["id"])
            for a in db.list_attachments(mid) if a["cid"]}
    page, blocked = mime.sanitize_html(r["body_html"], cids, allow)
    resp = Response(page, mimetype="text/html")
    resp.headers["Content-Security-Policy"] = (
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:%s; frame-ancestors 'self'; "
        "sandbox allow-same-origin allow-popups allow-popups-to-escape-sandbox" % (" https: http:" if allow else "")
    )
    resp.headers["X-Blocked-Images"] = "1" if blocked else "0"
    return resp


@app.get("/api/messages/<int:mid>/attachments/<int:aid>")
@login_required
def attachment(mid, aid):
    if not own_message(mid):
        return err("Không tìm thấy thư.", 404)
    a = db.conn().execute("SELECT * FROM attachments WHERE id=? AND message_id=?", (aid, mid)).fetchone()
    if not a:
        return err("Không tìm thấy tệp.", 404)
    safe_image = a["ctype"] in ("image/png", "image/jpeg", "image/gif", "image/webp")
    resp = Response(bytes(a["data"]), mimetype=a["ctype"] if safe_image else "application/octet-stream")
    resp.headers["Content-Disposition"] = "%s; filename*=UTF-8''%s" % (
        "inline" if safe_image and request.args.get("dl") != "1" else "attachment", quote(a["filename"]))
    resp.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return resp


def apply_action(c, uid, ids, action, target=None):
    marks = ",".join("?" * len(ids))
    base = " WHERE user_id=? AND id IN (%s)" % marks
    args = [uid] + ids
    rows = c.execute("SELECT * FROM messages" + base, args).fetchall()
    if action in ("read", "unread"):
        c.execute("UPDATE messages SET is_read=?" + base, [int(action == "read")] + args)
    elif action in ("star", "unstar"):
        c.execute("UPDATE messages SET starred=?" + base, [int(action == "star")] + args)
    elif action == "delete":
        c.execute("DELETE FROM messages" + base + " AND folder IN ('trash','drafts')", args)
        db.move_messages(c, uid, [r["id"] for r in rows if r["folder"] not in ("trash", "drafts")], "trash")
    elif action == "restore":
        for r in rows:
            if r["folder"] == "trash":
                back = r["prev_folder"]
                if back not in ("inbox", "sent", "spam") and not db.custom_folder(uid, back):
                    back = "inbox"
                db.move_messages(c, uid, [r["id"]], back)
    elif action in ("spam", "notspam"):
        # Báo thư rác / không phải thư rác: chuyển thư và dạy bộ lọc của riêng người dùng này.
        for r in rows:
            if r["folder"] in ("drafts", "sent"):
                continue
            spam.set_trained(c, r, 1 if action == "spam" else 2)
            db.move_messages(c, uid, [r["id"]], "spam" if action == "spam" else "inbox")
    elif action == "move":
        if target != "inbox" and not db.custom_folder(uid, target):
            raise ValueError("Thư mục đích không tồn tại.")
        for r in rows:
            if r["folder"] == "drafts":
                continue
            if r["folder"] == "spam":
                spam.set_trained(c, r, 2)
            db.move_messages(c, uid, [r["id"]], target)
    else:
        raise ValueError("Thao tác không hợp lệ.")


@app.post("/api/messages/action")
@login_required
def messages_action():
    d = request.get_json(silent=True) or {}
    raw_ids = d.get("ids") if isinstance(d.get("ids"), list) else []
    ids = [int(i) for i in raw_ids[:500] if isinstance(i, (int, str)) and str(i).isdigit() and len(str(i)) < 16]
    if not ids:
        return err("Chưa chọn thư nào.")
    try:
        with db.conn() as c:
            apply_action(c, g.user["id"], ids, d.get("action"), d.get("folder"))
    except ValueError as e:
        return err(str(e))
    return jsonify(ok=True)


@app.post("/api/trash/empty")
@login_required
def empty_trash():
    with db.conn() as c:
        c.execute("DELETE FROM messages WHERE user_id=? AND folder='trash'", (g.user["id"],))
    return jsonify(ok=True)


@app.post("/api/spam/empty")
@login_required
def empty_spam():
    with db.conn() as c:
        c.execute("DELETE FROM messages WHERE user_id=? AND folder='spam'", (g.user["id"],))
    return jsonify(ok=True)


# ---------- soạn thư ----------

def own_draft(mid):
    r = own_message(mid)
    return r if r and r["folder"] == "drafts" else None


def draft_images(did):
    """Hai hàm đổi địa chỉ ảnh chèn trong thư nháp: (trình duyệt -> cid:, cid: -> trình duyệt)."""
    by_id, by_cid = {}, {}
    for a in db.list_attachments(did):
        if a["inline"] and a["cid"]:
            by_id[a["id"]] = "cid:" + a["cid"]
            by_cid["cid:" + a["cid"]] = "/api/messages/%d/attachments/%d" % (did, a["id"])

    def to_cid(src):
        if src in by_cid:
            return src
        m = re.search(r"/api/messages/(\d{1,15})/attachments/(\d{1,15})$", src)
        return by_id.get(int(m.group(2))) if m and int(m.group(1)) == did else None

    return to_cid, by_cid.get


def as_id(value):
    """Số nguyên dương từ dữ liệu JSON của máy khách, hoặc None."""
    if isinstance(value, bool) or not isinstance(value, (int, str)) or not str(value).isdigit() or len(str(value)) > 15:
        return None
    return int(value)


LIMITS = {"to": 20000, "cc": 20000, "bcc": 20000, "subject": 998, "body": 2_000_000, "html": 4_000_000}


@app.post("/api/drafts")
@login_required
def save_draft():
    d = request.get_json(silent=True) or {}
    fields = {}
    for k, limit in LIMITS.items():
        v = d.get(k)
        v = v if isinstance(v, str) else ""
        if len(v) > limit:
            return err("Nội dung quá dài.", 413)
        fields[k] = v
    uid = g.user["id"]
    did = as_id(d.get("id"))
    if did and not own_draft(did):
        return err("Thư nháp không còn tồn tại.", 404)
    html_body = None
    if fields["html"].strip():
        html_body = mime.sanitize_fragment(fields["html"], draft_images(did)[0] if did else None)
    if html_body and not fields["body"].strip():
        fields["body"] = mime.html_to_text(html_body)
    snippet = re.sub(r"\s+", " ", fields["body"]).strip()[:200]
    if did:
        with db.conn() as c:
            # Ảnh đã chèn nhưng người dùng xóa khỏi nội dung thì bỏ luôn tệp ảnh.
            for a in db.list_attachments(did):
                if a["inline"] and ("cid:%s" % a["cid"]) not in (html_body or ""):
                    c.execute("DELETE FROM attachments WHERE id=?", (a["id"],))
            c.execute("UPDATE messages SET to_addrs=?,cc_addrs=?,bcc_addrs=?,subject=?,body_text=?,body_html=?,"
                      "snippet=?,date=? WHERE id=?",
                      (fields["to"], fields["cc"], fields["bcc"], fields["subject"], fields["body"], html_body,
                       snippet, time.time(), did))
            delivery.rebuild_draft(c, g.user, did)
        return jsonify(id=did)
    in_reply_to = refs = None
    reply_id, fwd_id = as_id(d.get("reply_to_id")), as_id(d.get("forward_of"))
    orig = own_message(reply_id) if reply_id else None
    if orig and orig["msgid"]:
        in_reply_to = orig["msgid"][:998]
        refs = ((orig["refs"] or "") + " " + orig["msgid"]).strip()[-4000:]
    with db.conn() as c:
        cur = c.execute(
            "INSERT INTO messages(user_id,folder,from_addr,from_name,to_addrs,cc_addrs,bcc_addrs,subject,body_text,"
            "body_html,snippet,date,is_read,in_reply_to,refs,moved) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)",
            (uid, "drafts", g.user["email"], g.user["name"], fields["to"], fields["cc"], fields["bcc"],
             fields["subject"], fields["body"], html_body, snippet, time.time(), in_reply_to, refs, time.time()))
        did = cur.lastrowid
        fwd = own_message(fwd_id) if fwd_id else None
        if fwd:
            c.execute("INSERT INTO attachments(message_id,filename,ctype,size,data) "
                      "SELECT ?,filename,ctype,size,data FROM attachments WHERE message_id=? AND inline=0",
                      (did, fwd["id"]))
            db.refresh_has_attach(c, did)
        delivery.rebuild_draft(c, g.user, did)
    atts = [{"id": a["id"], "filename": a["filename"], "size": a["size"]} for a in db.list_attachments(did)]
    return jsonify(id=did, attachments=atts)


@app.post("/api/drafts/<int:did>/attachments")
@login_required
def add_attachment(did):
    if not own_draft(did):
        return err("Thư nháp không còn tồn tại.", 404)
    f = request.files.get("file")
    if not f:
        return err("Chưa chọn tệp.")
    data = f.read()
    used = db.conn().execute("SELECT COALESCE(SUM(size),0) FROM attachments WHERE message_id=?",
                             (did,)).fetchone()[0]
    if used + len(data) > config.MAX_SIZE * 0.7:
        return err("Tổng dung lượng tệp đính kèm vượt quá giới hạn.", 413)
    name = os.path.basename((f.filename or "").replace("\\", "/"))
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)[:200] or "tep-dinh-kem"
    inline = request.form.get("inline") == "1"
    ctype, cid = f.mimetype or "application/octet-stream", None
    if inline:  # ảnh chèn vào giữa nội dung thư
        ctype = mime.image_type(data)
        if not ctype:
            return err("Chỉ chèn được ảnh PNG, JPEG, GIF hoặc WebP.")
        cid = "%s@%s" % (secrets.token_hex(12), config.DOMAIN)
    with db.conn() as c:
        cur = c.execute("INSERT INTO attachments(message_id,filename,ctype,size,cid,inline,data) VALUES(?,?,?,?,?,?,?)",
                        (did, name, ctype, len(data), cid, int(inline), data))
        db.refresh_has_attach(c, did)
        if not inline:
            delivery.rebuild_draft(c, g.user, did)
    return jsonify(id=cur.lastrowid, filename=name, size=len(data),
                   url="/api/messages/%d/attachments/%d" % (did, cur.lastrowid))


@app.delete("/api/drafts/<int:did>/attachments/<int:aid>")
@login_required
def remove_attachment(did, aid):
    if not own_draft(did):
        return err("Thư nháp không còn tồn tại.", 404)
    with db.conn() as c:
        c.execute("DELETE FROM attachments WHERE id=? AND message_id=?", (aid, did))
        db.refresh_has_attach(c, did)
        delivery.rebuild_draft(c, g.user, did)
    return jsonify(ok=True)


@app.post("/api/drafts/<int:did>/send")
@login_required
def send(did):
    draft = own_draft(did)
    if not draft:
        return err("Thư nháp không còn tồn tại.", 404)
    try:
        delivery.send_draft(g.user, draft)
    except ValueError as e:
        return err(str(e))
    return jsonify(ok=True)
