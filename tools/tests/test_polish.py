"""Page hygiene: icons served, font preloads used (no Chrome warnings), text
palette at its AA values with the drawings on their lighter siblings, and the
print sheet stripping the machinery."""
import urllib.request

from playwright.sync_api import sync_playwright

from _site import GC_GLOB, LAUNCH_ARGS, OUT, Report, serve

PAGES = ["/?noauto", "/blog/?noauto", "/blog/two-paradigms-of-ai/?noauto", "/blog/llm-is-the-new-compiler/?noauto", "/404.html"]
TEXT_TOKENS = ["#726b63", "#61705f"]         # light --ink-3, --accent (>= 4.5:1 on --bg)
DRAW_TOKENS = ["#8f8880", "#7c8c79"]         # light --draw-ink-3, --draw-accent


def main():
    rep = Report()
    with serve() as base:
        for path, kind in [("/favicon.ico", "image"), ("/apple-touch-icon.png", "image/png")]:
            r = urllib.request.urlopen(base + path)
            rep.check(f"{path} served", r.status == 200 and kind in r.headers.get("Content-Type", ""),
                      f"{r.status} {r.headers.get('Content-Type')} {len(r.read())}B")

        with sync_playwright() as p:
            b = p.chromium.launch(args=LAUNCH_ARGS)
            for path in PAGES:
                pg = b.new_page(viewport={"width": 1280, "height": 853})
                pg.route(GC_GLOB, lambda r: r.abort())
                msgs = []
                pg.on("console", lambda m: msgs.append(m.text))
                pg.on("pageerror", lambda e: msgs.append("PAGEERROR " + str(e)))
                pg.goto(base + path, wait_until="load")
                pg.wait_for_timeout(4500)        # Chrome's unused-preload warning lands a few seconds after load
                bad = [m for m in msgs if "preload" in m.lower() or "PAGEERROR" in m]
                rep.check(f"{path} no preload warnings or errors", not bad, "; ".join(bad)[:300])
                tok = pg.evaluate("""() => { const cs = getComputedStyle(document.documentElement);
                  return ['--ink-3','--accent','--draw-ink-3','--draw-accent'].map(k => cs.getPropertyValue(k).trim()); }""")
                rep.check(f"{path} palette tokens", tok[:2] == TEXT_TOKENS and tok[2:] == DRAW_TOKENS, str(tok))
                pg.close()

            pg = b.new_page(viewport={"width": 1280, "height": 853})
            pg.route(GC_GLOB, lambda r: r.abort())
            pg.goto(base + "/?noauto", wait_until="load")
            pg.wait_for_timeout(500)
            dot = pg.evaluate("() => getComputedStyle(document.querySelector('.cur-dot')).backgroundColor")
            rep.check("cursor dot keeps the drawing green", dot == "rgb(124, 140, 121)", dot)

            for path in ["/?noauto", "/blog/two-paradigms-of-ai/?noauto"]:
                pg.goto(base + path, wait_until="load")
                pg.wait_for_timeout(300)
                pg.emulate_media(media="print")
                r = pg.evaluate("""() => {
                  const d = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'absent'; };
                  return { rig: d('.rig'), gantry: d('.gantry'), nav: d('.top nav'), dot: d('.cur-dot'),
                           topPos: getComputedStyle(document.querySelector('.top')).position,
                           bg: getComputedStyle(document.documentElement).backgroundColor,
                           ink: getComputedStyle(document.body).color };
                }""")
                ok = (r["rig"] in ("none", "absent") and r["gantry"] in ("none", "absent") and r["nav"] == "none"
                      and r["dot"] in ("none", "absent") and r["topPos"] == "static"
                      and r["bg"] == "rgb(255, 255, 255)" and r["ink"] == "rgb(0, 0, 0)")
                rep.check(f"{path} print sheet", ok, str(r))
                name = "home" if path.startswith("/?") else "essay"
                pg.screenshot(path=str(OUT / f"print_{name}.png"))
                pg.emulate_media(media="screen")
            b.close()
    return rep.done()


if __name__ == "__main__":
    raise SystemExit(main())
