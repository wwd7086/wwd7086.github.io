#!/usr/bin/env python3
"""Scaffold a new essay: the page, its social card, and paste-ready snippets.

    python3 tools/new_essay.py --title "My Essay Title" --slug my-essay-title \
        --desc "One-sentence summary for cards, lists and the feed." \
        --date 2026-09-15 [--x-url https://x.com/wwd7086/status/...]

Creates blog/<slug>/index.html (write the body there), renders og/<slug>.png,
and prints the four snippets to paste: blog list, home Writing list, feed.xml
entry, sitemap line. Nothing else is modified automatically.
"""
import argparse
import datetime
import re
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent


def current_versions():
    home = (ROOT / "index.html").read_text()
    sv = re.search(r"style\.css\?v=(\d+)", home)
    jv = re.search(r"marginalia\.js\?v=(\d+)", home)
    return (sv.group(1) if sv else "3"), (jv.group(1) if jv else "9")


def latest_essay():
    """The feed's first entry — becomes the new essay's 'Previous' link."""
    feed = (ROOT / "feed.xml").read_text()
    m = re.search(r"<entry>\s*<title>(.*?)</title>\s*<link href=\"(.*?)\"", feed, re.S)
    if not m:
        return None
    title = m.group(1).strip()
    path = m.group(2).replace("https://wwd7086.github.io", "")
    return title, path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", required=True)
    ap.add_argument("--slug", required=True, help="lowercase-with-dashes, becomes /blog/<slug>/")
    ap.add_argument("--desc", required=True)
    ap.add_argument("--date", required=True, help="YYYY-MM-DD")
    ap.add_argument("--x-url", default="", help="original X post, if it exists")
    ap.add_argument("--no-card", action="store_true", help="skip rendering the social card")
    a = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", a.slug):
        sys.exit("slug must be lowercase-with-dashes")
    d = datetime.date.fromisoformat(a.date)
    dest = ROOT / "blog" / a.slug
    if dest.exists():
        sys.exit(f"{dest} already exists")

    human = f"{d:%B} {d.day}, {d.year}"          # April 7, 2026
    month_year = f"{d:%B} {d.year}"              # April 2026
    offset = datetime.datetime(d.year, d.month, d.day, tzinfo=ZoneInfo("America/Los_Angeles")).strftime("%z")
    rfc = f"{a.date}T00:00:00{offset[:3]}:{offset[3:]}"

    sv, jv = current_versions()
    prev = latest_essay()
    prev_link = (
        f'<a href="{prev[1]}">Previous: {prev[0]} →</a>' if prev else ""
    )
    source = (
        f'\n          &nbsp;·&nbsp; Originally published on <a href="{a.x_url}" rel="noopener">X</a>'
        if a.x_url else ""
    )

    page = (ROOT / "tools" / "essay-template.html").read_text()
    for k, v in {
        "{{TITLE}}": a.title, "{{DESC}}": a.desc, "{{SLUG}}": a.slug,
        "{{DATE_ISO}}": a.date, "{{DATE_HUMAN}}": human,
        "{{SOURCE_NOTE}}": source, "{{PREV_LINK}}": prev_link,
        "{{STYLE_V}}": sv, "{{JS_V}}": jv,
    }.items():
        page = page.replace(k, v)
    dest.mkdir(parents=True)
    (dest / "index.html").write_text(page)
    print(f"created blog/{a.slug}/index.html — write the essay in the .prose block\n")

    if not a.no_card:
        subprocess.run(
            [sys.executable, str(ROOT / "tools" / "render_cards.py"),
             "--title", a.title, "--date", month_year, "--out", f"og/{a.slug}.png"],
            check=True,
        )
        print()

    print("=== paste into blog/index.html, top of <ul class=\"post-list\"> ===")
    print(f"""        <li>
          <div class="when">{human}</div>
          <div>
            <h3 class="who"><a href="/blog/{a.slug}/">{a.title}</a></h3>
            <p class="desc">
              {a.desc}
            </p>
          </div>
        </li>""")
    print("\n=== paste into index.html, top of the Writing <ul class=\"post-list\"> ===")
    print(f"""        <li>
          <div class="when">{month_year}</div>
          <div>
            <h3 class="who"><a href="/blog/{a.slug}/">{a.title}</a></h3>
            <p class="desc">
              {a.desc}
            </p>
          </div>
        </li>""")
    print("\n=== paste into feed.xml, above the first <entry> (and update the feed's <updated>) ===")
    print(f"""  <entry>
    <title>{a.title}</title>
    <link href="https://wwd7086.github.io/blog/{a.slug}/"/>
    <id>https://wwd7086.github.io/blog/{a.slug}/</id>
    <published>{rfc}</published>
    <updated>{rfc}</updated>
    <summary>{a.desc}</summary>
  </entry>""")
    print("\n=== paste into sitemap.xml (and refresh the / and /blog/ lastmod dates) ===")
    print(f"  <url><loc>https://wwd7086.github.io/blog/{a.slug}/</loc><lastmod>{a.date}</lastmod></url>")
    print("\nthen: git add -A && git commit && git push  (Pages builds in ~30s; CDN caches HTML ~10 min)")


if __name__ == "__main__":
    main()
