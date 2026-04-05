// ============================================================
// Background Service Worker
// ============================================================
// Handles extension lifecycle events, badge updates, and
// message passing between content scripts and popup.
// ============================================================

// Update badge with ghost score when a content script reports
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  }

  return true; // keep message channel open for async
});

// Clear badge when navigating away from job pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    const isJobPage = /linkedin\.com\/jobs|indeed\.com\/(viewjob|jobs)/.test(changeInfo.url);
    if (!isJobPage) {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }
});
