#!/usr/bin/env python3
"""Giám sát lộ lọt: tìm định kỳ các dấu hiệu trong danh sách theo dõi, chỉ báo phát hiện MỚI.

Nguyên tắc:
  - KHÔNG tải nội dung trang/tài liệu tìm thấy; chỉ ghi metadata (URL, tiêu đề,
    đoạn trích từ máy tìm kiếm, thời điểm) để làm bằng chứng báo cáo.
  - Dấu hiệu theo dõi do người dùng cung cấp trong file watchlist (mỗi dòng một truy vấn,
    dòng bắt đầu bằng # là chú thích).
  - Chạy trên máy được đơn vị phê duyệt: mọi truy vấn đều gửi tới máy tìm kiếm bên ngoài.

Ví dụ:
  python monitor.py watchlist.txt
  python monitor.py watchlist.txt --sites example.gov.vn,drive.google.com --out phat_hien.csv
"""

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone

import smtplib
from email.message import EmailMessage

from search import SOURCES

STATE_FILE = "monitor_state.json"


def build_report(hits, now):
    """Báo cáo dạng văn bản: chỉ metadata, không chứa nội dung tài liệu."""
    lines = [
        "BÁO CÁO PHÁT HIỆN NGHI VẤN LỘ LỌT THÔNG TIN",
        f"Thời điểm quét (UTC): {now}",
        f"Số phát hiện mới: {len(hits)}",
        "",
        "Ghi chú: công cụ không tải/lưu nội dung tài liệu. Đề nghị cán bộ có thẩm quyền",
        "xác minh và xử lý theo quy định (yêu cầu gỡ bỏ, báo cơ quan chức năng).",
        "",
    ]
    for i, h in enumerate(hits, 1):
        lines += [
            f"{i}. {h['title']}",
            f"   URL: {h['url']}",
            f"   Nguồn tìm: {h['source']} | Dấu hiệu khớp: {h['query']}",
            f"   Trích đoạn (từ máy tìm kiếm): {h['snippet'][:300]}",
            "",
        ]
    return "\n".join(lines)


def save_report(text, report_dir, now):
    os.makedirs(report_dir, exist_ok=True)
    path = os.path.join(report_dir, f"bao_cao_{now.replace(':', '').replace('-', '')}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def send_email(text, n):
    """Gửi qua SMTP nội bộ cấu hình bằng biến môi trường; bỏ qua nếu chưa cấu hình."""
    host, to = os.environ.get("SMTP_HOST"), os.environ.get("REPORT_TO")
    if not host or not to:
        return False
    msg = EmailMessage()
    msg["Subject"] = f"[Giám sát lộ lọt] {n} phát hiện mới"
    msg["From"] = os.environ.get("REPORT_FROM", os.environ.get("SMTP_USER", "monitor@localhost"))
    msg["To"] = to
    msg.set_content(text)
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=30) as s:
        if os.environ.get("SMTP_STARTTLS", "1") == "1":
            s.starttls()
        if os.environ.get("SMTP_USER"):
            s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASS", ""))
        s.send_message(msg)
    return True


def load_watchlist(path):
    with open(path, encoding="utf-8") as f:
        return [l.strip() for l in f if l.strip() and not l.lstrip().startswith("#")]


def load_state(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def main():
    p = argparse.ArgumentParser(description="Giám sát lộ lọt theo danh sách dấu hiệu.")
    p.add_argument("watchlist", help="file danh sách dấu hiệu, mỗi dòng một truy vấn")
    p.add_argument("--sources", default="google,ddg,gnews",
                   help="nguồn tìm (mặc định: google,ddg,gnews)")
    p.add_argument("--sites", default="",
                   help="giới hạn theo tên miền, cách nhau dấu phẩy (thêm site: vào truy vấn)")
    p.add_argument("--limit", type=int, default=10, help="số kết quả tối đa mỗi nguồn/truy vấn")
    p.add_argument("--state", default=STATE_FILE, help="file lưu các URL đã thấy")
    p.add_argument("--out", default="phat_hien.csv", help="file CSV ghi thêm phát hiện mới")
    p.add_argument("--report-dir", default="bao_cao", help="thư mục lưu báo cáo mỗi lần có phát hiện")
    a = p.parse_args()

    terms = load_watchlist(a.watchlist)
    sites = [s.strip() for s in a.sites.split(",") if s.strip()]
    queries = [f'{t} site:{s}' for t in terms for s in sites] if sites else terms
    sources = [s.strip() for s in a.sources.split(",") if s.strip() in SOURCES]

    state = load_state(a.state)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    new_hits = []

    for q in queries:
        for src in sources:
            try:
                results = SOURCES[src](q, a.limit, "vi")
            except Exception as e:
                print(f"[!] {src} / {q!r}: {e}", file=sys.stderr)
                continue
            for r in results:
                url = r["url"]
                if url in state:
                    continue
                state[url] = {"first_seen": now, "query": q, "source": src}
                new_hits.append({"first_seen": now, "query": q, "source": src,
                                 "title": r["title"], "url": url, "snippet": r["snippet"]})

    with open(a.state, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)

    if new_hits:
        exists = os.path.exists(a.out)
        with open(a.out, "a", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(new_hits[0].keys()))
            if not exists:
                w.writeheader()
            w.writerows(new_hits)
        print(f"[!] {len(new_hits)} PHÁT HIỆN MỚI -> {a.out}")
        for h in new_hits:
            print(f"  - [{h['source']}] {h['title']}\n    {h['url']}\n    truy vấn: {h['query']}")
        report = build_report(new_hits, now)
        print(f"[+] Báo cáo: {save_report(report, a.report_dir, now)}")
        try:
            if send_email(report, len(new_hits)):
                print(f"[+] Đã gửi email tới {os.environ['REPORT_TO']}")
        except Exception as e:
            print(f"[!] Gửi email thất bại: {e} (báo cáo vẫn được lưu)", file=sys.stderr)
    else:
        print("[=] Không có phát hiện mới.")
    # mã thoát 2 khi có phát hiện mới, để cron/CI có thể cảnh báo
    sys.exit(2 if new_hits else 0)


if __name__ == "__main__":
    main()
