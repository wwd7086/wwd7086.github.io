#!/usr/bin/env python3
"""Run the site's browser tests before a push.

    python3 tools/check.py                 # the quick set (~3 min): sitemap, kicker, polish,
                                           #   smoke, cadence, cursor, scroll-return, sweep --quick
    python3 tools/check.py --full          # ...with the full 40-size sweep instead (~10 min)
    python3 tools/check.py --only smoke,kicker

Each test serves the repo on its own port and exits non-zero on failure; this
just runs them in turn and prints a summary. Needs playwright (chromium) and
Pillow — see tools/README.md.
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TESTS = HERE / "tests"

ORDER = [
    ("sitemap", ["../sitemap.py", "--check"]),      # lastmod dates still match git
    ("kicker", ["test_kicker.py"]),
    ("polish", ["test_polish.py"]),
    ("smoke", ["test_smoke.py"]),
    ("cadence", ["test_cadence.py"]),
    ("cursor", ["test_cursor.py"]),
    ("scroll-return", ["test_scroll_return.py"]),
    ("sweep", ["test_sweep.py", "--quick"]),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="run the full 40-size sweep")
    ap.add_argument("--only", default="", help="comma-separated test names")
    a = ap.parse_args()

    picks = [n.strip() for n in a.only.split(",") if n.strip()]
    plan = [(n, args) for n, args in ORDER if not picks or n in picks]
    if a.full:
        plan = [(n, [x for x in args if x != "--quick"]) for n, args in plan]

    results = []
    for name, args in plan:
        print(f"\n=== {name} ===", flush=True)
        t0 = time.time()
        proc = subprocess.run([sys.executable, str(TESTS / args[0]), *args[1:]], cwd=TESTS,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        el = time.time() - t0
        lines = proc.stdout.rstrip().splitlines()
        # the full log on failure; the verdict line and a few before it on success
        for line in (lines if proc.returncode else lines[-6:]):
            print("  " + line)
        results.append((name, proc.returncode == 0, el))

    print("\n" + "-" * 48)
    for name, ok, el in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name:<14} {el:6.1f}s")
    bad = [n for n, ok, _ in results if not ok]
    print("-" * 48)
    print("ALL GREEN" if not bad else f"FAILING: {', '.join(bad)}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
