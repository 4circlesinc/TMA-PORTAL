#!/usr/bin/env python3
"""Build design/icons-*.json catalogs from manifests and exported files."""

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def build_tma() -> dict:
    manifest = json.loads((ROOT / "design/_tma-manifest.json").read_text())
    icon_dir = ROOT / "public/images/icons/tma"
    files = {p.stem for p in icon_dir.glob("*.svg")}

    items = []
    for item in manifest["items"]:
        slug = item["slug"]
        items.append({
            **item,
            "file": f"{slug}.svg" if slug in files else None,
            "size": "32x32",
            "exported": slug in files,
        })

    return {
        "source": {
            "fileKey": "58ZXC7sZYQsbenzf0foWCH",
            "frameId": "32730:413847",
            "frameName": "TMA Icons",
            "url": "https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design?node-id=32730-413847",
        },
        "description": "TMA custom icon set from Portal-Design.",
        "exportPath": "public/images/icons/tma",
        "export": {
            "format": "svg",
            "exportedAt": str(date.today()),
            "count": sum(1 for i in items if i["exported"]),
            "total": len(items),
        },
        "items": items,
        "laravelUsage": "asset('images/icons/tma/Search.svg')",
    }


def build_phosphor() -> dict:
    manifest = json.loads((ROOT / "design/_phosphor-manifest.json").read_text())
    icon_dir = ROOT / "public/images/icons/phosphor"
    files = {p.stem for p in icon_dir.glob("*.svg")}

    items = []
    for item in manifest["items"]:
        slug = item["slug"]
        items.append({
            **item,
            "file": f"{slug}.svg",
            "size": "32x32",
            "exported": slug in files,
        })

    return {
        "source": {
            "fileKey": "58ZXC7sZYQsbenzf0foWCH",
            "frameId": "32730:413932",
            "frameName": "Phosphor Icons",
            "url": "https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design?node-id=32730-413932",
        },
        "description": "Phosphor Icons 2.0 Regular — synced from @phosphor-icons/core (matches Figma frame).",
        "attribution": "Phosphor Icons by Tobias Fried & Helena Zhang — MIT. https://phosphoricons.com",
        "exportPath": "public/images/icons/phosphor",
        "export": {
            "format": "svg",
            "exportedAt": str(date.today()),
            "count": sum(1 for i in items if i["exported"]),
            "total": len(items),
        },
        "items": items,
        "laravelUsage": "asset('images/icons/phosphor/Search.svg')",
    }


def main() -> None:
    tma = build_tma()
    phosphor = build_phosphor()

    (ROOT / "design/icons-tma.json").write_text(
        json.dumps(tma, indent=2) + "\n", encoding="utf-8"
    )
    (ROOT / "design/icons-phosphor.json").write_text(
        json.dumps(phosphor, indent=2) + "\n", encoding="utf-8"
    )

    # Lightweight preview manifest (names + files only)
    preview = {
        "tma": [
            {"name": i["name"], "slug": i["slug"], "file": i["file"]}
            for i in tma["items"] if i["exported"]
        ],
        "phosphor": [
            {"name": i["name"], "slug": i["slug"], "file": i["file"]}
            for i in phosphor["items"] if i["exported"]
        ],
    }
    (ROOT / "public/demo/icons-catalog.json").write_text(
        json.dumps(preview, indent=2) + "\n", encoding="utf-8"
    )

    print(f"TMA: {tma['export']['count']}/{tma['export']['total']}")
    print(f"Phosphor: {phosphor['export']['count']}/{phosphor['export']['total']}")


if __name__ == "__main__":
    main()
