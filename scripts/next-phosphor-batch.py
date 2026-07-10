#!/usr/bin/env python3
"""Print pending Phosphor icon batches for MCP download_assets fetching."""

import json
import sys
from pathlib import Path

MANIFEST = Path(__file__).resolve().parent / "figma-phosphor-icons.json"
URLS_FILE = Path(__file__).resolve().parent / "figma-phosphor-icon-urls.json"


def load_urls() -> set[str]:
    if not URLS_FILE.exists():
        return set()
    data = json.loads(URLS_FILE.read_text())
    return {item["filename"] for item in data}


def main() -> int:
    batch_size = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    offset = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    manifest = json.loads(MANIFEST.read_text())
    have = load_urls()
    pending = [item for item in manifest if item["filename"] not in have]
    batch = pending[offset : offset + batch_size]
    json.dump(batch, sys.stdout, indent=2)
    print(f"\n# pending={len(pending)} offset={offset} batch={len(batch)} total={len(manifest)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
