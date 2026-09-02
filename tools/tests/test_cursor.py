"""Tall-window check for the margin scenes: they light up under the cursor AND
sit vertically aligned with the text block they belong to (ink bounding-box
centre within 150px of the entry's centre). Over the hero, nothing draws."""
import asyncio

from playwright.async_api import async_playwright

from _site import GC_GLOB, LAUNCH_ARGS, Report, serve

RIG_BOX = """() => {
  const cv = document.querySelector('.rig canvas');
  const cx = cv.getContext('2d');
  const d = cx.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0, yMin = 1e9, yMax = -1e9;
  const W = cv.width;
  for (let i = 3; i < d.length; i += 16) {
    if (d[i] > 8) {
      n++;
      const y = Math.floor((i >> 2) / W);
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }
  }
  return { n, yc: n ? (yMin + yMax) / 2 : -1 };
}"""


async def run(base, rep):
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=LAUNCH_ARGS)
        page = await browser.new_page(viewport={"width": 1440, "height": 2400})
        await page.route(GC_GLOB, lambda r: r.abort())
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(base + "/?cursor&noauto", wait_until="load")
        await page.wait_for_timeout(1200)
        info = await page.evaluate("""() => {
          const mid = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
          return { hero: 200, now: mid('#elorian'), noble: mid('#noble'), apple: mid('#apple'), h: innerHeight };
        }""")
        print("entry centres:", info)
        for name in ["hero", "now", "noble", "apple"]:
            y = min(info[name], info["h"] - 30)
            await page.mouse.move(700, y)
            await page.wait_for_timeout(250)
            await page.mouse.move(702, y)
            await page.wait_for_timeout(1500)
            b = await page.evaluate(RIG_BOX)
            if name == "hero":
                rep.check("nothing drawn over the hero", b["n"] == 0, f"ink={b['n']}")
            else:
                d = abs(b["yc"] - info[name]) if b["n"] else 1e9
                rep.check(f"{name} scene lit and aligned", b["n"] > 0 and d < 150,
                          f"ink={b['n']} inkCentre={b['yc']:.0f} entryCentre={info[name]} off={d:.0f}")
        rep.check("no page errors", not errs, "; ".join(errs[:3]))
        await browser.close()


def main():
    rep = Report()
    with serve() as base:
        asyncio.run(run(base, rep))
    return rep.done()


if __name__ == "__main__":
    raise SystemExit(main())
