#!/usr/bin/env python3
"""Render assets/og.png, the 1200x630 card shown when the site is shared.

Built from the same pieces as the page header: the vendored Heros and Plex
Mono, the palette in style.css, and assets/profile.jpg. Rerun it after
swapping the portrait or changing the intro line.

Needs Pillow and fontTools (with brotli) to read the woff2 files. Local only;
CI does not run this.

Usage:
    python3 tools/make_og.py
"""

import io
import os

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "assets", "fonts")
OUT = os.path.join(ROOT, "assets", "og.png")

W, H = 1200, 630
SCALE = 2  # draw at 2x and downsample, for cleaner edges on the hairlines

# style.css :root
BG = "#0c0c0d"
INK = "#ededea"
BRIGHT = "#ffffff"
MID = "#8f8f8a"
LOW = "#5a5a57"
LINE = "#232324"
LINE2 = "#333335"


def font(name, size):
    """Pillow cannot read woff2, so unpack it to an in-memory sfnt first."""
    f = TTFont(os.path.join(FONTS, name))
    f.flavor = None
    buf = io.BytesIO()
    f.save(buf)
    buf.seek(0)
    return ImageFont.truetype(buf, size * SCALE)


def main():
    s = SCALE
    img = Image.new("RGB", (W * s, H * s), BG)
    d = ImageDraw.Draw(img)

    # Portrait: 4:5, hairline border, mono caption underneath, as on the page.
    pw, ph = 300, 375
    px, py = W - 72 - pw, (H - ph - 28) // 2
    portrait = Image.open(os.path.join(ROOT, "assets", "profile.jpg")).convert("RGB")
    portrait = portrait.resize((pw * s, ph * s), Image.LANCZOS)
    img.paste(portrait, (px * s, py * s))
    d.rectangle([px * s, py * s, (px + pw) * s - 1, (py + ph) * s - 1],
                outline=LINE2, width=s)
    d.text((px * s, (py + ph + 12) * s), "Tampa, FL",
           font=font("plex-mono-regular.woff2", 15), fill=LOW)

    # Text block, vertically centred on the portrait.
    x = 72
    measure = px - 56 - x
    name = font("heros-bold.woff2", 76)
    line = font("heros-regular.woff2", 29)
    mono = font("plex-mono-regular.woff2", 19)

    y = py + 62
    d.text((x * s, y * s), "Zachary Blauser", font=name, fill=BRIGHT)
    y += 104
    d.text((x * s, y * s), "Systems programmer in Tampa.", font=line, fill=INK)
    y += 40
    d.text((x * s, y * s), "Mostly C and Zig.", font=line, fill=INK)
    y += 66
    d.line([(x * s, y * s), ((x + measure) * s, y * s)], fill=LINE, width=s)
    y += 26
    d.text((x * s, y * s), "zblauser.dev", font=mono, fill=MID)
    y += 34
    d.text((x * s, y * s), "a live record of what I'm building", font=mono, fill=LOW)

    img.resize((W, H), Image.LANCZOS).save(OUT, optimize=True)
    print(f"wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024}K)")


if __name__ == "__main__":
    main()
