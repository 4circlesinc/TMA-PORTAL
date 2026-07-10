#!/usr/bin/env python3
"""Remove Figma export backgrounds and normalize SVG canvas sizes."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ILLUSTRATION_SIZES = {
    **{f"Illustration{i:02d}": (100, 100) for i in range(1, 13)},
    **{f"Illustration{i:02d}": (100, 75) for i in range(13, 29)},
    **{f"LineDrawing{i:02d}": (100, 100) for i in range(1, 4)},
}


def target_size(path: Path) -> tuple[int, int]:
    if path.parent.name in {"emoji", "tma"}:
        return 32, 32
    stem = path.stem
    return ILLUSTRATION_SIZES.get(stem, (100, 100))


def clean_chart_svg(content: str) -> str:
    content = re.sub(r'\n<rect width="[^"]*" height="[^"]*" fill="#EDEDF1"/>', '', content, count=1)
    content = re.sub(
        r'\n<g id="Chart graphics">\s*\n<path d="M-[^"]*" fill="white"/>',
        '',
        content,
        count=1,
    )

    if '<defs>' in content:
        content = re.sub(r'\n</g>\s*\n<defs>', '\n<defs>', content, count=1)
    else:
        content = re.sub(r'\n</g>\s*\n</svg>', '\n</svg>', content, count=1)

    return content


def clean_svg(content: str, width: int, height: int) -> str:
    content = re.sub(
        r'(<svg)\s+width="[^"]*"\s+height="[^"]*"\s+viewBox="[^"]*"',
        rf'\1 width="{width}" height="{height}" viewBox="0 0 {width} {height}"',
        content,
        count=1,
    )

    content = re.sub(r'\n<rect width="[^"]*" height="[^"]*" fill="#EDEDF1"/>', '', content, count=1)

    content = re.sub(
        r'\n<g id="(?:Emoji|Illustrations|TMA Icons)">\s*\n<path d="M-[^"]*" fill="white"/>',
        '',
        content,
        count=1,
    )

    if '<defs>' in content:
        content = re.sub(r'\n</g>\s*\n<defs>', '\n<defs>', content, count=1)
    else:
        content = re.sub(r'\n</g>\s*\n</svg>', '\n</svg>', content, count=1)

    return content


def main() -> None:
    dirs = [
        ROOT / "public/images/emoji",
        ROOT / "public/images/illustrations",
        ROOT / "public/images/icons/tma",
    ]
    chart_dir = ROOT / "public/images/charts"
    count = 0

    for directory in dirs:
        for svg_path in sorted(directory.glob("*.svg")):
            width, height = target_size(svg_path)
            original = svg_path.read_text(encoding="utf-8")
            cleaned = clean_svg(original, width, height)
            svg_path.write_text(cleaned, encoding="utf-8")
            count += 1
            print(f"cleaned {svg_path.relative_to(ROOT)} -> {width}x{height}")

    if chart_dir.exists():
        for svg_path in sorted(chart_dir.glob("*.svg")):
            original = svg_path.read_text(encoding="utf-8")
            cleaned = clean_chart_svg(original)
            svg_path.write_text(cleaned, encoding="utf-8")
            count += 1
            print(f"cleaned {svg_path.relative_to(ROOT)}")

    print(f"\nDone: {count} SVGs processed")


if __name__ == "__main__":
    main()
