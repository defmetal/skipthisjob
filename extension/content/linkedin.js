// ============================================================
// LinkedIn Content Script — Skip This Job
// ============================================================

const API_BASE = 'https://skipthisjob.com/api';
const STJ = globalThis.SkipThisJobShared || {};

let lastProcessedJobId = null;
let isProcessing = false;
let currentListingData = null;   // 0.1.8 - store current listing for reliable Apply tracking
let lastPublishedScore = null;

// ============================================================
// DOM PARSING
// ============================================================

/**
 * Live 0.2.2 soak: "5 months ago" in the detail header never reached
 * scoreListingSignals because we (1) started from the first sidebar
 * /jobs/view/ link, (2) trusted hiring-team <time datetime>, and
 * (3) let parseRelativeDays return 0 on any "hours ago" in a blob.
 * Read the DETAIL top card only; prefer visible "N months ago".
 */
function readLinkedInDaysOpen() {
  const parseAge = STJ.parseLinkedInPostedAge || STJ.parseRelativeDays;
  if (!parseAge) return { days: null, source: '' };

  const detailRoots = [
    document.querySelector('.jobs-search__job-details'),
    document.querySelector('.scaffold-layout__detail'),
    document.querySelector('.job-details-jobs-unified-top-card'),
    document.querySelector('.jobs-unified-top-card'),
    document.querySelector('.jobs-details'),
  ].filter(Boolean);

  const seedSelectors = [
    '.job-details-jobs-unified-top-card__tertiary-description-container',
    '.jobs-unified-top-card__tertiary-description-container',
    '[class*="tertiary-description"]',
    '.job-details-jobs-unified-top-card__primary-description-container',
    '.jobs-unified-top-card__subtitle-secondary-grouping',
    '.job-details-jobs-unified-top-card__primary-description-without-tagline',
    '.tvm__text',
  ];

  const skip = function (el) {
    if (!el || !el.closest) return true;
    return !!(
      el.closest('.scaffold-layout__list') ||
      el.closest('.jobs-search-results-list') ||
      el.closest('.hirer-card') ||
      el.closest('.jobs-poster') ||
      el.closest('[data-testid="hirer-card"]') ||
      el.closest('.comments-comment-entity')
    );
  };

  const tryText = function (text, source) {
    const days = parseAge(text);
    if (days != null) return { days: days, source: source + ': ' + String(text).replace(/\s+/g, ' ').trim() };
    return null;
  };

  for (let r = 0; r < detailRoots.length; r++) {
    const root = detailRoots[r];
    if (skip(root) && !root.classList.contains('job-details-jobs-unified-top-card') &&
        !root.classList.contains('jobs-unified-top-card') &&
        !root.classList.contains('jobs-search__job-details') &&
        !(root.classList && root.classList.contains('scaffold-layout__detail'))) {
      continue;
    }
    for (let s = 0; s < seedSelectors.length; s++) {
      const nodes = root.querySelectorAll(seedSelectors[s]);
      for (let i = 0; i < nodes.length; i++) {
        if (skip(nodes[i])) continue;
        const hit = tryText(nodes[i].innerText || nodes[i].textContent, seedSelectors[s]);
        if (hit) return hit;
      }
    }
    const topHit = tryText(root.innerText || root.textContent, 'detail-root');
    if (topHit) return topHit;
  }

  // Last resort: body text, but months still win over "hours ago".
  const bodyHit = tryText(document.body ? document.body.innerText : '', 'body');
  if (bodyHit) return bodyHit;
  return { days: null, source: '' };
}

