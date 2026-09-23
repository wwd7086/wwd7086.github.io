#!/usr/bin/env python3
"""Build /shanghai/ from the Claude Design export, re-applying the site's changes.

The design (Wenda's Claude Design project) is the source of truth for the scene;
this script turns its two files into the site's page every time a new version
lands, so nothing done here is lost on the next import:

    tools/shanghai/design/shanghai-skyscape.html   the design's page, untouched
    tools/shanghai/design/sky/bundle.js            the design's bundle, untouched

      -> shanghai/index.html      site head, fonts, home link, analytics, site.css/js
      -> shanghai/sky/bundle.js   small anchored hooks (below), then minified

The site's own behaviour lives in shanghai/sky/site.js and site.css (phone tier,
portrait framing, touch tour, landscape-phone HUD, tilt); the hooks only expose
what those files need. Every anchor must match exactly once, so a redesign that
moves one fails loudly here instead of shipping a half-patched page.

    python3 tools/shanghai_import.py            # rebuild the page and bundle
    python3 tools/shanghai_import.py --check    # anchors still match + outputs current (tools/check.py)
    python3 tools/shanghai_import.py --no-minify   # readable bundle, for debugging
"""
import hashlib, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "tools" / "shanghai" / "design"
PAGE = ROOT / "shanghai" / "index.html"
BUNDLE = ROOT / "shanghai" / "sky" / "bundle.js"
SITE_JS = ROOT / "shanghai" / "sky" / "site.js"
SITE_CSS = ROOT / "shanghai" / "sky" / "site.css"
ESBUILD = ["npx", "--yes", "esbuild@0.24.0"]

# ---------------------------------------------------------------- bundle hooks
# (why, anchor, replacement). window.__skyTier is set by site.js before the bundle runs.
BUNDLE_HOOKS = [
    ("tag the street-tree meshes so the phone tier can find them",
     "const tm = new THREE.InstancedMesh(treeGeo, treeMat, list.length);",
     "const tm = new THREE.InstancedMesh(treeGeo, treeMat, list.length); tm.userData.tree = true;"),
    ("phone tier: fewer cars",
     "new Traffic(scene, city.roads, 2600)",
     "new Traffic(scene, city.roads, window.__skyTier === 'phone' ? 1400 : 2600)"),
    ("phone tier: fewer pedestrians",
     "new Crowd(scene, city.walks, 2600)",
     "new Crowd(scene, city.walks, window.__skyTier === 'phone' ? 1000 : 2600)"),
    ("phone tier: 'low' quality keeps 1.25x on phones instead of 1x",
     "hi ? 1.5 : 1.0",
     "hi ? 1.5 : (window.__skyTier === 'phone' ? 1.25 : 1.0)"),
    ("phone tier: start phones at 'low' (desktop keeps 'high' and the design's own fallback)",
     "if (saved && saved.q) setQuality(saved.q, true);",
     "if (saved && saved.q) setQuality(saved.q, true); else if (window.__skyTier === 'phone') setQuality('low');"),
    ("touch: a touch doesn't end the tour by itself; site.js ends it on a real drag or pinch",
     "canvas.addEventListener('pointerdown', () => { state.idle = 0; if (state.mode === 'tour') exitTour();",
     "canvas.addEventListener('pointerdown', e => { state.idle = 0; if (state.mode === 'tour' && !(e.pointerType === 'touch' && window.__skyTouchTour)) exitTour();"),
    ("touch: a tap may wobble a little more than a click and still pick a tower",
     "if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;",
     "if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > (e.pointerType === 'touch' ? 12 : 5)) return;"),
    ("chapter hook: site.js frames each chapter for the screen shape (portrait widening)",
     "function goChapter(i, ct = 0) {",
     "function goChapter(i, ct = 0) { if (window.__skyOnChapter) window.__skyOnChapter(i);"),
    ("background tabs: keep the clock running but skip drawing (tools set __skyDrawHidden to render hidden)",
     "renderer.shadowMap.needsUpdate = shadowUpdate && sun.castShadow;",
     "if (document.hidden && !window.__skyDrawHidden) { shadowRef.n = 99; return; } renderer.shadowMap.needsUpdate = shadowUpdate && sun.castShadow;"),
    ("expose the app to site.js, then boot",
     "  boot();\n}",
     "  window.__sky = { state, mirror, renderer, camera, controls, city, traffic, crowd, par, hud, startChapter, resumeTour, exitTour, showCard, hideCard, setQuality, get quality() { return quality; } };\n"
     "  dispatchEvent(new Event('sky:ready'));\n  boot();\n}"),
]


def patch_bundle(src):
    for why, anchor, repl in BUNDLE_HOOKS:
        n = src.count(anchor)
        if n != 1:
            raise SystemExit(f"bundle hook '{why}': anchor found {n}x (expected 1):\n  {anchor[:120]}")
        src = src.replace(anchor, repl)
    return "// Built by tools/shanghai_import.py from the Claude Design export — edit the design or the tool, not this file.\n" + src


def minify(src):
    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d) / "in.js", Path(d) / "out.js"
        a.write_text(src)
        # keep-names: function names survive (the render tools recognise the page's `tick`)
        subprocess.run(ESBUILD + [str(a), "--minify", "--keep-names", "--format=esm", "--legal-comments=eof", f"--outfile={b}", "--log-level=warning"], check=True)
        return b.read_text()


