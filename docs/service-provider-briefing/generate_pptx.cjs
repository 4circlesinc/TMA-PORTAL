#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");

const ROOT = __dirname;
const ASSETS = path.join(ROOT, "assets");
const OUT = path.join(ROOT, "..", "TM-ANTOINE-Service-Provider-Webinar.pptx");

const NAVY = "0E2841";
const GOLD = "C4A35A";
const WHITE = "FFFFFF";
const INK = "1A1A1A";
const MUTED = "5A6570";
const CARD = "F4F6F8";
const FOG = "D5D8DC";

const FONT = "Calibri";
const TITLE_FONT = "Cambria";

function img(name) {
  return path.join(ASSETS, name);
}

const pres = new PptxGenJS();
pres.defineLayout({ name: "WIDE_TMA", width: 13.333, height: 7.5 });
pres.layout = "WIDE_TMA";
pres.author = "TM ANTOINE Partners & Advisors";
pres.title = "Service Provider Portal Briefing";
pres.subject = "Security, access, and support for the TM ANTOINE Advisory Portal";

function footer(slide, page, total) {
  slide.addText("TM ANTOINE Advisory Portal  ·  Confidential  ·  22 September 2026", {
    x: 0.55,
    y: 7.12,
    w: 10.2,
    h: 0.22,
    fontFace: FONT,
    fontSize: 10,
    color: MUTED,
    margin: 0,
    isTextBox: true,
  });
  slide.addText(String(page) + "  /  " + String(total), {
    x: 11.5,
    y: 7.12,
    w: 1.3,
    h: 0.22,
    fontFace: FONT,
    fontSize: 10,
    color: MUTED,
    align: "right",
    margin: 0,
    isTextBox: true,
  });
}

function lightSlide() {
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: WHITE },
    line: { color: WHITE },
  });
  return s;
}

function darkSlide() {
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: NAVY },
    line: { color: NAVY },
  });
  return s;
}

const TOTAL = 16;

// 1 Title
{
  const s = darkSlide();
  s.addText("SERVICE PROVIDER BRIEFING", {
    x: 0.7,
    y: 1.55,
    w: 12,
    h: 0.35,
    fontFace: FONT,
    fontSize: 14,
    color: GOLD,
    charSpacing: 3,
    margin: 0,
    isTextBox: true,
  });
  s.addText("How we protect the portal\nyou will work in", {
    x: 0.7,
    y: 2.05,
    w: 11.5,
    h: 2.1,
    fontFace: TITLE_FONT,
    fontSize: 40,
    color: WHITE,
    margin: 0,
    isTextBox: true,
  });
  s.addText(
    "TM ANTOINE Advisory Portal   ·   Built in-house   ·   portal.tmantoinelaw.com",
    {
      x: 0.7,
      y: 4.5,
      w: 11.5,
      h: 0.4,
      fontFace: FONT,
      fontSize: 16,
      color: "C9D3DC",
      margin: 0,
      isTextBox: true,
    }
  );
  s.addText("Webinar handout  ·  22 September 2026  ·  Version 1.0", {
    x: 0.7,
    y: 6.55,
    w: 11.5,
    h: 0.3,
    fontFace: FONT,
    fontSize: 14,
    color: GOLD,
    margin: 0,
    isTextBox: true,
  });
}

// 2 Agenda
{
  const s = lightSlide();
  s.addText("What we will cover", {
    x: 0.55,
    y: 0.4,
    w: 12,
    h: 0.55,
    fontFace: TITLE_FONT,
    fontSize: 32,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  const items = [
    ["01", "Who we are on the internet", "The live domain, the staging mailbox, built in-house."],
    ["02", "Who may enter", "Four access types. Invitation is not enough."],
    ["03", "How we lock the door", "Codes today. Authenticator after this session."],
    ["04", "Files, copies, encryption", "PDF and images. Three copies. Plain-English encryption."],
    ["05", "Help when it breaks", "Bespoke AI, Messages, support@tmantoinelaw.com."],
    ["06", "Answers for your file", "The questions compliance teams have already sent."],
  ];
  items.forEach((row, i) => {
    const col = i % 2;
    const r = Math.floor(i / 2);
    const x = 0.55 + col * 6.35;
    const y = 1.2 + r * 1.75;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 6.05,
      h: 1.55,
      fill: { color: CARD },
      rectRadius: 0.08,
    });
    s.addText(row[0], {
      x: x + 0.25,
      y: y + 0.22,
      w: 1.1,
      h: 0.4,
      fontFace: FONT,
      fontSize: 18,
      color: GOLD,
      bold: true,
      margin: 0,
      isTextBox: true,
    });
    s.addText(row[1], {
      x: x + 1.4,
      y: y + 0.22,
      w: 4.35,
      h: 0.4,
      fontFace: FONT,
      fontSize: 18,
      color: NAVY,
      bold: true,
      margin: 0,
      isTextBox: true,
    });
    s.addText(row[2], {
      x: x + 1.4,
      y: y + 0.72,
      w: 4.35,
      h: 0.55,
      fontFace: FONT,
      fontSize: 14,
      color: MUTED,
      margin: 0,
      isTextBox: true,
    });
  });
  footer(s, 2, TOTAL);
}

