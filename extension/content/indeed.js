// ============================================================
// Indeed Content Script — Skip This Job
// ============================================================

const API_BASE = 'https://skipthisjob.com/api';
const STJ = globalThis.SkipThisJobShared || {};

// ============================================================
// DOM PARSING
// ============================================================

// 0.1.8 - Read the mosaic snapshot mirrored by indeed-mosaic-bridge.js.
// The bridge runs in the page's MAIN world and writes window.mosaic data
// into #__stj_mosaic, because this content script's isolated world cannot
// see the page's window.mosaic directly.
let _stjBridgeWarned = false;
let _stjMosaicCacheKey = '';
let _stjMosaicCacheVal = null;
function readBridgedMosaic() {
  try {
    const node = document.getElementById('__stj_mosaic');
    if (!node || !node.textContent) {
      if (!_stjBridgeWarned) {
        _stjBridgeWarned = true;
        console.log('[SkipThisJob] Mosaic bridge not ready yet (no #__stj_mosaic)');
      }
      return null;
    }
    const txt = node.textContent;
    // Parse once per distinct snapshot. getIndeedJobFromMosaic() runs inside
    // a high-frequency MutationObserver; re-parsing multi-KB JSON per DOM
    // mutation would jank the page.
    if (txt === _stjMosaicCacheKey) return _stjMosaicCacheVal;
    const parsed = JSON.parse(txt);
    _stjMosaicCacheKey = txt;
    _stjMosaicCacheVal = parsed;
    return parsed;
  } catch (e) {
    return null;
  }
}

