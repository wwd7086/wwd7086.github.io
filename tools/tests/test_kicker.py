"""The hero kicker stays on one line at every width that fits the full column
(viewport >= 700px), and wraps gracefully below that."""
from playwright.sync_api import sync_playwright

from _site import GC_GLOB, LAUNCH_ARGS, Report, serve

JS = """() => {
  const k = document.querySelector('.kicker');
  const spans = [...k.children];
  const lines = new Set(spans.map(s => s.offsetTop)).size;
  const total = spans.reduce((a, s) => a + s.getBoundingClientRect().width, 0);
  return { lines, total, have: k.clientWidth };
}"""

DESKTOP = [3840, 2560, 1920, 1728, 1440, 1280, 1153, 1081, 968, 830, 768, 700]
PHONE = [640, 560, 430, 390, 320]


def main():
    rep = Report()
    with serve() as base, sync_playwright() as p:
        b = p.chromium.launch(args=LAUNCH_ARGS)
        pg = b.new_page(viewport={"width": 1440, "height": 900})
        pg.route(GC_GLOB, lambda r: r.abort())
        pg.goto(base + "/?noauto", wait_until="domcontentloaded")
        pg.wait_for_timeout(400)
        for w in DESKTOP + PHONE:
            pg.set_viewport_size({"width": w, "height": 900})
            pg.wait_for_timeout(120)
            r = pg.evaluate(JS)
            slack = r["have"] - r["total"]
            detail = f"lines={r['lines']} need={r['total']:.0f} have={r['have']} slack={slack:+.0f}"
            if w in DESKTOP:
                rep.check(f"{w}px one line", r["lines"] == 1, detail)
            else:
                print(f"      {w}px wraps: {detail}")
        b.close()
    return rep.done()


if __name__ == "__main__":
    raise SystemExit(main())
