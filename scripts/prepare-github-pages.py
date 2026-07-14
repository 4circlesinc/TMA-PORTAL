#!/usr/bin/env python3
"""Copy public/ to dist-pages/ with absolute paths for GitHub Pages project sites."""
from __future__ import annotations

import pathlib
import re
import shutil
import sys

BASE_BLOCK_RE = re.compile(
    r'<base href="/" id="tma-site-base">\s*'
    r'<script>\(function\(\)\{if\(!location\.hostname\.endsWith\("github\.io"\)\)return;'
    r'var s=location\.pathname\.split\("/"\)\.filter\(Boolean\)\[0\];if\(!s\)return;'
    r'window\.__TMA_SITE_ROOT="/"\+s;var b=document\.getElementById\("tma-site-base"\);'
    r'if\(b\)b\.href="/"\+s\+"/";\}\)\(\);</script>',
    re.DOTALL,
)

LEGACY_BASE_SCRIPT_RE = re.compile(
    r'<script>!function\(\)\{var r="/";if\(location\.hostname\.slice\(-10\)==="github\.io"\)\{'
    r'var s=location\.pathname\.split\("/"\)\.filter\(Boolean\)\[0\];s&&\(r="/"\+s\+"/"\)\}'
    r'window\.__TMA_SITE_ROOT=r\.replace\(/\\\/\$/,""\);document\.write\(\'<base href="\'\+r\+\'">\'\)\}\(\);</script>',
)


def prefix_once(text: str, needle: str, replacement: str) -> str:
    if needle in text and replacement not in text:
        return text.replace(needle, replacement)
    return text


def prepare(repo_name: str) -> None:
    root = f"/{repo_name}"
    src = pathlib.Path("public")
    dst = pathlib.Path("dist-pages")

    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)

    # Portal pages live outside the web root (auth-gated in the Laravel app)
    # but remain part of the public static design demo on GitHub Pages.
    portal = pathlib.Path("resources/portal-pages")
    if portal.exists():
        for child in portal.iterdir():
            if child.is_dir():
                shutil.copytree(child, dst / child.name)

    head_inject = (
        f'<base href="{root}/">\n'
        f'  <script>window.__TMA_SITE_ROOT="{root}";</script>'
    )

    root_name = repo_name
    root_link = re.compile(rf'(href|src)="/(?!{re.escape(root_name)})')

    for path in dst.rglob("*.html"):
        text = path.read_text(encoding="utf-8")
        text = BASE_BLOCK_RE.sub(head_inject, text, count=1)
        text = LEGACY_BASE_SCRIPT_RE.sub(head_inject, text, count=1)

        for token in ("css/", "js/", "images/"):
            text = prefix_once(text, f'href="{token}', f'href="{root}/{token}')
            text = prefix_once(text, f'src="{token}', f'src="{root}/{token}')

        text = root_link.sub(rf'\1="{root}/', text)
        path.write_text(text, encoding="utf-8")

    for path in dst.rglob("*.js"):
        text = path.read_text(encoding="utf-8")
        if f'"{root}/images/' in text or f"'{root}/images/" in text:
            continue
        text = text.replace("'images/", f"'{root}/images/")
        text = text.replace('"images/', f'"{root}/images/')
        path.write_text(text, encoding="utf-8")

    print(f"Prepared {dst} for GitHub Pages at {root}/")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: prepare-github-pages.py <repo-name>")
    prepare(sys.argv[1])
