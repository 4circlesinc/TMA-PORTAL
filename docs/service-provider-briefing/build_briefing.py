#!/usr/bin/env python3
"""Build the Service Provider Portal Briefing from the series Word template."""

from __future__ import annotations

import shutil
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Twips

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
UG = ROOT.parent / "user-guide"
sys.path.insert(0, str(UG))

import build_guide as g  # noqa: E402
from briefing_body import write_briefing  # noqa: E402

ASSETS = ROOT / "assets"
OUT = REPO / "docs" / "TM-ANTOINE-Service-Provider-Portal-Briefing.docx"

PRIMARY = "03A5E9"
PRIMARY_DARK = "136DA0"
TINT = "E6F6FD"
WHITE = "FFFFFF"

SHOTS_TO_COPY = [
    "02-login-options.png",
    "03-login-code.png",
    "28-two-step.png",
    "11-messages.png",
]

CHAPTERS = [
    "Why this briefing exists",
    "Authenticity and the two domains",
    "Who can enter the portal",
    "How sign-in works today, and what changes after this webinar",
    "Where the portal may be used",
    "How we protect the connection and the files",
    "What may be uploaded",
    "Where things live, and how they come back",
    "Bespoke AI — use it",
    "If something goes wrong",
    "Questions we have already been asked",
    "What we ask of you after the webinar",
]


def prepare_assets():
    ASSETS.mkdir(parents=True, exist_ok=True)
    src = UG / "screenshots"
    for name in SHOTS_TO_COPY:
        shutil.copy2(src / name, ASSETS / name)


def bookmark_name(index: int) -> str:
    return f"c{index:02d}"


def add_bookmark(paragraph, name: str, bm_id: str):
    start = OxmlElement("w:bookmarkStart")
    start.set(qn("w:id"), bm_id)
    start.set(qn("w:name"), name)
    end = OxmlElement("w:bookmarkEnd")
    end.set(qn("w:id"), bm_id)
    paragraph._p.insert(0, start)
    paragraph._p.append(end)


def add_field(paragraph, instruction: str):
    r1 = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    r1._r.append(begin)

    r2 = paragraph.add_run()
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = instruction
    r2._r.append(instr)

    r3 = paragraph.add_run()
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    r3._r.append(sep)

    r4 = paragraph.add_run(" ")
    g.set_run_font(r4, 10, color=PRIMARY_DARK)

    r5 = paragraph.add_run()
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    r5._r.append(end)


def page_break(doc):
    p = doc.add_paragraph(style="Default")
    g.p_fmt(p, before=0, after=0)
    run = p.add_run()
    run.add_break(WD_BREAK.PAGE)
    return p


def add_display_title(doc, text: str):
    p = doc.add_paragraph(style="Default")
    g.p_fmt(p, before=6, after=8, keep_next=True)
    run = p.add_run(text)
    g.set_run_font(run, 25, color=PRIMARY_DARK)
    return p


def make_chapter_title(counter: list[int]):
    def add_title(doc, text: str):
        p = doc.add_paragraph(style="Heading 1")
        g.p_fmt(p, before=6, after=8, keep_next=True)
        pf = p.paragraph_format
        pf.outline_level = 0
        run = p.add_run(text)
        g.set_run_font(run, 25, color=PRIMARY_DARK)
        counter[0] += 1
        add_bookmark(p, bookmark_name(counter[0]), str(counter[0]))
        return p

    return add_title


def add_h2_branded(doc, text: str):
    p = doc.add_paragraph(style="Heading 2")
    g.p_fmt(p, before=12, after=6, keep_next=True)
    run = p.add_run(text)
    g.set_run_font(run, 10, bold=True, color=PRIMARY_DARK)
    return p


def write_cell(cell, text: str, bold=False, header=False):
    cell.text = ""
    p = cell.paragraphs[0]
    g.p_fmt(p, before=2, after=2, line=240)
    run = p.add_run(text)
    color = PRIMARY_DARK if header else g.INK
    g.set_run_font(run, 10, bold=bold or header, color=color)


