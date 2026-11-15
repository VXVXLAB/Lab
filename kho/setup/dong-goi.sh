#!/usr/bin/env bash
# Đóng gói bộ cài: setup/out/KhoSetup-windows-x64.zip và setup/out/KhoSetup-linux-x64.tar.gz
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"; OUT="$HERE/out"
VER="$(date +%Y.%m.%d)-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)"
rm -rf "$OUT"; mkdir -p "$OUT"
echo "== Build giao diện"; (cd "$ROOT/frontend" && npm ci --silent && npm run build >/dev/null)
echo "== Build máy chủ"
(cd "$ROOT/backend" && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$OUT/w/KhoSetup/app/khoserver.exe" ./cmd/khoserver \
                    && CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "$OUT/l/KhoSetup/app/khoserver" ./cmd/khoserver)
# ---- Windows
W="$OUT/w/KhoSetup"; mkdir -p "$W/lenh"
cp -r "$ROOT/frontend/dist" "$W/app/giao-dien"
for f in "$HERE"/windows/*.bat "$HERE"/windows/lenh/*.bat; do   # .bat: ASCII + CRLF
  sed 's/\r$//; s/$/\r/' "$f" > "$W/${f#"$HERE/windows/"}"
done
for f in "$HERE"/windows/lenh/*.ps1 "$HERE"/windows/HUONG-DAN-CAI-DAT.txt; do   # UTF-8 có BOM + CRLF (PowerShell 5.1, Notepad)
  { printf '\xef\xbb\xbf'; sed 's/\r$//; s/$/\r/' "$f"; } > "$W/${f#"$HERE/windows/"}"
done
echo "$VER" > "$W/PHIEN-BAN.txt"
(cd "$OUT/w" && zip -qr "$OUT/KhoSetup-windows-x64.zip" KhoSetup)
# ---- Linux
L="$OUT/l/KhoSetup"; mkdir -p "$L/lenh"
cp -r "$ROOT/frontend/dist" "$L/app/giao-dien"
cp "$HERE/linux/cai-dat.sh" "$HERE/linux/cau-hinh-https.sh" "$L/"; cp "$ROOT/scripts/sao-luu.sh" "$ROOT/scripts/khoi-phuc.sh" "$L/lenh/"
cp "$ROOT/docs/CAI_DAT.md" "$L/"; echo "$VER" > "$L/PHIEN-BAN.txt"
tar -C "$OUT/l" -czf "$OUT/KhoSetup-linux-x64.tar.gz" KhoSetup
rm -rf "$OUT/w" "$OUT/l"
ls -la "$OUT"; echo "Phiên bản $VER"