# ---------------------------------------------------------------- page
SITE_HEAD = """<meta name="description" content="A 3D diorama of Shanghai — Lujiazui and the Bund, from afternoon to night. Take the tour, orbit the towers, click one to meet it. Built by Wenda Wang.">
<meta name="author" content="Wenda Wang">
<meta name="theme-color" content="#07070a">
<link rel="canonical" href="https://wendawang.me/shanghai/">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23f5f2ec'/%3E%3Ctext x='32' y='45' text-anchor='middle' font-family='Georgia,Times,serif' font-size='38' fill='%232a2724'%3EW%3C/text%3E%3C/svg%3E" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="Shanghai Skyscape · 上海">
<meta property="og:description" content="A 3D diorama of Lujiazui and the Bund — take the tour, orbit the towers, scrub the day into night.">
<meta property="og:url" content="https://wendawang.me/shanghai/">
<meta property="og:image" content="https://wendawang.me/og/shanghai.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Shanghai skyscape at evening — the Huangpu bending around Lujiazui, Shanghai Tower and the Oriental Pearl on the skyline, the tour's eight chapters alongside.">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/fonts/fonts.css">
<!-- Noto Serif SC and IBM Plex Mono, cut to the characters this page uses by tools/shanghai_fonts.py; Newsreader is the site's own -->
<style>
  @font-face { font-family: 'Noto Serif SC'; font-weight: 200 900; font-display: swap; src: url(/fonts/sky-noto-serif-sc.woff2) format('woff2'); }
  @font-face { font-family: 'IBM Plex Mono'; font-weight: 400; font-display: swap; src: url(/fonts/sky-plex-mono-400.woff2) format('woff2'); }
  @font-face { font-family: 'IBM Plex Mono'; font-weight: 500; font-display: swap; src: url(/fonts/sky-plex-mono-500.woff2) format('woff2'); }
</style>"""

HOME_CSS = """  /* site addition: the way home, set like the hint line */
  #home { display: inline-block; margin-top: 14px; color: var(--dim); text-decoration: none; }
  #home:hover { color: var(--ink); }
"""


def ver(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()[:10]


def sub1(pattern, repl, s, why, flags=0):
    out, n = re.subn(pattern, lambda m: repl, s, count=0, flags=flags)
    if n != 1:
        raise SystemExit(f"page edit '{why}': pattern matched {n}x (expected 1)")
    return out


def build_page(html, bundle_v, js_v, css_v):
    s = html
    s = re.sub(r"<style data-omelette-injected>.*?</style>", "", s, flags=re.S)       # design-tool preview shims
    s = re.sub(r"<script data-omelette-injected>.*?</script>\n?", "", s, flags=re.S)
    s = re.sub(r'<template id="__bundler_thumbnail".*?</template>\n?', "", s, flags=re.S)
    s = sub1(r'<link href="https://fonts\.googleapis\.com/[^"]*" rel="stylesheet">', SITE_HEAD, s, "fonts -> site head")
    s = sub1(r"  @media \(max-width: 720px\) \{", HOME_CSS + "  @media (max-width: 720px) {", s, "home link style")
    s = sub1(r"</svg></div></header>", '</svg></div><a id="home" class="mono" href="/">&larr; wendawang.me</a></header>', s, "home link")
    s = sub1(r"</style>\n</head>", f'</style>\n<link rel="stylesheet" href="./sky/site.css?v={css_v}">\n</head>', s, "site.css")
    s = sub1(r'<script type="module" src="\./sky/bundle\.js"></script>',
             f'<script defer src="./sky/site.js?v={js_v}"></script>\n<script type="module" src="./sky/bundle.js?v={bundle_v}"></script>\n'
             '<script data-goatcounter="https://wendawang.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>', s, "scripts")
    if "omelette" in s or "fonts.googleapis" in s:
        raise SystemExit("page still references the design tool or Google Fonts")
    return s


def build(do_minify=True):
    html = (DESIGN / "shanghai-skyscape.html").read_text()
    src = patch_bundle((DESIGN / "sky" / "bundle.js").read_text())
    out = minify(src) if do_minify else src
    page = build_page(html, ver(out), ver(SITE_JS.read_bytes()), ver(SITE_CSS.read_bytes()))
    return page, out


def main():
    args = sys.argv[1:]
    if "--check" in args:
        # anchors + page edits still apply, and the deployed page points at the current site.js/css/bundle
        html = (DESIGN / "shanghai-skyscape.html").read_text()
        patch_bundle((DESIGN / "sky" / "bundle.js").read_text())
        deployed = BUNDLE.read_text()
        want = build_page(html, ver(deployed), ver(SITE_JS.read_bytes()), ver(SITE_CSS.read_bytes()))
        bad = []
        if PAGE.read_text() != want:
            bad.append("shanghai/index.html is stale (re-run tools/shanghai_import.py)")
        for marker in ("__skyTier", "__skyOnChapter", "__skyDrawHidden", "sky:ready"):
            if marker not in deployed:
                bad.append(f"deployed bundle lacks hook {marker}")
        for b in bad:
            print("FAIL", b)
        print("ok: hooks apply, page and bundle current" if not bad else "")
        sys.exit(1 if bad else 0)
    page, out = build(do_minify="--no-minify" not in args)
    BUNDLE.write_text(out)
    PAGE.write_text(page)
    print(f"shanghai/index.html  {len(page.encode()):>9,} B")
    print(f"shanghai/sky/bundle.js {len(out.encode()):>9,} B  ({len(BUNDLE_HOOKS)} hooks{'' if '--no-minify' in args else ', minified'})")


if __name__ == "__main__":
    main()
