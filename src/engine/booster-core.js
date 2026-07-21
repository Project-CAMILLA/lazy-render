/*
 * Lazy Render — injected engine (single source of truth).
 *
 * Long ChatGPT/Claude threads get laggy because the browser keeps every past
 * turn laid out and painted even though only a few are ever on screen. This
 * keeps the most-recent `keepVisible` turns rendered and hides everything
 * older with `display:none` (bottom-anchored), which drops them from
 * layout/paint. A floating pill shows how many are hidden with Older/All
 * reveal buttons, and scrolling near the top auto-reveals more.
 *
 * This file is the ONE authored copy, shared by both delivery targets:
 *   - the mobile app compiles it to an injectable string
 *     (src/engine/injectedSource.ts) and injects it into its WebViews;
 *   - the browser extension bundles it into extension/content.js behind a thin
 *     chrome.storage/popup shim;
 *   - the fixture tests (engine-tests/) read it verbatim.
 * Both build targets come from build-injected.mjs. Keep this dependency-free
 * vanilla JS that runs standalone in any page — no imports, no bundler
 * features — so every consumer can use it as-is.
 *
 * Config comes in via `window.__LR_CONFIG` (the app sets it before injecting;
 * the extension shim sets it from chrome.storage). Live counts are posted to
 * `window.ReactNativeWebView` when present (the app's bridge); everything is
 * guarded so the same source also runs unchanged where that bridge is absent
 * (the extension, fixture tests, a desktop bookmarklet), where stats are read
 * on demand via the exposed `_debug()` instead.
 */
