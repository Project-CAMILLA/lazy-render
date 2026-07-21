/*
 * Three palettes for the app's own native chrome (tab bar, Settings screen).
 * The same three modes are also applied to the wrapped chat pages themselves —
 * see src/engine/theme-inject.js for that half (a CSS filter override, since
 * we don't control those sites' internals).
 *
 * trueDark is deliberately not just "darker" — it targets pure #000 surfaces
 * (real OLED black) where `dark` uses a conventional dark-gray surface, since
 * those read differently and people who want one specifically don't want the
 * other.
 */
export type ThemeMode = 'light' | 'dark' | 'trueDark';

export type Palette = {
  background: string;
  surface: string;
  surfaceAlt: string;
  accent: string;
  text: string;
  textDim: string;
  border: string;
  danger: string;
};

const dark: Palette = {
  background: '#121212',
  surface: '#1E1E1E',
  surfaceAlt: '#262626',
  accent: '#5B8DEF',
  text: '#E8E8E8',
  textDim: '#9AA0A6',
  border: '#333333',
  danger: '#E5534B',
};

const trueDark: Palette = {
  background: '#000000',
  surface: '#0A0A0A',
  surfaceAlt: '#141414',
  accent: '#6B98F2',
  text: '#EDEDED',
  textDim: '#8A8A8A',
  border: '#1F1F1F',
  danger: '#F1594F',
};

const light: Palette = {
  background: '#F5F6F8',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF0F3',
  accent: '#3A66C9',
  text: '#16181D',
  textDim: '#5B6472',
  border: '#DCE0E6',
  danger: '#C7392E',
};

export const PALETTES: Record<ThemeMode, Palette> = { light, dark, trueDark };

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  trueDark: 'True Dark',
};

export const THEME_MODES: ThemeMode[] = ['light', 'dark', 'trueDark'];

/** Default export kept for any lingering `theme.x` references during migration. */
export const theme = dark;
