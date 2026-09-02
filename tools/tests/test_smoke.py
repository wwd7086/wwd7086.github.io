"""Arm smoke test: two triggered passes, then a click on slot B.

Each pass changes exactly one slot and honours the physics contract; a click
on B swaps B and leaves A alone; nothing is left behind; no console errors.
"""
import asyncio
import json

from playwright.async_api import async_playwright

from _site import BUSY, GC_GLOB, LAUNCH_ARGS, LEFTOVERS, SLOT_TEXTS, Report, is_noise, serve, stat_check


async def ride(page, limit=180):
    for i in range(limit):
        await page.wait_for_timeout(100)
        if not await page.evaluate(BUSY):
            return True, (i + 1) * 0.1
    return False, limit * 0.1


async def run(base, rep):
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=LAUNCH_ARGS)
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        await page.route(GC_GLOB, lambda r: r.abort())
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.text[:150]) if m.type == "error" and not is_noise(m) else None)
        await page.goto(base + "/?smoke&noauto", wait_until="load")
        await page.wait_for_timeout(1100)
        print("initial:", await page.evaluate(SLOT_TEXTS))
        for rnd in range(2):
            before = await page.evaluate(SLOT_TEXTS)
            await page.evaluate("window.__marginalia.swap()")
            done, el = await ride(page)
            after = await page.evaluate(SLOT_TEXTS)
            st = await page.evaluate("window.__marginalia.stats()")
            changed = sum(1 for a, b in zip(before, after) if a != b)
            print(f"round {rnd+1}: {before} -> {after} in {el:.1f}s | stats={json.dumps(st)}")
            rep.check(f"round {rnd+1} completes with one slot changed", done and changed == 1)
            rep.check(f"round {rnd+1} physics", not stat_check(st), stat_check(st))
            await page.wait_for_timeout(300)
        before = await page.evaluate(SLOT_TEXTS)
        await page.click("#swapB")
        done, el = await ride(page)
        after = await page.evaluate(SLOT_TEXTS)
        rep.check("click on B swaps B only", done and before[1] != after[1] and before[0] == after[0],
                  f"{before} -> {after} in {el:.1f}s")
        rep.check("no leftover ghosts or gaps", await page.evaluate(LEFTOVERS) == 0)
        rep.check("no page errors", not errs, "; ".join(errs[:3]))
        await browser.close()


def main():
    rep = Report()
    with serve() as base:
        asyncio.run(run(base, rep))
    return rep.done()


if __name__ == "__main__":
    raise SystemExit(main())
