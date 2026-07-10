#!/usr/bin/env python3
"""Download and clean SnowUI icon SVGs from Figma MCP asset URLs."""

import copy
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ICONS_DIR = Path(__file__).resolve().parent.parent / "public" / "images" / "icons" / "tma"
URLS_FILE = Path(__file__).resolve().parent / "figma-snowui-icon-urls.json"
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


def fetch_url(url: str) -> str:
    result = subprocess.run(
        ["curl", "-sL", url],
        capture_output=True,
        text=True,
        check=True,
    )
    content = result.stdout
    if not content.strip():
        raise ValueError("Empty response from asset URL")
    return content


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def clean_svg(content: str) -> str:
    content = re.sub(r'<rect width="32" height="32" fill="#EDEDF1"/>\s*', "", content)
    content = re.sub(r'<path d="M-\d+[^"]*" fill="white"/>\s*', "", content)

    root = ET.fromstring(content)

    frame_g = None
    for elem in root.iter():
        if _local(elem.tag) == "g" and elem.get("id") == "SnowUI Icons":
            frame_g = elem
            break

    if frame_g is None:
        raise ValueError("Could not find SnowUI Icons frame")

    for child in list(frame_g):
        if _local(child.tag) == "path" and child.get("fill") == "white":
            frame_g.remove(child)

    icon_g = None
    for child in frame_g:
        if _local(child.tag) == "g":
            icon_g = child
            break

    new_svg = ET.Element(f"{{{SVG_NS}}}svg", {
        "width": "32",
        "height": "32",
        "viewBox": "0 0 32 32",
        "fill": "none",
    })

    if icon_g is not None:
        for child in icon_g:
            new_svg.append(copy.deepcopy(child))

    for child in root:
        if _local(child.tag) == "defs":
            new_svg.append(copy.deepcopy(child))

    xml = ET.tostring(new_svg, encoding="unicode")
    if 'xmlns="http://www.w3.org/2000/svg"' not in xml:
        xml = xml.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ', 1)
    return xml + "\n"


def main() -> int:
    if not URLS_FILE.exists():
        print(f"Missing {URLS_FILE}", file=sys.stderr)
        return 1

    with URLS_FILE.open() as f:
        icons = json.load(f)

    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    ok, fail = 0, 0

    for item in icons:
        filename = item["filename"]
        url = item["url"]
        dest = ICONS_DIR / filename
        try:
            raw = fetch_url(url)
            cleaned = clean_svg(raw)
            dest.write_text(cleaned)
            print(f"✓ {filename}")
            ok += 1
        except Exception as exc:
            print(f"✗ {filename}: {exc}", file=sys.stderr)
            fail += 1

    print(f"\nDone: {ok} saved, {fail} failed -> {ICONS_DIR}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
