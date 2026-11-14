#!/usr/bin/env bash
# Khôi phục dữ liệu từ một file sao lưu. XÓA SẠCH dữ liệu hiện có trong CSDL đích rồi nạp lại.
#   ./khoi-phuc.sh <file.dump>
# Hãy TẮT khoserver trước khi chạy, và bật lại sau khi xong.
set -euo pipefail
F="${1:?Cách dùng: ./khoi-phuc.sh <file.dump>}"
DB="${DATABASE_URL:-postgres://kho:kho@127.0.0.1:5432/kho_dev}"
[ -f "$F" ] || { echo "Không thấy file $F"; exit 1; }
pg_restore --list "$F" > /dev/null || { echo "File sao lưu hỏng, không khôi phục."; exit 1; }
if [ "${XAC_NHAN:-}" != "CO" ]; then
  read -r -p "Sẽ XÓA toàn bộ dữ liệu hiện có và nạp lại từ $F. Gõ CO để tiếp tục: " A
  [ "$A" = "CO" ] || { echo "Đã hủy."; exit 1; }
fi
psql "$DB" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DB" "$F"
echo "Đã khôi phục xong từ $F. Bật lại khoserver."
