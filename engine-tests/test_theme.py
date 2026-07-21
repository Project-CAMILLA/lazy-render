#!/usr/bin/env python3
"""
Fixture-driven test of the page theme-override engine
(src/engine/theme-inject.js) — the CSS filter that forces a light/dark/true-dark
look onto ChatGPT/Claude regardless of what those sites support natively.

The engine detects the page's current background first and only inverts when the
page doesn't already match the requested mode (a naive unconditional invert
would flip an already-dark page to light — the exact bug this replaced). So we
test against BOTH a dark-default page and a light-default page.

Run: python3 engine-tests/test_theme.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENGINE = (ROOT / "src" / "engine" / "theme-inject.js").read_text()

# Media elements present so we can assert the counter-invert on images. The
# body gets an explicit background so detection is deterministic. min-height
# ensures the sampled viewport points land on the body background.
def fixture(bg, fg):
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body {{ margin:0; }}
  body {{ background:{bg}; color:{fg}; min-height:100vh; }}
</style></head>
<body>
  <p id="text">hello</p>
  <img id="photo" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7" />
  <div id="bgdiv" style="background-image:url(data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7); width:10px; height:10px;"></div>
</body></html>
"""

failures = []


def check(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def html_filter(page):
    return page.evaluate("() => getComputedStyle(document.documentElement).filter")


def apply(page, mode):
    page.evaluate(f"() => window.__lazyRenderTheme.apply('{mode}')")


def is_none(f):
    return f in ("none", "")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])

        # ---- Case 1: a DARK-default page (like Claude/ChatGPT) ----
        page = browser.new_page(viewport={"width": 900, "height": 700})
        page.set_content(fixture("#111111", "#eeeeee"))
        page.evaluate(ENGINE)
        check("installs window.__lazyRenderTheme", page.evaluate("() => !!window.__lazyRenderTheme"))

        apply(page, "dark")
        f = html_filter(page)
        check("[dark page] Dark leaves an already-dark page untouched", is_none(f), f)

        apply(page, "light")
        f = html_filter(page)
        check("[dark page] Light inverts a dark page to light", "invert" in f, f)
        img_f = page.evaluate("() => getComputedStyle(document.querySelector('#photo')).filter")
        bg_f = page.evaluate("() => getComputedStyle(document.querySelector('#bgdiv')).filter")
        check("[dark page] Light counter-inverts <img>", "invert" in img_f, img_f)
        check("[dark page] Light counter-inverts a CSS background-image div", "invert" in bg_f, bg_f)

        apply(page, "trueDark")
        f = html_filter(page)
        check("[dark page] True Dark stays dark (no invert on a dark page)", "invert" not in f, f)
        check("[dark page] True Dark crushes toward black (brightness/contrast)",
              "brightness" in f and "contrast" in f, f)
        page.close()

        # ---- Case 2: a LIGHT-default page ----
        page = browser.new_page(viewport={"width": 900, "height": 700})
        page.set_content(fixture("#ffffff", "#111111"))
        page.evaluate(ENGINE)

        apply(page, "light")
        f = html_filter(page)
        check("[light page] Light leaves an already-light page untouched", is_none(f), f)

        apply(page, "dark")
        f = html_filter(page)
        check("[light page] Dark inverts a light page to dark", "invert" in f, f)

        apply(page, "trueDark")
        f = html_filter(page)
        check("[light page] True Dark inverts a light page", "invert" in f, f)
        check("[light page] True Dark differs from plain Dark (extra contrast/brightness)",
              "contrast" in f and "brightness" in f, f)
        page.close()

        # ---- Case 3: idempotent install ----
        page = browser.new_page(viewport={"width": 900, "height": 700})
        page.set_content(fixture("#111111", "#eeeeee"))
        page.evaluate(ENGINE)
        apply(page, "light")
        apply(page, "dark")
        apply(page, "light")
        count = page.evaluate("() => document.querySelectorAll('#lr-theme-style').length")
        check("re-applying reuses one <style> tag, doesn't duplicate", count == 1, f"count={count}")
        page.close()

        browser.close()

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
        sys.exit(1)
    print("ALL THEME CHECKS PASSED")


if __name__ == "__main__":
    print("Lazy Render theme engine — fixture tests")
    main()
