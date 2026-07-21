#!/usr/bin/env python3
"""
Fixture-driven test of the Lazy Render engine (src/engine/booster-core.js),
completely independent of a live logged-in ChatGPT/Claude session.

We serve the synthetic long-chat fixture *as* https://chatgpt.com/ (via request
interception) so the engine's host detection fires, inject the real engine
source, then assert the behaviours that matter:

  1. hides all but keepVisible most-recent turns (bottom-anchored)
  2. posts live stats over the ReactNativeWebView bridge
  3. "Older" reveal keeps the reading position stable (no scroll jump)
  4. live config update (keepVisible) re-applies without a reload
  5. appended turns are picked up by the MutationObserver
  6. a full subtree replacement (conversation switch) is survived and re-applied
  7. disabling clears all hidden turns

Run: JAVA-free, just `python3 engine-tests/test_engine.py` from the project root.
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = (ROOT / "engine-tests" / "fixtures" / "long-chat.html").read_text()
ENGINE = (ROOT / "src" / "engine" / "booster-core.js").read_text()

failures = []


def check(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def wait_state(page, predicate_js, timeout=4000):
    """Wait until _debug() satisfies predicate_js (a JS expr over `d`)."""
    page.wait_for_function(
        f"() => {{ const d = window.__lazyRenderV1 && window.__lazyRenderV1._debug(); return d && ({predicate_js}); }}",
        timeout=timeout,
    )


def debug(page):
    return page.evaluate("() => window.__lazyRenderV1._debug()")


def turn_top(page, i):
    return page.evaluate(
        "(i) => { const el = document.querySelector('[data-testid=\"conversation-turn-'+i+'\"]');"
        " return el ? el.getBoundingClientRect().top : null; }",
        i,
    )


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = browser.new_context(
            viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True
        )
        # Install the RN bridge shim BEFORE any page script runs, collecting
        # posted messages so we can assert the stats bridge fires.
        context.add_init_script(
            "window.__posted = [];"
            "window.ReactNativeWebView = { postMessage: (m) => window.__posted.push(m) };"
        )
        page = context.new_page()
        page.route(
            "https://chatgpt.com/**",
            lambda route: route.fulfill(content_type="text/html", body=FIXTURE),
        )

        page.goto("https://chatgpt.com/?n=120")
        page.wait_for_function("() => window.__fixture && document.querySelectorAll('[data-testid^=\"conversation-turn-\"]').length === 120")

        # Behavioural assertions below pin an explicit config (50/25) so they
        # don't shift when the shipped defaults change; a separate check
        # (default_check) verifies the actual shipped defaults.
        page.evaluate(
            "() => { window.__LR_CONFIG = { enabled: true, keepVisible: 50, revealBatch: 25, autoReveal: true, showBadge: true }; }"
        )
        page.add_script_tag(content=ENGINE)
        page.wait_for_function("() => !!window.__lazyRenderV1")

        # 1. Bottom-anchored hide: 120 turns, keepVisible 50 -> 70 hidden.
        wait_state(page, "d.total === 120 && d.hidden === 70 && d.visible === 50")
        d = debug(page)
        check("hides all but keepVisible (50) turns", d["hidden"] == 70 and d["visible"] == 50,
              f"total={d['total']} hidden={d['hidden']} visible={d['visible']}")
        check("detected site is chatgpt", d["siteId"] == "chatgpt")
        check("first 70 turns carry the hidden class",
              page.evaluate("() => document.querySelectorAll('.lr-hidden-turn').length") == 70)

        # 2. Stats bridge fired with correct numbers.
        posted = page.evaluate("() => window.__posted.map(JSON.parse)")
        stat = next((m for m in posted if m.get("type") == "lr:stats"), None)
        check("posted a lr:stats bridge message", stat is not None)
        if stat:
            check("bridge stats match engine state",
                  stat["total"] == 120 and stat["hidden"] == 70 and stat["visible"] == 50,
                  str(stat))

        # 3. Reveal keeps reading position stable. Scroll down first so there's
        #    content above and below, then reveal older and check the anchor
        #    turn (first visible = turn 70) doesn't move on screen.
        page.evaluate("() => window.scrollTo(0, 500)")
        page.wait_for_timeout(50)
        top_before = turn_top(page, 70)
        page.click("#lr-bar button[data-a='older']")
        wait_state(page, "d.hidden === 45")  # 70 - 25 revealBatch
        page.wait_for_timeout(50)
        top_after = turn_top(page, 70)
        drift = abs(top_after - top_before) if (top_before is not None and top_after is not None) else 999
        check("reveal 'Older' drops hidden by revealBatch (25)", debug(page)["hidden"] == 45)
        check("reveal keeps anchor turn visually stable (no scroll jump)", drift < 20,
              f"anchor drifted {drift:.1f}px")

        # 4. Live config update re-applies without reload (extraVisible resets).
        page.evaluate("() => window.__lazyRenderV1.update({ keepVisible: 20 })")
        wait_state(page, "d.hidden === 100 && d.visible === 20")
        check("live keepVisible=20 update re-applies", debug(page)["hidden"] == 100)

        # 5. Appended turns picked up by the MutationObserver.
        page.evaluate("() => window.__fixture.append(10)")
        wait_state(page, "d.total === 130 && d.hidden === 110 && d.visible === 20")
        check("MutationObserver picks up appended turns", debug(page)["total"] == 130)

        # 6. Full subtree replacement (conversation switch) survived + re-applied.
        page.evaluate("() => window.__fixture.replaceAll(80)")
        wait_state(page, "d.total === 80 && d.hidden === 60 && d.visible === 20")
        d = debug(page)
        check("survives full subtree replacement and re-applies", d["total"] == 80 and d["hidden"] == 60,
              f"total={d['total']} hidden={d['hidden']}")
        check("engine still installed after replacement",
              page.evaluate("() => !!window.__lazyRenderV1"))

        # 7. Disable clears everything.
        page.evaluate("() => window.__lazyRenderV1.update({ enabled: false })")
        wait_state(page, "d.hidden === 0")
        check("disabling clears all hidden turns",
              page.evaluate("() => document.querySelectorAll('.lr-hidden-turn').length") == 0)

        # 8. Fallback heuristic: when no per-site selector matches but a
        #    scrollable container exists, the engine still finds and windows it.
        #    Uses a desktop-width context because the heuristic deliberately
        #    ignores narrow (<400px) containers.
        wide = browser.new_context(viewport={"width": 1280, "height": 900})
        wide.route(
            "https://chatgpt.com/**",
            lambda route: route.fulfill(content_type="text/html", body=FIXTURE),
        )
        wpage = wide.new_page()
        wpage.goto("https://chatgpt.com/?mode=fallback&n=90")
        wpage.wait_for_function("() => window.__fixture")
        wpage.evaluate(
            "() => { window.__LR_CONFIG = { enabled: true, keepVisible: 50, revealBatch: 25, autoReveal: true, showBadge: true }; }"
        )
        wpage.add_script_tag(content=ENGINE)
        wpage.wait_for_function("() => !!window.__lazyRenderV1")
        wpage.wait_for_function(
            "() => { const d = window.__lazyRenderV1._debug(); return d.usingFallback === true && d.total === 90 && d.hidden === 40; }",
            timeout=4000,
        )
        d = wpage.evaluate("() => window.__lazyRenderV1._debug()")
        check("fallback heuristic finds the thread when selectors miss",
              d["usingFallback"] is True and d["total"] == 90 and d["hidden"] == 40,
              f"usingFallback={d['usingFallback']} total={d['total']} hidden={d['hidden']}")
        wide.close()

        # 9. Shipped defaults (no __LR_CONFIG at all) are keepVisible 20 /
        #    revealBatch 10 — i.e. a fresh install hides all but the last 20.
        dctx = browser.new_context()
        dctx.route(
            "https://chatgpt.com/**",
            lambda route: route.fulfill(content_type="text/html", body=FIXTURE),
        )
        dpage = dctx.new_page()
        dpage.goto("https://chatgpt.com/?n=120")
        dpage.wait_for_function("() => window.__fixture")
        dpage.add_script_tag(content=ENGINE)  # deliberately NO __LR_CONFIG
        dpage.wait_for_function("() => !!window.__lazyRenderV1")
        dpage.wait_for_function(
            "() => { const d = window.__lazyRenderV1._debug(); return d.config.keepVisible === 20 && d.config.revealBatch === 10 && d.hidden === 100; }",
            timeout=4000,
        )
        d = dpage.evaluate("() => window.__lazyRenderV1._debug()")
        check("shipped default keepVisible is 20", d["config"]["keepVisible"] == 20, str(d["config"]))
        check("shipped default revealBatch is 10", d["config"]["revealBatch"] == 10, str(d["config"]))
        check("with default (20), 120-turn thread hides 100", d["hidden"] == 100 and d["visible"] == 20,
              f"hidden={d['hidden']} visible={d['visible']}")
        dctx.close()

        browser.close()

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
        sys.exit(1)
    print("ALL ENGINE CHECKS PASSED")


if __name__ == "__main__":
    print("Lazy Render engine — fixture tests")
    main()
