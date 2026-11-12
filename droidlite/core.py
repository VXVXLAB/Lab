"""Lớp điều phối: cài thành phần, quản lý ảnh hệ thống, máy ảo và máy đang chạy."""

import json
import lzma
import os
import platform
import re
import shlex
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

from . import avd, device, fetch, repo

CACHE_TTL = 24 * 3600
GPU_MODES = ("auto", "host", "swiftshader_indirect", "off")
FRIDA_PYPI = "https://pypi.org/pypi/frida/json"
FRIDA_RELEASES = "https://github.com/frida/frida/releases/download/{version}/{name}.xz"
FRIDA_ARCH = {"x86": "x86", "x86_64": "x86_64", "arm64-v8a": "arm64", "armeabi-v7a": "arm"}
FRIDA_REMOTE = "/data/local/tmp/frida-server"
FRIDA_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
GLOBAL_ADB = ("devices", "version", "start-server", "kill-server", "connect",
              "disconnect", "help", "host-features", "mdns", "pair")
NO_WINDOW = 0x08000000 if os.name == "nt" else 0   # không bật cửa sổ console trên Windows


class LicenseRequired(Exception):
    def __init__(self, license_id, text):
        super().__init__(f"cần chấp nhận giấy phép {license_id}")
        self.license_id, self.text = license_id, text


class NotReady(RuntimeError):
    pass


def default_home():
    if os.environ.get("DROIDLITE_HOME"):
        return os.environ["DROIDLITE_HOME"]
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(base, "DroidLite")
    return os.path.join(os.path.expanduser("~"), ".droidlite")


def detect_host():
    host_os = "windows" if os.name == "nt" else "macosx" if sys.platform == "darwin" else "linux"
    arch = "aarch64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
    return host_os, arch


def launch_args(name, port, gpu="auto", cold_boot=False, wipe=False, audio=False,
                headless=False, accel="auto", proxy="", dns=""):
    """Tham số dòng lệnh cho emulator, ưu tiên khởi động nhanh và ít tốn tài nguyên."""
    avd.check_name(name)
    if gpu not in GPU_MODES:
        raise ValueError(f"chế độ GPU phải là một trong: {', '.join(GPU_MODES)}")
    if accel not in ("auto", "on", "off"):
        raise ValueError("accel phải là auto, on hoặc off")
    port = int(port)
    if port % 2 or not 5554 <= port <= 5682:
        raise ValueError("cổng phải là số chẵn từ 5554 đến 5682")
    args = ["-avd", name, "-port", str(port), "-no-boot-anim"]
    if not audio:
        args.append("-no-audio")
    if gpu != "auto":
        args += ["-gpu", gpu]
    if accel != "auto":
        args += ["-accel", accel]
    if cold_boot:
        args.append("-no-snapshot-load")
    if wipe:
        args.append("-wipe-data")
    if headless:
        args.append("-no-window")
    if proxy:
        args += ["-http-proxy", proxy]
    if dns:
        args += ["-dns-server", dns]
    return args


