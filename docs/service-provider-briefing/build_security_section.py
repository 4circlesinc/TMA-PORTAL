"""Rebuild the SECURITY TALKING POINTS pages of the webinar plan.

The section starts on its own page after the preparation timeline and is written
as short bullets a partner can read aloud. Everything from the old section down
to the closing sectPr is replaced, so the script is safe to re-run.
"""

import copy
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

DOC = Path(__file__).resolve().parents[1] / "Webinar-Plan-TMA-Portal.docx"

# numId 3 is the plain Symbol bullet already defined in this document.
BULLET_NUM_ID = 3

SECTION = [
    ("h1", "SECURITY TALKING POINTS"),
    ("p", "Say this in plain English. Short lines. Stop after each block and ask if it is clear."),
    ("p", "This is not a technical lecture. It is so a partner or a case handler can repeat it to a client."),

    ("h2", "The short version"),
    ("b", "The portal is built for confidential client work. That is what it is for."),
    ("b", "Heavy security is already in place: approved accounts only, two checks at sign-in, country limits, filtered traffic, locked files, scanned uploads, and a log of every action."),
    ("b", "It is ready to hold and work on confidential information today."),
    ("b", "Built in-house by TM ANTOINE. Not a rented or white-label product."),
    ("b", "Live site: portal.tmantoinelaw.com. Live mail: portal@tmantoinelaw.com and support@tmantoinelaw.com."),
    ("b", "support@tmantoine.com was staging. Do not use it."),
    ("b", "If the address bar is not portal.tmantoinelaw.com, stop. Email support before anyone types a password or a code."),

    ("h2", "Who can enter the portal"),
    ("b", "There are four kinds of access. Your firm only ever holds the first two."),
    ("b", "Service provider — a named person at your firm. Works every CIP file that belongs to your company, not only the ones they created."),
    ("b", "Service provider admin — the person your firm names to us. Invites colleagues and removes them when someone leaves."),
    ("b", "CRO / reviewing officer — a TM ANTOINE officer who reviews files. Not your staff."),
    ("b", "Administrator — TM ANTOINE only. Approves new accounts and holds firm-wide settings. No service-provider person is one."),

    ("h2", "How a person at your firm gets an account"),
    ("b", "Nobody reaches the portal until TM ANTOINE approves the account."),
    ("b", "Step 1: your service-provider admin invites the person."),
    ("b", "Step 2: the person accepts the invitation."),
    ("b", "Step 3: TM ANTOINE still has to approve it."),
    ("b", "Step 4: only then can they sign in."),
    ("b", "An invitation on its own is not enough. That second human check is on purpose."),
    ("b", "When someone leaves your firm, your admin removes them that day. We are notified."),

    ("h2", "How sign-in works today, and what changes after this webinar"),
    ("b", "Today: if the device changes, the portal sends a six-digit code."),
    ("b", "That code goes only to the email already on the account. Never to a new address someone types in."),
    ("b", "After this webinar: every service-provider account must connect an authenticator app — Google Authenticator, Microsoft Authenticator, or Authy."),
    ("b", "A password plus an email will no longer be enough. Without the phone, nobody gets in."),
    ("b", "Set it up in Settings → Account Security → Two-factor authentication."),
    ("b", "Keep the recovery codes offline. They are the only way back in if the phone is lost."),
    ("b", "Never send a sign-in code in chat, in email, or to the assistant. Support will never ask for one."),
    ("b", "Cloudflare Turnstile sits on the sign-in door so automated guessing is stopped early."),
    ("b", "Sign-in is rate-limited: about five tries a minute for a given email and network."),
    ("b", "Trusted devices and other sessions can be ended from Settings → Account Security."),

    ("h2", "Where the portal may be used"),
    ("b", "Access is limited to countries where our service-provider clients actually work."),
    ("b", "North Korea, South Korea and Russia are among the places that cannot reach it."),
    ("b", "The country is read before a session is created, so a refused visitor never reaches sign-in."),
    ("b", "If the page asks you to turn a VPN off, do that. That is the control working, not a fault."),

    ("h2", "How the connection and the files are protected"),
    ("b", "On the way: the lock in the browser (https). Someone watching the network cannot read the pages or the files."),
    ("b", "At rest: vault files and call recordings are stored locked, not as open files on a disk."),
    ("b", "In the fields: passport numbers and dates of birth are encrypted in the database itself."),
    ("b", "API keys and secrets stay on the server. Not in the browser. Not in Bespoke AI."),
    ("b", "Hostile traffic and automated scanners are filtered at the edge before they reach the application."),
    ("b", "Pages send browser security headers: CSP, HSTS, framing protections, and related limits."),
    ("b", "Uploaded files are never executed by the web server."),
    ("b", "Every action is checked again on the server. The browser is never trusted to decide who may do what."),
    ("b", "Every action is logged: who, what, when, including who opened a document. Users cannot edit that log."),
    ("b", "Detectors flag impossible travel, address spikes, and download bursts for human review — they do not auto-lock a working account."),

    ("h2", "What may be uploaded"),
    ("b", "CIP files: PDF or photo only."),
    ("b", "We read the file itself, not just the name. A renamed program is refused."),
    ("b", "Public upload links are capped at 5–10 MB. That is a security limit as well as a practical one."),
    ("b", "Every upload is scanned for malware. A file that fails cannot be opened or downloaded."),
    ("b", "Public links to identity documents must carry a password. A forwarded URL alone is not enough."),
    ("b", "All documents go through the portal. Do not email them."),

    ("h2", "If the portal is down"),
    ("b", "Working files sit in the portal store."),
    ("b", "A live copy sits in Microsoft 365 / SharePoint."),
    ("b", "The host takes a daily backup of the site."),
    ("b", "The application and the database run together in the United States, with Cloudflare in front."),
    ("b", "Call recordings: access is logged, legal hold can stop deletion, past-retention copies without hold are pruned."),

    ("h2", "Bespoke AI"),
    ("b", "Use it. It knows this portal."),
    ("b", "Ask how a step works, or what is still missing on the file you have open."),
    ("b", "It cannot see other firms' files. It cannot see keys."),
    ("b", "Do not paste passwords or authenticator codes into it."),

    ("h2", "If something breaks"),
    ("b", "Email support@tmantoinelaw.com. That mailbox is shared with TM ANTOINE admins."),
    ("b", "Aim: a reply within an hour, if people are available."),
    ("b", "Vernon Francis is the main technical contact."),
    ("b", "If you can still sign in, message Cindy McLean, Emmanuel McLean, Krishna Manru, or Vernon in the portal."),
    ("b", "Send: the page you were on, the account email, the CIP number if there is one, and what you clicked."),
    ("b", "Never send a sign-in code or an authenticator code."),

    ("h2", "Legal and data — if asked"),
    ("b", "We do not claim a GDPR certificate. Where GDPR or a similar regime applies, we support it with a DPA, SCCs where right, documented processors, retention and deletion, and breach notice."),
    ("b", "Host: Laravel Cloud on Amazon Web Services, United States, plus Cloudflare."),
    ("b", "Encrypted in transit, at rest, and at field level for passport numbers and dates of birth."),
    ("b", "Company members see every application for the company, not only their own."),
    ("b", "Data Processing Agreement: yes, pending review by our legal team."),
    ("b", "Data-subject rights: access, correction, and erasure after the case closes, on request."),
    ("b", "Privacy Policy and Terms: on the live portal. New accounts accept both before they work the files."),
    ("b", "We collect only what the applications need."),
    ("b", "We send onwards only what the Citizenship by Investment Unit, NIC and Immigration need — same practice as before the portal."),
    ("b", "We keep the file unless the applicant asks us to delete it after the case is closed."),
    ("b", "Other processors: AWS, Cloudflare (including file storage), Microsoft 365 / SharePoint."),
    ("b", "If personal data is breached, we tell affected firms without delay. The written playbook is being finished."),

    ("h2", "Certification — say this plainly"),
    ("b", "ISO 27001 and SOC 2: we are working on them now. We do not hold them yet."),
    ("b", "We have already tested the portal ourselves: injection, unsafe uploads, and access between accounts."),
    ("b", "A full independent penetration test is under way and not finished."),
    ("b", "We will share the outcome when that work is done."),
    ("b", "None of that changes the answer to the real question: the portal is heavily secured and ready for confidential client files today."),

    ("h2", "What we need from you"),
    ("b", "Name your service-provider administrator if you have not."),
    ("b", "Connect an authenticator app after this session."),
    ("b", "Bookmark portal.tmantoinelaw.com and treat any other host as suspect."),
    ("b", "Use Bespoke AI for “how does this screen work” questions."),
    ("b", "Use support@tmantoinelaw.com or Messages for faults, never for sharing codes."),
]


