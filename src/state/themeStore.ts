/*
 * App-wide (not per-site) theme mode, persisted with AsyncStorage. Separate
 * storage key from settingsStore's per-site booster settings since this is a
 * different axis entirely — one global choice, not one per chat platform.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeMode } from '../theme';

const STORAGE_KEY = 'lazyrender:theme:v1';
const DEFAULT_MODE: ThemeMode = 'dark';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'trueDark';
}

export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, mode);
}
