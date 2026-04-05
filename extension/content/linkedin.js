// ============================================================
// LinkedIn Content Script
// ============================================================
// Runs on linkedin.com/jobs/* pages.
// Parses the job listing DOM, computes a local heuristic score,
// fetches the employer score from the backend, and injects
// the ghost score overlay into the page.
// ============================================================

const API_BASE = 'https://skipthisjob.com/api'; // TODO: confirm after Vercel deploy

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
  };

  // --- Job title ---
  // LinkedIn uses h1 for the job title in the detail panel
  const titleEl =
    document.querySelector('.job-details-jobs-unified-top-card__job-title h1') ||
    document.querySelector('.jobs-unified-top-card__job-title') ||
    document.querySelector('h1.t-24') ||
    document.querySelector('[data-testid="job-title"]') ||
    document.querySelector('h1');
  if (titleEl) {
    data.title = titleEl.textContent.trim();
  }

  // --- Company name ---
  const companyEl =
    document.querySelector('.job-details-jobs-unified-top-card__company-name a') ||
    document.querySelector('.jobs-unified-top-card__company-name a') ||
    document.querySelector('[data-testid="company-name"]');
  if (companyEl) {
    data.companyName = companyEl.textContent.trim();
  }

  // --- Location ---
  const locationEl =
    document.querySelector('.job-details-jobs-unified-top-card__bullet') ||
    document.querySelector('.jobs-unified-top-card__bullet');
  if (locationEl) {
    data.location = locationEl.textContent.trim();
  }

  // --- Posted date / Repost detection ---
  // LinkedIn shows "Posted X days ago" or "Reposted X days ago"
  const timeElements = document.querySelectorAll(
    '.job-details-jobs-unified-top-card__primary-description-container span, ' +
    '.jobs-unified-top-card__posted-date, ' +
    'span.tvm__text'
  );
  for (const el of timeElements) {
    const text = el.textContent.trim().toLowerCase();

    if (text.includes('reposted')) {
      data.isRepost = true;
    }

    const daysMatch = text.match(/(\d+)\s*days?\s*ago/);
    const weeksMatch = text.match(/(\d+)\s*weeks?\s*ago/);
    const monthsMatch = text.match(/(\d+)\s*months?\s*ago/);
    const hoursMatch = text.match(/(\d+)\s*hours?\s*ago/);

    if (monthsMatch) {
      data.daysOpen = parseInt(monthsMatch[1]) * 30;
    } else if (weeksMatch) {
      data.daysOpen = parseInt(weeksMatch[1]) * 7;
    } else if (daysMatch) {
      data.daysOpen = parseInt(daysMatch[1]);
    } else if (hoursMatch) {
      data.daysOpen = 0;
    }
  }

  // --- Applicant count ---
  // LinkedIn shows "Over 200 applicants" or "Be among the first 25 applicants"
  const allText = document.body.innerText;
  const applicantMatch = allText.match(/(?:over\s+)?(\d[\d,]*)\+?\s*applicants?/i);
  if (applicantMatch) {
    data.applicantCount = parseInt(applicantMatch[1].replace(/,/g, ''));
  }

  // --- Salary ---
  const salaryEl =
    document.querySelector('.job-details-jobs-unified-top-card__job-insight--highlight span') ||
    document.querySelector('[data-testid="salary-info"]');
  if (salaryEl) {
    const salaryText = salaryEl.textContent.trim();
    if (/\$[\d,]+/.test(salaryText) || /\bper\s*(hour|year|month)\b/i.test(salaryText)) {
      data.salaryListed = true;
    }
  }
  // Also check the description for salary mentions
  const descEl = document.querySelector('.jobs-description-content__text, .jobs-description__content');
  if (descEl) {
    data.description = descEl.textContent.trim();
    if (!data.salaryListed && /\$[\d,]+\s*([-–]|to)\s*\$[\d,]+/i.test(data.description)) {
      data.salaryListed = true;
    }
  }

  // --- Hiring contact ---
  const hiringManagerEl =
    document.querySelector('.jobs-poster__name') ||
    document.querySelector('.hirer-card__hirer-information') ||
    document.querySelector('[data-testid="hirer-card"]');
  data.hiringContactVisible = !!hiringManagerEl;

  // --- Seniority level ---
  const insightEls = document.querySelectorAll('.job-details-jobs-unified-top-card__job-insight span');
  for (const el of insightEls) {
    const text = el.textContent.trim().toLowerCase();
    if (text.includes('entry level') || text.includes('internship')) {
      data.seniorityLevel = 'entry';
    } else if (text.includes('associate')) {
      data.seniorityLevel = 'entry';
    } else if (text.includes('mid-senior')) {
      data.seniorityLevel = 'senior';
    } else if (text.includes('director')) {
      data.seniorityLevel = 'director';
    } else if (text.includes('executive')) {
      data.seniorityLevel = 'c_suite';
    }
  }

  // --- Platform job ID (from URL) ---
  const jobIdMatch = window.location.href.match(/currentJobId=(\d+)/) ||
                     window.location.href.match(/\/jobs\/view\/(\d+)/);
  if (jobIdMatch) {
    data.platformJobId = jobIdMatch[1];
  }

  return data;
}


