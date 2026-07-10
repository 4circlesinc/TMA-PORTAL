#!/usr/bin/env python3
"""Build design/cursors.json and generate public/css/cursors.css."""

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIZE = 32
CURSOR_PATH = "../images/cursors"

CURSORS = [
    ("32261:178338", "CursorsDefault", "--cursor-default", [15, 14], "default"),
    ("32261:178339", "CursorsBeachball", "--cursor-beachball", [16, 16], "wait"),
    ("32261:178340", "CursorsTextCursor", "--cursor-text", [16, 16], "text"),
    ("32261:178341", "CursorsCross", "--cursor-cross", [16, 16], "crosshair"),
    ("32261:178342", "CursorsMenu", "--cursor-menu", [16, 8], "context-menu"),
    ("32261:178343", "CursorsZoomOut", "--cursor-zoom-out", [16, 16], "zoom-out"),
    ("32261:178344", "CursorsZoomIn", "--cursor-zoom-in", [16, 16], "zoom-in"),
    ("32261:178345", "CursorsHandPointing", "--cursor-pointer", [11, 14], "pointer"),
    ("32261:178346", "CursorsHandGrabbing", "--cursor-grabbing", [16, 18], "grabbing"),
    ("32261:178347", "CursorsHandOpen", "--cursor-grab", [16, 10], "grab"),
    ("32261:178348", "CursorsMove", "--cursor-move", [16, 16], "move"),
    ("32261:178349", "CursorsResizeLeft", "--cursor-resize-left", [16, 16], "w-resize"),
    ("32261:178350", "CursorsResizeDown", "--cursor-resize-down", [16, 16], "s-resize"),
    ("32261:178351", "CursorsResizeRight", "--cursor-resize-right", [16, 16], "e-resize"),
    ("32261:178352", "CursorsResizeUp", "--cursor-resize-up", [16, 16], "n-resize"),
    ("32261:178353", "CursorsResizeLeftRight", "--cursor-resize-left-right", [16, 16], "ew-resize"),
    ("32261:178354", "CursorsResizeUpDown", "--cursor-resize-up-down", [16, 16], "ns-resize"),
    ("32261:178355", "CursorsResizeNorthWestSouthEast", "--cursor-resize-nwse", [16, 16], "nwse-resize"),
    ("32261:178356", "CursorsResizeNorthEastSouthWest", "--cursor-resize-nesw", [16, 16], "nesw-resize"),
    ("32261:178357", "CursorsResizeWestEast", "--cursor-resize-ew", [16, 16], "ew-resize"),
    ("32261:178358", "CursorsResizeNorthSouth", "--cursor-resize-ns", [16, 16], "ns-resize"),
]


def cursor_css(name: str, hx: int, hy: int, fallback: str) -> str:
    return f"url('{CURSOR_PATH}/{name}.png') {hx} {hy}, {fallback}"


def main() -> None:
    items = []
    for node_id, name, css_var, hotspot, fallback in CURSORS:
        hx, hy = hotspot
        items.append({
            "nodeId": node_id,
            "name": name,
            "file": f"{name}.png",
            "size": f"{SIZE}x{SIZE}",
            "hotspot": {"x": hx, "y": hy},
            "cssVar": css_var,
            "fallback": fallback,
            "css": cursor_css(name, hx, hy, fallback),
        })

    catalog = {
        "source": {
            "fileKey": "58ZXC7sZYQsbenzf0foWCH",
            "frameId": "32261:178336",
            "frameName": "Cursors",
            "url": "https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design?node-id=32261-178336",
        },
        "description": "TMA custom cursors. Transparent 32x32 PNGs. Link cursors.css once in your layout.",
        "exportPath": "public/images/cursors",
        "cssPath": "public/css/cursors.css",
        "export": {
            "format": "png",
            "size": SIZE,
            "background": "transparent",
            "exportedAt": str(date.today()),
            "count": len(items),
        },
        "items": items,
        "setup": "Include resources/views/partials/cursors.blade.php in your layout <head>.",
        "laravelUsage": "App\\Support\\Cursors::css('pointer')",
    }

    (ROOT / "design/cursors.json").write_text(
        json.dumps(catalog, indent=2) + "\n", encoding="utf-8"
    )

    lines = [
        "/* TMA Cursors — production setup (transparent 32x32 PNG) */",
        ":root {",
    ]
    for item in items:
        lines.append(f"  {item['cssVar']}: {item['css']};")
    lines += [
        "}",
        "",
        "html, body { cursor: var(--cursor-default); }",
        "a, button, [role='button'], .cursor-pointer { cursor: var(--cursor-pointer); }",
        "input:not([type]), input[type='text'], input[type='search'], input[type='email'],",
        "input[type='url'], input[type='password'], textarea, [contenteditable='true'], .cursor-text {",
        "  cursor: var(--cursor-text);",
        "}",
        ".cursor-grab { cursor: var(--cursor-grab); }",
        ".cursor-grabbing { cursor: var(--cursor-grabbing); }",
        ".cursor-move { cursor: var(--cursor-move); }",
        ".cursor-cross { cursor: var(--cursor-cross); }",
        ".cursor-wait { cursor: var(--cursor-beachball); }",
        ".cursor-zoom-in { cursor: var(--cursor-zoom-in); }",
        ".cursor-zoom-out { cursor: var(--cursor-zoom-out); }",
        ".cursor-menu { cursor: var(--cursor-menu); }",
        ".cursor-n-resize { cursor: var(--cursor-resize-up); }",
        ".cursor-s-resize { cursor: var(--cursor-resize-down); }",
        ".cursor-e-resize { cursor: var(--cursor-resize-right); }",
        ".cursor-w-resize { cursor: var(--cursor-resize-left); }",
        ".cursor-ns-resize { cursor: var(--cursor-resize-ns); }",
        ".cursor-ew-resize { cursor: var(--cursor-resize-ew); }",
        ".cursor-nesw-resize { cursor: var(--cursor-resize-nesw); }",
        ".cursor-nwse-resize { cursor: var(--cursor-resize-nwse); }",
    ]

    css_path = ROOT / "public/css/cursors.css"
    css_path.parent.mkdir(parents=True, exist_ok=True)
    css_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    preview = {"items": items}
    (ROOT / "public/demo/cursors-catalog.json").write_text(
        json.dumps(preview, indent=2) + "\n", encoding="utf-8"
    )

    print(f"Wrote design/cursors.json + public/css/cursors.css ({len(items)} cursors)")


if __name__ == "__main__":
    main()
