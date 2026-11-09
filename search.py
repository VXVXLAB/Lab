#!/usr/bin/env python3
"""Tìm kiếm một từ khóa trên nhiều nguồn mở và lưu kết quả ra CSV/JSON.

Nguồn hỗ trợ:
  gnews   - Google News RSS (không cần khóa)
  google  - Google Custom Search JSON API (cần GOOGLE_API_KEY và GOOGLE_CSE_ID)
  wiki    - Wikipedia API
  ddg     - DuckDuckGo (bản HTML, có thể bị giới hạn tốc độ)

Ví dụ:
  python search.py "mật ong"
  python search.py "mật ong" --sources gnews,wiki --limit 20 --out ketqua.csv
"""

import argparse
import csv
import json
import os
import sys
import xml.etree.ElementTree as ET
from urllib.parse import parse_qs, unquote, urlparse

import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (X11; Linux x86_64) LabSearchScript/0.1"
TIMEOUT = 20


def _get(url, **kw):
    headers = {"User-Agent": UA, **kw.pop("headers", {})}
    r = requests.get(url, headers=headers, timeout=TIMEOUT, **kw)
    r.raise_for_status()
    return r


def search_gnews(q, limit, lang):
    gl = "VN" if lang == "vi" else "US"
    r = _get(
        "https://news.google.com/rss/search",
        params={"q": q, "hl": lang, "gl": gl, "ceid": f"{gl}:{lang}"},
    )
    root = ET.fromstring(r.content)
    out = []
    for item in root.iter("item"):
        src = item.find("source")
        out.append({
            "title": item.findtext("title", ""),
            "url": item.findtext("link", ""),
            "snippet": src.text if src is not None else "",
            "date": item.findtext("pubDate", ""),
        })
        if len(out) >= limit:
            break
    return out


def search_google(q, limit, lang):
    key, cx = os.environ.get("GOOGLE_API_KEY"), os.environ.get("GOOGLE_CSE_ID")
    if not key or not cx:
        raise RuntimeError("thiếu GOOGLE_API_KEY / GOOGLE_CSE_ID (xem README)")
    out = []
    start = 1
    while len(out) < limit and start <= 91:
        r = _get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": key, "cx": cx, "q": q, "hl": lang,
                    "num": min(10, limit - len(out)), "start": start},
        )
        items = r.json().get("items", [])
        if not items:
            break
        for it in items:
            out.append({"title": it.get("title", ""), "url": it.get("link", ""),
                        "snippet": it.get("snippet", ""), "date": ""})
        start += 10
    return out[:limit]


def search_wiki(q, limit, lang):
    r = _get(
        f"https://{lang}.wikipedia.org/w/api.php",
        params={"action": "query", "list": "search", "srsearch": q,
                "srlimit": min(limit, 50), "format": "json"},
    )
    out = []
    for it in r.json().get("query", {}).get("search", []):
        title = it["title"]
        snippet = BeautifulSoup(it.get("snippet", ""), "lxml").get_text()
        out.append({
            "title": title,
            "url": f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}",
            "snippet": snippet,
            "date": it.get("timestamp", ""),
        })
    return out


def search_ddg(q, limit, lang):
    r = requests.post("https://html.duckduckgo.com/html/", data={"q": q},
                      headers={"User-Agent": UA}, timeout=TIMEOUT)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    out = []
    for res in soup.select(".result"):
        a = res.select_one("a.result__a")
        if not a:
            continue
        href = a.get("href", "")
        # DDG bọc link thật trong tham số uddg
        qs = parse_qs(urlparse(href).query)
        if "uddg" in qs:
            href = unquote(qs["uddg"][0])
        sn = res.select_one(".result__snippet")
        out.append({"title": a.get_text(strip=True), "url": href,
                    "snippet": sn.get_text(strip=True) if sn else "", "date": ""})
        if len(out) >= limit:
            break
    if not out:
        raise RuntimeError("không lấy được kết quả (có thể bị chặn/giới hạn tốc độ)")
    return out


SOURCES = {"gnews": search_gnews, "google": search_google,
           "wiki": search_wiki, "ddg": search_ddg}


def main():
    p = argparse.ArgumentParser(description="Tìm từ khóa trên các nguồn mở.")
    p.add_argument("query", help="từ khóa cần tìm")
    p.add_argument("--sources", default="gnews,google,wiki,ddg",
                   help="danh sách nguồn, cách nhau bởi dấu phẩy (mặc định: tất cả)")
    p.add_argument("--limit", type=int, default=10, help="số kết quả tối đa mỗi nguồn")
    p.add_argument("--lang", default="vi", help="ngôn ngữ (vi, en, ...)")
    p.add_argument("--out", help="file kết quả (.csv hoặc .json)")
    a = p.parse_args()

    rows, seen = [], set()
    for name in [s.strip() for s in a.sources.split(",") if s.strip()]:
        fn = SOURCES.get(name)
        if not fn:
            print(f"[!] nguồn không hợp lệ: {name}", file=sys.stderr)
            continue
        try:
            res = fn(a.query, a.limit, a.lang)
        except Exception as e:  # một nguồn lỗi không làm hỏng cả lần chạy
            print(f"[!] {name}: bỏ qua - {e}", file=sys.stderr)
            continue
        new = 0
        for r in res:
            if r["url"] in seen:
                continue
            seen.add(r["url"])
            rows.append({"source": name, **r})
            new += 1
        print(f"[+] {name}: {new} kết quả", file=sys.stderr)

    if a.out:
        if a.out.endswith(".json"):
            with open(a.out, "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False, indent=2)
        else:
            with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
                w = csv.DictWriter(f, fieldnames=["source", "title", "url", "snippet", "date"])
                w.writeheader()
                w.writerows(rows)
        print(f"[=] đã lưu {len(rows)} kết quả vào {a.out}", file=sys.stderr)
    else:
        for r in rows:
            print(f"[{r['source']}] {r['title']}\n    {r['url']}")
            if r["snippet"]:
                print(f"    {r['snippet'][:160]}")


if __name__ == "__main__":
    main()