function stampListBadgeForCurrentJob(listing, result) {
  if (!STJ.injectListBadge || !listing || !result) return;
  const jobId = listing.platformJobId;
  if (!jobId) return;
  const card =
    document.querySelector('[data-job-id="' + jobId + '"]') ||
    document.querySelector('[data-occludable-job-id="' + jobId + '"]') ||
    document.querySelector('li[data-occludable-job-id="' + jobId + '"] .job-card-container');
  if (!card) return;
  const anchor = card.querySelector(
    'a.job-card-list__title, a.job-card-container__link, a[href*="/jobs/view/"], .job-card-list__title--link'
  ) || card;
  STJ.injectListBadge(card, result, anchor);
}

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
    easyApply: false,
    engagementSignals: [],      // new for 0.1.8
    employerResponseTime: null, // new for 0.1.8
    userClickedApply: false,    // new for 0.1.8
    // Structured job attributes (0.1.8)
    workArrangement: null,     // 'remote', 'hybrid', 'onsite'
    employmentType: null,      // 'full_time', 'part_time', 'contract', 'internship'
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
  let container = null;
  const titleLink = document.querySelector('a[href*="/jobs/view/"]');
  if (titleLink) {
    // Walk up to find the detail panel container (usually 5-8 levels up)
    container = titleLink;
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

  const ageRead = readLinkedInDaysOpen();
  data.daysOpen = ageRead.days;
  if (data.daysOpen != null) {
    console.log('[SkipThisJob] Days open:', data.daysOpen, 'from:', (ageRead.source || '').substring(0, 80));
  } else {
    console.log('[SkipThisJob] Days open: null (no months/weeks/days-ago in top card)');
  }

  data.easyApply = /easy apply/.test(detailText);

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

  // === 0.1.8: Engagement signals and response time detection ===
  const engagementPatterns = [
    { pattern: /actively reviewing applications/i, key: 'actively_reviewing' },
    { pattern: /hiring multiple candidates/i, key: 'hiring_multiple' },
    { pattern: /urgently hiring/i, key: 'urgently_hiring' },
  ];

  for (const { pattern, key } of engagementPatterns) {
    if (pattern.test(detailText)) {
      if (!data.engagementSignals.includes(key)) {
        data.engagementSignals.push(key);
      }
    }
  }
  data.activelyReviewing = STJ.isActivelyReviewing
    ? STJ.isActivelyReviewing(data)
    : data.engagementSignals.includes('actively_reviewing');

  // Response time indicators
  const responseTimeMatch = detailText.match(/usually responds (?:within|in)\s+(.+?)(?:\.|$)/i);
  if (responseTimeMatch) {
    const raw = responseTimeMatch[1].toLowerCase().trim();
    if (raw.includes('day') || raw.includes('24')) {
      data.employerResponseTime = 'within_1_day';
    } else if (raw.includes('2') || raw.includes('few')) {
      data.employerResponseTime = 'within_2_days';
    } else if (raw.includes('week')) {
      data.employerResponseTime = 'within_a_week';
    } else {
      data.employerResponseTime = 'slow';
    }
  }

  // 0.1.8 - Robust description detection
  // LinkedIn collapses the description behind a "…see more" toggle. The full
  // text IS in the DOM, but innerText only returns the *rendered* (truncated)
  // portion — so a collapsed listing looked like it had no description and
  // was wrongly scored as a ghost-risk signal. textContent returns the entire
  // subtree regardless of the collapse, so read that and take whichever of
  // the two is longer across all candidate containers.
  function getFullDescription() {
    const readBest = (el) => {
      if (!el) return '';
      const tc = (el.textContent || '').replace(/[ \t]+/g, ' ').trim();
      const it = (el.innerText || '').trim();
      return tc.length >= it.length ? tc : it;
    };

    const candidates = [
      document.querySelector('[data-testid="expandable-text-box"]'),
      document.querySelector('[data-testid="expandable-text-box"]')?.parentElement,
      document.querySelector('.jobs-description-content__text'),
      document.querySelector('.jobs-description__content'),
      document.querySelector('.jobs-box__html-content'),
      document.querySelector('[data-testid="job-details"]'),
    ];

    let best = '';
    for (const el of candidates) {
      const t = readBest(el);
      if (t.length > best.length) best = t;
    }

    return best.length > 80 ? best : null;
  }

  data.description = getFullDescription();

  // 0.1.8 - Parse top-level job attribute tags (salary bubble, Remote, Full-time, etc.)
  // LinkedIn shows these in a row of tags near the top of the job card.
  const topAttributeArea = document.querySelector('._81f0ce2b, [data-testid*="job-attribute"]') || document.body;
  const attributeText = topAttributeArea.textContent.toLowerCase();

  // Salary from the top structured tags (the "bubble")
  if (!data.salaryListed) {
    const topSalaryMatch = attributeText.match(/\$[\d,]+(?:\s*[-–to]+\s*\$?[\d,]+)?(?:\s*(?:k|K|per year|\/year|\/hr|\/hour))?/i);
    if (topSalaryMatch) {
      data.salaryListed = true;
    }
  }

  // Work arrangement and employment type from top tags
  if (attributeText.includes('remote') && !attributeText.includes('hybrid')) {
    data.workArrangement = 'remote';
  } else if (attributeText.includes('hybrid')) {
    data.workArrangement = 'hybrid';
  } else if (attributeText.includes('on-site') || attributeText.includes('onsite')) {
    data.workArrangement = 'onsite';
  }

  if (attributeText.includes('full-time')) {
    data.employmentType = 'full_time';
  } else if (attributeText.includes('part-time')) {
    data.employmentType = 'part_time';
  } else if (attributeText.includes('contract')) {
    data.employmentType = 'contract';
  } else if (attributeText.includes('intern')) {
    data.employmentType = 'internship';
  }

  // 0.1.8 - Stronger salary detection inside the full description (fallback)
  if (!data.salaryListed && data.description) {
    const salaryPatterns = [
      // $130K - $160K/yr, $95-145k, $55 to $60/hour
      /\$[\d,]+(?:\s*[-–to]+\s*\$?[\d,]+)?(?:\s*(?:k|K|per year|\/year|\/hr|\/hour))?/i,
      // Pay Range: $X to $Y, Compensation Range: $220K - $250K
      /(?:salary|compensation|pay\s*range|base\s*pay)[:\s]*\$?[\d,]+(?:\s*[-–to]+\s*\$?[\d,]+)?/i,
      // $130K/yr - $160K/yr
      /\$[\d,]+k?\s*(?:-|–|to)\s*\$?[\d,]+k?/i
    ];

    for (const pattern of salaryPatterns) {
      if (pattern.test(data.description)) {
        data.salaryListed = true;
        break;
      }
    }
  }

  // 0.1.8 - Improved hiring contact detection
  const hiringEl =
    document.querySelector('.jobs-poster__name') ||
    document.querySelector('.hirer-card__hirer-information') ||
    document.querySelector('[data-testid="hirer-card"]') ||
    document.querySelector('[data-testid*="hiring-team"]') ||
    document.querySelector('a[href*="/in/"]'); // LinkedIn profile links

  const hasHiringTeamText = detailText.includes('meet the hiring team') ||
                            detailText.includes('people you can reach out to');

  data.hiringContactVisible = !!hiringEl || hasHiringTeamText;

  // Also check the top attribute tags for hiring team mentions
  if (!data.hiringContactVisible) {
    const hiringTeamTags = document.querySelectorAll('._834b0593 a span');
    for (const tag of hiringTeamTags) {
      if (tag.textContent.toLowerCase().includes('hiring')) {
        data.hiringContactVisible = true;
        break;
      }
    }
  }

  console.log('[GhostDetector] Hiring contact visible:', data.hiringContactVisible);

  // Seniority from detail panel text
  if (detailText.includes('entry level') || detailText.includes('internship')) data.seniorityLevel = 'entry';
  else if (detailText.includes('mid-senior')) data.seniorityLevel = 'senior';
  else if (detailText.includes('director')) data.seniorityLevel = 'director';
  else if (detailText.includes('executive')) data.seniorityLevel = 'c_suite';

  // Job ID from URL
  data.platformJobId = STJ.extractLinkedInJobId
    ? STJ.extractLinkedInJobId(window.location.href)
    : ((window.location.href.match(/currentJobId=(\d+)/) || window.location.href.match(/\/jobs\/view\/(\d+)/)) || [])[1] || null;
  data.descriptionHash = STJ.hashDescription ? STJ.hashDescription(data.description) : null;

  console.log('[GhostDetector] Full parsed data:', JSON.stringify(data, null, 2));

  return data;
}


