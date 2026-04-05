// ============================================================
// Ghost Job Scoring Engine
// ============================================================
// Computes a 0-100 ghost risk score for an employer or
// individual listing based on weighted signals.
//
// Used in two contexts:
//   1. Real-time heuristic scoring (extension-side, no backend)
//   2. Backend employer-level scoring (aggregated signals)
// ============================================================

// ----- SIGNAL WEIGHTS -----
// These sum to roughly 100 at maximum but the final score
// is clamped to 0-100. Weights were tuned to penalize the
// strongest ghost indicators most heavily.

const WEIGHTS = {
  // Listing-level signals (heuristic, no backend needed)
  POSTING_AGE:              15,   // 0-15 based on days open
  IS_REPOST:                20,   // binary: platform says "Reposted"
  APPLICANT_SATURATION:     12,   // high applicants relative to age
  NO_SALARY:                 5,   // salary range missing
  NO_HIRING_CONTACT:         5,   // no recruiter/HM shown
  VAGUE_DESCRIPTION:        10,   // heuristic text analysis
  SENIORITY_MISMATCH:        5,   // e.g. "entry level" + "10 years required"

  // Backend / historical signals
  REPOST_FREQUENCY:         20,   // same role reposted N times in 12mo
  DESCRIPTION_IDENTICAL:     8,   // description hash unchanged across reposts
  COMMUNITY_GHOST_REPORTS:  15,   // thumbs-down count
  COMMUNITY_NO_RESPONSE:    12,   // % of outcome reports = "no_response"
  LOW_INTERVIEW_RATE:       10,   // few "interviewed" outcomes vs total

  // Glassdoor enrichment (bonus signals, not required)
  GLASSDOOR_LOW_RATING:      5,   // employer rating < 3.0
  GLASSDOOR_LOW_OFFER_RATE:  8,   // offer rate from interview reviews
};

// ----- MODIFIERS -----
// These reduce the raw score for legitimate patterns

const MODIFIERS = {
  HIGH_TURNOVER_ROLE:       0.40,  // multiply score by this if role matches known high-turnover
  HIGH_TURNOVER_INDUSTRY:   0.60,  // multiply if industry is high-turnover (use per-industry value if available)
  LARGE_COMPANY:            0.80,  // company has 10,000+ employees
  ENTRY_LEVEL:              0.70,  // entry-level / hourly roles
};


// ============================================================
// LISTING-LEVEL SCORING (runs in the extension, no backend)
// ============================================================
// This gives user #1 value on day one with zero community data.

/**
 * @param {Object} listing - Parsed from the DOM
 * @param {string}  listing.title
 * @param {number}  listing.daysOpen         - days since posted
 * @param {boolean} listing.isRepost         - platform shows "Reposted"
 * @param {number}  listing.applicantCount   - estimated applicant count
 * @param {boolean} listing.salaryListed     - salary range shown
 * @param {boolean} listing.hiringContactVisible - recruiter/HM shown
 * @param {string}  listing.description      - full job description text
 * @param {string}  listing.seniorityLevel   - 'entry', 'mid', 'senior', 'director', 'vp', 'c_suite'
 *
 * @returns {{ score: number, label: string, signals: string[] }}
 */
