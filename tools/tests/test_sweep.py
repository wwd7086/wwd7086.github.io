"""Window-size robustness sweep for the two-slot gantry word swap.

Every size runs two passes (three at the marked sizes) so both slots get
exercised. Each pass must complete with exactly one slot changed, both slots
re-seated in flow, no leftover ghosts, no console errors — and the physics
contract: fixed link length, never-stopping carriage, sub-3px lock, and
pixel-continuous exchanges.

    python3 tools/tests/test_sweep.py            # all 40 sizes (~8 min)
    python3 tools/tests/test_sweep.py --quick    # the three marked sizes (~1 min)
"""
import asyncio
import sys

from playwright.async_api import async_playwright

from _site import BUSY, GC_GLOB, LAUNCH_ARGS, LEFTOVERS, SLOT_TEXTS, is_noise, serve, stat_check

WIDTHS = [390, 430, 768, 1081, 1153, 1280, 1440, 1728, 1920, 2560]
HEIGHTS = [620, 853, 1200, 2416]
TRIPLE = {(1153, 853), (390, 853), (1920, 1200)}

POLL_S = 0.1
LIMIT_S = 20.0


async def one_swap(page):
    ok = await page.evaluate("window.__marginalia.swap()")
    if not ok and not await page.evaluate(BUSY):
        return False, 0.0, "startPass refused"
    for i in range(int(LIMIT_S / POLL_S)):
        await page.wait_for_timeout(int(POLL_S * 1000))
        if not await page.evaluate(BUSY):
            return True, (i + 1) * POLL_S, ""
    return False, LIMIT_S, "still busy"


async def test_size(browser, base, w, h):
    ctx = await browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    page = await ctx.new_page()
    await page.route(GC_GLOB, lambda r: r.abort())
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror:{e}"))
    page.on("console", lambda m: errors.append(f"console:{m.text[:120]}") if m.type == "error" and not is_noise(m) else None)
    res = {"size": f"{w}x{h}", "ok": False, "why": ""}
    try:
        await page.goto(base + "/?sweep&noauto", wait_until="load", timeout=15000)
        await page.wait_for_timeout(1100)
        if not await page.evaluate("!!(window.__marginalia && window.__marginalia.swap)"):
            res["why"] = "no dev hook"
            await ctx.close()
            return res
        rounds = 3 if (w, h) in TRIPLE else 2
        trail = [" + ".join(await page.evaluate(SLOT_TEXTS))]
        total = 0.0
        for r in range(rounds):
            before = await page.evaluate(SLOT_TEXTS)
            done, el, why = await one_swap(page)
            total += el
            after = await page.evaluate(SLOT_TEXTS)
            if not done:
                res["why"] = f"round {r+1}: {why} ({before}->{after})"
                await ctx.close()
                return res
            changed = sum(1 for a, b in zip(before, after) if a != b)
            if changed != 1:
                res["why"] = f"round {r+1}: {changed} slots changed ({before}->{after})"
                await ctx.close()
                return res
            trail.append(" + ".join(after))
            sbad = stat_check(await page.evaluate("window.__marginalia.stats()"))
            if sbad:
                res["why"] = f"round {r+1}: {sbad}"
                await ctx.close()
                return res
            if r + 1 < rounds:
                await page.wait_for_timeout(400)
        leftovers = await page.evaluate(LEFTOVERS)
        posbad = await page.evaluate(
            "['swapA','swapB'].filter((i) => getComputedStyle(document.getElementById(i)).position === 'fixed').length"
        )
        if leftovers:
            res["why"] = f"{leftovers} leftover ghost/gap nodes"
        elif posbad:
            res["why"] = "a slot was left position:fixed"
        elif errors:
            res["why"] = "errors: " + "; ".join(errors[:3])
        else:
            res["ok"] = True
            res["why"] = " -> ".join(trail[-2:]) + f" ({rounds} passes, {total:.1f}s)"
    except Exception as e:  # noqa: BLE001
        res["why"] = f"exception: {str(e)[:160]}"
    await ctx.close()
    return res


async def run(base, sizes):
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=LAUNCH_ARGS)
        for w, h in sizes:
            r = await test_size(browser, base, w, h)
            print(f"{'PASS' if r['ok'] else 'FAIL'}  {r['size']:>10}  {r['why']}", flush=True)
            results.append(r)
        await browser.close()
    return results


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    quick = "--quick" in argv
    sizes = sorted(TRIPLE) if quick else [(w, h) for h in HEIGHTS for w in WIDTHS]
    with serve() as base:
        results = asyncio.run(run(base, sizes))
    fails = [r for r in results if not r["ok"]]
    print(f"\n{len(results) - len(fails)}/{len(results)} sizes pass")
    if fails:
        print("FAILING:", ", ".join(r["size"] for r in fails))
    return len(fails)


if __name__ == "__main__":
    raise SystemExit(main())
