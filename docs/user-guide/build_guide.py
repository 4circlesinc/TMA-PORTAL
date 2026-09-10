#!/usr/bin/env python3
"""Build the TM ANTOINE Advisory Portal User Guide from the series template."""

from __future__ import annotations

import shutil
import zipfile
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor, Twips
from lxml import etree

from guide_body import write_guide

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
TEMPLATE = Path("/Users/vernonfrancis/Downloads/Document template.docx")
SHOTS = ROOT / "screenshots"
OUT = REPO / "docs" / "TM-ANTOINE-Advisory-Portal-User-Guide.docx"

FONT = "Arial Unicode MS"
NAVY = "0E2841"
INK = "000000"
GREY = "F2F2F2"
NSMAP = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def q(tag: str) -> str:
    return qn(f"w:{tag}")


def set_run_font(run, size=10, bold=False, italic=False, color=INK):
    run.font.name = FONT
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    run.font.color.rgb = RGBColor.from_string(color)
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(q("rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    for attr in ("ascii", "hAnsi", "cs", "eastAsia"):
        rFonts.set(q(attr), FONT)


def p_fmt(paragraph, before=0, after=8, line=240, keep_next=False):
    pf = paragraph.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = 1.0
    pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    if keep_next:
        pf.keep_with_next = True


def add_title(doc, text: str):
    p = doc.add_paragraph(style="Default")
    p_fmt(p, before=6, after=8, keep_next=True)
    run = p.add_run(text)
    set_run_font(run, 25, bold=False, color=INK)
    return p


def add_h2(doc, text: str):
    p = doc.add_paragraph(style="Default")
    p_fmt(p, before=12, after=6, keep_next=True)
    run = p.add_run(text)
    set_run_font(run, 10, bold=True, color=INK)
    return p


def add_body(doc, text: str):
    p = doc.add_paragraph(style="Default")
    p_fmt(p, before=0, after=8)
    run = p.add_run(text)
    set_run_font(run, 10)
    return p


def add_bullets(doc, items: list[str], numbered=False):
    for i, item in enumerate(items, 1):
        p = doc.add_paragraph(style="List Paragraph")
        p_fmt(p, before=0, after=4)
        p.paragraph_format.left_indent = Inches(0.25)
        label = f"{i}. " if numbered else "•  "
        run = p.add_run(label + item)
        set_run_font(run, 10)
    return None


def add_caption(doc, text: str):
    p = doc.add_paragraph(style="Caption")
    p_fmt(p, before=4, after=10)
    run = p.add_run(text)
    set_run_font(run, 9, italic=True, color=NAVY)
    return p


def add_image(doc, name: str, caption: str, width=6.45):
    path = SHOTS / name
    if not path.exists():
        add_body(doc, f"[Information Required] Screenshot not available: {name}")
        return
    p = doc.add_paragraph(style="Default")
    p_fmt(p, before=6, after=2)
    run = p.add_run()
    run.add_picture(str(path), width=Inches(width))
    add_caption(doc, caption)


def set_cell_shd(cell, fill: str | None):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for old in tcPr.findall(q("shd")):
        tcPr.remove(old)
    if not fill:
        return
    shd = OxmlElement("w:shd")
    shd.set(q("val"), "clear")
    shd.set(q("color"), "auto")
    shd.set(q("fill"), fill)
    tcPr.append(shd)


def set_cell_borders(cell, bottom=False, top=False):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for old in tcPr.findall(q("tcBorders")):
        tcPr.remove(old)
    borders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        if (edge == "bottom" and bottom) or (edge == "top" and top):
            el.set(q("val"), "single")
            el.set(q("sz"), "4")
            el.set(q("space"), "0")
            el.set(q("color"), "auto")
        else:
            el.set(q("val"), "nil")
        borders.append(el)
    tcPr.append(borders)
    vAlign = OxmlElement("w:vAlign")
    vAlign.set(q("val"), "center")
    tcPr.append(vAlign)


def write_cell(cell, text: str, bold=False, header=False):
    cell.text = ""
    p = cell.paragraphs[0]
    p_fmt(p, before=2, after=2, line=240)
    run = p.add_run(text)
    set_run_font(run, 10, bold=bold or header)


def add_table(doc, headers: list[str], rows: list[list[str]], col_twips: list[int] | None = None):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Style1"
    tbl = table._tbl
    tblPr = tbl.find(q("tblPr"))
    if tblPr is None:
        tblPr = OxmlElement("w:tblPr")
        tbl.insert(0, tblPr)
    for old in tblPr.findall(q("tblW")):
        tblPr.remove(old)
    tblW = OxmlElement("w:tblW")
    tblW.set(q("w"), "10440")
    tblW.set(q("type"), "dxa")
    tblPr.append(tblW)
    look = tblPr.find(q("tblLook"))
    if look is None:
        look = OxmlElement("w:tblLook")
        tblPr.append(look)
    look.set(q("val"), "04A0")
    look.set(q("firstRow"), "1")
    look.set(q("lastRow"), "0")
    look.set(q("firstColumn"), "1")
    look.set(q("lastColumn"), "0")
    look.set(q("noHBand"), "0")
    look.set(q("noVBand"), "1")

    widths = col_twips or (
        [2700, 7740] if len(headers) == 2 else [10440 // len(headers)] * len(headers)
    )
    grid = tbl.find(q("tblGrid"))
    if grid is not None:
        tbl.remove(grid)
    grid = OxmlElement("w:tblGrid")
    for w in widths:
        gc = OxmlElement("w:gridCol")
        gc.set(q("w"), str(w))
        grid.append(gc)
    tbl.insert(1, grid)

    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        write_cell(cell, h, header=True)
        set_cell_shd(cell, GREY)
        set_cell_borders(cell, bottom=True)
        cell.width = Twips(widths[i])

    for r_i, row in enumerate(rows):
        fill = GREY if r_i % 2 == 1 else None
        for c_i, val in enumerate(row):
            cell = table.rows[r_i + 1].cells[c_i]
            write_cell(cell, val, bold=(c_i == 0))
            set_cell_shd(cell, fill)
            set_cell_borders(
                cell,
                top=(r_i == 0),
                bottom=(r_i == len(rows) - 1),
            )
            cell.width = Twips(widths[c_i])

    spacer = doc.add_paragraph(style="Default")
    p_fmt(spacer, before=0, after=8)
    return table


def add_callout(doc, kind: str, text: str):
    table = doc.add_table(rows=1, cols=2)
    table.style = "Style1"
    tbl = table._tbl
    tblPr = tbl.find(q("tblPr"))
    if tblPr is None:
        tblPr = OxmlElement("w:tblPr")
        tbl.insert(0, tblPr)
    tblW = OxmlElement("w:tblW")
    tblW.set(q("w"), "10440")
    tblW.set(q("type"), "dxa")
    tblPr.append(tblW)
    left, right = table.rows[0].cells
    write_cell(left, kind, bold=True)
    write_cell(right, text)
    set_cell_shd(left, GREY)
    set_cell_shd(right, GREY)
    set_cell_borders(left, bottom=True, top=True)
    set_cell_borders(right, bottom=True, top=True)
    left.width = Twips(1800)
    right.width = Twips(8640)
    spacer = doc.add_paragraph(style="Default")
    p_fmt(spacer, before=0, after=10)


def strip_template_body(doc: Document):
    body = doc.element.body
    children = list(body)
    cover = children[0]
    thankyou = None
    for child in children:
        xml = etree.tostring(child, encoding="unicode")
        if "Thank You.jpg" in xml or 'descr="Thank You.jpg"' in xml:
            thankyou = deepcopy(child)
            break
    sect = body.find(q("sectPr"))
    for child in list(body):
        if child is not cover and child is not sect:
            body.remove(child)
    return thankyou


def append_thankyou(doc: Document, thankyou):
    if thankyou is None:
        return
    p = doc.add_paragraph(style="Default")
    run = p.add_run()
    run.add_break(WD_BREAK.PAGE)
    p._p.addnext(thankyou)


def force_fonts_in_package(path: Path):
    tmp = path.with_suffix(".tmp.docx")
    with zipfile.ZipFile(path, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.endswith(".xml"):
                text = data.decode("utf-8")
                for old in (
                    "Helvetica Neue",
                    "Times New Roman",
                    "Aptos Display",
                    "Aptos",
                ):
                    text = text.replace(old, FONT)
                data = text.encode("utf-8")
            zout.writestr(item, data)
    tmp.replace(path)


def build():
    if not TEMPLATE.exists():
        raise SystemExit(f"Template not found: {TEMPLATE}")

    doc = Document(str(TEMPLATE))
    thankyou = strip_template_body(doc)

    # ── Document control ──────────────────────────────────────────
    add_title(doc, "Document Control")
    add_body(
        doc,
        "This guide explains how to use the TM ANTOINE Advisory Portal. It is written for people who work in the portal every day — staff, reviewing officers, administrators, service-provider contacts, and clients — not for software developers.",
    )
    add_table(
        doc,
        ["Item", "Detail"],
        [
            ["Document title", "Portal User Guide"],
            [
                "Subtitle",
                "How to sign in, find your way around, and complete everyday work in the TM ANTOINE Advisory Portal",
            ],
            ["Organization", "TM ANTOINE Partners & Advisory"],
            ["Product name", "TM ANTOINE Advisory Portal"],
            ["Production host", "https://portal.tmantoinelaw.com"],
            ["Version", "1.1"],
            ["Date", "10 September 2026"],
            ["Prepared by", "iGraphix Marketing & Co., Castries, Saint Lucia"],
            ["Prepared for", "TM ANTOINE Partners & Advisors"],
            ["Classification", "Confidential — intended recipients only"],
        ],
    )

    add_title(doc, "How to read this guide")
    add_body(
        doc,
        "Instructions tell you what to click, type, or select. Screenshots show the portal as it appears on screen. Tables describe fields, statuses, and who can use each area. Notes call out rules that are easy to miss.",
    )
    add_table(
        doc,
        ["Label", "Meaning"],
        [
            ["Click", "Press the named button, link, or menu item once."],
            ["Select", "Choose a value from a list, tab, or checkbox."],
            ["Enter", "Type the information into the field."],
            ["Save / Submit", "Store the work. Save as draft keeps an unfinished CIP application. Add files a completed intake form."],
        ],
    )
    add_callout(
        doc,
        "NOTE",
        "What you see depends on your account. The sidebar hides sections you are not allowed to open. This guide describes the full portal. If a section is missing on your screen, your account does not include it.",
    )

    add_title(doc, "Contents")
    add_bullets(
        doc,
        [
            "Introduction",
            "About the Portal",
            "Getting Started",
            "Signing In",
            "Portal Navigation",
            "Your status",
            "Dashboard",
            "Overview and desktop apps",
            "CIP Applications",
            "Pre-Approval workflow",
            "Post-Approval workflow",
            "Working a CIP file",
            "Managing Records",
            "File Library",
            "Email",
            "Messages and calls",
            "Feed",
            "Calendar",
            "Signatures",
            "Workflows",
            "Reporting",
            "Call Recordings",
            "Users and People",
            "Settings",
            "Account Types and Permissions",
            "Notifications and recent activity",
            "Common Tasks",
            "Troubleshooting",
            "Frequently Asked Questions",
            "Support",
        ],
        numbered=True,
    )

    write_guide(doc, SimpleNamespace(
        add_title=add_title,
        add_h2=add_h2,
        add_body=add_body,
        add_bullets=add_bullets,
        add_table=add_table,
        add_callout=add_callout,
        add_image=add_image,
    ))

    append_thankyou(doc, thankyou)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(OUT))
    force_fonts_in_package(OUT)
    print("wrote", OUT, "size", OUT.stat().st_size)


if __name__ == "__main__":
    build()
