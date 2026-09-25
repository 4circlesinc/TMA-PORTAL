#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");

const ROOT = __dirname;
const ASSETS = path.join(ROOT, "assets");
const OUT = path.join(ROOT, "..", "TM-ANTOINE-Service-Provider-Webinar.pptx");

const PRIMARY = "03A5E9";
const PRIMARY_DARK = "136DA0";
const WHITE = "FFFFFF";
const INK = "000000";
const GREY = "F2F2F2";
const MUTED = "666666";
const FONT = "Arial";

function img(name) {
  return path.join(ASSETS, name);
}

const pres = new PptxGenJS();
pres.defineLayout({ name: "WIDE_TMA", width: 13.333, height: 7.5 });
pres.layout = "WIDE_TMA";
pres.author = "TM ANTOINE Partners & Advisors";
pres.title = "Service Provider Portal Briefing";
pres.subject = "Security, access, and support for the TM ANTOINE Advisory Portal";

const TOTAL = 16;
const hdr = {
  fill: { color: GREY },
  color: INK,
  bold: true,
  fontFace: FONT,
  fontSize: 13,
  valign: "middle",
  margin: [6, 8, 6, 8],
};
const odd = {
  fill: { color: WHITE },
  color: INK,
  fontFace: FONT,
  fontSize: 13,
  valign: "middle",
  margin: [6, 8, 6, 8],
};
const even = {
  fill: { color: GREY },
  color: INK,
  fontFace: FONT,
  fontSize: 13,
  valign: "middle",
  margin: [6, 8, 6, 8],
};
const labelCell = {
  ...odd,
  bold: true,
};
const tableOpts = {
  fontFace: FONT,
  color: INK,
  border: [
    { pt: 0, color: WHITE },
    { pt: 0, color: WHITE },
    { pt: 0.5, color: INK },
    { pt: 0, color: WHITE },
  ],
  valign: "middle",
};

function page() {
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: WHITE },
    line: { color: WHITE },
  });
  s.addText("TM ANTOINE Advisory Portal", {
    x: 0.55,
    y: 0.22,
    w: 7.2,
    h: 0.24,
    fontFace: FONT,
    fontSize: 11,
    color: PRIMARY_DARK,
    margin: 0,
    isTextBox: true,
  });
  s.addText("Service Provider Portal Briefing  ·  Confidential", {
    x: 7.5,
    y: 0.22,
    w: 5.3,
    h: 0.24,
    fontFace: FONT,
    fontSize: 11,
    color: MUTED,
    align: "right",
    margin: 0,
    isTextBox: true,
  });
  return s;
}

