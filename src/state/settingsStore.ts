/*
 * Per-site booster settings, persisted with AsyncStorage.
 *
 * Per-site (not global) because you might want the booster on for a very long
 * ChatGPT thread but off on Claude, different visible-turn counts, etc. Shape
 * matches the injected engine's config exactly (enabled/keepVisible/
 * revealBatch/autoReveal/showBadge), so a SiteSettings object drops straight
 * into window.__LR_CONFIG. Clamp bounds match booster-core.js's asInt().
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SITE_IDS, SiteId } from '../sites/registry';

export type SiteSettings = {
  enabled: boolean;
  keepVisible: number;
  revealBatch: number;
  autoReveal: boolean;
  showBadge: boolean;
};

export const DEFAULT_SETTINGS: SiteSettings = {
  enabled: true,
  keepVisible: 20,
  revealBatch: 10,
  autoReveal: true,
  showBadge: true,
};

export const KEEP_VISIBLE_MIN = 10;
export const KEEP_VISIBLE_MAX = 300;
export const REVEAL_BATCH_MIN = 5;
export const REVEAL_BATCH_MAX = 100;

const STORAGE_KEY = 'lazyrender:settings:v1';

export type AllSettings = Record<SiteId, SiteSettings>;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalize(raw: Partial<SiteSettings> | undefined): SiteSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  return {
    enabled: !!merged.enabled,
    keepVisible: clamp(merged.keepVisible, KEEP_VISIBLE_MIN, KEEP_VISIBLE_MAX),
    revealBatch: clamp(merged.revealBatch, REVEAL_BATCH_MIN, REVEAL_BATCH_MAX),
    autoReveal: !!merged.autoReveal,
    showBadge: !!merged.showBadge,
  };
}

function withDefaults(partial: Partial<Record<SiteId, Partial<SiteSettings>>>): AllSettings {
  const result = {} as AllSettings;
  for (const id of SITE_IDS) {
    result[id] = normalize(partial[id]);
  }
  return result;
}

export async function loadAllSettings(): Promise<AllSettings> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) return withDefaults({});
    return withDefaults(JSON.parse(stored));
  } catch {
    // Corrupt/unreadable storage should never brick the app — fall back to defaults.
    return withDefaults({});
  }
}

export async function saveAllSettings(all: AllSettings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
