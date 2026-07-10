#!/usr/bin/env python3
"""Download TMA brand icons used in Frame task rows (Figma 33159:3570–3559)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "images" / "icons" / "brands"

# Direct icon renders from get_design_context per task row node.
BRANDS = {
    "PriorityMedium40": "https://www.figma.com/api/mcp/asset/aed54a16-d6d1-4575-b7f6-dbc2062eaf31",
    "Github40": "https://www.figma.com/api/mcp/asset/d8abfe3d-954e-41e2-8522-0b296257746b",
    "Figma40": "https://www.figma.com/api/mcp/asset/f9ff6c26-917d-4d47-832b-eaa572e7c7c3",
    "Slack40": "https://www.figma.com/api/mcp/asset/546f3edd-ee7c-4091-8552-3d8c85931352",
    "Loop40": "https://www.figma.com/api/mcp/asset/d0373b1d-6cdd-4026-9eb1-0acfde65b319",
    "Messenger40": "https://www.figma.com/api/mcp/asset/46e225c5-f30c-48ee-9de1-9dcad93957cb",
    "Dribbble40": "https://www.figma.com/api/mcp/asset/ce9acbd8-ac54-4183-8ac9-768664d02ee9",
    "ChatGPT40": "https://www.figma.com/api/mcp/asset/fdf28ea5-9cc3-4688-b750-a7fd3f9af583",
    "Dropbox40": "https://www.figma.com/api/mcp/asset/8a8ef6b0-1e00-4fd1-aff5-77ab347d9bc0",
    "Behance40": "https://www.figma.com/api/mcp/asset/99c3d89c-3720-4850-86ac-c24405a0576e",
    "Copilot40": "https://www.figma.com/api/mcp/asset/03e75c5a-746c-4439-aa67-bd5fc0fd93cc",
    "SnowLogo40": "https://www.figma.com/api/mcp/asset/3a89c898-676f-440c-97b9-12e438d8e703",
}


def curl(url: str) -> bytes:
    return subprocess.check_output(["curl", "-sL", url])


def write_icon(name: str, url: str) -> None:
    data = curl(url)
    if not data:
        raise RuntimeError(f"Empty download for {name}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.svg").write_bytes(data)
    print(f"wrote {name}.svg ({len(data)} bytes)")


def main() -> int:
    for name, url in BRANDS.items():
        write_icon(name, url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
