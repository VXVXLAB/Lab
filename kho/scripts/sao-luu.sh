#!/usr/bin/env bash
# Sao lưu toàn bộ dữ liệu phần mềm kho ra một file. Đặt lịch chạy hằng ngày (xem docs/CAI_DAT.md).
#   ./sao-luu.sh [thư-mục-lưu]        (mặc định: ./sao-luu)
# Biến môi trường: DATABASE_URL (mặc định CSDL kho_dev trên máy này), GIU_NGAY (số ngày giữ, mặc định 30).
set -euo pipefail
DB="${DATABASE_URL:-postgres://kho:kho@127.0.0.1:5432/kho_dev}"
DIR="${1:-$(dirname "$0")/sao-luu}"
KEEP="${GIU_NGAY:-30}"
mkdir -p "$DIR"
F="$DIR/kho-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$F.tmp" "$DB"
# Kiểm tra file đọc lại được trước khi coi là xong.
pg_restore --list "$F.tmp" > /dev/null
mv "$F.tmp" "$F"
find "$DIR" -name 'kho-*.dump' -mtime +"$KEEP" -delete
echo "Đã sao lưu: $F ($(du -h "$F" | cut -f1)). Giữ các bản trong $KEEP ngày."
