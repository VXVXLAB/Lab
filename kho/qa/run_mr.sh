#!/usr/bin/env bash
# Black-box QA of the EXTENDED edition (M1 + M2):
#   1. fresh DB kho_qa_mr      -> khoserver with KHO_EDITION=extended on 127.0.0.1:18391 -> all mr_*.py tests
#      (C13 starts extra khoserver processes with TLS on 127.0.0.1:18396 against the same DB)
#   2. fresh DB kho_qa_mr_base -> khoserver WITHOUT KHO_EDITION   on 127.0.0.1:18392 -> mr_base.py
# Never touches :8080 / :8090 / :18091, never rebuilds the binary.
# Usage: ./run_mr.sh [test-name-filter ...]      (filters apply to the extended phase; the base phase always runs)
# Exit code: 0 only if both phases pass. Known product bugs are kept as failing tests -> non-zero exit is expected
# until they are fixed (see BAO_CAO_QA_MO_RONG.md).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${KHOSERVER:-$HERE/../backend/bin/khoserver}"
PORT_EXT="${MR_PORT:-18391}"
PORT_BASE="${MR_PORT_BASE:-18392}"
PORT_TLS="${MR_TLS_PORT:-18396}"   # C13: a second khoserver with a self-signed certificate (started by mr_m3_c12.py)
DB_EXT="${MR_DB:-kho_qa_mr}"
DB_BASE="${MR_DB_BASE:-kho_qa_mr_base}"
export PGPASSWORD="${PGPASSWORD:-kho}"
PGH="-h 127.0.0.1 -U kho"
OUT="$HERE/out"
mkdir -p "$OUT"

for p in "$PORT_EXT" "$PORT_BASE" "$PORT_TLS"; do
  case "$p" in 8080|8090|18091) echo "refusing to use port $p"; exit 2;; esac
  if curl -s -m 1 "http://127.0.0.1:$p/api/health" >/dev/null 2>&1; then echo "port $p already in use"; exit 2; fi
done
[ -x "$BIN" ] || { echo "binary not found: $BIN"; exit 2; }

if ! pg_isready -h 127.0.0.1 -q 2>/dev/null; then
  echo "PostgreSQL not running - starting cluster 16/main"
  pg_ctlcluster 16 main start || { echo "cannot start PostgreSQL"; exit 2; }
  for i in $(seq 1 30); do pg_isready -h 127.0.0.1 -q && break; sleep 0.5; done
fi

PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; wait "$p" 2>/dev/null; done
  if [ -z "${MR_KEEP_DB:-}" ]; then
    dropdb $PGH --if-exists "$DB_EXT" >/dev/null 2>&1
    dropdb $PGH --if-exists "$DB_BASE" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

start_server() {  # db port edition logfile
  local db="$1" port="$2" edition="$3" log="$4"
  dropdb $PGH --if-exists "$db" >/dev/null 2>&1
  createdb $PGH "$db" || { echo "cannot create database $db"; exit 2; }
  if [ -n "$edition" ]; then
    KHO_EDITION="$edition" DATABASE_URL="postgres://kho:kho@127.0.0.1:5432/$db?sslmode=disable" LISTEN_ADDR="127.0.0.1:$port" \
      ADMIN_PASSWORD=admin123 "$BIN" >"$log" 2>&1 &
  else
    env -u KHO_EDITION DATABASE_URL="postgres://kho:kho@127.0.0.1:5432/$db?sslmode=disable" LISTEN_ADDR="127.0.0.1:$port" \
      ADMIN_PASSWORD=admin123 "$BIN" >"$log" 2>&1 &
  fi
  PIDS+=($!)
  for i in $(seq 1 75); do
    curl -sf "http://127.0.0.1:$port/api/health" >/dev/null && return 0
    sleep 0.2
  done
  echo "server on :$port did not start"; cat "$log"; exit 2
}

echo "=== phase 1: EXTENDED edition (KHO_EDITION=extended) on :$PORT_EXT, db $DB_EXT"
start_server "$DB_EXT" "$PORT_EXT" extended "$OUT/mr_server_extended.log"
QA_BASE="http://127.0.0.1:$PORT_EXT" MR_MODE=extended KHOSERVER="$BIN" MR_TLS_PORT="$PORT_TLS" \
  MR_DATABASE_URL="postgres://kho:kho@127.0.0.1:5432/$DB_EXT?sslmode=disable" python3 "$HERE/mr_main.py" "$@" 2>&1 | tee "$OUT/mr_run_extended.log"
RC1=${PIPESTATUS[0]}

echo
echo "=== phase 2: BASE edition (no KHO_EDITION) on :$PORT_BASE, db $DB_BASE"
start_server "$DB_BASE" "$PORT_BASE" "" "$OUT/mr_server_base.log"
QA_BASE="http://127.0.0.1:$PORT_BASE" MR_MODE=base python3 "$HERE/mr_main.py" 2>&1 | tee "$OUT/mr_run_base.log"
RC2=${PIPESTATUS[0]}

PANICS=$(grep -c -i "panic" "$OUT/mr_server_extended.log" "$OUT/mr_server_base.log" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
echo
echo "extended phase exit=$RC1   base phase exit=$RC2   server log lines with 'panic': $PANICS"
[ "$RC1" -eq 0 ] && [ "$RC2" -eq 0 ] && exit 0
exit 1
