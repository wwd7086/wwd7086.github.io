"""Record one arm pass as video, desktop and phone, into tools/tests/out/.
Not a test — a way to look at the motion frame by frame.

    python3 tools/tests/film.py
    ffmpeg -i tools/tests/out/desk.webm -vf "fps=12,scale=640:-1,tile=6x8" tools/tests/out/desk_sheet.png
"""
import asyncio
import glob
import shutil

from playwright.async_api import async_playwright

from _site import BUSY, GC_GLOB, LAUNCH_ARGS, OUT, serve

SIZES = [(1280, 800, "desk"), (390, 844, "phone")]


async def film(browser, base, w, h, name):
    vd = OUT / f"vid_{name}"
    shutil.rmtree(vd, ignore_errors=True)
    ctx = await browser.new_context(viewport={"width": w, "height": h},
                                    record_video_dir=str(vd), record_video_size={"width": w, "height": h})
    page = await ctx.new_page()
    await page.route(GC_GLOB, lambda r: r.abort())
    await page.goto(base + "/?film&noauto", wait_until="load")
    await page.wait_for_timeout(1200)
    ok = await page.evaluate("window.__marginalia.swap()")
    done = False
    for _ in range(160):
        await page.wait_for_timeout(100)
        if not await page.evaluate(BUSY):
            done = True
            break
    await page.wait_for_timeout(500)
    st = await page.evaluate("window.__marginalia.stats()")
    await ctx.close()
    shutil.move(glob.glob(f"{vd}/*.webm")[0], OUT / f"{name}.webm")
    shutil.rmtree(vd, ignore_errors=True)
    print(name, "| started:", ok, "| done:", done, "| stats:", st, "| ->", OUT / f"{name}.webm")


async def run(base):
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=LAUNCH_ARGS)
        for w, h, n in SIZES:
            await film(browser, base, w, h, n)
        await browser.close()


if __name__ == "__main__":
    with serve() as base:
        asyncio.run(run(base))
