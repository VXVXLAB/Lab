#!/usr/bin/env python3
"""adb giả cho test: ghi lại mọi lệnh được gọi và trả lời như một máy giả lập đang chạy."""
import json
import os
import sys

args = sys.argv[1:]
with open(os.environ["FAKE_ADB_LOG"], "a", encoding="utf-8") as f:
    f.write(json.dumps(args) + "\n")
if args and args[0] == "-s":
    args = args[2:]
if args == ["devices"]:
    print("List of devices attached\nemulator-5554\tdevice\n")
elif args == ["emu", "avd", "name"]:
    print("may1\nOK")
elif args[:1] == ["emu"]:
    print("KO: lenh bi tu choi" if "bad" in args else "OK")
elif args[:2] == ["exec-out", "screencap"]:
    sys.stdout.buffer.write(b"\x89PNG\r\n\x1a\nfake")
elif args[:2] == ["shell", "pidof"]:
    if os.path.exists(os.environ["FAKE_ADB_LOG"] + ".frida"):
        print("4242")
elif args[:1] == ["shell"] and "nohup" in " ".join(args):
    open(os.environ["FAKE_ADB_LOG"] + ".frida", "w").close()
elif args[:2] == ["shell", "getprop"]:
    print({"ro.product.cpu.abi": "x86_64", "sys.boot_completed": "1"}.get(args[2], "x"))
elif args == ["shell", "false"]:
    print("that bai")
    sys.exit(1)
elif args[:1] == ["logcat"]:
    print("11-12 10:00:00.000  100  100 I Tag: xin chao")
    print("11-12 10:00:00.001  100  100 E Tag: loi")
else:
    print("ok " + " ".join(args))
