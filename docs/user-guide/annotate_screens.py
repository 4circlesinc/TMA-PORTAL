#!/usr/bin/env python3
"""Add numbered callout markers to selected portal screenshots."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent / "screenshots"
NAVY = (14, 40, 65, 255)
WHITE = (255, 255, 255, 255)


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/Users/vernonfrancis/Downloads/Arial Unicode MS/arial unicode ms bold.otf",
        "/Users/vernonfrancis/Downloads/Arial Unicode MS/arial unicode ms.otf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def marker(draw: ImageDraw.ImageDraw, xy: tuple[int, int], n: str, r: int = 18) -> None:
    x, y = xy
    draw.ellipse((x - r, y - r, x + r, y + r), fill=NAVY)
    f = font(18)
    bbox = draw.textbbox((0, 0), n, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((x - tw / 2, y - th / 2 - 1), n, font=f, fill=WHITE)


def annotate(src_name: str, dest_name: str, marks: list[tuple[int, int, str]]) -> None:
    im = Image.open(ROOT / src_name).convert("RGBA")
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for x, y, n in marks:
        marker(draw, (x, y), n)
    out = Image.alpha_composite(im, overlay).convert("RGB")
    dest = ROOT / dest_name
    out.save(dest, "PNG", optimize=True)
    print("wrote", dest, out.size)


def main() -> None:
    # Login options: firm mark, then the three sign-in buttons.
    annotate(
        "02-login-options.png",
        "02-login-options-annotated.png",
        [(250, 505, "1"), (250, 710, "2"), (250, 840, "3"), (250, 970, "4")],
    )
    # Dashboard: sidebar, greeting, KPI cards, recent files.
    annotate(
        "04-dashboard.png",
        "04-dashboard-annotated.png",
        [(48, 250, "1"), (530, 168, "2"), (560, 305, "3"), (520, 560, "4")],
    )
    # CIP list: tabs, filters, application table.
    annotate(
        "05-cip-applications.png",
        "05-cip-applications-annotated.png",
        [(500, 175, "1"), (500, 365, "2"), (500, 560, "3")],
    )


if __name__ == "__main__":
    main()
