"""Test không cần mạng và không cần máy giả lập thật: dùng kho giả và adb giả."""

import io
import json
import lzma
import os
import shutil
import stat
import sys
import tempfile
import unittest
import urllib.request
import zipfile

from droidlite import avd, core, device, fetch, repo, server

HERE = os.path.dirname(__file__)
MANIFEST = b"""<?xml version="1.0"?>
<sdk:sdk-repository xmlns:sdk="http://schemas.android.com/sdk/android/repo/repository2/03"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <license id="lic-a" type="text">Dieu khoan A</license>
  <channel id="channel-0">stable</channel>
  <channel id="channel-3">canary</channel>
  <remotePackage path="emulator">
    <revision><major>30</major><minor>1</minor><micro>2</micro></revision>
    <display-name>Android Emulator</display-name><uses-license ref="lic-a"/>
    <channelRef ref="channel-0"/>
    <archives>
      <archive><complete><size>10</size><checksum type="sha1">aa</checksum>
        <url>emu-linux.zip</url></complete><host-os>linux</host-os><host-arch>x64</host-arch></archive>
      <archive><complete><size>20</size><checksum type="sha1">bb</checksum>
        <url>emu-win.zip</url></complete><host-os>windows</host-os><host-arch>x64</host-arch></archive>
    </archives>
  </remotePackage>
  <remotePackage path="emulator">
    <revision><major>31</major><minor>0</minor><micro>0</micro></revision>
    <display-name>Android Emulator</display-name><uses-license ref="lic-a"/>
    <channelRef ref="channel-3"/>
    <archives><archive><complete><size>21</size><checksum type="sha1">cc</checksum>
      <url>emu-win-canary.zip</url></complete><host-os>windows</host-os></archive></archives>
  </remotePackage>
  <remotePackage path="system-images;android-34;default;x86_64">
    <type-details><api-level>34</api-level><tag><id>default</id></tag><abi>x86_64</abi></type-details>
    <revision><major>4</major></revision><display-name>img</display-name>
    <uses-license ref="lic-a"/><channelRef ref="channel-0"/>
    <archives><archive><complete><size>30</size><checksum type="sha1">dd</checksum>
      <url>x86_64-34_r04.zip</url></complete></archive></archives>
  </remotePackage>
  <remotePackage path="system-images;android-CANARY;default;x86_64">
    <type-details><api-level>36x</api-level><tag><id>default</id></tag><abi>x86_64</abi></type-details>
    <revision><major>1</major></revision><display-name>img</display-name>
    <uses-license ref="lic-a"/><channelRef ref="channel-0"/>
    <archives><archive><complete><size>30</size><checksum type="sha1">ee</checksum>
      <url>canary.zip</url></complete></archive></archives>
  </remotePackage>
  <remotePackage path="system-images;android-34;default;arm64-v8a">
    <type-details><api-level>34</api-level><tag><id>default</id></tag><abi>arm64-v8a</abi></type-details>
    <revision><major>4</major></revision><display-name>img</display-name>
    <uses-license ref="lic-a"/><channelRef ref="channel-0"/>
    <archives><archive><complete><size>30</size><checksum type="sha1">ff</checksum>
      <url>arm.zip</url></complete></archive></archives>
  </remotePackage>
</sdk:sdk-repository>"""


class RepoTest(unittest.TestCase):
    def setUp(self):
        self.pkgs, self.lics = repo.parse_manifest(MANIFEST, "https://x/", "windows")

    def test_picks_archive_for_host(self):
        emu = repo.latest(self.pkgs, "emulator")
        self.assertEqual(emu.url, "https://x/emu-win.zip")
        self.assertEqual((emu.size, emu.checksum, emu.version), (20, "bb", "30.1.2"))

    def test_stable_channel_only_by_default(self):
        self.assertEqual(repo.latest(self.pkgs, "emulator").revision, (30, 1, 2))
        self.assertEqual(repo.latest(self.pkgs, "emulator", max_channel=3).revision, (31, 0, 0))

    def test_images_exclude_canary_and_foreign_abi(self):
        paths = [p.path for p in repo.system_images(self.pkgs, ("x86_64", "x86"))]
        self.assertEqual(paths, ["system-images;android-34;default;x86_64"])

    def test_license_text_and_android_name(self):
        self.assertEqual(self.lics["lic-a"], "Dieu khoan A")
        self.assertEqual(repo.system_images(self.pkgs, ("x86_64",))[0].android, "14")


class TempCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)


class FetchTest(TempCase):
    def _zip(self, entries):
        path = os.path.join(self.dir, "p.zip")
        with zipfile.ZipFile(path, "w") as zf:
            for name, data in entries:
                zf.writestr(name, data)
        return path

    def test_install_zip_moves_single_top_folder(self):
        final = os.path.join(self.dir, "sdk", "emulator")
        fetch.install_zip(self._zip([("emulator/a.txt", "1"), ("emulator/sub/b", "2")]),
                          final, self.dir)
        self.assertTrue(os.path.exists(os.path.join(final, "sub", "b")))

    def test_rejects_path_escaping_archive(self):
        with self.assertRaises(fetch.DownloadError):
            fetch.extract(self._zip([("../evil.txt", "x")]), os.path.join(self.dir, "out"))
        self.assertFalse(os.path.exists(os.path.join(self.dir, "evil.txt")))

    def test_download_rejects_bad_checksum_and_leaves_no_file(self):
        src = os.path.join(self.dir, "src.bin")
        with open(src, "wb") as f:
            f.write(b"hello")
        dest = os.path.join(self.dir, "out.bin")
        with self.assertRaises(fetch.DownloadError):
            fetch.download("file://" + src, dest, 5, "00" * 20)
        self.assertEqual(os.listdir(self.dir), ["src.bin"])
        good = "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"
        fetch.download("file://" + src, dest, 5, good)
        self.assertTrue(os.path.exists(dest))


class AvdTest(TempCase):
    IMG = "system-images;android-34;default;x86_64"

    def test_config_fields(self):
        cfg = avd.build_config("may1", self.IMG, cores=4, screen="tablet")
        self.assertEqual(cfg["image.sysdir.1"], "system-images/android-34/default/x86_64/")
        self.assertEqual((cfg["hw.cpu.arch"], cfg["abi.type"]), ("x86_64", "x86_64"))
        self.assertEqual((cfg["hw.ramSize"], cfg["hw.cpu.ncore"]), ("2048", "4"))
        self.assertEqual((cfg["hw.lcd.width"], cfg["hw.lcd.height"]), ("1280", "800"))
        self.assertEqual(cfg["PlayStore.enabled"], "false")

    def test_ram_scales_with_android_version(self):
        self.assertEqual([avd.default_ram(a) for a in ("23", "28", "34")], [1024, 1536, 2048])

    def test_rejects_bad_input(self):
        for name in ("", "../x", "a b", "a;b"):
            with self.assertRaises(ValueError):
                avd.build_config(name, self.IMG)
        with self.assertRaises(ValueError):
            avd.build_config("ok", "system-images;android-34;default;mips")
        with self.assertRaises(ValueError):
            avd.build_config("ok", self.IMG, ram=64)

    def test_create_list_delete(self):
        avd.create(self.dir, "may1", avd.build_config("may1", self.IMG))
        with self.assertRaises(FileExistsError):
            avd.create(self.dir, "may1", avd.build_config("may1", self.IMG))
        item = avd.list_all(self.dir)[0]
        self.assertEqual((item["name"], item["image"], item["ram"]), ("may1", self.IMG, 2048))
        pointer = avd.read_ini(os.path.join(self.dir, "may1.ini"))
        self.assertEqual(pointer["target"], "android-34")
        avd.delete(self.dir, "may1")
        self.assertEqual(avd.list_all(self.dir), [])


