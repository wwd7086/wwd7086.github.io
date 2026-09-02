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
the template's comment lists the house styles), renders `og/<slug>.png`, and
prints four paste-ready snippets: the blog list item, the home Writing item,
the `feed.xml` entry, and the `sitemap.xml` line. Paste those, update the
feed's `<updated>` and the sitemap's `/` + `/blog/` lastmod dates, commit, push.

## Cards

    python3 tools/render_cards.py                # home card -> og/card.png
    python3 tools/render_cards.py --title "T" --date "April 2026" --out og/slug.png

Cards render against a local server rooted at the repo, so they use the site's
own self-hosted fonts (`fonts/`) — no fonts need to be installed on the machine.
If the hero sentence changes, edit `tools/card-home.html` to match, re-render,
and commit the new `og/card.png`.

## Icons

    python3 tools/render_icons.py                # -> apple-touch-icon.png, favicon.ico

The W is set in the site's Newsreader, like the masthead. The SVG favicon in
each page head stays the primary icon for modern browsers; the ICO (16/32/48)
covers Safari, old crawlers and search-result thumbnails, and the 180px PNG
is what an iPhone shows when someone saves the site to a home screen.

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
  `marginalia.js`; after touching it, run a swap locally before pushing.
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