// 3 Authenticity
{
  const s = lightSlide();
  s.addText("This is the real portal", {
    x: 0.55,
    y: 0.4,
    w: 12,
    h: 0.5,
    fontFace: TITLE_FONT,
    fontSize: 32,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  s.addText("One firm. Two addresses that used to confuse people. Live work is only on tmantoinelaw.com.", {
    x: 0.55,
    y: 1.0,
    w: 12.2,
    h: 0.4,
    fontFace: FONT,
    fontSize: 16,
    color: MUTED,
    margin: 0,
    isTextBox: true,
  });
  const boxes = [
    ["Use these", NAVY, WHITE, GOLD, [
      "portal.tmantoinelaw.com",
      "portal@tmantoinelaw.com",
      "support@tmantoinelaw.com",
    ]],
    ["Staging — do not use", CARD, NAVY, MUTED, [
      "support@tmantoine.com",
      "was the staging mailbox",
      "not the live contact",
    ]],
  ];
  boxes.forEach((b, i) => {
    const x = 0.55 + i * 6.35;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.6,
      w: 6.05,
      h: 3.55,
      fill: { color: b[1] },
      rectRadius: 0.08,
    });
    s.addText(b[0], {
      x: x + 0.35,
      y: 1.85,
      w: 5.35,
      h: 0.4,
      fontFace: FONT,
      fontSize: 14,
      color: b[3],
      charSpacing: 1,
      margin: 0,
      isTextBox: true,
    });
    s.addText(b[4].map((line) => ({ text: line, options: { breakLine: true } })), {
      x: x + 0.35,
      y: 2.45,
      w: 5.35,
      h: 2.3,
      fontFace: FONT,
      fontSize: 22,
      color: b[2],
      paraSpaceAfter: 10,
      margin: 0,
      isTextBox: true,
    });
  });
  s.addText("Built in-house. Not a white-label product. There is no underlying portal vendor to name.", {
    x: 0.55,
    y: 5.4,
    w: 12.2,
    h: 0.45,
    fontFace: FONT,
    fontSize: 16,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  s.addText("If the address bar is not portal.tmantoinelaw.com, stop. Write to support before you type a code.", {
    x: 0.55,
    y: 5.95,
    w: 12.2,
    h: 0.4,
    fontFace: FONT,
    fontSize: 15,
    italic: true,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  footer(s, 3, TOTAL);
}

// 4 Access types
{
  const s = lightSlide();
  s.addText("Four kinds of access", {
    x: 0.55,
    y: 0.35,
    w: 12,
    h: 0.5,
    fontFace: TITLE_FONT,
    fontSize: 32,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  if (fs.existsSync(img("chart-access.png"))) {
    s.addImage({ path: img("chart-access.png"), x: 0.45, y: 0.95, w: 8.3, h: 3.4 });
  }
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 8.9,
    y: 1.15,
    w: 3.9,
    h: 3.2,
    fill: { color: NAVY },
    rectRadius: 0.08,
  });
  s.addText("Your firm uses two", {
    x: 9.15,
    y: 1.4,
    w: 3.4,
    h: 0.4,
    fontFace: FONT,
    fontSize: 14,
    color: GOLD,
    margin: 0,
    isTextBox: true,
  });
  s.addText("Service provider — works every CIP file for the company, not only ones they created.\n\nService provider admin — invites and removes people at your firm. TM ANTOINE still approves each new account.", {
    x: 9.15,
    y: 1.9,
    w: 3.4,
    h: 2.2,
    fontFace: FONT,
    fontSize: 14,
    color: WHITE,
    margin: 0,
    isTextBox: true,
  });
  s.addText("CRO / reviewing officer and Administrator belong to TM ANTOINE. No service-provider person is a portal administrator.", {
    x: 0.55,
    y: 4.7,
    w: 12.2,
    h: 0.7,
    fontFace: FONT,
    fontSize: 16,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  if (fs.existsSync(img("chart-account-flow.png"))) {
    s.addImage({ path: img("chart-account-flow.png"), x: 0.45, y: 5.35, w: 12.4, h: 1.55 });
  }
  footer(s, 4, TOTAL);
}

// 5 Sign-in
{
  const s = lightSlide();
  s.addText("Sign-in today  ·  authenticator after this session", {
    x: 0.55,
    y: 0.35,
    w: 12.2,
    h: 0.5,
    fontFace: TITLE_FONT,
    fontSize: 28,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.55,
    y: 1.05,
    w: 6.05,
    h: 5.55,
    fill: { color: CARD },
    rectRadius: 0.08,
  });
  s.addText("NOW", {
    x: 0.85,
    y: 1.25,
    w: 5.45,
    h: 0.3,
    fontFace: FONT,
    fontSize: 13,
    color: GOLD,
    bold: true,
    margin: 0,
    isTextBox: true,
  });
  s.addText("A dual check", {
    x: 0.85,
    y: 1.6,
    w: 5.45,
    h: 0.4,
    fontFace: FONT,
    fontSize: 22,
    color: NAVY,
    bold: true,
    margin: 0,
    isTextBox: true,
  });
  s.addText("First sign-in from a known setup uses email. If the device changes, a six-digit code is sent only to the address already on the account. Nobody can redirect that code.", {
    x: 0.85,
    y: 2.15,
    w: 5.45,
    h: 1.5,
    fontFace: FONT,
    fontSize: 16,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  if (fs.existsSync(img("03-login-code.png"))) {
    s.addImage({ path: img("03-login-code.png"), x: 1.15, y: 3.7, w: 4.85, h: 2.55 });
  }
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 6.85,
    y: 1.05,
    w: 5.95,
    h: 5.55,
    fill: { color: NAVY },
    rectRadius: 0.08,
  });
  s.addText("AFTER THIS WEBINAR", {
    x: 7.15,
    y: 1.25,
    w: 5.35,
    h: 0.3,
    fontFace: FONT,
    fontSize: 13,
    color: GOLD,
    bold: true,
    margin: 0,
    isTextBox: true,
  });
  s.addText("Authenticator required", {
    x: 7.15,
    y: 1.6,
    w: 5.35,
    h: 0.45,
    fontFace: FONT,
    fontSize: 22,
    color: WHITE,
    bold: true,
    margin: 0,
    isTextBox: true,
  });
  s.addText("Every service-provider account will connect an authenticator app. A new six-digit number every thirty seconds, on your phone. Password plus email is no longer enough.", {
    x: 7.15,
    y: 2.2,
    w: 5.35,
    h: 1.55,
    fontFace: FONT,
    fontSize: 16,
    color: WHITE,
    margin: 0,
    isTextBox: true,
  });
  s.addText("Settings  →  Account Security  →  Authenticator app  →  scan the QR code. Keep recovery codes offline. Never send a code in chat.", {
    x: 7.15,
    y: 3.95,
    w: 5.35,
    h: 2.1,
    fontFace: FONT,
    fontSize: 16,
    color: "C9D3DC",
    margin: 0,
    isTextBox: true,
  });
  footer(s, 5, TOTAL);
}

// 6 Geography
{
  const s = lightSlide();
  s.addText("The portal is not open to the whole map", {
    x: 0.55,
    y: 0.4,
    w: 12.2,
    h: 0.55,
    fontFace: TITLE_FONT,
    fontSize: 30,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  s.addText("We keep the countries where our service-provider clients operate. We refuse the rest, including North Korea, South Korea, and Russia. The country is read at the edge, before sign-in.", {
    x: 0.55,
    y: 1.1,
    w: 12.2,
    h: 0.85,
    fontFace: FONT,
    fontSize: 18,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  const pills = [
    ["Allowed", "Countries where our provider firms actually work"],
    ["Refused", "North Korea, South Korea, Russia, and other non-client locations"],
    ["VPN", "Anonymising proxies can be refused — turn them off if the page asks"],
  ];
  pills.forEach((p, i) => {
    const y = 2.2 + i * 1.35;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.55,
      y,
      w: 12.2,
      h: 1.18,
      fill: { color: i === 1 ? NAVY : CARD },
      rectRadius: 0.08,
    });
    s.addText(p[0], {
      x: 0.85,
      y: y + 0.35,
      w: 2.2,
      h: 0.45,
      fontFace: FONT,
      fontSize: 18,
      bold: true,
      color: i === 1 ? GOLD : NAVY,
      margin: 0,
      isTextBox: true,
    });
    s.addText(p[1], {
      x: 3.3,
      y: y + 0.35,
      w: 9.1,
      h: 0.5,
      fontFace: FONT,
      fontSize: 18,
      color: i === 1 ? WHITE : INK,
      margin: 0,
      isTextBox: true,
    });
  });
  footer(s, 6, TOTAL);
}

// 7 Layers
{
  const s = lightSlide();
  s.addText("Six layers, not one lock", {
    x: 0.55,
    y: 0.35,
    w: 12,
    h: 0.5,
    fontFace: TITLE_FONT,
    fontSize: 32,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  if (fs.existsSync(img("chart-layers.png"))) {
    s.addImage({ path: img("chart-layers.png"), x: 0.4, y: 0.95, w: 12.5, h: 5.7 });
  }
  footer(s, 7, TOTAL);
}

// 8 Encryption
{
  const s = lightSlide();
  s.addText("Encryption, in ordinary words", {
    x: 0.55,
    y: 0.35,
    w: 12,
    h: 0.5,
    fontFace: TITLE_FONT,
    fontSize: 32,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  if (fs.existsSync(img("chart-encryption.png"))) {
    s.addImage({ path: img("chart-encryption.png"), x: 0.45, y: 1.0, w: 12.4, h: 4.55 });
  }
  s.addText("Intercepting tools on the network can see that traffic exists. They cannot read it. API keys never leave the server. Bespoke AI cannot see them.", {
    x: 0.55,
    y: 5.7,
    w: 12.2,
    h: 0.7,
    fontFace: FONT,
    fontSize: 16,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  footer(s, 8, TOTAL);
}

// 9 Uploads
{
  const s = lightSlide();
  s.addText("What may be uploaded", {
    x: 0.55,
    y: 0.4,
    w: 12,
    h: 0.5,
    fontFace: TITLE_FONT,
    fontSize: 32,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  const stats = [
    ["PDF or image", "CIP files. The portal reads the bytes, not just the name."],
    ["5–10 MB", "Public upload links. No room for a giant hidden payload."],
    ["Malware scan", "A failed scan cannot be opened or downloaded."],
  ];
  stats.forEach((row, i) => {
    const x = 0.55 + i * 4.2;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.15,
      w: 3.95,
      h: 3.5,
      fill: { color: i === 1 ? NAVY : CARD },
      rectRadius: 0.08,
    });
    s.addText(row[0], {
      x: x + 0.25,
      y: 1.5,
      w: 3.45,
      h: 1.3,
      fontFace: TITLE_FONT,
      fontSize: 28,
      color: i === 1 ? WHITE : NAVY,
      margin: 0,
      isTextBox: true,
    });
    s.addText(row[1], {
      x: x + 0.25,
      y: 3.0,
      w: 3.45,
      h: 1.3,
      fontFace: FONT,
      fontSize: 16,
      color: i === 1 ? "C9D3DC" : MUTED,
      margin: 0,
      isTextBox: true,
    });
  });
  s.addText("A renamed program posing as a PDF is refused. Do not zip software into an application folder.", {
    x: 0.55,
    y: 4.9,
    w: 12.2,
    h: 0.55,
    fontFace: FONT,
    fontSize: 16,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  s.addText("We are still hardening this door. Size limits and type checks are in place. Independent testing is still to come.", {
    x: 0.55,
    y: 5.5,
    w: 12.2,
    h: 0.7,
    fontFace: FONT,
    fontSize: 16,
    italic: true,
    color: MUTED,
    margin: 0,
    isTextBox: true,
  });
  footer(s, 9, TOTAL);
}

// 10 Hosting + backup
{
  const s = lightSlide();
  s.addText("Where it lives  ·  how it comes back", {
    x: 0.55,
    y: 0.35,
    w: 12.2,
    h: 0.5,
    fontFace: TITLE_FONT,
    fontSize: 30,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  s.addText("Application and database run together on Laravel Cloud (AWS, United States). Cloudflare in front. Documents in a private store, mirrored to Microsoft 365.", {
    x: 0.55,
    y: 0.95,
    w: 12.2,
    h: 0.7,
    fontFace: FONT,
    fontSize: 16,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  if (fs.existsSync(img("chart-backup.png"))) {
    s.addImage({ path: img("chart-backup.png"), x: 0.3, y: 1.65, w: 6.6, h: 4.7 });
  }
  const lines = [
    ["Portal + R2", "The files you open while you work."],
    ["SharePoint", "If the portal is down, the document set is still in Microsoft 365."],
    ["Daily backup", "A once-a-day copy of the site with the host."],
    ["Audit log", "Who did what, and when. Not editable by users."],
  ];
  lines.forEach((row, i) => {
    const y = 1.75 + i * 1.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 7.1,
      y,
      w: 5.65,
      h: 1.02,
      fill: { color: CARD },
      rectRadius: 0.08,
    });
    s.addText(row[0], {
      x: 7.35,
      y: y + 0.12,
      w: 5.2,
      h: 0.32,
      fontFace: FONT,
      fontSize: 16,
      bold: true,
      color: NAVY,
      margin: 0,
      isTextBox: true,
    });
    s.addText(row[1], {
      x: 7.35,
      y: y + 0.48,
      w: 5.2,
      h: 0.4,
      fontFace: FONT,
      fontSize: 14,
      color: MUTED,
      margin: 0,
      isTextBox: true,
    });
  });
  footer(s, 10, TOTAL);
}

// 11 Bespoke AI
{
  const s = lightSlide();
  s.addText("Ask Bespoke AI first", {
    x: 0.55,
    y: 0.4,
    w: 12,
    h: 0.5,
    fontFace: TITLE_FONT,
    fontSize: 32,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  s.addText("It knows this portal. Workflows, missing fields, who to write to. It does not know other firms' files. It does not know API keys.", {
    x: 0.55,
    y: 1.05,
    w: 12.2,
    h: 0.7,
    fontFace: FONT,
    fontSize: 18,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  const asks = [
    ["Workflow", "How does Pre-Approval move from one step to the next?"],
    ["This file", "What is still missing on the application I have open?"],
    ["People", "Who do I speak with if the portal errors?"],
    ["Never", "Do not paste passwords or authenticator codes into the assistant."],
  ];
  asks.forEach((row, i) => {
    const col = i % 2;
    const r = Math.floor(i / 2);
    const x = 0.55 + col * 6.35;
    const y = 1.95 + r * 2.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 6.05,
      h: 1.95,
      fill: { color: i === 3 ? NAVY : CARD },
      rectRadius: 0.08,
    });
    s.addText(row[0], {
      x: x + 0.3,
      y: y + 0.28,
      w: 5.45,
      h: 0.4,
      fontFace: FONT,
      fontSize: 16,
      bold: true,
      color: i === 3 ? GOLD : NAVY,
      margin: 0,
      isTextBox: true,
    });
    s.addText(row[1], {
      x: x + 0.3,
      y: y + 0.8,
      w: 5.45,
      h: 0.8,
      fontFace: FONT,
      fontSize: 18,
      color: i === 3 ? WHITE : INK,
      margin: 0,
      isTextBox: true,
    });
  });
  footer(s, 11, TOTAL);
}

// 12 Support
{
  const s = lightSlide();
  s.addText("If the portal is the problem", {
    x: 0.55,
    y: 0.35,
    w: 12,
    h: 0.5,
    fontFace: TITLE_FONT,
    fontSize: 32,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.55,
    y: 1.05,
    w: 12.2,
    h: 1.55,
    fill: { color: NAVY },
    rectRadius: 0.08,
  });
  s.addText("support@tmantoinelaw.com", {
    x: 0.85,
    y: 1.25,
    w: 11.6,
    h: 0.55,
    fontFace: TITLE_FONT,
    fontSize: 32,
    color: WHITE,
    margin: 0,
    isTextBox: true,
  });
  s.addText("Shared with TM ANTOINE administrators. Target reply: within an hour, pending availability. Primary contact: Vernon Francis.", {
    x: 0.85,
    y: 1.85,
    w: 11.6,
    h: 0.5,
    fontFace: FONT,
    fontSize: 16,
    color: "C9D3DC",
    margin: 0,
    isTextBox: true,
  });
  const people = [
    ["Vernon Francis", "Primary technical contact"],
    ["Cindy McLean", "Administrator  ·  email or Messages"],
    ["Emmanuel McLean", "Administrator  ·  email or Messages"],
    ["Krishna Manru", "Administrator  ·  email or Messages"],
  ];
  people.forEach((p, i) => {
    const x = 0.55 + (i % 4) * 3.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 2.9,
      w: 3.0,
      h: 2.15,
      fill: { color: CARD },
      rectRadius: 0.08,
    });
    s.addText(p[0], {
      x: x + 0.18,
      y: 3.15,
      w: 2.64,
      h: 0.9,
      fontFace: FONT,
      fontSize: 18,
      bold: true,
      color: NAVY,
      margin: 0,
      isTextBox: true,
    });
    s.addText(p[1], {
      x: x + 0.18,
      y: 4.15,
      w: 2.64,
      h: 0.65,
      fontFace: FONT,
      fontSize: 13,
      color: MUTED,
      margin: 0,
      isTextBox: true,
    });
  });
  s.addText("Say the page, the account email, and the CIP number. Never send a sign-in or authenticator code.", {
    x: 0.55,
    y: 5.3,
    w: 12.2,
    h: 0.45,
    fontFace: FONT,
    fontSize: 16,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  if (fs.existsSync(img("11-messages.png"))) {
    s.addText("Messages inside the portal is equally valid when you can still sign in.", {
      x: 0.55,
      y: 5.8,
      w: 12.2,
      h: 0.35,
      fontFace: FONT,
      fontSize: 15,
      italic: true,
      color: MUTED,
      margin: 0,
      isTextBox: true,
    });
  }
  footer(s, 12, TOTAL);
}

// 13 FAQ security
{
  const s = lightSlide();
  s.addText("On your compliance file  ·  security", {
    x: 0.55,
    y: 0.3,
    w: 12.2,
    h: 0.45,
    fontFace: TITLE_FONT,
    fontSize: 28,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  const rows = [
    ["Host", "Laravel Cloud on AWS, United States, plus Cloudflare."],
    ["Encryption", "TLS in transit. Ciphertext at rest in the vault and R2."],
    ["MFA", "Email code on a new device now. Authenticator required after this webinar."],
    ["Company members", "See every application for the company, not only their own."],
    ["Testing / ISO / SOC 2", "Independent testing planned, not yet complete. No ISO 27001 or SOC 2 today."],
    ["Backup", "Portal store, SharePoint mirror, daily host backup."],
    ["Audit", "Who did what, when, including document activity."],
  ];
  rows.forEach((row, i) => {
    const y = 0.85 + i * 0.8;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.55,
      y,
      w: 12.2,
      h: 0.72,
      fill: { color: i % 2 === 0 ? CARD : WHITE },
      rectRadius: 0.06,
    });
    s.addText(row[0], {
      x: 0.75,
      y: y + 0.18,
      w: 3.1,
      h: 0.38,
      fontFace: FONT,
      fontSize: 15,
      bold: true,
      color: NAVY,
      margin: 0,
      isTextBox: true,
    });
    s.addText(row[1], {
      x: 4.0,
      y: y + 0.18,
      w: 8.5,
      h: 0.4,
      fontFace: FONT,
      fontSize: 15,
      color: INK,
      margin: 0,
      isTextBox: true,
    });
  });
  footer(s, 13, TOTAL);
}

// 14 FAQ data
{
  const s = lightSlide();
  s.addText("On your compliance file  ·  data", {
    x: 0.55,
    y: 0.35,
    w: 12.2,
    h: 0.5,
    fontFace: TITLE_FONT,
    fontSize: 28,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  const blocks = [
    ["DPA", "Yes — pending review by our legal team. Your paper or ours."],
    ["Transfers", "Only what CIU, NIC, and Immigration need. Same practice as before the portal. SCCs where legal review says they apply."],
    ["Retention", "We keep the file unless the applicant asks us to delete it after the case is closed."],
    ["Sub-processors", "AWS / Laravel Cloud (USA), Cloudflare including R2, Microsoft 365 / SharePoint."],
    ["Breach", "Playbook being finalised. Confirmed personal-data incidents: notify affected firms without delay."],
    ["Staff leaving", "Your admin removes them that day. TM ANTOINE is notified. We still approve every new account."],
  ];
  blocks.forEach((row, i) => {
    const col = i % 2;
    const r = Math.floor(i / 2);
    const x = 0.55 + col * 6.35;
    const y = 1.05 + r * 1.85;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 6.05,
      h: 1.68,
      fill: { color: CARD },
      rectRadius: 0.08,
    });
    s.addText(row[0], {
      x: x + 0.28,
      y: y + 0.2,
      w: 5.5,
      h: 0.35,
      fontFace: FONT,
      fontSize: 16,
      bold: true,
      color: GOLD,
      margin: 0,
      isTextBox: true,
    });
    s.addText(row[1], {
      x: x + 0.28,
      y: y + 0.6,
      w: 5.5,
      h: 0.9,
      fontFace: FONT,
      fontSize: 15,
      color: INK,
      margin: 0,
      isTextBox: true,
    });
  });
  footer(s, 14, TOTAL);
}

// 15 After the webinar
{
  const s = lightSlide();
  s.addText("After this session", {
    x: 0.55,
    y: 0.4,
    w: 12,
    h: 0.5,
    fontFace: TITLE_FONT,
    fontSize: 32,
    color: NAVY,
    margin: 0,
    isTextBox: true,
  });
  const steps = [
    ["1", "Name your service-provider administrator if you have not."],
    ["2", "Connect an authenticator app on every account you will use."],
    ["3", "Bookmark portal.tmantoinelaw.com. Treat any other host as suspect."],
    ["4", "Use Bespoke AI for how-the-screen-works questions."],
    ["5", "Use support@tmantoinelaw.com or Messages for faults — never for codes."],
    ["6", "File this briefing with your compliance papers."],
  ];
  steps.forEach((row, i) => {
    const y = 1.1 + i * 0.88;
    s.addShape(pres.shapes.OVAL, {
      x: 0.55,
      y: y + 0.08,
      w: 0.55,
      h: 0.55,
      fill: { color: NAVY },
    });
    s.addText(row[0], {
      x: 0.55,
      y: y + 0.16,
      w: 0.55,
      h: 0.4,
      fontFace: FONT,
      fontSize: 16,
      bold: true,
      color: WHITE,
      align: "center",
      margin: 0,
      isTextBox: true,
    });
    s.addText(row[1], {
      x: 1.35,
      y: y + 0.12,
      w: 11.3,
      h: 0.5,
      fontFace: FONT,
      fontSize: 20,
      color: INK,
      margin: 0,
      isTextBox: true,
    });
  });
  footer(s, 15, TOTAL);
}

// 16 Close
{
  const s = darkSlide();
  s.addText("We would rather walk it through\nthan leave a gap on your file.", {
    x: 0.7,
    y: 1.7,
    w: 12,
    h: 1.8,
    fontFace: TITLE_FONT,
    fontSize: 32,
    color: WHITE,
    margin: 0,
    isTextBox: true,
  });
  s.addText("support@tmantoinelaw.com", {
    x: 0.7,
    y: 3.8,
    w: 12,
    h: 0.55,
    fontFace: FONT,
    fontSize: 24,
    color: GOLD,
    margin: 0,
    isTextBox: true,
  });
  s.addText("Vernon Francis  ·  Cindy McLean  ·  Emmanuel McLean  ·  Krishna Manru", {
    x: 0.7,
    y: 4.5,
    w: 12,
    h: 0.4,
    fontFace: FONT,
    fontSize: 16,
    color: "C9D3DC",
    margin: 0,
    isTextBox: true,
  });
  s.addText("A written copy of this briefing will follow by email.", {
    x: 0.7,
    y: 5.9,
    w: 12,
    h: 0.4,
    fontFace: FONT,
    fontSize: 16,
    italic: true,
    color: WHITE,
    margin: 0,
    isTextBox: true,
  });
}

pres.writeFile({ fileName: OUT }).then(() => {
  console.log("wrote", OUT);
});
