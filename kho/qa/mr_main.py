"""Entry point of the extended-edition QA suite.

    QA_BASE=http://127.0.0.1:PORT python3 mr_main.py [name-filter ...]
    MR_MODE=base  ... runs only the base-edition checks (server started WITHOUT KHO_EDITION).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402

MODE = os.environ.get("MR_MODE", "extended")
if MODE == "base":
    import mr_base  # noqa: E402,F401
else:
    import mr_f, mr_c1, mr_c1_mask, mr_c4, mr_c3, mr_c5, mr_c6, mr_c8, mr_c7, mr_general  # noqa: E402,F401

results, secs = lib.run_all(sys.argv[1:] or None)
n = len(results)
p = sum(1 for r in results if r["status"] == "PASS")
f = n - p
checks = sum(r["checks"] for r in results)
fails = sum(len(r["failures"]) for r in results)
tags = {}
for r in results:
    for t in r["reqs"]:
        a = tags.setdefault(t, [0, 0])
        a[0] += 1
        a[1] += r["status"] == "PASS"
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, f"mr_results_{MODE}.json"), "w", encoding="utf-8") as fh:
    json.dump({"mode": MODE, "results": results, "server_5xx": lib.SERVER_ERRORS}, fh, ensure_ascii=False, indent=1)
print()
print("=" * 78)
print(f"[{MODE}] TESTS: {n}  PASS: {p}  FAIL: {f}   checks: {checks}  failed checks: {fails}   time: {secs:.0f}s")
print(f"HTTP 5xx responses seen: {len(lib.SERVER_ERRORS)}")
for e in lib.SERVER_ERRORS[:20]:
    print("   5xx: " + e[:300])
print("By feature: " + "  ".join(f"{k}:{v[1]}/{v[0]}" for k, v in sorted(tags.items())))
print("=" * 78)
sys.exit(1 if f else 0)