// ============================================================
// SCORING (local heuristic)
// ============================================================

// Philosophy: "How likely is applying to this job a waste of my time?"
// A listing doesn't have to be fake to be a waste of time. A real job
// open 30 days with 200+ applicants has almost zero chance of resulting
// in an interview. We score for futility, not just fraud.

// --- Real description vagueness + seniority analysis (from scoring/ghostScore.js) ---
// These give much more granular signals than the old binary "vague description" checks.

const VAGUE_PATTERNS = [
  /fast[- ]paced environment/i,
  /wear many hats/i,
  /self[- ]starter/i,
  /team player/i,
  /excellent communication skills/i,
  /detail[- ]oriented/i,
  /results[- ]driven/i,
  /dynamic (environment|team|company)/i,
  /exciting opportunity/i,
  /competitive (salary|compensation|pay)/i,
  /great (benefits|culture|team)/i,
  /must be able to (multitask|work independently)/i,
  /rockstar|ninja|guru|wizard/i,
  /other duties as assigned/i,
  /fast[- ]growing (company|startup)/i,
];

const SPECIFIC_PATTERNS = [
  /\b(python|java|javascript|react|angular|vue|node|sql|aws|gcp|azure)\b/i,
  /\b(salesforce|hubspot|marketo|tableau|jira|confluence)\b/i,
  /\breport(s|ing)?\s+to\b/i,
  /\b(team of|department of)\s+\d+/i,
  /\$[\d,]+/i,
  /\b\d+\+?\s*years?\b/i,
];

const KITCHEN_SINK_TECH = /\b(python|java|javascript|react|angular|vue|node|sql|aws|gcp|azure|docker|kubernetes|terraform|go|rust|c\+\+|ruby|php|swift|kotlin|scala|hadoop|spark|kafka|redis|mongodb|postgresql|mysql|elasticsearch|graphql|rest\s*api|ci\/cd|jenkins|github\s*actions)\b/gi;

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

function analyzeDescriptionVagueness(text) {
  if (!text) return 0;
  let vagueIndicators = 0;
  let totalChecks = 0;

  totalChecks += VAGUE_PATTERNS.length;
  VAGUE_PATTERNS.forEach(p => { if (p.test(text)) vagueIndicators++; });

  totalChecks += SPECIFIC_PATTERNS.length;
  SPECIFIC_PATTERNS.forEach(p => { if (p.test(text)) vagueIndicators--; });

  if (text.length < 500) { vagueIndicators += 2; totalChecks += 2; }

  const techMatches = text.match(KITCHEN_SINK_TECH);
  if (techMatches && new Set(techMatches.map(t => t.toLowerCase())).size > 15) {
    vagueIndicators += 3; totalChecks += 3;
  }
  return Math.max(0, Math.min(1, vagueIndicators / Math.max(totalChecks, 1)));
}

function detectSeniorityMismatch(title, description, seniorityLevel) {
  if (!title || !description) return false;
  const entrySignals = /\b(entry[- ]level|junior|associate|intern|graduate)\b/i;
  const seniorRequirements = /\b(10|[1-9]\d)\+?\s*years?\b/i;
  if (entrySignals.test(title) && seniorRequirements.test(description)) return true;

  const juniorRequirements = /\b[0-2]\+?\s*years?\b/i;
  const seniorTitleSignals = /\b(senior|lead|principal|director|vp|vice\s*president|head\s+of)\b/i;
  if (seniorTitleSignals.test(title) && juniorRequirements.test(description)) return true;
  return false;
}

