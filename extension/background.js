// Content scripts declared in manifest.json only attach on a fresh navigation.
// A tab already open on chatgpt.com/claude.ai when the extension is installed
// or reloaded never gets one and would silently do nothing. This backfills
// those tabs immediately; the content script's own guard keeps the backfill
// from double-running where a declarative injection already landed.

const MATCH_PATTERNS = [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://claude.ai/*",
];

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: MATCH_PATTERNS });
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(injectIntoOpenTabs);
chrome.runtime.onStartup.addListener(injectIntoOpenTabs);
