#!/usr/bin/env python3
"""Parse Figma get_metadata XML output into icon manifest JSON."""

import json
import re
import sys
from pathlib import Path

INSTANCE_RE = re.compile(
    r'<instance id="([^"]+)" name="([^"]+)"[^/]*/>'
)


def parse_instances(xml: str) -> list[dict]:
    items = []
    seen_names: dict[str, int] = {}
    for node_id, name in INSTANCE_RE.findall(xml):
        if name in {"Navigation", "phosphor-logo"}:
            continue
        count = seen_names.get(name, 0)
        seen_names[name] = count + 1
        slug = name if count == 0 else f"{name}_{count + 1}"
        items.append({"nodeId": node_id.replace("-", ":"), "name": name, "slug": slug})
    return items


def main() -> None:
    if len(sys.argv) < 4:
        print("Usage: parse_figma_icons.py <xml-file> <set-name> <output-json>")
        sys.exit(1)

    xml_path, set_name, out_path = sys.argv[1:4]
    xml = Path(xml_path).read_text(encoding="utf-8")
    items = parse_instances(xml)

    payload = {
        "set": set_name,
        "count": len(items),
        "items": items,
    }
    Path(out_path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(items)} icons to {out_path}")


if __name__ == "__main__":
    main()
