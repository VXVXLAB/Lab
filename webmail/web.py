"""API web và phục vụ giao diện webmail."""
import os
import re
import secrets
import time
from datetime import timedelta
from functools import wraps
from urllib.parse import quote

from flask import Flask, Response, g, jsonify, request, send_from_directory, session

from . import config, db, delivery, mime

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
FOLDERS = ("inbox", "sent", "drafts", "trash")
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

_fails = {}  # ip -> [số lần sai, khóa đến lúc]


def load_secret():
    os.makedirs(config.DATA_DIR, exist_ok=True)
    path = os.path.join(config.DATA_DIR, "secret.key")
    if not os.path.exists(path):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        app.secret_key = f.read().strip()


def err(message, code=400):
    return jsonify(error=message), code


def login_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        user = db.get_user(session.get("uid") or 0)
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
    if len(pw or "") < 8:
        raise ValueError("Mật khẩu cần ít nhất 8 ký tự.")


@app.get("/api/me")
def me():
    user = db.get_user(session.get("uid") or 0)
    return jsonify(user=user_json(user) if user else None, setup=db.user_count() == 0, domain=config.DOMAIN,
                   max_mb=config.MAX_SIZE // 1024 // 1024)


@app.post("/api/setup")
def setup():
    """Lần chạy đầu tiên: tạo tài khoản quản trị."""
    if db.user_count():
        return err("Hệ thống đã được thiết lập.", 403)
    d = request.get_json(silent=True) or {}
    local = (d.get("email") or "").strip().lower().split("@")[0]
    try:
        if not LOCAL_RE.match(local):
            raise ValueError("Tên hộp thư chỉ gồm chữ thường, số, dấu chấm, gạch nối.")
        check_new_password(d.get("password"))
    except ValueError as e:
        return err(str(e))
    uid = db.create_user("%s@%s" % (local, config.DOMAIN), d.get("name") or local, d["password"], True)
    session.clear()
    session.permanent = True
    session["uid"] = uid
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
    ip = request.remote_addr or "?"
    rec = _fails.get(ip, [0, 0])
    if rec[1] > time.time():
        return err("Sai mật khẩu quá nhiều lần. Hãy thử lại sau vài phút.", 429)
    d = request.get_json(silent=True) or {}
    email = (d.get("email") or "").strip().lower()
    if "@" not in email:
        email = "%s@%s" % (email, config.DOMAIN)
    user = db.user_by_email(email)
    if not user or not db.check_password(d.get("password") or "", user["pw_hash"]):
        rec[0] += 1
        if rec[0] >= 5:
            rec = [0, time.time() + 300]
        _fails[ip] = rec
        return err("Địa chỉ thư hoặc mật khẩu không đúng.", 401)
    _fails.pop(ip, None)
    session.clear()
    session.permanent = True
    session["uid"] = user["id"]
    return jsonify(user=user_json(user))


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.post("/api/password")
@login_required
def change_password():
    d = request.get_json(silent=True) or {}
    if not db.check_password(d.get("old") or "", g.user["pw_hash"]):
        return err("Mật khẩu hiện tại không đúng.")
    try:
        check_new_password(d.get("new"))
    except ValueError as e:
        return err(str(e))
    db.set_password(g.user["id"], d["new"])
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
    local = (d.get("email") or "").strip().lower().split("@")[0]
    try:
        if not LOCAL_RE.match(local):
            raise ValueError("Tên hộp thư chỉ gồm chữ thường, số, dấu chấm, gạch nối.")
        check_new_password(d.get("password"))
    except ValueError as e:
        return err(str(e))
    email = "%s@%s" % (local, config.DOMAIN)
    if db.user_by_email(email):
        return err("Hộp thư %s đã tồn tại." % email)
    uid = db.create_user(email, d.get("name") or local, d["password"], bool(d.get("is_admin")))
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
    latest = c.execute("SELECT COALESCE(MAX(id),0) FROM messages WHERE user_id=? AND folder='inbox'",
                       (uid,)).fetchone()[0]
    return jsonify(counts=counts, latest=latest)


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
    elif folder in FOLDERS and not (q and folder != "trash"):
        where.append("folder=?")
        params.append(folder)
    elif folder not in FOLDERS:
        return err("Thư mục không tồn tại.", 404)
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


def apply_action(c, uid, ids, action):
    marks = ",".join("?" * len(ids))
    base = " WHERE user_id=? AND id IN (%s)" % marks
    args = [uid] + ids
    if action in ("read", "unread"):
        c.execute("UPDATE messages SET is_read=?" + base, [int(action == "read")] + args)
    elif action in ("star", "unstar"):
        c.execute("UPDATE messages SET starred=?" + base, [int(action == "star")] + args)
    elif action == "delete":
        c.execute("DELETE FROM messages" + base + " AND folder IN ('trash','drafts')", args)
        c.execute("UPDATE messages SET prev_folder=folder, folder='trash'" + base, args)
    elif action == "restore":
        c.execute("UPDATE messages SET folder=COALESCE(prev_folder,'inbox'), prev_folder=NULL" + base +
                  " AND folder='trash'", args)
    else:
        raise ValueError("Thao tác không hợp lệ.")


@app.post("/api/messages/action")
@login_required
def messages_action():
    d = request.get_json(silent=True) or {}
    ids = [int(i) for i in d.get("ids") or [] if str(i).isdigit()][:500]
    if not ids:
        return err("Chưa chọn thư nào.")
    try:
        with db.conn() as c:
            apply_action(c, g.user["id"], ids, d.get("action"))
    except ValueError as e:
        return err(str(e))
    return jsonify(ok=True)


@app.post("/api/trash/empty")
@login_required
def empty_trash():
    with db.conn() as c:
        c.execute("DELETE FROM messages WHERE user_id=? AND folder='trash'", (g.user["id"],))
    return jsonify(ok=True)


# ---------- soạn thư ----------

def own_draft(mid):
    r = own_message(mid)
    return r if r and r["folder"] == "drafts" else None


@app.post("/api/drafts")
@login_required
def save_draft():
    d = request.get_json(silent=True) or {}
    fields = {k: str(d.get(k) or "") for k in ("to", "cc", "bcc", "subject", "body")}
    snippet = re.sub(r"\s+", " ", fields["body"]).strip()[:200]
    uid = g.user["id"]
    if d.get("id"):
        if not own_draft(int(d["id"])):
            return err("Thư nháp không còn tồn tại.", 404)
        with db.conn() as c:
            c.execute("UPDATE messages SET to_addrs=?,cc_addrs=?,bcc_addrs=?,subject=?,body_text=?,snippet=?,date=?"
                      " WHERE id=?", (fields["to"], fields["cc"], fields["bcc"], fields["subject"], fields["body"],
                                      snippet, time.time(), int(d["id"])))
        return jsonify(id=int(d["id"]))
    in_reply_to = refs = None
    orig = own_message(int(d["reply_to_id"])) if d.get("reply_to_id") else None
    if orig and orig["msgid"]:
        in_reply_to = orig["msgid"]
        refs = ((orig["refs"] or "") + " " + orig["msgid"]).strip()
    with db.conn() as c:
        cur = c.execute(
            "INSERT INTO messages(user_id,folder,from_addr,from_name,to_addrs,cc_addrs,bcc_addrs,subject,body_text,"
            "snippet,date,is_read,in_reply_to,refs) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
            (uid, "drafts", g.user["email"], g.user["name"], fields["to"], fields["cc"], fields["bcc"],
             fields["subject"], fields["body"], snippet, time.time(), in_reply_to, refs))
        did = cur.lastrowid
        fwd = own_message(int(d["forward_of"])) if d.get("forward_of") else None
        if fwd:
            c.execute("INSERT INTO attachments(message_id,filename,ctype,size,data) "
                      "SELECT ?,filename,ctype,size,data FROM attachments WHERE message_id=? AND inline=0",
                      (did, fwd["id"]))
            db.refresh_has_attach(c, did)
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
    name = os.path.basename((f.filename or "").replace("\\", "/")) or "tep-dinh-kem"
    with db.conn() as c:
        cur = c.execute("INSERT INTO attachments(message_id,filename,ctype,size,data) VALUES(?,?,?,?,?)",
                        (did, name, f.mimetype or "application/octet-stream", len(data), data))
        db.refresh_has_attach(c, did)
    return jsonify(id=cur.lastrowid, filename=name, size=len(data))


@app.delete("/api/drafts/<int:did>/attachments/<int:aid>")
@login_required
def remove_attachment(did, aid):
    if not own_draft(did):
        return err("Thư nháp không còn tồn tại.", 404)
    with db.conn() as c:
        c.execute("DELETE FROM attachments WHERE id=? AND message_id=?", (aid, did))
        db.refresh_has_attach(c, did)
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
