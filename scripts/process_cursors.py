#!/usr/bin/env python3
"""Remove Figma export backgrounds and normalize cursor PNGs for production."""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CURSOR_DIR = ROOT / "public/images/cursors"
SIZE = 32
BACKGROUND = {(237, 237, 241), (255, 255, 255)}


def remove_background(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    width, height = im.size
    pixels = im.load()
    seen: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque()

    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or x < 0 or y < 0 or x >= width or y >= height:
            continue
        seen.add((x, y))
        red, green, blue, alpha = pixels[x, y]
        if (red, green, blue) in BACKGROUND:
            pixels[x, y] = (red, green, blue, 0)
            queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    return im


def process(path: Path) -> None:
    image = Image.open(path)
    image = remove_background(image)
    if image.size != (SIZE, SIZE):
        image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    image.save(path)


def main() -> None:
    count = 0
    for path in sorted(CURSOR_DIR.glob("*.png")):
        process(path)
        count += 1
        print(f"processed {path.relative_to(ROOT)}")
    print(f"\nDone: {count} cursors -> {SIZE}x{SIZE} transparent PNG")


if __name__ == "__main__":
    main()
