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
   * Apply the shared engagement credit / stale-no-review penalty.
   * Mutates `signals` and returns the updated numeric score plus a boolean
   * the Indeed combo penalties can reuse.
   */
  function applyEngagementScoring(listing, score, signals) {
    const reviewing = isActivelyReviewing(listing);
    const out = Array.isArray(signals) ? signals : [];

    if (reviewing) {
      score -= 8;
      out.push('✓ Employer actively reviewing applications');
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

  /**
   * Lightweight SERP-card score. Full scoreLocally() treats missing
   * description / contact as red flags; cards do not have those fields,
   * so we only score signals the card actually shows.
   */
  function scoreListPreview(card) {
    let score = 18;
    const signals = [];
    const days = card && card.daysOpen != null ? Number(card.daysOpen) : null;

    if (days != null && !Number.isNaN(days)) {
      if (days <= 2) {
        score -= 6;
        signals.push('Posted in last 48 hours');
      } else if (days <= 7) {
        score += 4;
      } else if (days <= 14) {
        score += 10;
        signals.push('Open ' + days + ' days');
      } else if (days <= 30) {
        score += 22;
        signals.push('Open ' + days + ' days');
      } else {
        score += 34;
        signals.push('Open ' + days + ' days');
      }
    }

    if (card && card.isRepost) {
      score += 16;
      signals.push('Reposted');
    }
    if (card && card.salaryListed === false) {
      score += 4;
    } else if (card && card.salaryListed === true) {
      score -= 2;
    }
    if (card && card.isThirdParty) {
      score += 10;
      signals.push('Staffing / aggregator');
    }

    score = Math.min(100, Math.max(0, Math.round(score)));
    const label = labelForScore(score);
    return { score, label, signals, isHighTurnover: false };
  }

  function parseRelativeDays(text) {
    if (!text) return null;
    const t = String(text).toLowerCase();
    if (/just posted|today|hours?\s+ago|minutes?\s+ago|active\s+today/i.test(t)) return 0;
    const months = t.match(/(\d+)\s*months?\s*ago/);
    if (months) return parseInt(months[1], 10) * 30;
    const weeks = t.match(/(\d+)\s*weeks?\s*ago/);
    if (weeks) return parseInt(weeks[1], 10) * 7;
    const days = t.match(/(\d+)\s*days?\s*ago/);
    if (days) return parseInt(days[1], 10);
    if (/\byesterday\b/.test(t)) return 1;
    return null;
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
  api.extractLinkedInJobId = extractLinkedInJobId;
  api.hasEngagementSignal = hasEngagementSignal;
  api.isActivelyReviewing = isActivelyReviewing;
  api.applyEngagementScoring = applyEngagementScoring;
  api.hashDescription = hashDescription;
  api.normalizeTitle = normalizeTitle;
  api.labelForScore = labelForScore;
  api.scoreListPreview = scoreListPreview;
  api.parseRelativeDays = parseRelativeDays;
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
