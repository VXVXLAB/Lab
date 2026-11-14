#!/usr/bin/env bash
# Chạy toàn bộ bộ kiểm thử nghiệm thu đầu-cuối:
#   CSDL mới (kho_e2e) → khởi động khoserver riêng (cổng 18091) → Playwright → dừng máy chủ.
# Mã thoát = kết quả Playwright (0 = tất cả đạt). Tham số thêm được chuyển cho Playwright
# (vd. ./run.sh tests/02_the_kho.spec.js).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PORT="${E2E_PORT:-18091}"
DB="${E2E_DB:-kho_e2e}"
PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-kho}" PGPASSWORD="${PGPASSWORD:-kho}"
export PGHOST PGPORT PGUSER PGPASSWORD
export E2E_BASE_URL="http://127.0.0.1:${PORT}"
OUT="$HERE/out"

cd "$HERE"
if [ ! -e node_modules/exceljs ] || [ ! -e node_modules/playwright ]; then
  npm install --no-audit --no-fund >/dev/null || { echo "npm install thất bại"; exit 2; }
fi

rm -rf "$OUT"; mkdir -p "$OUT"
if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "Cổng ${PORT} đang bận — dừng tiến trình cũ hoặc đặt E2E_PORT khác"; exit 2
fi

echo "== Tạo CSDL mới ${DB}"
dropdb --if-exists "$DB" || exit 2
createdb "$DB" || exit 2

echo "== Khởi động máy chủ tại ${E2E_BASE_URL}"
DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}" \
LISTEN_ADDR="127.0.0.1:${PORT}" \
STATIC_DIR="$ROOT/frontend/dist" \
  "$ROOT/backend/bin/khoserver" >"$OUT/server.log" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 100); do
  curl -fsS "${E2E_BASE_URL}/api/health" >/dev/null 2>&1 && break
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "Máy chủ dừng khi khởi động:"; cat "$OUT/server.log"; exit 2; }
  sleep 0.1
done
curl -fsS "${E2E_BASE_URL}/api/health" >/dev/null || { echo "Máy chủ không phản hồi"; exit 2; }

echo "== Chạy Playwright"
START=$(date +%s)
node "$HERE/node_modules/playwright/cli.js" test --trace off "$@"
CODE=$?
echo "== Xong sau $(( $(date +%s) - START )) giây, mã thoát ${CODE}. Ảnh màn hình: $OUT/screenshots, file xuất: $OUT/files"
exit $CODE