class DeviceTest(unittest.TestCase):
    def test_gps_sends_longitude_first(self):
        self.assertEqual(device.commands("gps", lat="21.5", lon="105.25"),
                         [["emu", "geo", "fix", "105.25", "21.5"]])

    def test_text_is_quoted_for_remote_shell(self):
        cmd = device.commands("text", value="a b; rm -rf /")[0]
        self.assertEqual(cmd[:3], ["shell", "input", "text"])
        self.assertEqual(cmd[3], "'a%sb;%srm%s-rf%s/'")

    def test_network_makes_two_commands(self):
        self.assertEqual(device.commands("network", speed="edge", delay="gprs"),
                         [["emu", "network", "speed", "edge"], ["emu", "network", "delay", "gprs"]])

    def test_proxy_set_and_clear(self):
        cmd = device.commands("proxy", host="10.0.2.2", port=8080)[0]
        self.assertEqual(cmd[-1], "10.0.2.2:8080")
        self.assertEqual(device.commands("proxy")[0][-1], ":0")

    def test_snapshot_commands(self):
        self.assertEqual(device.commands("snapshot", op="save", name="s1"),
                         [["emu", "avd", "snapshot", "save", "s1"]])
        self.assertEqual(device.commands("snapshot", op="list"),
                         [["emu", "avd", "snapshot", "list"]])

    def test_validation(self):
        bad = [("key", {"name": "nope"}), ("battery", {"percent": 150}),
               ("gps", {"lat": 91, "lon": 0}), ("sms", {"number": "12;3", "message": "x"}),
               ("snapshot", {"op": "save", "name": "a b"}), ("network", {"speed": "6g"}),
               ("uninstall", {"package": "a b"}), ("proxy", {"host": "a b", "port": 1}),
               ("khong_co", {})]
        for action, params in bad:
            with self.assertRaises(ValueError, msg=action):
                device.commands(action, **params)


class LaunchArgsTest(unittest.TestCase):
    def test_light_defaults(self):
        self.assertEqual(core.launch_args("may1", 5554),
                         ["-avd", "may1", "-port", "5554", "-no-boot-anim", "-no-audio"])

    def test_options(self):
        args = core.launch_args("may1", 5556, gpu="host", cold_boot=True, wipe=True,
                                audio=True, headless=True, accel="off", proxy="h:1", dns="1.1.1.1")
        self.assertNotIn("-no-audio", args)
        for flag in ("-no-snapshot-load", "-wipe-data", "-no-window"):
            self.assertIn(flag, args)
        self.assertEqual(args[args.index("-gpu") + 1], "host")
        self.assertEqual(args[args.index("-accel") + 1], "off")

    def test_rejects_bad_values(self):
        for kwargs in ({"gpu": "magic"}, {"accel": "maybe"}):
            with self.assertRaises(ValueError):
                core.launch_args("may1", 5554, **kwargs)
        for port in (5555, 80):
            with self.assertRaises(ValueError):
                core.launch_args("may1", port)


class AppCase(TempCase):
    """DroidLite với kho gói giả (file://) và adb giả."""

    def setUp(self):
        super().setUp()
        self.repo_dir = os.path.join(self.dir, "repo")
        os.makedirs(self.repo_dir)
        self.log = os.path.join(self.dir, "adb.log")
        os.environ["FAKE_ADB_LOG"] = self.log
        self.app = core.DroidLite(os.path.join(self.dir, "home"), host=("linux", "x64"))
        self._publish()
        self.addCleanup(setattr, repo, "BASE", repo.BASE)
        self.addCleanup(setattr, repo, "MANIFESTS", repo.MANIFESTS)
        repo.BASE = "file://" + self.repo_dir + "/"
        repo.MANIFESTS = {"core": "core.xml"}

    def _zip(self, name, entries):
        path = os.path.join(self.repo_dir, name)
        with zipfile.ZipFile(path, "w") as zf:
            for arc, data, mode in entries:
                info = zipfile.ZipInfo(arc)
                info.external_attr = mode << 16
                zf.writestr(info, data)
        import hashlib
        with open(path, "rb") as f:
            data = f.read()
        return len(data), hashlib.sha1(data).hexdigest()

    def _publish(self):
        with open(os.path.join(HERE, "fake_adb.py"), encoding="utf-8") as f:
            fake = f.read().replace("#!/usr/bin/env python3", "#!" + sys.executable)
        mode = stat.S_IFREG | 0o755
        parts = {
            "platform-tools": self._zip("pt.zip", [
                ("platform-tools/adb", fake, mode),
                ("platform-tools/source.properties", "Pkg.Revision=1.0.0\n", 0o644)]),
            "emulator": self._zip("emu.zip", [
                ("emulator/emulator", "#!/bin/sh\necho accel ok\n", mode),
                ("emulator/source.properties", "Pkg.Revision=2.0.0\n", 0o644)]),
            "system-images;android-34;default;x86_64": self._zip("img.zip", [
                ("x86_64/system.img", "img", 0o644),
                ("x86_64/source.properties", "Pkg.Revision=4\n", 0o644)]),
        }
        urls = {"platform-tools": "pt.zip", "emulator": "emu.zip",
                "system-images;android-34;default;x86_64": "img.zip"}
        body = "".join(
            f'<remotePackage path="{path}"><revision><major>'
            f'{ {"platform-tools": 1, "emulator": 2}.get(path, 4)}</major></revision>'
            f'<display-name>x</display-name><uses-license ref="lic-a"/>'
            f'<channelRef ref="channel-0"/><archives><archive><complete><size>{size}</size>'
            f'<checksum type="sha1">{sha}</checksum><url>{urls[path]}</url></complete>'
            f'</archive></archives></remotePackage>' for path, (size, sha) in parts.items())
        xml = ('<r><license id="lic-a">Dieu khoan</license><channel id="channel-0">stable'
               f'</channel>{body}</r>')
        with open(os.path.join(self.repo_dir, "core.xml"), "w") as f:
            f.write(xml)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log, encoding="utf-8") as f:
            return [json.loads(line) for line in f]


