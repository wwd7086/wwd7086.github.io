#!/usr/bin/env python3
"""Render the social-share cards from the repo's own templates and fonts.

    python3 tools/render_cards.py                                  # home card -> og/card.png
    python3 tools/render_cards.py --title "Essay Title" \
        --date "April 2026" --out og/my-essay.png                  # an essay card

The cards are rendered by a headless browser against a local server rooted at
the repo, so they use the same self-hosted Newsreader/Inter as the site.
One-time setup:  pip install playwright && python3 -m playwright install chromium
"""
import argparse
import http.server
import os
import socket
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def serve(root):
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(root), **k)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, port


def render(url_path, out, port):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-proxy-server"])
        page = browser.new_page(viewport={"width": 1200, "height": 630})
        page.goto(f"http://127.0.0.1:{port}{url_path}")
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(350)
        page.screenshot(path=str(out))
        browser.close()
    print(f"rendered {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", help="essay title (omit to render the home card)")
    ap.add_argument("--date", help='essay date as shown on the card, e.g. "April 2026"')
    ap.add_argument("--out", help="output png path, e.g. og/my-essay.png")
    a = ap.parse_args()

    os.chdir(ROOT)
    srv, port = serve(ROOT)
    tmp = ROOT / "tools" / ".card-tmp.html"
    try:
        if a.title:
            if not (a.date and a.out):
                ap.error("--title needs --date and --out")
            html = (ROOT / "tools" / "card-essay.html").read_text()
            html = html.replace("{{TITLE}}", a.title).replace("{{DATE}}", a.date)
            tmp.write_text(html)
            render("/tools/.card-tmp.html", ROOT / a.out, port)
        else:
            render("/tools/card-home.html", ROOT / "og" / "card.png", port)
    finally:
        if tmp.exists():
            tmp.unlink()
        srv.shutdown()


if __name__ == "__main__":
    main()
