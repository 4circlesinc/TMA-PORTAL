#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEV_SERVER_HOST:-127.0.0.1}"
PORT="${DEV_SERVER_PORT:-8765}"

echo "[tma-dev-server] starting on http://$HOST:$PORT/"
echo "[tma-dev-server] press Ctrl+C to stop"
echo "[tma-dev-server] edits apply on browser refresh (no restart needed)"
echo

while true; do
  python3 "$ROOT/scripts/dev_server.py" --host "$HOST" --port "$PORT" || true
  echo "[tma-dev-server] exited — restarting in 1s..."
  sleep 1
done
