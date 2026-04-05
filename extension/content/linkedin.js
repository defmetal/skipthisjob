// ============================================================
// LinkedIn Content Script — Skip This Job
// ============================================================

const API_BASE = 'https://skipthisjob.com/api';

let lastProcessedJobId = null;
let isProcessing = false;

// ============================================================
// DOM PARSING
// ============================================================

function parseLinkedInListing() {
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
    isThirdParty: false,        // posted by staffing agency / job board
    noResponseData: false,      // LinkedIn says "no response insights"
    responseManagedOffsite: false, // "responses managed off LinkedIn"
  };

  // Job title - LinkedIn now uses obfuscated classes, so find by URL pattern
  const titleEl =
    document.querySelector('.job-details-jobs-unified-top-card__job-title h1') ||
    document.querySelector('.jobs-unified-top-card__job-title') ||
    document.querySelector('.job-details-jobs-unified-top-card__job-title') ||
    document.querySelector('.t-24.t-bold') ||
    document.querySelector('h1');
  if (titleEl) {
    data.title = titleEl.textContent.trim();
    console.log('[GhostDetector] Found title via selector:', data.title);
  } else {
    // Fallback: find the job title link (href contains /jobs/view/)
    const jobLinks = document.querySelectorAll('a[href*="/jobs/view/"]');
    for (const link of jobLinks) {
      const text = link.textContent.trim();
      if (text && text.length > 3 && text.length < 150 && !text.includes('\n')) {
        data.title = text;
        console.log('[GhostDetector] Found title via /jobs/view/ link:', data.title);
        break;
      }
    }
    if (!data.title) {
      console.log('[GhostDetector] Title not found by any method');
    }
  }

  // Company name - try multiple selectors
  const companyEl =
    document.querySelector('.job-details-jobs-unified-top-card__company-name a') ||
    document.querySelector('.jobs-unified-top-card__company-name a') ||
    document.querySelector('.job-details-jobs-unified-top-card__company-name') ||
    document.querySelector('.artdeco-entity-lockup__subtitle a');
  if (companyEl) {
    data.companyName = companyEl.textContent.trim();
    console.log('[GhostDetector] Found company:', data.companyName);
  } else {
    // Fallback: find any link to a /company/ page in the detail panel
    const allLinks = document.querySelectorAll('a[href*="/company/"]');
    for (const link of allLinks) {
      const text = link.textContent.trim();
      if (text && text.length > 1 && text.length < 100) {
        data.companyName = text;
        console.log('[GhostDetector] Found company via /company/ link:', data.companyName);
        break;
      }
    }
    if (!data.companyName) {
      console.log('[GhostDetector] Company not found. Links on page with company:',
        [...document.querySelectorAll('a')].filter(a => (a.href||'').includes('company')).map(a => a.textContent.trim().substring(0, 40)));
    }
  }

  // Location
  const locationEl =
    document.querySelector('.job-details-jobs-unified-top-card__bullet') ||
    document.querySelector('.jobs-unified-top-card__bullet');
  if (locationEl) data.location = locationEl.textContent.trim();

  // Find the job detail panel text (NOT the sidebar)
  // Strategy: find the container near the job title link, then read its text
  let detailText = '';
  const titleLink = document.querySelector('a[href*="/jobs/view/"]');
  if (titleLink) {
    // Walk up to find the detail panel container (usually 5-8 levels up)
    let container = titleLink;
    for (let i = 0; i < 10; i++) {
      container = container.parentElement;
      if (!container) break;
      // Stop when we find a container that's large enough to be the detail panel
      if (container.offsetWidth > 500 && container.offsetHeight > 300) break;
    }
    if (container) {
      detailText = container.innerText.toLowerCase();
    }
  }
  // Fallback if we couldn't find a scoped container
  if (!detailText) {
    detailText = document.body.innerText.toLowerCase();
    console.log('[GhostDetector] Warning: using full page text, scores may be inaccurate');
  }

  // Posted date + Repost detection
  if (detailText.includes('reposted')) {
    data.isRepost = true;
    console.log('[GhostDetector] Detected: Reposted');
  }

  // Match date patterns - prefer "reposted X ago" over generic "X ago"
  const monthsMatch = detailText.match(/reposted\s+(\d+)\s*months?\s*ago/) || detailText.match(/(\d+)\s*months?\s*ago/);
  const weeksMatch = detailText.match(/reposted\s+(\d+)\s*weeks?\s*ago/) || detailText.match(/(\d+)\s*weeks?\s*ago/);
  const daysMatch = detailText.match(/reposted\s+(\d+)\s*days?\s*ago/) || detailText.match(/(\d+)\s*days?\s*ago/);
  const hoursMatch = detailText.match(/(\d+)\s*hours?\s*ago/);

  if (monthsMatch) data.daysOpen = parseInt(monthsMatch[1]) * 30;
  else if (weeksMatch) data.daysOpen = parseInt(weeksMatch[1]) * 7;
  else if (daysMatch) data.daysOpen = parseInt(daysMatch[1]);
  else if (hoursMatch) data.daysOpen = 0;

  if (data.daysOpen != null) console.log('[GhostDetector] Days open:', data.daysOpen);

  // Applicant count  
  const applicantMatch = detailText.match(/(?:over\s+)?(\d[\d,]*)\+?\s*(?:applicants?|people\s+clicked\s+apply)/i);
  if (applicantMatch) {
    data.applicantCount = parseInt(applicantMatch[1].replace(/,/g, ''));
    console.log('[GhostDetector] Applicants:', data.applicantCount);
  }

  // Salary
  const salaryMatch = detailText.match(/\$[\d,]+\s*[kK]?\s*([-–\/]|to|per)\s*/i);
  if (salaryMatch) {
    data.salaryListed = true;
    console.log('[GhostDetector] Salary found');
  }

  // Third-party recruiter / staffing agency detection
  const thirdPartyPatterns = [
    /posted\s+(by|on behalf of)\s+.+\s+(on behalf|partner|client)/i,
    /on behalf of a partner/i,
    /this position is posted by .+ on behalf/i,
    /staffing|recruiting agency|recruitment agency/i,
  ];
  for (const pattern of thirdPartyPatterns) {
    if (pattern.test(detailText)) {
      data.isThirdParty = true;
      console.log('[GhostDetector] Third-party/staffing detected');
      break;
    }
  }

  // Known job board / staffing company names posting as "employers"
  const knownAggregators = [
    'jobgether', 'crossover', 'hays', 'robert half', 'adecco', 'randstad',
    'manpower', 'kelly services', 'insight global', 'tek systems', 'kforce',
    'apex systems', 'modis', 'aerotek', 'talent.com', 'lensa', 'dice',
    'jobot', 'cybercoders', 'toptal', 'hired', 'turing',
  ];
  const companyLower = (data.companyName || '').toLowerCase();
  if (knownAggregators.some(name => companyLower.includes(name))) {
    data.isThirdParty = true;
    console.log('[GhostDetector] Known staffing/aggregator company:', data.companyName);
  }

  // "No response insights available yet" — LinkedIn is telling you this employer ghosts
  if (detailText.includes('no response insights')) {
    data.noResponseData = true;
    console.log('[GhostDetector] No response insights available');
  }

  // "Responses managed off LinkedIn" — can't track if they respond
  if (detailText.includes('responses managed off linkedin') || detailText.includes('managed off linkedin')) {
    data.responseManagedOffsite = true;
    console.log('[GhostDetector] Responses managed off LinkedIn');
  }

  // Description - try to find the job description section
  const descEl = document.querySelector('.jobs-description-content__text') || 
    document.querySelector('.jobs-description__content') || 
    document.querySelector('.jobs-box__html-content') ||
    document.querySelector('[data-testid="job-details"]');
  if (descEl) {
    data.description = descEl.textContent.trim();
    if (!data.salaryListed && /\$[\d,]+\s*([-–]|to)\s*\$[\d,]+/i.test(data.description)) {
      data.salaryListed = true;
    }
  }

  // Hiring contact - check if recruiter/HM is shown
  const hiringEl =
    document.querySelector('.jobs-poster__name') ||
    document.querySelector('.hirer-card__hirer-information') ||
    document.querySelector('[data-testid="hirer-card"]');
  data.hiringContactVisible = !!hiringEl || detailText.includes('people you can reach out to');
  console.log('[GhostDetector] Hiring contact visible:', data.hiringContactVisible);

  // Seniority from detail panel text
  if (detailText.includes('entry level') || detailText.includes('internship')) data.seniorityLevel = 'entry';
  else if (detailText.includes('mid-senior')) data.seniorityLevel = 'senior';
  else if (detailText.includes('director')) data.seniorityLevel = 'director';
  else if (detailText.includes('executive')) data.seniorityLevel = 'c_suite';

  // Job ID from URL
  const jobIdMatch = window.location.href.match(/currentJobId=(\d+)/) ||
                     window.location.href.match(/\/jobs\/view\/(\d+)/);
  if (jobIdMatch) data.platformJobId = jobIdMatch[1];

  console.log('[GhostDetector] Full parsed data:', JSON.stringify(data, null, 2));

  return data;
}


