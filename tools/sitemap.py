#!/usr/bin/env python3
"""Regenerate sitemap.xml with honest lastmod dates, derived from git.

    python3 tools/sitemap.py            # rewrite sitemap.xml
    python3 tools/sitemap.py --check    # exit 1 if sitemap.xml is stale (used by tools/check.py)

A page's lastmod is the date of the last commit that changed what a reader
sees — its <body> — so version bumps, icon links, preloads and other <head>
housekeeping don't count. A page with uncommitted body changes gets today's
date; a page not yet in git (a fresh essay) gets its published date. Essays
are never dated earlier than they were published.

Pages: / , /blog/ , every blog/<slug>/ , /shanghai/ — essays newest first.
"""
import datetime
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://wendawang.me"


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def body(html):
    """What a reader sees: the <body>, with cache-busting versions blanked out
    (the script tag lives at the foot of the body, so a bump alone must not count)."""
    m = re.search(r"<body[^>]*>(.*)</body>", html, re.S)
    text = m.group(1) if m else html
    text = re.sub(r"\?v=\d+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def published(html):
    m = re.search(r'<meta property="article:published_time" content="(\d{4}-\d{2}-\d{2})"', html)
    return m.group(1) if m else None


def lastmod(rel):
    """Date of the last body-changing commit, or today for uncommitted body edits."""
    today = datetime.date.today().isoformat()
    log = git("log", "--format=%H %cs", "--", rel).split("\n")
    shas = [ln.split() for ln in log if ln.strip()]
    if not shas:                                   # untracked: a page not yet committed
        return published((ROOT / rel).read_text()) or today
    head_body = body(git("show", f"{shas[0][0]}:{rel}"))
    if body((ROOT / rel).read_text()) != head_body:
        return today
    cur = head_body
    for i, (sha, date) in enumerate(shas):
        if i + 1 == len(shas):                     # the commit that created the page
            return date
        prev = body(git("show", f"{shas[i + 1][0]}:{rel}"))
        if prev != cur:
            return date
        cur = prev
    return shas[0][1]


def pages():
    essays = []
    for f in sorted((ROOT / "blog").glob("*/index.html")):
        essays.append((published(f.read_text()) or "0000-00-00", f))
    essays.sort(reverse=True)
    out = [("/", "index.html"), ("/blog/", "blog/index.html")]
    out += [(f"/blog/{f.parent.name}/", f"blog/{f.parent.name}/index.html") for _, f in essays]
    if (ROOT / "shanghai/index.html").exists():
        out.append(("/shanghai/", "shanghai/index.html"))
    return out


def render():
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, rel in pages():
        date = lastmod(rel)
        pub = published((ROOT / rel).read_text())
        if pub and date < pub:
            date = pub
        lines.append(f"  <url><loc>{SITE}{url}</loc><lastmod>{date}</lastmod></url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def main():
    new = render()
    path = ROOT / "sitemap.xml"
    old = path.read_text() if path.exists() else ""
    if "--check" in sys.argv:
        if new == old:
            print("sitemap.xml is current")
            return 0
        print("sitemap.xml is stale — run python3 tools/sitemap.py")
        for a, b in zip(old.splitlines(), new.splitlines()):
            if a != b:
                print(f"  have: {a.strip()}\n  want: {b.strip()}")
        return 1
    path.write_text(new)
    print(new.rstrip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