// --- End imported analysis helpers ---
//
// Score ranges (heuristic only, before backend blend):
//   0–24  Worth Applying        — fresh listing, few red flags
//   25–49 Proceed with Caution  — some warning signs, manage expectations
//   50–74 Likely a Waste of Time — stale, oversaturated, or opaque
//   75–100 Skip This Job        — overwhelming evidence this won't lead anywhere
//
// 0.2.2: age / engagement / description / floors live in shared.js
// (scoreListingSignals) so Indeed and list badges stay aligned.
// LinkedIn-only extras (hiring contact, no-response chip, combos) stay here.
function scoreLocally(listing) {
  const isHighTurnover = !!(listing.title && HIGH_TURNOVER_PATTERNS.some(p => p.test(listing.title)));
  const vagueness = listing.description ? analyzeDescriptionVagueness(listing.description) : null;
  const seniorityMismatch = detectSeniorityMismatch(
    listing.title, listing.description || '', listing.seniorityLevel
  );

  if (STJ.scoreListingSignals) {
    return STJ.scoreListingSignals(listing, {
      platform: 'linkedin',
      isHighTurnover: isHighTurnover,
      vagueness: vagueness,
      afterShared: function (score, signals) {
        if (!listing.hiringContactVisible) {
          score += 10;
          signals.push('No hiring contact — no one to follow up with');
        }
        if (listing.noResponseData) {
          score += 8;
          signals.push('No employer response data on LinkedIn');
        }
        const isOld = listing.daysOpen >= 14;
        const missingBasics = !listing.hiringContactVisible &&
                              (!listing.description || listing.description.length < 300) &&
                              !listing.salaryListed;
        if (isOld && missingBasics) {
          score += 20;
          signals.push('Stale posting with multiple missing basics — low effort or ghost risk');
        }
        if (listing.isRepost && listing.applicantCount >= 100) {
          score += 16;
          signals.push('High Volume Repost (Easy Apply + high applicants)');
        }
        if (listing.daysOpen >= 30 && listing.applicantCount >= 200) {
          score += 16;
          signals.push('30+ days old with 200+ applicants — very low chance of being seen');
        }
        if (seniorityMismatch) {
          score += 14;
          signals.push('⚠️ Seniority mismatch — title and requirements conflict');
        }
        if (isHighTurnover) {
          signals.push('⚡ High turnover role — expect frequent reposting');
        }
        return { score: score, signals: signals };
      },
    });
  }

  return { score: 0, label: 'low', signals: [], isHighTurnover: isHighTurnover, daysOpen: listing.daysOpen };
}


// ============================================================
// BACKEND API (via background service worker to avoid CORS)
// ============================================================

// --- Extension lifecycle guard -------------------------------------------
// When the extension is reloaded or auto-updates, content scripts already
// running on open tabs are orphaned: the DOM stays, but every chrome.* call
// throws "Extension context invalidated". Detect that, disconnect our
// timers/observer, and go silent so the dead script stops working and stops
// spamming errors. The page must be reloaded to attach a fresh script.
let _ghostTornDown = false;
const _ghostTimers = [];
let _ghostObserver = null;

function extensionAlive() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function teardownGhostDetector() {
  if (_ghostTornDown) return;
  _ghostTornDown = true;
  try { if (_ghostObserver) _ghostObserver.disconnect(); } catch (e) {}
  while (_ghostTimers.length) clearInterval(_ghostTimers.pop());
  console.log('[SkipThisJob] Extension context gone — content script stood down. Reload the page to re-enable.');
}

function safeSendMessage(message, callback) {
  if (!extensionAlive()) { teardownGhostDetector(); return; }
  try {
    chrome.runtime.sendMessage(message, (response) => {
      // Touch lastError so Chrome doesn't log "Unchecked runtime.lastError".
      const err = chrome.runtime && chrome.runtime.lastError;
      if (err) {
        if (!extensionAlive()) teardownGhostDetector();
        return;
      }
      if (callback) callback(response);
    });
  } catch (e) {
    teardownGhostDetector();
  }
}

async function fetchEmployerScore(companyName, extras) {
  return new Promise(resolve => {
    if (!extensionAlive()) { teardownGhostDetector(); resolve(null); return; }
    const extra = extras || {};
    safeSendMessage(
      {
        type: 'FETCH_EMPLOYER_SCORE',
        name: companyName,
        platform: extra.platform || 'linkedin',
        jobId: extra.jobId || extra.platformJobId || null,
        fresh: extra.fresh || false,
      },
      response => resolve(response?.data || null)
    );
    // If the context dies mid-flight the callback never fires; make sure the
    // promise still settles so `await fetchEmployerScore` can't hang.
    setTimeout(() => resolve(null), 8000);
  });
}

async function submitReport(reportData) {
  if (!extensionAlive()) { teardownGhostDetector(); return false; }
  let userHash;
  try {
    ({ userHash } = await chrome.storage.local.get('userHash'));
    if (!userHash) {
      userHash = crypto.randomUUID();
      await chrome.storage.local.set({ userHash });
    }
  } catch (e) {
    teardownGhostDetector();
    return false;
  }

  return new Promise(resolve => {
    safeSendMessage(
      {
        type: 'SUBMIT_REPORT',
        reportData: { ...reportData, anonymousUserHash: userHash, platform: 'linkedin' },
      },
      response => resolve(response && response.success ? response : false)
    );
    setTimeout(() => resolve(false), 8000);
  });
}


// ============================================================
// UI INJECTION
// ============================================================