@unittest.skipIf(os.name == "nt", "adb giả là script có shebang")
class AppTest(AppCase):
    IMG = "system-images;android-34;default;x86_64"

    def ready(self):
        self.app.setup(accept=True)
        self.app.install_image(self.IMG, accept=True)
        self.app.create_avd("may1", self.IMG)

    def test_setup_requires_license_then_installs(self):
        with self.assertRaises(core.LicenseRequired) as ctx:
            self.app.setup()
        self.assertEqual(ctx.exception.text, "Dieu khoan")
        self.assertFalse(os.path.exists(self.app.exe("adb")))
        self.assertEqual(sorted(self.app.setup(accept=True)), ["emulator", "platform-tools"])
        comp = self.app.components()
        self.assertEqual(comp["emulator"]["installed"], "2.0.0")
        self.assertEqual(self.app.setup(), [])            # đã cài, không hỏi giấy phép lại
        self.assertEqual(os.listdir(self.app.tmp), [])    # không để lại file tải dở

    def test_image_lifecycle(self):
        self.app.setup(accept=True)
        with self.assertRaises(core.NotReady):
            self.app.create_avd("may1", self.IMG)
        self.app.install_image(self.IMG)
        self.assertTrue(self.app.images()[0]["installed"])
        self.app.create_avd("may1", self.IMG)
        with self.assertRaises(ValueError):               # ảnh đang được dùng
            self.app.remove_image(self.IMG)
        self.app.delete_avd("may1") if "may1" not in self.app.running() else None

    def test_rejects_image_path_outside_sdk(self):
        for path in ("system-images;..;..;x", "system-images;a/b;c;d", "emulator"):
            with self.assertRaises(ValueError):
                self.app.image_installed(path)

    def test_running_and_actions_target_the_serial(self):
        self.ready()
        self.assertEqual(self.app.running(), {"may1": {"serial": "emulator-5554",
                                                        "state": "device"}})
        self.app.act("may1", "battery", percent=40)
        self.assertIn(["-s", "emulator-5554", "emu", "power", "capacity", "40"], self.calls())
        with self.assertRaises(ValueError):
            self.app.act("khong-chay", "rotate")

    def test_emulator_console_refusal_is_an_error(self):
        self.ready()
        with self.assertRaises(RuntimeError):
            self.app.act("may1", "snapshot", op="load", name="bad")

    def test_cannot_delete_or_restart_running_avd(self):
        self.ready()
        with self.assertRaises(ValueError):
            self.app.delete_avd("may1")
        with self.assertRaises(ValueError):
            self.app.start("may1")

    def test_screenshot_saves_png(self):
        self.ready()
        path = self.app.screenshot("may1")
        with open(path, "rb") as f:
            self.assertTrue(f.read().startswith(b"\x89PNG"))

    def test_adb_line(self):
        self.ready()
        code, out = self.app.adb_line("may1", "adb shell echo 'a b'")
        self.assertEqual((code, out), (0, "ok shell echo a b"))
        self.assertEqual(self.calls()[-1], ["-s", "emulator-5554", "shell", "echo", "a b"])
        self.app.adb_line("", "devices")                   # lệnh toàn cục không cần máy ảo
        self.assertEqual(self.calls()[-1], ["devices"])
        self.assertEqual(self.app.adb_line("may1", "shell false")[0], 1)
        self.app.adb_line("may1", "logcat")
        self.assertEqual(self.calls()[-1][-3:], ["-d", "-t", "200"])
        with self.assertRaises(ValueError):
            self.app.adb_line("may1", "shell")

    def test_frida_start_pushes_matching_binary_and_runs_it(self):
        self.ready()
        packed = os.path.join(self.dir, "frida.xz")
        with lzma.open(packed, "wb") as f:
            f.write(b"FRIDA-BINARY")
        self.addCleanup(setattr, core, "FRIDA_RELEASES", core.FRIDA_RELEASES)
        core.FRIDA_RELEASES = "file://" + packed + "#{version}{name}"
        self.app.frida_client = lambda: "16.1.4"
        self.assertFalse(self.app.frida_status("may1")["running"])
        self.assertEqual(self.app.frida_start("may1"), "16.1.4")
        local = os.path.join(self.app.home, "frida", "frida-server-16.1.4-android-x86_64")
        with open(local, "rb") as f:
            self.assertEqual(f.read(), b"FRIDA-BINARY")
        self.assertIn(["-s", "emulator-5554", "push", local, core.FRIDA_REMOTE], self.calls())
        self.assertTrue(self.app.frida_status("may1")["running"])
        with self.assertRaises(ValueError):
            self.app.frida_server_file("../../x", "x86_64")


