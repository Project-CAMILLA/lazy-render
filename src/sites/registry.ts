/*
 * Native-side site registry: the platforms Lazy Render wraps, with the nav
 * chrome (label, home URL) and the host allowlist used to decide what stays
 * in the WebView vs. what opens in the system browser.
 *
 * This is the native counterpart to the injected engine's SITE registry in
 * src/engine/booster-core.js. Two lists, deliberately: this one is about
 * navigation/security (which hosts belong to the app), the engine's is about
 * DOM selectors (how to find a turn on the page). Adding a platform means an
 * entry in both. The `id`s must match between the two.
 *
 * The host allowlist includes each site's auth hosts: ChatGPT's login flow
 * traverses auth.openai.com / openai.com, so those count as internal to keep
 * sign-in inside the app.
 */
export type SiteId = 'chatgpt' | 'claude';

export type SiteDef = {
  id: SiteId;
  label: string;
  /** One-letter glyph for the tab icon (keeps us off an icon-font dependency). */
  glyph: string;
  homeUrl: string;
  /** Hosts (and their subdomains) treated as internal to this site. */
  hostSuffixes: string[];
};

export const SITES: SiteDef[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    glyph: 'G',
    homeUrl: 'https://chatgpt.com/',
    hostSuffixes: ['chatgpt.com', 'auth.openai.com', 'openai.com', 'platform.openai.com', 'cdn.oaistatic.com'],
  },
  {
    id: 'claude',
    label: 'Claude',
    glyph: 'C',
    homeUrl: 'https://claude.ai/',
    hostSuffixes: ['claude.ai', 'anthropic.com'],
  },
];

export const SITE_IDS: SiteId[] = SITES.map((s) => s.id);

export function getSite(id: SiteId): SiteDef {
  const site = SITES.find((s) => s.id === id);
  if (!site) throw new Error(`Unknown site id: ${id}`);
  return site;
}

/** True if `url` belongs to `site` (or one of its allowed auth hosts), https only. */
export function isInternalUrl(url: string, site: SiteDef): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  return site.hostSuffixes.some((suffix) => host === suffix || host.endsWith('.' + suffix));
}