export function scoreListingHeuristic(listing) {
  let score = 0;
  const signals = [];

  // --- Posting age ---
  if (listing.daysOpen != null) {
    if (listing.daysOpen >= 60) {
      score += WEIGHTS.POSTING_AGE;
      signals.push(`Open ${listing.daysOpen} days`);
    } else if (listing.daysOpen >= 30) {
      score += WEIGHTS.POSTING_AGE * 0.6;
      signals.push(`Open ${listing.daysOpen} days`);
    } else if (listing.daysOpen >= 14) {
      score += WEIGHTS.POSTING_AGE * 0.2;
    }
  }

  // --- Repost label ---
  if (listing.isRepost) {
    score += WEIGHTS.IS_REPOST;
    signals.push('Marked as reposted');
  }

  // --- Applicant saturation ---
  if (listing.applicantCount != null && listing.daysOpen != null && listing.daysOpen > 0) {
    const applicantsPerDay = listing.applicantCount / listing.daysOpen;
    if (listing.applicantCount >= 500) {
      score += WEIGHTS.APPLICANT_SATURATION;
      signals.push(`${listing.applicantCount}+ applicants`);
    } else if (listing.applicantCount >= 200) {
      score += WEIGHTS.APPLICANT_SATURATION * 0.5;
      signals.push(`${listing.applicantCount}+ applicants`);
    }
  }

  // --- No salary ---
  if (!listing.salaryListed) {
    score += WEIGHTS.NO_SALARY;
    signals.push('No salary listed');
  }

  // --- No hiring contact ---
  if (listing.hiringContactVisible === false) {
    score += WEIGHTS.NO_HIRING_CONTACT;
    signals.push('No hiring contact shown');
  }

  // --- Vague description analysis ---
  if (listing.description) {
    const vagueScore = analyzeDescriptionVagueness(listing.description);
    if (vagueScore >= 0.7) {
      score += WEIGHTS.VAGUE_DESCRIPTION;
      signals.push('Vague or generic description');
    } else if (vagueScore >= 0.4) {
      score += WEIGHTS.VAGUE_DESCRIPTION * 0.4;
    }
  }

  // --- Seniority mismatch ---
  if (listing.description && listing.seniorityLevel) {
    if (detectSeniorityMismatch(listing.title, listing.description, listing.seniorityLevel)) {
      score += WEIGHTS.SENIORITY_MISMATCH;
      signals.push('Seniority mismatch in requirements');
    }
  }

  // --- Apply modifiers ---
  const isHighTurnover = isHighTurnoverRole(listing.title);
  const isEntry = listing.seniorityLevel === 'entry';

  if (isHighTurnover) {
    score *= MODIFIERS.HIGH_TURNOVER_ROLE;
    if (signals.length > 0) signals.push('Adjusted: common high-turnover role');
  }
  if (isEntry && !isHighTurnover) {
    score *= MODIFIERS.ENTRY_LEVEL;
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  return {
    score,
    label: scoreToLabel(score),
    signals,
  };
}


// ============================================================
// EMPLOYER-LEVEL SCORING (runs on backend, uses all data)
// ============================================================

/**
 * @param {Object} employer
 * @param {Object} employer.repostData       - from repost_patterns table
 * @param {Object} employer.communityData    - aggregated community reports
 * @param {Object} employer.glassdoorData    - enrichment from Glassdoor
 * @param {Object} employer.companyMeta      - size, industry, etc.
 *
 * @returns {{ score: number, label: string, signals: string[], breakdown: Object }}
 */
export function scoreEmployer(employer) {
  let score = 0;
  const signals = [];
  const breakdown = {};

  const { repostData, communityData, glassdoorData, companyMeta } = employer;

  // --- Repost frequency ---
  if (repostData) {
    const worstRepost = repostData.maxOccurrenceCount || 0;
    if (worstRepost >= 6) {
      const pts = WEIGHTS.REPOST_FREQUENCY;
      score += pts;
      breakdown.repostFrequency = pts;
      signals.push(`Worst role reposted ${worstRepost}x in 12 months`);
    } else if (worstRepost >= 4) {
      const pts = WEIGHTS.REPOST_FREQUENCY * 0.6;
      score += pts;
      breakdown.repostFrequency = pts;
      signals.push(`Role reposted ${worstRepost}x in 12 months`);
    } else if (worstRepost >= 3) {
      const pts = WEIGHTS.REPOST_FREQUENCY * 0.3;
      score += pts;
      breakdown.repostFrequency = pts;
    }

    // Identical descriptions across reposts
    if (repostData.descriptionsIdentical) {
      score += WEIGHTS.DESCRIPTION_IDENTICAL;
      breakdown.descIdentical = WEIGHTS.DESCRIPTION_IDENTICAL;
      signals.push('Identical description across reposts');
    }
  }

  // --- Community ghost reports ---
  if (communityData) {
    const reportCount = communityData.totalGhostFlags || 0;
    if (reportCount >= 20) {
      score += WEIGHTS.COMMUNITY_GHOST_REPORTS;
      breakdown.communityFlags = WEIGHTS.COMMUNITY_GHOST_REPORTS;
      signals.push(`${reportCount} community ghost reports`);
    } else if (reportCount >= 10) {
      score += WEIGHTS.COMMUNITY_GHOST_REPORTS * 0.6;
      breakdown.communityFlags = WEIGHTS.COMMUNITY_GHOST_REPORTS * 0.6;
      signals.push(`${reportCount} community ghost reports`);
    } else if (reportCount >= 3) {
      score += WEIGHTS.COMMUNITY_GHOST_REPORTS * 0.2;
      breakdown.communityFlags = WEIGHTS.COMMUNITY_GHOST_REPORTS * 0.2;
    }

    // No-response rate from outcomes
    const totalOutcomes = communityData.totalOutcomeReports || 0;
    const noResponseCount = communityData.noResponseCount || 0;
    if (totalOutcomes >= 5) {
      const noResponseRate = noResponseCount / totalOutcomes;
      if (noResponseRate >= 0.8) {
        score += WEIGHTS.COMMUNITY_NO_RESPONSE;
        breakdown.noResponseRate = WEIGHTS.COMMUNITY_NO_RESPONSE;
        signals.push(`${Math.round(noResponseRate * 100)}% of applicants never heard back`);
      } else if (noResponseRate >= 0.5) {
        score += WEIGHTS.COMMUNITY_NO_RESPONSE * 0.5;
        breakdown.noResponseRate = WEIGHTS.COMMUNITY_NO_RESPONSE * 0.5;
      }
    }

    // Low interview rate
    const interviewedCount = communityData.interviewedCount || 0;
    if (totalOutcomes >= 10) {
      const interviewRate = interviewedCount / totalOutcomes;
      if (interviewRate < 0.05) {
        score += WEIGHTS.LOW_INTERVIEW_RATE;
        breakdown.lowInterviewRate = WEIGHTS.LOW_INTERVIEW_RATE;
        signals.push(`<5% of tracked applicants got interviews`);
      } else if (interviewRate < 0.15) {
        score += WEIGHTS.LOW_INTERVIEW_RATE * 0.4;
        breakdown.lowInterviewRate = WEIGHTS.LOW_INTERVIEW_RATE * 0.4;
      }
    }
  }

  // --- Glassdoor enrichment (only if data exists) ---
  if (glassdoorData) {
    if (glassdoorData.rating != null && glassdoorData.rating < 3.0) {
      score += WEIGHTS.GLASSDOOR_LOW_RATING;
      breakdown.glassdoorRating = WEIGHTS.GLASSDOOR_LOW_RATING;
      signals.push(`Glassdoor rating: ${glassdoorData.rating}/5`);
    }

    if (glassdoorData.offerRate != null && glassdoorData.offerRate < 0.20) {
      score += WEIGHTS.GLASSDOOR_LOW_OFFER_RATE;
      breakdown.glassdoorOfferRate = WEIGHTS.GLASSDOOR_LOW_OFFER_RATE;
      signals.push(`Only ${Math.round(glassdoorData.offerRate * 100)}% of Glassdoor interviewees got offers`);
    }
  }

  // --- Apply modifiers ---
  if (companyMeta) {
    if (companyMeta.isHighTurnoverIndustry && companyMeta.industryModifier) {
      score *= companyMeta.industryModifier;
      signals.push('Adjusted: high-turnover industry');
    } else if (companyMeta.isHighTurnoverIndustry) {
      score *= MODIFIERS.HIGH_TURNOVER_INDUSTRY;
      signals.push('Adjusted: high-turnover industry');
    }

    if (companyMeta.employeeCount >= 10000) {
      score *= MODIFIERS.LARGE_COMPANY;
    }
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  return {
    score,
    label: scoreToLabel(score),
    signals,
    breakdown,
  };
}


// ============================================================
// COMBINED SCORE (extension + backend)
// ============================================================
// When the extension gets a backend response, merge the
// real-time heuristic score with the historical employer score.

/**
 * @param {number} heuristicScore  - from scoreListingHeuristic
 * @param {number} employerScore   - from backend scoreEmployer
 * @param {string[]} heuristicSignals
 * @param {string[]} employerSignals
 *
 * @returns {{ score: number, label: string, signals: string[] }}
 */
export function combinedScore(heuristicScore, employerScore, heuristicSignals = [], employerSignals = []) {
  // Weight: 40% listing heuristic, 60% employer historical
  // If no employer data, 100% heuristic
  let score;
  if (employerScore == null) {
    score = heuristicScore;
  } else {
    score = Math.round(heuristicScore * 0.4 + employerScore * 0.6);
  }

  score = Math.min(100, Math.max(0, score));

  // Deduplicate and merge signals
  const allSignals = [...new Set([...heuristicSignals, ...employerSignals])];

  return {
    score,
    label: scoreToLabel(score),
    signals: allSignals,
  };
}


// ============================================================
// HELPER FUNCTIONS
// ============================================================

function scoreToLabel(score) {
  if (score >= 75) return 'very_high';
  if (score >= 50) return 'high';
  if (score >= 25) return 'moderate';
  return 'low';
}

// High-turnover role detection via keyword matching
const HIGH_TURNOVER_PATTERNS = [
  /\bbarista\b/i,
  /\bcrew\s*member\b/i,
  /\bteam\s*member\b/i,
  /\bcashier\b/i,
  /\bsales\s*associate\b/i,
  /\bretail\s*associate\b/i,
  /\bstore\s*(associate|clerk)\b/i,
  /\bwarehouse\s*(associate|worker)\b/i,
  /\bdelivery\s*driver\b/i,
  /\bpackage\s*handler\b/i,
  /\bregistered\s*nurse\b/i,
  /\b(lpn|lvn|cna)\b/i,
  /\bnursing\s*assistant\b/i,
  /\bhome\s*health\s*aide\b/i,
  /\bcaregiver\b/i,
  /\bsecurity\s*(officer|guard)\b/i,
  /\b(janitor|custodian)\b/i,
  /\bhousekeeper\b/i,
  /\bfront\s*desk\b/i,
  /\b(dishwasher|line\s*cook|server|bartender)\b/i,
  /\bcall\s*center\b/i,
  /\bcustomer\s*service\s*rep/i,
  /\b(cdl|truck)\s*driver\b/i,
  /\bforklift\s*operator\b/i,
  /\b(picker|packer|stocker)\b/i,
  /\bphlebotomist\b/i,
  /\bmedical\s*assistant\b/i,
  /\bsubstitute\s*teacher\b/i,
];

function isHighTurnoverRole(title) {
  if (!title) return false;
  return HIGH_TURNOVER_PATTERNS.some(pattern => pattern.test(title));
}

// Description vagueness analysis
function analyzeDescriptionVagueness(text) {
  if (!text) return 0;

  let vagueIndicators = 0;
  let totalChecks = 0;

  const vaguePatterns = [
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

  // Check for vague buzzwords
  totalChecks += vaguePatterns.length;
  vaguePatterns.forEach(p => {
    if (p.test(text)) vagueIndicators++;
  });

  // Check for specificity indicators (reduce vagueness)
  const specificPatterns = [
    /\b(python|java|javascript|react|angular|vue|node|sql|aws|gcp|azure)\b/i,  // tech specifics
    /\b(salesforce|hubspot|marketo|tableau|jira|confluence)\b/i,                // tool specifics
    /\breport(s|ing)?\s+to\b/i,                                                 // org structure
    /\b(team of|department of)\s+\d+/i,                                          // team size
    /\$[\d,]+/i,                                                                 // dollar amounts
    /\b\d+\+?\s*years?\b/i,                                                      // specific experience
  ];

  totalChecks += specificPatterns.length;
  specificPatterns.forEach(p => {
    if (p.test(text)) vagueIndicators--; // specificity reduces vagueness
  });

  // Short descriptions are suspicious for non-entry roles
  if (text.length < 500) vagueIndicators += 2;
  totalChecks += 2;

  // Kitchen-sink requirements (too many different technologies listed)
  const techMatches = text.match(/\b(python|java|javascript|react|angular|vue|node|sql|aws|gcp|azure|docker|kubernetes|terraform|go|rust|c\+\+|ruby|php|swift|kotlin|scala|hadoop|spark|kafka|redis|mongodb|postgresql|mysql|elasticsearch|graphql|rest\s*api|ci\/cd|jenkins|github\s*actions)\b/gi);
  if (techMatches && new Set(techMatches.map(t => t.toLowerCase())).size > 15) {
    vagueIndicators += 3;
    totalChecks += 3;
  }

  return Math.max(0, Math.min(1, vagueIndicators / Math.max(totalChecks, 1)));
}

// Seniority mismatch detection
function detectSeniorityMismatch(title, description, seniorityLevel) {
  if (!title || !description) return false;

  const entrySignals = /\b(entry[- ]level|junior|associate|intern|graduate)\b/i;
  const seniorRequirements = /\b(10|[1-9]\d)\+?\s*years?\b/i;

  // Entry level title but senior experience requirements
  if (entrySignals.test(title) && seniorRequirements.test(description)) {
    return true;
  }

  // Senior title but "0-2 years" requirement (suspicious lowballing)
  const juniorRequirements = /\b[0-2]\+?\s*years?\b/i;
  const seniorTitleSignals = /\b(senior|lead|principal|director|vp|vice\s*president|head\s+of)\b/i;
  if (seniorTitleSignals.test(title) && juniorRequirements.test(description)) {
    return true;
  }

  return false;
}
