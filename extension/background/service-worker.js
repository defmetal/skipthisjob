// ============================================================
// Background Service Worker — Skip This Job
// ============================================================
// Handles API calls on behalf of content scripts.
// ============================================================

importScripts('../lib/access.js');

const API_BASE = 'https://www.skipthisjob.com/api';

// Content scripts (untrusted contexts) read/write chrome.storage.session for
// the Indeed per-job signal cache. Without this, Chrome throws "Access to
// storage is not allowed from this context". shared.js also falls back to
// storage.local if this call is unavailable.
try {
  if (chrome.storage.session && chrome.storage.session.setAccessLevel) {
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  }
} catch (e) { /* ignore */ }

// --- Site access (host permission) monitoring ---
// If Chrome withholds LinkedIn/Indeed access, content scripts never run. Flag
// it with a "!" badge and open the onboarding page on install/update.
chrome.runtime.onInstalled.addListener((details) => {
  SkipThisJobAccess.handleInstalled(details);
});
chrome.runtime.onStartup.addListener(() => { SkipThisJobAccess.refreshAccessState(); });
if (chrome.permissions && chrome.permissions.onAdded) chrome.permissions.onAdded.addListener(() => { SkipThisJobAccess.refreshAccessState(); });
if (chrome.permissions && chrome.permissions.onRemoved) chrome.permissions.onRemoved.addListener(() => { SkipThisJobAccess.refreshAccessState(); });

const FETCH_TIMEOUT_MS = 8000;

function fetchWithTimeout(url, options) {
  const opts = options || {};
  opts.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return fetch(url, opts);
}

// Last TRACK_LISTING payload per tab — used to complete Apply-click events
// that used to POST {platform, listingUrl} and 400 on /api/track.
const lastListingByTab = new Map();

function mergeApplyPayload(message, lastListing) {
  const last = lastListing || {};
  const listingUrl = message.url || message.listingUrl || last.listingUrl || null;
  let platformJobId = message.platformJobId || last.platformJobId || null;
  if (!platformJobId && listingUrl) {
    const indeed = String(listingUrl).match(/[?&#](?:vjk|jk)=([a-f0-9]+)/i);
    const linkedin = String(listingUrl).match(/currentJobId=(\d+)/) ||
                     String(listingUrl).match(/\/jobs\/view\/(\d+)/);
    platformJobId = (indeed && indeed[1]) || (linkedin && linkedin[1]) || null;
  }
  const platform = message.platform || last.platform || null;
  let cleanUrl = listingUrl;
  if (platform === 'linkedin' && platformJobId) cleanUrl = 'https://www.linkedin.com/jobs/view/' + platformJobId;
  else if (platform === 'indeed' && platformJobId) cleanUrl = 'https://www.indeed.com/viewjob?jk=' + String(platformJobId).toLowerCase();
  else if (listingUrl) {
    try { cleanUrl = new URL(listingUrl).origin + new URL(listingUrl).pathname; }
    catch (e) { cleanUrl = String(listingUrl).split('?')[0]; }
  }
  return {
    companyName: message.companyName || last.companyName || null,
    jobTitle: message.jobTitle || last.jobTitle || last.title || null,
    platform: platform,
    platformJobId,
    listingUrl: cleanUrl,
    location: last.location || null,
    salaryListed: last.salaryListed === undefined ? null : last.salaryListed,
    isRepost: last.isRepost === undefined ? null : last.isRepost,
    daysOpen: last.daysOpen,
    engagementSignals: last.engagementSignals || [],
    employerResponseTime: last.employerResponseTime || null,
    userClickedApply: true,
    workArrangement: last.workArrangement || null,
    employmentType: last.employmentType || null,
    listingHeuristic: last.listingHeuristic,
    descriptionHash: last.descriptionHash || null,
  };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  lastListingByTab.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // --- Fetch employer score ---
  if (message.type === 'FETCH_EMPLOYER_SCORE') {
    const params = new URLSearchParams({ name: message.name });
    if (message.platform) params.set('platform', message.platform);
    if (message.jobId) params.set('jobId', message.jobId);
    if (message.fresh) params.set('fresh', '1');
    fetchWithTimeout(`${API_BASE}/employer/score?` + params)
      .then(res => res.ok ? res.json() : null)
      .then(data => sendResponse({ data }))
      .catch(() => sendResponse({ data: null }));
    return true;
  }

  // --- Submit report ---
  if (message.type === 'SUBMIT_REPORT') {
    fetchWithTimeout(`${API_BASE}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.reportData),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        sendResponse({ success: res.ok, ...data });
      })
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  // --- Track listing (passive, no user data) ---
  if (message.type === 'TRACK_LISTING') {
    if (sender.tab && sender.tab.id != null && message.listingData) {
      lastListingByTab.set(sender.tab.id, message.listingData);
    }
    fetchWithTimeout(`${API_BASE}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.listingData),
    })
      .then(res => sendResponse({ success: res.ok }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  // --- User clicked Apply: always send required track fields ---
  if (message.type === 'USER_CLICKED_APPLY') {
    const last = sender.tab && sender.tab.id != null
      ? lastListingByTab.get(sender.tab.id)
      : null;
    const payload = mergeApplyPayload(message, last);
    if (!payload.companyName || !payload.jobTitle || !payload.platform) {
      console.warn('[SkipThisJob] Apply click missing required track fields', {
        hasLast: !!last,
        platform: payload.platform,
      });
      sendResponse({ success: false, error: 'incomplete_apply_payload' });
      return true;
    }
    fetchWithTimeout(`${API_BASE}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(res => sendResponse({ success: res.ok }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }
});

// Clear badge when navigating away from job pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    const isJobPage = /linkedin\.com\/jobs|indeed\.com/.test(changeInfo.url);
    if (!isJobPage) {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }
});
