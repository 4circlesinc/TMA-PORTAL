#!/usr/bin/env python3
"""Apply MCP download_assets batch results to figma-phosphor-icon-urls.json.

Usage:
  python3 apply-mcp-batch.py batch-results.json

batch-results.json format:
[
  {"nodeId": "32730:413981", "filename": "WaveSawtooth.svg", "url": "https://..."},
  ...
]
"""

import json
import sys
from pathlib import Path

MANIFEST = Path(__file__).resolve().parent / "figma-phosphor-icons.json"
URLS_FILE = Path(__file__).resolve().parent / "figma-phosphor-icon-urls.json"


def load_urls() -> dict[str, str]:
    if not URLS_FILE.exists():
        return {}
    data = json.loads(URLS_FILE.read_text())
    return {item["filename"]: item["url"] for item in data}


def save_urls(urls: dict[str, str]) -> None:
    payload = [{"filename": k, "url": v} for k, v in sorted(urls.items())]
    URLS_FILE.write_text(json.dumps(payload, indent=2) + "\n")


def main() -> int:
    batch = json.loads(Path(sys.argv[1]).read_text())
    urls = load_urls()
    added = 0
    for item in batch:
        if not item.get("url"):
            print(f"missing url: {item.get('filename')}", file=sys.stderr)
            continue
        urls[item["filename"]] = item["url"]
        added += 1
    save_urls(urls)
    manifest = json.loads(MANIFEST.read_text())
    pending = sum(1 for m in manifest if m["filename"] not in urls)
    print(f"added={added} total={len(urls)} pending={pending}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
