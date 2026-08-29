# wwd7086.github.io

Personal site for Wenda Wang, served by GitHub Pages at <https://wwd7086.github.io>.

Plain static HTML — no build step.

- `index.html` — home page
- `blog/index.html` — writing index
- `blog/<slug>/index.html` — one page per essay
- `style.css` — shared styles
- the marginalia: the interactive margin element lives inline in `index.html` (scene per section: arm / attention / Jansen leg / driving tracker); it hides below ~1080px windows and under reduced-motion preferences
- `feed.xml` — Atom feed for the essays
- `fonts/` — self-hosted Newsreader + Inter (woff2, SIL OFL); loaded via `fonts/fonts.css`
- `og/` — social-card images referenced by the `og:image` tags
- `sitemap.xml`, `robots.txt` — search-engine plumbing; JSON-LD Person lives in `index.html`

To add an essay: copy an existing `blog/<slug>/` folder, edit the content, then add it to
`blog/index.html`, the Writing section of `index.html`, and `feed.xml`.
