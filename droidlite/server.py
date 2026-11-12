"""Bảng điều khiển chạy trong trình duyệt, chỉ nghe trên 127.0.0.1 và yêu cầu mã phiên."""

import collections
import hmac
import json
import os
import re
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .core import LicenseRequired

MAX_UPLOAD = 4 << 30
UI_FILE = os.path.join(os.path.dirname(__file__), "ui.html")


class Jobs:
    """Việc chạy nền (tải, cài) kèm tiến độ để giao diện hỏi lại định kỳ."""

    def __init__(self):
        self._lock = threading.Lock()
        self._jobs = {}
        self._next = 1

    def start(self, title, work):
        with self._lock:
            job_id = self._next
            self._next += 1
            job = {"id": job_id, "title": title, "done": False, "error": "", "license": None,
                   "pct": 0, "msg": "đang chuẩn bị"}
            self._jobs[job_id] = job

        def progress(_name, done, total, msg=""):
            job["pct"] = int(done * 100 / total) if total else 0
            job["msg"] = msg or f"{done >> 20}/{total >> 20} MB"

        def run():
            try:
                work(progress)
                job["pct"], job["msg"] = 100, "xong"
            except LicenseRequired as exc:
                job["license"] = {"id": exc.license_id, "text": exc.text}
                job["error"] = str(exc)
            except Exception as exc:   # báo lỗi về giao diện thay vì làm chết luồng
                job["error"] = f"{type(exc).__name__}: {exc}"
            job["done"] = True

        threading.Thread(target=run, daemon=True).start()
        return job_id

    def snapshot(self):
        with self._lock:
            jobs = list(self._jobs.values())[-8:]
        return [dict(j) for j in jobs]

    def dismiss(self, job_id):
        with self._lock:
            if self._jobs.get(job_id, {}).get("done"):
                del self._jobs[job_id]


class Logcat:
    """Một phiên logcat liên tục, giữ lại các dòng gần nhất để giao diện lấy dần."""

    def __init__(self):
        self._lock = threading.Lock()
        self._proc = None
        self._lines = collections.deque(maxlen=5000)
        self._count = 0

    def start(self, proc):
        self.stop()
        with self._lock:
            self._proc, self._count = proc, 0
            self._lines.clear()

        def pump():
            for raw in proc.stdout:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                with self._lock:
                    if self._proc is not proc:
                        break
                    self._lines.append(line)
                    self._count += 1

        threading.Thread(target=pump, daemon=True).start()

    def stop(self):
        with self._lock:
            proc, self._proc = self._proc, None
        if proc and proc.poll() is None:
            proc.terminate()

    def poll(self, cursor):
        with self._lock:
            first = self._count - len(self._lines)
            start = max(int(cursor), first)
            lines = list(self._lines)[start - first:]
            running = self._proc is not None and self._proc.poll() is None
            return {"lines": lines, "cursor": self._count, "running": running}


