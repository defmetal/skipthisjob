// ============================================================
// Indeed Content Script
// ============================================================
// Same logic as LinkedIn but adapted for Indeed's DOM structure.
// Indeed is a more traditional server-rendered page, so the
// DOM is more stable than LinkedIn's SPA but selectors still
// change periodically.
// ============================================================

const API_BASE = 'https://skipthisjob.com/api'; // TODO: confirm after Vercel deploy

// Reuse the same scoring, overlay injection, and API functions
// from linkedin.js. In production these would be shared modules
// bundled via webpack/rollup. For now, they're duplicated.

function parseIndeedListing() {
  const data = {
    title: null,
    companyName: null,
    location: null,
    daysOpen: null,
    isRepost: false,
    applicantCount: null,
    salaryListed: false,
    hiringContactVisible: false,
    description: null,
    seniorityLevel: null,
    platformJobId: null,
    listingUrl: window.location.href,
  };

  // --- Job title ---
  const titleEl =
    document.querySelector('h1.jobsearch-JobInfoHeader-title') ||
    document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]') ||
    document.querySelector('h1.icl-u-xs-mb--xs') ||
    document.querySelector('h2.jobTitle');
  if (titleEl) {
    data.title = titleEl.textContent.trim();
  }

  // --- Company name ---
  const companyEl =
    document.querySelector('[data-testid="inlineHeader-companyName"] a') ||
    document.querySelector('[data-testid="inlineHeader-companyName"]') ||
    document.querySelector('.jobsearch-InlineCompanyRating a') ||
    document.querySelector('.css-1ioi40n a');
  if (companyEl) {
    data.companyName = companyEl.textContent.trim();
  }

  // --- Location ---
  const locationEl =
    document.querySelector('[data-testid="inlineHeader-companyLocation"]') ||
    document.querySelector('[data-testid="job-location"]') ||
    document.querySelector('.jobsearch-JobInfoHeader-subtitle > div:nth-child(2)');
  if (locationEl) {
    data.location = locationEl.textContent.trim();
  }

  // --- Posted date ---
  const dateEl =
    document.querySelector('.jobsearch-HiringInsights-entry--bullet') ||
    document.querySelector('[data-testid="myJobsStateDate"]');
  if (dateEl) {
    const text = dateEl.textContent.trim().toLowerCase();
    const daysMatch = text.match(/(\d+)\s*days?\s*ago/) ||
                      text.match(/posted\s*(\d+)\s*days?/);
    const justPosted = text.match(/just\s*posted|today/);
    const daysPlus = text.match(/(\d+)\+\s*days/);

    if (daysPlus) {
      data.daysOpen = parseInt(daysPlus[1]);
    } else if (daysMatch) {
      data.daysOpen = parseInt(daysMatch[1]);
    } else if (justPosted) {
      data.daysOpen = 0;
    }
  }

  // --- Salary ---
  const salaryEl =
    document.querySelector('#salaryInfoAndJobType') ||
    document.querySelector('[data-testid="attribute_snippet_testid"]') ||
    document.querySelector('.jobsearch-JobMetadataHeader-item');
  if (salaryEl) {
    const text = salaryEl.textContent;
    if (/\$[\d,.]+/.test(text)) {
      data.salaryListed = true;
    }
  }

  // --- Description ---
  const descEl =
    document.querySelector('#jobDescriptionText') ||
    document.querySelector('.jobsearch-jobDescriptionText');
  if (descEl) {
    data.description = descEl.textContent.trim();
    if (!data.salaryListed && /\$[\d,]+\s*([-–]|to)\s*\$[\d,]+/i.test(data.description)) {
      data.salaryListed = true;
    }
  }

  // --- Job ID from URL ---
  const jobIdMatch = window.location.href.match(/jk=([a-f0-9]+)/) ||
                     window.location.href.match(/vjk=([a-f0-9]+)/);
  if (jobIdMatch) {
    data.platformJobId = jobIdMatch[1];
  }

  // Indeed doesn't reliably show applicant counts or hiring contacts
  // so these stay null and won't affect the score

  return data;
}


// --- Scoring (same as linkedin.js) ---
function scoreLocally(listing) {
  let score = 0;
  const signals = [];

  if (listing.daysOpen >= 60) {
    score += 15;
    signals.push(`Open ${listing.daysOpen} days`);
  } else if (listing.daysOpen >= 30) {
    score += 9;
    signals.push(`Open ${listing.daysOpen} days`);
  }

  if (listing.isRepost) {
    score += 20;
    signals.push('Marked as reposted');
  }

  if (listing.applicantCount >= 500) {
    score += 12;
    signals.push(`${listing.applicantCount}+ applicants`);
  } else if (listing.applicantCount >= 200) {
    score += 6;
    signals.push(`${listing.applicantCount}+ applicants`);
  }

  if (!listing.salaryListed) {
    score += 5;
    signals.push('No salary listed');
  }

  if (!listing.hiringContactVisible) {
    score += 5;
    signals.push('No hiring contact shown');
  }

  score = Math.min(100, Math.max(0, score));

  let label = 'low';
  if (score >= 75) label = 'very_high';
  else if (score >= 50) label = 'high';
  else if (score >= 25) label = 'moderate';

  return { score, label, signals };
}


// --- API calls (same as linkedin.js) ---
async function fetchEmployerScore(companyName) {
  try {
    const res = await fetch(`${API_BASE}/employer/score?` + new URLSearchParams({ name: companyName }));
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[GhostDetector] Backend unavailable:', e.message);
    return null;
  }
}

async function submitReport(reportData) {
  try {
    let { userHash } = await chrome.storage.local.get('userHash');
    if (!userHash) {
      userHash = crypto.randomUUID();
      await chrome.storage.local.set({ userHash });
    }
    const res = await fetch(`${API_BASE}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...reportData, anonymousUserHash: userHash, platform: 'indeed' }),
    });
    return res.ok;
  } catch (e) {
    console.error('[GhostDetector] Failed to submit report:', e);
    return false;
  }
}


// --- UI injection (reuses same overlay HTML/CSS from linkedin.js) ---
// In production, this would be a shared module. Omitted here for
// brevity - see linkedin.js injectOverlay() for the full implementation.
// The function is identical; just copy it here or import from shared.


// --- Main ---
async function processCurrentListing() {
  const listing = parseIndeedListing();
  if (!listing.title || !listing.companyName) {
    console.log('[GhostDetector] Could not parse Indeed listing, skipping');
    return;
  }

  console.log('[GhostDetector] Parsed Indeed listing:', listing.title, '@', listing.companyName);

  const localScore = scoreLocally(listing);
  // injectOverlay(localScore, null, listing);  // uncomment when overlay function is shared

  const backendData = await fetchEmployerScore(listing.companyName);
  // if (backendData) injectOverlay(localScore, backendData, listing);
}

// Indeed uses traditional page loads (not SPA), so just run once
processCurrentListing();