// Confidence-weighted, asymmetric blend of the listing heuristic and the
// employer backend score. Mirror of the same helper in indeed.js — scoring
// is platform-agnostic, so both content scripts must blend identically.
//
// Why: a thin backend record (employer merely present in the Kaggle seed
// with a few listings and zero reports) returns a near-zero score that
// means "no evidence", NOT "safe employer". The old flat 40/60 blend
// weighted that emptiness at 60% and dragged strong listing-level ghost
// signals down into a falsely reassuring band.
//
// Rules:
//  - Backend weight scales with how much real evidence it has.
//  - A low-confidence backend may RAISE the score (a sketchy employer is
//    worth heeding) but must not SUPPRESS a listing that already looks
//    like a ghost job. Lowering requires confidence; raising is easier.
function blendGhostScore(localScore, backendData) {
  const local = localScore.score;

  if (!backendData || backendData.score == null) {
    return {
      score: local,
      label: localScore.label,
      signals: localScore.signals,
      daysOpen: localScore.daysOpen,
    };
  }

  const backend = backendData.score;
  const reports = backendData.totalReports || 0;
  const listings = backendData.totalListings || 0;

  let wDown;
  if (backendData.live) wDown = 0.60;        // fresh community reports / repost patterns
  else if (reports >= 10) wDown = 0.40;
  else if (reports >= 3) wDown = 0.25;
  else if (listings >= 8) wDown = 0.15;
  else wDown = 0.0;                          // thin seed record → ~100% heuristic

  const wUp = Math.max(wDown, 0.30);

  const w = backend >= local ? wUp : wDown;
  let score = Math.round(local * (1 - w) + backend * w);
  const signals = [...new Set([...localScore.signals, ...(backendData.signals || [])])];
  if (STJ.enforceAgeFloor) {
    const floored = STJ.enforceAgeFloor(score, localScore.daysOpen, signals);
    score = floored.score;
  }
  if (STJ.applyLowIntentTax) {
    const taxed = STJ.applyLowIntentTax(score, localScore, signals);
    score = taxed.score;
  }
  score = Math.min(100, Math.max(0, Math.round(score)));
  const label = STJ.labelForScore ? STJ.labelForScore(score)
    : (score >= 75 ? 'very_high' : score >= 55 ? 'high' : score >= 35 ? 'moderate' : 'low');
  return {
    score: score,
    label: label,
    signals: signals,
    daysOpen: localScore.daysOpen,
    easyApply: localScore.easyApply,
    applicantCount: localScore.applicantCount,
  };
}