function heading(s, text) {
  s.addText(text, {
    x: 0.55,
    y: 0.52,
    w: 12.2,
    h: 0.46,
    fontFace: FONT,
    fontSize: 24,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
}

function body(s, text, y, h) {
  s.addText(text, {
    x: 0.55,
    y,
    w: 12.2,
    h: h || 0.7,
    fontFace: FONT,
    fontSize: 15,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
}

function caption(s, text, y) {
  s.addText(text, {
    x: 0.55,
    y,
    w: 12.2,
    h: 0.28,
    fontFace: FONT,
    fontSize: 12,
    italic: true,
    color: PRIMARY_DARK,
    margin: 0,
    isTextBox: true,
  });
}

function footer(s, n) {
  s.addText("Confidential — intended recipients only  ·  22 September 2026  ·  Version 1.0", {
    x: 0.55,
    y: 7.14,
    w: 10.2,
    h: 0.22,
    fontFace: FONT,
    fontSize: 10,
    color: MUTED,
    margin: 0,
    isTextBox: true,
  });
  s.addText(String(n) + "  /  " + String(TOTAL), {
    x: 11.4,
    y: 7.14,
    w: 1.4,
    h: 0.22,
    fontFace: FONT,
    fontSize: 10,
    color: MUTED,
    align: "right",
    margin: 0,
    isTextBox: true,
  });
}

function callout(s, kind, text, y) {
  s.addTable(
    [
      [
        { text: kind, options: { ...labelCell, fill: { color: GREY } } },
        { text: text, options: { ...odd, fill: { color: GREY } } },
      ],
    ],
    {
      ...tableOpts,
      x: 0.55,
      y,
      w: 12.2,
      colW: [1.8, 10.4],
      border: [
        { pt: 0.5, color: INK },
        { pt: 0, color: WHITE },
        { pt: 0.5, color: INK },
        { pt: 0, color: WHITE },
      ],
    }
  );
}

function dataTable(s, headers, rows, y, colW, x) {
  const head = headers.map((h) => ({ text: h, options: hdr }));
  const bodyRows = rows.map((row, i) =>
    row.map((cell, c) => ({
      text: cell,
      options: {
        ...(i % 2 === 1 ? even : odd),
        bold: c === 0,
      },
    }))
  );
  s.addTable([head, ...bodyRows], {
    ...tableOpts,
    x: x == null ? 0.55 : x,
    y,
    w: colW.reduce((a, b) => a + b, 0),
    colW,
  });
}

{
  const s = page();
  heading(s, "Document Control");
  body(
    s,
    "This briefing explains how the TM ANTOINE Advisory Portal is built, who may use it, and how we protect service-provider firms and their clients.",
    1.08,
    0.65
  );
  dataTable(
    s,
    ["Item", "Detail"],
    [
      ["Document title", "Service Provider Portal Briefing"],
      ["Subtitle", "Security, access, and answers for firms using the portal"],
      ["Product", "TM ANTOINE Advisory Portal"],
      ["Host", "https://portal.tmantoinelaw.com"],
      ["Support", "support@tmantoinelaw.com"],
      ["Version / date", "1.0  ·  22 September 2026"],
      ["Prepared for", "Service-provider firms"],
      ["Classification", "Confidential — intended recipients only"],
    ],
    1.8,
    [3.2, 9.0]
  );
  footer(s, 1);
}

{
  const s = page();
  heading(s, "Contents");
  dataTable(
    s,
    ["#", "Section"],
    [
      ["1", "Authenticity and the two domains"],
      ["2", "Who can enter the portal"],
      ["3", "How a person at your firm gets an account"],
      ["4", "Sign-in today, authenticator after this webinar"],
      ["5", "Where the portal may be used"],
      ["6", "How we protect the connection and the files"],
      ["7", "What may be uploaded"],
      ["8", "Where things live, and how they come back"],
      ["9", "Bespoke AI"],
      ["10", "If something goes wrong"],
      ["11", "Questions already asked — security and data"],
      ["12", "What we ask of you after the webinar"],
    ],
    1.12,
    [1.2, 11.0]
  );
  footer(s, 2);
}

{
  const s = page();
  heading(s, "Authenticity and the two domains");
  body(
    s,
    "One firm. Two addresses that used to confuse people. Live work is only on tmantoinelaw.com. The portal is built in-house. There is no white-label vendor to name.",
    1.08,
    0.7
  );
  dataTable(
    s,
    ["You may see", "What it is"],
    [
      ["portal.tmantoinelaw.com", "The live portal. Bookmark this."],
      ["portal@tmantoinelaw.com", "The correct mailbox for portal mail from TM ANTOINE."],
      ["support@tmantoinelaw.com", "Support. Shared with TM ANTOINE administrators."],
      ["support@tmantoine.com", "Used for staging. Do not treat it as the live contact."],
    ],
    1.9,
    [4.0, 8.2]
  );
  callout(
    s,
    "NOTE",
    "If the address bar is not portal.tmantoinelaw.com, stop. Write to support before you type a password or a code.",
    5.5
  );
  footer(s, 3);
}

{
  const s = page();
  heading(s, "Who can enter the portal");
  body(
    s,
    "Four kinds of access. Service-provider people only ever hold the first two. The last two belong to TM ANTOINE.",
    1.05,
    0.5
  );
  if (fs.existsSync(img("chart-access.png"))) {
    s.addImage({ path: img("chart-access.png"), x: 0.55, y: 1.55, w: 12.2, h: 4.85 });
  }
  caption(s, "Figure 1. The four account types. Your firm uses Service provider and Service provider admin.", 6.5);
  footer(s, 4);
}

{
  const s = page();
  heading(s, "How a person at your firm gets an account");
  if (fs.existsSync(img("chart-account-flow.png"))) {
    s.addImage({ path: img("chart-account-flow.png"), x: 0.45, y: 1.0, w: 12.4, h: 2.5 });
  }
  dataTable(
    s,
    ["Access", "In two sentences"],
    [
      [
        "Service provider",
        "A named person at your firm. They can open every CIP application that belongs to your company, not only the ones they created.",
      ],
      [
        "Service provider admin",
        "Invites and removes people at your firm. Cannot register a new firm or promote someone else to this role.",
      ],
      [
        "CRO / reviewing officer",
        "A TM ANTOINE officer who reviews files. They are not a member of your firm.",
      ],
      [
        "Administrator",
        "A TM ANTOINE administrator. Approves new accounts. No service-provider person holds this role.",
      ],
    ],
    3.6,
    [3.2, 9.0]
  );
  footer(s, 5);
}

{
  const s = page();
  heading(s, "How sign-in works today, and what changes");
  body(
    s,
    "Today: a dual check. First sign-in from a known setup uses email. If the device changes, a six-digit code is sent only to the address already on the account.",
    1.05,
    0.65
  );
  if (fs.existsSync(img("03-login-code.png"))) {
    s.addImage({ path: img("03-login-code.png"), x: 0.55, y: 1.75, w: 5.6, h: 3.15 });
  }
  if (fs.existsSync(img("28-two-step.png"))) {
    s.addImage({ path: img("28-two-step.png"), x: 6.5, y: 1.75, w: 6.25, h: 3.15 });
  }
  caption(s, "Figure 2. Email code today.   Figure 3. Settings → Account Security → Authenticator app.", 5.0);
  callout(
    s,
    "SECURITY",
    "After this webinar every service-provider account must connect an authenticator app. Password plus email will no longer be enough. Keep recovery codes offline. Never send a code in chat.",
    5.45
  );
  footer(s, 6);
}

{
  const s = page();
  heading(s, "Where the portal may be used");
  body(
    s,
    "Access is limited to countries where TM ANTOINE's service-provider clients actually operate. The country is read at the network edge, before a session is created.",
    1.08,
    0.7
  );
  dataTable(
    s,
    ["Rule", "What it means"],
    [
      ["Allowed", "Countries where our provider firms actually work."],
      ["Refused", "North Korea, South Korea, Russia, and other non-client locations."],
      ["VPN / proxy", "Anonymising connections can be refused. Turn a VPN off if the page asks."],
    ],
    1.9,
    [3.2, 9.0]
  );
  callout(
    s,
    "NOTE",
    "Geography is one control beside passwords, codes, and roles. It is not the whole of security.",
    4.85
  );
  footer(s, 7);
}

{
  const s = page();
  heading(s, "How we protect the connection and the files");
  if (fs.existsSync(img("chart-layers.png"))) {
    s.addImage({ path: img("chart-layers.png"), x: 0.7, y: 1.1, w: 11.9, h: 5.3 });
  }
  caption(s, "Figure 4. Six layers. None of them is enough on its own.", 6.5);
  footer(s, 8);
}

{
  const s = page();
  heading(s, "Encryption, in ordinary words");
  if (fs.existsSync(img("chart-encryption.png"))) {
    s.addImage({ path: img("chart-encryption.png"), x: 0.55, y: 1.15, w: 12.2, h: 4.3 });
  }
  callout(
    s,
    "HONESTY",
    "Independent testing is planned and has not been completed. We do not hold ISO 27001 or SOC 2. Treat this as a description of what is built, not as a certificate.",
    5.6
  );
  footer(s, 9);
}

{
  const s = page();
  heading(s, "What may be uploaded");
  body(
    s,
    "CIP application uploads are PDF files or images. The portal reads the first bytes of the file. A renamed program posing as a PDF is refused.",
    1.08,
    0.7
  );
  dataTable(
    s,
    ["Rule", "What it means for you"],
    [
      ["PDF or image for CIP", "Do not zip executables into an application folder and hope the name looks harmless."],
      ["5–10 MB on request links", "Split a very large scan rather than sending a 200 MB archive."],
      ["Malware scan", "A file that fails the scan cannot be opened or downloaded."],
    ],
    1.9,
    [3.6, 8.6]
  );
  callout(
    s,
    "NOTE",
    "We are still hardening this door. Size limits and type checks are in place. Independent testing is still to come.",
    5.1
  );
  footer(s, 10);
}

{
  const s = page();
  heading(s, "Where things live, and how they come back");
  body(
    s,
    "The application and its database run together on Laravel Cloud (AWS, United States). Cloudflare in front. Documents in a private store, mirrored to Microsoft 365.",
    1.05,
    0.65
  );
  if (fs.existsSync(img("chart-backup.png"))) {
    s.addImage({ path: img("chart-backup.png"), x: 0.2, y: 1.7, w: 5.7, h: 4.4 });
  }
  dataTable(
    s,
    ["Copy", "What it is for"],
    [
      ["Portal store (R2)", "The files you open while you work. Encrypted at rest."],
      ["Microsoft 365 / SharePoint", "If the portal is down, the document set is still in SharePoint."],
      ["Daily host backup", "A once-a-day copy of the site, for disaster recovery of the application."],
      ["Audit log", "Who did what, and when. Users cannot edit that record."],
    ],
    1.85,
    [2.7, 4.15],
    6.15
  );
  footer(s, 11);
}

{
  const s = page();
  heading(s, "Bespoke AI — use it");
  body(
    s,
    "The portal includes a built-in assistant. It answers questions about this portal: how a workflow moves, which field is required, who to write to. It cannot see other firms' files. It cannot see API keys.",
    1.08,
    0.8
  );
  dataTable(
    s,
    ["Ask it", "Example"],
    [
      ["Workflow", "How does Pre-Approval move from one step to the next?"],
      ["This file", "What is still missing on the application I have open?"],
      ["People", "Who do I speak with if the portal errors?"],
      ["Never", "Do not paste passwords or authenticator codes into the assistant."],
    ],
    2.0,
    [2.6, 9.6]
  );
  callout(
    s,
    "TIP",
    "If you are stuck, ask Bespoke AI before you wait on email. For a true outage, write to support@tmantoinelaw.com.",
    5.5
  );
  footer(s, 12);
}

{
  const s = page();
  heading(s, "If something goes wrong");
  body(
    s,
    "Write to support@tmantoinelaw.com. That mailbox is shared with TM ANTOINE administrators. Target response is within an hour, pending availability. Primary technical contact: Vernon Francis.",
    1.05,
    0.75
  );
  if (fs.existsSync(img("11-messages.png"))) {
    s.addImage({ path: img("11-messages.png"), x: 0.55, y: 1.85, w: 5.7, h: 3.35 });
  }
  dataTable(
    s,
    ["Person", "Role in support"],
    [
      ["Vernon Francis", "Primary technical contact for portal faults."],
      ["Cindy McLean", "Administrator. Email or Messages."],
      ["Emmanuel McLean", "Administrator. Email or Messages."],
      ["Krishna Manru", "Administrator. Email or Messages."],
    ],
    1.85,
    [2.5, 3.9],
    6.5
  );
  caption(s, "Figure 5. Built-in Messages, when you can still sign in.", 5.35);
  callout(
    s,
    "NOTE",
    "Include the page, the account email, and the CIP number. Never include a sign-in code or an authenticator code.",
    5.75
  );
  footer(s, 13);
}

{
  const s = page();
  heading(s, "On your compliance file — security");
  dataTable(
    s,
    ["Question", "Answer"],
    [
      ["Host", "Laravel Cloud on AWS, United States, plus Cloudflare."],
      [
        "Encryption",
        "TLS in transit. Ciphertext at rest in the vault, R2, and call recordings. Passport numbers and dates of birth encrypted in the database.",
      ],
      [
        "MFA / door",
        "Email code on a new device now. Authenticator required after this webinar. Turnstile + five-tries-per-minute throttle. Sessions and trusted devices can be revoked.",
      ],
      ["Browser / edge", "Cloudflare edge filter. CSP, HSTS, framing headers. Uploads never executed by the web server."],
      ["Monitoring", "Sign-in log. Detectors for impossible travel, address spikes, download bursts — human review, not auto-lock."],
      ["Identity shares", "Public links to identity documents require a password."],
      ["Call recordings", "Access logged. Legal hold. Retention prune. Encrypted at rest."],
      ["Company members", "See every application for the company, not only their own."],
      ["Testing / ISO / SOC 2", "Independent testing planned, not yet complete. No ISO 27001 or SOC 2 today."],
      ["Backup", "Portal store, SharePoint mirror, daily host backup."],
      ["Audit", "Who did what, when, including document activity."],
    ],
    1.0,
    [3.3, 8.9]
  );
  footer(s, 14);
}

{
  const s = page();
  heading(s, "On your compliance file — data and GDPR");
  dataTable(
    s,
    ["Question", "Answer"],
    [
      [
        "GDPR certified?",
        "No certificate claimed. Where GDPR or a similar regime applies: DPA, SCCs where right, processors listed, retention/deletion, breach notice.",
      ],
      ["DPA", "Yes — pending review by our legal team. Your paper or ours."],
      [
        "Transfers",
        "Only what CIU, NIC, and Immigration need. Same practice as before the portal.",
      ],
      [
        "Data-subject rights",
        "Access, correction, and erasure after the case closes, on request.",
      ],
      ["Retention", "We keep the file unless the applicant asks us to delete it after the case is closed."],
      [
        "Privacy / Terms",
        "portal.tmantoinelaw.com/privacy-policy/ and /terms-of-service/. Accepted before work starts.",
      ],
      ["Sub-processors", "AWS / Laravel Cloud (USA), Cloudflare including R2, Microsoft 365 / SharePoint."],
      ["Breach", "Playbook being finalised. Confirmed incidents: notify affected firms without delay."],
      ["Staff leaving", "Your admin removes them that day. TM ANTOINE is notified, and still approves every new account."],
    ],
    1.0,
    [3.2, 9.0]
  );
  footer(s, 15);
}

{
  const s = page();
  heading(s, "What we ask of you after the webinar");
  dataTable(
    s,
    ["#", "Action"],
    [
      ["1", "Name your service-provider administrator if you have not."],
      ["2", "Connect an authenticator app on every account you will use."],
      ["3", "Bookmark portal.tmantoinelaw.com. Treat any other host as suspect."],
      ["4", "Use Bespoke AI for how-the-screen-works questions."],
      ["5", "Use support@tmantoinelaw.com or Messages for faults — never for codes."],
      ["6", "File this briefing with your compliance papers."],
    ],
    1.15,
    [1.2, 11.0]
  );
  callout(
    s,
    "TIP",
    "A written copy of this briefing will follow by email. We would rather walk remaining points through on a call than leave a gap on your file.",
    5.55
  );
  footer(s, 16);
}

pres.writeFile({ fileName: OUT }).then(() => {
  console.log("wrote", OUT);
});
