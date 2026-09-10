#!/usr/bin/env python3
"""Build the TM ANTOINE Advisory Portal User Guide from the series template."""

from __future__ import annotations

import shutil
import zipfile
from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor, Twips
from lxml import etree

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
            ["Version", "1.0"],
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
            "Dashboard",
            "CIP Applications",
            "Managing Records",
            "File Library",
            "Messages, Email, Calendar, Signatures and Feed",
            "Workflows",
            "Users and People",
            "Settings",
            "Account Types and Permissions",
            "Statuses and Notifications",
            "Common Tasks",
            "Troubleshooting",
            "Frequently Asked Questions",
            "Support",
        ],
        numbered=True,
    )

    # ── 1 Introduction ────────────────────────────────────────────
    doc.add_page_break()
    add_title(doc, "1. Introduction")
    add_body(
        doc,
        "The TM ANTOINE Advisory Portal is the firm’s workspace for Citizenship by Investment (CIP) files, documents, mail, messages, calendars, signatures, and the people connected to that work.",
    )
    add_body(
        doc,
        "Use this guide when you need to sign in, find a screen, complete a CIP application, share a file, or change an account setting. Keep it beside you the first time you use a feature, then return to the relevant section when a question comes up.",
    )
    add_h2(doc, "Who this guide is for")
    add_bullets(
        doc,
        [
            "Administrators who set up the firm, approve accounts, and manage CIP files.",
            "CRO / Reviewing officers who review applications, documents, and decisions.",
            "Service-provider contacts and private clients who were invited to work on their own files.",
        ],
    )
    add_callout(
        doc,
        "NOTE",
        "Accounts still typed as Employee cannot use the portal. They see a holding screen until an administrator assigns a working role (CRO / Reviewing officer or Administrator). Client accounts are created by invitation, not from the Users page.",
    )

    # ── 2 About ───────────────────────────────────────────────────
    add_title(doc, "2. About the Portal")
    add_body(
        doc,
        "Open the portal in a web browser at https://portal.tmantoinelaw.com. After you sign in you work inside one shell: a sidebar on the left, a header across the top, and the current page in the centre.",
    )
    add_h2(doc, "What the portal is used for")
    add_bullets(
        doc,
        [
            "Create, review, and move CIP applications through pre-approval, post-approval, appeal, and closed work.",
            "Store and share the files that belong to those applications and to the firm.",
            "Message colleagues, read connected email, and keep a calendar.",
            "Send and sign signature requests.",
            "Approve people to use the portal and control what each account can open.",
        ],
    )
    add_h2(doc, "What you will not find here")
    add_body(
        doc,
        "The portal does not put a Citizenship by Investment Smartsheet module in the main menu. If that module is turned off for the environment, it is not available to anyone, including administrators. This guide does not describe screens that are switched off.",
    )

    # ── 3 Getting started ─────────────────────────────────────────
    add_title(doc, "3. Getting Started")
    add_body(
        doc,
        "You need an approved account before you can use the portal. Most people arrive in one of two ways.",
    )
    add_h2(doc, "You were invited")
    add_body(
        doc,
        "Open the invitation email and follow the link. Complete the screens the portal shows you. Clients typically see Welcome, About you, How we reach you, an optional calendar connection, then Your account. Staff see a Set up your account checklist, then preferences, two-factor authentication, notifications, and (if you use portal mail) Email.",
    )
    add_h2(doc, "You already have an account")
    add_body(
        doc,
        "Go to the sign-in page and use Google, Microsoft, or Email, as described in the next section.",
    )
    add_h2(doc, "Before you start")
    add_bullets(
        doc,
        [
            "Use a current browser on a computer. A phone will open the portal, but tables and CIP intake are easier on a wide screen.",
            "Have access to the inbox for the email on your account. New devices ask for a six-digit email code.",
            "If your firm requires an authenticator app, have that app ready.",
        ],
    )

    # ── 4 Signing in ──────────────────────────────────────────────
    doc.add_page_break()
    add_title(doc, "4. Signing In")
    add_body(
        doc,
        "The sign-in page shows the TM ANTOINE mark and three ways to sign in. Choose the method your administrator expects you to use.",
    )
    add_image(
        doc,
        "02-login-options-annotated.png",
        "Figure 1. Sign in. 1 — Firm mark. 2 — Sign in with Google. 3 — Sign in with Microsoft. 4 — Sign in with Email.",
    )
    add_h2(doc, "Step 1 — Open the sign-in page")
    add_body(
        doc,
        "In your browser go to https://portal.tmantoinelaw.com. If you are not already signed in, the portal opens Sign in.",
    )
    add_h2(doc, "Step 2 — Choose a sign-in method")
    add_body(
        doc,
        "Click Sign in with Google or Sign in with Microsoft to use that account. The browser opens the provider’s sign-in page. Finish there, then you return to the portal.",
    )
    add_body(
        doc,
        "Click Sign in with Email to type your portal email and password.",
    )
    add_image(
        doc,
        "01-login-email.png",
        "Figure 2. Email sign-in. Enter Email and Password, then click Sign in. Use Forgot password? if you cannot remember the password. All sign in options returns to Google, Microsoft, and Email.",
    )
    add_h2(doc, "Step 3 — Enter email and password")
    add_bullets(
        doc,
        [
            "Enter the email address on your portal account.",
            "Enter your password. The eye icon shows or hides the password.",
            "Click Sign in.",
        ],
        numbered=True,
    )
    add_h2(doc, "New to the portal?")
    add_body(
        doc,
        "Click Create an account under the sign-in buttons if you were told to register yourself. Most client and provider accounts are created from an invitation instead.",
    )

    add_h2(doc, "Confirm it is you")
    add_body(
        doc,
        "When you sign in from a browser the portal has not seen before, it emails a six-digit code and shows Let’s confirm it’s you. The email address is partly hidden (for example ad•••@…). The code expires in 10 minutes.",
    )
    add_image(
        doc,
        "03-login-code.png",
        "Figure 3. Email confirmation code. Enter the six digits, leave Trust this browser checked if this is your usual computer, then click Confirm.",
    )
    add_bullets(
        doc,
        [
            "Open the message with the subject Your sign-in code.",
            "Type the six digits into the boxes. The cursor moves forward as you type.",
            "Leave Trust this browser for 7 days checked on a private computer so the next sign-in on this browser skips the code. Clear the box on a shared computer.",
            "Click Confirm.",
            "If the code does not arrive, wait for the countdown, then click Resend code.",
            "If it was not you, click Reset your password.",
        ],
        numbered=True,
    )
    add_callout(
        doc,
        "IMPORTANT",
        "Do not share the email code. If you did not try to sign in, reset your password and contact support.",
    )
    add_h2(doc, "Authenticator app")
    add_body(
        doc,
        "If your account uses an authenticator app, the portal asks for the six-digit code from that app (or a recovery code) instead of, or in addition to, other checks. Enter the code and click Verify.",
    )
    add_h2(doc, "Stay signed in")
    add_body(
        doc,
        "The portal may ask Stay signed in? Click Yes on a private computer. Click Not this time on a shared computer.",
    )
    add_h2(doc, "Forgot password")
    add_body(
        doc,
        "On the email sign-in form, click Forgot password?. Enter your email and submit the form. The portal emails a reset link if that address has an account. For privacy, the success screen does not tell you whether the address exists. Open the email, choose a new password, then sign in with it.",
    )
    add_h2(doc, "If your account is waiting")
    add_body(
        doc,
        "Until an administrator approves you, the portal shows that your account is under review. After approval you can continue. Parked Employee accounts see that the portal is under development until a working role is assigned.",
    )

    # ── 5 Navigation ──────────────────────────────────────────────
    doc.add_page_break()
    add_title(doc, "5. Portal Navigation")
    add_body(
        doc,
        "Once you are in, the same chrome stays on every page: sidebar, header, and the page in the middle. The sidebar can sit as a labelled list or as icons only, depending on Theme settings (Standard sidebar or Hover overlay sidebar).",
    )
    add_image(
        doc,
        "04-dashboard-annotated.png",
        "Figure 4. Portal shell. 1 — Sidebar (Menu and Folders). 2 — Greeting and profile photo. 3 — Dashboard summary cards. 4 — Recent Files and other tiles.",
    )
    add_h2(doc, "Sidebar — Menu")
    add_body(
        doc,
        "The Menu tab is the main list. Click a row to open that page. Rows with a chevron expand to show children.",
    )
    add_table(
        doc,
        ["Item", "What it opens"],
        [
            ["Dashboard", "Home overview, greeting, and tiles."],
            ["Overview", "Staff overview of work, files, and (where allowed) sign-ins."],
            ["CIP Applications", "Citizenship by Investment files at /citizenship-applications."],
            ["Email", "Connected Outlook mailbox. Staff with mail access."],
            ["Messages", "Conversations inside the portal."],
            ["Feed", "Internal posts and channels."],
            ["Calendar", "Your calendars and, for staff, shared calendars."],
            ["Signatures", "Signature requests. Label in the menu: Signatures."],
            ["File Library", "All Files, Personal Folders, Shared Folders, Shared With Me, Favorites, Recent, File Box, Recycle Bin."],
            ["Users", "Account table. Administrators."],
            ["Reporting", "Firm reports, including CIP. Administrators."],
            ["Templates", "System Emails, Email Templates, Granted And Denied Letters, Document Requirements."],
            ["Workflows", "Requests, Feedback And Comments, Updates Required."],
            ["Call Recordings", "Recorded client calls. Staff only; employees see their own recordings."],
            ["People", "Directories, address books, distribution groups, resend welcome emails."],
            ["Settings", "Account settings rail."],
        ],
    )
    add_h2(doc, "Sidebar — Folders")
    add_body(
        doc,
        "The Folders tab lists folder shortcuts you keep, not the full File Library tree. Use File Library on the Menu tab for All Files and the other library views.",
    )
    add_h2(doc, "Profile and sign out")
    add_body(
        doc,
        "Your name, email, and photo sit at the bottom of the sidebar. Click the sign-out icon to end the session.",
    )
    add_h2(doc, "Header")
    add_table(
        doc,
        ["Control", "What it does"],
        [
            ["Sidebar button", "Expands or collapses the sidebar, or opens it as a drawer on a narrow screen."],
            ["Breadcrumb", "Shows where you are, for example Dashboard or File Library / All Files."],
            ["Search", "Opens portal search. The shortcut is the / key."],
            ["Presence", "Shows and sets your status."],
            ["Theme", "Switches light and dark appearance."],
            ["Activities", "Opens recent activity."],
            ["Notifications", "Opens the notification list. A badge on the bell shows unread items."],
            ["Right panel", "Opens or closes the right-hand panel."],
        ],
    )
    add_callout(
        doc,
        "TIP",
        "Press / to search. Search looks at the pages your account is allowed to open.",
    )

    # ── 6 Dashboard ───────────────────────────────────────────────
    add_title(doc, "6. Dashboard")
    add_body(
        doc,
        "Dashboard is the home page. It greets you by name and shows tiles for the work you can see. Staff see summary cards. Clients do not see the staff KPI row.",
    )
    add_h2(doc, "What staff see on the cards")
    add_table(
        doc,
        ["Card", "Meaning"],
        [
            ["Avg. Response to Clients", "How quickly the firm has been answering clients in the selected period."],
            ["New CIP Applications", "New CIP files in the period."],
            ["CIP Updates Required", "Files waiting on updates."],
            ["Awaiting Signature", "Signature requests still unsigned."],
        ],
    )
    add_body(
        doc,
        "Service-provider contacts see a different set when they have CIP access: Active CIP Applications, CIP Updates Required, Unread Messages, and Open Comments.",
    )
    add_h2(doc, "Date range")
    add_body(
        doc,
        "Use This month (or Today, This week, This year) in the page header to change the period the cards use.",
    )
    add_h2(doc, "Tiles")
    add_body(
        doc,
        "Tiles under the cards include Recent Files, Recent Email (staff with mail), Messages, Shortcuts, Employees (staff), Favorites, Upcoming Events, CIP Applications, Requests, and Comments. You can show or hide some of this from Edit Dashboard on the page. A tile that needs a permission you do not hold is not shown.",
    )
    add_h2(doc, "Change your profile picture")
    add_body(
        doc,
        "If the greeting offers Change profile picture, click it and follow the prompt, or open Settings and edit My Profile.",
    )

    # ── 7 CIP ─────────────────────────────────────────────────────
    doc.add_page_break()
    add_title(doc, "7. CIP Applications")
    add_body(
        doc,
        "CIP Applications is the Citizenship by Investment file list. Open it from the sidebar. The address is /citizenship-applications.",
    )
    add_h2(doc, "Purpose")
    add_body(
        doc,
        "Hold every application the firm is working on, from the first draft through review, decision, post-approval (COR, NIC, passport), appeal, and closed.",
    )
    add_h2(doc, "Who uses it")
    add_table(
        doc,
        ["Who", "What they can do"],
        [
            ["Administrator", "See the full hub, assign officers, configure CIP, and move files through every step the module allows."],
            ["CRO / Reviewing officer", "Open CIP, create applications, review documents, update statuses, and record decisions."],
            ["Service-provider contact", "Work on the provider’s files. The Service providers and Provider contacts registry tabs are hidden."],
            ["Private client", "See their own files only. List tabs are hidden."],
        ],
    )
    add_callout(
        doc,
        "NOTE",
        "CIP is a product module. If it is switched off for the environment, nobody — including administrators — can use it. This section describes the module when it is on.",
    )

    add_h2(doc, "The application list")
    add_image(
        doc,
        "05-cip-applications-annotated.png",
        "Figure 5. CIP Applications. 1 — List tabs. 2 — Count, Status, Assigned to, Service provider filters, and Search. 3 — Application table.",
    )
    add_body(doc, "Staff tabs:")
    add_bullets(
        doc,
        [
            "All Applications",
            "Pre-Approval Applications",
            "Post-Approval Applications",
            "Appeals",
            "Closed",
            "Service providers",
            "Provider contacts",
        ],
    )
    add_h2(doc, "Columns")
    add_table(
        doc,
        ["Column", "Meaning"],
        [
            ["Application", "Internal number, for example GAL26-00003. Click the row to open the file."],
            ["Applicant", "Main applicant name."],
            ["Service provider", "The provider on the file."],
            ["Investment", "Investment type recorded on the file."],
            ["Family", "Family composition. Post-approval rows can expand members with their own status chips."],
            ["Status", "Where the file sits in the lifecycle. Click Change status to move it when you are allowed to."],
            ["Assigned to", "Officer on the file. Use Assign an officer when you can assign."],
        ],
    )
    add_body(
        doc,
        "Click a column heading to sort. Use Status, Assigned to, and Service provider to filter. Type in Search to find a number or name. Each row has More actions for further commands on that file.",
    )

    add_h2(doc, "Create an application")
    add_body(
        doc,
        "Click Create New Application. The menu offers Create New Pre-Approval Application, Create New Post-Approval Application, New service provider, and Import.",
    )
    add_h2(doc, "Step 1 — Choose the type")
    add_bullets(
        doc,
        [
            "Click Create New Application.",
            "Click Create New Pre-Approval Application for a file that has not yet been decided.",
            "Click Create New Post-Approval Application for a file that was already approved outside this intake and now needs post-approval work. That form also asks for the CIP application number from the decision letter.",
        ],
        numbered=True,
    )
    add_h2(doc, "Step 2 — Fill the intake form")
    add_image(
        doc,
        "07-cip-intake.png",
        "Figure 6. New pre-approval application. Required fields are marked with a red asterisk. The form autosaves. Use Save as draft to keep an unfinished file.",
    )
    add_body(doc, "Complete the sections the form shows. Typical required information:")
    add_table(
        doc,
        ["Field", "What to enter"],
        [
            ["Service provider", "Select the provider. Required."],
            ["Investment type", "Select the investment. If you choose other, specify it."],
            ["Sponsored", "Yes or No. If Yes, complete the sponsor fields."],
            ["Passport photo", "Square image, 2×2 inches, 600×600 pixels or larger."],
            ["First name / Last name", "Main applicant."],
            ["Gender / Date of birth", "As on the passport."],
            ["Country of birth / residence", "Select from the lists."],
            ["Occupation", "Applicant’s occupation."],
            ["Passport number", "As on the passport."],
            ["Passport bio page / Birth certificate", "Upload where the form requires them."],
        ],
    )
    add_body(
        doc,
        "Add dependents if needed. Each dependent needs at least first name, last name, date of birth, and relationship (Spouse or Qualified dependent).",
    )
    add_h2(doc, "Step 3 — Save or file")
    add_bullets(
        doc,
        [
            "Click Save as draft to keep the file in Draft. Drafts appear in the table with a number. Draft is not a queue you pick in the status list. The way out of Draft is to file the application.",
            "When the required fields and files are complete, use Add in the page toolbar to submit. The file joins New Applications.",
        ],
        numbered=True,
    )
    add_callout(
        doc,
        "IMPORTANT",
        "Filing checks the main applicant’s documents. If something required is missing, the portal will not move the file into New Applications until you add it.",
    )
    add_h2(doc, "After you open a file")
    add_body(
        doc,
        "Click an application number or applicant to open the file. The profile is organised in tabs such as Overview (timeline, assignment, facts), Main applicant, Sponsor or Dependents when they exist, Documents, Assigned, Messages, Portal access, and Activity.",
    )
    add_h2(doc, "What happens next")
    add_bullets(
        doc,
        [
            "Reviewers work the Documents tab, leave comments, and can request updates.",
            "Status chips and Change status move the file along the lifecycle when your account allows it.",
            "Assign an officer places the file with a reviewing officer. Assigning is an administrator action.",
            "Record decision captures Approved or Denied and uses the Granted or Denied letter templates.",
            "After a grant, post-approval work records COR, NIC, and passport dates from the stage buttons (Record COR submission / received, and the matching NIC and passport actions).",
        ],
    )
    add_h2(doc, "Things to watch for")
    add_bullets(
        doc,
        [
            "Do not treat Draft as a status you assign. File the application when it is ready.",
            "Post-approval intake needs the CIP number from the existing decision.",
            "Private clients will not see other people’s files or the provider registry tabs.",
            "If Assign an officer is missing, your account cannot assign. Ask an administrator.",
        ],
    )

    add_h2(doc, "Application statuses")
    add_table(
        doc,
        ["Status", "When you see it"],
        [
            ["Draft", "Intake still being typed. Not offered in status pickers."],
            ["New Applications", "Just filed."],
            ["Review Applications", "Under review."],
            ["Assessment Feedback", "Feedback is being recorded."],
            ["Updates Required", "The file needs information or documents back."],
            ["Ready to Submit", "Ready to go forward."],
            ["Pending Review", "Waiting on review."],
            ["Non-compliant", "Did not meet a requirement."],
            ["Background Check", "Background checks in progress."],
            ["Delayed", "Held up."],
            ["Approved", "Pre-approval grant, or a later approved outcome (including after appeal)."],
            ["Denied", "Refused, including after appeal."],
            ["Post-Approval", "Entered the post-approval lane."],
            ["Apply for COR / Pending COR", "Certificate of Residence stage."],
            ["Apply for NIC / Pending NIC", "National ID card stage."],
            ["Apply for Passport / Pending Passport", "Passport stage."],
            ["Ready for Delivery", "Ready to deliver."],
            ["Closed", "Finished."],
            ["New Appeal / Appeal Ready / Appeal Submitted", "Appeal lane after a decision."],
        ],
        col_twips=[3510, 6930],
    )

    # ── 8 Records ─────────────────────────────────────────────────
    add_title(doc, "8. Managing Records")
    add_body(
        doc,
        "Lists in the portal follow the same pattern: a table, a search box, optional filters, sortable headings, and a row menu.",
    )
    add_h2(doc, "Search")
    add_body(
        doc,
        "Type in the search box on the page (placeholder Search, or a more specific hint such as Search by file name). Press Enter or wait for the list to refresh. Clear the box to show everything again.",
    )
    add_h2(doc, "Filter")
    add_body(
        doc,
        "Open a filter such as Status or Assigned to and select values. Active filters show as chips you can remove. Use this on CIP Applications to narrow a long list.",
    )
    add_h2(doc, "Sort")
    add_body(
        doc,
        "Click a column heading. Click again to reverse the order. An arrow on the heading shows the current sort, as on File Library Name.",
    )
    add_h2(doc, "Open, edit, add, remove")
    add_bullets(
        doc,
        [
            "Open a record by clicking its name or number.",
            "Add with the page action (Create New Application, the + on Users, or New message).",
            "Edit from the record, from More actions, or from an Edit control on the profile.",
            "Delete only where the portal offers it. File Library items can go to Recycle Bin. Account deletion is an administrator action on Users, or Delete my account on your own profile. Do not assume a row can be deleted because other tables allow it.",
        ],
    )
    add_callout(
        doc,
        "TIP",
        "On CIP Applications, combine Search with Status and Assigned to instead of scrolling the full list.",
    )

    # ── 9 Files ───────────────────────────────────────────────────
    add_title(doc, "9. File Library")
    add_body(
        doc,
        "File Library holds the firm’s documents. Expand it in the sidebar and choose a view.",
    )
    add_image(
        doc,
        "10-file-library.png",
        "Figure 7. File Library / All Files. Toolbar: new folder, upload, extra folder actions, download, list or grid, sort, refresh, Name sort, and type filters. Star a folder to keep it in Favorites.",
    )
    add_table(
        doc,
        ["View", "What it shows"],
        [
            ["All Files", "The organisation tree you are allowed to see (staff). CIP-reach accounts may see a Clients-scoped tree."],
            ["Personal Folders", "Your personal area."],
            ["Shared Folders", "Folders shared across the firm. Staff."],
            ["Shared With Me", "Items other people shared with you."],
            ["Favorites", "Items you starred."],
            ["Recent", "Recently opened items."],
            ["File Box", "File Box items."],
            ["Recycle Bin", "Items you (or, for administrators, the firm) can restore or remove."],
        ],
    )
    add_h2(doc, "Common actions")
    add_bullets(
        doc,
        [
            "Open a folder by clicking its name.",
            "Upload with the upload control on the toolbar.",
            "Create a folder with the new-folder control.",
            "Star a row to add it to Favorites.",
            "Switch list and grid with the toolbar buttons.",
            "Sort by Name or the other sort options on the toolbar.",
        ],
    )
    add_callout(
        doc,
        "NOTE",
        "Clients do not see the full organisation tree. They see their own folder and anything shared with them. Rehoming system folders and deleting another person’s content is administration.",
    )

    # ── 10 Comms ──────────────────────────────────────────────────
    doc.add_page_break()
    add_title(doc, "10. Messages, Email, Calendar, Signatures and Feed")
    add_h2(doc, "Messages")
    add_body(
        doc,
        "Messages is the portal chat. Open it from the sidebar. Search for people or conversations. Start a thread with New message. Clients can message the staff assigned to them. Staff with permission can contact more widely.",
    )
    add_image(
        doc,
        "11-messages.png",
        "Figure 8. Messages. Use Search to find a person or conversation. If you have none yet, the page reads No conversations yet.",
    )
    add_h2(doc, "Email")
    add_body(
        doc,
        "Email is a connected Outlook mailbox for accounts that hold mail access. Connect the mailbox from Settings → Connectors or during staff account setup (Connect your email). Until a mailbox is connected, Dashboard tiles such as Recent Email ask you to connect one. Compose opens a compose window. Search in mail finds messages in the connected mailbox.",
    )
    add_h2(doc, "Calendar")
    add_body(
        doc,
        "Calendar shows Month, Week, Work Week, Day, and Agenda. My Calendars lists calendars such as Personal. Use + beside Calendars to add one when the page offers it. Staff can use shared and group calendars. Clients keep their own calendar and meetings they are invited to.",
    )
    add_image(
        doc,
        "12-calendar.png",
        "Figure 9. Calendar in Month view, with My Calendars on the left.",
    )
    add_h2(doc, "Signatures")
    add_body(
        doc,
        "Signatures lists signature requests. Staff who can create requests compose and send them. Anyone can sign a request that is addressed to them. The Dashboard card Awaiting Signature counts unsigned work in the selected period.",
    )
    add_h2(doc, "Feed")
    add_body(
        doc,
        "Feed is the internal social area: channels and posts. Staff with feed access can open it. Creating a channel and moderating (including channels you were not invited to) are separate permissions. Search on Feed looks at posts, people, and files.",
    )

    # ── 11 Workflows ──────────────────────────────────────────────
    add_title(doc, "11. Workflows")
    add_body(
        doc,
        "Workflows tracks file requests, comments, and items that need an update. Expand Workflows in the sidebar.",
    )
    add_table(
        doc,
        ["Page", "Use it for"],
        [
            ["Requests", "Work waiting on you, sent by you, or all requests. Search by file name."],
            ["Feedback And Comments", "Comment threads you are part of."],
            ["Updates Required", "Items that still need an update."],
        ],
    )
    add_image(
        doc,
        "13-workflows.png",
        "Figure 10. Workflows / Requests. Tabs: Waiting on you, Sent by you, All requests.",
    )
    add_body(
        doc,
        "Service-provider contacts can reach these pages for their own work even without the staff workflows permission. Open a row to act on the file.",
    )

    # ── 12 Users ──────────────────────────────────────────────────
    add_title(doc, "12. Users and People")
    add_h2(doc, "Users")
    add_body(
        doc,
        "Users is the account table for administrators. Each row shows a serial (for example #U0001), the person’s name, a status such as Active or Pending, and their email.",
    )
    add_image(
        doc,
        "09-users.png",
        "Figure 11. Users. Use + to add, the filter and sort controls in the toolbar, and the checkboxes for bulk actions when they are offered.",
    )
    add_body(
        doc,
        "From this page administrators approve, suspend, reset, delete, and change the type of accounts. The types you can assign here are CRO / Reviewing officer and Administrator. Client accounts are not typed by hand on this page; they arrive through invitations from a client or service-provider record.",
    )
    add_h2(doc, "People")
    add_body(
        doc,
        "People is the directory, when your account can open it: Manage Users Home, Browse Employees, Browse Client Contacts, Browse Prospects, Shared Address Book, Personal Address Book, Distribution Groups, and Resend Welcome Emails. Reaching People at all is a directory permission. Client contact screens also need client-hub access.",
    )

    # ── 13 Settings ───────────────────────────────────────────────
    doc.add_page_break()
    add_title(doc, "13. Settings")
    add_body(
        doc,
        "Open Settings from the sidebar (Account settings). Everyone can open the page. The rail on the left only shows sections your account may use. Personal sections are always there. Firm administration appears for administrators.",
    )
    add_image(
        doc,
        "08-settings.png",
        "Figure 12. Settings. Left: settings rail. Right: My Profile (name, contact details, email, Save profile).",
    )
    add_h2(doc, "Personal settings — what you can change")
    add_table(
        doc,
        ["Section", "What it controls"],
        [
            ["My Profile", "Name and profile fields, email (administrators can change email), password, 2-step verification, support access, log out of all devices, delete my account. Click Save profile after edits."],
            ["Theme", "Light or dark, font size 1–5, Standard sidebar or Hover overlay sidebar."],
            ["Time And Language", "Automatic timezone, time zone, language and region."],
            ["Notifications", "Email notifications, always send email, toast behaviour, and per-module Portal / Email / Desktop / Sound. Security & Approvals on the portal channel stays on."],
            ["Privacy", "Who can see that you are online and last seen, read receipts, typing indicator, history retention."],
            ["Account Security", "Your password and two-factor settings (under Security)."],
            ["Connectors", "Link your Microsoft account for Outlook, Calendar, and OneDrive."],
        ],
        col_twips=[2700, 7740],
    )
    add_h2(doc, "What you should avoid changing without a reason")
    add_bullets(
        doc,
        [
            "Do not turn off two-factor authentication if your administrator requires it. The portal will block that.",
            "Do not delete your account unless you intend to leave the portal. That cannot be undone from your side.",
            "Do not click Log out of all devices unless you mean to sign every browser and phone out.",
            "Leave Security & Approvals portal notifications on.",
        ],
    )
    add_h2(doc, "What happens when you save")
    add_body(
        doc,
        "Click Save or Save profile. The portal stores the change and shows a short confirmation. Theme and sidebar style apply on this browser. Security changes (password, two-factor) may email you a confirmation and can sign other sessions out.",
    )
    add_h2(doc, "Administrator settings")
    add_body(
        doc,
        "These rail groups appear only if your account holds the matching permission. Employees and clients do not see them.",
    )
    add_table(
        doc,
        ["Group / item", "What it is for"],
        [
            ["Background Operations", "Long-running jobs: mail import, calendar import, OneDrive sync, outbound email. Check here if a job has stopped."],
            ["Notification History", "Firm-wide notification history."],
            ["Edit Company Branding", "Company name, logo, and colours every account sees."],
            ["CIP Console — Administrator", "CIP administration."],
            ["CIP Console — Access", "Who on staff may use the client hub."],
            ["CIP Console — Service Teams", "Service teams for client work."],
            ["CIP Console — Custom Fields", "Extra fields on client records."],
            ["CIP Console — Document Requirements", "Document templates for CIP files."],
            ["CIP Console — Granted And Denied Letters", "Decision letter templates."],
            ["CIP Console — Distribution Group", "CIP distribution groups."],
            ["Security Insights / Sign In Policy / Security Policy / Security Alert Settings / Configure Device Security", "Firm-wide sign-in, password, two-factor, and device policy. Not the same as your own Account Security."],
            ["Storage — Usage", "Storage against the licence."],
            ["Advanced Preferences — Permissions", "Whether employees hold extra directory permissions."],
            ["Default Folders / Folder Templates", "File Library defaults and templates."],
        ],
        col_twips=[3510, 6930],
    )
    add_callout(
        doc,
        "NOTE",
        "Reporting also lives as a main sidebar page, not only in Settings. Open Reporting from the menu when you need firm-wide reports.",
    )

    # ── 14 Roles ──────────────────────────────────────────────────
    add_title(doc, "14. Account Types and Permissions")
    add_body(
        doc,
        "The portal stores an account type on each user. Administrators hold every capability the environment allows. Other types hold a fixed set, with two overlays administrators can change: Client hub access and Advanced Preferences → Permissions.",
    )
    add_table(
        doc,
        ["Account type", "What they can do"],
        [
            ["Client", "Dashboard without staff cards, Messages with assigned staff, own calendar, own and shared files, sign requests sent to them, personal Settings. CIP only if they are a private client or a service-provider contact on the hub."],
            ["Employee", "Recognised but not newly assigned. Cannot use the portal until an administrator assigns a working role."],
            ["CRO / Reviewing officer", "Staff baseline (mail, files, calendar, client hub where granted, workflows) plus CIP view, create, review, compliance, and decide. Cannot assign CIP files or reword firm-wide CIP letters."],
            ["Administrator", "Everything the environment has switched on, including Users, Reporting, assigning CIP files, branding, and security policy."],
        ],
        col_twips=[2700, 7740],
    )
    add_callout(
        doc,
        "NOTE",
        "Older spellings Reviewing Officer and Compliance Officer still mean CRO / Reviewing officer. The Users page does not offer Employee or Client as types you can hand out.",
    )

    # ── 15 Notifications ──────────────────────────────────────────
    add_title(doc, "15. Statuses and Notifications")
    add_h2(doc, "Notification bell")
    add_body(
        doc,
        "The bell in the header opens notifications. Unread items show a badge. Notification History in Settings (administrators) lists firm-wide history. Choose which channels you receive under Settings → Notifications.",
    )
    add_h2(doc, "Presence")
    add_body(
        doc,
        "The header presence control shows whether you are available. Dashboard Employees (staff) shows who is online and their work status.",
    )
    add_h2(doc, "Emails the portal sends")
    add_body(
        doc,
        "Typical messages include Your sign-in code, password reset, password changed, two-factor changed, invitations, and CIP notices. Wording can be edited by administrators under Templates → System Emails. Support copy in those messages uses support@tmantoine.com.",
    )

    # ── 16 Common tasks ───────────────────────────────────────────
    add_title(doc, "16. Common Tasks")
    add_table(
        doc,
        ["Task", "Where to start"],
        [
            ["Sign in", "Sign in page → Google, Microsoft, or Email."],
            ["Open a CIP file", "CIP Applications → click the application number."],
            ["Start a CIP file", "CIP Applications → Create New Application."],
            ["Upload a document to a CIP file", "Open the file → Documents tab."],
            ["Find a file", "File Library, or Search in the header, or Recent Files on Dashboard."],
            ["Message someone", "Messages → New message, or Search."],
            ["Change password", "Settings → My Profile or Account Security."],
            ["Connect Outlook / Calendar / OneDrive", "Settings → Connectors, or Set up your account for new staff."],
            ["Sign out", "Sign-out icon at the bottom of the sidebar."],
        ],
        col_twips=[3510, 6930],
    )

    # ── 17 Troubleshooting ────────────────────────────────────────
    doc.add_page_break()
    add_title(doc, "17. Troubleshooting")
    add_table(
        doc,
        ["What you see", "What to do"],
        [
            ["Sign in does not continue", "Check email and password. Use Forgot password?. Try All sign in options and another method if you usually use Google or Microsoft."],
            ["Let’s confirm it’s you", "Enter the code from Your sign-in code. Wait for Resend if you need another. Check junk mail."],
            ["Account is under review", "Wait for an administrator to approve the account."],
            ["The portal is under development", "Your account is still Employee. Ask an administrator to assign CRO / Reviewing officer or Administrator."],
            ["A sidebar item is missing", "Your account does not have that area. That is expected, not a broken menu."],
            ["CIP Applications is missing or empty of controls", "You may not have CIP access, or the CIP module is off. Ask an administrator."],
            ["Cannot submit a CIP intake", "Complete every field marked with an asterisk and the required files, then use Add. Use Save as draft if you are not ready."],
            ["Cannot assign an officer", "Only administrators assign CIP files."],
            ["Email tile says connect a mailbox", "Settings → Connectors, or Connect your email during setup."],
            ["Signed out unexpectedly", "Sign in again. If the session expired, the portal says so on Sign in."],
            ["Authenticator required", "Settings → Account Security and complete two-factor. You cannot skip this if policy requires it."],
        ],
        col_twips=[3510, 6930],
    )

    # ── 18 FAQ ────────────────────────────────────────────────────
    add_title(doc, "18. Frequently Asked Questions")
    add_h2(doc, "Why don’t I see Users, Reporting, or CIP Console?")
    add_body(doc, "Those areas are administration. Only accounts with the matching permission see them.")
    add_h2(doc, "Why don’t I see Email?")
    add_body(doc, "Email is for staff with mail access. Clients use Messages instead.")
    add_h2(doc, "Can I turn off the email sign-in code?")
    add_body(
        doc,
        "On a private computer, leave Trust this browser checked so this browser skips the code for the trust period. A new browser, phone, or cleared cookies will ask again.",
    )
    add_h2(doc, "What is the difference between Save as draft and Add?")
    add_body(
        doc,
        "Save as draft keeps a CIP intake in Draft. Add files the application into New Applications after required information is present.",
    )
    add_h2(doc, "Who do I contact if something is wrong?")
    add_body(
        doc,
        "Email support@tmantoine.com. Privacy questions may use portal@tmantoinelaw.com. A phone number for the helpdesk is not published in the portal. [Information Required] if your firm uses a different internal contact.",
    )

    # ── 19 Support ────────────────────────────────────────────────
    add_title(doc, "19. Support")
    add_table(
        doc,
        ["Item", "Detail"],
        [
            ["Portal", "https://portal.tmantoinelaw.com"],
            ["Support email", "support@tmantoine.com"],
            ["Privacy contact", "portal@tmantoinelaw.com"],
            ["Phone / hours", "[Information Required]"],
        ],
    )
    add_body(
        doc,
        "When you write to support, include the page you were on, the account email, the application number if it is a CIP file, and what you clicked. Do not send sign-in codes or authenticator codes.",
    )

    add_body(
        doc,
        "End of guide.",
    )

    append_thankyou(doc, thankyou)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(OUT))
    force_fonts_in_package(OUT)
    print("wrote", OUT, "size", OUT.stat().st_size)


if __name__ == "__main__":
    build()