(() => {
  'use strict';

  const INSTALL_KEY = '__lazyRenderV1';
  const STYLE_ID = 'lr-style';
  const BAR_ID = 'lr-bar';
  const HIDDEN_CLASS = 'lr-hidden-turn';

  // Site registry. Adding a platform later (e.g. Gemini) is one entry here:
  // an id, a host test, and an ordered list of turn selectors (first selector
  // that matches >0 nodes wins, so put the most specific first and broader
  // fallbacks after). The registry is intentionally the only site-specific
  // surface in the engine — nothing below this constant references a site by
  // name.
  const SITES = [
    {
      id: 'chatgpt',
      // No tag constraint on the primary selector on purpose: the
      // conversation-turn testid sits on the full-row wrapper. Scoping it to
      // `article[...]` silently matched nothing when the wrapper wasn't an
      // <article>, leaving visible remnants — a real past regression.
      hostTest: (host) => host === 'chatgpt.com' || host.endsWith('.chatgpt.com') ||
        host === 'chat.openai.com',
      selectors: [
        '[data-testid^="conversation-turn-"]',
        'article[data-turn-id]',
        '[data-message-author-role]',
        'main article',
      ],
    },
    {
      id: 'claude',
      hostTest: (host) => host === 'claude.ai' || host.endsWith('.claude.ai'),
      selectors: [
        '[data-testid="user-message"]',
        '[data-testid="chat-message"]',
        '[data-testid*="message"]',
        '.font-claude-message',
        '.font-user-message',
      ],
    },
  ];

  function detectSite() {
    const host = location.hostname;
    return SITES.find((site) => site.hostTest(host)) || null;
  }

  const site = detectSite();
  // Unknown host: stay fully inert. Never touch a page we don't have a
  // selector strategy for.
  if (!site) return;

  const TURN_SELECTORS = site.selectors;
  const COMBINED_SELECTOR = TURN_SELECTORS.join(',');

  const incoming = window.__LR_CONFIG || {};
  const defaults = { enabled: true, keepVisible: 20, revealBatch: 10, autoReveal: true, showBadge: true };
  const config = Object.assign({}, defaults, incoming);

  function asInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }
  config.keepVisible = asInt(config.keepVisible, 20, 10, 300);
  config.revealBatch = asInt(config.revealBatch, 10, 5, 100);

  // Idempotent re-injection: the app re-injects on every navigation and the
  // extension can inject twice (declarative + programmatic backfill), so this
  // guard stops a second copy from double-attaching observers. A repeat
  // injection just pushes new config.
  if (window[INSTALL_KEY]) {
    window[INSTALL_KEY].update(config);
    return;
  }

  let extraVisible = 0;
  let scheduled = false;
  let currentPath = location.pathname;
  let activeConfig = config;
  let usingFallbackMode = false;
  // Skip the per-element write pass when the hidden/visible split hasn't moved
  // (e.g. streaming text appends to the last turn constantly) — a redundant
  // apply() becomes a cheap query instead of hundreds of classList writes.
  let lastAppliedTotal = -1;
  let lastAppliedHidden = -1;
  // Heuristic-fallback scroll root, rediscovered on a time throttle.
  let fallbackRoot = null;
  let lastFallbackSearchAt = 0;
  const FALLBACK_SEARCH_INTERVAL_MS = 1000;

  function specificTurns() {
    for (const selector of TURN_SELECTORS) {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length) return nodes;
    }
    return [];
  }

  // Last-resort heuristic for when a site redesign breaks every selector above:
  // find the widest scrollable container with the most substantial children
  // and treat each direct child as a "turn". Deliberately skips narrow
  // (< 400px) elements so sidebars/nav lists don't get mistaken for the thread
  // — which also means it stays inert on narrow phone viewports by design; the
  // per-site selectors are what carry mobile.
  function findFallbackRoot() {
    const candidates = document.querySelectorAll('main *, body *');
    let best = null;
    let bestScore = 0;
    for (const el of candidates) {
      if (el.children.length < 4) continue;
      if (el.offsetWidth < 400) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
      if (el.scrollHeight <= el.clientHeight + 200) continue;
      if (el.children.length > bestScore) {
        bestScore = el.children.length;
        best = el;
      }
    }
    return best;
  }

  function getTurns() {
    const specific = specificTurns();
    if (specific.length) {
      fallbackRoot = null;
      return { turns: specific, usingFallback: false };
    }
    // The conversation container gets replaced on SPA navigation, so a stale
    // reference is dropped and rediscovered rather than treated as a miss.
    if (fallbackRoot && !fallbackRoot.isConnected) fallbackRoot = null;
    // Retried on a time throttle, not a fixed attempt budget: the page can
    // still be hydrating (empty DOM) for the first mutation bursts, and giving
    // up permanently would strand the tab even once real content appears.
    const now = Date.now();
    if (!fallbackRoot && now - lastFallbackSearchAt > FALLBACK_SEARCH_INTERVAL_MS) {
      lastFallbackSearchAt = now;
      fallbackRoot = findFallbackRoot();
    }
    if (fallbackRoot && fallbackRoot.isConnected) {
      return { turns: Array.from(fallbackRoot.children), usingFallback: true };
    }
    return { turns: [], usingFallback: false };
  }

  // Post live counts to the app's settings UI. No-op where the bridge is
  // absent (extension, fixtures, bookmarklet), so the same source runs
  // unchanged everywhere.
  function postStats(total, hidden) {
    const bridge = window.ReactNativeWebView;
    if (!bridge || typeof bridge.postMessage !== 'function') return;
    try {
      bridge.postMessage(JSON.stringify({
        type: 'lr:stats',
        siteId: site.id,
        total,
        hidden,
        visible: total - hidden,
        enabled: !!activeConfig.enabled,
        usingFallback: usingFallbackMode,
      }));
    } catch (err) {
      /* never let a bridge hiccup break the page */
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${HIDDEN_CLASS} { display: none !important; }
      #${BAR_ID} {
        position: fixed; z-index: 2147483646; top: env(safe-area-inset-top, 8px);
        left: 50%; transform: translateX(-50%); display: flex; align-items: center;
        gap: 7px; max-width: calc(100vw - 24px); padding: 7px 10px;
        border-radius: 999px; border: 1px solid rgba(128,128,128,.45);
        background: rgba(32,32,32,.90); color: white; box-shadow: 0 4px 18px rgba(0,0,0,.25);
        font: 12px/1.2 system-ui,sans-serif; backdrop-filter: blur(8px);
      }
      #${BAR_ID}[hidden] { display: none !important; }
      #${BAR_ID} button { border: 1px solid rgba(255,255,255,.35); border-radius: 999px;
        background: transparent; color: inherit; padding: 4px 8px; font: inherit; }
      #${BAR_ID} span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureBar() {
    let bar = document.getElementById(BAR_ID);
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span></span><button type="button" data-a="older">Older</button><button type="button" data-a="all">All</button>';
    bar.addEventListener('click', (event) => {
      const action = event.target && event.target.getAttribute('data-a');
      if (action === 'older') reveal(activeConfig.revealBatch);
      if (action === 'all') { extraVisible = getTurns().turns.length; apply(); }
    });
    document.documentElement.appendChild(bar);
    return bar;
  }

  function clear() {
    document.querySelectorAll('.' + HIDDEN_CLASS).forEach((node) => {
      node.classList.remove(HIDDEN_CLASS);
      node.removeAttribute('aria-hidden');
    });
    const bar = document.getElementById(BAR_ID);
    if (bar) bar.hidden = true;
  }

  function apply() {
    ensureStyle();
    const { turns, usingFallback } = getTurns();
    usingFallbackMode = usingFallback;

    if (!activeConfig.enabled || turns.length <= activeConfig.keepVisible) {
      clear();
      lastAppliedTotal = -1;
      lastAppliedHidden = -1;
      postStats(turns.length, 0);
      return;
    }

    const visible = Math.min(turns.length, activeConfig.keepVisible + extraVisible);
    const hidden = Math.max(0, turns.length - visible);

    if (turns.length !== lastAppliedTotal || hidden !== lastAppliedHidden) {
      turns.forEach((turn, index) => {
        const shouldHide = index < hidden;
        turn.classList.toggle(HIDDEN_CLASS, shouldHide);
        if (shouldHide) turn.setAttribute('aria-hidden', 'true');
        else turn.removeAttribute('aria-hidden');
      });
      lastAppliedTotal = turns.length;
      lastAppliedHidden = hidden;
    }

    if (activeConfig.showBadge) {
      const bar = ensureBar();
      bar.hidden = hidden === 0;
      bar.querySelector('span').textContent = `${hidden} older hidden · ${turns.length - hidden} visible`;
    } else {
      const bar = document.getElementById(BAR_ID);
      if (bar) bar.hidden = true;
    }
    postStats(turns.length, hidden);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (currentPath !== location.pathname) {
        currentPath = location.pathname;
        extraVisible = 0;
      }
      apply();
    });
  }

  function reveal(amount) {
    const hidden = document.querySelectorAll('.' + HIDDEN_CLASS).length;
    if (!hidden) return;
    // Anchor scroll to the first currently-visible turn so revealing older
    // ones above it doesn't make the reading position jump.
    const anchorBefore = getTurns().turns.find((turn) => !turn.classList.contains(HIDDEN_CLASS));
    const oldTop = anchorBefore ? anchorBefore.getBoundingClientRect().top : 0;
    extraVisible += Math.min(amount, hidden);
    apply();
    if (anchorBefore) window.scrollBy(0, anchorBefore.getBoundingClientRect().top - oldTop);
  }

  const observer = new MutationObserver((records) => {
    // In fallback-heuristic mode there's no selector to test added nodes
    // against (turns are just "this container's children"), so reschedule on
    // any change there. Otherwise only reschedule when a batch actually added
    // a turn element — this skips the dozens-per-second reschedules that
    // token-by-token streaming text inside an existing turn would cause.
    if (usingFallbackMode) {
      schedule();
      return;
    }
    const relevant = records.some((record) =>
      Array.from(record.addedNodes).some(
        (node) =>
          node.nodeType === 1 &&
          (node.matches?.(COMBINED_SELECTOR) || node.querySelector?.(COMBINED_SELECTOR))
      )
    );
    if (relevant || location.pathname !== currentPath) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule, { passive: true });

  // Capturing listener on document catches scrolls from an inner scroll
  // container (desktop) as well as the window/document itself — scroll events
  // don't bubble, but a capturing listener still sees them from any
  // scrollable descendant.
  document.addEventListener('scroll', (event) => {
    if (!activeConfig.enabled || !activeConfig.autoReveal) return;
    const target = event.target === document ? document.scrollingElement : event.target;
    if (!target) return;
    if (target.scrollTop < 220 && document.querySelector('.' + HIDDEN_CLASS)) {
      reveal(activeConfig.revealBatch);
    }
  }, { capture: true, passive: true });

  window[INSTALL_KEY] = {
    update(next) {
      activeConfig = Object.assign({}, activeConfig, next || {});
      activeConfig.keepVisible = asInt(activeConfig.keepVisible, 20, 10, 300);
      activeConfig.revealBatch = asInt(activeConfig.revealBatch, 10, 5, 100);
      extraVisible = 0;
      lastAppliedTotal = -1;
      lastAppliedHidden = -1;
      schedule();
    },
    stop() {
      observer.disconnect();
      clear();
      delete window[INSTALL_KEY];
    },
    // Exposed for the extension popup and the fixture tests to read on demand.
    _debug() {
      const { turns, usingFallback } = getTurns();
      const hidden = document.querySelectorAll('.' + HIDDEN_CLASS).length;
      return {
        siteId: site.id,
        total: turns.length,
        hidden,
        visible: turns.length - hidden,
        usingFallback,
        config: activeConfig,
      };
    },
  };

  schedule();
})();
