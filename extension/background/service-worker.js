// ============================================================
// Background Service Worker — Skip This Job
// ============================================================
// Handles API calls and company scans on behalf of content scripts.
// ============================================================

const API_BASE = 'https://skipthisjob.com/api';

// Cache company scans to avoid re-fetching (expires after 1 hour)
const scanCache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

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
  return {
    companyName: message.companyName || last.companyName || null,
    jobTitle: message.jobTitle || last.jobTitle || last.title || null,
    platform: message.platform || last.platform || null,
    platformJobId,
    listingUrl,
    location: last.location || null,
    salaryListed: last.salaryListed ?? false,
    isRepost: last.isRepost ?? false,
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
    fetch(`${API_BASE}/employer/score?` + params)
      .then(res => res.ok ? res.json() : null)
      .then(data => sendResponse({ data }))
      .catch(() => sendResponse({ data: null }));
    return true;
  }

  // --- Scan employer listings on Indeed ---
  if (message.type === 'SCAN_EMPLOYER_LISTINGS') {
    const companyName = message.name;
    const jobTitle = message.jobTitle || '';
    const cacheKey = companyName.toLowerCase();

    // Check cache
    const cached = scanCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      sendResponse({ data: cached.data });
      return true;
    }

    // Fetch Indeed search results for this company
    const searchUrl = `https://www.indeed.com/jobs?q=%22${encodeURIComponent(companyName)}%22&sort=date`;
    
    fetch(searchUrl)
      .then(res => res.text())
      .then(html => {
        const result = parseIndeedSearchResults(html, jobTitle);
        scanCache.set(cacheKey, { data: result, timestamp: Date.now() });
        console.log(`[SkipThisJob] Scanned ${companyName}: ${result.totalJobs} jobs, ${result.similarTitles} similar titles`);
        sendResponse({ data: result });
      })
      .catch(err => {
        console.warn('[SkipThisJob] Scan failed:', err.message);
        sendResponse({ data: null });
      });
    return true;
  }

  // --- Submit report ---
  if (message.type === 'SUBMIT_REPORT') {
    fetch(`${API_BASE}/report`, {
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
    fetch(`${API_BASE}/track`, {
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
    fetch(`${API_BASE}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

// Parse Indeed search results HTML for job count and title patterns
function parseIndeedSearchResults(html, currentTitle) {
  const result = {
    totalJobs: null,
    similarTitles: 0,
    titles: [],
  };

  // Extract total job count — Indeed shows "X jobs" or "Page 1 of X jobs"
  const countMatch = html.match(/(\d[\d,]*)\s*jobs?/i) ||
                     html.match(/"jobCount"\s*:\s*(\d+)/);
  if (countMatch) {
    result.totalJobs = parseInt(countMatch[1].replace(/,/g, ''));
  }

  // Extract job titles from the results page
  // Indeed uses data attributes and various class patterns for job titles
  const titleMatches = html.matchAll(/class="[^"]*jobTitle[^"]*"[^>]*>.*?<a[^>]*>.*?<span[^>]*>(.*?)<\/span>/gs) ||
                       html.matchAll(/data-testid="[^"]*jobTitle[^"]*"[^>]*>(.*?)<\//gs);
  
  const titles = [];
  for (const match of titleMatches) {
    const title = match[1].replace(/<[^>]*>/g, '').trim();
    if (title && title.length > 2) titles.push(title.toLowerCase());
  }

  // Also try simpler pattern
  if (titles.length === 0) {
    const simpleMatches = html.matchAll(/<h2[^>]*class="[^"]*jobTitle[^"]*"[^>]*>[\s\S]*?<span[^>]*>(.*?)<\/span>/gi);
    for (const match of simpleMatches) {
      const title = match[1].replace(/<[^>]*>/g, '').trim();
      if (title && title.length > 2) titles.push(title.toLowerCase());
    }
  }

  result.titles = titles;

  // Count titles similar to the current listing
  if (currentTitle) {
    const normalizedCurrent = currentTitle.toLowerCase().trim();
    result.similarTitles = titles.filter(t => {
      // Check for exact match or high similarity
      return t === normalizedCurrent ||
             t.includes(normalizedCurrent) ||
             normalizedCurrent.includes(t) ||
             // Check if core words overlap (e.g. "Senior Software Engineer" ~ "Software Engineer")
             overlapScore(t, normalizedCurrent) >= 0.6;
    }).length;
  }

  return result;
}

// Simple word overlap score between two strings
function overlapScore(a, b) {
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
  return overlap / Math.min(wordsA.size, wordsB.size);
}

// Clear badge when navigating away from job pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    const isJobPage = /linkedin\.com\/jobs|indeed\.com/.test(changeInfo.url);
    if (!isJobPage) {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }
});
