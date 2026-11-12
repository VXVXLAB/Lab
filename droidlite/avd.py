"""Tạo và quản lý máy ảo (AVD) bằng cách ghi trực tiếp file cấu hình, không cần avdmanager."""

import os
import re
import shutil

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,48}$")
CPU_ARCH = {"x86": "x86", "x86_64": "x86_64", "arm64-v8a": "arm64", "armeabi-v7a": "arm"}
SCREENS = {
    "phone-hd": (720, 1280, 320),
    "phone-fhd": (1080, 1920, 420),
    "phone-small": (480, 800, 240),
    "tablet": (1280, 800, 213),
}
TAG_DISPLAY = {
    "default": "Default Android System Image",
    "google_apis": "Google APIs",
    "google_apis_playstore": "Google Play",
}


def check_name(name):
    if not NAME_RE.match(name or ""):
        raise ValueError("tên máy ảo chỉ gồm chữ, số, dấu chấm, gạch dưới, gạch ngang")
    return name


def default_ram(api):
    """RAM tối thiểu chạy ổn cho từng đời Android (MB)."""
    try:
        level = float(api)
    except ValueError:
        return 2048
    if level <= 25:
        return 1024
    if level <= 29:
        return 1536
    return 2048


def build_config(name, image_path, ram=None, cores=2, screen="phone-hd",
                 data_mb=2048, sdcard_mb=512):
    """Nội dung config.ini cho một máy ảo. image_path dạng system-images;android-N;tag;abi."""
    check_name(name)
    parts = image_path.split(";")
    if len(parts) != 4 or parts[0] != "system-images":
        raise ValueError(f"ảnh hệ thống không hợp lệ: {image_path}")
    _, platform, tag, abi = parts
    if abi not in CPU_ARCH:
        raise ValueError(f"không hỗ trợ ABI: {abi}")
    if screen not in SCREENS:
        raise ValueError(f"không có kiểu màn hình: {screen}")
    api = platform.split("-", 1)[-1]
    ram = int(ram or default_ram(api))
    cores = int(cores)
    if not 512 <= ram <= 16384 or not 1 <= cores <= 16:
        raise ValueError("RAM phải từ 512 đến 16384 MB, số nhân từ 1 đến 16")
    width, height, density = SCREENS[screen]
    return {
        "AvdId": name,
        "avd.ini.displayname": name,
        "avd.ini.encoding": "UTF-8",
        "PlayStore.enabled": "true" if tag == "google_apis_playstore" else "false",
        "abi.type": abi,
        "hw.cpu.arch": CPU_ARCH[abi],
        "hw.cpu.ncore": str(cores),
        "hw.ramSize": str(ram),
        "vm.heapSize": "256",
        "image.sysdir.1": "/".join(parts) + "/",
        "tag.id": tag,
        "tag.display": TAG_DISPLAY.get(tag, tag),
        "hw.lcd.width": str(width),
        "hw.lcd.height": str(height),
        "hw.lcd.density": str(density),
        "hw.keyboard": "yes",
        "hw.mainKeys": "no",
        "hw.gpu.enabled": "yes",
        "hw.gpu.mode": "auto",
        "hw.sdCard": "yes",
        "sdcard.size": f"{int(sdcard_mb)}M",
        "disk.dataPartition.size": f"{int(data_mb)}M",
        "hw.camera.back": "emulated",
        "hw.camera.front": "emulated",
        "showDeviceFrame": "no",
        "fastboot.forceColdBoot": "no",
        "fastboot.forceFastBoot": "yes",
    }


def _write_ini(path, values):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        for key, value in values.items():
            f.write(f"{key}={value}\n")
    os.replace(tmp, path)


def read_ini(path):
    values = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                key, value = line.rstrip("\r\n").split("=", 1)
                values[key.strip()] = value.strip()
    return values


def create(avd_home, name, config, overwrite=False):
    check_name(name)
    folder = os.path.join(avd_home, name + ".avd")
    pointer = os.path.join(avd_home, name + ".ini")
    if os.path.exists(pointer) or os.path.exists(folder):
        if not overwrite:
            raise FileExistsError(f"máy ảo '{name}' đã tồn tại")
        delete(avd_home, name)
    os.makedirs(folder)
    _write_ini(os.path.join(folder, "config.ini"), config)
    platform = config["image.sysdir.1"].split("/")[1]
    _write_ini(pointer, {
        "avd.ini.encoding": "UTF-8",
        "path": folder,
        "path.rel": f"avd/{name}.avd",
        "target": platform,
    })
    return folder


def list_all(avd_home):
    found = []
    if not os.path.isdir(avd_home):
        return found
    for entry in sorted(os.listdir(avd_home)):
        if not entry.endswith(".ini"):
            continue
        name = entry[:-4]
        cfg_path = os.path.join(avd_home, name + ".avd", "config.ini")
        if not os.path.exists(cfg_path):
            continue
        cfg = read_ini(cfg_path)
        image = cfg.get("image.sysdir.1", "").strip("/\\").replace("\\", "/").replace("/", ";")
        found.append({
            "name": name, "image": image, "abi": cfg.get("abi.type", ""),
            "tag": cfg.get("tag.id", ""), "ram": int(cfg.get("hw.ramSize", "0") or 0),
            "cores": int(cfg.get("hw.cpu.ncore", "0") or 0),
            "screen": f"{cfg.get('hw.lcd.width', '?')}x{cfg.get('hw.lcd.height', '?')}",
        })
    return found


def delete(avd_home, name):
    check_name(name)
    shutil.rmtree(os.path.join(avd_home, name + ".avd"), ignore_errors=True)
    pointer = os.path.join(avd_home, name + ".ini")
    if os.path.exists(pointer):
        os.remove(pointer)
