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
   * Apply the shared engagement credit / stale-no-review penalty.
   * Mutates `signals` and returns the updated numeric score plus a boolean
   * the Indeed combo penalties can reuse.
   */
  function applyEngagementScoring(listing, score, signals) {
    const reviewing = isActivelyReviewing(listing);
    const out = Array.isArray(signals) ? signals : [];
    const days = listing && listing.daysOpen;

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
    } else if (listing && listing.daysOpen != null && listing.daysOpen >= 14) {
      score += 10;
      out.push('No active review signals on older listing');
    }

    return { score, signals: out, activelyReviewing: reviewing };
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
   */
  function ageContribution(daysOpen, opts) {
    const options = opts || {};
    let delta = 0;
    const signals = [];
    if (daysOpen == null || Number.isNaN(Number(daysOpen))) {
      if (options.unknownPenalty) {
        delta = options.unknownPenalty;
        signals.push('Posting age unknown');
      }
      return { delta: delta, signals: signals };
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
    } else if (vagueness <= 0.15) {
      // 0.2.2 bias: a specific JD is informational only — never a discount.
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
   * `preview: true` skips missing-field penalties cards cannot observe
   * (description / hiring contact) so badges stay in the same band as
   * detail for the signals they share (age, repost, applicants, salary).
   */
  function scoreListingSignals(listing, opts) {
    const options = opts || {};
    const row = listing || {};
    const preview = options.preview === true;
    const platform = options.platform || row.platform || 'linkedin';
    const isHighTurnover = options.isHighTurnover === true;
    const signals = [];
    let score = 0;

    if (!preview && platform === 'indeed') {
      score += 10;
    }

    const age = ageContribution(row.daysOpen, {
      unknownPenalty: !preview && platform === 'indeed' ? 15 : 0,
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
    } else if (!row.salaryListed) {
      score += 5;
      signals.push('No salary listed');
    }

    if (row.isThirdParty) {
      score += preview ? 10 : 12;
      signals.push(preview ? 'Staffing / aggregator' : 'Middleman — staffing agency or job board');
    }

    if (!preview && platform === 'linkedin') {
      if (!row.description || row.description.length < 200) {
        score += 12;
        signals.push('No or very weak job description');
      } else if (row.description.length < 500) {
        score += 6;
        signals.push('Short or limited job description');
      }
    }

    if (!preview && platform === 'indeed' && !row.description) {
      score += 7;
      signals.push('No description available');
    }

    if (!preview && row.description && options.vagueness != null) {
      const desc = applyDescriptionQuality(score, signals, options.vagueness, {
        vagueHigh: platform === 'indeed' ? 11 : 12,
        vagueMid: platform === 'indeed' ? 6 : 7,
        detailedCredit: 1,
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

  function parseRelativeDays(text) {
    if (!text) return null;
    const t = String(text).toLowerCase().trim();
    if (/just posted|posted today|moments? ago|active\s+today/.test(t)) return 0;
    if (/(few |a few )?(hours?|mins?|minutes?) ago/.test(t)) return 0;
    if (/\btoday\b/.test(t) && t.length < 24) return 0;
    // LinkedIn compact: "3mo ago", "5 mo ago", "Posted 3 months ago"
    let m = t.match(/(\d+)\s*mo(?:nths?|s)?\.?\s+ago/);
    if (!m) m = t.match(/(\d+)\s*mo(?:nths?|s)?\.?\s*ago/);
    if (m) return parseInt(m[1], 10) * 30;
    // "2w ago", "2 weeks ago", "Posted 3 weeks ago"
    m = t.match(/(\d+)\s*w(?:eeks?)?\s*ago/);
    if (m) return parseInt(m[1], 10) * 7;
    // "30+ days ago", "5d ago", "Posted 12 days ago"
    m = t.match(/(\d+)\+?\s*(?:days?|d)\s*ago/);
    if (m) return parseInt(m[1], 10);
    m = t.match(/active\s+(\d+)\+?\s*(?:days?|d)/);
    if (m) return parseInt(m[1], 10);
    if (/\byesterday\b/.test(t)) return 1;
    return null;
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
    const m = String(text).match(/(?:over\s+)?(\d[\d,]*)\+?\s*(?:applicants?|people\s+clicked\s+apply)/i);
    if (!m) return null;
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    return Number.isNaN(n) ? null : n;
  }

  /**
   * Prefer <time datetime>, then compact "3mo ago" on the card, then
   * a footer / fallback string. Used by list badges so they see the
   * same age the detail overlay would.
   */
  function daysOpenFromCard(card, dateEl, fallbackText) {
    if (dateEl && dateEl.getAttribute) {
      const iso = daysOpenFromIso(dateEl.getAttribute('datetime'));
      if (iso != null) return iso;
      const fromEl = parseRelativeDays(dateEl.textContent);
      if (fromEl != null) return fromEl;
    }
    if (card && card.querySelectorAll) {
      const times = card.querySelectorAll('time[datetime], time');
      for (let i = 0; i < times.length; i++) {
        const iso = daysOpenFromIso(times[i].getAttribute('datetime'));
        if (iso != null) return iso;
        const fromTime = parseRelativeDays(times[i].textContent);
        if (fromTime != null) return fromTime;
      }
    }
    return parseRelativeDays(fallbackText);
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

  function daysOpenFromMosaicJob(job) {
    if (!job) return null;
    if (job.formattedRelativeTime) {
      const d = parseRelativeDays(job.formattedRelativeTime);
      if (d != null) return d;
    }
    const ts = job.pubDate || job.createDate;
    if (ts) {
      const diff = Math.round((Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24));
      if (!Number.isNaN(diff)) return Math.max(0, diff);
    }
    return null;
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

  function rememberIndeedJobSignals(jobKey, fields) {
    if (!jobKey || typeof chrome === 'undefined' || !chrome.storage) return;
    const store = chrome.storage.session || chrome.storage.local;
    if (!store || !store.get) return;
    try {
      store.get(INDEED_SIGNAL_CACHE_KEY, function (data) {
        const prev = (data && data[INDEED_SIGNAL_CACHE_KEY]) || {};
        const next = mergeIndeedJobCache(prev, jobKey, fields, Date.now());
        const payload = {};
        payload[INDEED_SIGNAL_CACHE_KEY] = next;
        store.set(payload);
      });
    } catch (e) { /* orphaned extension context */ }
  }

  function recallIndeedJobSignals(jobKey) {
    return new Promise(function (resolve) {
      if (!jobKey || typeof chrome === 'undefined' || !chrome.storage) {
        resolve(null);
        return;
      }
      const store = chrome.storage.session || chrome.storage.local;
      if (!store || !store.get) {
        resolve(null);
        return;
      }
      try {
        store.get(INDEED_SIGNAL_CACHE_KEY, function (data) {
          const map = (data && data[INDEED_SIGNAL_CACHE_KEY]) || {};
          resolve(lookupIndeedJobCache(map, jobKey, Date.now()));
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  // --- Track / Apply payloads --------------------------------------------

  function buildTrackPayload(listing, extras) {
    const extra = extras || {};
    const platform = extra.platform || listing.platform || null;
    return {
      companyName: listing.companyName || extra.companyName || null,
      jobTitle: listing.title || extra.jobTitle || null,
      platform: platform,
      platformJobId: listing.platformJobId || extra.platformJobId || null,
      listingUrl: listing.listingUrl || extra.listingUrl || extra.url || null,
      location: listing.location || extra.location || null,
      salaryListed: listing.salaryListed ?? extra.salaryListed ?? false,
      isRepost: listing.isRepost ?? extra.isRepost ?? false,
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
      jobTitle: message.jobTitle || last.jobTitle || last.title || null,
      platform: platform,
      platformJobId: platformJobId,
      listingUrl: listingUrl,
      location: last.location || null,
      salaryListed: last.salaryListed ?? false,
      isRepost: last.isRepost ?? false,
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
    const payload = {
      title: listing.title || null,
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

  // --- List badges -------------------------------------------------------

  function badgeHtml(result) {
    const color = LABEL_COLORS[result.label] || LABEL_COLORS.moderate;
    return (
      '<span class="stj-list-badge stj-list-badge--' + result.label + '" ' +
      'title="Skip This Job preview: ' + result.score + '/100 — ' + (LABEL_TEXT[result.label] || '') + '" ' +
      'style="background:' + color.bg + ';color:' + color.text + ';border:1px solid ' + color.border + ';">' +
      color.icon + ' ' + result.score +
      '</span>'
    );
  }

  function injectListBadge(card, result, anchor) {
    if (!card || !result) return;
    const existing = card.querySelector('.stj-list-badge');
    if (existing) {
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

  function watchListBadges(opts) {
    if (typeof document === 'undefined') return null;
    const options = opts || {};
    let timer = null;
    const scan = function () {
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
        const result = scoreListPreview(parsed);
        let anchor = null;
        try {
          anchor = options.anchor ? options.anchor(card) : card;
        } catch (e) {
          anchor = card;
        }
        injectListBadge(card, result, anchor);
      }
    };
    const schedule = function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(scan, options.debounceMs || 450);
    };
    let root = document.body;
    if (options.listRootSelector) {
      const found = document.querySelector(options.listRootSelector);
      if (found) root = found;
    }
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    schedule();
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
  api.INDEED_SIGNAL_CACHE_TTL_MS = INDEED_SIGNAL_CACHE_TTL_MS;
  api.extractLinkedInJobId = extractLinkedInJobId;
  api.hasEngagementSignal = hasEngagementSignal;
  api.isActivelyReviewing = isActivelyReviewing;
  api.engagementCreditForAge = engagementCreditForAge;
  api.applyEngagementScoring = applyEngagementScoring;
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
  api.parseRelativeDays = parseRelativeDays;
  api.daysOpenFromIso = daysOpenFromIso;
  api.parseApplicantCount = parseApplicantCount;
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
  api.injectListBadge = injectListBadge;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.SkipThisJobShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