function injectOverlay(localScore, backendData, listing) {
  const existing = document.getElementById('ghost-detector-overlay');
  if (existing) existing.remove();

  const _blend = blendGhostScore(localScore, backendData);
  const finalScore = _blend.score;
  const finalLabel = _blend.label;
  const finalSignals = _blend.signals;

  const colors = {
    low: { bg: '#e8f5e9', border: '#4caf50', text: '#2e7d32', icon: '✅' },
    moderate: { bg: '#fff3e0', border: '#ff9800', text: '#e65100', icon: '⚠️' },
    high: { bg: '#fce4ec', border: '#f44336', text: '#c62828', icon: '🚩' },
    very_high: { bg: '#f3e5f5', border: '#9c27b0', text: '#6a1b9a', icon: '👻' },
  };
  const color = colors[finalLabel] || colors.moderate;
  const labelText = { low: 'Worth Applying', moderate: 'Proceed with Caution', high: 'Likely a Waste of Time', very_high: 'Skip This Job' };

  const overlay = document.createElement('div');
  overlay.id = 'ghost-detector-overlay';
  overlay.innerHTML = `
    <div class="ghost-detector-card" style="border-left: 4px solid ${color.border}; background: ${color.bg};">
      <div class="ghost-detector-header" style="display:flex; align-items:center; gap:6px; flex-wrap: wrap;">
        <span class="ghost-detector-icon">${color.icon}</span>
        <span class="ghost-detector-title">Ghost Risk: <strong style="color: ${color.text}">${labelText[finalLabel]}</strong></span>
        <span class="ghost-detector-score" style="color: ${color.text}">${finalScore}/100</span>
        ${backendData && backendData.live ? 
          `<span class="ghost-detector-live" style="background:#dcfce7;color:#166534;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:5px;font-weight:600;letter-spacing:0.3px;">● LIVE</span>` : ''}
        <span id="ghost-close-btn" style="margin-left:auto; cursor:pointer; font-size:16px; line-height:1; opacity:0.65; padding:2px 6px;">✕</span>
      </div>

      ${localScore.isHighTurnover ? 
        `<div style="font-size:9px; background:#fef3c7; color:#92400e; padding:1px 5px; border-radius:3px; margin-top:3px; display:inline-block; border:1px solid #fde68a;">High Turnover Role – Scoring Adjusted</div>` : ''}

      ${finalSignals.some(s => s.includes('High Volume Repost')) ? 
        `<div style="font-size:9px; background:#fee2e2; color:#991b1b; padding:1px 5px; border-radius:3px; margin-top:3px; display:inline-block; border:1px solid #fecaca;">High Volume Repost</div>` : ''}
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
      ${STJ.communityBlockHtml ? STJ.communityBlockHtml(backendData) : (backendData && backendData.totalReports > 0 ? `
        <div class="ghost-detector-community" style="background: #fff3e0; padding: 6px 10px; border-radius: 6px; border-left: 3px solid #ff9800;">
          📊 ${backendData.live
            ? `${backendData.totalReports} recent community reports`
            : `${backendData.totalReports} other users have flagged this employer`}
        </div>
      ` : '')}
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
      <div id="ghost-thanks" class="ghost-detector-community" style="display: none; color: #2e7d32; background: #e8f5e9; padding: 8px 10px; border-radius: 6px; margin-top: 8px; font-size: 12px;"></div>
      <div class="ghost-detector-footer">
        <span>${STJ.brandFooterHtml ? STJ.brandFooterHtml() : 'Skip This Job by <a href="https://vibelabsmarketing.com" target="_blank" rel="noopener">Vibe Labs Marketing</a> · <a href="https://skipthisjob.com" target="_blank" rel="noopener">skipthisjob.com</a>'}</span>
      </div>
    </div>
  `;

  // Always use fixed positioning on LinkedIn.
  // Their DOM is too unstable — they frequently destroy/re-render containers,
  // which removes overlays that were inserted via insertBefore.
  overlay.style.position = 'fixed';
  overlay.style.top = '80px';
  overlay.style.right = '20px';
  overlay.style.zIndex = '99999';
  overlay.style.maxWidth = '360px';
  overlay.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
  overlay.style.borderRadius = '10px';
  document.body.appendChild(overlay);
  if (typeof syncOverlayWithLinkedInDialogs === 'function') {
    syncOverlayWithLinkedInDialogs();
  }

  // Close button handler
  document.getElementById('ghost-close-btn')?.addEventListener('click', () => {
    overlay.remove();
    // Prevent the overlay from immediately re-appearing on the same job
    lastProcessedJobId = getCurrentJobId();
  });

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
      btn.textContent = '⏳ Submitting...';
      btn.disabled = true;
      const success = await submitReport({
        reportType: 'ghost_flag',
        companyName: listing.companyName,
        jobTitle: listing.title,
        platformJobId: listing.platformJobId,
        listingUrl: listing.listingUrl,
        flagReasons: [e.target.dataset.flag],
      });
      if (success) {
        btn.textContent = '✓ Reported';
        btn.style.background = '#e8f5e9';
        btn.style.borderColor = '#4caf50';
        btn.style.color = '#2e7d32';
        const thanks = document.getElementById('ghost-thanks');
        if (thanks) {
          thanks.textContent = '🙏 Thanks for helping the community! Your anonymous report helps other job seekers.';
          thanks.style.display = 'block';
        }
        if (STJ.applyReportFeedbackToOverlay) STJ.applyReportFeedbackToOverlay(success);
      } else {
        btn.textContent = '✗ Failed — try again';
        btn.disabled = false;
        btn.style.color = '#c62828';
      }
    });
  });

  overlay.querySelectorAll('[data-outcome]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      btn.textContent = '⏳ Submitting...';
      btn.disabled = true;
      const success = await submitReport({
        reportType: 'outcome',
        companyName: listing.companyName,
        jobTitle: listing.title,
        platformJobId: listing.platformJobId,
        listingUrl: listing.listingUrl,
        outcome: e.target.dataset.outcome,
      });
      if (success) {
        btn.textContent = '✓ Submitted';
        btn.style.background = '#e8f5e9';
        btn.style.borderColor = '#4caf50';
        btn.style.color = '#2e7d32';
        const thanks = document.getElementById('ghost-thanks');
        if (thanks) {
          thanks.textContent = '🙏 Thanks! Your experience helps other job seekers avoid dead ends.';
          thanks.style.display = 'block';
        }
        if (STJ.applyReportFeedbackToOverlay) STJ.applyReportFeedbackToOverlay(success);
      } else {
        btn.textContent = '✗ Failed — try again';
        btn.disabled = false;
        btn.style.color = '#c62828';
      }
    });
  });
}


// ============================================================
// MAIN — robust initialization + MutationObserver
// ============================================================

function getCurrentJobId() {
  if (STJ.extractLinkedInJobId) return STJ.extractLinkedInJobId(window.location.href);
  const match = window.location.href.match(/currentJobId=(\d+)/) ||
                window.location.href.match(/\/jobs\/view\/(\d+)/);
  return match ? match[1] : null;
}

function isOnJobPage() {
  const url = window.location.href;
  return url.includes('linkedin.com/jobs/') || url.includes('/jobs/view/');
}

/**
 * Wait for LinkedIn's job detail content to actually render.
 * Uses a fast polling loop instead of a fixed timeout so it works
 * on both fast and slow connections / first navigation.
 */
async function waitForLinkedInJobContent(maxWaitMs = 6500) {
  const start = Date.now();
  const descSelectors = [
    '[data-testid="expandable-text-box"]',
    '.jobs-description-content__text',
    '.jobs-description__content',
    '.jobs-box__html-content'
  ];
  const pageReadySelectors = [
    'a[href*="/jobs/view/"]',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name'
  ];

  // Prefer to wait for the actual description container — parsing before it
  // renders is what made collapsed-but-present descriptions look missing.
  // Only fall back to "page loaded, no description" late in the budget so
  // genuine no-description listings still get scored.
  const descDeadline = start + Math.round(maxWaitMs * 0.8);
  while (Date.now() - start < maxWaitMs) {
    const hasDesc = descSelectors.some(s => document.querySelector(s));
    const hasAge = readLinkedInDaysOpen().days != null;
    // Prefer both description AND a parsed top-card age (Baton/First Point
    // soak scored 6 because we ran before "5 months ago" was in the DOM).
    if (hasDesc && hasAge) return true;
    if (hasDesc && Date.now() - start > 1200 && hasAge) return true;
    if (Date.now() > descDeadline && pageReadySelectors.some(s => document.querySelector(s))) return true;
    await new Promise(r => setTimeout(r, 180));
  }
  return false;
}

