const DEFAULTS = {
  enabled: true,
  keepVisible: 20,
  revealBatch: 10,
  autoReveal: true,
  showBadge: true,
  themeMode: "dark",
};

const enabledEl = document.getElementById("enabled");
const keepVisibleEl = document.getElementById("keepVisible");
const revealBatchEl = document.getElementById("revealBatch");
const autoRevealEl = document.getElementById("autoReveal");
const showBadgeEl = document.getElementById("showBadge");
const statusEl = document.getElementById("site-status");
const statsEl = document.getElementById("stats");
const themeButtons = Array.from(document.querySelectorAll("[data-theme-mode]"));

const SITE_NAMES = { chatgpt: "ChatGPT", claude: "Claude.ai" };

function saveSettings() {
  chrome.storage.local.set({
    enabled: enabledEl.checked,
    keepVisible: clamp(Number(keepVisibleEl.value) || DEFAULTS.keepVisible, 10, 300),
    revealBatch: clamp(Number(revealBatchEl.value) || DEFAULTS.revealBatch, 5, 100),
    autoReveal: autoRevealEl.checked,
    showBadge: showBadgeEl.checked,
  });
}

function setThemeButtonsActive(mode) {
  themeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-theme-mode") === mode);
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshStats() {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "lr-get-stats" }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      statusEl.textContent = "Not an optimized chat page.";
      statsEl.textContent = "Open ChatGPT or Claude.ai to see live stats.";
      return;
    }

    const name = SITE_NAMES[resp.siteId] || resp.siteId;
    statusEl.textContent = `Detected: ${name}${resp.usingFallback ? " (fallback mode)" : ""}`;

    if (resp.total === 0) {
      statsEl.textContent = "No conversation detected yet.";
    } else if (resp.hidden === 0) {
      statsEl.innerHTML = `${resp.total} messages, all visible.<br><span class="muted">Below the visible-turns threshold — nothing to hide yet.</span>`;
    } else {
      statsEl.innerHTML = `<strong>${resp.hidden}</strong> older hidden &nbsp;·&nbsp; <strong>${resp.visible}</strong> visible<br><span class="muted">out of ${resp.total} messages total</span>`;
    }
  });
}

chrome.storage.local.get(DEFAULTS, (stored) => {
  enabledEl.checked = stored.enabled;
  keepVisibleEl.value = stored.keepVisible;
  revealBatchEl.value = stored.revealBatch;
  autoRevealEl.checked = stored.autoReveal;
  showBadgeEl.checked = stored.showBadge;
  setThemeButtonsActive(stored.themeMode);
  refreshStats();
});

[enabledEl, keepVisibleEl, revealBatchEl, autoRevealEl, showBadgeEl].forEach((el) => {
  el.addEventListener("change", () => {
    saveSettings();
    setTimeout(refreshStats, 100);
  });
});

themeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.getAttribute("data-theme-mode");
    setThemeButtonsActive(mode);
    chrome.storage.local.set({ themeMode: mode });
  });
});

// Keep the numbers live while the popup is open, since scrolling the page
// changes what's actually hidden vs. visible in real time.
const pollTimer = setInterval(refreshStats, 750);
window.addEventListener("unload", () => clearInterval(pollTimer));
