// ============================================================
// Indeed Content Script — Skip This Job
// ============================================================

const API_BASE = 'https://skipthisjob.com/api';

// ============================================================
// DOM PARSING
// ============================================================

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
    isThirdParty: false,
    noResponseData: false,
  };

  // --- Job title ---
  const titleEl =
    document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]') ||
    document.querySelector('h2.jobsearch-JobInfoHeader-title') ||
    document.querySelector('h1.jobsearch-JobInfoHeader-title') ||
    document.querySelector('.jobsearch-JobInfoHeader-title') ||
    document.querySelector('h2.jobTitle') ||
    document.querySelector('h1');
  if (titleEl) {
    // Indeed appends "- job post" via a nested span — grab just the first text
    const firstSpan = titleEl.querySelector('span');
    data.title = (firstSpan || titleEl).textContent.trim().replace(/\s*-\s*job post$/i, '');
    console.log('[SkipThisJob] Title:', data.title);
  } else {
    console.log('[SkipThisJob] Title not found');
  }

  // --- Company name ---
  const companyEl =
    document.querySelector('[data-testid="jobsearch-CompanyInfoContainer"] a') ||
    document.querySelector('[data-testid="inlineHeader-companyName"] a') ||
    document.querySelector('[data-testid="inlineHeader-companyName"]') ||
    document.querySelector('[data-testid="jobsearch-CompanyInfoContainer"]') ||
    document.querySelector('.jobsearch-InlineCompanyRating a') ||
    document.querySelector('.jobsearch-CompanyInfoContainer a');
  if (companyEl) {
    data.companyName = companyEl.textContent.trim();
    console.log('[SkipThisJob] Company:', data.companyName);
  } else {
    console.log('[SkipThisJob] Company not found');
  }

  // --- Location ---
  const locationEl =
    document.querySelector('[data-testid="inlineHeader-companyLocation"]') ||
    document.querySelector('[data-testid="job-location"]') ||
    document.querySelector('.jobsearch-JobInfoHeader-subtitle > div:nth-child(2)') ||
    document.querySelector('.jobsearch-CompanyInfoContainer div:last-child');
  if (locationEl) {
    data.location = locationEl.textContent.trim();
  }

  // --- Page text for signal detection ---
  const pageText = document.body.innerText.toLowerCase();

  // --- Posted date ---
  const dateEl =
    document.querySelector('.jobsearch-HiringInsights-entry--bullet') ||
    document.querySelector('[data-testid="myJobsStateDate"]');
  
  let dateText = dateEl ? dateEl.textContent.trim().toLowerCase() : '';
  
  // Also try to find date in the page text
  if (!dateText) {
    const dateMatch = pageText.match(/(posted|active)\s+(\d+)\+?\s*days?\s*ago/);
    if (dateMatch) dateText = dateMatch[0];
  }

  if (dateText) {
    const daysPlus = dateText.match(/(\d+)\+\s*days/);
    const daysMatch = dateText.match(/(\d+)\s*days?\s*ago/);
    const justPosted = dateText.match(/just\s*posted|today/);

    if (daysPlus) data.daysOpen = parseInt(daysPlus[1]);
    else if (daysMatch) data.daysOpen = parseInt(daysMatch[1]);
    else if (justPosted) data.daysOpen = 0;
  }

  if (data.daysOpen != null) console.log('[SkipThisJob] Days open:', data.daysOpen);

  // --- Salary ---
  const salaryEl =
    document.querySelector('#salaryInfoAndJobType') ||
    document.querySelector('[data-testid="attribute_snippet_testid"]') ||
    document.querySelector('.jobsearch-JobMetadataHeader-item') ||
    document.querySelector('.salary-snippet-container');
  if (salaryEl && /\$[\d,.]+/.test(salaryEl.textContent)) {
    data.salaryListed = true;
    console.log('[SkipThisJob] Salary found');
  }

  // --- Description ---
  const descEl =
    document.querySelector('#jobDescriptionText') ||
    document.querySelector('.jobsearch-jobDescriptionText') ||
    document.querySelector('.jobsearch-JobComponent-description');
  if (descEl) {
    data.description = descEl.textContent.trim();
    if (!data.salaryListed && /\$[\d,]+\s*([-–]|to)\s*\$[\d,]+/i.test(data.description)) {
      data.salaryListed = true;
    }
  }

  // --- Staffing / third-party detection ---
  const thirdPartyPatterns = [
    /posted by .+ on behalf/i,
    /staffing|recruiting agency|recruitment agency/i,
    /this is a .+ position through/i,
    /contract.+through\s/i,
  ];
  for (const pattern of thirdPartyPatterns) {
    if (pattern.test(pageText)) {
      data.isThirdParty = true;
      break;
    }
  }

  const knownAggregators = [
    'jobgether', 'crossover', 'hays', 'robert half', 'adecco', 'randstad',
    'manpower', 'kelly services', 'insight global', 'tek systems', 'kforce',
    'apex systems', 'modis', 'aerotek', 'talent.com', 'lensa', 'dice',
    'jobot', 'cybercoders', 'toptal', 'hired', 'turing',
  ];
  const companyLower = (data.companyName || '').toLowerCase();
  if (knownAggregators.some(name => companyLower.includes(name))) {
    data.isThirdParty = true;
    console.log('[SkipThisJob] Known staffing/aggregator:', data.companyName);
  }

  // --- Hiring insights ---
  // Indeed shows employer responsiveness signals in the sidebar cards
  if (pageText.includes('often replies in')) {
    data.employerResponsive = true;
    console.log('[SkipThisJob] Employer responsive');
  }
  if (pageText.includes('hiring multiple candidates')) {
    data.hiringMultiple = true;
  }

  // Engagement signals — Indeed shows these when the employer is actively reviewing
  data.activelyReviewing = pageText.includes('reviewing applicants') || 
                           pageText.includes('actively reviewing') ||
                           pageText.includes('recently active');
  if (data.activelyReviewing) {
    console.log('[SkipThisJob] Employer actively reviewing');
  }

  // "Urgently hiring" — can be legitimate or evergreen bait
  data.urgentlyHiring = pageText.includes('urgently hiring');

  // "Apply on company site" — redirects off Indeed, less trackable
  const applyBtn = document.querySelector('[data-testid="apply-button-container"]') ||
                   document.querySelector('.jobsearch-IndeedApplyButton-newDesign') ||
                   document.querySelector('button[id*="apply"], a[id*="apply"]');
  const applyText = applyBtn ? applyBtn.textContent.toLowerCase() : '';
  data.appliesOffsite = applyText.includes('company site') || applyText.includes('apply on') || 
                        pageText.includes('apply on company site');

  // Indeed employer rating (shown on the page like "3.5 ⭐")
  const ratingEl = document.querySelector('[data-testid="inlineHeader-companyRating"]') ||
                   document.querySelector('.jobsearch-CompanyInfoContainer .ratingsDisplay');
  if (!ratingEl) {
    const ratingMatch = pageText.match(/(\d\.\d)\s*(?:out of 5|★|star)/);
    if (ratingMatch) data.indeedRating = parseFloat(ratingMatch[1]);
  } else {
    const ratingText = ratingEl.textContent.match(/(\d\.\d)/);
    if (ratingText) data.indeedRating = parseFloat(ratingText[1]);
  }
  if (data.indeedRating) console.log('[SkipThisJob] Indeed rating:', data.indeedRating);

  // Description length
  data.descriptionLength = data.description ? data.description.length : 0;

  // Seniority mismatch — "entry level" title but requires 5+ years
  data.seniorityMismatch = false;
  if (data.description) {
    const descLower = data.description.toLowerCase();
    const titleLower = (data.title || '').toLowerCase();
    const entrySignals = /entry[- ]level|junior|associate|intern|graduate/i;
    const seniorReqs = /(?:5|6|7|8|9|10)\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/i;
    if ((entrySignals.test(titleLower) || entrySignals.test(descLower.slice(0, 200))) && seniorReqs.test(descLower)) {
      data.seniorityMismatch = true;
      console.log('[SkipThisJob] Seniority mismatch detected');
    }
  }

  // Check for "active X days ago" which is different from "posted X days ago"
  if (data.daysOpen == null) {
    const activeMatch = pageText.match(/active\s+(\d+)\s*days?\s*ago/);
    if (activeMatch) {
      data.daysOpen = parseInt(activeMatch[1]);
      console.log('[SkipThisJob] Active days ago:', data.daysOpen);
    }
  }

  // --- Job ID from URL ---
  const jobIdMatch = window.location.href.match(/jk=([a-f0-9]+)/) ||
                     window.location.href.match(/vjk=([a-f0-9]+)/);
  if (jobIdMatch) data.platformJobId = jobIdMatch[1];

  console.log('[SkipThisJob] Parsed:', JSON.stringify({
    title: data.title, company: data.companyName, days: data.daysOpen,
    salary: data.salaryListed, thirdParty: data.isThirdParty
  }));

  return data;
}


