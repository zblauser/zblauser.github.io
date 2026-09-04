#!/usr/bin/env python3
"""Vendor third-party images into assets/ so the site makes no
third-party requests at page load.

Discovers repos across the four accounts, pulls each org avatar and each
repo's icon, and writes them under assets/. Blob SHAs are recorded in
assets/manifest.json so reruns only write what actually changed.

Icon lookup does not rely on a naming convention. It reads each repo's
git tree once and matches candidates in priority order, so a repo that
names its icon something unexpected is still found.

Usage:
    python3 tools/vendor_assets.py            # refresh
    python3 tools/vendor_assets.py --dry-run  # report only

Set GITHUB_TOKEN to lift the rate limit from 60/hr to 5000/hr.
"""

import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
ORG_DIR = os.path.join(ASSETS, "orgs")
REPO_DIR = os.path.join(ASSETS, "repos")
MANIFEST = os.path.join(ASSETS, "manifest.json")

ACCOUNTS = [
    ("users", "zblauser"),
    ("orgs", "mithraeums"),
    ("orgs", "sys-ae"),
    ("orgs", "vim-nvim-plugins"),
]

ORGS = [name for kind, name in ACCOUNTS if kind == "orgs"]

# Repos with no visual identity worth vendoring.
SKIP = {
    "mithraeums/.github",
    "zblauser/zblauser.github.io",
    "zblauser/homebrew-tap",
    "zblauser/articles",
}

IMG_EXT = (".png", ".svg", ".jpg", ".jpeg", ".webp")
MAX_BYTES = 512 * 1024  # anything larger is a screenshot, not an icon
MIN_BYTES = 1024        # a 16x16 favicon is not usable card art

DRY_RUN = "--dry-run" in sys.argv


def api(url):
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "zblauser-site-vendor",
    })
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": "zblauser-site-vendor"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def icon_score(path, repo_name):
    """Lower is better. Returns None for paths that are not candidate icons."""
    low = path.lower()
    if not low.endswith(IMG_EXT):
        return None
    base = os.path.basename(low)
    stem = os.path.splitext(base)[0]
    name = repo_name.lower()
    depth = low.count("/")

    # A screenshot directory is never an icon.
    if any(seg in low for seg in ("screenshot", "demo/", "docs/img", "example")):
        return None

    if low.startswith("icon/") and stem == name:
        return 0
    if stem in ("icon", "logo") and depth == 0:
        return 1
    if low.startswith("icon/"):
        return 2
    if low.startswith("assets/") and stem == name:
        return 3
    if stem == name and depth <= 1:
        return 4
    if stem in ("icon", "logo"):
        return 5
    if "favicon" in stem:
        return 6
    return None


def find_icon(full, default_branch):
    """Read the repo tree once, return (path, sha) of the best icon or None."""
    try:
        tree = api(
            f"https://api.github.com/repos/{full}/git/trees/"
            f"{default_branch}?recursive=1"
        )
    except urllib.error.HTTPError as e:
        print(f"    tree unavailable ({e.code})")
        return None
    except Exception as e:
        print(f"    tree unavailable ({e})")
        return None

    best = None
    for node in tree.get("tree", []):
        if node.get("type") != "blob":
            continue
        path = node.get("path", "")
        size = node.get("size", 0)
        if size > MAX_BYTES:
            continue
        if size < MIN_BYTES and not path.lower().endswith(".svg"):
            continue
        score = icon_score(path, full.split("/")[1])
        if score is None:
            continue
        # Same score: take the larger file. Icon sets ship many sizes and
        # the bigger one survives being scaled up in a card.
        if best is None or (score, -size) < (best[0], -best[1]):
            best = (score, size, path, node.get("sha"))

    return (best[2], best[3]) if best else None


def load_manifest():
    if os.path.exists(MANIFEST):
        try:
            with open(MANIFEST) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def write_file(path, data):
    if DRY_RUN:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def main():
    manifest = load_manifest()
    new_manifest = {}
    added, updated, unchanged, missing = [], [], [], []

    # --- org avatars ---------------------------------------------------
    print("Org avatars")
    for org in ORGS:
        url = f"https://github.com/{org}.png"
        try:
            data = fetch_bytes(url)
        except Exception as e:
            print(f"  {org:22} FAILED ({e})")
            missing.append(org)
            continue

        key = f"org:{org}"
        sha = str(len(data))  # avatars carry no blob sha; size is the signal
        dest = os.path.join(ORG_DIR, f"{org}.png")
        rel = os.path.relpath(dest, ROOT)

        prev = manifest.get(key) or {}
        if prev.get("sha") == sha and os.path.exists(dest):
            unchanged.append(rel)
            print(f"  {org:22} unchanged")
        else:
            write_file(dest, data)
            (updated if key in manifest else added).append(rel)
            print(f"  {org:22} -> {rel} ({len(data) // 1024}K)")
        new_manifest[key] = {"sha": sha, "file": rel}

    # --- repo icons ----------------------------------------------------
    print("\nRepo icons")
    for kind, name in ACCOUNTS:
        try:
            repos = api(
                f"https://api.github.com/{kind}/{name}/repos"
                f"?per_page=100&sort=pushed"
            )
        except Exception as e:
            print(f"  {name}: repo list failed ({e})")
            continue

        for r in repos:
            full = r["full_name"]
            if full in SKIP or r.get("fork") or r.get("archived"):
                continue

            found = find_icon(full, r.get("default_branch") or "main")
            if not found:
                missing.append(full)
                print(f"  {full:34} no icon found")
                continue

            path, sha = found
            key = f"repo:{full}"
            ext = os.path.splitext(path)[1].lower()
            slug = re.sub(r"[^a-z0-9.-]+", "-", full.lower().replace("/", "__"))
            dest = os.path.join(REPO_DIR, f"{slug}{ext}")
            rel = os.path.relpath(dest, ROOT)

            prev = manifest.get(key) or {}
            if prev.get("sha") == sha and os.path.exists(dest):
                unchanged.append(rel)
                new_manifest[key] = {"sha": sha, "file": rel}
                print(f"  {full:34} unchanged")
                continue

            raw = (
                f"https://raw.githubusercontent.com/{full}/"
                f"{r.get('default_branch') or 'main'}/{path}"
            )
            try:
                data = fetch_bytes(raw)
            except Exception as e:
                print(f"  {full:34} download failed ({e})")
                missing.append(full)
                continue

            write_file(dest, data)
            (updated if key in manifest else added).append(rel)
            new_manifest[key] = {"sha": sha, "file": rel}
            print(f"  {full:34} {path} -> {rel} ({len(data) // 1024}K)")

    # --- manifest ------------------------------------------------------
    if not DRY_RUN:
        os.makedirs(ASSETS, exist_ok=True)
        with open(MANIFEST, "w") as f:
            json.dump(new_manifest, f, indent=2, sort_keys=True)
            f.write("\n")

    print(
        f"\nadded {len(added)} · updated {len(updated)} · "
        f"unchanged {len(unchanged)} · no icon {len(missing)}"
    )
    if missing:
        print("no icon found for: " + ", ".join(missing))
    if DRY_RUN:
        print("(dry run — nothing written)")


if __name__ == "__main__":
    main()
