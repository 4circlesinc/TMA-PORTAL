#!/usr/bin/env python3
"""Rename TMA branding to TMA across the Portal codebase."""

from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SKIP_DIRS = {
    ".git",
    ".cursor",
    "node_modules",
    "tmp",
}

TEXT_EXTENSIONS = {
    ".html",
    ".js",
    ".css",
    ".json",
    ".md",
    ".php",
    ".py",
    ".xml",
    ".blade.php",
    ".mjs",
    ".svg",
}

# Order matters: longer / more specific patterns first.
REPLACEMENTS = [
    ("#", "#"),
    ("#", "#"),
    ("tma-portal", "tma-portal"),
    ("TMALogoMark", "TMALogoMark"),
    ("TMALogoWordmark", "TMALogoWordmark"),
    ("TMALogoSuffix", "TMALogoSuffix"),
    ("renderTMALogo", "renderTMALogo"),
    ("tma-logo.js", "tma-logo.js"),
    ("tma-logo", "tma-logo"),
    ("tma-dash", "tma-dash"),
    ("tma-filter-popover", "tma-filter-popover"),
    ("tma-pagination", "tma-pagination"),
    ("tma-dashboard", "tma-dashboard"),
    ("ds-cover-tma", "ds-cover-tma"),
    ("icons-tma", "icons-tma"),
    ("_tma-", "_tma-"),
    ("download_tma", "download_tma"),
    ("TMA", "TMA"),
    ("tma", "tma"),
]

DISPLAY_FIXES = [
    (r"© 2026 TM ANTOINE Advisory\b", "© 2026 TM ANTOINE Advisory"),
    (r"© 2026 TM ANTOINE Advisory\. All rights reserved\.", "© 2026 TM ANTOINE Advisory. All rights reserved."),
    (r"<title>tma-portal</title>", "<title>tma-portal</title>"),
    (r"<title>Portal — Menu \(TMA\)</title>", "<title>tma-portal — Menu</title>"),
    (r"<title>Portal — ([^(<]+) \(TMA\)</title>", r"<title>tma-portal — \1</title>"),
    (r"# TM ANTOINE Advisory Design System — tma-portal", "# TM ANTOINE Advisory Design System — tma-portal"),
    (r"TM ANTOINE Advisory Design System — tma-portal", "TM ANTOINE Advisory Design System — tma-portal"),
    (r"TM ANTOINE Advisory design system", "TM ANTOINE Advisory design system"),
    (r"in the TM ANTOINE Advisory design system", "in the TM ANTOINE Advisory design system"),
    (r"All pages of tma-portal support", "All pages of tma-portal support"),
    (r"\*TM ANTOINE Advisory Design System — tma-portal", "*TM ANTOINE Advisory Design System — tma-portal"),
    (r"Laravel application based on the \[Portal Design\].*?\(TM ANTOINE Advisory design system\)\.", 
     "tma-portal — TM ANTOINE Advisory application based on the [Portal Design](https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design) Figma file."),
    (r"- \*\*TMA\*\* — \[Documentation\]\(#\)", "- **tma-portal** — TM ANTOINE Advisory"),
    (r"\| TMA docs \|", "| tma-portal |"),
    (r"Browse all demos, components, icons, brand logos, and documentation in the TM ANTOINE Advisory design system\.",
     "Browse all demos, components, icons, brand logos, and documentation in the TM ANTOINE Advisory design system."),
    (r"TM ANTOINE Advisory Brand Logos", "TM ANTOINE Advisory Brand Logos"),
    (r"description: 'TMA custom \+ Phosphor sets'", "description: 'tma custom + Phosphor sets'"),
    (r"aria-label=\"TMA\"", 'aria-label="TM ANTOINE Advisory"'),
    (r'aria-label="TM ANTOINE Advisory"', 'aria-label="TM ANTOINE Advisory"'),
    (r"Application home — tma-portal ", "Application home — tma-portal "),
    (r"SnowLogo40\.svg", "TMALogoMark40.svg"),
]

FILE_RENAMES = [
    ("public/js/tma-logo.js", "public/js/tma-logo.js"),
    ("design/icons-tma.json", "design/icons-tma.json"),
    ("design/_tma-manifest.json", "design/_tma-manifest.json"),
    ("design/_tma-icons-metadata.xml", "design/_tma-icons-metadata.xml"),
    ("scripts/download_tma_icons.py", "scripts/download_tma_icons.py"),
    ("public/images/design-system/30484-266531-tma-design-system.svg",
     "public/images/design-system/30484-266531-tma-design-system.svg"),
]

DIR_RENAMES = [
    ("public/images/icons/tma", "public/images/icons/tma"),
]


def should_skip(path: Path) -> bool:
    parts = set(path.parts)
    return bool(parts & SKIP_DIRS)


def rename_paths() -> None:
    for old, new in DIR_RENAMES:
        src = ROOT / old
        dst = ROOT / new
        if src.exists() and not dst.exists():
            src.rename(dst)
            print(f"dir  {old} -> {new}")

    for old, new in FILE_RENAMES:
        src = ROOT / old
        dst = ROOT / new
        if src.exists() and not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dst)
            print(f"file {old} -> {new}")


def transform(content: str) -> str:
    for old, new in REPLACEMENTS:
        content = content.replace(old, new)
    for pattern, repl in DISPLAY_FIXES:
        content = re.sub(pattern, repl, content)
    return content


def process_files() -> int:
    changed = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        base = Path(dirpath)
        if should_skip(base):
            continue
        for name in filenames:
            path = base / name
            suffix = path.suffix
            if suffix not in TEXT_EXTENSIONS and name not in {"README", "DESIGN_SYSTEM.md"}:
                continue
            try:
                original = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            updated = transform(original)
            if updated != original:
                path.write_text(updated, encoding="utf-8")
                changed += 1
                print(f"edit {path.relative_to(ROOT)}")
    return changed


def main() -> None:
    rename_paths()
    count = process_files()
    print(f"\nDone. Updated {count} files.")


if __name__ == "__main__":
    main()