// 0.1.8 - Hardened aggressive extraction from Indeed's mosaic providers.
// Prioritizes the jobcards list (where pubDate / formattedRelativeTime usually lives)
// and uses strong multi-signal matching for right-pane detail views (vjk= URLs).
function getIndeedJobFromMosaic() {
  try {
    const snapshot = readBridgedMosaic();
    if (!snapshot) return null;

    const currentUrl = window.location.href.toLowerCase();

    // Extract job key from URL (supports both jk= and vjk=)
    let jobKey = STJ.extractIndeedJobKey
      ? STJ.extractIndeedJobKey(currentUrl)
      : ((currentUrl.match(/[?&#](?:vjk|jk)=([a-f0-9]+)/i) || [])[1] || null);

    // Try to get current title and company for fallback matching
    let pageTitle = '';
    let pageCompany = '';

    const titleEl = document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]') ||
                    document.querySelector('h2.jobsearch-JobInfoHeader-title') ||
                    document.querySelector('h1');
    if (titleEl) pageTitle = titleEl.textContent.trim().toLowerCase();

    const companyEl = document.querySelector('[data-testid="inlineHeader-companyName"]') ||
                      document.querySelector('[data-testid="jobsearch-CompanyInfoContainer"]');
    if (companyEl) pageCompany = companyEl.textContent.trim().toLowerCase();

    const jobs = STJ.flattenMosaicJobs
      ? STJ.flattenMosaicJobs(snapshot)
      : [];

    if (STJ.pickMosaicJobForListing) {
      // Exact jk/vjk match when the URL has a key. The old
      // currentUrl.includes(pageJobKey) bonus applied to EVERY row
      // and let a date-rich neighbor win.
      return STJ.pickMosaicJobForListing(jobs, jobKey, pageTitle, pageCompany);
    }

    let bestMatch = null;
    let bestScore = 0;
    let bestIdentity = 0;

    for (const job of jobs) {
      if (!job) continue;

      const thisJobKey = (job.jobkey || '').toLowerCase();
      const jobTitle = (job.displayTitle || job.title || '').toLowerCase();
      const jobCompany = (job.company || '').toLowerCase();

      let identity = 0;
      const exactKey = !!(jobKey && thisJobKey === jobKey);
      if (exactKey) identity += 100;
      if (pageTitle && jobTitle && pageTitle.includes(jobTitle.substring(0, 25))) identity += 35;
      if (pageCompany && jobCompany && pageCompany.includes(jobCompany)) identity += 15;

      if (jobKey && !exactKey) continue;

      let score = identity;
      if (job.pubDate || job.formattedRelativeTime) score += 20;
      if (job.formattedRelativeTime) score += 10;
      if (job.pubDate) score += 5;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = job;
        bestIdentity = identity;
      }
    }

    if (bestMatch && (jobKey || bestIdentity >= 35)) {
      return bestMatch;
    }

  } catch (e) {
    // fail silently
  }
  return null;
}

// Helper: parse Indeed relative time strings (very broad)
function parseIndeedRelativeDate(text) {
  if (STJ.parseRelativeDays) return STJ.parseRelativeDays(text);
  if (!text) return null;
  const t = String(text).toLowerCase().trim();
  if (/just posted|today|moments? ago|posted today/.test(t)) return 0;
  let m = t.match(/(\d+)\+?\s*(?:days?|d)\s*ago/);
  if (m) return parseInt(m[1], 10);
  m = t.match(/(\d+)\s*w(?:eeks?)?\s*ago/);
  if (m) return parseInt(m[1], 10) * 7;
  return null;
}

// H1 - Extract a posting age from a NOISY blob (e.g. stringified insights
// JSON that may contain several jobs' relative times) without guessing.
// Returns a day count only when every date-like phrase agrees; returns
// null when absent OR ambiguous, so the identity-matched mosaic job
// remains the source of truth instead of the first regex hit winning.
function extractConsistentDaysFromBlob(blob) {
  if (!blob) return null;
  const t = String(blob).toLowerCase();
  const vals = new Set();
  const re = /(?:posted|reposted|active|hiring)?\s*(\d+)\+?\s*(days?|weeks?|d|w)\s*ago/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = parseInt(m[1], 10);
    if (Number.isNaN(n)) continue;
    vals.add(/^w/.test(m[2]) ? n * 7 : n);
    if (vals.size > 1) return null; // conflicting ages → ambiguous, defer
  }
  if (/just posted|posted today|moments? ago/.test(t)) vals.add(0);
  return vals.size === 1 ? [...vals][0] : null;
}

// M3 - Convert a matched mosaic job to a day count. Prefer Indeed's own
// formattedRelativeTime (the label the user actually sees on the page)
// over pubDate, and round pubDate math instead of ceil (ceil inflates
// age by up to a full day, which inflates the ghost score).
function mosaicJobToDays(job) {
  if (STJ.daysOpenFromMosaicJob) return STJ.daysOpenFromMosaicJob(job);
  if (!job) return null;
  if (job.formattedRelativeTime) {
    const d = parseIndeedRelativeDate(job.formattedRelativeTime);
    if (d != null) return d;
  }
  if (job.pubDate) {
    const diff = Math.round((Date.now() - new Date(job.pubDate)) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  }
  return null;
}

function getIndeedDetailRoot() {
  // Never fall back to document.body / role=main — on search SPA those
  // include the left-rail cards (sibling dates + "Often replies in").
  const known = document.querySelector('#jobsearch-ViewjobPaneWrapper') ||
         document.querySelector('#viewJobDescLinkTarget') ||
         document.querySelector('#jobsearch-JobBody') ||
         document.querySelector('.jobsearch-JobInfoWrapper') ||
         document.querySelector('[data-testid="jobsearch-JobComponent"]') ||
         document.querySelector('.jobsearch-RightPane') ||
         document.querySelector('#jobsearch-ViewJobPage') ||
         document.querySelector('[data-testid="viewJob-body"]');
  if (known) return known;
  const desc = document.querySelector('#jobDescriptionText');
  if (!desc) return null;
  let el = desc;
  for (let i = 0; i < 8 && el.parentElement; i++) {
    el = el.parentElement;
    if (el.id === 'mosaic-provider-jobcards' || /LeftPane/i.test(el.className || '')) break;
    if (el.offsetWidth > 400) return el;
  }
  return desc.parentElement || desc;
}

function readSelectedIndeedCardText(jobKey) {
  if (!jobKey) return '';
  const key = String(jobKey);
  const card =
    document.querySelector('[data-jk="' + key + '"]') ||
    document.querySelector('[data-jk="' + key.toLowerCase() + '"]') ||
    document.querySelector('a[id="job_' + key + '"]') ||
    document.querySelector('a[data-jk="' + key + '"]');
  if (!card) return '';
  const root = card.closest('.job_seen_beacon, .resultContent, li, [data-jk]') || card;
  return (root.innerText || '').trim();
}

function readIndeedJsonLdDatePosted() {
  if (!STJ.daysOpenFromJobPostingJsonLd) return null;
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    const days = STJ.daysOpenFromJobPostingJsonLd(s.textContent);
    if (days != null) return days;
  }
  return null;
}

// Brute-force finder: walk the main job container and return the first element
// whose text looks like a posting date. This beats Indeed's constantly changing classes.
function findIndeedDateText(container) {
  if (!container) return '';

  // First try the known good selectors
  const knownSelectors = [
    '.jobsearch-HiringInsights-entry--bullet',
    '[data-testid="myJobsStateDate"]',
    '[data-testid*="date"]',
    '.jobsearch-JobMetadataFooter',
    '.jobsearch-JobInfoHeader-subtitle',
    '[aria-label*="Posted"]',
    '[aria-label*="Active"]',
    '.jobsearch-JobMetadataHeader-item'
  ];

  for (const sel of knownSelectors) {
    const el = container.querySelector(sel);
    if (el && el.textContent.trim()) {
      return el.textContent.trim();
    }
  }

  // Strategy 1: Specifically look for the "Date posted" value in the filter/metadata bar
  // (the row the user found: Pay | Distance | Job Type | Experience level | Date posted)
  // The actual value is usually in a sibling or nearby element in the same flex row.
  const allEls = container.querySelectorAll('*');
  for (const el of allEls) {
    const txt = el.textContent.trim();
    if (/date posted/i.test(txt) && txt.length < 40) {
      const parent = el.parentElement;
      if (parent) {
        // Check all children of the parent row for a short date value
        for (const child of parent.children) {
          const childTxt = child.textContent.trim();
          // Matches things like "5d ago", "12 days ago", "Posted today", "3w", "just posted", etc.
          if (childTxt.length > 1 && childTxt.length < 35 &&
              /(\d+[dw]|\d+\s*(d|days?|w|weeks?)|today|just posted|active)/i.test(childTxt)) {
            return childTxt;
          }
        }

        // Fallback: look for "Date posted" + value pattern in the parent's text
        const parentText = parent.textContent.trim();
        const match = parentText.match(/date posted[^A-Za-z0-9]*([A-Za-z0-9\s]{2,25})/i);
        if (match && match[1] && match[1].length > 1) {
          return match[0].trim();
        }
      }
    }
  }

  // Strategy 2: Look for "Hiring Insights" or job metadata sections
  const insightsSelectors = [
    '.jobsearch-HiringInsights-entry--bullet',
    '[data-testid*="hiringInsights"]',
    '[data-testid*="insights"]',
    '.jobsearch-JobMetadataFooter',
    '.jobsearch-JobInfoHeader-subtitle'
  ];
  for (const sel of insightsSelectors) {
    const el = container.querySelector(sel);
    if (el) {
      const txt = el.textContent.trim();
      if (txt.length > 5 && txt.length < 80 && /(\d+.*(d|days?|w|weeks?|ago)|just posted|today|active)/i.test(txt)) {
        return txt;
      }
    }
  }

  // Strategy 2: Brute force for any short text that looks like a relative date
  // (e.g. "5d ago", "12 days ago", "3w ago", "Posted 4d ago", etc.)
  const datePattern = /(\d+\s*(?:d|days?|w|weeks?|h|hours?)\s*ago|posted\s+\d|active\s+\d|just posted|\d+[dw]\s*ago)/i;
  const allContainerEls = container.querySelectorAll('*');
  for (const el of allContainerEls) {
    const txt = el.textContent.trim();
    if (txt.length > 2 && txt.length < 60 && datePattern.test(txt)) {
      return txt;
    }
  }

  // Strategy 3: Look for elements with data-testid containing "date" and grab their text or parent's
  const dateTestIdEls = container.querySelectorAll('[data-testid*="date"], [data-testid*="posted"]');
  for (const el of dateTestIdEls) {
    const txt = el.textContent.trim();
    if (txt.length > 3 && txt.length < 60) return txt;
    const parentTxt = el.parentElement?.textContent.trim();
    if (parentTxt && parentTxt.length > 3 && parentTxt.length < 80) return parentTxt;
  }

  return '';
}

async function parseIndeedListing() {
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
    // 0.1.8 new signals
    engagementSignals: [],
    employerResponseTime: null,
    userClickedApply: false,
    // 0.1.8 new signals
    workArrangement: null,
    employmentType: null,
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

  // Job ID first — every later signal is keyed to jk/vjk so SPA and
  // /viewjob cannot score two different identities.
  data.platformJobId = STJ.extractIndeedJobKey
    ? STJ.extractIndeedJobKey(window.location.href)
    : ((window.location.href.match(/[?&#](?:vjk|jk)=([a-f0-9]+)/i) || [])[1] || null);

  // Detail pane only. Never document.body / role=main — those include
  // left-rail cards on search SPA ("Often replies in", other jobs' ages).
  const detailRoot = getIndeedDetailRoot();
  const detailText = ((detailRoot && detailRoot.innerText) || '').toLowerCase();
  const selectedCardText = readSelectedIndeedCardText(data.platformJobId);

  let dateText = detailRoot ? findIndeedDateText(detailRoot) : '';
  if (!dateText && detailText) {
    const patterns = [
      /(posted|active|reposted)\s+(\d+)\+?\s*(?:d|days?)\s*ago/i,
      /(\d+)\+?\s*(?:d|days?)\s*ago/i,
      /just posted|posted today/i,
      /(\d+)\s*w(?:eeks?)?\s*ago/i
    ];
    for (const p of patterns) {
      const m = detailText.match(p);
      if (m) { dateText = m[0]; break; }
    }
  }

  mosaicDateAttempts++;
  window.SkipThisJob_MosaicStats.attempts = mosaicDateAttempts;

  let mosaicJob = getIndeedJobFromMosaic();
  const delays = [700, 900, 1100];
  for (const delay of delays) {
    if (mosaicJob && (mosaicJob.pubDate || mosaicJob.formattedRelativeTime || mosaicJob.jobkey)) break;
    await new Promise(r => setTimeout(r, delay));
    mosaicJob = getIndeedJobFromMosaic();
  }

  const snapshot = readBridgedMosaic();
  let jsonLdText = '';
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    if (s.textContent) jsonLdText += s.textContent + '\n';
  });

  const cached = STJ.recallIndeedJobSignals
    ? await STJ.recallIndeedJobSignals(data.platformJobId)
    : null;

  const collected = STJ.collectIndeedListingSignals
    ? STJ.collectIndeedListingSignals({
        jobKey: data.platformJobId,
        snapshot: snapshot,
        mosaicJobs: mosaicJob ? [mosaicJob].concat(STJ.flattenMosaicJobs ? STJ.flattenMosaicJobs(snapshot) : []) : undefined,
        pageTitle: data.title,
        pageCompany: data.companyName,
        detailText: detailText,
        selectedCardText: selectedCardText,
        detailDateText: dateText,
        jsonLdText: jsonLdText,
        cached: cached,
      })
    : null;

  if (collected) {
    data.daysOpen = collected.daysOpen;
    data.employerResponsive = collected.employerResponsive;
    data.isRepost = collected.isRepost;
    data.appliesOffsite = collected.appliesOffsite;
    data.urgentlyHiring = collected.urgentlyHiring;
    data.hiringMultiple = collected.hiringMultiple;
    data.engagementSignals = collected.engagementSignals;
    if (collected.mosaicJob) mosaicJob = collected.mosaicJob;
  } else {
    data.daysOpen = mosaicJobToDays(mosaicJob);
    if (data.daysOpen == null && dateText) data.daysOpen = parseIndeedRelativeDate(dateText);
    if (data.daysOpen == null) data.daysOpen = readIndeedJsonLdDatePosted();
  }

  if (data.daysOpen != null && mosaicJob && (mosaicJob.pubDate || mosaicJob.formattedRelativeTime)) {
    mosaicDateSuccesses++;
    window.SkipThisJob_MosaicStats.successes = mosaicDateSuccesses;
    console.log(`[SkipThisJob] Mosaic date SUCCESS → ${data.daysOpen} days (${mosaicJob.formattedRelativeTime || 'from pubDate'})`);
    if (mosaicJob.salarySnippet && mosaicJob.salarySnippet.text && !data.salaryListed) {
      data.salaryListed = true;
    }
  } else if (data.daysOpen != null) {
    console.log('[SkipThisJob] Days open:', data.daysOpen, 'from:', (dateText || 'json-ld/cache').substring(0, 60));
  } else {
    console.log(`[SkipThisJob] Mosaic date FAILED (attempts: ${mosaicDateAttempts}, successes: ${mosaicDateSuccesses})`);
  }

  // Late re-check stays scoped to the detail root + identity-matched mosaic.
  // Do not scan document.body — that reintroduces sibling-card dates.
  if (data.daysOpen == null) {
    setTimeout(async () => {
      if (data.daysOpen != null) return;
      try {
        const lateRoot = getIndeedDetailRoot();
        let lateDateText = lateRoot ? findIndeedDateText(lateRoot) : '';
        let lateDays = lateDateText ? parseIndeedRelativeDate(lateDateText) : null;
        if (lateDays == null) lateDays = mosaicJobToDays(getIndeedJobFromMosaic());
        if (lateDays == null) lateDays = readIndeedJsonLdDatePosted();
        if (lateDays != null) {
          data.daysOpen = lateDays;
          console.log(`[SkipThisJob] Late re-check SUCCESS → ${lateDays} days`);
        }
      } catch (e) {}
    }, 5500);
  }

  // 0.1.8 - Improved salary detection (structured fields + description)
  const salaryEl =
    document.querySelector('#salaryInfoAndJobType') ||
    document.querySelector('[data-testid="attribute_snippet_testid"]') ||
    document.querySelector('.jobsearch-JobMetadataHeader-item') ||
    document.querySelector('.salary-snippet-container') ||
    document.querySelector('[data-testid*="salary"]');

  if (salaryEl && /\$[\d,.]+/.test(salaryEl.textContent)) {
    data.salaryListed = true;
    console.log('[SkipThisJob] Salary found');
  }

  // Work arrangement / employment type from the detail pane only
  const lowerPage = detailText;
  if (lowerPage.includes('remote') && !lowerPage.includes('hybrid')) {
    data.workArrangement = 'remote';
  } else if (lowerPage.includes('hybrid')) {
    data.workArrangement = 'hybrid';
  } else if (lowerPage.includes('on-site') || lowerPage.includes('onsite')) {
    data.workArrangement = 'onsite';
  }

  if (lowerPage.includes('full-time')) {
    data.employmentType = 'full_time';
  } else if (lowerPage.includes('part-time')) {
    data.employmentType = 'part_time';
  } else if (lowerPage.includes('contract')) {
    data.employmentType = 'contract';
  } else if (lowerPage.includes('intern')) {
    data.employmentType = 'internship';
  }

  // 0.1.8 - Improved description detection
  const descEl =
    document.querySelector('#jobDescriptionText') ||
    document.querySelector('.jobsearch-jobDescriptionText') ||
    document.querySelector('.jobsearch-JobComponent-description') ||
    document.querySelector('[data-testid="job-description"]') ||
    document.querySelector('.jobsearch-JobDescription');

  if (descEl) {
    data.description = descEl.textContent.trim();

    // Improved salary detection inside description
    if (!data.salaryListed) {
      const salaryPatterns = [
        /\$[\d,]+(?:\s*-\s*\$[\d,]+)?(?:\s*(?:k|K|per year|\/year|\/hr|\/hour))?/i,
        /pay\s*range[:\s]*\$?[\d,]+(?:\s*-\s*\$?[\d,]+)?/i,
        /\$[\d,]+\s*(?:to|–|-)\s*\$[\d,]+/i
      ];

      for (const pattern of salaryPatterns) {
        if (pattern.test(data.description)) {
          data.salaryListed = true;
          break;
        }
      }
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
    if (pattern.test(detailText) || (data.description && pattern.test(data.description))) {
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

  data.activelyReviewing = STJ.isActivelyReviewing
    ? STJ.isActivelyReviewing(data)
    : data.engagementSignals.includes('actively_reviewing');
  if (data.employerResponsive) console.log('[SkipThisJob] Employer responsive (this job only)');

  // "Apply on company site" — detail apply button, not page-wide copy
  const applyRoot = detailRoot || document;
  const applyBtn = applyRoot.querySelector('[data-testid="apply-button-container"]') ||
                   applyRoot.querySelector('.jobsearch-IndeedApplyButton-newDesign') ||
                   applyRoot.querySelector('button[id*="apply"], a[id*="apply"]');
  const applyText = applyBtn ? applyBtn.textContent.toLowerCase() : '';
  if (applyText.includes('company site') || applyText.includes('apply on')) {
    data.appliesOffsite = true;
  }

  // Indeed employer rating from the detail header (not a sibling card)
  const ratingEl = (detailRoot || document).querySelector('[data-testid="inlineHeader-companyRating"]') ||
                   (detailRoot || document).querySelector('.jobsearch-CompanyInfoContainer .ratingsDisplay');
  if (ratingEl) {
    const ratingText = ratingEl.textContent.match(/(\d\.\d)/);
    if (ratingText) data.indeedRating = parseFloat(ratingText[1]);
  } else {
    const ratingMatch = detailText.match(/(\d\.\d)\s*(?:out of 5|★|star)/);
    if (ratingMatch) data.indeedRating = parseFloat(ratingMatch[1]);
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

  data.descriptionHash = STJ.hashDescription ? STJ.hashDescription(data.description) : null;

  if (data.platformJobId && STJ.rememberIndeedJobSignals) {
    STJ.rememberIndeedJobSignals(data.platformJobId, {
      daysOpen: data.daysOpen,
      employerResponsive: data.employerResponsive,
      engagementSignals: data.engagementSignals,
      salaryListed: data.salaryListed,
    });
  }

  console.log('[SkipThisJob] Parsed:', JSON.stringify({
    title: data.title, company: data.companyName, days: data.daysOpen,
    salary: data.salaryListed, thirdParty: data.isThirdParty,
    jobKey: data.platformJobId, responsive: data.employerResponsive
  }));

  if (data.daysOpen == null) {
    console.warn('[SkipThisJob] ⚠️  STILL NO DATE after all attempts (detail + identity mosaic + json-ld + cache). This job will get +15 unknown age penalty.');
  }

  return data;
}


// ============================================================
// SCORING
// ============================================================

// Philosophy: "How likely is applying to this job a waste of my time?"
// A listing doesn't have to be fake to be a waste of time. A real job
// open 30 days with no engagement signals has almost zero chance of
// resulting in an interview. We score for futility, not just fraud.
//
// Score ranges (heuristic only, before backend blend):
//   0–24  Worth Applying        — fresh listing, few red flags
//   25–49 Proceed with Caution  — some warning signs, manage expectations
//   50–74 Likely a Waste of Time — stale, opaque, or showing ghost patterns
//   75–100 Skip This Job        — overwhelming evidence this won't lead anywhere

// --- Real description vagueness + seniority analysis (from scoring/ghostScore.js) ---
const VAGUE_PATTERNS = [
  /fast[- ]paced environment/i, /wear many hats/i, /self[- ]starter/i,
  /team player/i, /excellent communication skills/i, /detail[- ]oriented/i,
  /results[- ]driven/i, /dynamic (environment|team|company)/i, /exciting opportunity/i,
  /competitive (salary|compensation|pay)/i, /great (benefits|culture|team)/i,
  /must be able to (multitask|work independently)/i, /rockstar|ninja|guru|wizard/i,
  /other duties as assigned/i, /fast[- ]growing (company|startup)/i,
];
const SPECIFIC_PATTERNS = [
  /\b(python|java|javascript|react|angular|vue|node|sql|aws|gcp|azure)\b/i,
  /\b(salesforce|hubspot|marketo|tableau|jira|confluence)\b/i,
  /\breport(s|ing)?\s+to\b/i, /\b(team of|department of)\s+\d+/i,
  /\$[\d,]+/i, /\b\d+\+?\s*years?\b/i,
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
  totalChecks += VAGUE_PATTERNS.length; VAGUE_PATTERNS.forEach(p => { if (p.test(text)) vagueIndicators++; });
  totalChecks += SPECIFIC_PATTERNS.length; SPECIFIC_PATTERNS.forEach(p => { if (p.test(text)) vagueIndicators--; });
  if (text.length < 500) { vagueIndicators += 2; totalChecks += 2; }
  const techMatches = text.match(KITCHEN_SINK_TECH);
  if (techMatches && new Set(techMatches.map(t => t.toLowerCase())).size > 15) { vagueIndicators += 3; totalChecks += 3; }
  return Math.max(0, Math.min(1, vagueIndicators / Math.max(totalChecks, 1)));
}

function detectSeniorityMismatch(title, description) {
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

function scoreLocally(listing) {
  const isHighTurnover = !!(listing.title && HIGH_TURNOVER_PATTERNS.some(p => p.test(listing.title)));
  const vagueness = listing.description ? analyzeDescriptionVagueness(listing.description) : null;
  const seniorityMismatch = !!(listing.seniorityMismatch ||
    detectSeniorityMismatch(listing.title || '', listing.description || ''));

  if (STJ.scoreListingSignals) {
    return STJ.scoreListingSignals(listing, {
      platform: 'indeed',
      isHighTurnover: isHighTurnover,
      vagueness: vagueness,
      afterShared: function (score, signals, ctx) {
        const activelyReviewing = ctx && ctx.activelyReviewing;

        if (listing.employerResponsive) {
          score -= 5;
          signals.push('✓ Employer responds quickly');
        } else {
          score += 8;
          signals.push('No employer response data');
        }

        if (listing.appliesOffsite) {
          score += 5;
          signals.push('Applies redirect off Indeed');
        }

        if (listing.indeedRating != null) {
          if (listing.indeedRating < 2.5) {
            score += 10;
            signals.push(`Indeed rating: ${listing.indeedRating}/5`);
          } else if (listing.indeedRating < 3.0) {
            score += 5;
            signals.push(`Indeed rating: ${listing.indeedRating}/5`);
          } else if (listing.indeedRating >= 4.0) {
            score -= 3;
          }
        }

        if (listing.description && listing.descriptionLength < 280) {
          score += 5;
          signals.push('Very short job description');
        }

        if (seniorityMismatch) {
          score += 13;
          signals.push('⚠️ Seniority mismatch — title and requirements conflict');
        }

        const isOld = listing.daysOpen >= 14;
        const missingBasics = !listing.salaryListed && !listing.employerResponsive && !activelyReviewing;
        if (isOld && missingBasics) {
          score += 24;
          signals.push('Stale posting with multiple missing basics — low effort or ghost risk');
        }
        if (listing.daysOpen >= 30 && !activelyReviewing) {
          score += 14;
          signals.push('30+ days old with no active review signals — very low chance');
        }
        if (listing.daysOpen >= 30 && !activelyReviewing &&
            !listing.employerResponsive && !listing.salaryListed) {
          score += 12;
          signals.push('🚩 Stale listing: old, no engagement, no salary — classic dead end');
        }
        if (listing.isRepost) {
          signals.push('High Volume Repost');
        }
        if (isHighTurnover) {
          signals.push('⚡ High turnover role — expect frequent reposting');
        }
        return { score: score, signals: signals };
      },
    });
  }

  return { score: 10, label: 'low', signals: [], isHighTurnover: isHighTurnover, daysOpen: listing.daysOpen };
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
        platform: extra.platform || 'indeed',
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
        reportData: { ...reportData, anonymousUserHash: userHash, platform: 'indeed' },
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
// employer backend score.
//
// Why: a thin backend record (employer merely present in the Kaggle seed
// with a few listings and zero reports) returns a near-zero score that
// means "no evidence", NOT "safe employer". The old flat 40/60 blend
// weighted that emptiness at 60% and dragged strong listing-level ghost
// signals (e.g. 87 "Skip This Job") down to 35 "Proceed with Caution" —
// under-warning on exactly the obscure employers most likely to ghost.
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

  // Confidence the backend carries real signal → its weight when it would
  // pull the score DOWN.
  let wDown;
  if (backendData.live) wDown = 0.60;        // fresh community reports / repost patterns
  else if (reports >= 10) wDown = 0.40;
  else if (reports >= 3) wDown = 0.25;
  else if (listings >= 8) wDown = 0.15;
  else wDown = 0.0;                          // thin seed record → ~100% heuristic

  // Raising is easier than lowering: an employer that looks sketchy matters
  // more to a ghost detector than the cost of erring toward caution.
  const wUp = Math.max(wDown, 0.30);

  const w = backend >= local ? wUp : wDown;
  let score = Math.round(local * (1 - w) + backend * w);
  const signals = [...new Set([...localScore.signals, ...(backendData.signals || [])])];
  if (STJ.enforceAgeFloor) {
    const floored = STJ.enforceAgeFloor(score, localScore.daysOpen, signals);
    score = floored.score;
  }
  const label = STJ.labelForScore ? STJ.labelForScore(score)
    : (score >= 75 ? 'very_high' : score >= 55 ? 'high' : score >= 35 ? 'moderate' : 'low');
  return { score, label, signals, daysOpen: localScore.daysOpen };
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

  // Close button handler (0.1.8)
  document.getElementById('ghost-close-btn')?.addEventListener('click', () => {
    overlay.remove();
    lastVjk = getCurrentVjk(); // prevent immediate re-show on same job
  });

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
      btn.textContent = '⏳ Submitting...';
      btn.disabled = true;
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

  document.querySelectorAll('[data-outcome]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const outcome = e.target.dataset.outcome;
      btn.textContent = '⏳ Submitting...';
      btn.disabled = true;
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
// MAIN
// ============================================================

let lastVjk = null;
let isProcessing = false;
let currentListingData = null;   // 0.1.8 - store current listing for reliable Apply tracking
let lastPublishedScore = null;

// Temporary counters for 0.1.8 testing of mosaic date extraction
let mosaicDateAttempts = 0;
let mosaicDateSuccesses = 0;
window.SkipThisJob_MosaicStats = { attempts: 0, successes: 0 }; // easy to inspect in console

console.log('%c[SkipThisJob] Content script finished loading (bottom of file reached)', 'color: lime');

function getCurrentVjk() {
  const key = STJ.extractIndeedJobKey
    ? STJ.extractIndeedJobKey(window.location.href)
    : ((window.location.href.match(/[?&#](?:vjk|jk)=([a-f0-9]+)/i) || [])[1] || null);
  return key || window.location.href;
}

async function processCurrentListing() {
  if (!extensionAlive()) { teardownGhostDetector(); return; }
  const vjk = getCurrentVjk();
  if (vjk === lastVjk && lastVjk !== null) return;
  if (isProcessing) return;

  isProcessing = true;
  lastVjk = vjk;

  // Wait for page to render (Indeed is slow — date/Hiring Insights often appears late)
  await new Promise(resolve => setTimeout(resolve, 2300));

  const listing = await parseIndeedListing();
  if (!listing.title || !listing.companyName) {
    console.log('[SkipThisJob] Could not parse Indeed listing, skipping');
    isProcessing = false;
    return;
  }

  // Compute the pre-blend heuristic up front so it can be persisted server
  // side (powers the employer leaderboard). Pre-blend on purpose: the
  // blended score depends on the backend score → feedback loop if stored.
  const localScore = scoreLocally(listing);

  // Store current listing data for reliable Apply tracking (0.1.8)
  currentListingData = {
    ...listing,
    platform: 'indeed',
    userClickedApply: false,
    listingHeuristic: localScore.score,
    descriptionHash: listing.descriptionHash,
  };

  const trackPayload = STJ.buildTrackPayload
    ? STJ.buildTrackPayload(currentListingData, { platform: 'indeed', listingHeuristic: localScore.score })
    : {
      companyName: listing.companyName,
      jobTitle: listing.title,
      platform: 'indeed',
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
    ? STJ.publishActiveListing(currentListingData, initialBlend, 'indeed')
    : null;
  injectOverlay(localScore, null, listing);

  // Fetch backend employer score
  const backendData = await fetchEmployerScore(listing.companyName, {
    platform: 'indeed',
    jobId: listing.platformJobId,
  });

  // TODO: Live employer scan disabled — Indeed's raw HTML doesn't include
  // the actual job count (it's loaded via JavaScript). Needs a different
  // approach like parsing Indeed's JSON API or embedded page data.
  // For now, rely on the backend's tracked listings from Kaggle seed data.

  // Re-inject with backend data
  const mergedBackend = backendData && backendData.found ? backendData : null;
  if (mergedBackend) {
    const blended = blendGhostScore(localScore, mergedBackend);
    lastPublishedScore = STJ.publishActiveListing
      ? STJ.publishActiveListing(currentListingData, blended, 'indeed')
      : lastPublishedScore;
  }
  injectOverlay(localScore, mergedBackend, listing);

  isProcessing = false;
}

if (STJ.installPopupBridge) {
  STJ.installPopupBridge(() => lastPublishedScore);
}

function startIndeedListBadges() {
  if (!STJ.watchListBadges) return;
  STJ.watchListBadges({
    listRootSelector: '#mosaic-provider-jobcards, .jobsearch-LeftPane, #jobsearch-JapanPage',
    findCards() {
      return document.querySelectorAll(
        '.job_seen_beacon, div[data-jk], .resultContent, .jobsearch-ResultsList > li'
      );
    },
    parseCard(card) {
      const titleEl = card.querySelector(
        'h2.jobTitle a, [data-testid="jobTitle"], a.jcs-JobTitle, h2.jobTitle span'
      );
      const title = (titleEl && titleEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (!title || title.length < 3) return null;
      const companyEl = card.querySelector(
        '[data-testid="company-name"], .companyName, [data-testid="companyName"]'
      );
      const dateEl = card.querySelector(
        '[data-testid="myJobsStateDate"], .date, span.date'
      );
      const text = (card.innerText || '').toLowerCase();
      return {
        title,
        companyName: companyEl ? companyEl.textContent.trim() : null,
        daysOpen: STJ.daysOpenFromCard
          ? STJ.daysOpenFromCard(card, dateEl, text)
          : (STJ.parseRelativeDays ? STJ.parseRelativeDays(dateEl ? dateEl.textContent : text) : null),
        isRepost: /repost/.test(text),
        salaryListed: /\$\d/.test(text) ? true : undefined,
        applicantCount: STJ.parseApplicantCount ? STJ.parseApplicantCount(text) : null,
        engagementSignals: /actively reviewing|reviewing applicants/.test(text)
          ? ['actively_reviewing'] : [],
        platform: 'indeed',
      };
    },
    anchor(card) {
      return card.querySelector('h2.jobTitle, [data-testid="jobTitle"], a.jcs-JobTitle') || card;
    },
  });
}

// Initial run
processCurrentListing();
startIndeedListBadges();

// 0.1.8 - Track Apply clicks on Indeed (passive, reliable)
document.addEventListener('click', (e) => {
  const target = e.target.closest('button, a');
  if (!target) return;

  const text = (target.textContent || target.innerText || '').toLowerCase();
  const ariaLabel = (target.getAttribute('aria-label') || '').toLowerCase();

  if (
    text.includes('apply') ||
    ariaLabel.includes('apply') ||
    target.getAttribute('data-testid')?.includes('apply')
  ) {
    const currentJobId = getCurrentVjk();
    if (currentListingData && (!currentJobId || currentListingData.platformJobId === currentJobId || currentJobId === window.location.href)) {
      currentListingData.userClickedApply = true;
      const listingData = STJ.buildTrackPayload
        ? STJ.buildTrackPayload(currentListingData, { platform: 'indeed', userClickedApply: true })
        : { ...currentListingData, jobTitle: currentListingData.title, userClickedApply: true };
      safeSendMessage({ type: 'TRACK_LISTING', listingData });
    } else {
      safeSendMessage({
        type: 'USER_CLICKED_APPLY',
        platform: 'indeed',
        url: window.location.href,
        companyName: currentListingData && currentListingData.companyName,
        jobTitle: currentListingData && (currentListingData.title || currentListingData.jobTitle),
        platformJobId: (currentJobId && currentJobId !== window.location.href)
          ? currentJobId
          : (currentListingData && currentListingData.platformJobId),
      });
    }
  }
}, true);

// Poll for vjk changes
_ghostTimers.push(setInterval(() => {
  if (!extensionAlive()) { teardownGhostDetector(); return; }
  const vjk = getCurrentVjk();
  if (vjk !== lastVjk && !isProcessing) {
    processCurrentListing();
  }
}, 1500));

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
  _ghostObserver = new MutationObserver(() => {
    if (!extensionAlive()) { teardownGhostDetector(); return; }
    const vjk = getCurrentVjk();
    if (vjk !== lastVjk && !isProcessing) {
      processCurrentListing();
    }
  });
  _ghostObserver.observe(rightPane, { childList: true, subtree: true });
}
