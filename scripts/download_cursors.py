#!/usr/bin/env python3
"""Download TMA cursor PNGs from Figma MCP asset URLs."""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URLS = ROOT / "design/_cursor-urls.json"
OUT_DIR = ROOT / "public/images/cursors"


def main() -> None:
    urls = json.loads(URLS.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for name, url in urls.items():
        dest = OUT_DIR / f"{name}.png"
        subprocess.run(["curl", "-fsSL", url, "-o", str(dest)], check=True)
        print(f"downloaded {dest.relative_to(ROOT)}")

    print(f"\nDownloaded: {len(urls)} cursors")

    import subprocess
    subprocess.run(["python3", str(ROOT / "scripts/process_cursors.py")], check=True)
    subprocess.run(["python3", str(ROOT / "scripts/build_cursor_catalog.py")], check=True)


if __name__ == "__main__":
    main()
