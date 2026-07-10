#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/.dev-server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "[tma-dev-server] not running"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "[tma-dev-server] stopped (pid $PID)"
else
  echo "[tma-dev-server] stale pid file removed"
fi

rm -f "$PID_FILE"
