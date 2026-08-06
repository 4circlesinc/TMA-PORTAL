#!/usr/bin/env python3
"""Inline the SVGs behind CSS mask-image rules as data: URIs.

Masked icons (the sidebar nav, and the handful of other masked glyphs) used to
name their artwork with `mask-image: url('../images/icons/...svg')`. The browser
can't discover those until it has parsed the stylesheet *and* laid the element
out, so each icon arrived as its own request -- on a slow or single-worker
server they queued and popped into the sidebar one at a time.

Inlining the art means zero extra requests: every icon is painted the moment
dashboard.css applies.

The original filename is kept in a trailing comment on each rewritten
declaration, so the art is still traceable and this script can be re-run after
`sync_phosphor_icons.py` refreshes the SVGs on disk.

Usage:
    python3 scripts/inline_icon_masks.py            # rewrite public/css/*.css
    python3 scripts/inline_icon_masks.py --check    # report, change nothing
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS_DIR = ROOT / "public" / "css"

# `mask-image: url('../images/....svg');` with an optional -webkit- prefix and
# an optional trailing `/* Name.svg */` comment left by an earlier run.
FILE_RULE = re.compile(
    r"""(?P<indent>[ \t]*)
        (?P<prop>(?:-webkit-)?mask-image)
        :\s*
        url\((?P<q>['"]?)(?P<path>[^'")]+\.svg)(?P=q)\)
        \s*;
        (?P<trail>[ \t]*/\*[^*]*\*/)?""",
    re.VERBOSE,
)

# An already-inlined declaration, so a re-run can refresh it from disk.
DATA_RULE = re.compile(
    r"""(?P<indent>[ \t]*)
        (?P<prop>(?:-webkit-)?mask-image)
        :\s*
        url\("data:image/svg\+xml,[^"]*"\)
        \s*;
        [ \t]*/\*\s*(?P<path>[^*\s]+)\s*\*/""",
    re.VERBOSE,
)

# Characters that must not appear raw inside a double-quoted CSS url().
UNSAFE = {
    "%": "%25",
    "#": "%23",
    "<": "%3C",
    ">": "%3E",
    '"': "%22",
    "{": "%7B",
    "}": "%7D",
    "|": "%7C",
    "\\": "%5C",
    "^": "%5E",
    "`": "%60",
    "[": "%5B",
    "]": "%5D",
    "?": "%3F",
    " ": "%20",
}


def encode_svg(svg: str) -> str:
    """Percent-encode an SVG for a double-quoted `url("data:image/svg+xml,...")`.

    URL-encoding rather than base64: it stays human-readable, is ~25% smaller
    than base64 for this artwork, and gzips better.
    """
    svg = re.sub(r"<\?xml.*?\?>", "", svg, flags=re.DOTALL)
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.DOTALL)
    svg = re.sub(r"\s+", " ", svg).strip()
    svg = svg.replace('"', "'")  # single-quoted attrs need no escaping
    return "".join(UNSAFE.get(ch, ch) for ch in svg)


def resolve(css_file: Path, ref: str) -> Path | None:
    """Resolve a url() reference relative to the stylesheet, as a browser does."""
    if ref.startswith(("http:", "https:", "data:", "//")):
        return None
    if ref.startswith("/"):
        return ROOT / "public" / ref.lstrip("/")
    return (css_file.parent / ref).resolve()


def rewrite(css_file: Path) -> tuple[str, int, int]:
    text = css_file.read_text()
    inlined = 0
    missing = 0

    def build(indent: str, prop: str, ref: str) -> str | None:
        nonlocal inlined, missing
        svg_path = resolve(css_file, ref)
        if svg_path is None:
            return None
        if not svg_path.is_file():
            print(f"  ! {css_file.name}: missing {ref}", file=sys.stderr)
            missing += 1
            return None
        data = encode_svg(svg_path.read_text())
        inlined += 1
        return f'{indent}{prop}: url("data:image/svg+xml,{data}"); /* {ref} */'

    def from_file(m: re.Match) -> str:
        return build(m["indent"], m["prop"], m["path"]) or m.group(0)

    def from_data(m: re.Match) -> str:
        return build(m["indent"], m["prop"], m["path"]) or m.group(0)

    text = DATA_RULE.sub(from_data, text)
    text = FILE_RULE.sub(from_file, text)
    return text, inlined, missing


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report without writing")
    ap.add_argument("files", nargs="*", help="stylesheets (default: public/css/*.css)")
    args = ap.parse_args()

    targets = [Path(f) for f in args.files] or sorted(CSS_DIR.glob("*.css"))
    total = 0
    problems = 0

    for css_file in targets:
        new_text, inlined, missing = rewrite(css_file)
        problems += missing
        if not inlined:
            continue
        total += inlined
        changed = new_text != css_file.read_text()
        state = "would inline" if args.check else ("inlined" if changed else "unchanged")
        print(f"{css_file.relative_to(ROOT)}: {state} {inlined} mask icon(s)")
        if changed and not args.check:
            css_file.write_text(new_text)

    print(f"\n{total} masked icon declaration(s) processed.")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
