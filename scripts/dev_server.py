#!/usr/bin/env python3
"""Persistent static dev server for tma-portal.

Serves the public/ directory with no-cache headers so file edits show up
on refresh without restarting. Uses a distinct process name so generic
`pkill -f http.server` does not stop this server.
"""

from __future__ import annotations

import argparse
import atexit
import os
import signal
import socket
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
PID_FILE = ROOT / ".dev-server.pid"
DEFAULT_PORT = 8765
DEFAULT_HOST = "127.0.0.1"


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str | None = None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def _request_path(self) -> str:
        return self.path.split("?", 1)[0].split("#", 1)[0]

    def _resolve_spa_path(self) -> str | None:
        """Mirror public/.htaccess: nested index.html, then dashboard shell."""
        raw = self._request_path()
        if not raw or raw == "/":
            return None

        clean = raw.rstrip("/")
        fs_path = self.translate_path(clean)

        if os.path.isfile(fs_path):
            return None

        if os.path.isdir(fs_path):
            if os.path.isfile(os.path.join(fs_path, "index.html")):
                return None
        else:
            nested = self.translate_path(f"{clean}/index.html")
            if os.path.isfile(nested):
                query = self.path.split("?", 1)[1] if "?" in self.path else ""
                return f"{clean}/index.html" + (f"?{query}" if query else "")

        _, ext = os.path.splitext(clean)
        if ext:
            return None

        root_index = os.path.join(self.directory or "", "index.html")
        if os.path.isfile(root_index):
            query = self.path.split("?", 1)[1] if "?" in self.path else ""
            return "/index.html" + (f"?{query}" if query else "")

        return None

    def list_directory(self, path: str):
        self.send_error(404, "Not Found")
        return None

    def do_GET(self) -> None:
        fallback = self._resolve_spa_path()
        if fallback is not None:
            self.path = fallback
        super().do_GET()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        sys.stdout.write(f"[tma-dev-server] {self.address_string()} - {format % args}\n")
        sys.stdout.flush()


def write_pid() -> None:
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")


def remove_pid() -> None:
    try:
        PID_FILE.unlink(missing_ok=True)
    except OSError:
        pass


def port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="tma-portal dev static server")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    if not PUBLIC.is_dir():
        print(f"[tma-dev-server] missing directory: {PUBLIC}", file=sys.stderr)
        return 1

    if port_in_use(args.host, args.port):
        print(
            f"[tma-dev-server] port {args.port} already in use on {args.host}",
            file=sys.stderr,
        )
        return 1

    handler = partial(DevHandler, directory=str(PUBLIC))
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    httpd.allow_reuse_address = True

    write_pid()
    atexit.register(remove_pid)

    def shutdown(_signum: int, _frame: object) -> None:
        print("\n[tma-dev-server] shutting down")
        httpd.shutdown()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    url = f"http://{args.host}:{args.port}/"
    print(f"[tma-dev-server] serving {PUBLIC}")
    print(f"[tma-dev-server] open {url}")
    print(f"[tma-dev-server] pid {os.getpid()} (safe from http.server pkill)")

    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
        remove_pid()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
