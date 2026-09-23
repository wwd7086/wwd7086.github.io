# Publishing toolkit

Everything needed to add an essay or refresh the social cards, with no build
system. One-time setup for the card renderer:

    pip install playwright && python3 -m playwright install chromium

## New essay

    python3 tools/new_essay.py \
      --title "My Essay Title" \
      --slug  my-essay-title \
      --desc  "One-sentence summary used by cards, lists and the feed." \
      --date  2026-09-15 \
      --x-url https://x.com/wwd7086/status/...   # optional

This creates `blog/<slug>/index.html` (write the essay in its `.prose` block —
the template's comment lists the house styles; the BlogPosting structured
data is filled in for you), renders `og/<slug>.png`, regenerates
`sitemap.xml`, and prints three paste-ready snippets: the blog list item, the
home Writing item, and the `feed.xml` entry. Paste those, update the feed's
`<updated>`, run `python3 tools/check.py`, commit, push.

## Cards

    python3 tools/render_cards.py                # home card -> og/card.png
    python3 tools/render_cards.py --title "T" --date "April 2026" --out og/slug.png

Cards render against a local server rooted at the repo, so they use the site's
own self-hosted fonts (`fonts/`) — no fonts need to be installed on the machine.
If the hero sentence changes, edit `tools/card-home.html` to match, re-render,
and commit the new `og/card.png`.

## Sitemap

    python3 tools/sitemap.py            # rewrite sitemap.xml
    python3 tools/sitemap.py --check    # is it current? (part of tools/check.py)

`lastmod` comes from git: the last commit that changed a page's `<body>` —
head housekeeping and `?v=` bumps don't count, so Google sees a date only
when a reader would see a difference. Uncommitted body edits date as today; a
fresh, uncommitted essay takes its published date. `new_essay.py` runs this
itself; after editing any page's body, run it before committing.