// ============================================================
// SCORING
// ============================================================

function scoreLocally(listing) {
  let score = 0;
  const signals = [];

  // === INDEED PLATFORM BASELINE ===
  // Indeed provides less transparency than LinkedIn — no applicant counts,
  // no repost labels, no hiring contact info, no response insights on most
  // listings. The absence of this data IS a signal. Start with a baseline
  // that reflects the platform's opacity.
  score += 10;

  // === POSTING AGE ===
  if (listing.daysOpen != null) {
    if (listing.daysOpen >= 60) {
      score += 15;
      signals.push(`Open ${listing.daysOpen}+ days`);
    } else if (listing.daysOpen >= 30) {
      score += 9;
      signals.push(`Open ${listing.daysOpen} days`);
    } else if (listing.daysOpen >= 14) {
      score += 3;
    } else if (listing.daysOpen <= 3) {
      score -= 5; // freshly posted is a good sign
    }
  } else {
    score += 5;
    signals.push('Posting age unknown');
  }

  // === REPOST ===
  if (listing.isRepost) {
    score += 20;
    signals.push('Marked as reposted');
  }

  // === SALARY ===
  if (!listing.salaryListed) {
    score += 5;
    signals.push('No salary listed');
  }

  // === THIRD PARTY ===
  if (listing.isThirdParty) {
    score += 15;
    signals.push('Posted by staffing agency or job board');
  }

  // === EMPLOYER RESPONSIVENESS ===
  if (listing.employerResponsive) {
    score -= 5; // positive signal but shouldn't cancel red flags
    signals.push('✓ Employer responds quickly');
  } else {
    score += 8;
    signals.push('No employer response data');
  }

  // === APPLY METHOD ===
  if (listing.appliesOffsite) {
    score += 5;
    signals.push('Applies redirect off Indeed');
  }

  // === INDEED EMPLOYER RATING ===
  if (listing.indeedRating != null) {
    if (listing.indeedRating < 2.5) {
      score += 10;
      signals.push(`Indeed rating: ${listing.indeedRating}/5`);
    } else if (listing.indeedRating < 3.0) {
      score += 5;
      signals.push(`Indeed rating: ${listing.indeedRating}/5`);
    } else if (listing.indeedRating >= 4.0) {
      score -= 3; // well-rated employer
    }
  }

  // === DESCRIPTION QUALITY ===
  if (listing.description) {
    // Very short description
    if (listing.descriptionLength < 300) {
      score += 8;
      signals.push('Very short job description');
    }

    // Vague buzzwords
    const vagueCount = [
      /fast[- ]paced environment/i,
      /wear many hats/i,
      /self[- ]starter/i,
      /rockstar|ninja|guru|wizard/i,
      /competitive (salary|compensation|pay)/i,
      /exciting opportunity/i,
      /other duties as assigned/i,
      /great (benefits|culture|team)/i,
      /must be able to multitask/i,
      /detail[- ]oriented/i,
      /results[- ]driven/i,
    ].filter(p => p.test(listing.description)).length;

    if (vagueCount >= 4) {
      score += 10;
      signals.push('Vague or generic description');
    } else if (vagueCount >= 2) {
      score += 5;
      signals.push('Some generic language in description');
    }
  } else {
    score += 5;
    signals.push('No description available');
  }

  // === HIRING MULTIPLE ===
  if (listing.hiringMultiple) {
    score += 3;
    signals.push('Hiring multiple candidates');
  }

  // === ENGAGEMENT SIGNALS ===
  // Indeed's own advice: listings older than 30 days with no 
  // "Reviewing Applicants" or "Recently Active" badge are highly suspicious
  if (listing.activelyReviewing) {
    score -= 8; // strong positive signal
    signals.push('✓ Employer actively reviewing applications');
  } else if (listing.daysOpen != null && listing.daysOpen >= 14) {
    // Old listing with NO engagement signals = stale/ghost
    score += 10;
    signals.push('No active review signals on older listing');
  }

  // === SENIORITY MISMATCH ===
  // Indeed flags this: "entry-level" with "5+ years required"
  if (listing.seniorityMismatch) {
    score += 12;
    signals.push('⚠️ Seniority mismatch — entry role requires senior experience');
  }

  // === STALE LISTING COMBO ===
  // The worst signal: old + no engagement + no response data + no salary
  // This is the classic ghost job pattern
  if (listing.daysOpen >= 30 && !listing.activelyReviewing && 
      !listing.employerResponsive && !listing.salaryListed) {
    score += 10;
    signals.push('🚩 Stale listing pattern: old, no engagement, no salary');
  }

  // === HIGH TURNOVER ROLE ===
  const HIGH_TURNOVER_PATTERNS = [
    /barista/i, /crew\s*member/i, /team\s*member/i, /cashier/i,
    /sales\s*associate/i, /retail\s*associate/i, /warehouse/i,
    /delivery\s*driver/i, /package\s*handler/i, /registered\s*nurse/i,
    /\b(lpn|lvn|cna)\b/i, /nursing\s*assistant/i, /home\s*health/i,
    /caregiver/i, /security\s*(officer|guard)/i, /janitor|custodian/i,
    /housekeeper/i, /front\s*desk/i, /dishwasher|line\s*cook|server|bartender/i,
    /call\s*center/i, /customer\s*service\s*rep/i, /truck\s*driver/i,
    /forklift/i, /picker|packer|stocker/i, /medical\s*assistant/i,
  ];
  const isHighTurnover = listing.title && HIGH_TURNOVER_PATTERNS.some(p => p.test(listing.title));
  if (isHighTurnover) {
    signals.push('⚡ High turnover role — expect frequent reposting');
  }

  score = Math.min(100, Math.max(0, score));

  let label = 'low';
  if (score >= 75) label = 'very_high';
  else if (score >= 50) label = 'high';
  else if (score >= 25) label = 'moderate';

  return { score, label, signals, isHighTurnover };
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
        reportData: { ...reportData, anonymousUserHash: userHash, platform: 'indeed' },
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
      ${backendData && backendData.found && backendData.totalListings ? `
        <div class="ghost-detector-community">📋 Based on ${backendData.totalListings} tracked listings for this employer</div>
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

  // Fixed-position overlay — Indeed constantly destroys and recreates
  // the right pane content, so we float independently of their DOM.
  overlay.style.position = 'fixed';
  overlay.style.top = '80px';
  overlay.style.right = '20px';
  overlay.style.zIndex = '99999';
  overlay.style.maxWidth = '340px';
  overlay.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
  overlay.style.borderRadius = '10px';
  document.body.appendChild(overlay);

  // --- Event listeners ---
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
      if (success) { btn.textContent = '✓ Reported'; btn.disabled = true; }
    });
  });

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
      if (success) { btn.textContent = '✓ Submitted'; btn.disabled = true; }
    });
  });
}


// ============================================================
// MAIN
// ============================================================

let lastVjk = null;
let isProcessing = false;

function getCurrentVjk() {
  const match = window.location.href.match(/vjk=([a-f0-9]+)/);
  return match ? match[1] : window.location.href;
}

async function processCurrentListing() {
  const vjk = getCurrentVjk();
  if (vjk === lastVjk && lastVjk !== null) return;
  if (isProcessing) return;

  isProcessing = true;
  lastVjk = vjk;

  // Wait for page to render
  await new Promise(resolve => setTimeout(resolve, 1500));

  const listing = parseIndeedListing();
  if (!listing.title || !listing.companyName) {
    console.log('[SkipThisJob] Could not parse Indeed listing, skipping');
    isProcessing = false;
    return;
  }

  const localScore = scoreLocally(listing);
  injectOverlay(localScore, null, listing);

  // Fetch backend employer score
  const backendData = await fetchEmployerScore(listing.companyName);

  // TODO: Live employer scan disabled — Indeed's raw HTML doesn't include
  // the actual job count (it's loaded via JavaScript). Needs a different
  // approach like parsing Indeed's JSON API or embedded page data.
  // For now, rely on the backend's tracked listings from Kaggle seed data.

  // Re-inject with backend data
  const mergedBackend = backendData && backendData.found ? backendData : null;
  injectOverlay(localScore, mergedBackend, listing);

  isProcessing = false;
}

// Initial run
processCurrentListing();

// Poll for vjk changes
setInterval(() => {
  const vjk = getCurrentVjk();
  if (vjk !== lastVjk && !isProcessing) {
    processCurrentListing();
  }
}, 1500);

// Listen for clicks on job cards in the left pane
document.addEventListener('click', (e) => {
  const jobCard = e.target.closest('.jobsearch-LeftPane a, .job_seen_beacon, .jobTitle, [data-jk]');
  if (jobCard) {
    // Reset lastVjk so the next poll triggers a reprocess
    setTimeout(() => {
      lastVjk = null;
      processCurrentListing();
    }, 1500);
  }
}, true);

// Watch for right pane content changes
const rightPane = document.querySelector('.jobsearch-RightPane') || 
                  document.querySelector('#jobsearch-ViewjobPaneWrapper');
if (rightPane) {
  const observer = new MutationObserver(() => {
    const vjk = getCurrentVjk();
    if (vjk !== lastVjk && !isProcessing) {
      processCurrentListing();
    }
  });
  observer.observe(rightPane, { childList: true, subtree: true });
}
