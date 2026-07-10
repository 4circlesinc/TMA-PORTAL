#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/.dev-server.pid"
LOG_FILE="$ROOT/.dev-server.log"
HOST="${DEV_SERVER_HOST:-127.0.0.1}"
PORT="${DEV_SERVER_PORT:-8765}"

is_listening() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

cleanup_stale_pid() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null && is_listening; then
    return 0
  fi

  rm -f "$PID_FILE"
  return 1
}

if cleanup_stale_pid; then
  echo "[tma-dev-server] already running (pid $(cat "$PID_FILE"))"
  echo "[tma-dev-server] http://$HOST:$PORT/"
  exit 0
fi

if is_listening; then
  echo "[tma-dev-server] port $PORT is in use — stopping old server..."
  lsof -tiTCP:"$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true
  sleep 0.5
fi

nohup python3 "$ROOT/scripts/dev_server.py" --host "$HOST" --port "$PORT" >>"$LOG_FILE" 2>&1 </dev/null &
disown -h

for _ in {1..20}; do
  if [[ -f "$PID_FILE" ]] && is_listening; then
    PID="$(cat "$PID_FILE")"
    echo "[tma-dev-server] started (pid $PID)"
    echo "[tma-dev-server] http://$HOST:$PORT/"
    echo "[tma-dev-server] log: $LOG_FILE"
    exit 0
  fi
  sleep 0.25
done

echo "[tma-dev-server] failed to start; see $LOG_FILE" >&2
tail -n 20 "$LOG_FILE" 2>/dev/null || true
exit 1
