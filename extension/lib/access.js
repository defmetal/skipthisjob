// ============================================================
// Site-access helpers — Skip This Job
// ============================================================
// Chrome can withhold host access that the manifest declares (user set
// "Site access: On click", enterprise policy, or an install/update where the
// grant did not carry over). When that happens content scripts silently never
// run and the extension icon shows under "Access requested". This module lets
// the service worker, popup and onboarding page detect that state and recover
// it with chrome.permissions.request (which must run inside a user gesture).
//
// Loaded via importScripts() in the service worker, <script> in the popup and
// onboarding page, and require() in tests (UMD, no DOM/chrome globals at load).
(function (root) {
  'use strict';

  const REQUIRED_ORIGINS = [
    'https://*.linkedin.com/*',
    'https://*.indeed.com/*',
  ];

  const BADGE_TEXT = '!';
  const BADGE_COLOR = '#d93025';
  const BADGE_TITLE_MISSING =
    'Skip This Job needs access to LinkedIn and Indeed — click to enable';
  const ONBOARDING_PATH = 'onboarding/onboarding.html';

  function getChrome(chromeApi) {
    if (chromeApi) return chromeApi;
    return typeof chrome !== 'undefined' ? chrome : null;
  }

  /** Resolves true only when EVERY required origin is currently granted. */
  async function hasSiteAccess(chromeApi, origins) {
    const c = getChrome(chromeApi);
    if (!c || !c.permissions || !c.permissions.contains) return false;
    try {
      return !!(await c.permissions.contains({ origins: origins || REQUIRED_ORIGINS }));
    } catch (e) {
      return false;
    }
  }

  /** Sets/clears the "!" action badge. Per-tab badges (score) still win. */
  async function syncBadge(chromeApi, granted) {
    const c = getChrome(chromeApi);
    if (!c || !c.action) return;
    try {
      if (granted) {
        // Only clear the global text we set; per-tab score badges are separate.
        await c.action.setBadgeText({ text: '' });
        if (c.action.setTitle) await c.action.setTitle({ title: '' });
      } else {
        await c.action.setBadgeText({ text: BADGE_TEXT });
        if (c.action.setBadgeBackgroundColor) {
          await c.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
        }
        if (c.action.setTitle) await c.action.setTitle({ title: BADGE_TITLE_MISSING });
      }
    } catch (e) { /* action API unavailable in this context */ }
  }

  /** Check + badge. Returns granted boolean. */
  async function refreshAccessState(chromeApi) {
    const granted = await hasSiteAccess(chromeApi);
    await syncBadge(chromeApi, granted);
    return granted;
  }

  /**
   * runtime.onInstalled handler. On install/update with access missing, set
   * the badge and open the onboarding page. Returns
   * { granted, openedOnboarding }.
   */
  async function handleInstalled(details, chromeApi) {
    const c = getChrome(chromeApi);
    const reason = details && details.reason;
    if (reason !== 'install' && reason !== 'update') {
      return { granted: await refreshAccessState(c), openedOnboarding: false };
    }
    const granted = await refreshAccessState(c);
    let openedOnboarding = false;
    if (!granted && c && c.tabs && c.tabs.create && c.runtime && c.runtime.getURL) {
      try {
        await c.tabs.create({ url: c.runtime.getURL(ONBOARDING_PATH) });
        openedOnboarding = true;
      } catch (e) { /* ignore */ }
    }
    return { granted, openedOnboarding };
  }

  /**
   * Call DIRECTLY from a click handler (user gesture). Do not await anything
   * before this — the gesture is lost across async boundaries in some cases.
   * Resolves { granted, reloaded }.
   */
  async function requestSiteAccess(chromeApi, opts) {
    const c = getChrome(chromeApi);
    const options = opts || {};
    let granted = false;
    try {
      granted = !!(await c.permissions.request({ origins: options.origins || REQUIRED_ORIGINS }));
    } catch (e) {
      granted = false;
    }
    await syncBadge(c, granted ? await hasSiteAccess(c, options.origins) : false);
    let reloaded = false;
    if (granted && options.reloadActiveTab !== false) {
      reloaded = await reloadActiveJobTab(c);
    }
    return { granted, reloaded };
  }

  function isJobUrl(url) {
    return /^https:\/\/([^/]+\.)?(linkedin|indeed)\.com\//i.test(url || '');
  }

  /**
   * Manifest content scripts only inject on navigation, so tabs that were
   * already open when access was granted need a reload to pick them up.
   * Reloads the ACTIVE tab only, and only if it is a LinkedIn/Indeed page.
   */
  async function reloadActiveJobTab(chromeApi) {
    const c = getChrome(chromeApi);
    try {
      const tabs = await c.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (tab && tab.id != null && isJobUrl(tab.url)) {
        await c.tabs.reload(tab.id);
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  const api = {
    REQUIRED_ORIGINS,
    BADGE_TEXT,
    ONBOARDING_PATH,
    hasSiteAccess,
    syncBadge,
    refreshAccessState,
    handleInstalled,
    requestSiteAccess,
    reloadActiveJobTab,
    isJobUrl,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SkipThisJobAccess = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