def add_table(doc, headers: list[str], rows: list[list[str]], col_twips: list[int] | None = None):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Style1"
    tbl = table._tbl
    tblPr = tbl.find(qn("w:tblPr"))
    if tblPr is None:
        tblPr = OxmlElement("w:tblPr")
        tbl.insert(0, tblPr)
    for old in tblPr.findall(qn("w:tblW")):
        tblPr.remove(old)
    tblW = OxmlElement("w:tblW")
    tblW.set(qn("w:w"), "10440")
    tblW.set(qn("w:type"), "dxa")
    tblPr.append(tblW)
    look = tblPr.find(qn("w:tblLook"))
    if look is None:
        look = OxmlElement("w:tblLook")
        tblPr.append(look)
    look.set(qn("w:val"), "04A0")
    look.set(qn("w:firstRow"), "1")
    look.set(qn("w:lastRow"), "0")
    look.set(qn("w:firstColumn"), "1")
    look.set(qn("w:lastColumn"), "0")
    look.set(qn("w:noHBand"), "0")
    look.set(qn("w:noVBand"), "1")

    widths = col_twips or (
        [2700, 7740] if len(headers) == 2 else [10440 // len(headers)] * len(headers)
    )
    grid = tbl.find(qn("w:tblGrid"))
    if grid is not None:
        tbl.remove(grid)
    grid = OxmlElement("w:tblGrid")
    for w in widths:
        gc = OxmlElement("w:gridCol")
        gc.set(qn("w:w"), str(w))
        grid.append(gc)
    tbl.insert(1, grid)

    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        write_cell(cell, h, header=True)
        g.set_cell_shd(cell, TINT)
        g.set_cell_borders(cell, bottom=True)
        cell.width = Twips(widths[i])

    for r_i, row in enumerate(rows):
        fill = g.GREY if r_i % 2 == 1 else None
        for c_i, val in enumerate(row):
            cell = table.rows[r_i + 1].cells[c_i]
            write_cell(cell, val, bold=(c_i == 0))
            g.set_cell_shd(cell, fill)
            g.set_cell_borders(cell, top=(r_i == 0), bottom=(r_i == len(rows) - 1))
            cell.width = Twips(widths[c_i])

    spacer = doc.add_paragraph(style="Default")
    g.p_fmt(spacer, before=0, after=8)
    return table


def add_callout(doc, kind: str, text: str):
    table = doc.add_table(rows=1, cols=2)
    table.style = "Style1"
    tbl = table._tbl
    tblPr = tbl.find(qn("w:tblPr"))
    if tblPr is None:
        tblPr = OxmlElement("w:tblPr")
        tbl.insert(0, tblPr)
    tblW = OxmlElement("w:tblW")
    tblW.set(qn("w:w"), "10440")
    tblW.set(qn("w:type"), "dxa")
    tblPr.append(tblW)
    left, right = table.rows[0].cells
    left.text = ""
    lp = left.paragraphs[0]
    g.p_fmt(lp, before=2, after=2, line=240)
    lr = lp.add_run(kind)
    g.set_run_font(lr, 10, bold=True, color=WHITE)
    g.set_cell_shd(left, PRIMARY_DARK)
    write_cell(right, text)
    g.set_cell_shd(right, TINT)
    g.set_cell_borders(left, bottom=True, top=True)
    g.set_cell_borders(right, bottom=True, top=True)
    left.width = Twips(1800)
    right.width = Twips(8640)
    spacer = doc.add_paragraph(style="Default")
    g.p_fmt(spacer, before=0, after=10)


def add_toc_page(doc, pages: dict[str, int] | None = None):
    add_display_title(doc, "Table of Contents")
    for i, title in enumerate(CHAPTERS, 1):
        p = doc.add_paragraph(style="Default")
        g.p_fmt(p, before=2, after=4)
        p.paragraph_format.tab_stops.add_tab_stop(
            Inches(6.45), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS
        )
        if pages and title in pages:
            run = p.add_run(f"{i}.  {title}\t{pages[title]}")
            g.set_run_font(run, 10)
        else:
            label = p.add_run(f"{i}.  {title}\t")
            g.set_run_font(label, 10)
            add_field(p, f" PAGEREF {bookmark_name(i)} \\h ")


def split_cover_section(doc):
    body = doc.element.body
    cover = body[0]
    dest = body.find(qn("w:sectPr"))
    pPr = cover.find(qn("w:pPr"))
    if pPr is None:
        pPr = OxmlElement("w:pPr")
        cover.insert(0, pPr)
    for old in pPr.findall(qn("w:sectPr")):
        pPr.remove(old)
    sect = deepcopy(dest)
    for old in sect.findall(qn("w:type")):
        sect.remove(old)
    for old in sect.findall(qn("w:headerReference")):
        sect.remove(old)
    for old in sect.findall(qn("w:footerReference")):
        sect.remove(old)
    typ = OxmlElement("w:type")
    typ.set(qn("w:val"), "nextPage")
    sect.insert(0, typ)
    pPr.append(sect)

    for old in dest.findall(qn("w:pgNumType")):
        dest.remove(old)
    pg = OxmlElement("w:pgNumType")
    pg.set(qn("w:start"), "1")
    dest.append(pg)


def clear_paragraphs(el):
    for p in list(el.paragraphs):
        p.text = ""


def add_content_footer(doc):
    cover, body = doc.sections[0], doc.sections[1]
    cover.footer.is_linked_to_previous = False
    cover.header.is_linked_to_previous = False
    clear_paragraphs(cover.footer)
    clear_paragraphs(cover.header)

    body.footer.is_linked_to_previous = False
    body.header.is_linked_to_previous = False
    clear_paragraphs(body.header)

    hp = body.header.paragraphs[0] if body.header.paragraphs else body.header.add_paragraph()
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    hr = hp.add_run("Service Provider Portal Briefing")
    g.set_run_font(hr, 9, color=PRIMARY_DARK)

    fp = body.footer.paragraphs[0] if body.footer.paragraphs else body.footer.add_paragraph()
    fp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    left = fp.add_run("TM ANTOINE Advisory Portal")
    g.set_run_font(left, 9, color=PRIMARY_DARK)
    gap = fp.add_run("    ")
    g.set_run_font(gap, 9)
    add_field(fp, " PAGE ")
    of = fp.add_run("  ·  Confidential")
    g.set_run_font(of, 9, color=PRIMARY_DARK)


def next_page_section(doc):
    body = doc.element.body
    dest = body.find(qn("w:sectPr"))
    p = OxmlElement("w:p")
    pPr = OxmlElement("w:pPr")
    sect = deepcopy(dest)
    for old in sect.findall(qn("w:type")):
        sect.remove(old)
    typ = OxmlElement("w:type")
    typ.set(qn("w:val"), "nextPage")
    sect.insert(0, typ)
    pPr.append(sect)
    p.append(pPr)
    dest.addprevious(p)


def enable_update_fields(doc):
    settings = doc.settings.element
    for old in settings.findall(qn("w:updateFields")):
        settings.remove(old)
    el = OxmlElement("w:updateFields")
    el.set(qn("w:val"), "true")
    settings.append(el)


def export_pdf_with_word(docx: Path, pdf: Path):
    src = Path("/tmp/tma-sp-briefing-src.docx")
    shutil.copy2(docx, src)
    if pdf.exists():
        pdf.unlink()
    script = f'''
tell application "Microsoft Word"
  activate
  delay 1
  set f to POSIX file "{src}" as alias
  open f
  delay 4
  set dest to (POSIX file "{pdf}") as string
  save as active document file name dest file format format PDF
  delay 2
  close active document saving no
end tell
'''
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=180,
    )
    print("word pdf", result.returncode, (result.stderr or result.stdout or "").strip()[:500], "exists", pdf.exists())
    return pdf.exists()


