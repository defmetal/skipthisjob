// ============================================================
// Background Service Worker — Skip This Job
// ============================================================
// Handles API calls on behalf of content scripts to avoid CORS.
// Content scripts send messages, we fetch, we respond.
// ============================================================

const API_BASE = 'https://skipthisjob.com/api';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // --- Fetch employer score ---
  if (message.type === 'FETCH_EMPLOYER_SCORE') {
    fetch(`${API_BASE}/employer/score?` + new URLSearchParams({ name: message.name }))
      .then(res => res.ok ? res.json() : null)
      .then(data => sendResponse({ data }))
      .catch(() => sendResponse({ data: null }));
    return true; // keep channel open for async
  }

  // --- Submit report ---
  if (message.type === 'SUBMIT_REPORT') {
    fetch(`${API_BASE}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.reportData),
    })
      .then(res => sendResponse({ success: res.ok }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  // --- Update badge ---
  if (message.type === 'UPDATE_BADGE') {
    const { score, label } = message;
    const badgeColors = {
      low: '#4caf50',
      moderate: '#ff9800',
      high: '#f44336',
      very_high: '#9c27b0',
    };

    chrome.action.setBadgeText({
      text: score > 0 ? String(score) : '',
      tabId: sender.tab?.id,
    });
    chrome.action.setBadgeBackgroundColor({
      color: badgeColors[label] || '#999',
      tabId: sender.tab?.id,
    });
    sendResponse({ success: true });
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