def _port_free(port):
    for p in (port, port + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", p))
            except OSError:
                return False
    return True


class DroidLite:
    def __init__(self, home=None, host=None):
        self.home = os.path.abspath(home or default_home())
        self.host_os, self.host_arch = host or detect_host()
        self.sdk = os.path.join(self.home, "sdk")
        self.avd_home = os.path.join(self.home, "avd")
        self.tmp = os.path.join(self.home, "tmp")
        self.captures = os.path.join(self.home, "captures")
        self.logs = os.path.join(self.home, "logs")
        for folder in (self.sdk, self.avd_home, self.tmp, self.captures, self.logs):
            os.makedirs(folder, exist_ok=True)
        self._catalog = None

    # ---- đường dẫn và môi trường ----
    @property
    def abis(self):
        return ("arm64-v8a",) if self.host_arch == "aarch64" else ("x86_64", "x86")

    def exe(self, kind):
        ext = ".exe" if self.host_os == "windows" else ""
        folder = "emulator" if kind == "emulator" else "platform-tools"
        return os.path.join(self.sdk, folder, kind + ext)

    def env(self):
        env = dict(os.environ)
        env.update(ANDROID_SDK_ROOT=self.sdk, ANDROID_HOME=self.sdk,
                   ANDROID_AVD_HOME=self.avd_home)
        return env

    def _run(self, argv, timeout=120, binary=False):
        return subprocess.run(argv, env=self.env(), capture_output=True, timeout=timeout,
                              text=not binary, encoding=None if binary else "utf-8",
                              errors=None if binary else "replace", creationflags=NO_WINDOW)

    # ---- danh mục gói ----
    def _manifest(self, key, refresh):
        path = os.path.join(self.home, "cache", key + ".xml")
        fresh = os.path.exists(path) and time.time() - os.path.getmtime(path) < CACHE_TTL
        if refresh or not fresh:
            url = repo.BASE + repo.MANIFESTS[key]
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "droidlite"})
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = resp.read()
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path + ".tmp", "wb") as f:
                    f.write(data)
                os.replace(path + ".tmp", path)
            except OSError:
                if not os.path.exists(path):   # không có mạng và cũng chưa có bản lưu
                    raise
        with open(path, "rb") as f:
            return f.read()

    def catalog(self, refresh=False):
        if self._catalog is None or refresh:
            packages, licenses = [], {}
            for key, rel in repo.MANIFESTS.items():
                base = repo.BASE + rel.rsplit("/", 1)[0] + "/" if "/" in rel else repo.BASE
                pkgs, lics = repo.parse_manifest(self._manifest(key, refresh), base,
                                                 self.host_os, self.host_arch)
                packages += pkgs
                licenses.update(lics)
            self._catalog = (packages, licenses)
        return self._catalog

    # ---- giấy phép ----
    def _accepted(self):
        path = os.path.join(self.home, "licenses.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return set(json.load(f))
        return set()

    def _check_license(self, pkg, accept):
        accepted = self._accepted()
        if not pkg.license or pkg.license in accepted:
            return
        if not accept:
            raise LicenseRequired(pkg.license, self.catalog()[1].get(pkg.license, ""))
        accepted.add(pkg.license)
        path = os.path.join(self.home, "licenses.json")
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(sorted(accepted), f)
        os.replace(path + ".tmp", path)

    # ---- cài đặt ----
    def _install(self, pkg, final_dir, progress):
        zip_path = os.path.join(self.tmp, os.path.basename(pkg.url))
        try:
            fetch.download(pkg.url, zip_path, pkg.size, pkg.checksum, pkg.checksum_type, progress)
            if progress:
                progress(pkg.size, pkg.size, "đang giải nén")
            fetch.install_zip(zip_path, final_dir, self.tmp)
        finally:
            if os.path.exists(zip_path):
                os.remove(zip_path)

    def _installed_version(self, folder):
        props = os.path.join(self.sdk, folder, "source.properties")
        if not os.path.exists(props):
            return None
        return avd.read_ini(props).get("Pkg.Revision", "?")

    def components(self):
        packages = self.catalog()[0]
        out = {}
        for name in ("emulator", "platform-tools"):
            pkg = repo.latest(packages, name)
            out[name] = {"installed": self._installed_version(name),
                         "latest": pkg.version if pkg else None,
                         "size": pkg.size if pkg else 0}
        return out

    def setup(self, accept=False, progress=None, update=False):
        """Cài lõi giả lập và adb. Trả về danh sách thành phần vừa cài."""
        packages = self.catalog()[0]
        todo = []
        for name in ("platform-tools", "emulator"):
            pkg = repo.latest(packages, name)
            if pkg is None:
                raise NotReady(f"kho không có gói {name} cho {self.host_os}/{self.host_arch}")
            have = self._installed_version(name)
            if have is None or (update and have != pkg.version):
                todo.append(pkg)
        for pkg in todo:
            self._check_license(pkg, accept)
        for pkg in todo:
            if pkg.path == "platform-tools" and os.path.exists(self.exe("adb")):
                self._run([self.exe("adb"), "kill-server"], timeout=20)
            wrap = (lambda d, t, m="", n=pkg.path: progress(n, d, t, m)) if progress else None
            self._install(pkg, os.path.join(self.sdk, pkg.path), wrap)
        return [p.path for p in todo]

    def _image_dir(self, path):
        parts = path.split(";")
        if len(parts) != 4 or parts[0] != "system-images" or any(
                not p or p.startswith(".") or "/" in p or "\\" in p for p in parts):
            raise ValueError(f"ảnh hệ thống không hợp lệ: {path}")
        return os.path.join(self.sdk, *parts)

    def image_installed(self, path):
        return os.path.exists(os.path.join(self._image_dir(path), "source.properties"))

    def images(self):
        out = []
        for p in repo.system_images(self.catalog()[0], self.abis):
            out.append({"path": p.path, "api": p.api, "android": p.android, "tag": p.tag,
                        "abi": p.abi, "size": p.size, "revision": p.version,
                        "installed": self.image_installed(p.path)})
        return out

    def find_image(self, api, tag="default", abi=None):
        for abi_try in ([abi] if abi else self.abis):
            path = f"system-images;android-{api};{tag};{abi_try}"
            if any(i["path"] == path for i in self.images()):
                return path
        raise ValueError(f"kho không có Android API {api} loại '{tag}' cho máy này")

    def install_image(self, path, accept=False, progress=None):
        matches = [p for p in repo.system_images(self.catalog()[0], self.abis) if p.path == path]
        if not matches:
            raise ValueError(f"kho không có ảnh hệ thống: {path}")
        pkg = matches[0]
        self._check_license(pkg, accept)
        wrap = (lambda d, t, m="": progress(path, d, t, m)) if progress else None
        self._install(pkg, self._image_dir(path), wrap)

    def remove_image(self, path):
        users = [a["name"] for a in self.avds() if a["image"] == path]
        if users:
            raise ValueError(f"ảnh đang được dùng bởi máy ảo: {', '.join(users)}")
        shutil.rmtree(self._image_dir(path), ignore_errors=True)

    # ---- máy ảo ----
    def avds(self):
        return avd.list_all(self.avd_home)

    def create_avd(self, name, image, **options):
        if not self.image_installed(image):
            raise NotReady(f"chưa cài ảnh hệ thống {image}")
        if "playstore" in image and int(options.get("cores") or 2) < 2:
            raise ValueError("ảnh Google Play cần ít nhất 2 nhân")
        config = avd.build_config(name, image, **options)
        return avd.create(self.avd_home, name, config)

    def delete_avd(self, name):
        if name in self.running():
            raise ValueError("máy ảo đang chạy, hãy tắt trước khi xóa")
        avd.delete(self.avd_home, name)

    # ---- chạy và dừng ----
    def _adb(self, serial, args, timeout=120, binary=False):
        if not os.path.exists(self.exe("adb")):
            raise NotReady("chưa cài adb, hãy chạy bước cài đặt")
        return self._run([self.exe("adb"), "-s", serial, *args], timeout=timeout, binary=binary)

    def running(self):
        """{tên máy ảo: {"serial":..., "state":...}} cho các máy giả lập đang chạy."""
        if not os.path.exists(self.exe("adb")):
            return {}
        res = self._run([self.exe("adb"), "devices"], timeout=30)
        found = {}
        for line in res.stdout.splitlines()[1:]:
            parts = line.split()
            if len(parts) < 2 or not parts[0].startswith("emulator-"):
                continue
            serial, state = parts[0], parts[1]
            name = serial
            if state == "device":
                out = self._adb(serial, ["emu", "avd", "name"], timeout=20).stdout.splitlines()
                if out and out[0].strip() not in ("", "OK"):
                    name = out[0].strip()
            found[name] = {"serial": serial, "state": state}
        return found

    def start(self, name, **options):
        if not os.path.exists(self.exe("emulator")):
            raise NotReady("chưa cài lõi giả lập, hãy chạy bước cài đặt")
        if name not in [a["name"] for a in self.avds()]:
            raise ValueError(f"không có máy ảo '{name}'")
        if name in self.running():
            raise ValueError(f"máy ảo '{name}' đang chạy")
        port = next((p for p in range(5554, 5684, 2) if _port_free(p)), None)
        if port is None:
            raise NotReady("hết cổng trống cho máy giả lập")
        argv = [self.exe("emulator"), *launch_args(name, port, **options)]
        self._run([self.exe("adb"), "start-server"], timeout=30)
        log_path = os.path.join(self.logs, name + ".log")
        flags = NO_WINDOW | (subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
        with open(log_path, "ab") as log:
            subprocess.Popen(argv, env=self.env(), stdin=subprocess.DEVNULL, stdout=log,
                             stderr=subprocess.STDOUT, creationflags=flags,
                             start_new_session=os.name != "nt")
        return {"serial": f"emulator-{port}", "log": log_path}

    def serial_of(self, target):
        if target.startswith("emulator-"):
            return target
        info = self.running().get(target)
        if not info:
            raise ValueError(f"máy ảo '{target}' không chạy")
        return info["serial"]

    def wait_boot(self, target, timeout=600):
        serial = target if target.startswith("emulator-") else None
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                serial = serial or self.serial_of(target)
                out = self._adb(serial, ["shell", "getprop", "sys.boot_completed"], timeout=20)
                if out.stdout.strip() == "1":
                    return serial
            except (ValueError, subprocess.TimeoutExpired):
                pass
            time.sleep(3)
        raise TimeoutError(f"máy ảo chưa khởi động xong sau {timeout} giây")

    def stop(self, target):
        return self.act(target, "kill")

    # ---- điều khiển ----
    def act(self, target, action, **params):
        """Chạy một hành động trong device.py, trả về phần chữ adb in ra."""
        serial = self.serial_of(target)
        outputs = []
        for args in device.commands(action, **params):
            res = self._adb(serial, args, timeout=300)
            text = (res.stdout + res.stderr).strip()
            failed = res.returncode != 0 or (args[0] == "emu" and "KO:" in text)
            if failed:
                raise RuntimeError(text or f"adb thoát với mã {res.returncode}")
            outputs.append(text)
        return "\n".join(o for o in outputs if o)

    def adb_line(self, target, line):
        """Chạy một dòng lệnh adb do người dùng gõ (cửa sổ ADB). Trả về (mã thoát, kết quả)."""
        args = shlex.split(line)
        if args and args[0].lower() in ("adb", "adb.exe"):
            args = args[1:]
        if not args:
            raise ValueError("chưa nhập lệnh")
        if args == ["shell"]:
            raise ValueError("không hỗ trợ shell tương tác, hãy gõ: shell <lệnh>")
        if args[0] == "logcat" and "-d" not in args and "-c" not in args:
            args += ["-d", "-t", "200"]   # logcat liên tục đã có ở thẻ Logcat
        if args[0] in GLOBAL_ADB or "-s" in args:
            argv = [self.exe("adb"), *args]
        else:
            argv = [self.exe("adb"), "-s", self.serial_of(target), *args]
        if not os.path.exists(self.exe("adb")):
            raise NotReady("chưa cài adb, hãy chạy bước cài đặt")
        try:
            res = self._run(argv, timeout=180)
        except subprocess.TimeoutExpired:
            return 124, "lệnh chạy quá 180 giây nên đã bị dừng"
        return res.returncode, (res.stdout + res.stderr).rstrip()

    def logcat_process(self, target, package=""):
        """Mở tiến trình logcat liên tục; nếu có tên gói thì chỉ lấy log của ứng dụng đó."""
        serial = self.serial_of(target)
        argv = [self.exe("adb"), "-s", serial, "logcat", "-v", "threadtime", "-T", "100"]
        if package:
            device.uninstall(package)   # dùng lại phép kiểm tra tên gói
            pid = self._adb(serial, ["shell", "pidof", package], timeout=20).stdout.split()
            if not pid:
                raise ValueError(f"ứng dụng {package} chưa chạy trên máy ảo")
            argv.append(f"--pid={pid[0]}")
        return subprocess.Popen(argv, env=self.env(), stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                creationflags=NO_WINDOW)

    # ---- Frida ----
    def frida_client(self):
        """Phiên bản thư viện frida trên máy chủ (None nếu chưa cài frida-tools)."""
        try:
            res = subprocess.run([sys.executable, "-c", "import frida;print(frida.__version__)"],
                                 capture_output=True, text=True, timeout=30,
                                 creationflags=NO_WINDOW)
        except (OSError, subprocess.TimeoutExpired):
            return None
        return res.stdout.strip() if res.returncode == 0 and res.stdout.strip() else None

    def frida_latest(self):
        req = urllib.request.Request(FRIDA_PYPI, headers={"User-Agent": "droidlite"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)["info"]["version"]

    def frida_server_file(self, version, abi, progress=None):
        """Tải frida-server đúng phiên bản và kiến trúc (lưu lại để dùng lần sau)."""
        if not FRIDA_VERSION_RE.match(version or ""):
            raise ValueError(f"phiên bản Frida không hợp lệ: {version}")
        if abi not in FRIDA_ARCH:
            raise ValueError(f"Frida không có bản cho ABI {abi}")
        name = f"frida-server-{version}-android-{FRIDA_ARCH[abi]}"
        path = os.path.join(self.home, "frida", name)
        if not os.path.exists(path):
            packed = os.path.join(self.tmp, name + ".xz")
            try:
                fetch.download(FRIDA_RELEASES.format(version=version, name=name), packed,
                               progress=progress)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with lzma.open(packed) as src, open(path + ".tmp", "wb") as out:
                    shutil.copyfileobj(src, out, 1 << 20)
                os.replace(path + ".tmp", path)
            finally:
                if os.path.exists(packed):
                    os.remove(packed)
        return path

    def frida_status(self, target):
        serial = self.serial_of(target)
        pid = self._adb(serial, ["shell", "pidof", "frida-server"], timeout=20).stdout.split()
        return {"client": self.frida_client(), "running": bool(pid),
                "abi": self._adb(serial, ["shell", "getprop", "ro.product.cpu.abi"],
                                 timeout=20).stdout.strip()}

    def frida_start(self, target, version="", progress=None):
        """Bật frida-server trên máy ảo với quyền root. Trả về phiên bản đã bật."""
        serial = self.serial_of(target)
        status = self.frida_status(serial)
        version = version or status["client"] or self.frida_latest()
        local = self.frida_server_file(version, status["abi"], progress)
        root = self._adb(serial, ["root"], timeout=60)
        if "cannot run as root" in (root.stdout + root.stderr):
            raise RuntimeError("ảnh Google Play không cho quyền root; hãy dùng ảnh 'default' "
                               "hoặc 'google_apis' để chạy Frida")
        self._adb(serial, ["wait-for-device"], timeout=60)
        self._adb(serial, ["shell", "pkill", "-f", "frida-server"], timeout=20)
        pushed = self._adb(serial, ["push", local, FRIDA_REMOTE], timeout=300)
        if pushed.returncode != 0:
            raise RuntimeError((pushed.stdout + pushed.stderr).strip())
        self._adb(serial, ["shell", "chmod", "755", FRIDA_REMOTE], timeout=20)
        self._adb(serial, ["shell", f"nohup {FRIDA_REMOTE} >/dev/null 2>&1 &"], timeout=30)
        time.sleep(2)
        if not self.frida_status(serial)["running"]:
            raise RuntimeError("frida-server không khởi động được trên máy ảo này")
        return version

    def frida_stop(self, target):
        self._adb(self.serial_of(target), ["shell", "pkill", "-f", "frida-server"], timeout=20)

    def info(self, target):
        serial = self.serial_of(target)

        def get(prop):
            return self._adb(serial, ["shell", "getprop", prop], timeout=20).stdout.strip()

        return {"serial": serial, "android": get("ro.build.version.release"),
                "api": get("ro.build.version.sdk"), "model": get("ro.product.model"),
                "booted": get("sys.boot_completed") == "1"}

    def screenshot(self, target, save=True):
        serial = self.serial_of(target)
        res = self._adb(serial, ["exec-out", "screencap", "-p"], timeout=60, binary=True)
        if res.returncode != 0 or not res.stdout.startswith(b"\x89PNG"):
            raise RuntimeError("không chụp được màn hình (máy ảo đã khởi động xong chưa?)")
        if not save:
            return res.stdout
        path = os.path.join(self.captures, time.strftime(f"{serial}-%Y%m%d-%H%M%S.png"))
        with open(path, "wb") as f:
            f.write(res.stdout)
        return path

    def record(self, target, seconds=10):
        seconds = int(seconds)
        if not 1 <= seconds <= 180:
            raise ValueError("thời lượng quay từ 1 đến 180 giây")
        serial = self.serial_of(target)
        remote = "/sdcard/droidlite-rec.mp4"
        res = self._adb(serial, ["shell", "screenrecord", "--time-limit", str(seconds), remote],
                        timeout=seconds + 60)
        if res.returncode != 0:
            raise RuntimeError((res.stdout + res.stderr).strip() or "không quay được màn hình")
        path = os.path.join(self.captures, time.strftime(f"{serial}-%Y%m%d-%H%M%S.mp4"))
        pulled = self._adb(serial, ["pull", remote, path], timeout=120)
        self._adb(serial, ["shell", "rm", "-f", remote], timeout=20)
        if pulled.returncode != 0:
            raise RuntimeError((pulled.stdout + pulled.stderr).strip())
        return path

    # ---- chẩn đoán ----
    def doctor(self):
        report = {"os": f"{platform.system()} {platform.release()} ({self.host_arch})",
                  "python": platform.python_version(), "home": self.home,
                  "disk_free_gb": round(shutil.disk_usage(self.home).free / 2**30, 1),
                  "emulator": self._installed_version("emulator"),
                  "platform-tools": self._installed_version("platform-tools"),
                  "accel": "chưa kiểm tra được (chưa cài lõi giả lập)"}
        if os.path.exists(self.exe("emulator")):
            try:
                res = self._run([self.exe("emulator"), "-accel-check"], timeout=60)
                lines = [ln.strip() for ln in (res.stdout + res.stderr).splitlines() if ln.strip()]
                report["accel"] = " | ".join(ln for ln in lines if "accel" not in ln.lower()
                                             or ":" not in ln) or "không có thông tin"
                report["accel_ok"] = res.returncode == 0
            except (OSError, subprocess.TimeoutExpired) as exc:
                report["accel"] = f"không kiểm tra được: {exc}"
        return report
