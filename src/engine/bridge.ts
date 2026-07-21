/*
 * Glue between the native app and the two injected engines (render-limiting
 * booster + page theme override).
 *
 *  - injectionScript(): builds the JS injected into the WebView on load — both
 *    engines' config assignments followed by their source. Used as the
 *    WebView's injectedJavaScript prop. Both engines are idempotent: a repeat
 *    injection just calls their update()/apply() with new config, neither
 *    re-attaches observers or double-installs its stylesheet.
 *  - themeUpdateScript(): a lighter live-update for theme changes alone —
 *    calling window.__lazyRenderTheme.apply() directly is cheaper than
 *    re-injecting the whole booster engine when only the theme changed.
 *  - parseStats(): decodes the {type:'lr:stats', ...} messages the engine
 *    posts through window.ReactNativeWebView.postMessage.
 */
import { BOOSTER_SOURCE, THEME_SOURCE } from './injectedSource';
import { SiteSettings } from '../state/settingsStore';
import { ThemeMode } from '../theme';

export function injectionScript(settings: SiteSettings, themeMode: ThemeMode): string {
  const config = JSON.stringify({
    enabled: settings.enabled,
    keepVisible: settings.keepVisible,
    revealBatch: settings.revealBatch,
    autoReveal: settings.autoReveal,
    showBadge: settings.showBadge,
  });
  // Trailing `true;` keeps react-native-webview's injectJavaScript from warning
  // about a non-primitive completion value.
  return (
    `window.__LR_CONFIG=${config};\n${BOOSTER_SOURCE}\n` +
    `window.__LR_THEME_MODE=${JSON.stringify(themeMode)};\n${THEME_SOURCE}\ntrue;`
  );
}

export function themeUpdateScript(themeMode: ThemeMode): string {
  return `window.__lazyRenderTheme && window.__lazyRenderTheme.apply(${JSON.stringify(themeMode)});\ntrue;`;
}

export type BoosterStats = {
  siteId: string;
  total: number;
  hidden: number;
  visible: number;
  enabled: boolean;
};

export function parseStats(data: string): BoosterStats | null {
  try {
    const msg = JSON.parse(data);
    if (msg && msg.type === 'lr:stats' && typeof msg.total === 'number') {
      return {
        siteId: String(msg.siteId ?? ''),
        total: msg.total,
        hidden: msg.hidden ?? 0,
        visible: msg.visible ?? msg.total,
        enabled: !!msg.enabled,
      };
    }
  } catch {
    /* not our message */
  }
  return null;
}