/**
 * Attach a MutationObserver to the job detail pane.
 * This catches cases where LinkedIn swaps the content without a URL change.
 */
function linkedInDialogOpen() {
  return !!(
    document.querySelector('.jobs-easy-apply-modal') ||
    document.querySelector('.jobs-easy-apply-content') ||
    document.querySelector('.artdeco-modal-overlay') ||
    document.querySelector('[data-test-modal-id*="easy-apply" i]')
  );
}

function syncOverlayWithLinkedInDialogs() {
  const overlay = document.getElementById('ghost-detector-overlay');
  if (!overlay) return;
  const open = linkedInDialogOpen();
  overlay.style.visibility = open ? 'hidden' : '';
  overlay.style.pointerEvents = open ? 'none' : '';
}

function setupJobDetailObserver() {
  const container =
    document.querySelector('.jobs-search__job-details') ||
    document.querySelector('.scaffold-layout__detail') ||
    document.querySelector('#main') ||
    document.body;

  if (!container || container._ghostObserverAttached) return;

  _ghostObserver = new MutationObserver(() => {
    if (!extensionAlive()) { teardownGhostDetector(); return; }
    // Hide our z-index:99999 overlay while LinkedIn has a modal up so we
    // cannot cover Easy Apply. Does not cancel clicks or mutate modal DOM.
    syncOverlayWithLinkedInDialogs();
    const jobId = getCurrentJobId();
    if (jobId && jobId !== lastProcessedJobId && !isProcessing) {
      // Debounce rapid mutations
      setTimeout(() => {
        if (jobId === getCurrentJobId() && !isProcessing) {
          processCurrentListing();
        }
      }, 650);
    }
  });

  _ghostObserver.observe(container, { childList: true, subtree: true });
  container._ghostObserverAttached = true;
  console.log('[SkipThisJob] MutationObserver attached to job detail container');
}

async function processCurrentListing() {
  if (!extensionAlive()) { teardownGhostDetector(); return; }
  const jobId = getCurrentJobId();
  if (!jobId || jobId === lastProcessedJobId || isProcessing) return;

  isProcessing = true;
  lastProcessedJobId = jobId;

  // Adaptive wait — much more reliable than fixed 2s on cold loads
  const contentReady = await waitForLinkedInJobContent();
  if (!contentReady) {
    console.log('[SkipThisJob] Timed out waiting for job content — will retry on next poll');
    isProcessing = false;
    lastProcessedJobId = null; // allow retry
    return;
  }

  let listing = parseLinkedInListing();
  if (!listing.title || !listing.companyName) {
    console.log('[SkipThisJob] Could not parse listing — selectors may need updating');
    isProcessing = false;
    return;
  }

  // Top-card age often paints after the description. Retry so Baton-like
  // "5 months ago" cannot score as a 6 with daysOpen still null.
  if (listing.daysOpen == null) {
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 350));
      const again = parseLinkedInListing();
      if (again.title) listing = again;
      if (listing.daysOpen != null) break;
    }
  }

  console.log('[SkipThisJob] Scored:', listing.title, '@', listing.companyName, 'daysOpen=', listing.daysOpen);

  // Compute the pre-blend heuristic up front so it can be persisted server
  // side (powers the employer leaderboard). Pre-blend on purpose: the
  // blended score depends on the backend score → feedback loop if stored.
  const localScore = scoreLocally(listing);
  stampListBadgeForCurrentJob(listing, localScore);

  // Store current listing data for reliable Apply tracking (0.1.8)
  currentListingData = {
    ...listing,
    platform: 'linkedin',
    userClickedApply: false,
    listingHeuristic: localScore.score,
    descriptionHash: listing.descriptionHash,
  };

  const trackPayload = STJ.buildTrackPayload
    ? STJ.buildTrackPayload(currentListingData, { platform: 'linkedin', listingHeuristic: localScore.score })
    : {
      companyName: listing.companyName,
      jobTitle: listing.title,
      platform: 'linkedin',
      platformJobId: listing.platformJobId,
      location: listing.location,
      salaryListed: listing.salaryListed,
      isRepost: listing.isRepost,
      daysOpen: listing.daysOpen,
      engagementSignals: listing.engagementSignals,
      employerResponseTime: listing.employerResponseTime,
      userClickedApply: listing.userClickedApply,
      workArrangement: listing.workArrangement,
      employmentType: listing.employmentType,
      listingHeuristic: localScore.score,
      descriptionHash: listing.descriptionHash,
    };

  safeSendMessage({
    type: 'TRACK_LISTING',
    listingData: trackPayload,
  });

  const initialBlend = typeof blendGhostScore === 'function' ? blendGhostScore(localScore, null) : localScore;
  lastPublishedScore = STJ.publishActiveListing
    ? STJ.publishActiveListing(currentListingData, initialBlend, 'linkedin')
    : null;
  injectOverlay(localScore, null, listing);
  stampListBadgeForCurrentJob(listing, initialBlend);

  const backendData = await fetchEmployerScore(listing.companyName, {
    platform: 'linkedin',
    jobId: listing.platformJobId,
  });
  if (backendData && backendData.found) {
    const blended = blendGhostScore(localScore, backendData);
    lastPublishedScore = STJ.publishActiveListing
      ? STJ.publishActiveListing(currentListingData, blended, 'linkedin')
      : lastPublishedScore;
    injectOverlay(localScore, backendData, listing);
    stampListBadgeForCurrentJob(listing, blended);
  }

  isProcessing = false;
}

