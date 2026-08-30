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

## House rules

- Any `style.css` change: bump `?v=N` on the stylesheet link in **all** pages
  that reference it (home, blog index, every essay). Any `marginalia.js`
  change: bump its `?v=N` the same way. Stale caches otherwise serve the old
  file for ~10 minutes — or longer.
- The lede's two swap slots, the arm, and the margin scenes live in
  `marginalia.js`; after touching it, run a swap locally before pushing.
- GitHub Pages builds in ~30s after push; the CDN caches HTML for ~10 minutes,
  so check changes with a query string (`/?anything`) right after deploying.

## Analytics (GoatCounter)

The site counts pageviews and two custom events — `arm-swap` (every completed
word swap) and `arm-summon` (a visitor clicking/keying a term to call the arm).
The event calls are already in `marginalia.js` and no-op until the counter
script is present. To activate:

1. Create the (free) account at https://www.goatcounter.com — pick a site code
   (e.g. `wendawang`) and set the site URL to https://wendawang.me.
2. Add this tag just above `</body>` on every page (home, blog index, essays),
   with your code in place of `SITECODE`:

       <script data-goatcounter="https://SITECODE.goatcounter.com/count"
               async src="//gc.zgo.at/count.js"></script>

No cookies, no consent banner needed. Expect ad-blockers to undercount.
