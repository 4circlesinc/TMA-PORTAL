#!/usr/bin/env python3
"""Download TMA icon SVGs from Figma MCP asset URLs."""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URLS = ROOT / "design/_tma-urls.json"
MANIFEST = ROOT / "design/_tma-manifest.json"
OUT_DIR = ROOT / "public/images/icons/tma"


def main() -> None:
    urls = json.loads(URLS.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    downloaded = 0
    for item in manifest["items"]:
        slug = item["slug"]
        url = urls.get(slug)
        if not url:
            print(f"skip (no url): {slug}")
            continue
        dest = OUT_DIR / f"{slug}.svg"
        subprocess.run(["curl", "-fsSL", url, "-o", str(dest)], check=True)
        downloaded += 1
        print(f"downloaded {dest.relative_to(ROOT)}")

    print(f"\nDone: {downloaded}/{manifest['count']} TMA icons")


if __name__ == "__main__":
    main()
