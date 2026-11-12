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
  has_attach INTEGER NOT NULL DEFAULT 0
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
        os.makedirs(config.DATA_DIR, exist_ok=True)
        c = sqlite3.connect(config.DB_PATH, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        _local.c = c
    return c


def init():
    with conn() as c:
        c.executescript(SCHEMA)


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


# ---------- thư ----------

def insert_message(user_id, folder, p, raw=None, is_read=0, bcc="", date=None):
    """p: dict từ mime.parse(). Trả về id thư."""
    with conn() as c:
        cur = c.execute(
            """INSERT INTO messages(user_id,folder,msgid,in_reply_to,refs,from_addr,from_name,reply_to,
               to_addrs,cc_addrs,bcc_addrs,subject,date,snippet,body_text,body_html,raw,size,is_read,has_attach)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (user_id, folder, p.get("msgid"), p.get("in_reply_to"), p.get("refs"),
             p.get("from_addr", ""), p.get("from_name", ""), p.get("reply_to", ""),
             p.get("to", ""), p.get("cc", ""), bcc, p.get("subject", ""),
             date or time.time(), p.get("snippet", ""), p.get("text", ""), p.get("html"),
             raw, len(raw) if raw else 0, is_read,
             int(any(not a["inline"] for a in p.get("attachments", [])))),
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
