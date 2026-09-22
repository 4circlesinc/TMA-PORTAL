#!/usr/bin/env python3
"""Figures for the service-provider briefing (Word + slides)."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Circle

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "assets"
OUT.mkdir(parents=True, exist_ok=True)

NAVY = "#0E2841"
INK = "#1A1A1A"
GREY = "#F2F2F2"
MUTED = "#5A6570"
GOLD = "#C4A35A"
WHITE = "#FFFFFF"


def _save(fig, name: str):
    path = OUT / name
    fig.savefig(path, dpi=180, bbox_inches="tight", pad_inches=0.25, facecolor=WHITE)
    plt.close(fig)
    print("wrote", path)


def layers():
    fig, ax = plt.subplots(figsize=(8.4, 4.8))
    ax.set_xlim(0, 10)
    ax.set_ylim(-0.15, 6.35)
    ax.axis("off")
    fig.patch.set_facecolor(WHITE)

    items = [
        (5.0, 5.35, 4.55, "People: invitation + TM ANTOINE approval"),
        (5.0, 4.35, 4.35, "Sign-in: email code, trusted device, authenticator"),
        (5.0, 3.35, 4.15, "Place: countries where our providers operate"),
        (5.0, 2.35, 3.95, "Edge: Cloudflare filters hostile traffic"),
        (5.0, 1.35, 3.75, "Files: type check, size cap, malware scan"),
        (5.0, 0.35, 3.55, "Copies: portal store, SharePoint, daily backup"),
    ]
    for y, (x, yy, w, label) in enumerate(items):
        shade = 0.12 + y * 0.06
        color = plt.cm.Blues(0.85 - shade)
        box = FancyBboxPatch(
            (x - w, yy),
            w * 2,
            0.78,
            boxstyle="round,pad=0.02,rounding_size=0.12",
            facecolor=NAVY if y in (0, 5) else color,
            edgecolor="none",
        )
        ax.add_patch(box)
        tc = WHITE if y in (0, 5) else NAVY
        ax.text(x, yy + 0.39, label, ha="center", va="center", color=tc, fontsize=10, fontweight="medium")

    ax.set_title("Six layers between a visitor and a client file", loc="left", color=NAVY, fontsize=13, pad=8)
    _save(fig, "chart-layers.png")


def backup_pie():
    fig, ax = plt.subplots(figsize=(6.4, 4.6))
    fig.patch.set_facecolor(WHITE)
    sizes = [1, 1, 1]
    labels = [
        "Working files\n(portal + R2)",
        "Microsoft 365\nSharePoint mirror",
        "Daily host\nbackup",
    ]
    colors = [NAVY, GOLD, "#4A6B82"]
    wedges, texts, autotexts = ax.pie(
        sizes,
        labels=labels,
        colors=colors,
        startangle=90,
        wedgeprops={"width": 0.52, "edgecolor": WHITE, "linewidth": 3},
        autopct="",
        textprops={"color": INK, "fontsize": 10},
    )
    ax.text(0, 0, "Three\ncopies", ha="center", va="center", color=NAVY, fontsize=13, fontweight="bold")
    ax.set_title("If the portal is unavailable, files are not in one place", color=NAVY, fontsize=12, pad=12)
    _save(fig, "chart-backup.png")


def access_cards():
    fig, ax = plt.subplots(figsize=(8.4, 3.6))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 4.2)
    ax.axis("off")
    fig.patch.set_facecolor(WHITE)

    cards = [
        ("01", "Service\nprovider", "Works the firm's\nCIP files."),
        ("02", "Service\nprovider admin", "Invites and removes\npeople at the firm."),
        ("03", "CRO /\nreviewing officer", "Reviews files for\nTM ANTOINE."),
        ("04", "Administrator", "Approves accounts\nand firm settings."),
    ]
    for i, (num, title, blurb) in enumerate(cards):
        x = 0.25 + i * 2.45
        box = FancyBboxPatch(
            (x, 0.35),
            2.25,
            3.5,
            boxstyle="round,pad=0.04,rounding_size=0.1",
            facecolor=GREY if i % 2 == 0 else WHITE,
            edgecolor="#D5D8DC",
            linewidth=1,
        )
        ax.add_patch(box)
        ax.text(x + 0.18, 3.35, num, color=GOLD, fontsize=12, fontweight="bold")
        ax.text(x + 0.18, 2.35, title, color=NAVY, fontsize=11, fontweight="bold", va="top")
        ax.text(x + 0.18, 1.15, blurb, color=MUTED, fontsize=9, va="top")
    ax.set_title("Four kinds of portal access", loc="left", color=NAVY, fontsize=13)
    _save(fig, "chart-access.png")


def account_flow():
    fig, ax = plt.subplots(figsize=(8.4, 2.8))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 3.2)
    ax.axis("off")
    fig.patch.set_facecolor(WHITE)

    steps = [
        (1.3, "Your admin\ninvites"),
        (4.3, "Person\naccepts"),
        (7.3, "TM ANTOINE\napproves"),
        (10.3, "Account\ncan sign in"),
    ]
    for i, (x, label) in enumerate(steps):
        c = Circle((x, 1.7), 0.55, facecolor=NAVY, edgecolor="none")
        ax.add_patch(c)
        ax.text(x, 1.7, str(i + 1), ha="center", va="center", color=WHITE, fontsize=14, fontweight="bold")
        ax.text(x, 0.55, label, ha="center", va="top", color=INK, fontsize=10)
        if i < 3:
            ax.annotate(
                "",
                xy=(steps[i + 1][0] - 0.7, 1.7),
                xytext=(x + 0.7, 1.7),
                arrowprops=dict(arrowstyle="-|>", color=GOLD, lw=2),
            )
    ax.set_title("Nobody reaches the portal until TM ANTOINE approves the account", loc="left", color=NAVY, fontsize=12)
    _save(fig, "chart-account-flow.png")


def encryption():
    fig, ax = plt.subplots(figsize=(8.2, 3.4))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 4)
    ax.axis("off")
    fig.patch.set_facecolor(WHITE)

    rows = [
        (NAVY, "On the way", "TLS (https). The journey is sealed. A network sniffer cannot read the pages or files."),
        (GOLD, "At rest", "Files in the vault are stored in ciphertext. Opening them needs the portal's key."),
        ("#4A6B82", "In the app", "API keys and secrets live only on the server. The assistant cannot see them."),
    ]
    for i, (color, title, text) in enumerate(rows):
        y = 2.7 - i * 1.15
        box = FancyBboxPatch((0.2, y), 9.6, 1.0, boxstyle="round,pad=0.03,rounding_size=0.08", facecolor=color, edgecolor="none")
        ax.add_patch(box)
        ax.text(0.5, y + 0.62, title, color=WHITE, fontsize=12, fontweight="bold")
        ax.text(0.5, y + 0.28, text, color=WHITE, fontsize=9)
    _save(fig, "chart-encryption.png")


if __name__ == "__main__":
    layers()
    backup_pie()
    access_cards()
    account_flow()
    encryption()
    print("done")
