#!/usr/bin/env python3
"""Copy Phosphor regular SVGs from @phosphor-icons/core, named to match Figma."""

import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "design/_phosphor-manifest.json"
OUT_DIR = ROOT / "public/images/icons/phosphor"
PACKAGE = "@phosphor-icons/core"

# Figma component names that differ from Phosphor file slugs.
ALIASES = {
    "Xcircle": "x-circle",
    "FolderNotchPlus": "folder-plus",
    "FolderNotchOpen": "folder-open",
    "FolderNotchMinus": "folder-minus",
    "FolderNotch": "folder",
    "FileSearch": "file-magnifying-glass",
    "ArchiveTray": "tray",
    "ArchiveBox": "archive",
}


def pascal_to_kebab(name: str) -> str:
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1-\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", s1).lower()


def fetch_package_dir() -> Path:
    tmp = Path(tempfile.mkdtemp())
    subprocess.run(["npm", "pack", PACKAGE], cwd=tmp, check=True, capture_output=True)
    archive = next(tmp.glob("phosphor-icons-core-*.tgz"))
    extract_to = tmp / "pkg"
    with tarfile.open(archive) as tar:
        tar.extractall(extract_to)
    return extract_to / "package/assets/regular"


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assets = fetch_package_dir()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    copied = 0
    missing = []

    for item in manifest["items"]:
        name = item["name"]
        slug = item["slug"]
        kebab = ALIASES.get(name, pascal_to_kebab(name))
        src = assets / f"{kebab}.svg"
        dest = OUT_DIR / f"{slug}.svg"

        if not src.exists():
            missing.append({"name": name, "kebab": kebab})
            continue

        shutil.copy2(src, dest)
        copied += 1

    print(f"Copied {copied} Phosphor icons to {OUT_DIR.relative_to(ROOT)}")
    if missing:
        print(f"Missing {len(missing)} icons:")
        for m in missing[:20]:
            print(f"  {m['name']} -> {m['kebab']}.svg")
        if len(missing) > 20:
            print(f"  ... and {len(missing) - 20} more")

    if missing:
        sys.exit(1)


if __name__ == "__main__":
    main()