@unittest.skipIf(os.name == "nt", "adb giả là script có shebang")
class PanelTest(AppCase):
    def setUp(self):
        super().setUp()
        self.panel = server.Panel(self.app)
        import threading
        threading.Thread(target=self.panel.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.panel.httpd.server_close)
        self.addCleanup(self.panel.httpd.shutdown)

    def post(self, op, args=None, token=None, host=None):
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.panel.port}/api",
            data=json.dumps({"op": op, "args": args or {}}).encode(),
            headers={"X-Token": self.panel.token if token is None else token,
                     "Host": host or f"127.0.0.1:{self.panel.port}"})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(req, timeout=20) as resp:
                return resp.status, json.load(resp)
        except urllib.error.HTTPError as exc:
            return exc.code, json.load(io.BytesIO(exc.read()))

    def test_requires_token_and_local_host_header(self):
        self.assertEqual(self.post("state", token="sai")[0], 403)
        self.assertEqual(self.post("state", token="")[0], 403)
        self.assertEqual(self.post("state", host="evil.example:80")[0], 403)
        status, body = self.post("state")
        self.assertEqual((status, body["ok"]), (200, True))

    def test_job_reports_license_then_completes(self):
        import time

        def wait():
            for _ in range(100):
                jobs = self.post("state")[1]["result"]["jobs"]
                if jobs and jobs[-1]["done"]:
                    return jobs[-1]
                time.sleep(0.05)
            self.fail("việc nền không kết thúc")

        self.post("setup")
        self.assertEqual(wait()["license"]["id"], "lic-a")
        self.post("setup", {"accept": True})
        done = wait()
        self.assertEqual((done["error"], done["pct"]), ("", 100))

    def test_unknown_op_and_errors_are_reported(self):
        self.assertFalse(self.post("khong_co")[1]["ok"])
        body = self.post("create_avd", {"name": "../x", "image": "y"})[1]
        self.assertFalse(body["ok"])

    def test_adb_console_and_logcat(self):
        import time
        self.app.setup(accept=True)
        body = self.post("adb", {"target": "may1", "line": "shell id"})[1]
        self.assertEqual(body["result"], {"code": 0, "out": "ok shell id"})
        self.assertTrue(self.post("logcat_start", {"target": "may1"})[1]["ok"])
        for _ in range(100):
            polled = self.post("logcat_poll", {"cursor": 0})[1]["result"]
            if len(polled["lines"]) == 2:
                break
            time.sleep(0.05)
        self.assertIn("xin chao", polled["lines"][0])
        again = self.post("logcat_poll", {"cursor": polled["cursor"]})[1]["result"]
        self.assertEqual(again["lines"], [])


if __name__ == "__main__":
    unittest.main()
