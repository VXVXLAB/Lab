"""Lệnh điều khiển máy ảo đang chạy. Mỗi hành động trả về danh sách tham số cho adb."""

import re
import shlex

KEYS = {"back": 4, "home": 3, "recents": 187, "power": 26, "menu": 82,
        "volume_up": 24, "volume_down": 25, "enter": 66}
NET_SPEEDS = ("gsm", "hscsd", "gprs", "edge", "umts", "hsdpa", "lte", "evdo", "full")
NET_DELAYS = ("gprs", "edge", "umts", "none")
_SNAP_RE = re.compile(r"^[A-Za-z0-9._-]{1,48}$")
_PHONE_RE = re.compile(r"^\+?[0-9]{1,20}$")


def _need(cond, message):
    if not cond:
        raise ValueError(message)


def _snap(name):
    _need(_SNAP_RE.match(name or ""), "tên snapshot chỉ gồm chữ, số, dấu chấm, gạch")
    return name


def _phone(number):
    _need(_PHONE_RE.match(number or ""), "số điện thoại không hợp lệ")
    return number


def _num(value, low, high, what):
    number = float(value)
    _need(low <= number <= high, f"{what} phải nằm trong khoảng {low} đến {high}")
    return number


def key(name):
    _need(name in KEYS, f"không có phím: {name}")
    return ["shell", "input", "keyevent", str(KEYS[name])]


def text(value):
    _need(value, "chưa nhập nội dung")
    return ["shell", "input", "text", shlex.quote(value.replace(" ", "%s"))]


def open_url(url):
    _need(re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", url or ""), "địa chỉ phải có dạng scheme:...")
    return ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", shlex.quote(url)]


def gps(lat, lon):
    lat, lon = _num(lat, -90, 90, "vĩ độ"), _num(lon, -180, 180, "kinh độ")
    return ["emu", "geo", "fix", repr(lon), repr(lat)]   # console nhận kinh độ trước


def battery(percent):
    return ["emu", "power", "capacity", str(int(_num(percent, 0, 100, "mức pin")))]


def charging(on):
    return ["emu", "power", "ac", "on" if on else "off"]


def network(speed="full", delay="none"):
    _need(speed in NET_SPEEDS, f"tốc độ mạng phải là một trong: {', '.join(NET_SPEEDS)}")
    _need(delay in NET_DELAYS, f"độ trễ mạng phải là một trong: {', '.join(NET_DELAYS)}")
    return [["emu", "network", "speed", speed], ["emu", "network", "delay", delay]]


def sms(number, message):
    _need(message and "\n" not in message, "nội dung tin nhắn trống hoặc có xuống dòng")
    return ["emu", "sms", "send", _phone(number), message]


def call(number):
    return ["emu", "gsm", "call", _phone(number)]


def hangup(number):
    return ["emu", "gsm", "cancel", _phone(number)]


def snapshot(op, name=""):
    _need(op in ("save", "load", "delete", "list"), "thao tác snapshot không hợp lệ")
    if op == "list":
        return ["emu", "avd", "snapshot", "list"]
    return ["emu", "avd", "snapshot", op, _snap(name)]


def install_apk(path):
    _need(path, "chưa chọn file APK")
    return ["install", "-r", path]


def uninstall(package):
    _need(re.match(r"^[A-Za-z0-9._]+$", package or ""), "tên gói không hợp lệ")
    return ["uninstall", package]


def push(local, remote):
    _need(local and remote, "thiếu đường dẫn")
    return ["push", local, remote]


def pull(remote, local):
    _need(local and remote, "thiếu đường dẫn")
    return ["pull", remote, local]


def shell(command):
    _need(command and command.strip(), "chưa nhập lệnh")
    return ["shell", command]


def logcat(lines=200):
    return ["logcat", "-d", "-t", str(int(_num(lines, 1, 5000, "số dòng")))]


def proxy(host="", port=0):
    """Đặt proxy HTTP toàn hệ thống (để soi lưu lượng); bỏ trống host để gỡ."""
    if not host:
        return ["shell", "settings", "put", "global", "http_proxy", ":0"]
    _need(re.match(r"^[A-Za-z0-9.-]{1,253}$", host), "địa chỉ proxy không hợp lệ")
    port = int(_num(port, 1, 65535, "cổng proxy"))
    return ["shell", "settings", "put", "global", "http_proxy", f"{host}:{port}"]


SIMPLE = {
    "rotate": ["emu", "rotate"],
    "fingerprint": ["emu", "finger", "touch", "1"],
    "root": ["root"],
    "unroot": ["unroot"],
    "packages": ["shell", "pm", "list", "packages", "-3"],
    "kill": ["emu", "kill"],
}
BUILDERS = {
    "key": key, "text": text, "open_url": open_url, "gps": gps, "battery": battery,
    "charging": charging, "network": network, "sms": sms, "call": call, "hangup": hangup,
    "snapshot": snapshot, "install_apk": install_apk, "uninstall": uninstall,
    "push": push, "pull": pull, "proxy": proxy, "shell": shell, "logcat": logcat,
}


def commands(action, **params):
    """Danh sách các lệnh adb (mỗi lệnh là một list tham số) cho một hành động."""
    if action in SIMPLE:
        return [list(SIMPLE[action])]
    if action not in BUILDERS:
        raise ValueError(f"không có hành động: {action}")
    built = BUILDERS[action](**params)
    return built if built and isinstance(built[0], list) else [built]
