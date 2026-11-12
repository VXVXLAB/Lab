"""Dòng lệnh của DroidLite. Không có tham số thì mở bảng điều khiển trong trình duyệt."""

import argparse
import sys

from . import __version__
from .core import DroidLite, LicenseRequired


def _progress():
    last = {"pct": -1}

    def show(name, done, total, msg=""):
        pct = int(done * 100 / total) if total else 0
        if pct != last["pct"] or msg:
            last["pct"] = pct
            print(f"\r  {name}: {pct:3d}% {msg or ''}".ljust(78), end="", flush=True)
    return show


def _with_license(work, assume_yes):
    """Chạy work(accept); nếu cần giấy phép thì hiện tóm tắt và hỏi người dùng."""
    try:
        return work(assume_yes)
    except LicenseRequired as exc:
        print(f"\nGói này yêu cầu chấp nhận giấy phép '{exc.license_id}' của Google:\n")
        print(exc.text.strip()[:1500])
        print("\n[...] Toàn văn: https://developer.android.com/studio/terms")
        if input("Bạn có chấp nhận giấy phép này không? [y/N] ").strip().lower() != "y":
            sys.exit("Đã hủy vì chưa chấp nhận giấy phép.")
        return work(True)


def build_parser():
    p = argparse.ArgumentParser(prog="droidlite", description="Giả lập Android siêu nhẹ.")
    p.add_argument("--version", action="version", version=__version__)
    p.add_argument("--home", help="thư mục dữ liệu (mặc định: %%LOCALAPPDATA%%\\DroidLite)")
    sub = p.add_subparsers(dest="cmd")
    ui = sub.add_parser("ui", help="mở bảng điều khiển (mặc định)")
    ui.add_argument("--port", type=int, default=0)
    ui.add_argument("--no-browser", action="store_true")
    sub.add_parser("doctor", help="kiểm tra máy có đủ điều kiện chạy giả lập")
    st = sub.add_parser("setup", help="tải lõi giả lập và adb")
    st.add_argument("--update", action="store_true")
    st.add_argument("-y", "--yes", action="store_true", help="chấp nhận giấy phép")
    im = sub.add_parser("images", help="liệt kê các phiên bản Android")
    im.add_argument("--installed", action="store_true")
    ins = sub.add_parser("install", help="tải một phiên bản Android, ví dụ: install 34")
    ins.add_argument("api")
    ins.add_argument("--tag", default="default",
                     help="default (nhẹ nhất), google_apis, google_apis_playstore")
    ins.add_argument("--abi")
    ins.add_argument("-y", "--yes", action="store_true")
    cr = sub.add_parser("create", help="tạo máy ảo")
    cr.add_argument("name")
    cr.add_argument("api")
    cr.add_argument("--tag", default="default")
    cr.add_argument("--abi")
    cr.add_argument("--ram", type=int)
    cr.add_argument("--cores", type=int, default=2)
    cr.add_argument("--screen", default="phone-hd")
    sub.add_parser("list", help="liệt kê máy ảo")
    sa = sub.add_parser("start", help="chạy máy ảo")
    sa.add_argument("name")
    sa.add_argument("--gpu", default="auto")
    sa.add_argument("--cold-boot", action="store_true")
    sa.add_argument("--wipe", action="store_true")
    sa.add_argument("--audio", action="store_true")
    sa.add_argument("--headless", action="store_true")
    sa.add_argument("--accel", default="auto")
    sa.add_argument("--wait", action="store_true", help="chờ Android khởi động xong")
    for name, text in (("stop", "tắt máy ảo"), ("delete", "xóa máy ảo"),
                       ("shot", "chụp màn hình")):
        sub.add_parser(name, help=text).add_argument("name")
    apk = sub.add_parser("apk", help="cài file APK vào máy ảo đang chạy")
    apk.add_argument("name")
    apk.add_argument("file")
    adb = sub.add_parser("adb", help="chạy lệnh adb trên máy ảo, ví dụ: adb may1 shell ls")
    adb.add_argument("name")
    adb.add_argument("args", nargs=argparse.REMAINDER)
    return p


def main(argv=None):
    a = build_parser().parse_args(argv)
    app = DroidLite(a.home)
    cmd = a.cmd or "ui"
    if cmd == "ui":
        from .server import Panel
        Panel(app, getattr(a, "port", 0)).serve(not getattr(a, "no_browser", False))
    elif cmd == "doctor":
        for key, value in app.doctor().items():
            print(f"{key:15} {value}")
    elif cmd == "setup":
        done = _with_license(
            lambda ok: app.setup(accept=ok, progress=_progress(), update=a.update), a.yes)
        print("\nĐã cài: " + (", ".join(done) if done else "không có gì mới"))
    elif cmd == "images":
        for i in app.images():
            if a.installed and not i["installed"]:
                continue
            mark = "*" if i["installed"] else " "
            print(f"{mark} API {i['api']:5} Android {i['android'] or '?':4} {i['tag']:22} "
                  f"{i['abi']:7} {i['size'] >> 20:5} MB")
        print("(* = đã cài)")
    elif cmd == "install":
        path = app.find_image(a.api, a.tag, a.abi)
        _with_license(lambda ok: app.install_image(path, accept=ok, progress=_progress()), a.yes)
        print(f"\nĐã cài {path}")
    elif cmd == "create":
        path = app.find_image(a.api, a.tag, a.abi)
        options = {"cores": a.cores, "screen": a.screen}
        if a.ram:
            options["ram"] = a.ram
        print("Đã tạo máy ảo tại " + app.create_avd(a.name, path, **options))
    elif cmd == "list":
        running = app.running()
        for item in app.avds():
            state = running.get(item["name"], {}).get("serial", "đang tắt")
            print(f"{item['name']:20} {item['image']:45} {item['ram']} MB  {state}")
    elif cmd == "start":
        info = app.start(a.name, gpu=a.gpu, cold_boot=a.cold_boot, wipe=a.wipe,
                         audio=a.audio, headless=a.headless, accel=a.accel)
        print(f"Đang khởi động {a.name} ({info['serial']}), nhật ký: {info['log']}")
        if a.wait:
            app.wait_boot(info["serial"])
            print("Android đã khởi động xong.")
    elif cmd == "stop":
        app.stop(a.name)
        print(f"Đã gửi lệnh tắt {a.name}")
    elif cmd == "delete":
        app.delete_avd(a.name)
        print(f"Đã xóa {a.name}")
    elif cmd == "shot":
        print(app.screenshot(a.name))
    elif cmd == "apk":
        print(app.act(a.name, "install_apk", path=a.file))
    elif cmd == "adb":
        import subprocess
        argv = [app.exe("adb"), "-s", app.serial_of(a.name), *a.args]
        return subprocess.call(argv, env=app.env())   # nối thẳng bàn phím, dùng được shell
    return 0


def run():
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, OSError, TimeoutError) as exc:
        sys.exit(f"Lỗi: {exc}")
