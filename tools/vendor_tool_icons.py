#!/usr/bin/env python3
"""Vendor tool logos into assets/tools/ so the page makes no third-party
requests at load.

Source is Simple Icons, which is CC0, single-colour and single-path. Each
file is stripped of its <title> and pinned to a fixed major version, so a
rerun is reproducible rather than whatever the CDN serves today.

The site is dark, so the page inverts these in CSS; they stay black on disk
and therefore also work if the sheet is ever printed.

Usage:
    python3 tools/vendor_tool_icons.py
    python3 tools/vendor_tool_icons.py --dry-run
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "assets", "tools")
MANIFEST = os.path.join(ROOT, "assets", "tools.json")

VERSION = "13"
CDN = f"https://cdn.jsdelivr.net/npm/simple-icons@{VERSION}/icons/{{}}.svg"

# (slug, display name, link). Order is the order they appear on the page:
# the things reached for first, then the supporting cast.
TOOLS = [
    # languages
    ("c",              "C",               "https://en.cppreference.com/w/c"),
    ("zig",            "Zig",             "https://ziglang.org"),
    ("rust",           "Rust",            "https://www.rust-lang.org"),
    ("python",         "Python",          "https://www.python.org"),
    ("go",             "Go",              "https://go.dev"),
    ("javascript",     "JavaScript",      "https://developer.mozilla.org/docs/Web/JavaScript"),
    ("typescript",     "TypeScript",      "https://www.typescriptlang.org"),
    ("openjdk",        "Java",            "https://openjdk.org"),
    ("gnubash",        "Bash",            "https://www.gnu.org/software/bash/"),
    ("zsh",            "zsh",             "https://www.zsh.org"),
    # editors and terminal
    ("neovim",         "Neovim",          "https://neovim.io"),
    ("vim",            "Vim",             "https://www.vim.org"),
    ("tmux",           "tmux",            "https://github.com/tmux/tmux"),
    # build
    ("llvm",           "LLVM",            "https://llvm.org"),
    ("cmake",          "CMake",           "https://cmake.org"),
    ("make",           "Make",            "https://www.gnu.org/software/make/"),
    ("git",            "Git",             "https://git-scm.com"),
    ("githubactions",  "GitHub Actions",  "https://github.com/features/actions"),
    # systems
    ("archlinux",      "Arch Linux",      "https://archlinux.org"),
    ("debian",         "Debian",          "https://www.debian.org"),
    ("ubuntu",         "Ubuntu",          "https://ubuntu.com"),
    ("linux",          "Linux",           "https://kernel.org"),
    ("apple",          "macOS",           "https://www.apple.com/macos/"),
    ("docker",         "Docker",          "https://www.docker.com"),
    # data and services
    ("postgresql",     "PostgreSQL",      "https://www.postgresql.org"),
    ("sqlite",         "SQLite",          "https://sqlite.org"),
    ("mysql",          "MySQL",           "https://www.mysql.com"),
    ("fastapi",        "FastAPI",         "https://fastapi.tiangolo.com"),
    ("react",          "React",           "https://react.dev"),
    ("nodedotjs",      "Node.js",         "https://nodejs.org"),
    ("nginx",          "nginx",           "https://nginx.org"),
    ("htmx",           "htmx",            "https://htmx.org"),
    ("amazonwebservices", "AWS",          "https://aws.amazon.com"),
    # ai
    ("anthropic",      "Claude",          "https://www.anthropic.com"),
    ("ollama",         "Ollama",          "https://ollama.com"),
    ("huggingface",    "Hugging Face",    "https://huggingface.co"),
    ("pytorch",        "PyTorch",         "https://pytorch.org"),
    ("numpy",          "NumPy",           "https://numpy.org"),
    ("pandas",         "pandas",          "https://pandas.pydata.org"),
    ("scikitlearn",    "scikit-learn",    "https://scikit-learn.org"),
    # media, wire, metal
    ("ffmpeg",         "FFmpeg",          "https://ffmpeg.org"),
    ("webassembly",    "WebAssembly",     "https://webassembly.org"),
    ("wireshark",      "Wireshark",       "https://www.wireshark.org"),
    ("espressif",      "ESP32",           "https://www.espressif.com"),
    ("raspberrypi",    "Raspberry Pi",    "https://www.raspberrypi.com"),
    ("arduino",        "Arduino",         "https://www.arduino.cc"),
    ("kicad",          "KiCad",           "https://www.kicad.org"),
]

# Own marks. (slug, name, source, colour, link, weight)
LOCAL = [
    ("hako", "hako", "assets/icons/hako.svg", "#b89656",
     "https://mithraeum.studio", 3.0),
]


# Brand colours come from the same package as the marks, so they cannot drift
# apart. Several are near-black (Rust, Ollama, Anthropic) and would vanish on a
# dark page; the page substitutes a neutral for those rather than the script
# guessing here.
DATA_URL = f"https://cdn.jsdelivr.net/npm/simple-icons@{VERSION}/_data/simple-icons.json"


def brand_colours():
    try:
        raw = json.loads(fetch(DATA_URL))
    except Exception as e:
        print(f"  colour data unavailable ({e}); marks will fall back to neutral")
        return {}
    icons = raw["icons"] if isinstance(raw, dict) else raw
    return {i["title"]: i.get("hex") for i in icons}

DRY_RUN = "--dry-run" in sys.argv


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "zblauser-site-vendor"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def clean(svg):
    """Drop the title (the page supplies its own label) and any stray fill,
    so the icon inherits whatever the stylesheet says."""
    svg = re.sub(r"<title>.*?</title>", "", svg, flags=re.S)
    svg = svg.replace(' fill="#000"', "").replace(' fill="black"', "")
    return svg.strip()


BG_RECT = re.compile(
    r'<rect\b[^>]*\bwidth="(?:100%|512|256|128|64|48|32|24|16)"[^>]*/>', re.I)

# The icon system draws each mark inside its chassis: a full-bleed ground, a
# soft glow, a hairline frame and corner ticks. That reads at 512px and turns
# to mud at the 19px the page paints a tool mark at, so the chassis is dropped
# and only the mark itself survives. A mask uses alpha, not colour, so the
# ground would otherwise come through as a solid square.
CHROME = [
    re.compile(r"<defs>.*?</defs>", re.S),                  # gradient for the glow
    re.compile(r'<rect\b[^>]*fill="url\(#[^)]*\)"[^>]*/>', re.I),
    re.compile(r'<rect\b(?=[^>]*\bfill="none")[^>]*/>', re.I),   # hairline frame
    re.compile(r'<g\b[^>]*stroke-linecap="square"[^>]*>.*?</g>', re.S),  # corner ticks
]


def take_local(src, weight=1.0):
    """Read one of our own marks and make it safe to use as a mask."""
    with open(os.path.join(ROOT, src)) as f:
        svg = f.read()
    svg = BG_RECT.sub("", svg)
    for pat in CHROME:
        svg = pat.sub("", svg)
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    if weight != 1.0:
        svg = re.sub(r'stroke-width="([\d.]+)"',
                     lambda m: 'stroke-width="%g"' % (float(m.group(1)) * weight), svg)
        svg = re.sub(r'\br="([\d.]+)"',
                     lambda m: 'r="%g"' % (float(m.group(1)) * weight * 0.65), svg)
    return re.sub(r"\n\s*\n+", "\n", svg).strip()


def main():
    got, failed = [], []
    hexes = brand_colours()

    for slug, name, src, hexv, url, weight in LOCAL:
        try:
            svg = take_local(src, weight)
        except OSError:
            svg = None

        path = os.path.join(DEST, f"{slug}.svg")
        if svg is None:
            if not os.path.exists(path):
                print(f"  {slug:16} FAILED (no source at {src}, nothing vendored)")
                failed.append(slug)
                continue
            print(f"  {slug:16} kept (source unavailable here)")
        else:
            if not DRY_RUN:
                os.makedirs(DEST, exist_ok=True)
                with open(path, "w") as f:
                    f.write(svg + "\n")
            print(f"  {slug:16} <- {src} (local)")

        got.append({"slug": slug, "name": name, "url": url, "hex": hexv,
                    "file": os.path.relpath(path, ROOT)})

    for slug, name, url in TOOLS:
        try:
            svg = clean(fetch(CDN.format(slug)))
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            print(f"  {slug:16} FAILED ({e})")
            failed.append(slug)
            continue

        if not svg.startswith("<svg"):
            print(f"  {slug:16} FAILED (not an svg)")
            failed.append(slug)
            continue

        path = os.path.join(DEST, f"{slug}.svg")
        if not DRY_RUN:
            os.makedirs(DEST, exist_ok=True)
            with open(path, "w") as f:
                f.write(svg + "\n")
        got.append({"slug": slug, "name": name, "url": url,
                    "hex": "#" + hexes[name] if hexes.get(name) else "",
                    "file": os.path.relpath(path, ROOT)})
        print(f"  {slug:16} -> assets/tools/{slug}.svg ({len(svg)} B)")

    if not DRY_RUN and got:
        with open(MANIFEST, "w") as f:
            json.dump({"source": f"simple-icons@{VERSION}", "license": "CC0-1.0",
                       "tools": got}, f, indent=2)
            f.write("\n")

    print(f"\n{len(got)} vendored · {len(failed)} failed")
    if failed:
        print("failed: " + ", ".join(failed))
    if DRY_RUN:
        print("(dry run - nothing written)")
    return 0 if got else 1


if __name__ == "__main__":
    raise SystemExit(main())
