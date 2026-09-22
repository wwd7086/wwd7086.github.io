#!/usr/bin/env python3
"""Self-host the Shanghai skyscape's fonts as exact-fit subsets.

    python3 tools/shanghai_fonts.py            # (re)build fonts/sky-*.woff2 from Google Fonts
    python3 tools/shanghai_fonts.py --check    # do the files cover every character the page uses?

The diorama sets its HUD, captions and the neon signs it paints onto canvas in
Noto Serif SC (300/500) and IBM Plex Mono (400/500); Newsreader comes from the
site's own fonts/fonts.css. Rather than load Google's hundred-slice CJK font
from their servers, this asks Google Fonts for a subset containing exactly the
characters that appear in shanghai/index.html and shanghai/sky/bundle.js
(plus printable ASCII), and commits those files. Re-run it after importing a
new version of the design; tools/check.py runs --check. Fonts: SIL OFL 1.1.
"""
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = [ROOT / "shanghai" / "index.html", ROOT / "shanghai" / "sky" / "bundle.js"]
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
FACES = [  # family, css2 axis spec, file stem
    ("Noto Serif SC", "wght@300;500", "sky-noto-serif-sc"),
    ("IBM Plex Mono", "wght@400;500", "sky-plex-mono"),
]


def charset():
    chars = {chr(c) for c in range(0x20, 0x7F)}
    for p in PAGES:
        chars |= {c for c in p.read_text() if ord(c) > 0x7F and c.isprintable()}
    return "".join(sorted(chars))


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def build():
    text = charset()
    for family, axes, stem in FACES:
        q = urllib.parse.urlencode({"family": f"{family}:{axes}", "text": text, "display": "swap"})
        css = fetch("https://fonts.googleapis.com/css2?" + q).decode()
        faces = re.findall(r"font-weight:\s*(\d+);.*?src:\s*url\((\S+?)\)", css, re.S)
        urls = {u for _, u in faces}
        for old in (ROOT / "fonts").glob(f"{stem}*.woff2"):
            old.unlink()
        if len(urls) == 1:     # Google served one variable font for every weight asked for
            outs = [(ROOT / "fonts" / f"{stem}.woff2", urls.pop())]
        else:
            outs = [(ROOT / "fonts" / f"{stem}-{w}.woff2", u) for w, u in faces]
        for out, url in outs:
            out.write_bytes(fetch(url))
            print(f"fonts/{out.name}  {out.stat().st_size:,} bytes")
    print("\n(if a file name changed, update the @font-face block at the top of shanghai/index.html)")
    return check()


def check():
    from fontTools.ttLib import TTFont
    need = {c for c in charset() if ord(c) > 0x7F}
    ok = True
    for family, axes, stem in FACES:
        for f in sorted((ROOT / "fonts").glob(f"{stem}-*.woff2")):
            cmap = set(TTFont(f).getBestCmap())
            if family == "Noto Serif SC":      # every CJK character must be there
                missing = [c for c in need if (0x3000 <= ord(c) <= 0x9FFF or 0xFF00 <= ord(c) <= 0xFFEF) and ord(c) not in cmap]
            else:                              # the mono face: every ASCII character
                missing = [chr(c) for c in range(0x21, 0x7F) if c not in cmap]
            if missing:
                ok = False
                print(f"{f.name}: missing {''.join(sorted(missing))!r} — run python3 tools/shanghai_fonts.py")
    print("shanghai fonts cover the page" if ok else "shanghai fonts are stale")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(check() if "--check" in sys.argv else build())
