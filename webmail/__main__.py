"""Chạy máy chủ:  python -m webmail
Quản lý người dùng:  python -m webmail adduser ten "Họ Tên" [--admin] | passwd ten | users
"""
import argparse
import getpass
import logging
import sys
import threading

from . import config, db, delivery


def _email(name):
    return name if "@" in name else "%s@%s" % (name, config.DOMAIN)


def _ask_password():
    pw = getpass.getpass("Mật khẩu (ít nhất 8 ký tự): ")
    if len(pw) < 8 or pw != getpass.getpass("Nhập lại mật khẩu: "):
        sys.exit("Mật khẩu quá ngắn hoặc không khớp.")
    return pw


def main():
    ap = argparse.ArgumentParser(prog="python -m webmail", description="Webmail + máy chủ thư")
    sub = ap.add_subparsers(dest="cmd")
    a = sub.add_parser("adduser", help="tạo hộp thư")
    a.add_argument("name")
    a.add_argument("fullname", nargs="?", default="")
    a.add_argument("--admin", action="store_true")
    p = sub.add_parser("passwd", help="đặt lại mật khẩu")
    p.add_argument("name")
    sub.add_parser("users", help="liệt kê hộp thư")
    sub.add_parser("dns", help="in các bản ghi DNS cần khai báo")
    args = ap.parse_args()

    db.init()
    if args.cmd == "adduser":
        email = _email(args.name).lower()
        if db.user_by_email(email):
            sys.exit("Hộp thư %s đã tồn tại." % email)
        db.create_user(email, args.fullname or args.name, _ask_password(), args.admin)
        print("Đã tạo", email)
        return
    if args.cmd == "passwd":
        user = db.user_by_email(_email(args.name))
        if not user:
            sys.exit("Không tìm thấy hộp thư.")
        db.set_password(user["id"], _ask_password())
        print("Đã đổi mật khẩu cho", user["email"])
        return
    if args.cmd == "users":
        for u in db.conn().execute("SELECT email,name,is_admin FROM users ORDER BY email"):
            print("%-32s %s%s" % (u["email"], u["name"], "  [quản trị]" if u["is_admin"] else ""))
        return

    if args.cmd == "dns":
        from . import security
        for r in security.dns_records():
            print("%-4s %s\n     %s\n     (%s)\n" % (r["type"], r["name"], r["value"], r["note"]))
        return

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    from waitress import serve
    from . import mailaccess, security
    from .web import app, load_secret

    load_secret()
    security.dkim_key()
    delivery.start_smtp()
    access = mailaccess.start()
    threading.Thread(target=delivery.outbox_worker, daemon=True).start()
    out = ("qua %s:%d" % (config.SMARTHOST, config.SMARTHOST_PORT)) if config.SMARTHOST else "gửi thẳng theo MX"
    print("Tên miền thư : %s" % ", ".join(config.DOMAINS))
    print("SMTP nhận thư: %s:%d" % (config.SMTP_HOST, config.SMTP_PORT))
    if config.SUBMISSION_PORT:
        print("SMTP gửi thư : %s:%d (STARTTLS + đăng nhập)" % (config.SMTP_HOST, config.SUBMISSION_PORT))
    print("Đọc thư      : %s" % ", ".join("%s %d" % a for a in access))
    print("Gửi ra ngoài : %s" % out)
    print("TLS          : %s" % ("chứng chỉ tự ký (ứng dụng thư sẽ cảnh báo; hãy đặt TLS_CERT/TLS_KEY)"
                                 if security.tls_self_signed() else config.TLS_CERT))
    print("Webmail      : http://%s:%d" % (config.WEB_HOST, config.WEB_PORT))
    if db.user_count() == 0:
        print("\n>>> Mã thiết lập lần đầu: %s  (nhập mã này trên trang web để tạo tài khoản quản trị)\n"
              % security.setup_token())
    serve(app, host=config.WEB_HOST, port=config.WEB_PORT, threads=8, ident=None)


if __name__ == "__main__":
    main()