// ============================================================
// SCORING (local heuristic)
// ============================================================

function scoreLocally(listing) {
  let score = 0;
  const signals = [];

  if (listing.daysOpen != null) {
    if (listing.daysOpen >= 60) {
      score += 15;
      signals.push(`Open ${listing.daysOpen} days`);
    } else if (listing.daysOpen >= 30) {
      score += 9;
      signals.push(`Open ${listing.daysOpen} days`);
    }
  }

  if (listing.isRepost) {
    score += 20;
    signals.push('Marked as reposted');
  }

  if (listing.applicantCount != null) {
    if (listing.applicantCount >= 500) {
      score += 12;
      signals.push(`${listing.applicantCount}+ applicants`);
    } else if (listing.applicantCount >= 200) {
      score += 6;
      signals.push(`${listing.applicantCount}+ applicants`);
    }
  }

  if (!listing.salaryListed) {
    score += 5;
    signals.push('No salary listed');
  }

  if (!listing.hiringContactVisible) {
    score += 5;
    signals.push('No hiring contact shown');
  }

  // Third-party recruiter / staffing agency
  if (listing.isThirdParty) {
    score += 15;
    signals.push('Posted by staffing agency or job board');
  }

  // LinkedIn has no response data for this employer
  if (listing.noResponseData) {
    score += 8;
    signals.push('No employer response data on LinkedIn');
  }

  // Responses managed off-platform
  if (listing.responseManagedOffsite) {
    score += 5;
    signals.push('Responses managed off LinkedIn');
  }

  score = Math.min(100, Math.max(0, score));

  let label = 'low';
  if (score >= 75) label = 'very_high';
  else if (score >= 50) label = 'high';
  else if (score >= 25) label = 'moderate';

  return { score, label, signals };
}


