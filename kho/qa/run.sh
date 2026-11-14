#!/usr/bin/env bash
# Black-box QA suite: fresh DB -> start khoserver -> run all tests -> tear down.
# Usage: ./run.sh [test-name-filter ...]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${KHOSERVER:-$HERE/../backend/bin/khoserver}"
PORT="${QA_PORT:-18181}"
DB="${QA_DB:-kho_qa}"
export PGPASSWORD="${PGPASSWORD:-kho}"
PGH="-h 127.0.0.1 -U kho"
mkdir -p "$HERE/out"

dropdb $PGH --if-exists "$DB" >/dev/null 2>&1
createdb $PGH "$DB" || { echo "cannot create database $DB"; exit 2; }

DATABASE_URL="postgres://kho:kho@127.0.0.1:5432/$DB?sslmode=disable" LISTEN_ADDR="127.0.0.1:$PORT" ADMIN_PASSWORD=admin123 \
  "$BIN" >"$HERE/out/server.log" 2>&1 &
SPID=$!
cleanup() { kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; dropdb $PGH --if-exists "$DB" >/dev/null 2>&1; }
trap cleanup EXIT

for i in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break
  sleep 0.2
done
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "server did not start"; cat "$HERE/out/server.log"; exit 2; }

QA_BASE="http://127.0.0.1:$PORT" python3 "$HERE/main.py" "$@" 2>&1 | tee "$HERE/out/run.log"
exit "${PIPESTATUS[0]}"
