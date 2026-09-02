"""Shared plumbing for the site's browser tests.

Every test serves the repo itself on a free local port, so the pages load their
real self-hosted fonts, stylesheet and script. Nothing here writes into the
repo: screenshots and recordings go to tools/tests/out/ (gitignored).

Needs:  pip install playwright pillow && python3 -m playwright install chromium
"""
import contextlib
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # tools/tests/_site.py -> repo root
OUT = Path(__file__).resolve().parent / "out"
OUT.mkdir(exist_ok=True)

# Harmless on a normal machine; required in sandboxes that route Chromium
# through a proxy that cannot see 127.0.0.1.
LAUNCH_ARGS = ["--no-proxy-server"]

# The visitor counter: abort it so tests never hit the network (its absence
# also logs a resource error that is_noise() filters out).
GC_GLOB = "**gc.zgo.at/**"

# JS snippets shared across tests
SLOT_TEXTS = "[document.getElementById('swapA').textContent.trim(), document.getElementById('swapB').textContent.trim()]"
BUSY = "window.__marginalia.busy()"
LEFTOVERS = "document.querySelectorAll('.swap.carried, .swap-gap').length"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def serve():
    """Serve the repo root; yields the base URL (no trailing slash)."""
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(base + "/robots.txt", timeout=0.5)
                break
            except Exception:
                time.sleep(0.1)
        yield base
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def is_noise(msg):
    """Console messages that are not the site's fault: the aborted counter script."""
    loc = getattr(msg, "location", None) or {}
    url = loc.get("url", "") if isinstance(loc, dict) else ""
    return "gc.zgo.at" in url or ("Failed to load resource" in msg.text and not url)


def stat_check(st):
    """The arm's physics contract, as a string of violations ('' when clean)."""
    if not st:
        return "no stats"
    bad = []
    if not st.get("completed"):
        bad.append("aborted")
    if st.get("LVar", 9) > 0.01:
        bad.append(f"LVar={st['LVar']:.3f}")            # the arm never stretches
    if st.get("vAbsMin", 0) < 6:
        bad.append(f"vmin={st['vAbsMin']:.1f}")         # the carriage never stops
    if st.get("lockErrMax", 9) > 2.5:
        bad.append(f"lockErr={st['lockErrMax']:.2f}")   # the grip stays locked to the word
    if not (0 <= st.get("graspJump", -1) < 1.5):
        bad.append(f"graspJump={st.get('graspJump')}")  # pixel-continuous pick-up
    if not (0 <= st.get("releaseJump", -1) < 1.5):
        bad.append(f"relJump={st.get('releaseJump')}")  # ...and set-down
    return "; ".join(bad)


class Report:
    """Tiny OK/FAIL ledger; main() returns its failure count as the exit code."""

    def __init__(self):
        self.fails = []

    def check(self, name, ok, detail=""):
        print(f"{'OK  ' if ok else 'FAIL'} {name}  {detail}".rstrip(), flush=True)
        if not ok:
            self.fails.append(name)
        return ok

    def done(self):
        print("RESULT:", "PASS" if not self.fails else f"FAIL {self.fails}", flush=True)
        return len(self.fails)
