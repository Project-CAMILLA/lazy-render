# Lazy Render

Makes the AI chat sites you already use — **ChatGPT** and **Claude** — stop
lagging in long conversations, by hiding older off-screen messages so the
browser stops laying out and painting the entire history. You stay logged in
normally (regular cookie session, no credentials ever touch this software); a
floating pill shows how many are hidden and pulls them back on demand.

It ships as **two things that share one engine**:

- **A cross-platform mobile app** (React Native / Expo, Android + iOS) that
  wraps each site in a WebView — one clean UI, adding another chat platform is a
  couple of small config entries.
- **A browser extension** (Chromium / Brave / Chrome, Manifest V3) that does the
  same thing on the desktop.

Both build from the same two engines, so the app and extension behave
identically and can't drift.

## How it works

**The shared engines** (`src/engine/`)

- **`booster-core.js`** — the render limiter. Vanilla, dependency-free JS.
  Finds chat turns by a per-site selector list, hides all but `keepVisible`
  most-recent turns with `display:none` (bottom-anchored, so no scroll jump),
  shows a status pill with Older/All reveal, auto-reveals near the top,
  re-applies on SPA mutations, and falls back to a largest-scrollable-container
  heuristic if a site redesign breaks every selector.
- **`theme-inject.js`** — the page theme override. Applies a CSS filter across
  the whole page (invert + hue-rotate, the same technique "force dark mode"
  tools use) so Light / Dark / True Dark work identically on every site
  regardless of what that site supports natively — with a second, opposite
  filter re-applied to images/video/canvas/background-images so photos don't
  render as negatives. True Dark is the same idea pushed further toward a real
  near-black background, for OLED screens.
- **`build-injected.mjs`** (`npm run build:engine`) compiles both into the two
  delivery targets: `src/engine/injectedSource.ts` (strings the mobile app
  injects) and `extension/content.js` (both engines behind a thin chrome shim).
  **Edit the two engine files, never the generated ones.**

**Mobile app**

- **`src/theme.ts`** / **`src/theme/ThemeContext.tsx`** — the three palettes
  (Light / Dark / True Dark) and the app-wide context that both the native
  screens and `SiteWebViewScreen` read from, so switching modes in Settings
  updates the tab bar, Settings screen, and both wrapped pages together, live,
  with no reload.
- **`src/screens/SiteWebViewScreen.tsx`** — the hardened WebView per site
  (internal-host allowlist, external links to the system browser, no third-party
  cookies / file access / auto-windows, mixed content blocked).
- **`src/screens/SettingsScreen.tsx`** — the appearance picker (global) plus
  per-site booster controls (enable, visible turns, reveal batch, auto-reveal,
  status pill) + live counts. Persisted with AsyncStorage.
- **`src/navigation/RootNavigator.tsx`** — bottom tabs: ChatGPT · Claude · Settings.
- **`src/sites/registry.ts`** — native site list (labels, home URLs, host
  allowlist). Mirror of the engine's per-site selector registry; `id`s must match.

**Browser extension** (`extension/`)

- **`manifest.json`** / **`background.js`** / **`popup.html`** + **`popup.js`** — the
  MV3 shell and settings popup, including the same Light/Dark/True Dark picker.
  **`content.js`** is generated from the shared engines (see above). Load it via
  `chrome://extensions` → Developer mode → **Load unpacked** → select the
  `extension/` folder. Settings live in `chrome.storage.local` and apply
  immediately.

## Develop / build

**Prerequisites:** Node 20+ and npm; for Android builds, the Android SDK (the
easiest way to get it, plus platform-tools and NDK, is to install Android
Studio) and a JDK compatible with your Gradle/Android Gradle Plugin version —
**JDK 17 is a safe default**. Very new JDKs (24+) may not work with current
Gradle; if `java -version` is too new, point `JAVA_HOME` at the JDK bundled with
Android Studio. Set `ANDROID_HOME` to your SDK location.

```bash
npm install
npm run typecheck                     # tsc
python3 engine-tests/test_engine.py   # booster engine behaviour tests (Playwright, no live site needed)
python3 engine-tests/test_theme.py    # theme override engine tests (Playwright, no live site needed)

# Android debug build (no device needed to produce the APK):
npx expo prebuild --platform android
cd android && ./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk   (adb install it)
```

`npx expo run:android` builds and installs to a connected device/emulator in one
step. The first build downloads the NDK — via Android Studio's SDK Manager this
is a one-click component install.

> The engine tests need Playwright's Chromium: `pip install playwright && python3 -m playwright install chromium`.

## Known limitations

- **OAuth logins (Google/Microsoft SSO) may be rejected inside a WebView.** Prefer
  email / passkey login.
- **The theme override is a blunt instrument, not a perfect one.** It's a
  page-wide CSS filter, verified against a synthetic fixture (`engine-tests/test_theme.py`)
  covering `<img>` and CSS `background-image` elements — but a background
  image set via a CSS custom property or `background` shorthand without the
  literal string `background-image`/`background:url` in an inline `style`
  attribute won't get the counter-filter, and will render as a color negative.
  Not verified yet against the real, current ChatGPT/Claude markup.
- Selectors for the two sites are ported from recently-working versions but these
  are fast-moving SPAs — if turns stop hiding, check the selector lists in
  `src/engine/booster-core.js` first (see the comments there).
- iOS has not been built yet (Android-first); the RN code is cross-platform but
  only Android is verified so far.