class Panel:
    def __init__(self, app, port=0):
        self.app = app
        self.token = secrets.token_urlsafe(18)
        self.jobs = Jobs()
        self.logcat = Logcat()
        panel = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, code, body, ctype="application/json"):
                data = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(data)

            def _allowed(self, token):
                # chặn trang web khác và DNS rebinding: đúng Host và đúng mã phiên
                host = (self.headers.get("Host") or "").lower()
                good_host = host in (f"127.0.0.1:{panel.port}", f"localhost:{panel.port}")
                return good_host and hmac.compare_digest(token or "", panel.token)

            def do_GET(self):
                url = urlparse(self.path)
                query = parse_qs(url.query)
                if not self._allowed(query.get("t", [""])[0]):
                    return self._send(403, {"ok": False, "error": "sai mã phiên"})
                if url.path == "/":
                    with open(UI_FILE, "rb") as f:
                        return self._send(200, f.read(), "text/html; charset=utf-8")
                if url.path == "/shot":
                    try:
                        png = panel.app.screenshot(query.get("target", [""])[0], save=False)
                    except Exception as exc:
                        return self._send(500, {"ok": False, "error": str(exc)})
                    return self._send(200, png, "image/png")
                return self._send(404, {"ok": False, "error": "không có trang này"})

            def do_POST(self):
                url = urlparse(self.path)
                if not self._allowed(self.headers.get("X-Token")):
                    return self._send(403, {"ok": False, "error": "sai mã phiên"})
                length = int(self.headers.get("Content-Length") or 0)
                if url.path == "/upload":
                    return self._upload(parse_qs(url.query).get("name", ["app.apk"])[0], length)
                if url.path != "/api":
                    return self._send(404, {"ok": False, "error": "không có trang này"})
                try:
                    req = json.loads(self.rfile.read(length) or b"{}")
                    result = panel.dispatch(req.get("op"), req.get("args") or {})
                    self._send(200, {"ok": True, "result": result})
                except Exception as exc:
                    self._send(200, {"ok": False, "error": str(exc) or type(exc).__name__})

            def _upload(self, name, length):
                if not 0 < length <= MAX_UPLOAD:
                    return self._send(400, {"ok": False, "error": "kích thước file không hợp lệ"})
                safe = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(name))[-80:] or "file"
                folder = os.path.join(panel.app.tmp, "uploads")
                os.makedirs(folder, exist_ok=True)
                path = os.path.join(folder, safe)
                with open(path, "wb") as out:
                    left = length
                    while left:
                        block = self.rfile.read(min(left, 1 << 20))
                        if not block:
                            break
                        out.write(block)
                        left -= len(block)
                self._send(200, {"ok": True, "result": path})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.port = self.httpd.server_address[1]

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}/?t={self.token}"

    def dispatch(self, op, a):
        app = self.app
        if op == "state":
            running = app.running()
            avds = app.avds()
            for item in avds:
                item["run"] = running.get(item["name"])
            return {"components": app.components(), "avds": avds, "jobs": self.jobs.snapshot(),
                    "home": app.home, "captures": app.captures}
        if op == "images":
            return app.images()
        if op == "doctor":
            return app.doctor()
        if op == "setup":
            accept, update = bool(a.get("accept")), bool(a.get("update"))
            return self.jobs.start("Cài lõi giả lập và adb",
                                   lambda p: app.setup(accept=accept, progress=p, update=update))
        if op == "install_image":
            path, accept = a["path"], bool(a.get("accept"))
            return self.jobs.start(f"Tải {path}",
                                   lambda p: app.install_image(path, accept=accept, progress=p))
        if op == "dismiss_job":
            return self.jobs.dismiss(int(a["id"]))
        if op == "remove_image":
            return app.remove_image(a["path"])
        if op == "create_avd":
            options = {k: a[k] for k in ("ram", "cores", "screen") if a.get(k)}
            return app.create_avd(a["name"], a["image"], **options)
        if op == "delete_avd":
            return app.delete_avd(a["name"])
        if op == "start":
            options = {k: a[k] for k in ("gpu", "cold_boot", "wipe", "audio", "headless")
                       if a.get(k)}
            return app.start(a["name"], **options)
        if op == "stop":
            return app.stop(a["target"])
        if op == "act":
            return app.act(a["target"], a["action"], **(a.get("params") or {}))
        if op == "info":
            return app.info(a["target"])
        if op == "screenshot":
            return app.screenshot(a["target"])
        if op == "record":
            return app.record(a["target"], a.get("seconds", 10))
        if op == "frida_status":
            return app.frida_status(a["target"])
        if op == "frida_start":
            target, version = a["target"], a.get("version", "")
            return self.jobs.start(
                "Bật Frida", lambda p: app.frida_start(
                    target, version, lambda d, t, m="": p("frida", d, t, m)))
        if op == "frida_stop":
            return app.frida_stop(a["target"])
        if op == "adb":
            code, out = app.adb_line(a.get("target", ""), a.get("line", ""))
            return {"code": code, "out": out}
        if op == "logcat_start":
            self.logcat.start(app.logcat_process(a["target"], a.get("package", "")))
            return True
        if op == "logcat_stop":
            return self.logcat.stop()
        if op == "logcat_poll":
            return self.logcat.poll(a.get("cursor", 0))
        raise ValueError(f"không có thao tác: {op}")

    def serve(self, open_browser=True):
        print(f"DroidLite đang chạy tại: {self.url}")
        print("Nhấn Ctrl+C để đóng bảng điều khiển (máy ảo đang chạy vẫn tiếp tục chạy).")
        if open_browser:
            threading.Timer(0.5, webbrowser.open, [self.url]).start()
        try:
            self.httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            self.logcat.stop()
            self.httpd.server_close()
