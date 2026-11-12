"""Tải gói, kiểm tra mã băm và giải nén an toàn."""

import hashlib
import os
import shutil
import stat
import urllib.request
import zipfile

CHUNK = 1 << 20


class DownloadError(RuntimeError):
    pass


def download(url, dest, size=0, checksum="", checksum_type="sha1", progress=None):
    """Tải url về dest. Sai kích thước hoặc sai mã băm thì xóa file và báo lỗi."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    part = dest + ".part"
    digest = hashlib.new(checksum_type.replace("-", "")) if checksum else None
    done = 0
    req = urllib.request.Request(url, headers={"User-Agent": "droidlite"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp, open(part, "wb") as out:
            total = size or int(resp.headers.get("Content-Length") or 0)
            while True:
                block = resp.read(CHUNK)
                if not block:
                    break
                out.write(block)
                if digest:
                    digest.update(block)
                done += len(block)
                if progress:
                    progress(done, total)
        if size and done != size:
            raise DownloadError(f"tải thiếu dữ liệu: {done}/{size} byte")
        if digest and digest.hexdigest().lower() != checksum.lower():
            raise DownloadError("mã băm không khớp, file có thể bị hỏng hoặc bị thay đổi")
    except BaseException:
        if os.path.exists(part):
            os.remove(part)
        raise
    os.replace(part, dest)
    return dest


def _safe_target(root, name):
    target = os.path.realpath(os.path.join(root, name))
    if target != root and not target.startswith(root + os.sep):
        raise DownloadError(f"file nén chứa đường dẫn không an toàn: {name}")
    return target


def extract(zip_path, dest_root):
    """Giải nén vào dest_root, chặn đường dẫn thoát ra ngoài, giữ quyền chạy và symlink."""
    os.makedirs(dest_root, exist_ok=True)
    root = os.path.realpath(dest_root)
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            target = _safe_target(root, info.filename)
            mode = info.external_attr >> 16
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if stat.S_ISLNK(mode) and os.name != "nt":
                link = zf.read(info).decode()
                _safe_target(root, os.path.join(os.path.dirname(info.filename), link))
                if os.path.lexists(target):
                    os.remove(target)
                os.symlink(link, target)
                continue
            with zf.open(info) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out, CHUNK)
            if mode & 0o777 and os.name != "nt":
                os.chmod(target, mode & 0o777)


def install_zip(zip_path, final_dir, work_dir):
    """Giải nén gói có đúng một thư mục gốc rồi chuyển thư mục đó thành final_dir."""
    staging = os.path.join(work_dir, "extract-" + os.path.basename(zip_path))
    shutil.rmtree(staging, ignore_errors=True)
    try:
        extract(zip_path, staging)
        tops = os.listdir(staging)
        if len(tops) != 1 or not os.path.isdir(os.path.join(staging, tops[0])):
            raise DownloadError("cấu trúc gói không như mong đợi")
        shutil.rmtree(final_dir, ignore_errors=True)
        os.makedirs(os.path.dirname(final_dir), exist_ok=True)
        shutil.move(os.path.join(staging, tops[0]), final_dir)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
