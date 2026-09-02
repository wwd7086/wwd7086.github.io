#!/usr/bin/env python3
"""Render the site's icons from the masthead W, set in the site's own Newsreader.

Writes, at the repo root:
  apple-touch-icon.png  180x180, full-bleed cream (iOS applies its own corner mask)
  favicon.ico           16/32/48, rounded corners on transparency, like the SVG favicon

Run from anywhere: python3 tools/render_icons.py
Needs playwright (chromium) and Pillow; serves the repo itself so /fonts/ resolves.
"""
import io, os, subprocess, sys, time
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8137

PAGE = """<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/fonts/fonts.css">
<style>
  body { margin: 0; background: #fff; }
  .w {
    width: 192px; height: 192px; display: grid; place-items: center;
    background: #f5f2ec; color: #2a2724;
    font-family: 'Newsreader', Georgia, serif; font-weight: 500;
    font-size: 122px; line-height: 1;
  }
  .w span { transform: translateY(0.12em); }   /* centres the ink: the glyph box carries descender space the W doesn't use */
  #touch { width: 180px; height: 180px; font-size: 114px; }
  #fav { border-radius: 22%; }
  .row { display: flex; gap: 24px; padding: 24px; }
</style>
<div class="row">
  <div class="w" id="touch"><span>W</span></div>
  <div class="w" id="fav"><span>W</span></div>
</div>
"""

def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--no-proxy-server"])
            pg = b.new_page(viewport={"width": 600, "height": 300}, device_scale_factor=1)
            pg.route(f"http://127.0.0.1:{PORT}/__icons", lambda r: r.fulfill(body=PAGE, content_type="text/html"))
            pg.goto(f"http://127.0.0.1:{PORT}/__icons", wait_until="load")
            pg.evaluate("document.fonts.ready.then(() => 1)")
            pg.wait_for_timeout(300)
            assert pg.evaluate("document.fonts.check('500 100px Newsreader')"), "Newsreader did not load"
            touch = pg.locator("#touch").screenshot(type="png")
            fav = pg.locator("#fav").screenshot(type="png", omit_background=True)
            b.close()
    finally:
        srv.terminate()

    Image.open(io.BytesIO(touch)).convert("RGB").save(ROOT / "apple-touch-icon.png", optimize=True)
    big = Image.open(io.BytesIO(fav)).convert("RGBA")
    frames = [big.resize((s, s), Image.LANCZOS) for s in (48, 32, 16)]
    frames[0].save(ROOT / "favicon.ico", format="ICO", sizes=[(48, 48), (32, 32), (16, 16)],
                   append_images=frames[1:])
    for f in ("apple-touch-icon.png", "favicon.ico"):
        print(f, os.path.getsize(ROOT / f), "bytes")

if __name__ == "__main__":
    main()
