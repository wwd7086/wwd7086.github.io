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
