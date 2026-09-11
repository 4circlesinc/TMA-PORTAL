"""Export the user-guide body to resources/bespoke/user-guide.json.

Bespoke AI's guide lookup reads that file, so the assistant quotes the same
copy the printed guide carries. Re-run after editing guide_body.py:

    python3 docs/user-guide/export_guide_json.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import guide_body  # noqa: E402

OUT = HERE.parent.parent / "resources" / "bespoke" / "user-guide.json"


class Collector:
    def __init__(self) -> None:
        self.sections: list[dict] = []
        self.current: dict | None = None

    def _para(self, text: str) -> None:
        if self.current is None:
            return
        text = re.sub(r"\s+", " ", str(text)).strip()
        if text:
            self.current["paragraphs"].append(text)

    def add_title(self, doc, text: str) -> None:
        title = re.sub(r"^\d+(?:\.\d+)*\.\s*", "", str(text)).strip()
        self.current = {"title": title, "paragraphs": []}
        self.sections.append(self.current)

    def add_h2(self, doc, text: str) -> None:
        self._para("## " + str(text))

    def add_body(self, doc, text: str) -> None:
        self._para(text)

    def add_bullets(self, doc, items, numbered=False) -> None:
        for i, item in enumerate(items, 1):
            self._para((f"{i}. " if numbered else "- ") + str(item))

    def add_table(self, doc, headers, rows, col_twips=None) -> None:
        for row in rows:
            cells = [str(c) for c in row]
            if headers and len(headers) == len(cells):
                self._para("; ".join(f"{h}: {c}" for h, c in zip(headers, cells)))
            else:
                self._para("; ".join(cells))

    def add_callout(self, doc, kind, text=None) -> None:
        self._para(text if text is not None else kind)

    def add_image(self, doc, name, caption="", width=None) -> None:
        return None


class Doc:
    def add_page_break(self) -> None:
        return None


def main() -> None:
    c = Collector()
    h = SimpleNamespace(
        add_title=c.add_title,
        add_h2=c.add_h2,
        add_body=c.add_body,
        add_bullets=c.add_bullets,
        add_table=c.add_table,
        add_callout=c.add_callout,
        add_image=c.add_image,
    )
    guide_body.write_guide(Doc(), h)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"sections": c.sections}, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(c.sections)} sections → {OUT.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()
