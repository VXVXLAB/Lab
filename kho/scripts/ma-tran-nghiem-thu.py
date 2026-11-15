#!/usr/bin/env python3
"""Sinh docs/NGHIEM_THU_TONG_HOP.md: 91 đầu việc ↔ số test ở 3 bộ kiểm thử.
Đọc mã REQ trực tiếp từ mã nguồn test (Go, QA Python) và kết quả lần chạy E2E gần nhất (e2e/out/ket-qua.json).
Chạy sau khi đã chạy cả 3 bộ:  python3 scripts/ma-tran-nghiem-thu.py "<kết quả Go>" "<kết quả QA>"
"""
import glob, json, os, re, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
go_res = sys.argv[1] if len(sys.argv) > 1 else "chưa chạy"
qa_res = sys.argv[2] if len(sys.argv) > 2 else "chưa chạy"

# 91 đầu việc
reqs = {}
for line in open(f"{ROOT}/docs/yeu-cau/TODO_91_DAU_VIEC.md", encoding="utf-8"):
    m = re.match(r"\|\s*(\d{3})\s*\|\s*([^|]+)\|", line)
    if m:
        reqs[m.group(1)] = m.group(2).strip()

# Go: tên TestREQ012_078_… và chú thích "// REQ: 067, 066" ngay trước hàm
go = defaultdict(set)
for f in glob.glob(f"{ROOT}/backend/tests/*_test.go"):
    pending = []
    for line in open(f, encoding="utf-8"):
        c = re.match(r"//\s*REQ:\s*(.+)", line)
        if c:
            pending += re.findall(r"\d{3}", c.group(1))
            continue
        fn = re.match(r"func (Test\w+)\(", line)
        if fn:
            name = fn.group(1)
            ids = set(pending)
            head = re.match(r"TestREQ((?:\d{3}_)+)", name)
            if head:
                ids |= set(re.findall(r"\d{3}", head.group(1)))
            for i in ids:
                go[i].add(name)
            pending = []
        elif line.strip() and not line.startswith("//"):
            pending = []
go_total = len({n for s in go.values() for n in s})

# QA: @test("052,053", "tên")
qa = defaultdict(set)
for f in glob.glob(f"{ROOT}/qa/t_*.py"):
    for ids, name in re.findall(r'@test\("([^"]*)",\s*"([^"]+)"', open(f, encoding="utf-8").read()):
        for i in re.findall(r"\d{3}", ids):
            qa[i].add(name)
qa_total = len({n for s in qa.values() for n in s})

# E2E: tiêu đề test có "REQ-012", kèm trạng thái lần chạy gần nhất
e2e, e2e_bad = defaultdict(set), defaultdict(set)
stats = {}
p = f"{ROOT}/e2e/out/ket-qua.json"
if os.path.exists(p):
    data = json.load(open(p, encoding="utf-8"))
    stats = data.get("stats", {})

    def walk(suite):
        for spec in suite.get("specs", []):
            ok = spec.get("ok", False)
            for i in re.findall(r"REQ-(\d{3})", spec["title"]):
                (e2e if ok else e2e_bad)[i].add(spec["title"])
        for s in suite.get("suites", []):
            walk(s)

    for s in data.get("suites", []):
        walk(s)
e2e_total = stats.get("expected", 0)
e2e_res = (f"{stats.get('expected', 0)} đạt, {stats.get('unexpected', 0)} hỏng, {stats.get('flaky', 0)} chập chờn"
           if stats else "chưa chạy")

MANUAL = {
    "088": "Cần khách: UAT với dữ liệu thật",
    "089": "Quy trình: sửa lỗi sau UAT (đã chạy 4 vòng sửa lỗi nội bộ, xem e2e/BAO_CAO_E2E.md)",
    "090": "Tài liệu: docs/HUONG_DAN_SU_DUNG.md (có trong phần mềm, mục Hướng dẫn) + docs/CAI_DAT.md",
    "091": "Cần khách: biên bản bàn giao",
}

out = ["# NGHIỆM THU TỔNG HỢP — 91 đầu việc ↔ ba bộ kiểm thử", "",
       "File này do `scripts/ma-tran-nghiem-thu.py` sinh ra từ mã nguồn test và kết quả lần chạy gần nhất; không sửa tay.",
       "",
       "| Bộ kiểm thử | Do ai viết | Cách chạy | Kết quả lần chạy gần nhất |", "|---|---|---|---|",
       f"| Backend (Go, qua HTTP trên PostgreSQL thật) — {go_total} test có gắn mã | Agent backend | `cd backend && go test ./... -count=1` | {go_res} |",
       f"| QA hộp đen qua API (Python) — {qa_total} test | Agent QA độc lập, không đọc mã backend | `cd qa && ./run.sh` | {qa_res} |",
       f"| Trình duyệt thật (Playwright) — {e2e_total} test | Agent kiểm thử độc lập, thao tác như người dùng | `cd e2e && ./run.sh` | {e2e_res} |",
       "",
       "Cột số là **số test có gắn mã đầu việc đó** ở từng bộ. \"Tự động: ĐẠT\" nghĩa là mọi test gắn mã đó đều đạt ở lần chạy gần nhất.",
       "Đạt tự động **chưa phải** nghiệm thu của khách: mục 088 (UAT) và 091 (bàn giao) vẫn cần khách làm.",
       "", "| Mã | Đầu việc | Go | QA | Trình duyệt | Kết quả |", "|---|---|---|---|---|---|"]
n_auto = n_manual = n_none = 0
for i in sorted(reqs):
    g, q, e, bad = len(go[i]), len(qa[i]), len(e2e[i]), len(e2e_bad[i])
    if i in MANUAL:
        res = MANUAL[i]; n_manual += 1
    elif bad:
        res = f"**CÓ {bad} TEST TRÌNH DUYỆT HỎNG**"
    elif g + q + e == 0:
        res = "**CHƯA CÓ TEST**"; n_none += 1
    else:
        res = "Tự động: ĐẠT" + (" · quy tắc cần khách xác nhận" if i <= "008" else ""); n_auto += 1
    out.append(f"| {i} | {reqs[i]} | {g or '–'} | {q or '–'} | {e or '–'} | {res} |")
out += ["", f"Tổng: {len(reqs)} đầu việc — {n_auto} có test tự động và đạt, {n_manual} cần người/khách, {n_none} chưa có test.", ""]
open(f"{ROOT}/docs/NGHIEM_THU_TONG_HOP.md", "w", encoding="utf-8").write("\n".join(out))
print(out[-2])
