/*
 * Compiles the two authored engines — booster-core.js (render limiting) and
 * theme-inject.js (page theme override) — into the two delivery targets that
 * share them:
 *
 *   1. src/engine/injectedSource.ts — injectable string constants the mobile
 *      app's WebView loads. (Metro can't import a raw .js as a string, and
 *      inlining either engine in a TS template literal would mean escaping
 *      every backtick in its CSS; JSON.stringify sidesteps both.)
 *   2. extension/content.js — the browser-extension content script: both
 *      engines wrapped in a thin chrome.storage/popup shim.
 *
 * Run after any edit to either engine file:  npm run build:engine
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); // src/engine
const repoRoot = join(here, '..', '..');
const boosterSource = readFileSync(join(here, 'booster-core.js'), 'utf8');
const themeSource = readFileSync(join(here, 'theme-inject.js'), 'utf8');

// --- 1. Mobile app: injectable string modules ---
const banner =
  '// AUTO-GENERATED from booster-core.js + theme-inject.js by build-injected.mjs — do not edit by hand.\n' +
  '// Edit those files and run `npm run build:engine`.\n';
writeFileSync(
  join(here, 'injectedSource.ts'),
  `${banner}export const BOOSTER_SOURCE: string = ${JSON.stringify(boosterSource)};\n` +
    `export const THEME_SOURCE: string = ${JSON.stringify(themeSource)};\n`
);

// --- 2. Browser extension: content script (both engines + chrome shim) ---
// NOTE: engine sources are concatenated raw (not interpolated into a template
// literal) precisely because they contain backticks and ${...} in their
// injected CSS — interpolating them would re-parse those. prefix/mid/suffix
// are the only template literals here and they carry no engine code.
const prefix = `// AUTO-GENERATED from ../src/engine/{booster-core,theme-inject}.js by build-injected.mjs — do not edit by hand.
// Edit those files and run \`npm run build:engine\`.
//
// The browser-extension delivery shell for the shared Lazy Render engines:
// seeds each engine's config from chrome.storage, runs them, keeps them in
// sync when settings change, and answers the popup's stats requests via the
// booster engine's _debug().
(() => {
  'use strict';
  const BOOSTER_DEFAULTS = { enabled: true, keepVisible: 20, revealBatch: 10, autoReveal: true, showBadge: true };
  const THEME_DEFAULT = 'dark';

  // Declarative injection (fresh loads) and the background worker's
  // programmatic backfill (tabs already open when the extension loads) share
  // one isolated world; this guard stops the shim wiring listeners twice.
  if (window.__lrExtBooted) return;
  window.__lrExtBooted = true;

  function runBooster() {
`;

const mid = `
  }

  function runTheme() {
`;

const suffix = `
  }

  chrome.storage.local.get(Object.assign({ themeMode: THEME_DEFAULT }, BOOSTER_DEFAULTS), (stored) => {
    window.__LR_CONFIG = Object.assign({}, BOOSTER_DEFAULTS, stored);
    window.__LR_THEME_MODE = stored.themeMode || THEME_DEFAULT;
    runBooster();
    runTheme();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (window.__lazyRenderV1) {
      const next = {};
      for (const key of Object.keys(BOOSTER_DEFAULTS)) {
        if (changes[key]) next[key] = changes[key].newValue;
      }
      if (Object.keys(next).length) window.__lazyRenderV1.update(next);
    }
    if (window.__lazyRenderTheme && changes.themeMode) {
      window.__lazyRenderTheme.apply(changes.themeMode.newValue || THEME_DEFAULT);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'lr-get-stats') {
      sendResponse(window.__lazyRenderV1 ? window.__lazyRenderV1._debug() : null);
    }
    return false;
  });
})();
`;

const extDir = join(repoRoot, 'extension');
mkdirSync(extDir, { recursive: true });
writeFileSync(join(extDir, 'content.js'), prefix + boosterSource + mid + themeSource + suffix);

console.log(
  `built: src/engine/injectedSource.ts + extension/content.js ` +
    `(${boosterSource.length} + ${themeSource.length} bytes of engine source)`
);