// Poll every 1 second for URL changes (LinkedIn is a SPA)
_ghostTimers.push(setInterval(() => {
  if (!extensionAlive()) { teardownGhostDetector(); return; }
  const jobId = getCurrentJobId();
  if (jobId && jobId !== lastProcessedJobId && !isProcessing) {
    processCurrentListing();
  }
}, 1000));

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

if (STJ.installPopupBridge) {
  STJ.installPopupBridge(() => lastPublishedScore);
}

function startLinkedInListBadges() {
  if (!STJ.watchListBadges) return;
  STJ.watchListBadges({
    listRootSelector: '.scaffold-layout__list, .jobs-search-results-list, .jobs-search-results__list',
    findCards() {
      return document.querySelectorAll(
        'li.jobs-search-results__list-item, li.scaffold-layout__list-item, .job-card-container, [data-job-id]'
      );
    },
    parseCard(card) {
      const titleEl = card.querySelector(
        'a.job-card-list__title, a.job-card-container__link, a[href*="/jobs/view/"], .job-card-list__title--link, strong'
      );
      const title = (titleEl && titleEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (!title || title.length < 3) return null;
      const companyEl = card.querySelector(
        '.job-card-container__primary-description, .artdeco-entity-lockup__subtitle, .job-card-container__company-name'
      );
      const dateEl = card.querySelector(
        'time, .job-card-container__listed-time, .job-card-list__footer-wrapper, .tvm__text'
      );
      const text = (card.innerText || card.textContent || '').toLowerCase();
      const parseAge = STJ.parseLinkedInPostedAge || STJ.parseRelativeDays;
      return {
        title,
        companyName: companyEl ? companyEl.textContent.trim() : null,
        daysOpen: parseAge && parseAge(text) != null
          ? parseAge(text)
          : (STJ.daysOpenFromCard
            ? STJ.daysOpenFromCard(card, dateEl, text)
            : null),
        isRepost: /reposted/.test(text),
        salaryListed: /\$\d/.test(text) ? true : undefined,
        applicantCount: STJ.parseApplicantCount ? STJ.parseApplicantCount(text) : null,
        easyApply: /easy apply/.test(text),
        engagementSignals: /actively reviewing/.test(text) ? ['actively_reviewing'] : [],
        platform: 'linkedin',
      };
    },
    anchor(card) {
      return card.querySelector(
        'a.job-card-list__title, a.job-card-container__link, a[href*="/jobs/view/"], .job-card-list__title--link'
      ) || card;
    },
  });
}

// Initial run — only if we're on a job page
if (isOnJobPage()) {
  processCurrentListing();
  setupJobDetailObserver();
}
startLinkedInListBadges();

// Handle navigation within LinkedIn (SPA)
let lastObserverUrl = location.href;
_ghostTimers.push(setInterval(() => {
  if (!extensionAlive()) { teardownGhostDetector(); return; }
  if (location.href !== lastObserverUrl) {
    lastObserverUrl = location.href;

    const overlay = document.getElementById('ghost-detector-overlay');

    if (!isOnJobPage()) {
      // User left the jobs section → hide the overlay
      if (overlay) {
        overlay.remove();
      }
      // Reset so the overlay can appear again when they return to a job
      lastProcessedJobId = null;
    } else {
      // Still on jobs section → make sure observer is active
      setTimeout(setupJobDetailObserver, 1200);
    }
  }
}, 800));

// 0.1.8 - Track Apply clicks on LinkedIn (passive, reliable)
// Capture-phase observer only — never preventDefault / stopPropagation.
// LinkedIn Easy Apply must receive the original click.
document.addEventListener('click', (e) => {
  const target = e.target.closest('button, a');
  if (!target) return;

  const text = (target.textContent || target.innerText || '').toLowerCase();
  const ariaLabel = (target.getAttribute('aria-label') || '').toLowerCase();

  if (
    text.includes('apply') ||
    ariaLabel.includes('apply') ||
    target.classList.contains('jobs-apply-button') ||
    target.getAttribute('data-control-name') === 'apply'
  ) {
    // If we have a current listing and the user is still on the same job, update it
    const currentJobId = getCurrentJobId();
    if (currentListingData && (!currentJobId || currentListingData.platformJobId === currentJobId)) {
      currentListingData.userClickedApply = true;
      const listingData = STJ.buildTrackPayload
        ? STJ.buildTrackPayload(currentListingData, { platform: 'linkedin', userClickedApply: true })
        : { ...currentListingData, jobTitle: currentListingData.title, userClickedApply: true };
      safeSendMessage({ type: 'TRACK_LISTING', listingData });
    } else {
      safeSendMessage({
        type: 'USER_CLICKED_APPLY',
        platform: 'linkedin',
        url: window.location.href,
        companyName: currentListingData && currentListingData.companyName,
        jobTitle: currentListingData && (currentListingData.title || currentListingData.jobTitle),
        platformJobId: currentJobId || (currentListingData && currentListingData.platformJobId),
      });
    }
  }
}, true);
