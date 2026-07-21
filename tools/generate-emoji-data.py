"""
Generate public/js/emoji-data.js from Python's Unicode database.

Names come from unicodedata rather than being typed by hand, so the search
keywords are the real Unicode names and cannot drift or contain typos.
Only assigned, single-codepoint emoji are emitted; ZWJ sequences and
regional-indicator flag pairs are skipped because they need font support the
picker cannot verify.
"""

import unicodedata

# Curated ranges per category. Deliberately conservative: every range here is
# emoji-presentation by default, so nothing renders as a text-style glyph.
CATEGORIES = [
    ("Smileys", "smileys", [
        (0x1F600, 0x1F64F),
        (0x1F910, 0x1F92F),
        (0x1F970, 0x1F97A),
        (0x1F9D0, 0x1F9D0),
        (0x1FAE0, 0x1FAE8),
    ]),
    ("People", "people", [
        (0x1F464, 0x1F487),
        (0x1F44A, 0x1F450),
        (0x1F590, 0x1F596),
        (0x1F918, 0x1F91F),
        (0x1F930, 0x1F93A),
        (0x1FAF0, 0x1FAF8),
    ]),
    ("Animals", "animals", [
        (0x1F400, 0x1F43F),
        (0x1F980, 0x1F9AE),
        (0x1F330, 0x1F33F),
    ]),
    ("Food", "food", [
        (0x1F345, 0x1F37F),
        (0x1F950, 0x1F96F),
        (0x1F32D, 0x1F32F),
    ]),
    ("Activity", "activity", [
        (0x1F380, 0x1F3A0),
        (0x1F3A2, 0x1F3CA),
        (0x26BD, 0x26BE),
        (0x1F947, 0x1F94F),
    ]),
    ("Travel", "travel", [
        (0x1F680, 0x1F6A4),
        (0x1F30D, 0x1F320),
        (0x1F3D4, 0x1F3E0),
    ]),
    ("Objects", "objects", [
        (0x1F4A1, 0x1F4FF),
        (0x1F526, 0x1F52C),
        (0x1F9F0, 0x1F9FF),
    ]),
    ("Symbols", "symbols", [
        (0x2764, 0x2764),
        (0x1F493, 0x1F49F),
        (0x2705, 0x2705),
        (0x274C, 0x274C),
        (0x2B50, 0x2B50),
        (0x1F525, 0x1F525),
        (0x1F4AF, 0x1F4AF),
        (0x2757, 0x2757),
        (0x2753, 0x2753),
        (0x1F51D, 0x1F51E),
    ]),
]

# The reaction pill's fixed row: approve, love, laugh, celebrate, sad, angry.
# Six is the cap — anything else lives behind the pill's "+" button.
QUICK = ["👍", "❤️", "😂", "🎉", "😢", "😠"]


def keywords(name: str) -> str:
    """Searchable words from the Unicode name, minus noise."""
    drop = {"face", "with", "and", "of", "the", "sign", "symbol", "a"}
    words = [w.lower() for w in name.replace("-", " ").split()]
    kept = [w for w in words if w not in drop]
    return " ".join(dict.fromkeys(kept))


def build():
    out = []
    seen = set()

    for label, key, ranges in CATEGORIES:
        items = []
        for start, end in ranges:
            for cp in range(start, end + 1):
                ch = chr(cp)
                if ch in seen:
                    continue
                try:
                    name = unicodedata.name(ch)
                except ValueError:
                    continue  # unassigned in this Python's Unicode version
                seen.add(ch)
                items.append({
                    "c": ch,
                    "n": name.title(),
                    "k": keywords(name),
                })
        if items:
            out.append({"label": label, "key": key, "items": items})

    return out


def render(groups):
    lines = [
        "/*",
        " * TMA - Emoji data for the Messages picker.",
        " *",
        " * Generated from the Unicode character database, not hand-written: the",
        " * names double as search keywords, so they cannot drift or carry typos.",
        " * Native Unicode characters rather than image assets — the previous picker",
        " * used 21 SVGs, 18 of which were malformed XML and rendered as broken",
        " * images, and images could never cover categories or search anyway.",
        " *",
        " * Global: window.TMAEmojiData",
        " */",
        "(function () {",
        "  'use strict';",
        "",
        "  window.TMAEmojiData = {",
        "    /* Pinned quick reactions, in the order they are offered. */",
        "    quick: " + repr(QUICK).replace("'", '"') + ",",
        "",
        "    groups: [",
    ]

    for g in groups:
        lines.append("      {")
        lines.append(f'        label: "{g["label"]}",')
        lines.append(f'        key: "{g["key"]}",')
        lines.append("        items: [")
        for it in g["items"]:
            n = it["n"].replace('"', "")
            k = it["k"].replace('"', "")
            lines.append(f'          {{ c: "{it["c"]}", n: "{n}", k: "{k}" }},')
        lines.append("        ],")
        lines.append("      },")

    lines += [
        "    ],",
        "  };",
        "})();",
        "",
    ]
    return "\n".join(lines)


groups = build()
total = sum(len(g["items"]) for g in groups)

with open("public/js/emoji-data.js", "w", encoding="utf-8") as fh:
    fh.write(render(groups))

print(f"wrote {total} emoji across {len(groups)} categories")
for g in groups:
    print(f"  {g['label']:<10} {len(g['items'])}")
