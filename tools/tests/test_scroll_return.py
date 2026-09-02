"""The scroll-return greeting: a deep excursion, then settling at the top for
half a second, summons one pass.

Covers: the greeting fires after the delay; a mid-wait scroll-away cancels it
but leaves it armed; one greeting per excursion (nothing piles on); ?noauto
disables it; a window with under 480px of travel never arms it.
"""
import time

from playwright.sync_api import sync_playwright

from _site import BUSY, GC_GLOB, LAUNCH_ARGS, Report, serve

SLOTS = "() => [...document.querySelectorAll('#swapA, #swapB')].map(e => e.textContent.trim())"


def wait_idle(pg, timeout=9.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if not pg.evaluate(BUSY):
            return True
        pg.wait_for_timeout(120)
    return False


def wait_busy(pg, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pg.evaluate(BUSY):
            return time.time() - t0
        pg.wait_for_timeout(60)
    return None


def bottom(pg):
    pg.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")


def main():
    rep = Report()
    with serve() as base, sync_playwright() as p:
        b = p.chromium.launch(args=LAUNCH_ARGS)
        pg = b.new_page(viewport={"width": 1153, "height": 853})
        pg.route(GC_GLOB, lambda r: r.abort())

        pg.goto(base + "/?sret", wait_until="domcontentloaded")
        pg.wait_for_timeout(3400)                       # the first-load pass starts at 3s
        rep.check("first-load pass ran and finished", wait_idle(pg))
        before = pg.evaluate(SLOTS)

        bottom(pg); pg.wait_for_timeout(400)
        pg.evaluate("window.scrollTo(0, 0)")
        dt = wait_busy(pg, 3.0)
        rep.check("greeting fires after the return", dt is not None, f"after {dt and round(dt, 2)}s")
        rep.check("respects the half-second settle", dt is not None and dt >= 0.45)
        wait_idle(pg)
        after = pg.evaluate(SLOTS)
        rep.check("exactly one slot changed", sum(a != z for a, z in zip(before, after)) == 1, f"{before} -> {after}")

        quiet = wait_busy(pg, 6.0)
        rep.check("no second pass piles on", quiet is None, f"pass after {quiet and round(quiet, 2)}s" if quiet else "")

        bottom(pg); pg.wait_for_timeout(300)
        pg.evaluate("window.scrollTo(0, 0)")
        pg.wait_for_timeout(200)                        # inside the 500ms settle window
        pg.evaluate("window.scrollTo(0, 900)")
        rep.check("scroll-away cancels the settle", wait_busy(pg, 1.6) is None)
        pg.evaluate("window.scrollTo(0, 0)")
        dt = wait_busy(pg, 3.0)
        rep.check("still armed after the cancel", dt is not None, f"after {dt and round(dt, 2)}s")
        wait_idle(pg)

        pg.goto(base + "/?sret&noauto", wait_until="domcontentloaded")
        pg.wait_for_timeout(600)
        bottom(pg); pg.wait_for_timeout(400)
        pg.evaluate("window.scrollTo(0, 0)")
        rep.check("noauto: no greeting", wait_busy(pg, 2.2) is None)

        errors = []
        pg2 = b.new_page(viewport={"width": 1153, "height": 3010})   # under 480px of travel
        pg2.route(GC_GLOB, lambda r: r.abort())
        pg2.on("pageerror", lambda e: errors.append(str(e)))
        pg2.goto(base + "/?sret", wait_until="domcontentloaded")
        pg2.wait_for_timeout(3400)
        wait_idle(pg2)
        r = pg2.evaluate("() => document.documentElement.scrollHeight - innerHeight")
        bottom(pg2); pg2.wait_for_timeout(300)
        pg2.evaluate("window.scrollTo(0, 0)")
        rep.check("shallow-travel window never arms", 24 < r < 480 and wait_busy(pg2, 2.2) is None and not errors,
                  f"range={r} errors={errors}")
        b.close()
    return rep.done()


if __name__ == "__main__":
    raise SystemExit(main())
