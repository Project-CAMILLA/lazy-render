/*
 * One full-screen WebView per wrapped site. Loads the real site (normal
 * cookie-based login — we never handle credentials), injects the Lazy Render
 * engines (render limiter + theme override), and applies a hardened WebView
 * config: internal-host allowlist with external links kicked to the system
 * browser, no third-party cookies, no file access, no auto-opened windows,
 * mixed content blocked.
 *
 * A slim top toolbar (Back / site label / Reload) sits in the status-bar safe
 * area — it doubles as the top inset so the wrapped page renders below the
 * system status bar instead of under it.
 *
 * Settings are re-read on focus (so changes made in the Settings tab apply
 * when you come back) and pushed into the live page without a reload via the
 * engines' idempotent re-injection. Theme mode changes apply live too.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { getSite, isInternalUrl, SiteId } from '../sites/registry';
import { loadAllSettings, SiteSettings } from '../state/settingsStore';
import { injectionScript, parseStats, themeUpdateScript } from '../engine/bridge';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  siteId: SiteId;
  /** Fired whenever the injected engine reports new counts (for the Settings tab). */
  onStats?: (siteId: SiteId, hidden: number, visible: number) => void;
  /** True when this tab is the active one, so back/reload only bind while focused. */
  navigation: {
    isFocused: () => boolean;
    addListener: (type: string, cb: () => void) => () => void;
  };
};

export default function SiteWebViewScreen({ siteId, onStats, navigation }: Props) {
  const site = getSite(siteId);
  const webRef = useRef<WebView>(null);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const canGoBackRef = useRef(false);
  const insets = useSafeAreaInsets();
  const { mode: themeMode, palette } = useTheme();

  // Load (and reload-on-focus) this site's settings, and push them live.
  const refreshSettings = useCallback(async () => {
    const all = await loadAllSettings();
    const next = all[siteId];
    setSettings(next);
    // If the page is already loaded, apply new config without a reload.
    webRef.current?.injectJavaScript(injectionScript(next, themeMode));
  }, [siteId, themeMode]);

  useFocusEffect(
    useCallback(() => {
      refreshSettings();
      // Android hardware back navigates WebView history while this tab is focused.
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (canGoBackRef.current) {
          webRef.current?.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [refreshSettings])
  );

  // Theme mode changed (from the Settings tab, possibly on another tab):
  // apply live without re-running the whole booster engine.
  useEffect(() => {
    if (!settings) return;
    webRef.current?.injectJavaScript(themeUpdateScript(themeMode));
    // settings is intentionally omitted: this effect is about themeMode, not
    // settings — it only needs settings to have loaded once so the WebView exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeMode]);

  // Tapping the already-active tab reloads the site (common app convention).
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (navigation.isFocused()) webRef.current?.reload();
    });
    return unsub;
  }, [navigation]);

  const onShouldStart = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      // Only gate top-level navigations; sub-frames/resources load freely.
      if (!request.isTopFrame) return true;
      if (isInternalUrl(request.url, site)) return true;
      // about:/blank and the initial load can lack a normal https URL — allow those.
      if (request.url === 'about:blank' || request.url.startsWith('data:')) return true;
      Linking.openURL(request.url).catch(() => {});
      return false;
    },
    [site]
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const stats = parseStats(event.nativeEvent.data);
      if (stats) onStats?.(siteId, stats.hidden, stats.visible);
    },
    [onStats, siteId]
  );

  const onNavStateChange = useCallback((navState: WebViewNavigation) => {
    canGoBackRef.current = navState.canGoBack;
    setCanGoBack(navState.canGoBack);
  }, []);

  const toolbar = (
    <View
      style={[
        styles.toolbar,
        { paddingTop: insets.top, backgroundColor: palette.surface, borderBottomColor: palette.border },
      ]}
    >
      <TouchableOpacity
        style={styles.toolBtn}
        onPress={() => webRef.current?.goBack()}
        disabled={!canGoBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        accessibilityState={{ disabled: !canGoBack }}
        hitSlop={8}
      >
        <Text style={[styles.toolGlyph, { color: palette.text, opacity: canGoBack ? 1 : 0.3 }]}>‹</Text>
      </TouchableOpacity>

      <Text style={[styles.toolTitle, { color: palette.textDim }]} numberOfLines={1}>
        {site.label}
      </Text>

      <TouchableOpacity
        style={styles.toolBtn}
        onPress={() => webRef.current?.reload()}
        accessibilityRole="button"
        accessibilityLabel="Reload"
        hitSlop={8}
      >
        <Text style={[styles.toolGlyph, { color: palette.text }]}>↻</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      {toolbar}
      {!settings ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : (
        <WebView
          ref={webRef}
          source={{ uri: site.homeUrl }}
          style={[styles.web, { backgroundColor: palette.background }]}
          containerStyle={[styles.web, { backgroundColor: palette.background }]}
          // --- engine injection ---
          injectedJavaScript={injectionScript(settings, themeMode)}
          onMessage={onMessage}
          // --- navigation / hardening ---
          originWhitelist={['https://*']}
          onShouldStartLoadWithRequest={onShouldStart}
          onNavigationStateChange={onNavStateChange}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction
          mixedContentMode="never"
          geolocationEnabled={false}
          thirdPartyCookiesEnabled={false}
          sharedCookiesEnabled
          // Keep session cookies across restarts (login persists like a browser).
          cacheEnabled
          pullToRefreshEnabled
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  toolGlyph: { fontSize: 26, lineHeight: 28, fontWeight: '600' },
  toolTitle: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '600' },
  web: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
