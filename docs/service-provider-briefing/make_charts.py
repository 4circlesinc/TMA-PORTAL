#!/usr/bin/env python3
"""Figures for the service-provider briefing — match User Guide navy/grey styling."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle, FancyArrowPatch

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "assets"
OUT.mkdir(parents=True, exist_ok=True)

# Same palette as docs/user-guide/build_guide.py
NAVY = "#0E2841"
INK = "#000000"
GREY = "#F2F2F2"
RULE = "#D0D0D0"
MUTED = "#555555"
WHITE = "#FFFFFF"

plt.rcParams.update(
    {
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial Unicode MS", "Arial", "Helvetica", "DejaVu Sans"],
        "font.size": 10,
        "text.color": INK,
        "axes.labelcolor": INK,
        "axes.edgecolor": RULE,
    }
)


def _save(fig, name: str):
    path = OUT / name
    fig.savefig(path, dpi=200, bbox_inches="tight", pad_inches=0.18, facecolor=WHITE)
    plt.close(fig)
    print("wrote", path)


def _title(ax, text: str, x=0.0, y=1.02):
    ax.text(
        x,
        y,
        text,
        transform=ax.transAxes,
        ha="left",
        va="bottom",
        color=INK,
        fontsize=12,
        fontweight="regular",
        clip_on=False,
    )


def _rule(ax, y, x0=0.0, x1=1.0):
    ax.plot([x0, x1], [y, y], color=RULE, lw=0.8, solid_capstyle="butt", clip_on=False)


def layers():
    """Six equal rows — document list, not a rainbow funnel."""
    fig, ax = plt.subplots(figsize=(7.2, 4.6))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 7.2)
    ax.axis("off")
    fig.patch.set_facecolor(WHITE)

    items = [
        ("01", "People", "Invitation + TM ANTOINE approval"),
        ("02", "Sign-in", "Email code, trusted device, authenticator"),
        ("03", "Place", "Countries where our providers operate"),
        ("04", "Edge", "Cloudflare filters hostile traffic"),
        ("05", "Files", "Type check, size cap, malware scan"),
        ("06", "Copies", "Portal store, SharePoint, daily backup"),
    ]

    _title(ax, "Six layers between a visitor and a client file", y=0.985)
    _rule(ax, 6.85, 0.15, 9.85)

    row_h = 0.95
    top = 6.55
    for i, (num, label, detail) in enumerate(items):
        y = top - i * row_h
        # grey row
        ax.add_patch(
            FancyBboxPatch(
                (0.15, y - 0.78),
                9.7,
                0.78,
                boxstyle="square,pad=0",
                facecolor=GREY if i % 2 == 0 else WHITE,
                edgecolor=RULE,
                linewidth=0.6,
            )
        )
        # navy index block
        ax.add_patch(Rectangle((0.15, y - 0.78), 0.85, 0.78, facecolor=NAVY, edgecolor="none"))
        ax.text(0.575, y - 0.39, num, ha="center", va="center", color=WHITE, fontsize=10, fontweight="bold")
        ax.text(1.25, y - 0.28, label, ha="left", va="center", color=INK, fontsize=11, fontweight="bold")
        ax.text(1.25, y - 0.55, detail, ha="left", va="center", color=MUTED, fontsize=9)

    _save(fig, "chart-layers.png")


def backup_cards():
    """Three equal panels instead of a pie chart."""
    fig, ax = plt.subplots(figsize=(7.2, 3.4))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 4.2)
    ax.axis("off")
    fig.patch.set_facecolor(WHITE)

    _title(ax, "If the portal is unavailable, files are not in one place", y=0.98)
    _rule(ax, 3.85, 0.15, 9.85)

    cards = [
        ("01", "Working files", "Portal store + R2.\nEncrypted at rest."),
        ("02", "SharePoint mirror", "Microsoft 365 copy.\nLive document set."),
        ("03", "Daily host backup", "Laravel Cloud backup.\nDisaster recovery."),
    ]
    w = 2.95
    gap = 0.2
    x0 = 0.35
    for i, (num, title, blurb) in enumerate(cards):
        x = x0 + i * (w + gap)
        ax.add_patch(
            FancyBboxPatch(
                (x, 0.35),
                w,
                3.2,
                boxstyle="square,pad=0",
                facecolor=WHITE,
                edgecolor=RULE,
                linewidth=0.8,
            )
        )
        ax.add_patch(Rectangle((x, 3.25), w, 0.3, facecolor=NAVY, edgecolor="none"))
        ax.text(x + 0.18, 3.4, num, ha="left", va="center", color=WHITE, fontsize=9, fontweight="bold")
        ax.text(x + 0.18, 2.55, title, ha="left", va="top", color=INK, fontsize=11, fontweight="bold")
        ax.text(x + 0.18, 1.75, blurb, ha="left", va="top", color=MUTED, fontsize=9.5)

    _save(fig, "chart-backup.png")


def access_cards():
    """Four role panels — grey/white alternating, navy index."""
    fig, ax = plt.subplots(figsize=(7.2, 3.5))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 4.3)
    ax.axis("off")
    fig.patch.set_facecolor(WHITE)

    _title(ax, "Four kinds of portal access", y=0.98)
    _rule(ax, 3.95, 0.15, 9.85)

    cards = [
        ("01", "Service\nprovider", "Works the firm's\nCIP files."),
        ("02", "Service provider\nadmin", "Invites and removes\npeople at the firm."),
        ("03", "CRO / reviewing\nofficer", "Reviews files for\nTM ANTOINE."),
        ("04", "Administrator", "Approves accounts\nand firm settings."),
    ]
    w = 2.15
    gap = 0.28
    x0 = 0.3
    for i, (num, title, blurb) in enumerate(cards):
        x = x0 + i * (w + gap)
        fill = GREY if i % 2 == 0 else WHITE
        ax.add_patch(
            FancyBboxPatch(
                (x, 0.3),
                w,
                3.4,
                boxstyle="square,pad=0",
                facecolor=fill,
                edgecolor=RULE,
                linewidth=0.7,
            )
        )
        ax.add_patch(Rectangle((x, 0.3), 0.12, 3.4, facecolor=NAVY, edgecolor="none"))
        ax.text(x + 0.28, 3.3, num, color=NAVY, fontsize=11, fontweight="bold", va="top", clip_on=True)
        ax.text(
            x + 0.28,
            2.7,
            title,
            color=INK,
            fontsize=9.5,
            fontweight="bold",
            va="top",
            linespacing=1.25,
            clip_on=True,
        )
        ax.text(x + 0.28, 1.55, blurb, color=MUTED, fontsize=8.5, va="top", linespacing=1.3, clip_on=True)

    _save(fig, "chart-access.png")


def account_flow():
    """Horizontal steps as labelled boxes, not tall ovals."""
    fig, ax = plt.subplots(figsize=(7.2, 2.6))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 3.4)
    ax.axis("off")
    fig.patch.set_facecolor(WHITE)

    _title(ax, "Nobody reaches the portal until TM ANTOINE approves the account", y=0.96)
    _rule(ax, 2.95, 0.2, 11.8)

    steps = [
        ("1", "Your admin\ninvites"),
        ("2", "Person\naccepts"),
        ("3", "TM ANTOINE\napproves"),
        ("4", "Account\ncan sign in"),
    ]
    box_w = 2.1
    box_h = 1.55
    y = 0.55
    xs = [0.55, 3.55, 6.55, 9.55]
    for i, ((num, label), x) in enumerate(zip(steps, xs)):
        ax.add_patch(
            FancyBboxPatch(
                (x, y),
                box_w,
                box_h,
                boxstyle="square,pad=0",
                facecolor=GREY if i % 2 == 0 else WHITE,
                edgecolor=RULE,
                linewidth=0.7,
            )
        )
        ax.add_patch(Rectangle((x, y + box_h - 0.38), box_w, 0.38, facecolor=NAVY, edgecolor="none"))
        ax.text(x + box_w / 2, y + box_h - 0.19, f"Step {num}", ha="center", va="center", color=WHITE, fontsize=9, fontweight="bold")
        ax.text(x + box_w / 2, y + 0.55, label, ha="center", va="center", color=INK, fontsize=10)
        if i < 3:
            ax.add_patch(
                FancyArrowPatch(
                    (x + box_w + 0.08, y + box_h / 2),
                    (xs[i + 1] - 0.08, y + box_h / 2),
                    arrowstyle="-|>",
                    mutation_scale=10,
                    lw=1.1,
                    color=NAVY,
                )
            )

    _save(fig, "chart-account-flow.png")


def encryption():
    """Four rows matching User Guide callout / table treatment."""
    fig, ax = plt.subplots(figsize=(7.2, 3.8))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 4.8)
    ax.axis("off")
    fig.patch.set_facecolor(WHITE)

    _title(ax, "Encryption, in ordinary words", y=0.97)
    _rule(ax, 4.4, 0.15, 9.85)

    rows = [
        ("On the way", "TLS (https). The journey is sealed. A network sniffer cannot read the pages or files."),
        ("At rest", "Vault files and call recordings are stored as ciphertext. Opening them needs the portal's key."),
        ("In the fields", "Passport numbers and dates of birth are encrypted in the database, not only in files."),
        ("In the app", "API keys and secrets live only on the server. The assistant cannot see them."),
    ]
    row_h = 0.9
    top = 4.15
    for i, (title, text) in enumerate(rows):
        y = top - i * row_h
        ax.add_patch(Rectangle((0.15, y - 0.78), 2.0, 0.78, facecolor=GREY, edgecolor=RULE, linewidth=0.6))
        ax.add_patch(
            Rectangle(
                (2.15, y - 0.78),
                7.7,
                0.78,
                facecolor=GREY if i % 2 == 0 else WHITE,
                edgecolor=RULE,
                linewidth=0.6,
            )
        )
        ax.text(1.15, y - 0.39, title, ha="center", va="center", color=INK, fontsize=10, fontweight="bold")
        ax.text(2.4, y - 0.39, text, ha="left", va="center", color=INK, fontsize=8.5)

    _save(fig, "chart-encryption.png")


if __name__ == "__main__":
    layers()
    backup_cards()
    access_cards()
    account_flow()
    encryption()
    print("done")
