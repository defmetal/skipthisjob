// ============================================================
// Skip This Job — shared helpers (LinkedIn + Indeed content scripts)
// Loaded first in the same isolated world as the platform script.
// Also runnable under Node for unit tests (module.exports).
// ============================================================
(function (root) {
  const api = {};

  const ENGAGEMENT_ACTIVELY_REVIEWING = 'actively_reviewing';

  const LABEL_TEXT = {
    low: 'Worth Applying',
    moderate: 'Proceed with Caution',
    high: 'Likely a Waste of Time',
    very_high: 'Skip This Job',
  };

  const LABEL_COLORS = {
    low: { bg: '#e8f5e9', border: '#4caf50', text: '#2e7d32', icon: '✅' },
    moderate: { bg: '#fff3e0', border: '#ff9800', text: '#e65100', icon: '⚠️' },
    high: { bg: '#fce4ec', border: '#f44336', text: '#c62828', icon: '🚩' },
    very_high: { bg: '#f3e5f5', border: '#9c27b0', text: '#6a1b9a', icon: '👻' },
  };

  const BRAND_FOOTER_HTML =
    'Skip This Job by <a href="https://vibelabsmarketing.com" target="_blank" rel="noopener">Vibe Labs Marketing</a> · <a href="https://skipthisjob.com" target="_blank" rel="noopener">skipthisjob.com</a>';

  // --- Identity ----------------------------------------------------------

  /**
   * Indeed uses both `jk=` (viewjob / some SERPs) and `vjk=` (right-pane
   * search). Treat them as the same job key.
   */
  function extractIndeedJobKey(url) {
    if (!url) return null;
    const match = String(url).match(/[?&#](?:vjk|jk)=([a-f0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
  }

  function extractLinkedInJobId(url) {
    if (!url) return null;
    const match = String(url).match(/currentJobId=(\d+)/) ||
                  String(url).match(/\/jobs\/view\/(\d+)/);
    return match ? match[1] : null;
  }

  // --- Engagement --------------------------------------------------------

  function hasEngagementSignal(listing, key) {
    if (!listing) return false;
    const signals = listing.engagementSignals;
    return Array.isArray(signals) && signals.indexOf(key) !== -1;
  }

  /**
   * True when the page (or a boolean leftover) says the employer is
   * actively reviewing. Parsers store snake_case keys in engagementSignals;
   * older scoreLocally() looked at camelCase `activelyReviewing` and never
   * saw the credit.
   */
  function isActivelyReviewing(listing) {
    if (!listing) return false;
    if (listing.activelyReviewing === true) return true;
    return hasEngagementSignal(listing, ENGAGEMENT_ACTIVELY_REVIEWING);
  }

  /**
   * “Actively reviewing” on LinkedIn can linger for months. Full -8 is
   * fine on fresh posts; on 60–120+ day listings it must not erase age
   * floors (Hilton / Baton calibration).
   *
   *   <60d   −8
   *   60–89  −3
   *   90–119 −2
   *   ≥120   −0
   */
  function engagementCreditForAge(daysOpen) {
    if (daysOpen == null || Number.isNaN(Number(daysOpen))) return 8;
    const days = Number(daysOpen);
    if (days >= 120) return 0;
    if (days >= 90) return 2;
    if (days >= 60) return 3;
    return 8;
  }

  /**
   * True when a parser actually read the review/hiring-insights area.
   * `engagementParsed: false` means the badge was not on the page we could
   * see — that must add 0, even if `activelyReviewing` defaulted to false.
   * Search cards set the flag false: a missing "Actively reviewing" chip
   * on a card is unparsed, not a confirmed absence.
   * Callers that pass an `engagementSignals` array without the flag are
   * treated as having looked (unit tests and older detail payloads).
   */
  function engagementWasParsed(listing) {
    if (!listing) return false;
    if (listing.engagementParsed === false) return false;
    if (listing.engagementParsed === true) return true;
    return Array.isArray(listing.engagementSignals);
  }

  /**
   * Apply the shared engagement credit / stale-no-review penalty.
   * Mutates `signals` and returns the updated numeric score plus a boolean
   * the Indeed combo penalties can reuse.
   * Unparsed engagement adds 0 and, on a detail score, an "unknown" chip.
   */
  function applyEngagementScoring(listing, score, signals) {
    const reviewing = isActivelyReviewing(listing);
    const out = Array.isArray(signals) ? signals : [];
    const days = listing && listing.daysOpen;
    const parsed = engagementWasParsed(listing);

    if (reviewing) {
      const credit = engagementCreditForAge(days);
      score -= credit;
      if (credit <= 0) {
        out.push('“Actively reviewing” on a 120+ day listing — not treated as fresh intent');
      } else if (days != null && Number(days) >= 60) {
        out.push('✓ Employer actively reviewing (capped — badge can linger on old posts)');
      } else {
        out.push('✓ Employer actively reviewing applications');
      }
    } else if (parsed && listing && listing.daysOpen != null && listing.daysOpen >= 14) {
      score += 10;
      out.push('No active review signals on older listing');
    } else if (listing && listing.engagementParsed === false) {
      out.push('Engagement unknown');
    }

    return { score, signals: out, activelyReviewing: reviewing, engagementParsed: parsed };
  }

  // --- Text helpers ------------------------------------------------------

  function hashDescription(text) {
    if (!text || typeof text !== 'string') return null;
    const cleaned = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;
    // FNV-1a 32-bit — stable, no SubtleCrypto needed in content scripts.
    let h = 2166136261;
    for (let i = 0; i < cleaned.length; i++) {
      h ^= cleaned.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function normalizeTitle(title) {
    if (!title) return '';
    return String(title).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function labelForScore(score) {
    if (score >= 75) return 'very_high';
    if (score >= 55) return 'high';
    if (score >= 35) return 'moderate';
    return 'low';
  }

  // --- Shared listing heuristic (0.2.2) ---------------------------------
  // LinkedIn detail, Indeed detail, and SERP badges share this path so a
  // 90-day card cannot badge 16–18 while the overlay says 2.
  //
  // Product bias (Austin, lock for 0.2.2): prefer harsher over more
  // lenient. False positives (flagging a maybe) beat false negatives
  // (calling a stale listing “Worth Applying”). Do not soften floors
  // to protect slow-hiring employers. Apply energy is scarce.
  //
  // Age floors (applied AFTER discounts, and again after backend blend).
  // High end of the suggested 40/65/80 ranges — 90–150 day Easy Apply
  // posts still looked soft at 65/80 vs harsh ~80/~90:
  //   ≥60 days  → minimum 50  (Proceed with Caution — not Worth Applying)
  //   ≥90 days  → minimum 75  (Skip This Job)
  //   ≥120 days → minimum 88  (Skip This Job, Hilton/Baton band)
  // Easy Apply + 100+ applicants are applied AFTER the floor so they
  // cannot be swallowed (a crowded 90-day card must feel worse than a
  // bare 90-day card).

  const AGE_FLOORS = [
    { minDays: 120, floor: 88 },
    { minDays: 90, floor: 75 },
    { minDays: 60, floor: 50 },
  ];

  function ageFloorForDays(daysOpen) {
    if (daysOpen == null || Number.isNaN(Number(daysOpen))) return 0;
    const days = Number(daysOpen);
    for (let i = 0; i < AGE_FLOORS.length; i++) {
      if (days >= AGE_FLOORS[i].minDays) return AGE_FLOORS[i].floor;
    }
    return 0;
  }

  function enforceAgeFloor(score, daysOpen, signals) {
    const floor = ageFloorForDays(daysOpen);
    const out = Array.isArray(signals) ? signals : [];
    if (floor > 0 && score < floor) {
      out.push('Age floor: open ' + daysOpen + ' days → minimum ghost risk ' + floor);
      return { score: floor, signals: out, applied: true, floor: floor };
    }
    return { score: score, signals: out, applied: false, floor: floor };
  }

  /**
   * Additive age points. Caps around 25 at 90d (matches the documented
   * 0.1.x comment). Recency credit is negative in the first 48 hours.
   * Unknown age is 0 — a date the page never rendered is not evidence.
   */
  function ageContribution(daysOpen, opts) {
    const options = opts || {};
    let delta = 0;
    const signals = [];
    if (daysOpen == null || Number.isNaN(Number(daysOpen))) {
      if (options.noteUnknown) signals.push('Posting age unknown');
      return { delta: 0, signals: signals };
    }
    const days = Number(daysOpen);
    const recency = options.recencyCredit != null ? options.recencyCredit : 10;

    if (days <= 2) {
      delta = -recency;
      signals.push('Posted in last 48 hours — highest visibility window');
    } else if (days <= 7) {
      delta = Math.round((days - 2) * 0.8);
    } else if (days <= 14) {
      delta = 4 + Math.round((days - 7) * (4 / 7));
    } else if (days <= 30) {
      delta = 8 + Math.round((days - 14) * (7 / 16));
    } else if (days <= 60) {
      delta = 15 + Math.round((days - 30) * (5 / 30));
    } else if (days <= 90) {
      delta = 20 + Math.round((days - 60) * (5 / 30));
    } else {
      delta = 25;
    }

    if (options.isHighTurnover) delta = Math.round(delta * 0.4);
    if (days > 2) signals.push('Open ' + days + ' days');
    return { delta: delta, signals: signals };
  }

  function applicantContribution(count, isHighTurnover) {
    if (count == null) return { delta: 0, signal: null };
    let delta = 0;
    let signal = null;
    if (count >= 500) {
      delta = 15;
      signal = count + '+ applicants — virtually zero chance of being seen';
    } else if (count >= 200) {
      delta = 10;
      signal = count + '+ applicants — your resume is in a large pile';
    } else if (count >= 100) {
      delta = 8;
      signal = count + '+ applicants — crowded listing';
    }
    if (isHighTurnover) delta = Math.round(delta * 0.6);
    return { delta: delta, signal: signal };
  }

  function hasBrokenTemplate(text) {
    if (!text || typeof text !== 'string') return false;
    return /\{:[a-zA-Z_]\w*\}|\{\{[a-zA-Z_]\w*\}\}|\{(?:companyName|jobTitle|company|location)\}|\[\s*(?:company(?:\s*name)?|job\s*title|insert\s+\w+)\s*\]/i.test(text);
  }

  function hasWorkArrangementConflict(listing) {
    if (!listing) return false;
    if (listing.workArrangementConflict === true) return true;
    const arr = listing.workArrangement;
    const text = String(listing.description || '').toLowerCase();
    if (!arr || !text) return false;
    const descRemote = /fully remote|100%\s*remote|remote[ -]only|work from home/.test(text);
    const descOnsite = /on-?site only|in-?office only|must (be|work) on-?site/.test(text);
    const descHybrid = /\bhybrid\b/.test(text);
    if (arr === 'onsite' && descRemote) return true;
    if (arr === 'remote' && descOnsite) return true;
    if (arr === 'hybrid' && descOnsite && descRemote) return true;
    if (arr === 'onsite' && descHybrid && /remote/.test(text)) return true;
    return false;
  }

  /**
   * Description quality. Vague copy still adds risk. A specific JD is
   * only −1 (was −3/−4) so it cannot dominate an old listing to 0–12.
   */
  function applyDescriptionQuality(score, signals, vagueness, opts) {
    const options = opts || {};
    const out = Array.isArray(signals) ? signals : [];
    if (vagueness == null || Number.isNaN(Number(vagueness))) {
      return { score: score, signals: out };
    }
    if (vagueness >= 0.65) {
      score += options.vagueHigh != null ? options.vagueHigh : 12;
      out.push('Vague or generic description');
    } else if (vagueness >= 0.45) {
      score += options.vagueMid != null ? options.vagueMid : 7;
      out.push('Some generic language in description');
    } else if (vagueness <= 0.15 && !options.suppressDetailed) {
      // Helper default is 0. scoreListingSignals passes detailedCredit: 1
      // so a specific JD is −1 on the shipped job-page path (public copy).
      // A length verdict (very short / short) already occupies the one
      // description-length chip, so the detailed credit is not also shown.
      const credit = options.detailedCredit != null ? options.detailedCredit : 0;
      score -= credit;
      out.push('Detailed, specific job description');
    }
    return { score: score, signals: out };
  }

  /**
   * After-floor tax so old + Easy Apply + high applicants stay costly
   * to ignore instead of collapsing onto the same age floor.
   */
  function applyLowIntentTax(score, listing, signals) {
    const row = listing || {};
    const days = row.daysOpen;
    const out = Array.isArray(signals) ? signals : [];
    if (days == null || Number.isNaN(Number(days))) {
      return { score: score, signals: out };
    }
    // Idempotent — blendGhostScore may re-run this after a backend pull-down.
    const alreadyEasy = out.some(function (s) { return /Easy Apply on a \d+\+ day/.test(s); });
    const alreadyCrowd = out.some(function (s) { return /with 100\+ applicants/.test(s); });
    if (row.easyApply && !alreadyEasy) {
      if (days >= 120) {
        score += 12;
        out.push('Easy Apply on a 120+ day listing — apply energy is almost certainly wasted');
      } else if (days >= 90) {
        score += 10;
        out.push('Easy Apply on a 90+ day listing — low-intent signal');
      } else if (days >= 60) {
        score += 8;
        out.push('Easy Apply on a 60+ day listing — low-intent signal');
      }
    }
    if (row.applicantCount >= 100 && !alreadyCrowd) {
      if (days >= 120) {
        score += 12;
        out.push('120+ days old with 100+ applicants — crowded dead listing');
      } else if (days >= 90) {
        score += 10;
        out.push('90+ days old with 100+ applicants — crowded stale listing');
      } else if (days >= 60) {
        score += 8;
        out.push('60+ days old with 100+ applicants — low chance of being seen');
      }
    }
    return { score: score, signals: out };
  }

  function finalizeHeuristicScore(score, listing, signals, extras) {
    const extra = extras || {};
    const floored = enforceAgeFloor(score, listing && listing.daysOpen, signals);
    const taxed = applyLowIntentTax(floored.score, listing, floored.signals);
    score = Math.min(100, Math.max(0, Math.round(taxed.score)));
    return {
      score: score,
      label: labelForScore(score),
      signals: taxed.signals,
      isHighTurnover: !!extra.isHighTurnover,
      daysOpen: listing && listing.daysOpen,
      easyApply: !!listing && !!listing.easyApply,
      applicantCount: listing && listing.applicantCount,
    };
  }

  /**
   * Shared listing heuristic used by LinkedIn, Indeed, and SERP badges.
   * `preview: true` skips fields a card cannot observe.
   *
   * 0.2.4: a field that is absent or unparsed adds 0 and, on the detail
   * overlay, an "unknown" chip. Short or vague copy still adds risk when
   * the description text is actually present. Age floors, reposts,
   * applicants, and salaryListed === false (page loaded with no salary)
   * stay.
   */
  function scoreListingSignals(listing, opts) {
    const options = opts || {};
    const row = listing || {};
    const preview = options.preview === true;
    const platform = options.platform || row.platform || 'linkedin';
    const isHighTurnover = options.isHighTurnover === true;
    const signals = [];
    let score = 0;

    const age = ageContribution(row.daysOpen, {
      noteUnknown: !preview,
      recencyCredit: platform === 'indeed' ? 8 : (preview ? 8 : 10),
      isHighTurnover: isHighTurnover,
    });
    score += age.delta;
    for (let i = 0; i < age.signals.length; i++) signals.push(age.signals[i]);

    if (row.isRepost) {
      let repost = 24;
      if (isHighTurnover) repost = Math.round(repost * 0.4);
      score += repost;
      signals.push('Recycled listing — marked as reposted');
    }

    const apps = applicantContribution(row.applicantCount, isHighTurnover);
    if (apps.delta) {
      score += apps.delta;
      signals.push(apps.signal);
    }

    if (preview) {
      if (row.salaryListed === false) score += 4;
      else if (row.salaryListed === true) score -= 2;
    } else if (row.salaryListed === false) {
      score += 5;
      signals.push('No salary listed');
    } else if (row.salaryListed !== true) {
      signals.push('Salary unknown');
    }

    if (row.isThirdParty) {
      score += preview ? 10 : 12;
      signals.push(preview ? 'Staffing / aggregator' : 'Middleman — staffing agency or job board');
    }

    const descText = typeof row.description === 'string' ? row.description.trim() : '';
    // descriptionParsed === false means the parser did not read a description
    // node (a card snippet or an empty pane does not count). Callers that
    // pass description text without the flag are treated as parsed.
    const descriptionParsed = row.descriptionParsed !== false && !!descText;
    if (!preview && !descriptionParsed) {
      signals.push('Job description unknown');
    } else if (!preview && platform === 'linkedin') {
      if (descText.length < 200) {
        score += 12;
        signals.push('Very short job description');
      } else if (descText.length < 500) {
        score += 6;
        signals.push('Short or limited job description');
      }
    } else if (!preview && platform === 'indeed') {
      if (descText.length < 280) {
        score += 5;
        signals.push('Very short job description');
      }
    }

    const lengthVerdict = signals.some(function (s) {
      return s === 'Very short job description' || s === 'Short or limited job description';
    });
    if (!preview && descriptionParsed && options.vagueness != null) {
      const desc = applyDescriptionQuality(score, signals, options.vagueness, {
        vagueHigh: platform === 'indeed' ? 11 : 12,
        vagueMid: platform === 'indeed' ? 6 : 7,
        detailedCredit: 1,
        suppressDetailed: lengthVerdict,
      });
      score = desc.score;
    }

    if (hasBrokenTemplate(row.description) || hasBrokenTemplate(row.title)) {
      score += 10;
      signals.push('Broken template / placeholder text — low-effort listing');
    }

    if (row.responseManagedOffsite) {
      score += 10;
      signals.push('Responses managed off LinkedIn — less accountability');
    }

    if (hasWorkArrangementConflict(row)) {
      score += 8;
      signals.push('Work arrangement contradiction (e.g. remote vs on-site)');
    }

    const engagement = applyEngagementScoring(row, score, signals);
    score = engagement.score;

    if (typeof options.afterShared === 'function') {
      const extra = options.afterShared(score, signals, {
        activelyReviewing: engagement.activelyReviewing,
        engagementParsed: engagement.engagementParsed,
        preview: preview,
      }) || {};
      if (extra.score != null) score = extra.score;
    }

    return finalizeHeuristicScore(score, row, signals, { isHighTurnover: isHighTurnover });
  }

  /**
   * SERP-card score. Same age floors / repost / applicant math as detail;
   * does not invent missing-description or no-contact penalties.
   */
  function scoreListPreview(card) {
    return scoreListingSignals(card || {}, {
      preview: true,
      platform: (card && card.platform) || 'preview',
      isHighTurnover: false,
    });
  }

  function normalizeAgeText(text) {
    return String(text || '')
      .replace(/[\u00a0\u202f\u2007\u2009\u200a\u2060]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  }

  /**
   * Parse a relative posting age. Months/weeks/days are checked BEFORE
   * freshness phrases so a LinkedIn detail dump that also contains
   * "2 hours ago" (sidebar, hiring-team activity) cannot zero out
   * "5 months ago" in the top card.
   *
   * Live 0.2.2 failure: Baton "5 months ago" / First Point "3 months ago"
   * never became daysOpen, so age floors never ran and the overlay
   * stayed 6 Worth Applying.
   */
  function parseRelativeDays(text) {
    if (!text) return null;
    let t = normalizeAgeText(text);
    if (!t) return null;

    // Employer activity is not the posting date. "Employer Active 3 days ago"
    // on a 90-day listing must not collapse the age to 3.
    t = t.replace(/\bemployer\s+active\b[^.]*/g, ' ');
    t = t.replace(/\bactive\s+\d+\+?\s*(?:days?|d|weeks?|wks?|months?|mos?)\s+ago\b/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) return null;

    // LinkedIn header: "San Francisco, CA · 5 months ago · Over 100 applicants"
    let m = t.match(/(\d+)\s*(?:months?|mos\.?|mo)\s+ago/);
    if (m) return parseInt(m[1], 10) * 30;

    m = t.match(/(\d+)\s*w(?:ee)?k?s?\.?\s+ago/);
    if (m) return parseInt(m[1], 10) * 7;

    m = t.match(/(\d+)\+?\s*(?:days?|d)\s+ago/);
    if (m) return parseInt(m[1], 10);

    if (/just posted|posted today|moments? ago/.test(t)) return 0;
    if (/(?:few |a few )?(?:hours?|mins?|minutes?) ago/.test(t)) return 0;
    if (/\byesterday\b/.test(t)) return 1;
    if (/\btoday\b/.test(t) && t.length < 40 && !/employer\s+active/.test(normalizeAgeText(text))) return 0;
    return null;
  }

  /**
   * A dollar amount is a salary only with pay context or a real range.
   * "save $500 on tuition" is not a listed salary.
   */
  function looksLikeSalary(text) {
    if (!text) return false;
    const t = String(text);
    if (/(?:salary|compensation|pay\s*range|base\s*pay)\s*[:\-]?\s*\$[\d,]+/i.test(t)) return true;
    if (/\$[\d,]+(?:\s*[kK])?\s*(?:-|–|to)\s*\$?[\d,]+/.test(t) &&
        /(?:\/|\bper\b|\bk\b|hour|year|\byr\b|\bhr\b|salary|pay|compensation)/i.test(t)) return true;
    if (/\$[\d,]+\s*[kK]\b/.test(t)) return true;
    if (/\$[\d,.]+\s*(?:\/|\bper\b|\ban\b|\ba\b)\s*(?:hour|hr|year|yr)/i.test(t)) return true;
    return false;
  }

  /**
   * Entry title vs an explicit minimum of 5+ years, or a senior title vs
   * an explicit minimum of 0–2 years. A passing mention of "2 years with
   * kubernetes" is not a requirement.
   */
  function detectSeniorityMismatch(title, description) {
    if (!title || !description) return false;
    const entryTitle = /\b(entry[- ]level|junior|associate|intern|graduate)\b/i.test(title);
    const seniorTitle = /\b(senior|lead|principal|director|vp|vice\s*president|head\s+of)\b/i.test(title);
    if (!entryTitle && !seniorTitle) return false;
    const desc = String(description);
    const stated = desc.match(
      /\b(?:minimum|at\s+least|requires?(?:\s+a)?(?:\s+minimum(?:\s+of)?)?)\s+(\d+)\+?\s*years?\b/i
    );
    const statedYears = stated ? parseInt(stated[1], 10) : null;
    const plus = desc.match(/\b(\d+)\+\s*years?\b/i);
    const plusYears = plus ? parseInt(plus[1], 10) : null;
    if (entryTitle) {
      if (statedYears != null && statedYears >= 5) return true;
      if (plusYears != null && plusYears >= 5) return true;
    }
    if (seniorTitle && statedYears != null && statedYears <= 2) return true;
    return false;
  }

  // Explicit alias for tests / LinkedIn header strings.
  function parseLinkedInPostedAge(text) {
    return parseRelativeDays(text);
  }

  function daysOpenFromIso(iso, nowMs) {
    if (!iso) return null;
    const posted = Date.parse(iso);
    if (Number.isNaN(posted)) return null;
    const now = nowMs != null ? nowMs : Date.now();
    const days = Math.round((now - posted) / (1000 * 60 * 60 * 24));
    if (Number.isNaN(days)) return null;
    return Math.max(0, days);
  }

  function parseApplicantCount(text) {
    if (!text) return null;
    const t = String(text);
    // "Be among the first 25 applicants" — the crowd size is the 25, and
    // the generic "N applicants" match would see the same number. One value.
    const first = t.match(/\bbe among the first\s+(\d[\d,]*)/i);
    if (first) {
      const n = parseInt(first[1].replace(/,/g, ''), 10);
      return Number.isNaN(n) ? null : n;
    }
    const m = t.match(/(?:over\s+)?(\d[\d,]*)\+?\s*(?:applicants?|people\s+clicked\s+apply)/i);
    if (!m) return null;
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    return Number.isNaN(n) ? null : n;
  }

  /**
   * Collapse whitespace, nbsp, and bullet separators, and split words that
   * LinkedIn concatenates when the dot is only a CSS separator
   * ("United StatesReposted 2 weeks agoOver 100 people clicked apply").
   */
  function normalizeLinkedInMetadataText(text) {
    let t = String(text || '')
      .replace(/[\u00a0\u202f\u2007\u2009\u200a\u2060]/g, ' ')
      .replace(/[·•・∙⋅\u2022\u2219\u2027\u30fb\u00b7|]/g, ' · ')
      .replace(/([A-Za-z])(?=(?:Reposted|Posted|Over|Be among)\b)/g, '$1 ')
      .replace(/([A-Za-z])(?=\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b)/gi, '$1 ')
      .replace(/\s+/g, ' ')
      .trim();
    return t;
  }

  /**
   * LinkedIn top-card metadata: "City · Reposted 2 weeks ago · Over 100 people clicked apply".
   * Age, repost, and applicants are each read once from the whole line.
   * A missing separator still matches "Reposted 2 weeks ago" inside the text.
   * Location is the place segment, not a second copy of the age.
   */
  function parseLinkedInMetadataLine(text) {
    const raw = normalizeLinkedInMetadataText(text);
    if (!raw) return null;
    const daysOpen = parseRelativeDays(raw);
    const isRepost = /reposted/i.test(raw) ? true : null;
    const applicantCount = parseApplicantCount(raw);
    const parts = raw.split(/\s*·\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    let location = null;
    const separated = raw.indexOf(' · ') !== -1;
    // "On-site" / "Remote" / "Hybrid" sit between the place and the age.
    // The place is the segment next to the age, not a title or company
    // that an ancestor walk concatenated in front of the line.
    const workplaceOnly = /^(?:on-?site|remote|hybrid)$/i;
    function isSignalPart(part) {
      if (!part) return true;
      if (/reposted/i.test(part)) return true;
      if (/^(?:posted|over|be among)\b/i.test(part)) return true;
      if (parseRelativeDays(part) != null) return true;
      if (parseApplicantCount(part) != null) return true;
      return false;
    }
    if (separated) {
      let signalIdx = -1;
      for (let i = 0; i < parts.length; i++) {
        if (isSignalPart(parts[i])) { signalIdx = i; break; }
      }
      const from = signalIdx === -1 ? parts.length - 1 : signalIdx - 1;
      for (let i = from; i >= 0; i--) {
        const part = parts[i];
        if (!part || part.length > 80) continue;
        if (isSignalPart(part)) continue;
        if (workplaceOnly.test(part) && i > 0) continue;
        location = part;
        break;
      }
    } else if (daysOpen != null || isRepost || applicantCount != null) {
      const before = raw.split(/\b(?:reposted|posted)\b/i)[0].replace(/\s+/g, ' ').trim();
      if (before && before.length <= 80 && parseRelativeDays(before) == null && parseApplicantCount(before) == null) {
        location = before;
      }
    }
    if (location == null && daysOpen == null && applicantCount == null && isRepost == null) return null;
    // A bare title has none of the metadata signals. Do not treat it as a place.
    if (!separated && daysOpen == null && applicantCount == null && !isRepost) return null;
    return {
      location: location,
      daysOpen: daysOpen,
      isRepost: isRepost,
      applicantCount: applicantCount,
    };
  }

  /**
   * "Title | Company | LinkedIn" (document.title or og:title).
   * Returns null when the split is ambiguous.
   */
  function parseLinkedInPageTitle(rawTitle) {
    let t = String(rawTitle || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
    if (!t || looksLikeSerpHeading(t)) return null;
    const parts = t.split(/\s*\|\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length < 2) return null;
    if (!parts[0] || !parts[1]) return null;
    return { title: parts[0], companyName: parts[1] };
  }

  /**
   * Card age: prefer visible "N months ago" on the whole card (LinkedIn
   * headers / footers) over a random <time datetime> (hiring-team "3d"
   * was winning and wiping floors).
   */
  function daysOpenFromCard(card, dateEl, fallbackText) {
    const dateNode = dateEl && !isExtensionChromeNode(dateEl) ? dateEl : null;
    const dateText = dateNode ? String(dateNode.textContent || '') : '';
    const blob = [
      fallbackText,
      dateText,
      extensionChromeText(card),
    ].filter(Boolean).join(' · ');
    const fromText = parseRelativeDays(blob);
    if (fromText != null) return fromText;
    // "Today" on a short date node is a posting age. A longer age anywhere
    // on the card already won above, so this cannot zero out "5 months ago".
    if (dateText && dateText.length < 80) {
      const fromDate = parseRelativeDays(dateText);
      if (fromDate != null) return fromDate;
    }

    if (dateEl && dateEl.getAttribute) {
      const iso = daysOpenFromIso(dateEl.getAttribute('datetime'));
      if (iso != null) return iso;
    }
    if (card && card.querySelectorAll) {
      const times = card.querySelectorAll('time[datetime], time');
      for (let i = 0; i < times.length; i++) {
        const fromTime = parseRelativeDays(times[i].textContent);
        if (fromTime != null) return fromTime;
        const iso = daysOpenFromIso(times[i].getAttribute('datetime'));
        if (iso != null) return iso;
      }
    }
    return null;
  }

  // --- Indeed identity + path-consistent listing signals -----------------
  // Search SPA (vjk= mosaic / right pane) and /viewjob?jk= must score the
  // same job key from the same fields. Never let sibling list-card copy
  // or a date-rich neighbor in mosaic win.

  const INDEED_SIGNAL_CACHE_TTL_MS = 30 * 60 * 1000;

  function mosaicJobIdentity(job, pageJobKey, pageTitle, pageCompany) {
    if (!job) return { identity: 0, exactKey: false };
    const thisJobKey = String(job.jobkey || '').toLowerCase();
    const jobTitle = String(job.displayTitle || job.title || '').toLowerCase();
    const jobCompany = String(job.company || '').toLowerCase();
    const title = String(pageTitle || '').toLowerCase();
    const company = String(pageCompany || '').toLowerCase();

    let identity = 0;
    const exactKey = !!(pageJobKey && thisJobKey && thisJobKey === String(pageJobKey).toLowerCase());
    if (exactKey) identity += 100;
    if (title && jobTitle && jobTitle.length >= 8 && title.includes(jobTitle.substring(0, 25))) {
      identity += 35;
    }
    if (company && jobCompany && company.includes(jobCompany)) identity += 15;
    return { identity: identity, exactKey: exactKey };
  }

  /**
   * Pick the mosaic row for the listing being viewed.
   * When a jk/vjk is known, ONLY an exact jobkey match is allowed —
   * the old "URL contains pageJobKey" bonus applied to every row and
   * let a neighbor's pubDate stamp the overlay.
   */
  function pickMosaicJobForListing(jobs, pageJobKey, pageTitle, pageCompany) {
    const list = Array.isArray(jobs) ? jobs : [];
    let best = null;
    let bestScore = -1;

    for (let i = 0; i < list.length; i++) {
      const job = list[i];
      if (!job) continue;
      const ident = mosaicJobIdentity(job, pageJobKey, pageTitle, pageCompany);
      if (pageJobKey) {
        if (!ident.exactKey) continue;
      } else if (ident.identity < 35) {
        continue;
      }
      let score = ident.identity;
      if (job.pubDate || job.createDate || job.formattedRelativeTime) score += 20;
      if (job.formattedRelativeTime) score += 10;
      if (job.pubDate || job.createDate) score += 5;
      if (score > bestScore) {
        bestScore = score;
        best = job;
      }
    }
    return best;
  }

  function flattenMosaicJobs(snapshot) {
    const out = [];
    const seen = {};
    const add = function (job) {
      if (!job) return;
      const key = String(job.jobkey || '').toLowerCase();
      if (key) {
        if (seen[key]) return;
        seen[key] = true;
      }
      out.push(job);
    };
    if (!snapshot) return out;
    if (Array.isArray(snapshot.jobs)) snapshot.jobs.forEach(add);
    const providers = snapshot.providers || {};
    const keys = Object.keys(providers);
    for (let i = 0; i < keys.length; i++) {
      const provider = providers[keys[i]];
      if (!provider) continue;
      let results = [];
      if (
        provider.metaData &&
        provider.metaData.mosaicProviderJobCardsModel &&
        Array.isArray(provider.metaData.mosaicProviderJobCardsModel.results)
      ) {
        results = provider.metaData.mosaicProviderJobCardsModel.results;
      } else if (Array.isArray(provider.results)) {
        results = provider.results;
      }
      for (let j = 0; j < results.length; j++) add(results[j]);
    }
    return out;
  }

  function daysOpenFromTimestamp(ts) {
    if (!ts) return null;
    const diff = Math.round((Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24));
    if (Number.isNaN(diff)) return null;
    return Math.max(0, diff);
  }

  /**
   * Indeed mosaic age. "30+ days ago" is a floor, not the posting date.
   * Prefer pubDate/createDate when the label contains "+" or when the
   * timestamp is older than the label. A label with no timestamp still
   * counts — many search rows only have the relative string.
   */
  function daysOpenFromMosaicJob(job) {
    if (!job) return null;
    const label = job.formattedRelativeTime ? String(job.formattedRelativeTime) : '';
    const labelDays = label ? parseRelativeDays(label) : null;
    const dateDays = daysOpenFromTimestamp(job.pubDate || job.createDate);
    if (dateDays != null && (label.indexOf('+') !== -1 || labelDays == null || dateDays > labelDays)) {
      return dateDays;
    }
    if (labelDays != null) return labelDays;
    return dateDays;
  }

  function daysOpenFromJobPostingJsonLd(text, nowMs) {
    if (!text) return null;
    let parsed;
    try {
      parsed = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (e) {
      return null;
    }
    const nodes = [];
    const walk = function (n) {
      if (!n) return;
      if (Array.isArray(n)) {
        for (let i = 0; i < n.length; i++) walk(n[i]);
        return;
      }
      if (typeof n === 'object') {
        nodes.push(n);
        if (n['@graph']) walk(n['@graph']);
      }
    };
    walk(parsed);
    const now = nowMs || Date.now();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const type = n['@type'];
      const isJob = type === 'JobPosting' || (Array.isArray(type) && type.indexOf('JobPosting') !== -1);
      if (!isJob || !n.datePosted) continue;
      const posted = new Date(n.datePosted).getTime();
      if (Number.isNaN(posted)) continue;
      return Math.max(0, Math.round((now - posted) / (1000 * 60 * 60 * 24)));
    }
    return null;
  }

  function indeedDetailTextSignals(scopedText) {
    const t = String(scopedText || '').toLowerCase();
    const engagementSignals = [];
    if (/actively reviewing|reviewing applicants|recently active/.test(t)) {
      engagementSignals.push(ENGAGEMENT_ACTIVELY_REVIEWING);
    }
    if (/hiring multiple candidates/.test(t)) engagementSignals.push('hiring_multiple');
    if (/urgently hiring/.test(t)) engagementSignals.push('urgently_hiring');
    return {
      employerResponsive: /often replies in/.test(t),
      isRepost: /reposted|originally posted|this job was posted/.test(t),
      appliesOffsite: /apply on company site/.test(t),
      urgentlyHiring: /urgently hiring/.test(t),
      hiringMultiple: /hiring multiple candidates/.test(t),
      engagementSignals: engagementSignals,
    };
  }

  function uniqueStrings(list) {
    const out = [];
    const seen = {};
    for (let i = 0; i < (list || []).length; i++) {
      const v = list[i];
      if (!v || seen[v]) continue;
      seen[v] = true;
      out.push(v);
    }
    return out;
  }

  /**
   * Path-independent Indeed listing fields for the detail overlay.
   * `detailText` / `selectedCardText` must be scoped to THIS job
   * (right pane / viewjob body, or the list card whose data-jk matches).
   * Full-page body text is intentionally not accepted.
   */
  function collectIndeedListingSignals(input) {
    const src = input || {};
    const jobKey = src.jobKey ? String(src.jobKey).toLowerCase() : null;
    const mosaicJobs = Array.isArray(src.mosaicJobs)
      ? src.mosaicJobs
      : flattenMosaicJobs(src.snapshot);
    const mosaicJob = pickMosaicJobForListing(
      mosaicJobs, jobKey, src.pageTitle, src.pageCompany
    );
    const detail = indeedDetailTextSignals(src.detailText);
    const card = indeedDetailTextSignals(src.selectedCardText || '');
    const mosaicResponsive = !!(
      mosaicJob &&
      (mosaicJob.employerResponsive === true || mosaicJob.oftenReplies === true)
    );
    const cached = src.cached || null;

    let daysOpen = daysOpenFromMosaicJob(mosaicJob);
    if (daysOpen == null && src.jsonLdText) {
      daysOpen = daysOpenFromJobPostingJsonLd(src.jsonLdText, src.nowMs);
    }
    if (daysOpen == null && src.jsonLd) {
      daysOpen = daysOpenFromJobPostingJsonLd(src.jsonLd, src.nowMs);
    }
    if (daysOpen == null && src.detailDateText) {
      daysOpen = parseRelativeDays(src.detailDateText);
    }
    if (daysOpen == null && cached && cached.daysOpen != null) {
      daysOpen = cached.daysOpen;
    }

    const employerResponsive = !!(
      detail.employerResponsive ||
      card.employerResponsive ||
      mosaicResponsive ||
      (cached && cached.employerResponsive)
    );

    return {
      mosaicJob: mosaicJob,
      daysOpen: daysOpen,
      employerResponsive: employerResponsive,
      isRepost: detail.isRepost || card.isRepost,
      appliesOffsite: detail.appliesOffsite || card.appliesOffsite,
      urgentlyHiring: detail.urgentlyHiring || card.urgentlyHiring,
      hiringMultiple: detail.hiringMultiple || card.hiringMultiple,
      engagementSignals: uniqueStrings(
        [].concat(detail.engagementSignals, card.engagementSignals, src.engagementSignals || [])
      ),
    };
  }

  function lookupIndeedJobCache(map, jobKey, nowMs, ttlMs) {
    if (!map || !jobKey) return null;
    const row = map[String(jobKey).toLowerCase()] || map[jobKey];
    if (!row) return null;
    const ttl = ttlMs != null ? ttlMs : INDEED_SIGNAL_CACHE_TTL_MS;
    if ((nowMs || Date.now()) - (row.cachedAt || 0) > ttl) return null;
    return row;
  }

  function mergeIndeedJobCache(map, jobKey, fields, nowMs) {
    const next = {};
    const src = map || {};
    const keys = Object.keys(src);
    for (let i = 0; i < keys.length; i++) next[keys[i]] = src[keys[i]];
    if (!jobKey) return next;
    next[String(jobKey).toLowerCase()] = Object.assign({}, fields || {}, {
      cachedAt: nowMs || Date.now(),
    });
    return next;
  }

  const INDEED_SIGNAL_CACHE_KEY = 'stjIndeedSignalsByJk';

  const STORAGE_CALL_TIMEOUT_MS = 1500;

  /**
   * Promise wrapper for one chrome.storage area call that can never hang or
   * throw into the caller. Content scripts hit "Access to storage is not
   * allowed from this context" on chrome.storage.session unless the service
   * worker called setAccessLevel(TRUSTED_AND_UNTRUSTED_CONTEXTS); in that case
   * (or on timeout / lastError) this resolves { ok:false } so the caller can
   * fall back to chrome.storage.local.
   */
  function storageCall(area, method, arg, timeoutMs, chromeApi) {
    const c = chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
    return new Promise(function (resolve) {
      let done = false;
      const finish = function (res) {
        if (done) return;
        done = true;
        resolve(res);
      };
      const timer = setTimeout(function () {
        finish({ ok: false, error: 'timeout' });
      }, timeoutMs != null ? timeoutMs : STORAGE_CALL_TIMEOUT_MS);
      try {
        if (!area || typeof area[method] !== 'function') {
          clearTimeout(timer);
          finish({ ok: false, error: 'unavailable' });
          return;
        }
        area[method](arg, function (data) {
          clearTimeout(timer);
          const err = c && c.runtime && c.runtime.lastError;
          if (err) finish({ ok: false, error: String(err.message || err) });
          else finish({ ok: true, data: data });
        });
      } catch (e) {
        clearTimeout(timer);
        finish({ ok: false, error: String((e && e.message) || e) });
      }
    });
  }

  function indeedCacheAreas(chromeApi) {
    const c = chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
    const areas = [];
    try {
      if (!c || !c.storage) return areas;
      if (c.storage.session) areas.push(c.storage.session);
      if (c.storage.local) areas.push(c.storage.local);
    } catch (e) { /* getter can throw in restricted contexts */ }
    return areas;
  }

  async function readIndeedCacheMap(chromeApi, timeoutMs) {
    const areas = indeedCacheAreas(chromeApi);
    for (let i = 0; i < areas.length; i++) {
      const res = await storageCall(areas[i], 'get', INDEED_SIGNAL_CACHE_KEY, timeoutMs, chromeApi);
      if (res.ok) return { map: (res.data && res.data[INDEED_SIGNAL_CACHE_KEY]) || {}, area: areas[i] };
    }
    return null;
  }

  async function rememberIndeedJobSignals(jobKey, fields, chromeApi, timeoutMs) {
    if (!jobKey) return false;
    const found = await readIndeedCacheMap(chromeApi, timeoutMs);
    if (!found) return false;
    const payload = {};
    payload[INDEED_SIGNAL_CACHE_KEY] = mergeIndeedJobCache(found.map, jobKey, fields, Date.now());
    const res = await storageCall(found.area, 'set', payload, timeoutMs, chromeApi);
    return res.ok;
  }

  async function recallIndeedJobSignals(jobKey, chromeApi, timeoutMs) {
    if (!jobKey) return null;
    const found = await readIndeedCacheMap(chromeApi, timeoutMs);
    return found ? lookupIndeedJobCache(found.map, jobKey, Date.now()) : null;
  }

  // --- Indeed identity (title/company) fallbacks ----------------------------
  // Indeed's DOM changes often (and the SERP <h1> is the *search* heading, e.g.
  // "it support jobs in San Antonio, TX"). Identity is therefore resolved from
  // several independent sources in priority order.

  function looksLikeSerpHeading(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    return /\bjobs?\s+(in|near|hiring)\b/i.test(t) ||
      /^[\d,]+\+?\s+.*\bjobs?\b/i.test(t) ||
      /\bjobs?\s*,?\s*employment\b/i.test(t);
  }

  // Page chrome, not a job title. "Welcome, Austin" is the logged-in
  // Indeed home heading. It must never become a stored title.
  function isRejectedJobTitle(text) {
    const t = cleanIdentityText(text);
    if (!t) return true;
    if (looksLikeSerpHeading(t)) return true;
    if (/^(?:welcome|hi|hello|hey|good\s+(?:morning|afternoon|evening))\b/i.test(t)) return true;
    if (/^jobs?\s+for\s+you\b/i.test(t)) return true;
    if (/^recommended(?:\s+for\s+you|\s+jobs)?$/i.test(t)) return true;
    if (/^(?:sign[\s-]?in|log[\s-]?in|create an account|please (?:sign|log)\s*in)\b/i.test(t)) return true;
    // Indeed section headings inside the job pane. These are not the job title.
    if (/^(?:pay(?:\s*(?:&|and)\s*benefits)?|salary|compensation|job\s*type|benefits|qualifications|full\s+job\s+description|location|profile\s+insights|job\s+details|shift\s+and\s+schedule|hiring\s+insights|job\s+activity|overview|requirements|responsibilities)$/i.test(t)) return true;
    return false;
  }

  function sanitizeJobTitle(text) {
    const t = cleanIdentityText(text);
    if (!t || isRejectedJobTitle(t)) return null;
    return t;
  }

  function cleanIdentityText(text) {
    return String(text || '')
      .replace(/\s*-\s*job post$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // "San Antonio, TX", "San Antonio, TX 78233", or a bare ZIP. "Remote"
  // and "Ed Morse Automotive Group" are not places.
  function looksLikePlaceName(text) {
    const t = cleanIdentityText(text);
    if (!t) return false;
    if (/^\d{5}(?:-\d{4})?$/.test(t)) return true;
    return /^[A-Za-z][A-Za-z .'-]*?,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/.test(t);
  }

  /**
   * "Title - Company - City, ST | Indeed.com", "Title - Company - Indeed",
   * or og:title. A trailing "| Indeed" / "- Indeed" / "- job post" is
   * removed first. Two remaining segments are title and company. Three or
   * more keep the previous city split. A city/state/ZIP is never the
   * company — companyName stays null so mosaic or JSON-LD can fill it.
   * SERP headings and section labels ("Pay", "Job type") return null.
   */
  function parseIndeedPageTitle(rawTitle) {
    let t = cleanIdentityText(rawTitle).replace(/\s*\|\s*Indeed(?:\.com)?\s*$/i, '').trim();
    t = t.replace(/\s+-\s+Indeed(?:\.com)?\s*$/i, '').trim();
    if (!t || looksLikeSerpHeading(t)) return null;
    const parts = t.split(/\s+-\s+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (parts.length === 2) {
      if (isRejectedJobTitle(parts[0])) return null;
      if (looksLikePlaceName(parts[1])) return { title: parts[0], companyName: null };
      if (isRejectedJobTitle(parts[1])) return null;
      return { title: parts[0], companyName: parts[1] };
    }
    if (parts.length < 3) return null;
    const company = parts[parts.length - 2];
    const title = parts.slice(0, parts.length - 2).join(' - ');
    if (!title || isRejectedJobTitle(title)) return null;
    if (!company || looksLikePlaceName(company) || isRejectedJobTitle(company)) {
      return { title: title, companyName: null };
    }
    return { title: title, companyName: company };
  }

  function readJobPostingIdentity(jsonLdText, jobKey) {
    if (!jsonLdText) return null;
    const chunks = Array.isArray(jsonLdText) ? jsonLdText : [jsonLdText];
    const found = [];
    for (let c = 0; c < chunks.length; c++) {
      let parsed;
      try {
        parsed = typeof chunks[c] === 'string' ? JSON.parse(chunks[c]) : chunks[c];
      } catch (e) {
        continue;
      }
      const stack = [parsed];
      let guard = 0;
      while (stack.length && guard++ < 500) {
        const n = stack.pop();
        if (!n) continue;
        if (Array.isArray(n)) { for (let i = 0; i < n.length; i++) stack.push(n[i]); continue; }
        if (typeof n !== 'object') continue;
        if (n['@graph']) stack.push(n['@graph']);
        const type = n['@type'];
        const isJob = type === 'JobPosting' || (Array.isArray(type) && type.indexOf('JobPosting') !== -1);
        if (!isJob) continue;
        let org = n.hiringOrganization;
        if (Array.isArray(org)) org = org[0];
        const orgName = typeof org === 'string' ? org : (org && org.name);
        const title = sanitizeJobTitle(n.title || n.name || '');
        const company = cleanIdentityText(orgName || '');
        if (title || company) {
          found.push({
            title: title || null,
            companyName: company || null,
            blob: JSON.stringify(n).toLowerCase(),
          });
        }
      }
    }
    if (!found.length) return null;
    if (jobKey) {
      const key = String(jobKey).toLowerCase();
      const keyed = found.filter(function (row) { return row.blob.indexOf(key) !== -1; });
      if (keyed.length) return { title: keyed[0].title, companyName: keyed[0].companyName };
      if (found.length === 1) return { title: found[0].title, companyName: found[0].companyName };
      return null;
    }
    return { title: found[0].title, companyName: found[0].companyName };
  }

  /**
   * Fill missing title/company. `src`:
   *   current: {title, companyName}        (already parsed from the detail DOM)
   *   jobKey, mosaicJobs[]                  (bridged mosaic rows; exact jk only)
   *   card: {title, companyName}            (selected [data-jk] card, optional)
   *   jsonLd: string|string[], docTitle, ogTitle
   * Returns {title, companyName, sources[]}.
   */
  function resolveIndeedIdentity(src) {
    const s = src || {};
    const cur = s.current || {};
    const out = { title: sanitizeJobTitle(cur.title), companyName: cur.companyName || null, sources: [] };
    const fill = function (cand, label) {
      if (!cand) return;
      let used = false;
      const nextTitle = sanitizeJobTitle(cand.title);
      if (!out.title && nextTitle) { out.title = nextTitle; used = true; }
      if (!out.companyName && cand.companyName && !looksLikePlaceName(cand.companyName)) {
        out.companyName = cand.companyName;
        used = true;
      }
      if (used) out.sources.push(label);
    };

    const key = s.jobKey ? String(s.jobKey).toLowerCase() : null;
    if (key && Array.isArray(s.mosaicJobs)) {
      for (let i = 0; i < s.mosaicJobs.length; i++) {
        const j = s.mosaicJobs[i];
        if (j && String(j.jobkey || '').toLowerCase() === key) {
          fill({
            title: cleanIdentityText(j.displayTitle || j.title || ''),
            companyName: cleanIdentityText(j.company || ''),
          }, 'mosaic');
          break;
        }
      }
    }
    fill(s.card, 'card');
    if (s.viewJob) {
      fill({
        title: cleanIdentityText(s.viewJob.title || s.viewJob.displayTitle || ''),
        companyName: cleanIdentityText(s.viewJob.company || s.viewJob.companyName || ''),
      }, 'viewjob');
    }
    fill(readJobPostingIdentity(s.jsonLd), 'json-ld');
    fill(parseIndeedPageTitle(s.ogTitle), 'og:title');
    fill(parseIndeedPageTitle(s.docTitle), 'document.title');
    return out;
  }

  // --- Track / Apply payloads --------------------------------------------

  function triStateBool(primary, fallback) {
    if (primary === true || primary === false || primary === null) return primary;
    if (fallback === true || fallback === false || fallback === null) return fallback;
    return null;
  }

  /**
   * Drop search keywords, location, and tracking params. Keep a stable
   * job URL when we know the id.
   */
  function canonicalListingUrl(url, platform, platformJobId) {
    const href = url ? String(url) : '';
    const id = platformJobId ||
      (platform === 'indeed' ? extractIndeedJobKey(href) : extractLinkedInJobId(href));
    if (platform === 'linkedin' && id) return 'https://www.linkedin.com/jobs/view/' + id;
    if (platform === 'indeed' && id) return 'https://www.indeed.com/viewjob?jk=' + id;
    if (!href) return null;
    try {
      const u = new URL(href);
      return u.origin + u.pathname;
    } catch (e) {
      const cut = href.split('?')[0];
      return cut || null;
    }
  }

  function buildTrackPayload(listing, extras) {
    const extra = extras || {};
    const platform = extra.platform || listing.platform || null;
    const platformJobId = listing.platformJobId || extra.platformJobId || null;
    const rawUrl = listing.listingUrl || extra.listingUrl || extra.url || null;
    return {
      companyName: listing.companyName || extra.companyName || null,
      jobTitle: sanitizeJobTitle(listing.title || extra.jobTitle),
      platform: platform,
      platformJobId: platformJobId,
      listingUrl: canonicalListingUrl(rawUrl, platform, platformJobId),
      location: listing.location || extra.location || null,
      salaryListed: triStateBool(listing.salaryListed, extra.salaryListed),
      isRepost: triStateBool(listing.isRepost, extra.isRepost),
      daysOpen: listing.daysOpen != null ? listing.daysOpen : extra.daysOpen,
      engagementSignals: listing.engagementSignals || extra.engagementSignals || [],
      employerResponseTime: listing.employerResponseTime || extra.employerResponseTime || null,
      userClickedApply: extra.userClickedApply === true || listing.userClickedApply === true,
      workArrangement: listing.workArrangement || extra.workArrangement || null,
      employmentType: listing.employmentType || extra.employmentType || null,
      listingHeuristic: extra.listingHeuristic != null
        ? extra.listingHeuristic
        : listing.listingHeuristic,
      descriptionHash: extra.descriptionHash || listing.descriptionHash ||
        hashDescription(listing.description),
    };
  }

  function mergeApplyPayload(message, lastListing) {
    const last = lastListing || {};
    const listingUrl = message.url || message.listingUrl || last.listingUrl || null;
    const platform = message.platform || last.platform || null;
    let platformJobId = message.platformJobId || last.platformJobId || null;
    if (!platformJobId && listingUrl) {
      platformJobId = platform === 'indeed'
        ? extractIndeedJobKey(listingUrl)
        : extractLinkedInJobId(listingUrl);
    }
    return {
      companyName: message.companyName || last.companyName || null,
      jobTitle: sanitizeJobTitle(message.jobTitle || last.jobTitle || last.title),
      platform: platform,
      platformJobId: platformJobId,
      listingUrl: canonicalListingUrl(listingUrl, platform, platformJobId),
      location: last.location || null,
      salaryListed: triStateBool(last.salaryListed, null),
      isRepost: triStateBool(last.isRepost, null),
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

  function applyPayloadIsComplete(payload) {
    return !!(payload && payload.companyName && payload.jobTitle && payload.platform);
  }

  // --- Overlay copy ------------------------------------------------------

  function escapeOverlayText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeGlassdoorUrl(url) {
    const s = String(url || '').trim();
    return /^https:\/\/www\.glassdoor\.com\//i.test(s) ? s : '';
  }

  function overlaySignalsHtml(signals) {
    const list = Array.isArray(signals) ? signals : [];
    if (!list.length) return '';
    return (
      '<div class="ghost-detector-signals">' +
      list.map(function (s) {
        return '<span class="ghost-detector-signal">' + escapeOverlayText(s) + '</span>';
      }).join('') +
      '</div>'
    );
  }

  // Informational only. Not a ghost-risk signal, not a score input, and
  // not stored on track payloads or the leaderboard.
  const JUST_POSTED_LABEL = 'Just posted — apply early';

  function justPostedEligible(listing) {
    if (!listing || listing.isRepost === true) return false;
    if (listing.daysOpen == null || listing.daysOpen === '') return false;
    const days = Number(listing.daysOpen);
    if (!Number.isFinite(days) || days < 0 || days > 2) return false;
    return true;
  }

  function isExtensionChromeNode(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('.stj-fresh-badge, .stj-list-badge, #ghost-detector-overlay, #stj-scan-bar, [data-stj-overlay="1"]');
  }

  function extensionChromeText(el) {
    if (!el) return '';
    if (isExtensionChromeNode(el)) return '';
    const read = function (node) {
      return String((node && node.textContent) || '');
    };
    if (!el.querySelector || !el.querySelector('.stj-fresh-badge, .stj-list-badge, #ghost-detector-overlay, #stj-scan-bar, [data-stj-overlay="1"]')) {
      return read(el);
    }
    const copy = el.cloneNode(true);
    const junk = copy.querySelectorAll('.stj-fresh-badge, .stj-list-badge, #ghost-detector-overlay, #stj-scan-bar, [data-stj-overlay="1"]');
    for (let i = 0; i < junk.length; i++) {
      if (junk[i].parentNode) junk[i].parentNode.removeChild(junk[i]);
    }
    return read(copy);
  }

  function freshBadgeMarkup(listing) {
    if (!justPostedEligible(listing)) return '';
    return (
      '<div class="stj-fresh-row">' +
      '<span class="stj-fresh-badge" data-stj-fresh="1">' +
      escapeOverlayText(JUST_POSTED_LABEL) +
      '</span></div>'
    );
  }

  function injectFreshBadge(card, listing, anchor) {
    if (!card || !card.querySelectorAll) return;
    const existing = card.querySelectorAll('.stj-fresh-badge');
    if (!justPostedEligible(listing)) {
      for (let i = 0; i < existing.length; i++) existing[i].remove();
      return;
    }
    if (existing.length === 1 &&
        existing[0].getAttribute('data-stj-fresh') === '1' &&
        String(existing[0].textContent || '').trim() === JUST_POSTED_LABEL) {
      return;
    }
    for (let i = 0; i < existing.length; i++) existing[i].remove();
    const wrap = document.createElement('span');
    wrap.innerHTML = '<span class="stj-fresh-badge" data-stj-fresh="1">' +
      escapeOverlayText(JUST_POSTED_LABEL) + '</span>';
    const node = wrap.firstElementChild;
    if (!node) return;
    const target = anchor && card.contains && card.contains(anchor) && anchor !== card ? anchor : null;
    if (target && target.insertAdjacentElement) target.insertAdjacentElement('afterend', node);
    else card.appendChild(node);
  }

  function glassdoorBlockHtml(glassdoor) {
    if (!glassdoor) return '';
    const rating = Number(glassdoor.rating);
    const ratingText = Number.isFinite(rating) ? String(rating) : '';
    const url = safeGlassdoorUrl(glassdoor.url);
    const offer = glassdoor.offerRate != null && Number.isFinite(Number(glassdoor.offerRate))
      ? Math.round(Number(glassdoor.offerRate) * 100)
      : null;
    return (
      '<div class="ghost-detector-glassdoor">' +
      '<span class="ghost-detector-glassdoor-label">Glassdoor:</span>' +
      (ratingText ? '<span>' + escapeOverlayText(ratingText) + '/5</span>' : '') +
      (offer != null ? '<span> • ' + offer + '% offer rate</span>' : '') +
      (url
        ? '<a href="' + escapeOverlayText(url) + '" target="_blank" rel="noopener">View →</a>'
        : '') +
      '</div>'
    );
  }

  function brandFooterHtml() {
    return BRAND_FOOTER_HTML;
  }

  function communitySummaryText(backendData) {
    if (!backendData) return '';
    const bits = [];
    const listingReports = backendData.listingReports || 0;
    const totalReports = backendData.totalReports || 0;
    if (listingReports > 0) {
      bits.push(
        listingReports + ' community report' + (listingReports === 1 ? '' : 's') + ' on this listing'
      );
    }
    if (totalReports > 0) {
      bits.push(
        backendData.live
          ? totalReports + ' recent community reports on this employer'
          : totalReports + ' other users have flagged this employer'
      );
    }
    return bits.length ? '📊 ' + bits.join(' · ') : '';
  }

  function communityBlockHtml(backendData) {
    const text = communitySummaryText(backendData);
    const hidden = text ? '' : 'display:none;';
    return (
      '<div id="ghost-community-live" class="ghost-detector-community" ' +
      'style="background:#fff3e0;padding:6px 10px;border-radius:6px;border-left:3px solid #ff9800;' + hidden + '">' +
      (text || '') +
      '</div>'
    );
  }

  function applyReportFeedbackToOverlay(result) {
    if (typeof document === 'undefined' || !result) return;
    const live = document.getElementById('ghost-community-live');
    const summary = communitySummaryText({
      totalReports: result.totalReports,
      listingReports: result.listingReports,
      live: true,
    }) || '📊 Your report is now part of the community score';
    if (live) {
      live.textContent = summary;
      live.style.display = 'block';
    }
    const scoreEl = document.querySelector('#ghost-detector-overlay .ghost-detector-score');
    if (scoreEl && result.ghostScore != null) {
      const note = document.getElementById('ghost-community-risk');
      if (note) {
        note.textContent = 'Updated employer risk: ' + result.ghostScore + '/100';
        note.style.display = 'block';
      } else if (scoreEl.parentElement) {
        const span = document.createElement('div');
        span.id = 'ghost-community-risk';
        span.className = 'ghost-detector-community';
        span.style.cssText = 'font-size:11px;color:#6a1b9a;margin-top:4px;';
        span.textContent = 'Updated employer risk: ' + result.ghostScore + '/100';
        scoreEl.parentElement.insertAdjacentElement('afterend', span);
      }
    }
  }

  // --- Popup state -------------------------------------------------------

  function publishActiveListing(listing, blended, platform) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    if (!listing || !blended) return;
    const safeTitle = sanitizeJobTitle(listing.title);
    if (!safeTitle) {
      try {
        if (chrome.storage.local.remove) chrome.storage.local.remove('stjActiveListing');
        else chrome.storage.local.set({ stjActiveListing: null });
      } catch (e) { /* orphaned extension context */ }
      return null;
    }
    const payload = {
      title: safeTitle,
      companyName: listing.companyName || null,
      platform: platform || listing.platform || null,
      platformJobId: listing.platformJobId || null,
      score: blended.score,
      label: blended.label,
      signals: (blended.signals || []).slice(0, 8),
      url: listing.listingUrl || (typeof location !== 'undefined' ? location.href : null),
      updatedAt: Date.now(),
    };
    try {
      chrome.storage.local.set({ stjActiveListing: payload });
    } catch (e) { /* orphaned extension context */ }
    return payload;
  }

  function installPopupBridge(getState) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'GET_CURRENT_SCORE') {
        try {
          sendResponse(typeof getState === 'function' ? getState() : null);
        } catch (e) {
          sendResponse(null);
        }
        return true;
      }
    });
  }

  // --- Parse health ------------------------------------------------------
  // Required identity missing means the selectors drifted or the page is
  // in a language/layout we cannot read. Log unparsed and do not score.

  function selectorHealth(parsed, opts) {
    const options = opts || {};
    const row = parsed || {};
    const require = options.require || ['title', 'companyName'];
    const missing = [];
    for (let i = 0; i < require.length; i++) {
      const key = require[i];
      const val = row[key];
      if (val == null || (typeof val === 'string' && !String(val).trim())) missing.push(key);
    }
    return {
      state: missing.length ? 'unparsed' : 'parsed',
      missing: missing,
      platform: options.platform || null,
    };
  }

  function logUnparsed(platform, health) {
    const missing = health && health.missing && health.missing.length
      ? health.missing.join(', ')
      : 'required selectors';
    const where = platform || (health && health.platform) || 'listing';
    console.warn('[SkipThisJob] unparsed ' + where + ' — ' + missing + '. Not scoring.');
  }

  const unparsedCardLogged = {};

  function logUnparsedCard(platform, reason) {
    const key = platform || 'list';
    if (unparsedCardLogged[key]) return;
    unparsedCardLogged[key] = true;
    console.warn('[SkipThisJob] unparsed ' + key + ' list card — ' + (reason || 'selectors missed') + '. Not scoring.');
  }

  function scoreParsedListing(listing, scoreFn, opts) {
    const options = opts || {};
    const health = selectorHealth(listing, options);
    if (health.state !== 'parsed') {
      logUnparsed(options.platform || health.platform, health);
      return {
        state: 'unparsed',
        missing: health.missing,
        score: null,
        signals: ['unparsed'],
        result: null,
      };
    }
    const result = typeof scoreFn === 'function' ? scoreFn(listing) : null;
    return {
      state: 'parsed',
      missing: [],
      score: result ? result.score : null,
      signals: result ? result.signals : [],
      result: result,
    };
  }

  // --- Dim risky list rows ----------------------------------------------
  // Opacity only. Never remove or collapse nodes: LinkedIn's results list
  // is React-managed and virtualized.

  const DIM_STORAGE_KEY = 'stjDimRisky';
  let dimThreshold = 0;
  let dimListenerBound = false;
  let listRescan = null;

  function dimThresholdFromSetting(value) {
    if (value === 75 || value === '75') return 75;
    if (value === 55 || value === '55') return 55;
    return 0;
  }

  function applyListDim(card, score, threshold) {
    if (!card || !card.classList) return card;
    const limit = dimThresholdFromSetting(threshold);
    const on = limit > 0 && score != null && !Number.isNaN(Number(score)) && Number(score) >= limit;
    const has = card.classList.contains('stj-dimmed');
    if (on && !has) card.classList.add('stj-dimmed');
    else if (!on && has) card.classList.remove('stj-dimmed');
    const nextAttr = on ? String(limit) : null;
    const curAttr = card.getAttribute ? card.getAttribute('data-stj-dim') : null;
    if (nextAttr && curAttr !== nextAttr && card.setAttribute) card.setAttribute('data-stj-dim', nextAttr);
    else     if (!nextAttr && curAttr != null && card.removeAttribute) card.removeAttribute('data-stj-dim');
    return card;
  }

  // List refreshes outside watchListBadges (detail stamp, mutation rescan)
  // must use the threshold the popup last stored. A missing argument to
  // applyListDim stays "off" so callers that pass undefined do not dim.
  function applyCurrentListDim(card, score) {
    return applyListDim(card, score, dimThreshold);
  }

  function loadDimThreshold(done) {
    let settled = false;
    const apply = function (value) {
      dimThreshold = dimThresholdFromSetting(value);
      const first = !settled;
      settled = true;
      if (first || done) {
        if (done) done();
      }
    };
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local || !chrome.storage.local.get) {
        apply('off');
        return;
      }
      chrome.storage.local.get(DIM_STORAGE_KEY, function (res) {
        let value = 'off';
        try {
          if (!(chrome.runtime && chrome.runtime.lastError) && res) value = res[DIM_STORAGE_KEY];
        } catch (e) { /* ignore */ }
        apply(value);
      });
      // Don't wait on storage to paint badges. A late read re-scans once.
      setTimeout(function () {
        if (!settled) apply('off');
      }, 250);
    } catch (e) {
      apply('off');
    }
  }

  function bindDimListener() {
    if (dimListenerBound) return;
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes || !changes[DIM_STORAGE_KEY]) return;
        dimThreshold = dimThresholdFromSetting(changes[DIM_STORAGE_KEY].newValue);
        if (listRescan) listRescan();
      });
      dimListenerBound = true;
    } catch (e) { /* orphaned extension context */ }
  }

  // --- List badges -------------------------------------------------------

  function badgeHtml(result) {
    const color = LABEL_COLORS[result.label] || LABEL_COLORS.moderate;
    const daysAttr = result.daysOpen != null ? String(result.daysOpen) : '';
    const source = result.source || 'preview';
    return (
      '<span class="stj-list-badge stj-list-badge--' + result.label + '" ' +
      'data-stj-score="' + result.score + '" data-stj-label="' + result.label + '" ' +
      'data-stj-days="' + daysAttr + '" data-stj-source="' + source + '" ' +
      'title="Skip This Job preview: ' + result.score + '/100 — ' + (LABEL_TEXT[result.label] || '') + '" ' +
      'style="background:' + color.bg + ';color:' + color.text + ';border:1px solid ' + color.border + ';">' +
      color.icon + ' ' + result.score +
      '</span>'
    );
  }

  // Detail-visit / solid-preview scores keyed by job id so a later
  // MutationObserver rescan (Promoted card, no visible date → preview 0)
  // cannot wipe Baton/First Point badges back to 0.
  const listBadgeMemory = {};

  function listBadgeKey(card, parsed) {
    if (parsed && (parsed.platformJobId || parsed.jobId)) {
      return String(parsed.platformJobId || parsed.jobId);
    }
    if (card && card.getAttribute) {
      const direct = card.getAttribute('data-job-id') || card.getAttribute('data-occludable-job-id') ||
        card.getAttribute('data-jk');
      if (direct) return String(direct);
      const host = card.closest
        ? (card.closest('[data-job-id]') || card.closest('[data-occludable-job-id]') || card.closest('[data-jk]'))
        : null;
      if (host) {
        return host.getAttribute('data-job-id') ||
          host.getAttribute('data-occludable-job-id') ||
          host.getAttribute('data-jk');
      }
      const ownKey = card.getAttribute('componentkey') || '';
      const ownId = ownKey.match(/^job-card-component-ref-(\d{5,})$/);
      if (ownId) return ownId[1];
      const keyed = card.closest ? card.closest('[componentkey^="job-card-component-ref-"]') : null;
      if (keyed) {
        const nested = String(keyed.getAttribute('componentkey') || '').match(/^job-card-component-ref-(\d{5,})$/);
        if (nested) return nested[1];
      }
    }
    if (parsed && parsed.title) {
      return normalizeTitle(parsed.title) + '|' + normalizeTitle(parsed.companyName || '');
    }
    return null;
  }

  function rememberListBadgeScore(key, result, meta) {
    if (!key || !result || result.score == null) return null;
    const extra = meta || {};
    const row = {
      score: result.score,
      label: result.label || labelForScore(result.score),
      signals: result.signals || [],
      daysOpen: extra.daysOpen != null ? extra.daysOpen : result.daysOpen,
      source: extra.source || result.source || 'preview',
      isHighTurnover: !!result.isHighTurnover,
      updatedAt: Date.now(),
    };
    listBadgeMemory[String(key)] = row;
    return row;
  }

  function lookupListBadgeScore(key) {
    if (!key) return null;
    return listBadgeMemory[String(key)] || null;
  }

  function clearListBadgeMemory() {
    const keys = Object.keys(listBadgeMemory);
    for (let i = 0; i < keys.length; i++) delete listBadgeMemory[keys[i]];
  }

  function readExistingBadge(card) {
    if (!card || !card.querySelector) return null;
    const el = card.querySelector('.stj-list-badge');
    if (!el) return null;
    const score = Number(el.getAttribute('data-stj-score'));
    if (Number.isNaN(score)) return null;
    const daysRaw = el.getAttribute('data-stj-days');
    const daysOpen = daysRaw === '' || daysRaw == null ? null : Number(daysRaw);
    return {
      score: score,
      label: el.getAttribute('data-stj-label') || labelForScore(score),
      signals: [],
      daysOpen: daysOpen != null && !Number.isNaN(daysOpen) ? daysOpen : null,
      source: el.getAttribute('data-stj-source') || 'preview',
    };
  }

  /**
   * Keep a known badge when the rescan has weaker/null age (Promoted
   * cards) or would otherwise drop a detail-stamped score to ~0.
   */
  function resolveListBadge(preview, parsed, remembered) {
    const next = preview || { score: 0, label: 'low', signals: [] };
    if (!remembered || remembered.score == null) {
      return { result: next, kept: false };
    }
    const newDays = parsed && parsed.daysOpen != null && !Number.isNaN(Number(parsed.daysOpen))
      ? Number(parsed.daysOpen) : null;
    const oldDays = remembered.daysOpen != null && !Number.isNaN(Number(remembered.daysOpen))
      ? Number(remembered.daysOpen) : null;
    const newScore = next.score != null ? next.score : 0;
    const oldScore = remembered.score;
    const ageMissing = newDays == null;
    const keepDetail = remembered.source === 'detail' && newScore < oldScore &&
      (ageMissing || oldDays == null || newDays === oldDays);
    if ((ageMissing && oldScore > newScore) || keepDetail) {
      return {
        result: {
          score: remembered.score,
          label: remembered.label || labelForScore(remembered.score),
          signals: remembered.signals || next.signals || [],
          daysOpen: remembered.daysOpen,
          source: remembered.source || 'remembered',
          isHighTurnover: !!remembered.isHighTurnover,
        },
        kept: true,
      };
    }
    return { result: next, kept: false };
  }

  function listBadgeUnchanged(existing, result) {
    if (!existing || !result) return false;
    const days = result.daysOpen != null ? String(result.daysOpen) : '';
    const source = result.source || 'preview';
    return existing.getAttribute('data-stj-score') === String(result.score) &&
      existing.getAttribute('data-stj-label') === String(result.label) &&
      (existing.getAttribute('data-stj-days') || '') === days &&
      (existing.getAttribute('data-stj-source') || '') === source;
  }

  function injectListBadge(card, result, anchor) {
    if (!card || !result) return;
    const existing = card.querySelector('.stj-list-badge');
    if (existing) {
      if (listBadgeUnchanged(existing, result)) return;
      existing.outerHTML = badgeHtml(result);
      return;
    }
    const wrap = document.createElement('span');
    wrap.innerHTML = badgeHtml(result);
    const node = wrap.firstElementChild;
    const target = anchor || card;
    if (target && target.appendChild) {
      target.appendChild(node);
    } else {
      card.appendChild(node);
    }
  }

  let listBadgeObserver = null;
  let listBadgeMuted = false;

  function disconnectListBadgeObserver() {
    if (listBadgeObserver) {
      try { listBadgeObserver.disconnect(); } catch (e) {}
      listBadgeObserver = null;
    }
  }

  function watchListBadges(opts) {
    if (typeof document === 'undefined') return null;
    const options = opts || {};
    let timer = null;
    const scan = function () {
      if (typeof options.onScan === 'function') {
        try { options.onScan(); } catch (e) {}
      }
      let cards = [];
      try {
        cards = Array.prototype.slice.call(options.findCards ? options.findCards() : []);
      } catch (e) {
        return;
      }
      cards = cards.filter(function (el) {
        return el && el.nodeType === 1 && !cards.some(function (other) {
          return other !== el && el.contains(other);
        });
      });
      // Swallow the mutations this scan itself writes so the observer
      // cannot schedule the next scan forever.
      listBadgeMuted = true;
      try {
        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          if (!card || card.nodeType !== 1) continue;
          let parsed = null;
          try {
            parsed = options.parseCard(card);
          } catch (e) {
            continue;
          }
          if (!parsed || !parsed.title) continue;
          const preview = scoreListPreview(parsed);
          const key = listBadgeKey(card, parsed);
          const remembered = lookupListBadgeScore(key) || readExistingBadge(card);
          const resolved = resolveListBadge(preview, parsed, remembered);
          if (key && !resolved.kept) {
            rememberListBadgeScore(key, resolved.result, {
              source: 'preview',
              daysOpen: parsed.daysOpen,
            });
          }
          let anchor = null;
          try {
            anchor = options.anchor ? options.anchor(card) : card;
          } catch (e) {
            anchor = card;
          }
          injectListBadge(card, resolved.result, anchor);
          injectFreshBadge(card, parsed, anchor);
          applyListDim(card, resolved.result.score, dimThreshold);
        }
      } finally {
        setTimeout(function () { listBadgeMuted = false; }, 0);
      }
    };
    const schedule = function () {
      if (listBadgeMuted) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(scan, options.debounceMs || 450);
    };
    listRescan = schedule;
    bindDimListener();
    loadDimThreshold(schedule);
    let root = null;
    if (options.listRootSelector) {
      root = document.querySelector(options.listRootSelector);
    } else {
      root = document.body;
    }
    // A missing list root must not fall back to document.body (LinkedIn
    // /feed/* and other non-results pages). That watch rewrites badges
    // on the whole document and never settles.
    if (!root) return null;
    disconnectListBadgeObserver();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    listBadgeObserver = observer;
    return observer;
  }

  api.ENGAGEMENT_ACTIVELY_REVIEWING = ENGAGEMENT_ACTIVELY_REVIEWING;
  api.LABEL_TEXT = LABEL_TEXT;
  api.LABEL_COLORS = LABEL_COLORS;
  api.extractIndeedJobKey = extractIndeedJobKey;
  api.mosaicJobIdentity = mosaicJobIdentity;
  api.pickMosaicJobForListing = pickMosaicJobForListing;
  api.flattenMosaicJobs = flattenMosaicJobs;
  api.daysOpenFromMosaicJob = daysOpenFromMosaicJob;
  api.daysOpenFromJobPostingJsonLd = daysOpenFromJobPostingJsonLd;
  api.indeedDetailTextSignals = indeedDetailTextSignals;
  api.collectIndeedListingSignals = collectIndeedListingSignals;
  api.lookupIndeedJobCache = lookupIndeedJobCache;
  api.mergeIndeedJobCache = mergeIndeedJobCache;
  api.rememberIndeedJobSignals = rememberIndeedJobSignals;
  api.recallIndeedJobSignals = recallIndeedJobSignals;
  api.storageCall = storageCall;
  api.resolveIndeedIdentity = resolveIndeedIdentity;
  api.looksLikePlaceName = looksLikePlaceName;
  api.parseIndeedPageTitle = parseIndeedPageTitle;
  api.isRejectedJobTitle = isRejectedJobTitle;
  api.sanitizeJobTitle = sanitizeJobTitle;
  api.readJobPostingIdentity = readJobPostingIdentity;
  api.INDEED_SIGNAL_CACHE_TTL_MS = INDEED_SIGNAL_CACHE_TTL_MS;
  api.extractLinkedInJobId = extractLinkedInJobId;
  api.hasEngagementSignal = hasEngagementSignal;
  api.isActivelyReviewing = isActivelyReviewing;
  api.engagementWasParsed = engagementWasParsed;
  api.engagementCreditForAge = engagementCreditForAge;
  api.applyEngagementScoring = applyEngagementScoring;
  api.looksLikeSalary = looksLikeSalary;
  api.detectSeniorityMismatch = detectSeniorityMismatch;
  api.canonicalListingUrl = canonicalListingUrl;
  api.triStateBool = triStateBool;
  api.escapeOverlayText = escapeOverlayText;
  api.safeGlassdoorUrl = safeGlassdoorUrl;
  api.overlaySignalsHtml = overlaySignalsHtml;
  api.JUST_POSTED_LABEL = JUST_POSTED_LABEL;
  api.justPostedEligible = justPostedEligible;
  api.freshBadgeMarkup = freshBadgeMarkup;
  api.injectFreshBadge = injectFreshBadge;
  api.isExtensionChromeNode = isExtensionChromeNode;
  api.extensionChromeText = extensionChromeText;
  api.glassdoorBlockHtml = glassdoorBlockHtml;
  api.hashDescription = hashDescription;
  api.normalizeTitle = normalizeTitle;
  api.labelForScore = labelForScore;
  api.AGE_FLOORS = AGE_FLOORS;
  api.ageFloorForDays = ageFloorForDays;
  api.enforceAgeFloor = enforceAgeFloor;
  api.ageContribution = ageContribution;
  api.applicantContribution = applicantContribution;
  api.hasBrokenTemplate = hasBrokenTemplate;
  api.hasWorkArrangementConflict = hasWorkArrangementConflict;
  api.applyDescriptionQuality = applyDescriptionQuality;
  api.finalizeHeuristicScore = finalizeHeuristicScore;
  api.applyLowIntentTax = applyLowIntentTax;
  api.scoreListingSignals = scoreListingSignals;
  api.scoreListPreview = scoreListPreview;
  api.selectorHealth = selectorHealth;
  api.logUnparsed = logUnparsed;
  api.logUnparsedCard = logUnparsedCard;
  api.scoreParsedListing = scoreParsedListing;
  api.DIM_STORAGE_KEY = DIM_STORAGE_KEY;
  api.dimThresholdFromSetting = dimThresholdFromSetting;
  api.applyListDim = applyListDim;
  api.applyCurrentListDim = applyCurrentListDim;
  api.parseRelativeDays = parseRelativeDays;
  api.parseLinkedInPostedAge = parseLinkedInPostedAge;
  api.normalizeAgeText = normalizeAgeText;
  api.daysOpenFromIso = daysOpenFromIso;
  api.parseApplicantCount = parseApplicantCount;
  api.parseLinkedInMetadataLine = parseLinkedInMetadataLine;
  api.parseLinkedInPageTitle = parseLinkedInPageTitle;
  api.daysOpenFromCard = daysOpenFromCard;
  api.buildTrackPayload = buildTrackPayload;
  api.mergeApplyPayload = mergeApplyPayload;
  api.applyPayloadIsComplete = applyPayloadIsComplete;
  api.brandFooterHtml = brandFooterHtml;
  api.communitySummaryText = communitySummaryText;
  api.communityBlockHtml = communityBlockHtml;
  api.applyReportFeedbackToOverlay = applyReportFeedbackToOverlay;
  api.publishActiveListing = publishActiveListing;
  api.installPopupBridge = installPopupBridge;
  api.watchListBadges = watchListBadges;
  api.disconnectListBadgeObserver = disconnectListBadgeObserver;
  api.injectListBadge = injectListBadge;
  api.listBadgeKey = listBadgeKey;
  api.rememberListBadgeScore = rememberListBadgeScore;
  api.lookupListBadgeScore = lookupListBadgeScore;
  api.clearListBadgeMemory = clearListBadgeMemory;
  api.resolveListBadge = resolveListBadge;
  api.readExistingBadge = readExistingBadge;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.SkipThisJobShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
