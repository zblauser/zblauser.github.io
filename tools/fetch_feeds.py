#!/usr/bin/env python3
"""Snapshot feeds that a browser cannot fetch directly.

ziggit.dev is Discourse and returns no Access-Control-Allow-Origin header,
so a page on zblauser.dev cannot read it: the request is blocked before the
response is seen. GitHub and dev.to both send `*`, so those stay live in the
browser and are not snapshotted here.

This runs in CI, where CORS does not apply, and writes feeds/ziggit.json for
the page to read same-origin.

Usage:
    python3 tools/fetch_feeds.py
    python3 tools/fetch_feeds.py --dry-run
"""

import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEED_DIR = os.path.join(ROOT, "feeds")

LIMIT = 20

# Discourse forums, snapshotted because none of them send CORS headers.
# `endpoints` are tried in order: user_actions is the richest, but some
# installs gate it and answer 404, so a topic listing is kept as a fallback.
FORUMS = [
    {
        "key": "ziggit",
        "host": "https://ziggit.dev",
        "user": "selectedambient",
        "label": "ziggit.dev",
    },
    {
        "key": "rust",
        "host": "https://users.rust-lang.org",
        "user": "zblauser",
        "label": "rust forum",
    },
]

DRY_RUN = "--dry-run" in sys.argv


def get_json(url):
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "zblauser-site-feeds",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def from_user_actions(forum, data):
    posts = []
    for a in data.get("user_actions") or []:
        topic_id = a.get("topic_id")
        if not topic_id:
            continue
        link = f"{forum['host']}/t/{a.get('slug') or ''}/{topic_id}"
        if a.get("post_number"):
            link += f"/{a['post_number']}"
        posts.append({
            "source": forum["key"],
            "repo": forum["label"],
            "title": a.get("title") or "(untitled)",
            "kind": "posted topic" if a.get("action_type") == 4 else "replied",
            "url": link,
            "time": a.get("created_at"),
        })
    return posts


def from_topic_list(forum, data):
    posts = []
    topics = (data.get("topic_list") or {}).get("topics") or []
    for t in topics:
        tid = t.get("id")
        if not tid:
            continue
        posts.append({
            "source": forum["key"],
            "repo": forum["label"],
            "title": t.get("title") or "(untitled)",
            "kind": "posted topic",
            "url": f"{forum['host']}/t/{t.get('slug') or ''}/{tid}",
            "time": t.get("created_at") or t.get("bumped_at"),
        })
    return posts


def from_search(forum, data):
    """Search is the only author view that survives a hidden profile, so it
    is the last resort rather than the first try: it caps out well short of
    a full history and cannot distinguish a reply from a topic without the
    post number."""
    topics = {t.get("id"): t for t in (data.get("topics") or [])}
    posts = []
    for post in data.get("posts") or []:
        tid = post.get("topic_id")
        topic = topics.get(tid)
        if not tid or not topic:
            continue
        number = post.get("post_number") or 1
        link = f"{forum['host']}/t/{topic.get('slug') or ''}/{tid}"
        if number > 1:
            link += f"/{number}"
        posts.append({
            "source": forum["key"],
            "repo": forum["label"],
            "title": topic.get("title") or "(untitled)",
            "kind": "posted topic" if number == 1 else "replied",
            "url": link,
            "time": post.get("created_at"),
        })
    return posts


def fetch_forum(forum):
    """Try each endpoint in turn. A gated or missing one 404s rather than
    returning an empty list, so a failure here is not evidence of no posts."""
    user = forum["user"]
    attempts = [
        (f"{forum['host']}/user_actions.json"
         f"?username={user}&filter=4,5&limit={LIMIT}", from_user_actions),
        (f"{forum['host']}/topics/created-by/{user}.json", from_topic_list),
        (f"{forum['host']}/search.json?q=%40{user}", from_search),
    ]
    for url, parse in attempts:
        try:
            posts = parse(forum, get_json(url))
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as e:
            print(f"  {forum['key']}: {url.split('/')[-1].split('?')[0]} -> {e}")
            continue
        if posts:
            return posts
        print(f"  {forum['key']}: {url.split('/')[-1].split('?')[0]} -> 0 entries")
    return []


def write(path, payload):
    if DRY_RUN:
        print(f"  (dry run) would write {os.path.relpath(path, ROOT)}")
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")


def main():
    wrote = 0
    for forum in FORUMS:
        key = forum["key"]
        print(f"{key}:")
        posts = fetch_forum(forum)

        if not posts:
            # No posts yet, or every endpoint refused. Either way, keep what is
            # already committed instead of overwriting it with an empty file.
            print(f"  no entries; leaving feeds/{key}.json as it is")
            continue

        posts.sort(key=lambda p: p.get("time") or "", reverse=True)
        write(os.path.join(FEED_DIR, f"{key}.json"),
              {"user": forum["user"], "posts": posts[:LIMIT]})
        print(f"  {len(posts[:LIMIT])} entries -> feeds/{key}.json")
        print(f"  newest: {posts[0]['time'][:10]}  {posts[0]['title'][:60]}")
        wrote += 1

    return 0 if wrote else 1


if __name__ == "__main__":
    raise SystemExit(main())