Every essay also carries a BlogPosting JSON-LD block (headline, description,
date, image, author → the site's Person entity); the template fills it in.

## Icons

    python3 tools/render_icons.py                # -> apple-touch-icon.png, favicon.ico

The W is set in the site's Newsreader, like the masthead. The SVG favicon in
each page head stays the primary icon for modern browsers; the ICO (16/32/48)
covers Safari, old crawlers and search-result thumbnails, and the 180px PNG
is what an iPhone shows when someone saves the site to a home screen.

## Shanghai skyscape

`/shanghai/` is imported from Wenda's Claude Design project, not written here.
The design's two files are kept untouched in `tools/shanghai/design/`
(`shanghai-skyscape.html` and `sky/bundle.js`, three.js r184 and the city in
one file), and one script turns them into the site's page:

    python3 tools/shanghai_import.py            # -> shanghai/index.html, shanghai/sky/bundle.js
    python3 tools/shanghai_import.py --check    # part of tools/check.py
    python3 tools/shanghai_import.py --no-minify   # readable bundle, for debugging

On every import it re-applies the site's changes, so a new version of the design
never loses them:

- the page: the design tool's injected script and thumbnail template removed;
  the site head (description, canonical, icons, social card) and GoatCounter
  added; a `← wendawang.me` link under the title; Google Fonts swapped for
  self-hosted files; `sky/site.css` and `sky/site.js` linked; every asset URL
  carries a content hash, so a deploy is never half-cached.
- the bundle: ten small hooks, each anchored on an exact line of the design's
  code (the import stops if any anchor has moved), then minified with esbuild
  (2.4 MB → 1.0 MB, 530 → 290 KB over the wire). The hooks expose the app as
  `window.__sky` with a `sky:ready` event, tag the street trees, read the
  device tier, let a touch skip leaving the tour, report chapter changes, and
  skip drawing while the tab is hidden.

The site's own behaviour is in `shanghai/sky/site.js` and `site.css`, and only
touch screens and phone-shaped viewports see it; a desktop with a mouse keeps
the design as-is. On phones (a coarse pointer and a short side under 600 px)
there are lighter trees in culled blocks with a far level of detail, a
reflection that leaves out trees, cars, people and small props and redraws
every other frame, fewer cars and pedestrians, and quality 'low' at 1.25×. On
tall screens the tour's establishing shots widen per chapter and lift their
subject above the caption. Phones held sideways (and very short windows) get a
compact HUD. On touch, a tap on a tower pauses the tour under its card, only a
drag or pinch leaves the tour, a floating pill resumes it, hit areas are 44 px,
page zoom stays off the HUD, and a toggle turns on tilt-to-look.

    /shanghai/?tier=phone     the phone tier on any device (?tier=full the opposite)
    /shanghai/?fps            frame-rate readout

Tools that render the page in a hidden tab (the video renders) set
`window.__skyDrawHidden = true`, since a hidden page no longer draws.
`tools/shanghai/phone-brief.md` is the matching brief for Claude Design, so
the design can take these changes over natively.

For the fonts:

    python3 tools/shanghai_fonts.py            # rebuild fonts/sky-*.woff2
    python3 tools/shanghai_fonts.py --check    # part of tools/check.py

Newsreader comes from `fonts/fonts.css`; Noto Serif SC (one variable file) and
IBM Plex Mono 400/500 are cut by Google Fonts to exactly the characters in the
page and bundle — the HUD, the tour captions, and the neon signs the city
paints onto canvas. Re-run it whenever a new version of the design lands.
The social card is `og/shanghai.jpg`, a 1200×630 frame of the tour's opening.

## Tests

    pip install playwright pillow && python3 -m playwright install chromium
    python3 tools/check.py            # quick set, ~3 min — run before every push
    python3 tools/check.py --full     # with the full 40-size sweep, ~10 min
    python3 tools/check.py --only smoke,kicker

Each file in `tools/tests/` is a standalone script that serves the repo on a
free port, drives headless Chromium, prints OK/FAIL lines and exits non-zero
on failure; `check.py` just runs them in turn:

| test            | what it guards                                                        |
|-----------------|-----------------------------------------------------------------------|
| `sitemap`       | `sitemap.xml` still matches `tools/sitemap.py` (dates from git)        |
| `sky-fonts`     | the skyscape's font subsets still cover every character it uses        |
| `sky-import`    | the skyscape's bundle hooks still apply, and the deployed page is current |
| `kicker`        | the hero kicker stays on one line at every desktop width               |
| `polish`        | icons served, font preloads used, AA palette, print sheet              |
| `smoke`         | two arm passes + a click on slot B: one slot per pass, physics contract |
| `cadence`       | the first surprise pass at ~3s; the masthead floats and lands          |
| `cursor`        | margin scenes light under the cursor, aligned with their text block    |
| `scroll-return` | the greeting after a deep scroll and a half-second settle at the top   |
| `sweep`         | the arm at 40 window sizes (`--quick`: the three marked sizes)         |

The physics contract lives in `tests/_site.py::stat_check`: fixed link length,
a carriage that never stops, sub-3px lock, pixel-continuous pick-up and set-down.
`tests/film.py` records a pass as video (desktop and phone) for frame-by-frame
looks; outputs land in `tools/tests/out/` (gitignored). Tests load the pages
with `?noauto` where they drive the arm themselves — that flag turns off the
page's own timers and the scroll-return greeting.

## House rules

- Text colours (`--ink-3`, `--accent`, `--accent-2`) hold at least 4.5:1 against
  `--bg` in both schemes (WCAG AA for small text). The canvases and the cursor
  draw with the lighter `--draw-*` siblings — hairlines are decorative and are
  tuned to whisper — so a legibility tweak never changes the drawings.
- Every page head preloads the three first-paint fonts (Latin Newsreader,
  Latin Inter, the 王闻达 subset). Their URLs must match `fonts/fonts.css`
  exactly, `crossorigin` included, or the browser downloads each twice.
- `@media print` at the foot of `style.css` strips the machinery for paper:
  canvases, cursor, nav, buoyancy; black on white; external article links
  print their URLs.

- Any `style.css` change: bump `?v=N` on the stylesheet link in **all** pages
  that reference it (home, blog index, every essay). Any `marginalia.js`
  change: bump its `?v=N` the same way. Stale caches otherwise serve the old
  file for ~10 minutes — or longer.
- The lede's two swap slots, the arm, and the margin scenes live in
  `marginalia.js`; after touching it, run `python3 tools/check.py` (and the
  `--full` sweep for anything that changes the arm's motion) before pushing.
- GitHub Pages builds in ~30s after push; the CDN caches HTML for ~10 minutes,
  so check changes with a query string (`/?anything`) right after deploying.

## Analytics (GoatCounter)

The site counts pageviews and three custom events — `arm-swap` (every completed
word swap), `arm-summon` (a visitor clicking/keying a term to call the arm), and
`arm-return` (the greeting pass when a reader scrolls back to the top after a
deep excursion).
The event calls are already in `marginalia.js` and no-op until the counter
script is present. To activate:

Active since Aug 2026 with site code `wendawang` — dashboard at
https://wendawang.goatcounter.com. Every page carries this tag just above
`</body>` (a new essay gets it from the template):

    <script data-goatcounter="https://wendawang.goatcounter.com/count"
            async src="//gc.zgo.at/count.js"></script>

No cookies, no consent banner needed. Expect ad-blockers to undercount.
