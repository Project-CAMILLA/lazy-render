/*
 * App-wide theme: loads the persisted mode on mount, exposes it (and the
 * resolved palette) to every screen via useTheme(), and persists changes.
 * SiteWebViewScreen reads `mode` from here too, to keep the wrapped chat
 * pages' injected theme in sync with the app's own chrome.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Palette, PALETTES, ThemeMode } from '../theme';
import { loadThemeMode, saveThemeMode } from '../state/themeStore';

type ThemeContextValue = {
  mode: ThemeMode;
  palette: Palette;
  ready: boolean;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadThemeMode().then((stored) => {
      if (!cancelled) {
        setModeState(stored);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    saveThemeMode(next).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ mode, palette: PALETTES[mode], ready, setMode }),
    [mode, ready, setMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be used inside <ThemeProvider>');
  return ctx;
}
