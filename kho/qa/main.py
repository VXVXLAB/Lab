"""Entry point: python3 main.py [name-filter ...]"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402
import t_stock, t_sales, t_service, t_drafts, t_debt_cash, t_robust, t_recon, t_extra, t_reports  # noqa: E402,F401

# make the whole-DB drill-down & dashboard consistency tests run last
order_last = ("test_REQ065_debt_summary_totals_and_dashboard", "test_REQ086_every_drilldown_id_opens_right_record")
lib.TESTS.sort(key=lambda t: t[0] in order_last)

results, secs = lib.run_all(sys.argv[1:] or None)
n = len(results)
p = sum(1 for r in results if r["status"] == "PASS")
f = n - p
checks = sum(r["checks"] for r in results)
fails = sum(len(r["failures"]) for r in results)
reqs = sorted({q for r in results for q in r["reqs"]})
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, "results.json"), "w", encoding="utf-8") as fh:
    json.dump({"results": results, "server_5xx": lib.SERVER_ERRORS}, fh, ensure_ascii=False, indent=1)
print()
print("=" * 78)
print(f"TESTS: {n}  PASS: {p}  FAIL: {f}   checks: {checks}  failed checks: {fails}   time: {secs:.0f}s")
print(f"HTTP 5xx responses seen: {len(lib.SERVER_ERRORS)}")
print("REQ covered: " + ",".join(reqs))
print("=" * 78)
sys.exit(1 if f else 0)
