#!/usr/bin/env python3
"""Batch-fetch Figma SVG export URLs for Phosphor icons via REST API."""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

FILE_KEY = "58ZXC7sZYQsbenzf0foWCH"
MANIFEST = Path(__file__).resolve().parent / "figma-phosphor-icons.json"
URLS_FILE = Path(__file__).resolve().parent / "figma-phosphor-icon-urls.json"
BATCH_SIZE = 80


def load_manifest():
    return json.loads(MANIFEST.read_text())


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


def fetch_batch(token: str, node_ids: list[str]) -> dict[str, str]:
    ids_param = ",".join(urllib.parse.quote(nid, safe="") for nid in node_ids)
    url = (
        f"https://api.figma.com/v1/images/{FILE_KEY}"
        f"?ids={ids_param}&format=svg&svg_include_id=true"
    )
    req = urllib.request.Request(url, headers={"X-Figma-Token": token})
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode())
    if payload.get("err"):
        raise RuntimeError(payload["err"])
    return payload.get("images", {})


def main() -> int:
    token = os.environ.get("FIGMA_ACCESS_TOKEN") or os.environ.get("FIGMA_TOKEN")
    if not token:
        print(
            "Set FIGMA_ACCESS_TOKEN to use batch REST export (~16 API calls for all icons).",
            file=sys.stderr,
        )
        return 1

    manifest = load_manifest()
    urls = load_urls()
    pending = [item for item in manifest if item["filename"] not in urls]
    print(f"Pending: {len(pending)} / {len(manifest)}")

    for i in range(0, len(pending), BATCH_SIZE):
        batch = pending[i : i + BATCH_SIZE]
        node_ids = [item["nodeId"] for item in batch]
        print(f"Fetching batch {i // BATCH_SIZE + 1} ({len(batch)} icons)...")
        try:
            images = fetch_batch(token, node_ids)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            print(f"HTTP {exc.code}: {body}", file=sys.stderr)
            return 1
        for item in batch:
            image_url = images.get(item["nodeId"])
            if image_url:
                urls[item["filename"]] = image_url
            else:
                print(f"  missing URL for {item['filename']}", file=sys.stderr)
        save_urls(urls)
        time.sleep(1)

    print(f"Saved {len(urls)} URLs -> {URLS_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