// ============================================================
// BACKEND API (via background service worker to avoid CORS)
// ============================================================

async function fetchEmployerScore(companyName) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      { type: 'FETCH_EMPLOYER_SCORE', name: companyName },
      response => resolve(response?.data || null)
    );
  });
}

async function submitReport(reportData) {
  let { userHash } = await chrome.storage.local.get('userHash');
  if (!userHash) {
    userHash = crypto.randomUUID();
    await chrome.storage.local.set({ userHash });
  }

  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      {
        type: 'SUBMIT_REPORT',
        reportData: { ...reportData, anonymousUserHash: userHash, platform: 'linkedin' },
      },
      response => resolve(response?.success || false)
    );
  });
}


// ============================================================
// UI INJECTION
// ============================================================

function injectOverlay(localScore, backendData, listing) {
  const existing = document.getElementById('ghost-detector-overlay');
  if (existing) existing.remove();

  let finalScore, finalLabel, finalSignals;
  if (backendData && backendData.score != null) {
    finalScore = Math.round(localScore.score * 0.4 + backendData.score * 0.6);
    finalLabel = finalScore >= 75 ? 'very_high' : finalScore >= 50 ? 'high' : finalScore >= 25 ? 'moderate' : 'low';
    finalSignals = [...new Set([...localScore.signals, ...(backendData.signals || [])])];
  } else {
    finalScore = localScore.score;
    finalLabel = localScore.label;
    finalSignals = localScore.signals;
  }

  const colors = {
    low: { bg: '#e8f5e9', border: '#4caf50', text: '#2e7d32', icon: '✅' },
    moderate: { bg: '#fff3e0', border: '#ff9800', text: '#e65100', icon: '⚠️' },
    high: { bg: '#fce4ec', border: '#f44336', text: '#c62828', icon: '🚩' },
    very_high: { bg: '#f3e5f5', border: '#9c27b0', text: '#6a1b9a', icon: '👻' },
  };
  const color = colors[finalLabel] || colors.moderate;
  const labelText = { low: 'Low Risk', moderate: 'Moderate Risk', high: 'High Risk', very_high: 'Ghost Alert' };

  const overlay = document.createElement('div');
  overlay.id = 'ghost-detector-overlay';
  overlay.innerHTML = `
    <div class="ghost-detector-card" style="border-left: 4px solid ${color.border}; background: ${color.bg};">
      <div class="ghost-detector-header">
        <span class="ghost-detector-icon">${color.icon}</span>
        <span class="ghost-detector-title">Ghost Risk: <strong style="color: ${color.text}">${labelText[finalLabel]}</strong></span>
        <span class="ghost-detector-score" style="color: ${color.text}">${finalScore}/100</span>
      </div>
      ${finalSignals.length > 0 ? `
        <div class="ghost-detector-signals">
          ${finalSignals.map(s => `<span class="ghost-detector-signal">${s}</span>`).join('')}
        </div>
      ` : ''}
      ${backendData && backendData.glassdoor ? `
        <div class="ghost-detector-glassdoor">
          <span class="ghost-detector-glassdoor-label">Glassdoor:</span>
          <span>${backendData.glassdoor.rating}/5</span>
          ${backendData.glassdoor.offerRate != null ? `<span>• ${Math.round(backendData.glassdoor.offerRate * 100)}% offer rate</span>` : ''}
          ${backendData.glassdoor.url ? `<a href="${backendData.glassdoor.url}" target="_blank" rel="noopener">View →</a>` : ''}
        </div>
      ` : ''}
      ${backendData && backendData.totalReports > 0 ? `
        <div class="ghost-detector-community">📊 ${backendData.totalReports} community reports</div>
      ` : ''}
      <div class="ghost-detector-actions">
        <button class="ghost-detector-btn ghost-detector-btn-flag" id="ghost-btn-flag">👎 Flag Ghost Job</button>
        <button class="ghost-detector-btn ghost-detector-btn-outcome" id="ghost-btn-outcome">📝 Report Outcome</button>
      </div>
      <div class="ghost-detector-flag-form" id="ghost-flag-form" style="display: none;">
        <div class="ghost-detector-form-title">Why is this suspicious?</div>
        <div class="ghost-detector-form-options">
          <button class="ghost-detector-option" data-flag="no_response">🔇 Applied, never heard back</button>
          <button class="ghost-detector-option" data-flag="reposted">🔄 Seen this reposted</button>
          <button class="ghost-detector-option" data-flag="vague_description">📝 Vague or generic listing</button>
          <button class="ghost-detector-option" data-flag="suspected_evergreen">♻️ Suspected evergreen</button>
        </div>
      </div>
      <div class="ghost-detector-report-form" id="ghost-report-form" style="display: none;">
        <div class="ghost-detector-form-title">What happened?</div>
        <div class="ghost-detector-form-options">
          <button class="ghost-detector-option" data-outcome="no_response">🔇 No Response</button>
          <button class="ghost-detector-option" data-outcome="rejected">❌ Rejected</button>
          <button class="ghost-detector-option" data-outcome="interviewed">🤝 Got Interview</button>
          <button class="ghost-detector-option" data-outcome="offered">🎉 Got Offer</button>
        </div>
      </div>
      <div class="ghost-detector-footer">
        <span>Skip This Job by <a href="https://vibedigitalmarketing.com" target="_blank" rel="noopener">Vibe Digital Marketing</a> · <a href="https://skipthisjob.com" target="_blank" rel="noopener">skipthisjob.com</a></span>
      </div>
    </div>
  `;

  const target =
    document.querySelector('.jobs-search__job-details') ||
    document.querySelector('.job-details-jobs-unified-top-card__container') ||
    document.querySelector('.jobs-unified-top-card') ||
    document.querySelector('.scaffold-layout__detail');

  if (target) {
    target.insertBefore(overlay, target.firstChild);
  } else {
    overlay.style.position = 'fixed';
    overlay.style.top = '80px';
    overlay.style.right = '20px';
    overlay.style.zIndex = '9999';
    overlay.style.maxWidth = '360px';
    document.body.appendChild(overlay);
  }

  // Event listeners
  document.getElementById('ghost-btn-flag')?.addEventListener('click', () => {
    const form = document.getElementById('ghost-flag-form');
    const other = document.getElementById('ghost-report-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    other.style.display = 'none';
  });

  document.getElementById('ghost-btn-outcome')?.addEventListener('click', () => {
    const form = document.getElementById('ghost-report-form');
    const other = document.getElementById('ghost-flag-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    other.style.display = 'none';
  });

  overlay.querySelectorAll('[data-flag]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const success = await submitReport({
        reportType: 'ghost_flag',
        companyName: listing.companyName,
        jobTitle: listing.title,
        platformJobId: listing.platformJobId,
        listingUrl: listing.listingUrl,
        flagReasons: [e.target.dataset.flag],
      });
      if (success) { btn.textContent = '✓ Reported'; btn.disabled = true; }
    });
  });

  overlay.querySelectorAll('[data-outcome]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const success = await submitReport({
        reportType: 'outcome',
        companyName: listing.companyName,
        jobTitle: listing.title,
        platformJobId: listing.platformJobId,
        listingUrl: listing.listingUrl,
        outcome: e.target.dataset.outcome,
      });
      if (success) { btn.textContent = '✓ Submitted'; btn.disabled = true; }
    });
  });
}