// ============================================================
// SCORING (local heuristic - from ghostScore.js, inlined here
// for extension standalone operation)
// ============================================================
// NOTE: In production you'd bundle ghostScore.js with the
// extension build. This is a simplified inline version.

function scoreLocally(listing) {
  let score = 0;
  const signals = [];

  // Posting age
  if (listing.daysOpen >= 60) {
    score += 15;
    signals.push(`Open ${listing.daysOpen} days`);
  } else if (listing.daysOpen >= 30) {
    score += 9;
    signals.push(`Open ${listing.daysOpen} days`);
  }

  // Repost
  if (listing.isRepost) {
    score += 20;
    signals.push('Marked as reposted');
  }

  // Applicants
  if (listing.applicantCount >= 500) {
    score += 12;
    signals.push(`${listing.applicantCount}+ applicants`);
  } else if (listing.applicantCount >= 200) {
    score += 6;
    signals.push(`${listing.applicantCount}+ applicants`);
  }

  // No salary
  if (!listing.salaryListed) {
    score += 5;
    signals.push('No salary listed');
  }

  // No hiring contact
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


// ============================================================
// BACKEND API CALLS
// ============================================================

async function fetchEmployerScore(companyName) {
  try {
    const res = await fetch(`${API_BASE}/employer/score?` + new URLSearchParams({
      name: companyName,
    }));
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[GhostDetector] Backend unavailable, using heuristic only:', e.message);
    return null;
  }
}

async function submitReport(reportData) {
  try {
    // Get or generate anonymous user hash
    let { userHash } = await chrome.storage.local.get('userHash');
    if (!userHash) {
      userHash = crypto.randomUUID();
      await chrome.storage.local.set({ userHash });
    }

    const res = await fetch(`${API_BASE}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...reportData,
        anonymousUserHash: userHash,
        platform: 'linkedin',
      }),
    });
    return res.ok;
  } catch (e) {
    console.error('[GhostDetector] Failed to submit report:', e);
    return false;
  }
}


// ============================================================
// UI INJECTION
// ============================================================

function injectOverlay(localScore, backendData, listing) {
  // Remove existing overlay if present
  const existing = document.getElementById('ghost-detector-overlay');
  if (existing) existing.remove();

  // Merge scores if backend data available
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

  // Color mapping
  const colors = {
    low: { bg: '#e8f5e9', border: '#4caf50', text: '#2e7d32', icon: '✅' },
    moderate: { bg: '#fff3e0', border: '#ff9800', text: '#e65100', icon: '⚠️' },
    high: { bg: '#fce4ec', border: '#f44336', text: '#c62828', icon: '🚩' },
    very_high: { bg: '#f3e5f5', border: '#9c27b0', text: '#6a1b9a', icon: '👻' },
  };
  const color = colors[finalLabel] || colors.moderate;

  const labelText = {
    low: 'Low Risk',
    moderate: 'Moderate Risk',
    high: 'High Risk',
    very_high: 'Ghost Alert',
  };

  // Build overlay HTML
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
        <div class="ghost-detector-community">
          📊 ${backendData.totalReports} community reports
        </div>
      ` : ''}

      <div class="ghost-detector-actions">
        <button class="ghost-detector-btn ghost-detector-btn-flag" id="ghost-btn-flag" title="Flag as ghost job">
          👎 Flag Ghost Job
        </button>
        <button class="ghost-detector-btn ghost-detector-btn-outcome" id="ghost-btn-outcome" title="Report your outcome">
          📝 Report Outcome
        </button>
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

      <div class="ghost-detector-flag-form" id="ghost-flag-form" style="display: none;">
        <div class="ghost-detector-form-title">Why is this suspicious?</div>
        <div class="ghost-detector-form-options">
          <button class="ghost-detector-option" data-flag="no_response">🔇 Applied, never heard back</button>
          <button class="ghost-detector-option" data-flag="reposted">🔄 Seen this reposted</button>
          <button class="ghost-detector-option" data-flag="vague_description">📝 Vague or generic listing</button>
          <button class="ghost-detector-option" data-flag="suspected_evergreen">♻️ Suspected evergreen</button>
        </div>
      </div>

      <div class="ghost-detector-footer">
        <span>Skip This Job by <a href="https://vibedigitalmarketing.com" target="_blank" rel="noopener">Vibe Digital Marketing</a> · <a href="https://skipthisjob.com" target="_blank" rel="noopener">skipthisjob.com</a></span>
      </div>
    </div>
  `;

  // Find insertion point - inject above or next to the job description
  const targetContainer =
    document.querySelector('.jobs-search__job-details') ||
    document.querySelector('.job-details-jobs-unified-top-card__container') ||
    document.querySelector('.jobs-unified-top-card') ||
    document.querySelector('.scaffold-layout__detail');

  if (targetContainer) {
    targetContainer.insertBefore(overlay, targetContainer.firstChild);
  } else {
    // Fallback: fixed position
    overlay.style.position = 'fixed';
    overlay.style.top = '80px';
    overlay.style.right = '20px';
    overlay.style.zIndex = '9999';
    document.body.appendChild(overlay);
  }

  // --- Event listeners ---

  // Flag button
  document.getElementById('ghost-btn-flag')?.addEventListener('click', () => {
    const form = document.getElementById('ghost-flag-form');
    const otherForm = document.getElementById('ghost-report-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    otherForm.style.display = 'none';
  });

  // Outcome button
  document.getElementById('ghost-btn-outcome')?.addEventListener('click', () => {
    const form = document.getElementById('ghost-report-form');
    const otherForm = document.getElementById('ghost-flag-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    otherForm.style.display = 'none';
  });

  // Flag option clicks
  document.querySelectorAll('[data-flag]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const flag = e.target.dataset.flag;
      const success = await submitReport({
        reportType: 'ghost_flag',
        companyName: listing.companyName,
        jobTitle: listing.title,
        platformJobId: listing.platformJobId,
        listingUrl: listing.listingUrl,
        flagReasons: [flag],
      });
      if (success) {
        btn.textContent = '✓ Reported';
        btn.disabled = true;
        btn.classList.add('ghost-detector-option--done');
      }
    });
  });

  // Outcome option clicks
  document.querySelectorAll('[data-outcome]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const outcome = e.target.dataset.outcome;
      const success = await submitReport({
        reportType: 'outcome',
        companyName: listing.companyName,
        jobTitle: listing.title,
        platformJobId: listing.platformJobId,
        listingUrl: listing.listingUrl,
        outcome: outcome,
      });
      if (success) {
        btn.textContent = '✓ Submitted';
        btn.disabled = true;
        btn.classList.add('ghost-detector-option--done');
      }
    });
  });
}


// ============================================================
// MAIN
// ============================================================

let lastProcessedUrl = null;
let debounceTimer = null;

async function processCurrentListing() {
  const currentUrl = window.location.href;
  if (currentUrl === lastProcessedUrl) return;
  lastProcessedUrl = currentUrl;

  // Wait a moment for LinkedIn's SPA to finish rendering
  await new Promise(resolve => setTimeout(resolve, 1500));

  const listing = parseLinkedInListing();
  if (!listing.title || !listing.companyName) {
    console.log('[GhostDetector] Could not parse listing, skipping');
    return;
  }

  console.log('[GhostDetector] Parsed listing:', listing.title, '@', listing.companyName);

  // Step 1: Compute local heuristic score (instant)
  const localScore = scoreLocally(listing);
  injectOverlay(localScore, null, listing);

  // Step 2: Fetch backend employer score (async, updates overlay)
  const backendData = await fetchEmployerScore(listing.companyName);
  if (backendData) {
    injectOverlay(localScore, backendData, listing);
  }
}

// LinkedIn is a SPA - watch for URL changes
function watchForNavigation() {
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastProcessedUrl) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processCurrentListing, 500);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Initial run
processCurrentListing();
watchForNavigation();