def find_start(body):
    """Index of the SECURITY TALKING POINTS heading, or of the sectPr if absent."""
    for i, child in enumerate(body):
        if child.tag == qn("w:p") and child.xpath("string(.)").strip() == "SECURITY TALKING POINTS":
            return i
    for i, child in enumerate(body):
        if child.tag == qn("w:sectPr"):
            return i
    return len(body)


def bullet(paragraph):
    """Give a List Paragraph the document's existing Symbol bullet."""
    num_pr = OxmlElement("w:numPr")
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), "0")
    num_id = OxmlElement("w:numId")
    num_id.set(qn("w:val"), str(BULLET_NUM_ID))
    num_pr.append(ilvl)
    num_pr.append(num_id)
    paragraph._p.get_or_add_pPr().append(num_pr)


def build(doc):
    body = doc.element.body
    start = find_start(body)
    sect_pr = body.find(qn("w:sectPr"))

    for child in list(body)[start:]:
        if child is not sect_pr:
            body.remove(child)

    made = []
    for kind, text in SECTION:
        if kind == "h1":
            p = doc.add_paragraph()
            run = p.add_run()
            run.add_break(WD_BREAK.PAGE)
            run = p.add_run(text)
            run.bold = True
        elif kind == "h2":
            p = doc.add_paragraph()
            p.paragraph_format.space_before = doc.styles["Normal"].paragraph_format.space_before
            p.add_run(text).bold = True
        elif kind == "b":
            p = doc.add_paragraph(text, style="List Paragraph")
            bullet(p)
        else:
            p = doc.add_paragraph(text)
        made.append(p)

    # add_paragraph appends after sectPr-free body end; make sure sectPr stays last
    if sect_pr is not None:
        body.remove(sect_pr)
        body.append(sect_pr)

    return made


def main():
    doc = Document(str(DOC))
    made = build(doc)
    doc.save(str(DOC))
    bullets = sum(1 for k, _ in SECTION if k == "b")
    heads = sum(1 for k, _ in SECTION if k == "h2")
    print(f"wrote {len(made)} paragraphs: {heads} blocks, {bullets} bullets -> {DOC}")


if __name__ == "__main__":
    sys.exit(main())