// ============================================================
// MAIN — poll-based, no MutationObserver
// ============================================================

function getCurrentJobId() {
  const match = window.location.href.match(/currentJobId=(\d+)/) ||
                window.location.href.match(/\/jobs\/view\/(\d+)/);
  return match ? match[1] : null;
}

async function processCurrentListing() {
  const jobId = getCurrentJobId();
  if (!jobId || jobId === lastProcessedJobId || isProcessing) return;

  isProcessing = true;
  lastProcessedJobId = jobId;

  // Wait for LinkedIn SPA to render
  await new Promise(resolve => setTimeout(resolve, 2000));

  const listing = parseLinkedInListing();
  if (!listing.title || !listing.companyName) {
    console.log('[SkipThisJob] Could not parse listing — selectors may need updating');
    isProcessing = false;
    return;
  }

  console.log('[SkipThisJob] Scored:', listing.title, '@', listing.companyName);

  const localScore = scoreLocally(listing);
  injectOverlay(localScore, null, listing);

  // Backend fetch (non-blocking, updates overlay if data exists)
  const backendData = await fetchEmployerScore(listing.companyName);
  if (backendData && backendData.found) {
    injectOverlay(localScore, backendData, listing);
  }

  isProcessing = false;
}

// Poll every 1 second for URL changes (LinkedIn is a SPA)
setInterval(() => {
  const jobId = getCurrentJobId();
  if (jobId && jobId !== lastProcessedJobId && !isProcessing) {
    processCurrentListing();
  }
}, 1000);

// Also listen for clicks on job listing cards in the sidebar
document.addEventListener('click', (e) => {
  const jobCard = e.target.closest('a[href*="/jobs/view/"], [data-job-id], .job-card-container, .jobs-search-results__list-item');
  if (jobCard) {
    // Small delay to let LinkedIn update the URL and render
    setTimeout(() => {
      const jobId = getCurrentJobId();
      if (jobId && jobId !== lastProcessedJobId && !isProcessing) {
        processCurrentListing();
      }
    }, 1500);
  }
}, true);

// Initial run
processCurrentListing();
