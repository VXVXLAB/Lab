"""Lưu trữ SQLite: người dùng, thư, tệp đính kèm, hàng đợi gửi."""
import hashlib
import hmac
import os
import sqlite3
import threading
import time

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pw_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder TEXT NOT NULL,
  prev_folder TEXT,
  msgid TEXT, in_reply_to TEXT, refs TEXT,
  from_addr TEXT NOT NULL DEFAULT '', from_name TEXT NOT NULL DEFAULT '',
  reply_to TEXT NOT NULL DEFAULT '',
  to_addrs TEXT NOT NULL DEFAULT '', cc_addrs TEXT NOT NULL DEFAULT '', bcc_addrs TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  date REAL NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  raw BLOB,
  size INTEGER NOT NULL DEFAULT 0,
  is_read INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  has_attach INTEGER NOT NULL DEFAULT 0,
  uid INTEGER,
  imap_flags TEXT NOT NULL DEFAULT '',
  moved REAL,
  spam_trained INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS uidseq (id INTEGER PRIMARY KEY AUTOINCREMENT);
CREATE TABLE IF NOT EXISTS spam_tokens (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  spam INTEGER NOT NULL DEFAULT 0,
  ham INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, token)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS spam_stats (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  spam INTEGER NOT NULL DEFAULT 0,
  ham INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_msg_folder ON messages(user_id, folder, date DESC);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  ctype TEXT NOT NULL,
  size INTEGER NOT NULL,
  cid TEXT,
  inline INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_msg ON attachments(message_id);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  mail_from TEXT NOT NULL,
  rcpt TEXT NOT NULL,
  raw BLOB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try REAL NOT NULL,
  last_error TEXT
);
"""

_local = threading.local()


def conn():
    c = getattr(_local, "c", None)
    if c is None:
        os.makedirs(config.DATA_DIR, mode=0o700, exist_ok=True)
        c = sqlite3.connect(config.DB_PATH, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        _local.c = c
    return c


MIGRATIONS = [  # cột thêm sau phiên bản đầu
    ("uid", "INTEGER"), ("imap_flags", "TEXT NOT NULL DEFAULT ''"), ("moved", "REAL"),
    ("spam_trained", "INTEGER NOT NULL DEFAULT 0"),
]


def secure_files():
    """Chỉ chủ sở hữu tiến trình được đọc thư mục dữ liệu (thư và mật khẩu đã băm nằm trong đó)."""
    try:
        os.chmod(config.DATA_DIR, 0o700)
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(config.DB_PATH + suffix):
                os.chmod(config.DB_PATH + suffix, 0o600)
    except OSError:
        pass


def mailbox_size(user_id):
    return conn().execute("SELECT COALESCE(SUM(size),0) FROM messages WHERE user_id=?", (user_id,)).fetchone()[0]


def over_quota(user_id, extra=0):
    return bool(config.QUOTA) and mailbox_size(user_id) + extra > config.QUOTA


def init():
    os.umask(0o077)
    c = conn()
    secure_files()
    have = {r["name"] for r in c.execute("PRAGMA table_info(messages)")}
    with c:
        for name, decl in MIGRATIONS:
            if have and name not in have:
                c.execute("ALTER TABLE messages ADD COLUMN %s %s" % (name, decl))
        c.executescript(SCHEMA)
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_uid ON messages(uid)")
        for r in c.execute("SELECT id FROM messages WHERE uid IS NULL ORDER BY id").fetchall():
            c.execute("UPDATE messages SET uid=? WHERE id=?", (next_uid(c), r["id"]))


def next_uid(c):
    """UID IMAP: tăng dần trên toàn hệ thống, không bao giờ dùng lại."""
    uid = c.execute("INSERT INTO uidseq DEFAULT VALUES").lastrowid
    c.execute("DELETE FROM uidseq")
    return uid


def peek_next_uid():
    r = conn().execute("SELECT seq FROM sqlite_sequence WHERE name='uidseq'").fetchone()
    return (r[0] if r else 0) + 1


def move_messages(c, user_id, ids, folder):
    """Chuyển thư sang thư mục khác; mỗi thư nhận UID mới (yêu cầu của IMAP). Trả về {id: uid mới}."""
    out = {}
    for mid in ids:
        r = c.execute("SELECT folder FROM messages WHERE id=? AND user_id=?", (mid, user_id)).fetchone()
        if not r or r["folder"] == folder:
            continue
        uid = next_uid(c)
        c.execute("UPDATE messages SET prev_folder=folder, folder=?, uid=?, moved=?, "
                  "imap_flags=trim(replace(imap_flags, '\\Deleted', '')) WHERE id=?",
                  (folder, uid, time.time(), mid))
        out[mid] = uid
    return out


# ---------- mật khẩu ----------

def hash_password(password):
    salt = os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1)
    return "scrypt$%s$%s" % (salt.hex(), h.hex())


def check_password(password, stored):
    try:
        _, salt, h = stored.split("$")
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1)
        return hmac.compare_digest(calc.hex(), h)
    except Exception:
        return False


# ---------- người dùng ----------

def user_count():
    return conn().execute("SELECT COUNT(*) FROM users").fetchone()[0]


def get_user(uid):
    return conn().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()


def user_by_email(email):
    return conn().execute("SELECT * FROM users WHERE email=?", (email.strip().lower(),)).fetchone()


def find_local_user(address):
    """Tìm hộp thư cho địa chỉ nhận; hỗ trợ dạng ten+nhan@mien."""
    local, _, domain = address.strip().lower().rpartition("@")
    if not local or domain not in config.DOMAINS:
        return None
    return user_by_email("%s@%s" % (local.split("+")[0], domain))


def create_user(email, name, password, is_admin=False):
    with conn() as c:
        cur = c.execute(
            "INSERT INTO users(email,name,pw_hash,is_admin,created) VALUES(?,?,?,?,?)",
            (email.strip().lower(), name.strip(), hash_password(password), int(is_admin), time.time()),
        )
        return cur.lastrowid


def set_password(uid, password):
    with conn() as c:
        c.execute("UPDATE users SET pw_hash=? WHERE id=?", (hash_password(password), uid))


# ---------- thư mục ----------

SYSTEM_FOLDERS = ("inbox", "sent", "drafts", "spam", "trash")
RESERVED_NAMES = {"inbox", "sent", "drafts", "junk", "trash", "spam", "hộp thư đến", "thư đã gửi", "thư nháp",
                  "thư rác", "thùng rác", "có gắn sao"}
MAX_FOLDERS = 100


def list_folders(user_id):
    return conn().execute("SELECT id, name FROM folders WHERE user_id=? ORDER BY name COLLATE NOCASE",
                          (user_id,)).fetchall()


def folder_key(fid):
    return "f%d" % fid


def custom_folder(user_id, key):
    """Dòng thư mục tự tạo ứng với khóa 'f<id>' của đúng người dùng này, hoặc None."""
    if not isinstance(key, str) or not key.startswith("f") or not key[1:].isdigit() or len(key) > 12:
        return None
    return conn().execute("SELECT id, name FROM folders WHERE id=? AND user_id=?", (int(key[1:]), user_id)).fetchone()


def valid_folder(user_id, key):
    return key in SYSTEM_FOLDERS or custom_folder(user_id, key) is not None


def check_folder_name(user_id, name, skip_id=None):
    name = " ".join((name or "").split()) if isinstance(name, str) else ""
    if not 1 <= len(name) <= 60:
        raise ValueError("Tên thư mục dài từ 1 đến 60 ký tự.")
    if any(ch in name for ch in '/\\"%*{}()') or any(ord(ch) < 32 or ord(ch) == 127 for ch in name):
        raise ValueError("Tên thư mục không được chứa các ký tự / \\ \" % * { } ( )")
    if name.casefold() in RESERVED_NAMES:
        raise ValueError("Tên này trùng với thư mục có sẵn.")
    rows = list_folders(user_id)
    if any(r["name"].casefold() == name.casefold() and r["id"] != skip_id for r in rows):
        raise ValueError("Đã có thư mục tên này.")
    if skip_id is None and len(rows) >= MAX_FOLDERS:
        raise ValueError("Bạn đã tạo quá nhiều thư mục.")
    return name


def create_folder(user_id, name):
    name = check_folder_name(user_id, name)
    with conn() as c:
        return c.execute("INSERT INTO folders(user_id,name) VALUES(?,?)", (user_id, name)).lastrowid


def rename_folder(user_id, fid, name):
    name = check_folder_name(user_id, name, skip_id=fid)
    with conn() as c:
        c.execute("UPDATE folders SET name=? WHERE id=? AND user_id=?", (name, fid, user_id))


def delete_folder(user_id, fid):
    """Xóa thư mục tự tạo; thư bên trong được chuyển vào Thùng rác chứ không mất ngay."""
    with conn() as c:
        ids = [r["id"] for r in c.execute("SELECT id FROM messages WHERE user_id=? AND folder=?",
                                          (user_id, folder_key(fid)))]
        move_messages(c, user_id, ids, "trash")
        c.execute("DELETE FROM folders WHERE id=? AND user_id=?", (fid, user_id))


# ---------- thư ----------

def insert_message(user_id, folder, p, raw=None, is_read=0, bcc="", date=None, starred=0, imap_flags=""):
    """p: dict từ mime.parse(). Trả về id thư."""
    with conn() as c:
        cur = c.execute(
            """INSERT INTO messages(user_id,folder,msgid,in_reply_to,refs,from_addr,from_name,reply_to,
               to_addrs,cc_addrs,bcc_addrs,subject,date,snippet,body_text,body_html,raw,size,is_read,has_attach,
               uid,starred,imap_flags,moved)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (user_id, folder, p.get("msgid"), p.get("in_reply_to"), p.get("refs"),
             p.get("from_addr", ""), p.get("from_name", ""), p.get("reply_to", ""),
             p.get("to", ""), p.get("cc", ""), bcc, p.get("subject", ""),
             date or time.time(), p.get("snippet", ""), p.get("text", ""), p.get("html"),
             raw, len(raw) if raw else 0, is_read,
             int(any(not a["inline"] for a in p.get("attachments", []))),
             next_uid(c), starred, imap_flags, time.time()),
        )
        mid = cur.lastrowid
        for a in p.get("attachments", []):
            c.execute(
                "INSERT INTO attachments(message_id,filename,ctype,size,cid,inline,data) VALUES(?,?,?,?,?,?,?)",
                (mid, a["filename"], a["ctype"], len(a["data"]), a.get("cid"), int(a["inline"]), a["data"]),
            )
        return mid


def get_message(user_id, mid):
    return conn().execute("SELECT * FROM messages WHERE id=? AND user_id=?", (mid, user_id)).fetchone()


def list_attachments(mid, with_data=False):
    cols = "*" if with_data else "id,filename,ctype,size,cid,inline"
    return conn().execute("SELECT %s FROM attachments WHERE message_id=? ORDER BY id" % cols, (mid,)).fetchall()


def refresh_has_attach(c, mid):
    c.execute(
        "UPDATE messages SET has_attach=(SELECT COUNT(*)>0 FROM attachments WHERE message_id=? AND inline=0) WHERE id=?",
        (mid, mid),
    )
