#!/usr/bin/env python3
"""Build the Service Provider Portal Briefing from the series Word template."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
UG = ROOT.parent / "user-guide"
sys.path.insert(0, str(UG))

import build_guide as g  # noqa: E402
from briefing_body import write_briefing  # noqa: E402

ASSETS = ROOT / "assets"
OUT = REPO / "docs" / "TM-ANTOINE-Service-Provider-Portal-Briefing.docx"

SHOTS_TO_COPY = [
    "02-login-options.png",
    "03-login-code.png",
    "28-two-step.png",
    "11-messages.png",
]


def prepare_assets():
    ASSETS.mkdir(parents=True, exist_ok=True)
    src = UG / "screenshots"
    for name in SHOTS_TO_COPY:
        shutil.copy2(src / name, ASSETS / name)


def build():
    prepare_assets()
    if not g.TEMPLATE.exists():
        raise SystemExit(f"Template not found: {g.TEMPLATE}")

    g.SHOTS = ASSETS
    doc = g.Document(str(g.TEMPLATE))
    thankyou = g.strip_template_body(doc)

    g.add_title(doc, "Document Control")
    g.add_body(
        doc,
        "This briefing explains how the TM ANTOINE Advisory Portal is built, who may use it, and how we protect service-provider firms and their clients. It is written for partners, compliance officers, and the people who will work the files — not for software developers.",
    )
    g.add_table(
        doc,
        ["Item", "Detail"],
        [
            ["Document title", "Service Provider Portal Briefing"],
            [
                "Subtitle",
                "Security, access, and answers for firms using the TM ANTOINE Advisory Portal",
            ],
            ["Organization", "TM ANTOINE Partners & Advisory"],
            ["Product name", "TM ANTOINE Advisory Portal"],
            ["Production host", "https://portal.tmantoinelaw.com"],
            ["Support", "support@tmantoinelaw.com"],
            ["Version", "1.0"],
            ["Date", "22 September 2026"],
            ["Prepared by", "TM ANTOINE Partners & Advisors"],
            ["Prepared for", "Service-provider firms"],
            ["Classification", "Confidential — intended recipients only"],
            ["Companion slides", "TM-ANTOINE-Service-Provider-Webinar.pptx"],
        ],
    )

    g.add_title(doc, "How to read this briefing")
    g.add_body(
        doc,
        "Use it as the webinar handout and as the written answers for your compliance file. Tables are the short form of a question we have already been asked. Figures are there to present, not to decorate.",
    )
    g.add_table(
        doc,
        ["Label", "Meaning"],
        [
            ["NOTE", "A rule that is easy to miss."],
            ["SECURITY", "A control you should be able to repeat to a client."],
            ["HONESTY", "Something we do not over-claim."],
            ["TIP", "What to do on Monday morning."],
        ],
    )

    g.add_title(doc, "Contents")
    g.add_bullets(
        doc,
        [
            "Why this briefing exists",
            "Authenticity and the two domains",
            "Who can enter the portal",
            "How sign-in works, and the authenticator requirement",
            "Where the portal may be used",
            "How we protect the connection and the files",
            "What may be uploaded",
            "Where things live, and how they come back",
            "Bespoke AI",
            "If something goes wrong",
            "Questions we have already been asked",
            "What we ask of you after the webinar",
        ],
        numbered=True,
    )

    write_briefing(
        doc,
        SimpleNamespace(
            add_title=g.add_title,
            add_h2=g.add_h2,
            add_body=g.add_body,
            add_bullets=g.add_bullets,
            add_table=g.add_table,
            add_callout=g.add_callout,
            add_image=g.add_image,
        ),
    )

    g.append_thankyou(doc, thankyou)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(OUT))
    g.force_fonts_in_package(OUT)
    print("wrote", OUT, "size", OUT.stat().st_size)


if __name__ == "__main__":
    build()
