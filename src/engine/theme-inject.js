/*
 * Lazy Render — page theme override (second injected script, alongside
 * booster-core.js).
 *
 * We don't control ChatGPT/Claude's internals, so this can't toggle their own
 * theme settings. Instead it forces a target look with a CSS filter — but,
 * crucially, it FIRST detects whether the page is already light or dark and
 * only inverts when the page doesn't already match the requested mode. (A naive
 * unconditional invert is wrong: these sites default to dark, so inverting for
 * "dark" would flip them light.)
 *
 * Detection samples the actually-painted background color at a few viewport
 * points (walking up to the first opaque ancestor), rather than trusting
 * html/body — those are often transparent while a child paints the real
 * background. If nothing readable is found we assume dark, which is the default
 * for both target sites.
 *
 * Modes:
 *   light    — make the page light (invert only if it's currently dark).
 *   dark     — make the page conventionally dark (invert only if light).
 *   trueDark — reach dark, then crush the background toward true black (OLED).
 *
 * The invert also re-inverts media (images/video/svg/canvas/background-images)
 * so photos don't render as negatives. Config comes from
 * `window.__LR_THEME_MODE`; change live via `window.__lazyRenderTheme.apply()`.
 * Because the real background paints async on these SPAs, detection is re-run a
 * few times after load so an early guess self-corrects.
 */
(() => {
  'use strict';

  const STYLE_ID = 'lr-theme-style';
  const INSTALL_KEY = '__lazyRenderTheme';
  const INVERT = 'invert(1) hue-rotate(180deg)';

  let currentMode = 'dark';

  // Luminance of the actual painted page background, or null if undetectable.
  function sampleBgLuminance() {
    if (!document.body) return null;
    const w = window.innerWidth || document.documentElement.clientWidth || 0;
    const h = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!w || !h) return null;
    // Edge points first (most likely to be page background, not a message
    // bubble or the app's content), center last.
    const points = [
      [w * 0.5, h * 0.04],
      [w * 0.04, h * 0.5],
      [w * 0.96, h * 0.5],
      [w * 0.5, h * 0.5],
    ];
    for (const [x, y] of points) {
      let el = document.elementFromPoint(Math.round(x), Math.round(y));
      while (el) {
        const bg = getComputedStyle(el).backgroundColor;
        const m = bg && bg.match(/[\d.]+/g);
        if (m && m.length >= 3) {
          const alpha = m.length >= 4 ? parseFloat(m[3]) : 1;
          if (alpha > 0.5) {
            const r = Number(m[0]);
            const g = Number(m[1]);
            const b = Number(m[2]);
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          }
        }
        el = el.parentElement;
      }
    }
    return null;
  }

  function pageIsDark() {
    const lum = sampleBgLuminance();
    if (lum == null) return true; // both target sites default dark
    return lum < 128;
  }

  function inverted() {
    return { page: INVERT, media: INVERT, isInverted: true };
  }
  function untouched() {
    return { page: 'none', media: 'none', isInverted: false };
  }

  function computeSpec(mode) {
    const darkNow = pageIsDark();
    if (mode === 'light') return darkNow ? inverted() : untouched();
    if (mode === 'dark') return darkNow ? untouched() : inverted();
    // trueDark: get to dark first, then push the background toward black.
    if (darkNow) {
      // Already dark: darken further without inverting (text stays light).
      return { page: 'brightness(0.82) contrast(1.18)', media: 'none', isInverted: false };
    }
    // Currently light: invert to dark, then crush toward black.
    return {
      page: `${INVERT} contrast(1.08) brightness(0.85)`,
      media: `${INVERT} contrast(0.93) brightness(1.18)`,
      isInverted: true,
    };
  }

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    return style;
  }

  function apply(mode) {
    currentMode = mode || currentMode;
    const spec = computeSpec(currentMode);
    const style = ensureStyle();
    if (spec.page === 'none') {
      style.textContent = '';
      return;
    }
    // The white html background only matters when inverting (so uncovered/
    // transparent areas become white → invert → black rather than showing
    // through). Don't force it when we're only adjusting brightness/contrast.
    const htmlBg = spec.isInverted ? 'background:#fff !important;' : '';
    style.textContent = `
      html { filter: ${spec.page} !important; ${htmlBg} }
      img, video, picture, svg, canvas,
      [style*="background-image"], [style*="background:url"] {
        filter: ${spec.media} !important;
      }
    `;
  }

  window[INSTALL_KEY] = { apply };
  apply(window.__LR_THEME_MODE || 'dark');

  // The real background paints async on these SPAs, so re-detect a few times
  // after load; each re-apply reads the true (unfiltered) background, so this
  // self-corrects an early wrong guess without flipping settled pages.
  [250, 800, 2000].forEach((t) => setTimeout(() => apply(currentMode), t));
  window.addEventListener('load', () => apply(currentMode), { once: true });
})();
