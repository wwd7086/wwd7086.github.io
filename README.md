# wendawang.me

Personal site for Wenda Wang, served by GitHub Pages at <https://wendawang.me> (custom domain set by the `CNAME` file; the old wwd7086.github.io address redirects there).

Plain static HTML — no build step.

- `index.html` — home page
- `blog/index.html` — writing index
- `blog/<slug>/index.html` — one page per essay
- `style.css` — shared styles
- `marginalia.js` — the interactive element. Desktop: a fixed margin canvas whose scene follows the section (arm / attention / Jansen leg / driving tracker), with the arm periodically swapping the rotating term in the lede. Phones: the same scenes as small in-flow vignette bands under their sections, touch-reactive. Static under reduced-motion.
- `feed.xml` — Atom feed for the essays
- `fonts/` — self-hosted Newsreader + Inter (woff2, SIL OFL); loaded via `fonts/fonts.css`
- `og/` — social-card images referenced by the `og:image` tags
- `sitemap.xml`, `robots.txt` — search-engine plumbing; JSON-LD Person lives in `index.html`

To add an essay: copy an existing `blog/<slug>/` folder, edit the content, then add it to
`blog/index.html`, the Writing section of `index.html`, and `feed.xml`.
