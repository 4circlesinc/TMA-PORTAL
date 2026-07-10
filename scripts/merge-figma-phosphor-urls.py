#!/usr/bin/env python3
"""Merge new {filename, url} pairs into figma-phosphor-icon-urls.json."""

import json
import sys
from pathlib import Path

URLS_FILE = Path(__file__).resolve().parent / "figma-phosphor-icon-urls.json"


def load_urls() -> dict[str, str]:
    if not URLS_FILE.exists():
        return {}
    data = json.loads(URLS_FILE.read_text())
    if isinstance(data, list):
        return {item["filename"]: item["url"] for item in data}
    return data


def save_urls(urls: dict[str, str]) -> None:
    payload = [{"filename": k, "url": v} for k, v in sorted(urls.items())]
    URLS_FILE.write_text(json.dumps(payload, indent=2) + "\n")


def main() -> int:
    new_items = json.loads(sys.stdin.read())
    urls = load_urls()
    for item in new_items:
        urls[item["filename"]] = item["url"]
    save_urls(urls)
    print(len(urls))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
