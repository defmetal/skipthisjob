// ============================================================
// Indeed Content Script — Skip This Job
// ============================================================

const API_BASE = 'https://skipthisjob.com/api';

// ============================================================
// DOM PARSING
// ============================================================

// 0.1.8 - Aggressive extraction of current job from Indeed's multiple mosaic providers
function getIndeedJobFromMosaic() {
  try {
    const providerData = window.mosaic?.providerData;
    if (!providerData) return null;

    const currentUrl = window.location.href.toLowerCase();
    let jobKey = null;

    // Extract job key from URL (handles multiple Indeed formats)
    const jkMatch = currentUrl.match(/[?&]jk=([^&?#]+)/);
    if (jkMatch) jobKey = jkMatch[1];

    // Also try path-based keys (some /viewjob URLs)
    if (!jobKey) {
      const pathMatch = currentUrl.match(/\/viewjob(?:\/[^/?#]+)?\/([^/?#]+)/);
      if (pathMatch) jobKey = pathMatch[1];
    }

    const providers = Object.keys(providerData).filter(k => k.includes('jobcards'));

    let bestMatch = null;
    let bestScore = 0;

    for (const providerKey of providers) {
      const results = providerData[providerKey]?.metaData?.mosaicProviderJobCardsModel?.results;
      if (!results || !Array.isArray(results)) continue;

      for (const job of results) {
        if (!job) continue;

        let matchScore = 0;
        const thisJobKey = (job.jobkey || '').toLowerCase();
        const jobUrl = (job.link || job.url || '').toLowerCase();
        const jobTitle = (job.displayTitle || job.title || '').toLowerCase();
        const jobCompany = (job.company || '').toLowerCase();
        const hasPubDate = !!job.pubDate;
        const hasRelativeTime = !!(job.formattedRelativeTime || job.relativeTime);

        // Strongest possible match: exact jobkey from URL
        if (jobKey && thisJobKey === jobKey) {
          return job; // immediate perfect match
        }

        // Very strong: jobkey appears in the current page URL
        if (jobKey && (currentUrl.includes(jobKey) || jobUrl.includes(jobKey))) {
          matchScore += 12;
        }

        // Good fallback: title match (more generous)
        if (jobTitle) {
          const shortTitle = jobTitle.substring(0, 30);
          if (currentUrl.includes(encodeURIComponent(shortTitle)) || currentUrl.includes(shortTitle.replace(/\s+/g, ''))) {
            matchScore += 7;
          }
        }

        // Company name fallback
        if (jobCompany && currentUrl.includes(encodeURIComponent(jobCompany.replace(/\s+/g, '')))) {
          matchScore += 3;
        }

        // Prefer jobs that have date information (pubDate or formattedRelativeTime)
        if (hasPubDate) matchScore += 6;
        if (hasRelativeTime) matchScore += 4;

        // Prefer jobs with salary data
        if (job.salarySnippet?.text) matchScore += 2;

        if (matchScore > bestScore) {
          bestScore = matchScore;
          bestMatch = job;
        }
      }
    }

    // Return the best match we found (lower threshold to catch more cases)
    if (bestMatch && bestScore >= 4) {
      return bestMatch;
    }

  } catch (e) {
    // Fail silently if the mosaic structure changes
  }
  return null;
}

// Helper: parse Indeed relative time strings ("5 days ago", "just posted", "2 hours ago", etc.)
function parseIndeedRelativeDate(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().trim();

  if (/just posted|today|moments? ago|posted today/.test(t)) return 0;
  if (/(few |a few )?(hours?|mins?|minutes?) ago/.test(t)) return 0;

  // "5 days ago", "12+ days ago", "reposted 3 days ago"
  let m = t.match(/(?:posted|reposted|active)?\s*(\d+)\+?\s*days?\s*ago/);
  if (m) return parseInt(m[1], 10);

  // "Active 8 days ago"
  m = t.match(/active\s+(\d+)\+?\s*days?/);
  if (m) return parseInt(m[1], 10);

  // "3 days ago" standalone
  m = t.match(/(\d+)\+?\s*days?\s*ago/);
  if (m) return parseInt(m[1], 10);

  return null;
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

  // --- Page text for signal detection ---
  const pageText = document.body.innerText.toLowerCase();

  // 0.1.8 - Targeted text from the main job detail pane only (avoids left sidebar job list dates)
  const mainJobContainer =
    document.querySelector('#jobsearch-JobBody') ||
    document.querySelector('.jobsearch-JobInfoWrapper') ||
    document.querySelector('[data-testid="jobsearch-JobComponent"]') ||
    document.querySelector('div[role="main"]') ||
    document.body;
  const detailText = (mainJobContainer.innerText || '').toLowerCase();

  // --- 0.1.8: Aggressive Posted date detection (visible text first, mosaic secondary) ---
  // Use detailText (main right pane only) to avoid matching dates from the left job list sidebar.
  const dateSelectors = [
    '.jobsearch-HiringInsights-entry--bullet',
    '[data-testid="myJobsStateDate"]',
    '[data-testid*="date"]',
    '.jobsearch-JobMetadataFooter',
    '.jobsearch-JobInfoHeader-subtitle',
    '[aria-label*="Posted"]',
    '[aria-label*="Active"]',
    '.jobsearch-JobMetadataHeader-item'
  ];

  let dateText = '';
  for (const sel of dateSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const txt = el.textContent.trim();
      if (txt) {
        dateText = txt;
        break;
      }
    }
  }

  // Very aggressive fallback — search only inside the main job detail area
  if (!dateText) {
    const patterns = [
      /(posted|active|reposted)\s+(\d+)\+?\s*days?\s*ago/i,
      /active\s+(\d+)\s*days?\s*ago/i,
      /(\d+)\+?\s*days?\s*ago/i,
      /just posted|posted today/i,
      /(\d+)\+?\s*hours?\s*ago/i
    ];
    for (const p of patterns) {
      const m = detailText.match(p);
      if (m) {
        dateText = m[0];
        break;
      }
    }
  }

  if (dateText) {
    const parsed = parseIndeedRelativeDate(dateText);
    if (parsed != null) {
      data.daysOpen = parsed;
    }
  }

  if (data.daysOpen != null) {
    console.log('[SkipThisJob] Days open (visible text):', data.daysOpen, 'from:', dateText.substring(0, 60));
  }

  // 0.1.8 - Aggressive mosaic date extraction with one retry (secondary)
  if (data.daysOpen == null) {
    mosaicDateAttempts++;
    window.SkipThisJob_MosaicStats.attempts = mosaicDateAttempts;

    let mosaicJob = getIndeedJobFromMosaic();

    // Retry once with delay (SPA hydration)
    if (!mosaicJob || (!mosaicJob.pubDate && !mosaicJob.formattedRelativeTime && !mosaicJob.relativeTime)) {
      await new Promise(r => setTimeout(r, 600));
      mosaicJob = getIndeedJobFromMosaic();
    }

    if (mosaicJob) {
      let days = null;

      if (mosaicJob.pubDate) {
        const pubDate = new Date(mosaicJob.pubDate);
        const now = new Date();
        const diffTime = Math.abs(now - pubDate);
        days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      } else if (mosaicJob.formattedRelativeTime || mosaicJob.relativeTime) {
        days = parseIndeedRelativeDate(mosaicJob.formattedRelativeTime || mosaicJob.relativeTime);
      }

      if (days != null) {
        mosaicDateSuccesses++;
        window.SkipThisJob_MosaicStats.successes = mosaicDateSuccesses;
        data.daysOpen = days;

        console.log(`[SkipThisJob] Mosaic date SUCCESS (attempts: ${mosaicDateAttempts}, successes: ${mosaicDateSuccesses}) → ${days} days`);

        // Enrich salary + responsive if present
        if (mosaicJob.salarySnippet?.text && !data.salaryListed) {
          data.salaryListed = true;
        }
        if (mosaicJob.employerResponsive !== undefined) {
          data.employerResponsive = mosaicJob.employerResponsive;
        }
      }
    }

    if (data.daysOpen == null) {
      console.log(`[SkipThisJob] Mosaic date FAILED (attempts: ${mosaicDateAttempts}, successes: ${mosaicDateSuccesses})`);
    }
  }

  // Final fallback: one last sweep inside the main detail area only
  if (data.daysOpen == null) {
    const lastChance = detailText.match(/(\d+)\+?\s*days?\s*ago/);
    if (lastChance) {
      data.daysOpen = parseInt(lastChance[1], 10);
      console.log('[SkipThisJob] Days open (last-chance detail area):', data.daysOpen);
    }
  }

  // 0.1.8 - Repost detection (text + mosaic)
  if (pageText.includes('reposted') || pageText.includes('originally posted') || pageText.includes('this job was posted')) {
    data.isRepost = true;
    console.log('[SkipThisJob] Repost detected on Indeed');
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

  // 0.1.8 - Detect work arrangement and employment type
  const lowerPage = pageText.toLowerCase();
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

  // 0.1.8 - Improved engagement signal detection
  const engagementPatterns = [
    { pattern: /actively reviewing|reviewing applicants|recently active/i, key: 'actively_reviewing' },
    { pattern: /hiring multiple candidates/i, key: 'hiring_multiple' },
    { pattern: /urgently hiring/i, key: 'urgently_hiring' },
  ];

  for (const { pattern, key } of engagementPatterns) {
    if (pattern.test(pageText)) {
      if (!data.engagementSignals.includes(key)) {
        data.engagementSignals.push(key);
      }
    }
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

  // --- Job ID from URL ---
  const jobIdMatch = window.location.href.match(/jk=([a-f0-9]+)/) ||
                     window.location.href.match(/vjk=([a-f0-9]+)/);
  if (jobIdMatch) data.platformJobId = jobIdMatch[1];

  console.log('[SkipThisJob] Parsed:', JSON.stringify({
    title: data.title, company: data.companyName, days: data.daysOpen,
    salary: data.salaryListed, thirdParty: data.isThirdParty
  }));

  if (data.daysOpen == null) {
    console.warn('[SkipThisJob] ⚠️  STILL NO DATE after all attempts (visible + mosaic + detailText fallback). This job will get +15 unknown age penalty.');
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
  let score = 0;
  const signals = [];
  const isHighTurnover = listing.title && HIGH_TURNOVER_PATTERNS.some(p => p.test(listing.title));

  // === INDEED PLATFORM BASELINE ===
  score += 10;

  // === POSTING AGE (0.1.8 curve) ===
  let agePenalty = 0;

  if (listing.daysOpen != null) {
    if (listing.daysOpen <= 2) {
      agePenalty = -8;
      signals.push('Posted in last 48 hours — highest visibility window');
    } else if (listing.daysOpen <= 7) {
      agePenalty = (listing.daysOpen - 2) * 2;
    } else if (listing.daysOpen <= 14) {
      agePenalty = 10 + (listing.daysOpen - 7) * 3;
    } else if (listing.daysOpen <= 21) {
      agePenalty = 31 + (listing.daysOpen - 14) * 4;
    } else if (listing.daysOpen <= 30) {
      agePenalty = 59 + (listing.daysOpen - 21) * 5;
    } else {
      agePenalty = 104 + (listing.daysOpen - 30) * 6;
    }
  } else {
    // 0.1.8 - Significantly heavier penalty for unknown posting age
    // (we now have good structured data via mosaic in most cases)
    agePenalty = 15;
    signals.push('Posting age unknown');
  }
  if (isHighTurnover) agePenalty = Math.round(agePenalty * 0.4);
  score += agePenalty;

  if (listing.daysOpen > 2) {
    signals.push(`Open ${listing.daysOpen} days`);
  }

  // === REPOST ===
  let repostPenalty = 0;
  if (listing.isRepost) {
    repostPenalty = 20;
    signals.push('Recycled listing — marked as reposted');
    signals.push('High Volume Repost');
  }
  if (isHighTurnover) repostPenalty = Math.round(repostPenalty * 0.4);
  score += repostPenalty;

  // === SALARY ===
  if (!listing.salaryListed) {
    score += 5;
    signals.push('No salary listed');
  }

  // === THIRD PARTY ===
  if (listing.isThirdParty) {
    score += 12;
    signals.push('Middleman — staffing agency or job board');
  }

  // === EMPLOYER RESPONSIVENESS ===
  if (listing.employerResponsive) {
    score -= 5;
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
      score -= 3;
    }
  }

  // === DESCRIPTION QUALITY ===
  if (listing.description) {
    const vagueness = analyzeDescriptionVagueness(listing.description);
    if (vagueness >= 0.65) {
      score += 11;
      signals.push('Vague or generic description');
    } else if (vagueness >= 0.45) {
      score += 6;
      signals.push('Some generic language in description');
    } else if (vagueness <= 0.15) {
      score -= 3;
      signals.push('Detailed, specific job description');
    }
    if (listing.descriptionLength < 280) {
      score += 5;
      signals.push('Very short job description');
    }
  } else {
    score += 7;
    signals.push('No description available');
  }

  // === SENIORITY MISMATCH ===
  if (listing.seniorityMismatch || detectSeniorityMismatch(listing.title || '', listing.description || '')) {
    score += 13;
    signals.push('⚠️ Seniority mismatch — title and requirements conflict');
  }

  // === ENGAGEMENT SIGNALS ===
  if (listing.activelyReviewing) {
    score -= 8;
    signals.push('✓ Employer actively reviewing applications');
  } else if (listing.daysOpen != null && listing.daysOpen >= 14) {
    score += 10;
    signals.push('No active review signals on older listing');
  }

  // === 0.1.8: STRONG COMBO PENALTIES (adapted for Indeed) ===
  const isOld = listing.daysOpen >= 14;
  const missingBasics = !listing.salaryListed && !listing.employerResponsive && !listing.activelyReviewing;

  if (isOld && missingBasics) {
    score += 24;
    signals.push('Stale posting with multiple missing basics — low effort or ghost risk');
  }

  if (listing.daysOpen >= 30 && !listing.activelyReviewing) {
    score += 14;
    signals.push('30+ days old with no active review signals — very low chance');
  }

  if (listing.daysOpen >= 30 && !listing.activelyReviewing && 
      !listing.employerResponsive && !listing.salaryListed) {
    score += 12;
    signals.push('🚩 Stale listing: old, no engagement, no salary — classic dead end');
  }

  // === HIGH TURNOVER ROLE ===
  if (isHighTurnover) {
    signals.push('⚡ High turnover role — expect frequent reposting');
  }

  score = Math.min(100, Math.max(0, score));

  let label = 'low';
  if (score >= 75) label = 'very_high';
  else if (score >= 55) label = 'high';
  else if (score >= 35) label = 'moderate';

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
      ${backendData && backendData.totalReports > 0 ? `
        <div class="ghost-detector-community" style="background: #fff3e0; padding: 6px 10px; border-radius: 6px; border-left: 3px solid #ff9800;">
          📊 ${backendData.live 
            ? `${backendData.totalReports} recent community reports` 
            : `${backendData.totalReports} other users have flagged this employer`}
        </div>
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
      <div id="ghost-thanks" class="ghost-detector-community" style="display: none; color: #2e7d32; background: #e8f5e9; padding: 8px 10px; border-radius: 6px; margin-top: 8px; font-size: 12px;"></div>
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
        // Show thank you message
        const thanks = document.getElementById('ghost-thanks');
        if (thanks) {
          thanks.textContent = '🙏 Thanks for helping the community! Your anonymous report helps other job seekers.';
          thanks.style.display = 'block';
        }
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

// Temporary counters for 0.1.8 testing of mosaic date extraction
let mosaicDateAttempts = 0;
let mosaicDateSuccesses = 0;
window.SkipThisJob_MosaicStats = { attempts: 0, successes: 0 }; // easy to inspect in console

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

  // Wait for page to render (Indeed is slow — date/Hiring Insights often appears late)
  await new Promise(resolve => setTimeout(resolve, 2300));

  const listing = await parseIndeedListing();
  if (!listing.title || !listing.companyName) {
    console.log('[SkipThisJob] Could not parse Indeed listing, skipping');
    isProcessing = false;
    return;
  }

  // Store current listing data for reliable Apply tracking (0.1.8)
  currentListingData = {
    ...listing,
    userClickedApply: false,
  };

  // Passively track listing metadata + new signals (0.1.8)
  chrome.runtime.sendMessage({
    type: 'TRACK_LISTING',
    listingData: {
      companyName: listing.companyName,
      jobTitle: listing.title,
      platform: 'indeed',
      platformJobId: listing.platformJobId,
      location: listing.location,
      salaryListed: listing.salaryListed,
      isRepost: listing.isRepost,
      daysOpen: listing.daysOpen,
      // New 0.1.8 signals
      engagementSignals: listing.engagementSignals,
      employerResponseTime: listing.employerResponseTime,
      userClickedApply: listing.userClickedApply,
      workArrangement: listing.workArrangement,
      employmentType: listing.employmentType,
    },
  });

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
    if (currentListingData && currentListingData.platformJobId === currentJobId) {
      currentListingData.userClickedApply = true;

      chrome.runtime.sendMessage({
        type: 'TRACK_LISTING',
        listingData: {
          ...currentListingData,
          userClickedApply: true,
        },
      });
    } else {
      chrome.runtime.sendMessage({
        type: 'USER_CLICKED_APPLY',
        platform: 'indeed',
        url: window.location.href,
      });
    }
  }
}, true);

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
