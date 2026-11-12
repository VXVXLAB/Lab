"""Đọc danh mục gói của kho Android SDK (dl.google.com) mà không cần sdkmanager/Java."""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass

BASE = "https://dl.google.com/android/repository/"
MANIFESTS = {
    "core": "repository2-3.xml",
    "default": "sys-img/android/sys-img2-3.xml",
    "google_apis": "sys-img/google_apis/sys-img2-3.xml",
    "google_apis_playstore": "sys-img/google_apis_playstore/sys-img2-3.xml",
}
IMAGE_TAGS = ("default", "google_apis", "google_apis_playstore")
_RELEASE_RE = re.compile(r"^android-\d+(\.\d+)?$")
ANDROID_NAMES = {
    "10": "2.3", "14": "4.0", "15": "4.0.3", "16": "4.1", "17": "4.2", "18": "4.3",
    "19": "4.4", "21": "5.0", "22": "5.1", "23": "6.0", "24": "7.0", "25": "7.1",
    "26": "8.0", "27": "8.1", "28": "9", "29": "10", "30": "11", "31": "12",
    "32": "12L", "33": "13", "34": "14", "35": "15", "36": "16",
}


@dataclass(frozen=True)
class Package:
    path: str            # ví dụ "emulator" hoặc "system-images;android-34;default;x86_64"
    revision: tuple
    display: str
    license: str
    channel: int         # 0 = ổn định, số lớn hơn = beta/dev/canary
    url: str
    size: int
    checksum: str
    checksum_type: str
    api: str = ""
    tag: str = ""
    abi: str = ""

    @property
    def version(self):
        return ".".join(str(n) for n in self.revision)

    @property
    def android(self):
        return ANDROID_NAMES.get(self.api, "")


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _text(node, name, default=""):
    child = node.find(name)
    return (child.text or "").strip() if child is not None else default


def _pick_archive(pkg, host_os, host_arch):
    """Chọn bản lưu khớp máy chủ; bản không ghi host-os thì dùng cho mọi hệ điều hành."""
    for arc in pkg.iterfind("archives/archive"):
        if _text(arc, "host-os", host_os) != host_os:
            continue
        if _text(arc, "host-arch", host_arch) != host_arch:
            continue
        comp = arc.find("complete")
        if comp is None:
            continue
        cks = comp.find("checksum")
        return (_text(comp, "url"), int(_text(comp, "size", "0")),
                (cks.text or "").strip() if cks is not None else "",
                (cks.get("type", "sha1") if cks is not None else "sha1"))
    return None


def parse_manifest(xml_bytes, base_url, host_os, host_arch="x64"):
    """Trả về (danh sách Package dùng được trên máy này, {mã giấy phép: nội dung})."""
    root = ET.fromstring(xml_bytes)
    licenses, channels, packages = {}, {}, []
    for node in root:
        kind = _local(node.tag)
        if kind == "license":
            licenses[node.get("id")] = node.text or ""
        elif kind == "channel":
            channels[node.get("id")] = (node.text or "").strip()
    order = {"stable": 0, "beta": 1, "dev": 2, "canary": 3}
    for pkg in root.iterfind("remotePackage"):
        arc = _pick_archive(pkg, host_os, host_arch)
        if not arc or pkg.get("obsolete") == "true":
            continue
        rev = pkg.find("revision")
        revision = tuple(int(_text(rev, k, "0") or 0) for k in ("major", "minor", "micro")) \
            if rev is not None else (0, 0, 0)
        details = pkg.find("type-details")
        lic = pkg.find("uses-license")
        ch = pkg.find("channelRef")
        ch_name = channels.get(ch.get("ref") if ch is not None else "", "stable")
        url = arc[0] if "://" in arc[0] else base_url + arc[0]
        api = _text(details, "api-level") if details is not None else ""
        tag = _text(details, "tag/id") if details is not None else ""
        abi = _text(details, "abi") if details is not None else ""
        parts = pkg.get("path").split(";")
        if parts[0] == "system-images" and len(parts) == 4:
            # thư mục cài đặt đi theo đường dẫn gói, nên lấy thông tin từ chính đường dẫn
            api, tag, abi = parts[1].split("-", 1)[-1], parts[2], parts[3]
        packages.append(Package(
            path=pkg.get("path"), revision=revision, display=_text(pkg, "display-name"),
            license=lic.get("ref") if lic is not None else "",
            channel=order.get(ch_name, 3), url=url, size=arc[1],
            checksum=arc[2], checksum_type=arc[3],
            api=api, tag=tag, abi=abi,
        ))
    return packages, licenses


def latest(packages, path, max_channel=0):
    """Bản mới nhất của một gói trong kênh cho phép (mặc định chỉ kênh ổn định)."""
    found = [p for p in packages if p.path == path and p.channel <= max_channel]
    return max(found, key=lambda p: p.revision) if found else None


def _api_key(api):
    try:
        return float(api)
    except ValueError:
        return 0.0


def system_images(packages, abis, max_channel=0):
    """Ảnh hệ thống chạy được với các ABI cho trước, bản mới nhất của mỗi đường dẫn."""
    best = {}
    for p in packages:
        if not p.path.startswith("system-images;") or p.abi not in abis:
            continue
        # kho gắn nhãn "ổn định" cho cả bản canary/beta, nên lọc theo tên nền tảng
        if not _RELEASE_RE.match(p.path.split(";")[1]) or p.tag not in IMAGE_TAGS:
            continue
        if p.channel > max_channel:
            continue
        if p.path not in best or p.revision > best[p.path].revision:
            best[p.path] = p
    return sorted(best.values(), key=lambda p: (-_api_key(p.api), p.tag, p.abi))
