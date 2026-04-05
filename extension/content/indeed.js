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
  if (pageText.includes('hiring multiple candidates') || pageText.includes('urgently hiring')) {
    // These can be either legitimate urgency or evergreen churn signals
    // Not penalizing but noting
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

  // Posting age
  if (listing.daysOpen != null) {
    if (listing.daysOpen >= 60) {
      score += 15;
      signals.push(`Open ${listing.daysOpen}+ days`);
    } else if (listing.daysOpen >= 30) {
      score += 9;
      signals.push(`Open ${listing.daysOpen} days`);
    }
  }

  // Repost
  if (listing.isRepost) {
    score += 20;
    signals.push('Marked as reposted');
  }

  // Applicants (Indeed doesn't always show this)
  if (listing.applicantCount != null) {
    if (listing.applicantCount >= 500) {
      score += 12;
      signals.push(`${listing.applicantCount}+ applicants`);
    } else if (listing.applicantCount >= 200) {
      score += 6;
      signals.push(`${listing.applicantCount}+ applicants`);
    }
  }

  // No salary
  if (!listing.salaryListed) {
    score += 5;
    signals.push('No salary listed');
  }

  // No hiring contact (Indeed rarely shows this)
  if (!listing.hiringContactVisible) {
    // Don't penalize on Indeed since they rarely show contacts
    // score += 5;
  }

  // Third-party
  if (listing.isThirdParty) {
    score += 15;
    signals.push('Posted by staffing agency or job board');
  }

  score = Math.min(100, Math.max(0, score));

  let label = 'low';
  if (score >= 75) label = 'very_high';
  else if (score >= 50) label = 'high';
  else if (score >= 25) label = 'moderate';

  return { score, label, signals };
}


// ============================================================
// BACKEND API
// ============================================================

async function fetchEmployerScore(companyName) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_BASE}/employer/score?` + new URLSearchParams({ name: companyName }), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
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
    return false;
  }
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

  // Find insertion point — Indeed job detail areas
  const targetContainer =
    document.querySelector('.jobsearch-JobInfoHeader-title-container') ||
    document.querySelector('.jobsearch-ViewJobLayout--embedded') ||
    document.querySelector('#viewJobSSRRoot') ||
    document.querySelector('#jobDescriptionText')?.parentElement ||
    document.querySelector('.jobsearch-JobComponent');

  if (targetContainer) {
    targetContainer.insertBefore(overlay, targetContainer.firstChild);
  } else {
    // Fallback: insert at top of body
    overlay.style.margin = '12px auto';
    overlay.style.maxWidth = '800px';
    document.body.insertBefore(overlay, document.body.firstChild);
  }

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

  const backendData = await fetchEmployerScore(listing.companyName);
  if (backendData && backendData.found) {
    injectOverlay(localScore, backendData, listing);
  }

  isProcessing = false;
}

// Initial run
processCurrentListing();

// Poll for vjk changes (Indeed sometimes uses inline job switching)
setInterval(() => {
  const vjk = getCurrentVjk();
  if (vjk !== lastVjk && !isProcessing) {
    processCurrentListing();
  }
}, 1500);
