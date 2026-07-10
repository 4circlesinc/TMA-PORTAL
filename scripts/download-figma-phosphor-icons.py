#!/usr/bin/env python3
"""Download and clean Phosphor icon SVGs from Figma MCP asset URLs."""

import copy
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ICONS_DIR = Path(__file__).resolve().parent.parent / "public" / "images" / "icons" / "phosphor"
MANIFEST_FILE = Path(__file__).resolve().parent / "figma-phosphor-icons.json"
URLS_FILE = Path(__file__).resolve().parent / "figma-phosphor-icon-urls.json"
FRAME_ID = "Phosphor Icons"
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


def clean_svg(content: str, frame_id: str = FRAME_ID) -> str:
    content = re.sub(r'<rect width="32" height="32" fill="#EDEDF1"/>\s*', "", content)
    content = re.sub(r'<path d="M-\d+[^"]*" fill="white"/>\s*', "", content)

    root = ET.fromstring(content)

    frame_g = None
    for elem in root.iter():
        if _local(elem.tag) == "g" and elem.get("id") == frame_id:
            frame_g = elem
            break

    if frame_g is None:
        if _local(root.tag) == "svg":
            root.set("width", "32")
            root.set("height", "32")
            root.set("viewBox", root.get("viewBox") or "0 0 32 32")
            root.set("fill", root.get("fill") or "none")
            xml = ET.tostring(root, encoding="unicode")
            if 'xmlns="http://www.w3.org/2000/svg"' not in xml:
                xml = xml.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ', 1)
            return xml + "\n"
        raise ValueError(f"Could not find {frame_id!r} frame")

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
    if not MANIFEST_FILE.exists():
        print(f"Missing {MANIFEST_FILE}", file=sys.stderr)
        return 1

    manifest = json.loads(MANIFEST_FILE.read_text())
    urls = load_urls()
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    ok, fail, skip = 0, 0, 0
    for item in manifest:
        filename = item["filename"]
        url = urls.get(filename) or item.get("url")
        if not url:
            print(f"⊘ {filename}: no URL (run URL fetch first)", file=sys.stderr)
            skip += 1
            continue
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

    print(f"\nDone: {ok} saved, {fail} failed, {skip} skipped -> {ICONS_DIR}")
    return 0 if fail == 0 and skip == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