def pages_from_pdf(pdf: Path) -> dict[str, int]:
    try:
        from pypdf import PdfReader
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pypdf", "-q"])
        from pypdf import PdfReader

    reader = PdfReader(str(pdf))
    cover_offset = 1
    first = " ".join((reader.pages[0].extract_text() or "").split())
    if first:
        cover_offset = 0

    found: dict[str, int] = {}
    for i, page in enumerate(reader.pages, start=1):
        raw = page.extract_text() or ""
        text = " ".join(raw.split())
        if text.startswith("Table of Contents") or "Table of Contents 1." in text:
            continue
        for title in CHAPTERS:
            needle = " ".join(title.split())
            if needle in text:
                found[title] = max(1, i - cover_offset)
    print("toc pages", found)
    return found


def assemble(pages: dict[str, int] | None):
    g.SHOTS = ASSETS
    g.NAVY = PRIMARY_DARK
    doc = g.Document(str(g.TEMPLATE))
    thankyou = g.strip_template_body(doc)
    split_cover_section(doc)

    add_display_title(doc, "Document Control")
    g.add_body(
        doc,
        "This briefing explains how the TM ANTOINE Advisory Portal is built, who may use it, and how we protect service-provider firms and their clients. It is written for partners, compliance officers, and the people who will work the files — not for software developers.",
    )
    add_table(
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
        ],
    )

    add_display_title(doc, "How to read this briefing")
    g.add_body(
        doc,
        "Use it as the written answers for your compliance file. Tables are the short form of a question we have already been asked. Figures are there to present, not to decorate.",
    )
    add_table(
        doc,
        ["Label", "Meaning"],
        [
            ["NOTE", "A rule that is easy to miss."],
            ["SECURITY", "A control you should be able to repeat to a client."],
            ["HONESTY", "Something we do not over-claim."],
            ["TIP", "What to do on Monday morning."],
        ],
    )

    page_break(doc)
    add_toc_page(doc, pages)
    page_break(doc)

    bm = [0]
    write_briefing(
        doc,
        SimpleNamespace(
            add_title=make_chapter_title(bm),
            add_h2=add_h2_branded,
            add_body=g.add_body,
            add_bullets=g.add_bullets,
            add_table=add_table,
            add_callout=add_callout,
            add_image=g.add_image,
        ),
    )

    next_page_section(doc)
    g.append_thankyou(doc, thankyou)
    add_content_footer(doc)
    if len(doc.sections) > 2:
        close = doc.sections[2]
        close.footer.is_linked_to_previous = False
        close.header.is_linked_to_previous = False
        clear_paragraphs(close.footer)
        clear_paragraphs(close.header)
    enable_update_fields(doc)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(OUT))
    g.force_fonts_in_package(OUT)


def build():
    prepare_assets()
    if not g.TEMPLATE.exists():
        raise SystemExit(f"Template not found: {g.TEMPLATE}")

    assemble(None)
    pdf = Path("/tmp/tma-sp-briefing.pdf")
    if export_pdf_with_word(OUT, pdf):
        pages = pages_from_pdf(pdf)
        if len(pages) >= 8:
            assemble(pages)

    print("wrote", OUT, "size", OUT.stat().st_size)


if __name__ == "__main__":
    build()
