"""The page's own rhythm: the first surprise pass ~3s after load, with no click
and no scroll; and the masthead detaches into its floating pill on scroll and
settles back at the top."""
import asyncio

from playwright.async_api import async_playwright

from _site import BUSY, GC_GLOB, LAUNCH_ARGS, OUT, SLOT_TEXTS, Report, serve


async def run(base, rep):
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=LAUNCH_ARGS)
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        await page.route(GC_GLOB, lambda r: r.abort())
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(base + "/?cadence", wait_until="domcontentloaded")
        t0 = await page.evaluate(SLOT_TEXTS)
        # the surprise: a pass should start on its own at ~3s
        started = None
        for i in range(60):
            await page.wait_for_timeout(100)
            if await page.evaluate(BUSY):
                started = (i + 1) * 0.1
                break
        rep.check("first pass starts on its own", started is not None and 2.0 <= started <= 5.0,
                  f"after {started}s (expect ~3s)")
        for _ in range(120):
            await page.wait_for_timeout(100)
            if not await page.evaluate(BUSY):
                break
        t1 = await page.evaluate(SLOT_TEXTS)
        rep.check("first pass changed one slot", sum(a != b for a, b in zip(t0, t1)) == 1, f"{t0} -> {t1}")

        # the floating masthead
        a0 = await page.evaluate("document.querySelector('.top').classList.contains('afloat')")
        await page.mouse.wheel(0, 600)
        await page.wait_for_timeout(700)
        a1 = await page.evaluate("document.querySelector('.top').classList.contains('afloat')")
        pos = await page.evaluate("getComputedStyle(document.querySelector('.top')).position")
        top_r = await page.evaluate("document.querySelector('.top').getBoundingClientRect().top")
        await page.screenshot(path=str(OUT / "masthead_afloat.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 220})
        await page.evaluate("scrollTo(0, 0)")
        await page.wait_for_timeout(700)
        a2 = await page.evaluate("document.querySelector('.top').classList.contains('afloat')")
        rep.check("masthead floats while scrolled and lands again at the top",
                  pos == "sticky" and not a0 and a1 and not a2 and 0 <= top_r <= 20,
                  f"sticky={pos == 'sticky'} top@scroll={top_r:.0f}px afloat 0/600/0 = {a0}/{a1}/{a2}")
        rep.check("no page errors", not errs, "; ".join(errs[:3]))
        await browser.close()


def main():
    rep = Report()
    with serve() as base:
        asyncio.run(run(base, rep))
    return rep.done()


if __name__ == "__main__":
    raise SystemExit(main())
