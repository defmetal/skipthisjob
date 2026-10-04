// ============================================================
// LinkedIn Content Script — Skip This Job
// ============================================================

const API_BASE = 'https://www.skipthisjob.com/api';
const STJ = globalThis.SkipThisJobShared || {};

let lastProcessedJobId = null;
let isProcessing = false;
let currentListingData = null;   // 0.1.8 - store current listing for reliable Apply tracking
let lastPublishedScore = null;
let lastOverlayScore = null;
let lastOverlayBackend = null;
let _liRaf = 0;
let _liMute = false;

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
      el.closest('.comments-comment-entity') ||
      el.closest('[componentkey^="job-card-component-ref-"]') ||
      el.closest('[componentkey="SearchResultsMainContent"]')
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

  // No detail root: leave age unknown. document.body includes the sidebar.
  return { days: null, source: '' };
}

function linkedInDetailRoot() {
  if (typeof document === 'undefined' || !document.querySelector) return null;
  return document.querySelector('.jobs-search__job-details') ||
    document.querySelector('.scaffold-layout__detail') ||
    document.querySelector('.jobs-details') ||
    document.querySelector('.job-details-jobs-unified-top-card') ||
    document.querySelector('.jobs-unified-top-card') ||
    null;
}

function stampListBadgeForCurrentJob(listing, result) {
  if (!STJ.injectListBadge || !listing || !result) return;
  const jobId = listing.platformJobId;
  if (!jobId) return;
  const stamped = Object.assign({}, result, { source: 'detail', daysOpen: listing.daysOpen });
  if (STJ.rememberListBadgeScore) {
    STJ.rememberListBadgeScore(jobId, stamped, { source: 'detail', daysOpen: listing.daysOpen });
  }
  const card =
    document.querySelector('[data-job-id="' + jobId + '"]') ||
    document.querySelector('[data-occludable-job-id="' + jobId + '"]') ||
    document.querySelector('li[data-occludable-job-id="' + jobId + '"] .job-card-container') ||
    findLinkedInJobCards().filter(function (el) { return jobIdFromCard(el) === String(jobId); })[0];
  if (!card) return;
  const anchor = card.querySelector(
    'a.job-card-list__title, a.job-card-container__link, a[href*="/jobs/view/"], .job-card-list__title--link'
  ) || card;
  STJ.injectListBadge(card, stamped, anchor);
  if (STJ.injectFreshBadge) STJ.injectFreshBadge(card, listing, anchor);
  if (STJ.applyCurrentListDim) STJ.applyCurrentListDim(card, stamped.score);
}

function jobIdFromHref(href) {
  const m = String(href || '').match(/\/jobs\/view\/(\d+)/);
  return m ? m[1] : null;
}

function isLinkedInListNode(el) {
  if (!el || !el.closest) return false;
  return !!(
    el.closest('.scaffold-layout__list') ||
    el.closest('.jobs-search-results-list') ||
    el.closest('.jobs-search-results__list')
  );
}

function companyLinkIn(container, titleAnchor) {
  if (!container || !container.querySelectorAll) return null;
  const links = container.querySelectorAll('a[href*="/company/"]');
  for (let i = 0; i < links.length; i++) {
    if (titleAnchor && links[i] === titleAnchor) continue;
    if (isLinkedInListNode(links[i])) continue;
    return links[i];
  }
  return null;
}

function metadataSnippet(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const m = raw.match(/.{0,80}(?:\b(?:reposted|posted)\b.{0,40})?\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\s+ago.{0,80}/i);
  const line = m ? m[0].trim() : raw;
  return line.slice(0, 200);
}

function isJobCardComponent(el) {
  if (!el || !el.getAttribute) return false;
  return (el.getAttribute('componentkey') || '').indexOf('job-card-component-ref-') === 0;
}

function isSearchResultsList(el) {
  if (!el || !el.getAttribute) return false;
  return el.getAttribute('componentkey') === 'SearchResultsMainContent';
}

function jobIdFromComponentKey(key) {
  const m = String(key || '').match(/^job-card-component-ref-(\d{5,})$/);
  return m ? m[1] : null;
}

function nodeContainsListRows(el) {
  if (!el || !el.querySelector) return false;
  if (isJobCardComponent(el) || isSearchResultsList(el)) return true;
  return !!el.querySelector('[componentkey^="job-card-component-ref-"], [componentkey="SearchResultsMainContent"]');
}

function isExtensionChrome(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.id === 'ghost-detector-overlay') return true;
  if (el.hasAttribute && el.hasAttribute('data-stj-overlay')) return true;
  const cl = el.classList;
  if (!cl) return false;
  return cl.contains('stj-list-badge') ||
    cl.contains('stj-fresh-badge') ||
    cl.contains('stj-fresh-row') ||
    cl.contains('ghost-detector-card') ||
    cl.contains('ghost-detector-signals') ||
    cl.contains('ghost-detector-signal');
}

// Injected Ghost Risk card and list badges. Reading them back in would
// score our own "actively reviewing" / Easy Apply chips as the job's.
const EXTENSION_CHROME_SELECTOR = '#ghost-detector-overlay, [data-stj-overlay], .stj-list-badge, .stj-fresh-badge, .stj-fresh-row, .ghost-detector-card, .ghost-detector-signals, .ghost-detector-signal';

function distinctViewIds(el) {
  const ids = {};
  if (!el) return [];
  if (el.getAttribute) {
    const own = jobIdFromHref(el.getAttribute('href'));
    if (own) ids[own] = true;
  }
  if (!el.querySelectorAll) return Object.keys(ids);
  const links = el.querySelectorAll('a[href*="/jobs/view/"]');
  for (let i = 0; i < links.length; i++) {
    const id = jobIdFromHref(links[i].getAttribute('href'));
    if (id) ids[id] = true;
  }
  return Object.keys(ids);
}

// A usable open-job ancestor: no results-list rows, and at most the one
// job this title link belongs to. A list CLASS on a wide shell is not
// enough — the shell's parent is where the rows actually appear.
function paneCandidateOk(el, jobId) {
  if (!el || el === document.body || el === document.documentElement) return false;
  if (isJobCardComponent(el) || isSearchResultsList(el) || nodeContainsListRows(el)) return false;
  const ids = distinctViewIds(el);
  if (ids.length > 1) return false;
  if (jobId && ids.length === 1 && ids[0] !== String(jobId)) return false;
  return true;
}

// Highest ancestor of the title link that still does not contain list rows.
// Depth 1 is the link's parent. The walk stops one level before the first
// ancestor that contains job-card rows or a second /jobs/view/ id.
function paneFromTitleAnchor(anchor, jobId) {
  let el = anchor && anchor.parentElement;
  let best = null;
  let depth = 0;
  for (let i = 1; i <= 40 && el && el !== document.body && el !== document.documentElement; i++) {
    if (!paneCandidateOk(el, jobId)) break;
    best = el;
    depth = i;
    el = el.parentElement;
  }
  return { el: best, depth: depth, anchor: anchor || null };
}

function nodeIsInList(el) {
  if (!el) return false;
  if (isLinkedInListNode(el)) return true;
  if (isJobCardComponent(el) || isSearchResultsList(el)) return true;
  if (el.closest && el.closest('.scaffold-layout__list, .jobs-search-results-list, .jobs-search-results__list, [data-stj-list-root]')) return true;
  if (el.closest && el.closest('[componentkey^="job-card-component-ref-"], [componentkey="SearchResultsMainContent"]')) return true;
  return false;
}

function nodeFollowsAnchor(anchor, node) {
  if (!anchor || !node) return true;
  if (anchor === node) return true;
  if (anchor.contains && anchor.contains(node)) return true;
  if (node.contains && node.contains(anchor)) return true;
  if (!anchor.compareDocumentPosition) return true;
  return (anchor.compareDocumentPosition(node) & 4) !== 0;
}

function normalizePiece(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function metadataSignal(text) {
  if (!text || !STJ.parseLinkedInMetadataLine) return null;
  const parsed = STJ.parseLinkedInMetadataLine(text);
  if (!parsed) return null;
  if (parsed.daysOpen == null && parsed.applicantCount == null && !parsed.isRepost) return null;
  return parsed;
}

function prefixBeforeSignal(text) {
  const norm = String(text || '')
    .replace(/[\u00a0\u202f\u2007\u2009\u200a\u2060]/g, ' ')
    .replace(/[·•・∙⋅\u2022\u2219\u2027\u30fb\u00b7|]/g, ' · ')
    .replace(/([A-Za-z])(?=(?:Reposted|Posted|Over|Be among)\b)/g, '$1 ')
    .replace(/([A-Za-z])(?=\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b)/gi, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = norm.match(/^(.*?)(?=\b(?:reposted|posted)\b|\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\s+ago|\bover\s+\d|\bbe among the first|\d[\d,]*\+?\s+(?:applicants?|people\s+clicked\s+apply))/i);
  if (!m) return null;
  return m[1].replace(/(?:\s*·\s*)+$/g, '').trim();
}

function lineIsTight(text) {
  const prefix = prefixBeforeSignal(text);
  return prefix != null && prefix.length <= 80;
}

function pieceHasAge(text) {
  const parsed = metadataSignal(text);
  return !!(parsed && (parsed.daysOpen != null || parsed.isRepost));
}

function siblingCluster(node) {
  const parent = node && node.parentElement;
  if (!parent) return String(node && node.textContent || '');
  const kids = Array.from(parent.childNodes);
  let child = node;
  while (child && child.parentElement && child.parentElement !== parent) child = child.parentElement;
  const idx = kids.indexOf(child);
  if (idx === -1) return String(node.textContent || '');
  let start = idx;
  let steps = 0;
  while (start > 0 && steps++ < 8) {
    const prevEl = kids[start - 1];
    const prev = normalizePiece(prevEl && prevEl.textContent);
    if (!prev) { start--; continue; }
    if (prev.length > 80) break;
    if (pieceHasAge(prev)) break;
    start--;
  }
  let end = idx;
  steps = 0;
  while (end < kids.length - 1 && steps++ < 8) {
    const nextEl = kids[end + 1];
    const next = normalizePiece(nextEl && nextEl.textContent);
    if (!next) { end++; continue; }
    if (next.length > 80) break;
    if (pieceHasAge(next)) break;
    end++;
  }
  const parts = [];
  for (let i = start; i <= end; i++) {
    const piece = normalizePiece(kids[i].textContent);
    if (piece) parts.push(piece);
  }
  return parts.join(' · ');
}

function widenToCluster(node) {
  let best = String(node && node.textContent || '');
  let current = node;
  for (let depth = 0; depth < 6 && current && current.parentElement; depth++) {
    const parent = current.parentElement;
    if (parent === document.body || parent === document.documentElement) break;
    if (nodeIsInList(parent)) break;
    const clustered = siblingCluster(current);
    const parsed = metadataSignal(clustered);
    if (parsed && lineIsTight(clustered)) {
      best = clustered;
      const prefix = prefixBeforeSignal(clustered);
      if (parsed.daysOpen != null && parsed.applicantCount != null && prefix && prefix.length > 0) return clustered;
    }
    current = parent;
  }
  return best;
}

function lineTextAround(node) {
  const own = String(node && node.textContent || '');
  // A title or company node must not expand into the card. That expansion
  // glues the title onto the place name and hides the age line.
  const ownParsed = metadataSignal(own);
  if (!ownParsed) return own;
  const ownPrefix = prefixBeforeSignal(own);
  const ownHasPlace = ownParsed.daysOpen != null && ownPrefix && ownPrefix.length > 0 && ownPrefix.length <= 80;
  if (ownHasPlace && ownParsed.applicantCount != null) return own;
  const wider = widenToCluster(node);
  const widerParsed = metadataSignal(wider);
  if (ownHasPlace) {
    if (widerParsed && widerParsed.applicantCount != null && lineIsTight(wider)) return wider;
    return own;
  }
  if (widerParsed && lineIsTight(wider)) return wider;
  return own;
}

function mergeMetadata(primary, extra) {
  if (!extra || !extra.parsed) return primary;
  if (!primary || !primary.parsed) return extra;
  const a = primary.parsed;
  const b = extra.parsed;
  const extraHasAge = b.daysOpen != null || b.applicantCount != null || b.isRepost;
  const primaryHasAge = a.daysOpen != null || a.applicantCount != null || a.isRepost;
  return {
    el: extraHasAge && !primaryHasAge ? (extra.el || primary.el) : (primary.el || extra.el),
    text: extraHasAge && !primaryHasAge ? (extra.text || primary.text) : (primary.text || extra.text),
    parsed: {
      location: a.location || b.location || null,
      daysOpen: a.daysOpen != null ? a.daysOpen : b.daysOpen,
      isRepost: a.isRepost != null ? a.isRepost : b.isRepost,
      applicantCount: a.applicantCount != null ? a.applicantCount : b.applicantCount,
    },
  };
}

function bestMetadataIn(root, anchor) {
  if (!root || !root.querySelectorAll || !STJ.parseLinkedInMetadataLine) return null;
  const nodes = root.querySelectorAll('p, div, span, li');
  let found = null;
  let ageParent = null;
  let line = '';
  const consider = function (text, el) {
    const parsed = STJ.parseLinkedInMetadataLine(text);
    if (!parsed) return;
    const hasSignal = parsed.daysOpen != null || parsed.applicantCount != null || parsed.isRepost;
    // A "City · On-site" bullet has no age. Keep it from winning the place
    // name ahead of the line that actually carries the relative time.
    if (!hasSignal) return;
    if (hasSignal && ageParent && el && el.parentElement !== ageParent && !ageParent.contains(el)) return;
    if (!found) {
      found = { el: el, text: text, parsed: { location: null, daysOpen: null, isRepost: null, applicantCount: null } };
    }
    const slot = found.parsed;
    if (!slot.location && parsed.location) slot.location = parsed.location;
    if (slot.daysOpen == null && parsed.daysOpen != null) slot.daysOpen = parsed.daysOpen;
    if (slot.isRepost == null && parsed.isRepost) slot.isRepost = true;
    if (slot.applicantCount == null && parsed.applicantCount != null) slot.applicantCount = parsed.applicantCount;
    if (hasSignal && !line) line = text;
    if (parsed.daysOpen != null && el && el.parentElement && !ageParent) ageParent = el.parentElement;
  };
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (isExtensionChrome(el)) continue;
    if (el.closest && el.closest('[componentkey^="job-card-component-ref-"], [componentkey="SearchResultsMainContent"], .jobs-search-results__list-item, .scaffold-layout__list-item, .job-card-container')) continue;
    if (el.closest && el.closest(EXTENSION_CHROME_SELECTOR)) continue;
    if (!nodeFollowsAnchor(anchor, el)) continue;
    const own = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!own || own.length > 220) continue;
    const text = lineTextAround(el);
    if (!text) continue;
    consider(text, el);
    if (found && found.parsed.daysOpen != null && found.parsed.applicantCount != null) break;
  }
  if (!found) return null;
  if (found.parsed.daysOpen == null && found.parsed.applicantCount == null && !found.parsed.isRepost && !found.parsed.location) return null;
  found.text = metadataSnippet(line || found.text);
  return found;
}

function detailPaneRoot() {
  if (typeof document === 'undefined' || !document.querySelector) return null;
  return document.querySelector('.jobs-search__job-details') ||
    document.querySelector('.scaffold-layout__detail') ||
    document.querySelector('.jobs-details') ||
    document.querySelector('main') ||
    document.querySelector('#main');
}

function readMetadataAround(anchor, jobId) {
  let el = anchor;
  let found = null;
  for (let i = 0; i < 20 && el && el !== document.body && el !== document.documentElement; i++) {
    if (isExtensionChrome(el)) break;
    // Stop at the same boundary as the open-job pane. A list class on a
    // shell that also wraps the detail must not end the walk at the title.
    if (i > 0 && !paneCandidateOk(el, jobId)) break;
    const hit = bestMetadataIn(el, anchor);
    if (hit && (hit.parsed.daysOpen != null || hit.parsed.applicantCount != null || hit.parsed.isRepost)) {
      found = mergeMetadata(found, hit);
      if (found.parsed.daysOpen != null && found.parsed.applicantCount != null) break;
    } else if (hit) {
      found = mergeMetadata(found, hit);
    }
    el = el.parentElement;
  }
  if (!found || found.parsed.daysOpen == null) {
    const pane = detailPaneRoot();
    if (pane && !nodeIsInList(pane)) {
      const paneHit = bestMetadataIn(pane, anchor);
      if (paneHit) found = mergeMetadata(found, paneHit);
    }
  }
  if (!found) return null;
  found.text = metadataSnippet(found.text);
  return found;
}

function findMetadataElement(root) {
  return bestMetadataIn(root, null);
}

function hasOtherJobViewLink(el, jobId) {
  if (!el || !el.querySelectorAll || !jobId) return false;
  const links = el.querySelectorAll('a[href*="/jobs/view/"]');
  for (let i = 0; i < links.length; i++) {
    const id = jobIdFromHref(links[i].getAttribute('href'));
    if (id && id !== String(jobId)) return true;
  }
  return false;
}

function containerForTitleAnchor(anchor, jobId) {
  // The company link often sits in the header, several levels above the
  // title and several below About the job. Keep walking to the highest
  // ancestor that still has no list rows.
  return paneFromTitleAnchor(anchor, jobId).el;
}

function anchorInRepeatingRow(anchor) {
  let el = anchor;
  for (let i = 0; i < 40 && el; i++) {
    if (isRepeatingJobRow(el)) return true;
    el = el.parentElement;
  }
  return false;
}

function anchorIsResultsRow(anchor) {
  if (!anchor || !anchor.closest) return false;
  if (anchor.closest('[componentkey^="job-card-component-ref-"], [componentkey="SearchResultsMainContent"]')) return true;
  if (anchor.closest('.jobs-search-results__list-item, .scaffold-layout__list-item, .job-card-container')) return true;
  // A list CLASS on a shell that also wraps the detail pane is not a row.
  return anchorInRepeatingRow(anchor);
}

function readHrefDetail(jobId) {
  if (!jobId || typeof document === 'undefined' || !document.querySelectorAll) return null;
  const anchors = Array.from(document.querySelectorAll('a[href*="/jobs/view/' + jobId + '"]'));
  const outside = anchors.filter(function (a) { return !anchorIsResultsRow(a); });
  let chosen = null;
  let container = null;
  for (let i = 0; i < outside.length; i++) {
    const c = containerForTitleAnchor(outside[i], jobId);
    if (!c) continue;
    if (companyLinkIn(c, outside[i])) {
      chosen = outside[i];
      container = c;
      break;
    }
  }
  if (!chosen && outside.length) {
    chosen = outside[outside.length - 1];
    container = containerForTitleAnchor(chosen, jobId) || chosen.parentElement;
  }
  if (!chosen || !container) return null;
  const company = companyLinkIn(container, chosen);
  // Age, repost, and applicants may sit outside the company-link wrapper.
  // Walk ancestors and, if needed, the detail pane. One value per field.
  const meta = readMetadataAround(chosen, jobId);
  const parsed = meta && meta.parsed;
  // A bare list-row title is not a loaded detail pane. Keep the title if
  // that is all we have, and leave scope unset so salary and hiring
  // contact stay unknown instead of false.
  const loaded = !!(company || parsed);
  return {
    title: (chosen.textContent || '').replace(/\s+/g, ' ').trim() || null,
    company: company ? (company.textContent || '').replace(/\s+/g, ' ').trim() : null,
    location: parsed ? parsed.location : null,
    daysOpen: parsed ? parsed.daysOpen : null,
    isRepost: parsed ? parsed.isRepost : null,
    applicantCount: parsed ? parsed.applicantCount : null,
    container: loaded ? container : null,
    metaEl: loaded && meta ? meta.el : null,
    metadataText: meta && meta.text ? meta.text : '',
  };
}

function readComponentKeyDetail(jobId) {
  if (!jobId || typeof document === 'undefined') return null;
  const nodes = document.querySelectorAll('[componentkey]');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const key = el.getAttribute('componentkey') || '';
    if (key.indexOf('job-card-component-ref-') === 0) continue;
    if (key.indexOf(String(jobId)) === -1) continue;
    if (isLinkedInListNode(el) || nodeIsInList(el) || hasOtherJobViewLink(el, jobId)) continue;
    const meta = readMetadataAround(el, jobId) || findMetadataElement(el);
    const parsed = meta && meta.parsed;
    const company = companyLinkIn(el, null);
    let title = null;
    const ps = el.querySelectorAll('p');
    for (let p = 0; p < ps.length; p++) {
      if (meta && ps[p] === meta.el) continue;
      if (company && ps[p].contains(company)) {
        const only = (ps[p].textContent || '').replace(/\s+/g, ' ').trim();
        const companyText = (company.textContent || '').replace(/\s+/g, ' ').trim();
        if (only === companyText) continue;
      }
      const t = (ps[p].textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length > 3 && t.length < 180 && !/[·|•]/.test(t)) { title = t; break; }
    }
    if (!title) {
      const heading = el.querySelector('h1, h2, strong');
      if (heading) title = (heading.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return {
      title: title,
      company: company ? (company.textContent || '').replace(/\s+/g, ' ').trim() : null,
      location: parsed ? parsed.location : null,
      daysOpen: parsed ? parsed.daysOpen : null,
      isRepost: parsed ? parsed.isRepost : null,
      applicantCount: parsed ? parsed.applicantCount : null,
      container: el,
      metaEl: meta ? meta.el : null,
      metadataText: meta && meta.text ? meta.text : '',
    };
  }
  return null;
}

function readGhostJobTopCard() {
  if (typeof document === 'undefined') return null;
  const headings = document.querySelectorAll('h1');
  for (let i = 0; i < headings.length; i++) {
    const h1 = headings[i];
    if (isLinkedInListNode(h1)) continue;
    const title = (h1.textContent || '').replace(/\s+/g, ' ').trim();
    if (!title || title.length < 3 || title.length > 180) continue;
    if (/\bjobs?\s+(in|near|hiring)\b/i.test(title)) continue;
    let el = h1.parentElement;
    const jobId = getCurrentJobId();
    for (let d = 0; d < 8 && el && el !== document.body; d++) {
      if (isLinkedInListNode(el) || hasOtherJobViewLink(el, jobId) || nodeContainsListRows(el)) break;
      const company = companyLinkIn(el, null);
      if (company) {
        const meta = readMetadataAround(h1, jobId) || findMetadataElement(el);
        const parsed = meta && meta.parsed;
        return {
          title: title,
          company: (company.textContent || '').replace(/\s+/g, ' ').trim(),
          location: parsed ? parsed.location : null,
          daysOpen: parsed ? parsed.daysOpen : null,
          isRepost: parsed ? parsed.isRepost : null,
          applicantCount: parsed ? parsed.applicantCount : null,
          container: el,
          metaEl: meta ? meta.el : null,
          metadataText: meta && meta.text ? meta.text : '',
        };
      }
      el = el.parentElement;
    }
  }
  return null;
}

function findJobPostingNode(node) {
  const stack = [node];
  let guard = 0;
  while (stack.length && guard++ < 400) {
    const n = stack.pop();
    if (!n) continue;
    if (Array.isArray(n)) {
      for (let i = 0; i < n.length; i++) stack.push(n[i]);
      continue;
    }
    if (typeof n !== 'object') continue;
    if (n['@graph']) stack.push(n['@graph']);
    const type = n['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.indexOf('JobPosting') !== -1)) return n;
  }
  return null;
}

function readJsonLdListing(jobId) {
  if (typeof document === 'undefined') return null;
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    let parsed;
    try { parsed = JSON.parse(scripts[i].textContent || ''); } catch (e) { continue; }
    const found = findJobPostingNode(parsed);
    if (!found) continue;
    const url = String(found.url || found['@id'] || '');
    if (jobId && /\/jobs\/view\/\d+|currentJobId=\d+/.test(url) && url.indexOf(String(jobId)) === -1) continue;
    let org = found.hiringOrganization;
    if (Array.isArray(org)) org = org[0];
    const company = typeof org === 'string' ? org : (org && org.name);
    let loc = found.jobLocation;
    if (Array.isArray(loc)) loc = loc[0];
    let location = null;
    if (typeof loc === 'string') location = loc;
    else if (loc && loc.address) {
      const a = loc.address;
      if (typeof a === 'string') location = a;
      else if (a) {
        location = [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ') || null;
      }
    }
    let description = found.description
      ? String(found.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : null;
    if (description && description.length <= 80) description = null;
    const days = found.datePosted && STJ.daysOpenFromIso ? STJ.daysOpenFromIso(found.datePosted) : null;
    return {
      title: found.title || found.name || null,
      companyName: company || null,
      location: location,
      daysOpen: days,
      description: description,
    };
  }
  return null;
}

function fillField(data, sources, field, value, approach) {
  if (value == null) return false;
  if (typeof value === 'string' && !value.trim()) return false;
  const current = data[field];
  if (typeof current === 'string' && current.trim()) return false;
  if (current != null && typeof current !== 'string') return false;
  data[field] = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;
  sources[field] = approach;
  return true;
}

function applyDetailFields(data, sources, detail, approach) {
  if (!detail) return;
  fillField(data, sources, 'title', detail.title, approach);
  fillField(data, sources, 'companyName', detail.company || detail.companyName, approach);
  fillField(data, sources, 'location', detail.location, approach);
  fillField(data, sources, 'daysOpen', detail.daysOpen, approach);
  fillField(data, sources, 'isRepost', detail.isRepost, approach);
  fillField(data, sources, 'applicantCount', detail.applicantCount, approach);
}

function readLinkedInDescription(root) {
  if (!root || !root.querySelector) return null;
  const readBest = function (el) {
    if (!el) return '';
    const tc = (el.textContent || '').replace(/[ \t]+/g, ' ').trim();
    const it = (el.innerText || '').trim();
    return tc.length >= it.length ? tc : it;
  };
  const sels = [
    '[data-testid="expandable-text-box"]',
    '.jobs-description-content__text',
    '.jobs-description__content',
    '.jobs-box__html-content',
    '[data-testid="job-details"]',
  ];
  let best = '';
  for (let i = 0; i < sels.length; i++) {
    const el = root.querySelector(sels[i]);
    const t = readBest(el);
    if (t.length > best.length) best = t;
    if (sels[i] === '[data-testid="expandable-text-box"]' && el && el.parentElement) {
      const parentText = readBest(el.parentElement);
      if (parentText.length > best.length) best = parentText;
    }
  }
  return best.length > 80 ? best : null;
}

function readMetaDescription() {
  if (typeof document === 'undefined' || !document.querySelector) return null;
  const candidates = [
    { el: document.querySelector('meta[property="og:description"]'), source: 'og:description' },
    { el: document.querySelector('meta[name="description"]'), source: 'meta-description' },
  ];
  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    if (!row.el || !row.el.getAttribute) continue;
    const text = normalizeBlock(row.el.getAttribute('content'));
    if (text.length > 80) return { text: text, source: row.source };
  }
  return null;
}

function normalizeBlock(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function ownText(el) {
  if (!el || !el.childNodes) return '';
  let direct = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    if (el.childNodes[i].nodeType === 3) direct += el.childNodes[i].textContent;
  }
  direct = normalizeBlock(direct);
  if (direct) return direct;
  if (!el.children || el.children.length === 0) return normalizeBlock(el.textContent);
  return '';
}

function isAboutJobHeading(el) {
  if (!el || el.nodeType !== 1 || isExtensionChrome(el)) return false;
  if (/^about the job:?$/i.test(ownText(el))) return true;
  const aria = el.getAttribute ? normalizeBlock(el.getAttribute('aria-label') || '') : '';
  const full = normalizeBlock(el.textContent);
  const tag = (el.tagName || '').toLowerCase();
  if (/^about the job:?$/i.test(aria) && full.length < 80) return true;
  if ((tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') && /^about the job\b/i.test(full) && full.length < 80) return true;
  return full.length < 40 && /^about the job:?$/i.test(full);
}

function isDisclosureControl(el) {
  if (!el) return false;
  const own = ownText(el);
  const full = normalizeBlock(el.textContent);
  const label = own || (full.length < 48 ? full : '');
  if (!label) return false;
  return /^(?:show|see)\s+(?:more|less)$/i.test(label);
}

function isSectionStop(el) {
  if (!el || isDisclosureControl(el)) return false;
  const own = ownText(el);
  const full = normalizeBlock(el.textContent);
  const label = own || (full.length < 48 ? full : '');
  if (!label) return false;
  return /^(?:about the company|set alert|similar jobs|more jobs|people also viewed|premium insights|meet the hiring team|job alerts)$/i.test(label);
}

function collectAfterHeading(root, heading) {
  const parts = [];
  let started = false;
  let stopped = false;
  function walk(el) {
    if (stopped || !el || !el.childNodes) return;
    for (let i = 0; i < el.childNodes.length; i++) {
      if (stopped) return;
      const child = el.childNodes[i];
      if (child === heading) {
        started = true;
        walk(heading);
        continue;
      }
      if (!started) {
        if (child.nodeType === 1 && child.contains && child.contains(heading)) walk(child);
        continue;
      }
      if (child.nodeType === 3) {
        parts.push(child.textContent || '');
        continue;
      }
      if (child.nodeType !== 1) continue;
      if (isExtensionChrome(child)) continue;
      if (isSectionStop(child)) { stopped = true; return; }
      if (isDisclosureControl(child)) {
        walk(child);
        continue;
      }
      let nestedStop = false;
      if (child.querySelectorAll) {
        const nodes = child.querySelectorAll('*');
        for (let n = 0; n < nodes.length; n++) {
          if (isSectionStop(nodes[n])) { nestedStop = true; break; }
        }
      }
      if (nestedStop) walk(child);
      else parts.push(child.textContent || '');
    }
  }
  if (root === heading) walk(heading);
  else walk(root);
  return normalizeBlock(parts.join(' '))
    .replace(/^about the job:?\s*/i, '')
    .replace(/\b(?:show|see)\s+(?:more|less)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textAfterHeading(heading) {
  let node = heading;
  // The live "About the job" h2 sits many levels under the uuid pane.
  // Walk up until the body after the heading is real, and stop before
  // the results list rather than at a fixed header-sized depth.
  for (let depth = 0; depth < 30 && node; depth++) {
    const chunk = collectAfterHeading(node, heading);
    if (chunk.length > 200) return chunk;
    const parent = node.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) break;
    if (nodeContainsListRows(parent) || isSearchResultsList(parent)) break;
    if (distinctViewIds(parent).length > 1) break;
    node = parent;
  }
  return '';
}

function readAboutJobDescription(root, opts) {
  const scopes = [];
  if (root && root.querySelectorAll) scopes.push(root);
  const allowBody = !!(opts && opts.allowBody);
  if (allowBody && typeof document !== 'undefined' && document.body && scopes.indexOf(document.body) === -1) {
    scopes.push(document.body);
  }
  for (let s = 0; s < scopes.length; s++) {
    const nodes = scopes[s].querySelectorAll('*');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (isExtensionChrome(el)) continue;
      if (el.closest && el.closest('[componentkey^="job-card-component-ref-"], [componentkey="SearchResultsMainContent"], #ghost-detector-overlay, [data-stj-overlay]')) continue;
      if (!isAboutJobHeading(el)) continue;
      const text = textAfterHeading(el);
      if (text && text.length > 200) return text;
    }
  }
  return null;
}

function readLongDetailBlock(root) {
  if (!root || !root.querySelectorAll) return null;
  const nodes = root.querySelectorAll('section, article, div, p, span');
  let best = '';
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el === root || isJobCardComponent(el) || isSearchResultsList(el) || nodeContainsListRows(el)) continue;
    if (isExtensionChrome(el) || (el.closest && el.closest(EXTENSION_CHROME_SELECTOR))) continue;
    // The title link's wrapper is the header, not the description.
    if (el.querySelector && el.querySelector('a[href*="/jobs/view/"]')) continue;
    const t = normalizeBlock(el.textContent);
    if (t.length <= 300 || t.length > 20000) continue;
    if (t.length > best.length) best = t;
  }
  return best || null;
}

function elementText(el) {
  if (!el) return '';
  const tc = el.textContent || '';
  const it = el.innerText || '';
  return tc.length >= it.length ? tc : it;
}

function stripNoise(el) {
  if (!el || !el.cloneNode) return el;
  const clone = el.cloneNode(true);
  if (!clone.querySelectorAll) return clone;
  const junk = clone.querySelectorAll(
    '[componentkey^="job-card-component-ref-"], [componentkey="SearchResultsMainContent"], .scaffold-layout__list, .jobs-search-results-list, .jobs-search-results__list, ' +
    EXTENSION_CHROME_SELECTOR
  );
  for (let i = 0; i < junk.length; i++) {
    if (junk[i].parentNode) junk[i].parentNode.removeChild(junk[i]);
  }
  return clone;
}

function textExcludingList(el) {
  if (!el) return '';
  if (isJobCardComponent(el) || isSearchResultsList(el)) return '';
  return elementText(stripNoise(el));
}

function locateOpenJobPane(jobId) {
  if (!jobId || typeof document === 'undefined' || !document.querySelectorAll) {
    return { el: null, depth: null, anchor: null };
  }
  const anchors = Array.from(document.querySelectorAll('a[href*="/jobs/view/' + jobId + '"]'));
  let best = { el: null, depth: null, anchor: null };
  let bestLen = 0;
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    if (anchorIsResultsRow(anchor)) continue;
    const located = paneFromTitleAnchor(anchor, jobId);
    if (!located.el) continue;
    const len = normalizeBlock(textExcludingList(located.el)).length;
    if (len > bestLen) {
      best = located;
      bestLen = len;
    }
  }
  return best;
}

function openJobDetailRoot(jobId) {
  return locateOpenJobPane(jobId).el;
}

function chooseSignalPane(scope, jobPane) {
  // A pane that also contains list rows is the page shell. Prefer the
  // open-job column. List-row phrases are not this job's signals.
  function usable(el) {
    if (!el || nodeContainsListRows(el)) return null;
    return el;
  }
  const a = usable(scope);
  const b = usable(jobPane);
  if (a && b) {
    if (a === b || (a.contains && a.contains(b))) return a;
    if (b.contains && b.contains(a)) return b;
    const aLen = normalizeBlock(elementText(a)).length;
    const bLen = normalizeBlock(elementText(b)).length;
    return bLen > aLen ? b : a;
  }
  return b || a || null;
}

function paneHasJobBody(pane) {
  if (!pane) return false;
  const legacy = pane.matches && pane.matches(
    '.jobs-search__job-details, .scaffold-layout__detail, .jobs-details, .job-details-jobs-unified-top-card, .jobs-unified-top-card'
  );
  if (legacy) return true;
  if (pane.querySelector && pane.querySelector(
    '.jobs-description, .jobs-description__content, .jobs-description-content__text, .jobs-box__html-content, [data-testid="expandable-text-box"], .jobs-details__main-content'
  )) return true;
  if (readAboutJobDescription(pane)) return true;
  if (normalizeBlock(pane.textContent).length > 700) return true;
  return false;
}

function singleJobIdIn(el) {
  if (!el) return null;
  let id = null;
  if (el.getAttribute) {
    const own = jobIdFromHref(el.getAttribute('href'));
    if (own) id = own;
  }
  if (!el.querySelectorAll) return id;
  const links = el.querySelectorAll('a[href*="/jobs/view/"]');
  for (let i = 0; i < links.length; i++) {
    if (links[i] === el) continue;
    const k = jobIdFromHref(links[i].getAttribute('href'));
    if (!k) continue;
    if (id && id !== k) return null;
    id = k;
  }
  return id;
}

function isRepeatingJobRow(el) {
  if (!el || !el.parentElement) return false;
  const parent = el.parentElement;
  // The page body holds the list column and the detail column. Rows repeat
  // inside the list, not as direct children of body.
  if (parent === document.body || parent === document.documentElement) return false;
  if (!singleJobIdIn(el)) return false;
  const rows = Array.from(parent.children).filter(function (ch) { return !!singleJobIdIn(ch); });
  const ids = {};
  for (let i = 0; i < rows.length; i++) ids[singleJobIdIn(rows[i])] = true;
  return rows.length >= 2 && Object.keys(ids).length >= 2 && rows.indexOf(el) !== -1;
}

function isDetailContainer(el) {
  if (!el || !el.querySelector) return false;
  if (isJobCardComponent(el)) return false;
  if (isRepeatingJobRow(el)) return false;
  if (el.hasAttribute && (el.hasAttribute('data-job-id') || el.hasAttribute('data-occludable-job-id'))) return false;
  return !!(companyLinkIn(el, null) && findMetadataElement(el));
}

function repeatingJobRow(anchor) {
  let el = anchor;
  for (let i = 0; i < 40 && el && el.parentElement; i++) {
    if (isRepeatingJobRow(el)) return el;
    const parent = el.parentElement;
    if (parent === document.body || parent === document.documentElement) break;
    el = parent;
  }
  const keyed = anchor.closest && anchor.closest('[componentkey^="job-card-component-ref-"]');
  if (keyed && !isDetailContainer(keyed)) {
    const id = jobIdFromHref(anchor.getAttribute('href'));
    const links = keyed.querySelectorAll('a[href*="/jobs/view/"]');
    const ids = {};
    for (let i = 0; i < links.length; i++) {
      const k = jobIdFromHref(links[i].getAttribute('href'));
      if (k) ids[k] = true;
    }
    if (id && Object.keys(ids).length === 1) return keyed;
  }
  return null;
}

function jobIdFromCard(card) {
  if (!card || !card.getAttribute) return null;
  const attr = card.getAttribute('data-job-id') || card.getAttribute('data-occludable-job-id');
  if (attr) return attr;
  const host = card.closest && (card.closest('[data-job-id]') || card.closest('[data-occludable-job-id]'));
  if (host && host !== card) {
    const v = host.getAttribute('data-job-id') || host.getAttribute('data-occludable-job-id');
    if (v) return v;
  }
  const fromKey = jobIdFromComponentKey(card.getAttribute('componentkey'));
  if (fromKey) return fromKey;
  const key = card.getAttribute('componentkey');
  if (key && key.indexOf('job-card-component-ref-') !== 0) {
    const m = String(key).match(/(\d{6,})/);
    if (m) return m[1];
  }
  const link = card.querySelector && card.querySelector('a[href*="/jobs/view/"]');
  if (link) return jobIdFromHref(link.getAttribute('href'));
  return null;
}

function findLinkedInJobCards() {
  if (typeof document === 'undefined') return [];
  const found = [];
  const add = function (el) {
    if (!el || el.nodeType !== 1 || isDetailContainer(el)) return;
    found.push(el);
  };
  document.querySelectorAll(
    'li.jobs-search-results__list-item, li.scaffold-layout__list-item, .job-card-container, [data-job-id], [data-occludable-job-id]'
  ).forEach(add);
  document.querySelectorAll('div[role="button"][componentkey^="job-card-component-ref-"]').forEach(add);
  document.querySelectorAll('[componentkey^="job-card-component-ref-"]').forEach(add);
  document.querySelectorAll('[componentkey]').forEach(function (el) {
    if (isJobCardComponent(el) || isSearchResultsList(el)) return;
    if (!el.querySelector('a[href*="/jobs/view/"]')) return;
    const ids = {};
    el.querySelectorAll('a[href*="/jobs/view/"]').forEach(function (a) {
      const id = jobIdFromHref(a.getAttribute('href'));
      if (id) ids[id] = true;
    });
    if (Object.keys(ids).length === 1) add(el);
  });
  document.querySelectorAll('a[href*="/jobs/view/"]').forEach(function (a) {
    const row = repeatingJobRow(a);
    if (row) add(row);
  });
  const byId = new Map();
  found.forEach(function (el) {
    const id = jobIdFromCard(el);
    if (!id) return;
    const prev = byId.get(id);
    if (!prev) byId.set(id, el);
    else if (el.contains(prev)) byId.set(id, el);
  });
  const rows = Array.from(byId.values());
  const visible = rows.filter(function (el) {
    return !rows.some(function (other) { return other !== el && other.contains(el); });
  });
  console.log('[SkipThisJob] LinkedIn list rows: ' + visible.length);
  return visible;
}

function linkedInMetadataAnchor(jobId) {
  const detail = readHrefDetail(jobId) || readComponentKeyDetail(jobId) || readGhostJobTopCard();
  return detail && detail.metaEl;
}

function parseLinkedInListing() {
  if (typeof document === 'undefined' || !document.querySelector) {
    return { title: null, companyName: null, daysOpen: null, description: null, salaryListed: null };
  }
  const data = {
    title: null,
    companyName: null,
    location: null,
    daysOpen: null,
    isRepost: null,
    applicantCount: null,
    salaryListed: null,
    hiringContactVisible: null,
    description: null,
    seniorityLevel: null,
    platformJobId: null,
    listingUrl: pageHref(),
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

  // Detail pane only. The first /jobs/view/ link on a search page is a
  // sidebar card. Each field takes the first approach that yields a value.
  const sources = {};
  const jobIdNow = getCurrentJobId();
  data.platformJobId = jobIdNow;

  const legacyRoot = linkedInDetailRoot();
  if (legacyRoot) {
    const titleEl = legacyRoot.querySelector('.job-details-jobs-unified-top-card__job-title h1') ||
      legacyRoot.querySelector('.jobs-unified-top-card__job-title') ||
      legacyRoot.querySelector('.job-details-jobs-unified-top-card__job-title') ||
      legacyRoot.querySelector('.t-24.t-bold') ||
      legacyRoot.querySelector('h1');
    if (!fillField(data, sources, 'title', titleEl && titleEl.textContent, 'legacy-selectors')) {
      const jobLinks = legacyRoot.querySelectorAll('a[href*="/jobs/view/"]');
      for (const link of jobLinks) {
        if (isLinkedInListNode(link)) continue;
        const text = link.textContent.trim();
        if (text && text.length > 3 && text.length < 150 && !text.includes('\n')) {
          fillField(data, sources, 'title', text, 'legacy-selectors');
          break;
        }
      }
    }
    const companyEl = legacyRoot.querySelector('.job-details-jobs-unified-top-card__company-name a') ||
      legacyRoot.querySelector('.jobs-unified-top-card__company-name a') ||
      legacyRoot.querySelector('.job-details-jobs-unified-top-card__company-name') ||
      legacyRoot.querySelector('.artdeco-entity-lockup__subtitle a');
    if (!fillField(data, sources, 'companyName', companyEl && companyEl.textContent, 'legacy-selectors')) {
      const allLinks = legacyRoot.querySelectorAll('a[href*="/company/"]');
      for (const link of allLinks) {
        if (isLinkedInListNode(link)) continue;
        const text = link.textContent.trim();
        if (text && text.length > 1 && text.length < 100) {
          fillField(data, sources, 'companyName', text, 'legacy-selectors');
          break;
        }
      }
    }
    const locationEl = legacyRoot.querySelector('.job-details-jobs-unified-top-card__bullet') ||
      legacyRoot.querySelector('.jobs-unified-top-card__bullet');
    fillField(data, sources, 'location', locationEl && locationEl.textContent, 'legacy-selectors');
    const ageRead = readLinkedInDaysOpen();
    fillField(data, sources, 'daysOpen', ageRead.days, 'legacy-selectors');
    const legacyText = legacyRoot.innerText || legacyRoot.textContent || '';
    fillField(data, sources, 'isRepost', /reposted/i.test(legacyText), 'legacy-selectors');
    const legacyApps = STJ.parseApplicantCount ? STJ.parseApplicantCount(legacyText) : null;
    fillField(data, sources, 'applicantCount', legacyApps, 'legacy-selectors');
  }

  const hrefDetail = readHrefDetail(jobIdNow);
  applyDetailFields(data, sources, hrefDetail, 'href-detail');
  const keyedDetail = readComponentKeyDetail(jobIdNow);
  applyDetailFields(data, sources, keyedDetail, 'componentkey');
  const ghostDetail = readGhostJobTopCard();
  applyDetailFields(data, sources, ghostDetail, 'ghostjob-top-card');
  const jsonLd = readJsonLdListing(jobIdNow);
  if (jsonLd) {
    fillField(data, sources, 'title', jsonLd.title, 'json-ld');
    fillField(data, sources, 'companyName', jsonLd.companyName, 'json-ld');
    fillField(data, sources, 'location', jsonLd.location, 'json-ld');
    fillField(data, sources, 'daysOpen', jsonLd.daysOpen, 'json-ld');
  }
  const ogEl = document.querySelector('meta[property="og:title"]');
  const ogParsed = STJ.parseLinkedInPageTitle
    ? STJ.parseLinkedInPageTitle(ogEl && ogEl.getAttribute('content'))
    : null;
  if (ogParsed) {
    fillField(data, sources, 'title', ogParsed.title, 'og-meta');
    fillField(data, sources, 'companyName', ogParsed.companyName, 'og-meta');
  }
  const docParsed = STJ.parseLinkedInPageTitle ? STJ.parseLinkedInPageTitle(document.title) : null;
  if (docParsed) {
    fillField(data, sources, 'title', docParsed.title, 'document-title');
    fillField(data, sources, 'companyName', docParsed.companyName, 'document-title');
  }

  const scope = legacyRoot ||
    (hrefDetail && hrefDetail.container) ||
    (keyedDetail && keyedDetail.container) ||
    (ghostDetail && ghostDetail.container) ||
    null;
  // The open-job column, not a header-sized legacy root and not a
  // search-only aside that sits next to the list. Search-results and
  // /jobs/view/ score this same pane. A module only one layout renders
  // stays unknown (0) on the layout that does not contain it.
  const locatedPane = locateOpenJobPane(jobIdNow);
  const jobPane = locatedPane.el;
  let signalPane = chooseSignalPane(scope, jobPane);
  // The company-link header is inside the real pane. Keep the highest
  // ancestor the title walk accepted, not the header-sized wrapper.
  if (jobPane && (!signalPane || (jobPane.contains && jobPane.contains(signalPane) && jobPane !== signalPane))) {
    signalPane = jobPane;
  }
  const cleanPane = signalPane ? stripNoise(signalPane) : null;
  const detailText = normalizeBlock(cleanPane ? elementText(cleanPane) : '').toLowerCase();
  const paneChars = detailText.length;
  let paneDepth = locatedPane.depth;
  if (signalPane && locatedPane.anchor && signalPane !== jobPane) {
    let walk = locatedPane.anchor;
    let depth = 0;
    paneDepth = null;
    while (walk && depth <= 40) {
      if (walk === signalPane) { paneDepth = depth; break; }
      walk = walk.parentElement;
      depth += 1;
    }
  }

  // One age log. The legacy top-card sentence is only for a legacy pane
  // that produced no age. A value from either path suppresses the other.
  if (data.daysOpen != null) {
    console.log('[SkipThisJob] Days open:', data.daysOpen, 'from:', sources.daysOpen || '');
  } else if (legacyRoot && !(hrefDetail && hrefDetail.metadataText)) {
    console.log('[SkipThisJob] Days open: null (no months/weeks/days-ago in top card)');
  } else {
    console.log('[SkipThisJob] Days open: null');
  }
  const metadataLine = (hrefDetail && hrefDetail.metadataText)
    || (keyedDetail && keyedDetail.metadataText)
    || (ghostDetail && ghostDetail.metadataText)
    || '';
  data.metadataLine = metadataLine;
  console.log('[SkipThisJob] LinkedIn metadata line:', metadataLine ? String(metadataLine).slice(0, 200) : '(none)');

  data.easyApply = signalPane ? /easy apply/.test(detailText) : false;
  sources.easyApply = data.easyApply ? 'detail' : 'none';

  // Salary is decided after the attribute row and description are read.
  // Until then it stays null (unknown), not "no salary".

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

  // Count the phrase only inside the open-job pane. A search-results
  // insight rail outside that pane is unknown (0) on both layouts, so it
  // cannot make the same job score differently from /jobs/view/.
  if (/responses?\s+managed\s+off\s+linkedin|managed\s+off\s+linkedin/i.test(detailText)) {
    data.responseManagedOffsite = true;
    sources.responseManagedOffsite = 'job-pane';
    console.log('[SkipThisJob] Responses managed off LinkedIn source=job-pane');
  } else {
    sources.responseManagedOffsite = 'none';
  }

  // === 0.1.8: Engagement signals and response time detection ===
  const engagementPatterns = [
    { pattern: /actively reviewing applicant/i, key: 'actively_reviewing' },
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
  data.engagementParsed = false;
  sources.activelyReviewing = data.engagementSignals.indexOf('actively_reviewing') === -1 ? 'none' : 'detail';
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
  let description = legacyRoot ? readLinkedInDescription(legacyRoot) : null;
  if (description) sources.description = 'legacy-selectors';
  if (!description && cleanPane && signalPane !== legacyRoot) {
    description = readLinkedInDescription(cleanPane);
    if (description) sources.description = 'href-detail';
  }
  if (!description && cleanPane) {
    description = readAboutJobDescription(cleanPane);
    if (description) sources.description = 'about-job';
  }
  if (!description && cleanPane) {
    description = readLongDetailBlock(cleanPane);
    if (description) sources.description = 'detail-text';
  }
  if (!description && jsonLd && jsonLd.description) {
    description = jsonLd.description;
    sources.description = 'json-ld';
  }
  if (!description) {
    const meta = readMetaDescription();
    if (meta) {
      description = meta.text;
      sources.description = meta.source;
    }
  }
  data.description = description;
  data.descriptionParsed = !!description;

  // Attribute chips only. Never document.body — the filter bar says "Remote"
  // on almost every search. If the chip row is missing, arrangement stays null.
  const topAttributeArea = cleanPane
    ? cleanPane.querySelector('._81f0ce2b, [data-testid*="job-attribute"], .job-details-jobs-unified-top-card__job-insight, .jobs-unified-top-card__job-insight')
    : null;
  const attributeText = topAttributeArea
    ? (topAttributeArea.textContent || '').toLowerCase()
    : '';

  if (topAttributeArea) {
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
  }

  const salaryHaystack = [attributeText, detailText, data.description || ''].join('\n');
  // A header cluster (title, company, metadata) is not the job body. Missing
  // salary, hiring contact, and review activity there are unparsed, so both
  // the search-results pane and /jobs/view/ charge those only when the body
  // actually loaded.
  const bodyLoaded = paneHasJobBody(cleanPane);
  data.engagementParsed = !!(signalPane && (bodyLoaded || data.engagementSignals.length));
  const sawSalary = !!(signalPane && STJ.looksLikeSalary && STJ.looksLikeSalary(salaryHaystack));
  if (sawSalary) {
    data.salaryListed = true;
    console.log('[GhostDetector] Salary found');
  } else if (!signalPane || !bodyLoaded) {
    data.salaryListed = null;
  } else {
    data.salaryListed = false;
  }

  // Hiring contact: only the hirer card inside the detail pane.
  // A page-wide /in/ link matches the nav "Me" profile on every logged-in page.
  if (!cleanPane || !bodyLoaded) {
    data.hiringContactVisible = null;
  } else {
    const hiringEl =
      cleanPane.querySelector('.job-details-people-who-can-help') ||
      cleanPane.querySelector('.jobs-poster__name') ||
      cleanPane.querySelector('.jobs-poster') ||
      cleanPane.querySelector('.hirer-card__hirer-information') ||
      cleanPane.querySelector('.hirer-card') ||
      cleanPane.querySelector('[data-testid="hirer-card"]') ||
      cleanPane.querySelector('[data-testid*="hiring-team"]');
    const profileInCard = cleanPane.querySelector(
      '.job-details-people-who-can-help a[href*="/in/"], .hirer-card a[href*="/in/"], [data-testid="hirer-card"] a[href*="/in/"], .jobs-poster a[href*="/in/"]'
    );
    const hasHiringTeamText = detailText.includes('meet the hiring team') ||
                              detailText.includes('people you can reach out to');
    data.hiringContactVisible = !!(hiringEl || profileInCard || hasHiringTeamText);
  }

  console.log('[GhostDetector] Hiring contact visible:', data.hiringContactVisible);

  // Seniority from detail panel text
  if (detailText.includes('entry level') || detailText.includes('internship')) data.seniorityLevel = 'entry';
  else if (detailText.includes('mid-senior')) data.seniorityLevel = 'senior';
  else if (detailText.includes('director')) data.seniorityLevel = 'director';
  else if (detailText.includes('executive')) data.seniorityLevel = 'c_suite';

  // Job ID from URL
  const href = pageHref();
  data.platformJobId = STJ.extractLinkedInJobId
    ? STJ.extractLinkedInJobId(href)
    : ((href.match(/currentJobId=(\d+)/) || href.match(/\/jobs\/view\/(\d+)/)) || [])[1] || null;
  if (STJ.canonicalListingUrl) {
    data.listingUrl = STJ.canonicalListingUrl(href, 'linkedin', data.platformJobId);
  }
  data.descriptionHash = STJ.hashDescription ? STJ.hashDescription(data.description) : null;
  data.fieldSources = sources;
  const trackedFields = ['title', 'companyName', 'location', 'daysOpen', 'isRepost', 'applicantCount', 'description', 'responseManagedOffsite', 'easyApply', 'activelyReviewing'];
  const sourceBits = trackedFields.map(function (k) { return k + '=' + (sources[k] || 'none'); });
  sourceBits.push('paneDepth=' + (paneDepth == null ? 'none' : String(paneDepth)));
  sourceBits.push('paneChars=' + String(paneChars));
  console.log('[SkipThisJob] LinkedIn field sources: ' + sourceBits.join(', '));

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
  if (STJ.detectSeniorityMismatch) return STJ.detectSeniorityMismatch(title, description, seniorityLevel);
  return false;
}

// --- End imported analysis helpers ---
//
// Score ranges (heuristic only, before backend blend):
//   0–34  Worth Applying
//   35–54 Proceed with Caution
//   55–74 Likely a Waste of Time
//   75–100 Skip This Job
//
// 0.2.2: age / engagement / description / floors live in shared.js
// (scoreListingSignals) so Indeed and list badges stay aligned.
// LinkedIn-only extras (hiring contact, no-response chip, combos) stay here.
function scoreLocally(listing) {
  const isHighTurnover = !!(listing.title && HIGH_TURNOVER_PATTERNS.some(p => p.test(listing.title)));
  const descForScore = listing.descriptionParsed === false
    ? ''
    : (typeof listing.description === 'string' ? listing.description : '');
  const vagueness = descForScore ? analyzeDescriptionVagueness(descForScore) : null;
  const seniorityMismatch = detectSeniorityMismatch(
    listing.title, listing.description || '', listing.seniorityLevel
  );

  if (STJ.scoreListingSignals) {
    return STJ.scoreListingSignals(listing, {
      platform: 'linkedin',
      isHighTurnover: isHighTurnover,
      vagueness: vagueness,
      afterShared: function (score, signals) {
        if (listing.hiringContactVisible === false) {
          score += 10;
          signals.push('No hiring contact — no one to follow up with');
        } else if (listing.hiringContactVisible == null) {
          signals.push('Hiring contact unknown');
        }
        if (listing.noResponseData) {
          score += 8;
          signals.push('No employer response data on LinkedIn');
        }
        const isOld = listing.daysOpen >= 14;
        const descText = listing.descriptionParsed === false
          ? ''
          : (typeof listing.description === 'string' ? listing.description.trim() : '');
        const descriptionWeak = descText.length > 0 && descText.length < 300;
        const missingBasics = listing.hiringContactVisible === false &&
                              descriptionWeak &&
                              listing.salaryListed === false;
        if (isOld && missingBasics) {
          score += 20;
          signals.push('Stale posting with multiple missing basics — low effort or ghost risk');
        }
        // Repost (+24) and applicant volume are already scored. A second
        // "high volume repost" add would count those same two facts again.
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

let _listBadgeObserver = null;
let dismissedJobId = null;

function teardownGhostDetector() {
  if (_ghostTornDown) return;
  _ghostTornDown = true;
  try { if (_ghostObserver) _ghostObserver.disconnect(); } catch (e) {}
  _ghostObserver = null;
  try { if (_listBadgeObserver) _listBadgeObserver.disconnect(); } catch (e) {}
  _listBadgeObserver = null;
  try { if (STJ.disconnectListBadgeObserver) STJ.disconnectListBadgeObserver(); } catch (e) {}
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
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Skip This Job ghost risk');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="ghost-detector-card" style="border-left: 4px solid ${color.border}; background: ${color.bg};">
      <div class="ghost-detector-header" style="display:flex; align-items:center; gap:6px; flex-wrap: wrap;">
        <span class="ghost-detector-icon">${color.icon}</span>
        <span class="ghost-detector-title">Ghost Risk: <strong style="color: ${color.text}">${labelText[finalLabel]}</strong></span>
        <span class="ghost-detector-score" style="color: ${color.text}">${finalScore}/100</span>
        ${backendData && backendData.live ? 
          `<span class="ghost-detector-live" style="background:#dcfce7;color:#166534;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:5px;font-weight:600;letter-spacing:0.3px;">● LIVE</span>` : ''}
        <button type="button" id="ghost-close-btn" aria-label="Close" style="margin-left:auto; cursor:pointer; font-size:16px; line-height:1; opacity:0.65; padding:2px 6px; background:transparent; border:0; color:inherit;">✕</button>
      </div>

      ${STJ.freshBadgeMarkup ? STJ.freshBadgeMarkup(listing) : ''}
      ${localScore.isHighTurnover ? 
        `<div style="font-size:9px; background:#fef3c7; color:#92400e; padding:1px 5px; border-radius:3px; margin-top:3px; display:inline-block; border:1px solid #fde68a;">High Turnover Role – Scoring Adjusted</div>` : ''}

      ${STJ.overlaySignalsHtml ? STJ.overlaySignalsHtml(finalSignals) : (finalSignals.length > 0 ? `
        <div class="ghost-detector-signals">
          ${finalSignals.map(s => `<span class="ghost-detector-signal">${STJ.escapeOverlayText ? STJ.escapeOverlayText(s) : s}</span>`).join('')}
        </div>
      ` : '')}
      ${STJ.glassdoorBlockHtml ? STJ.glassdoorBlockHtml(backendData && backendData.glassdoor) : ''}
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

  // One card per job. Drop any previous card before inserting this one.
  document.querySelectorAll('#ghost-detector-overlay, [data-stj-overlay="1"]').forEach(function (el) {
    el.remove();
  });
  overlay.id = 'ghost-detector-overlay';
  overlay.setAttribute('data-stj-overlay', '1');
  overlay.setAttribute('data-stj-job-id', listing && listing.platformJobId ? String(listing.platformJobId) : '');
  overlay.style.zIndex = '99999';
  overlay.style.maxWidth = '360px';
  overlay.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
  overlay.style.borderRadius = '10px';
  const metaAnchor = linkedInMetadataAnchor(listing && listing.platformJobId);
  _liMute = true;
  if (metaAnchor && metaAnchor.parentNode) {
    metaAnchor.insertAdjacentElement('afterend', overlay);
    overlay.setAttribute('data-stj-placement', 'metadata');
  } else {
    overlay.style.position = 'fixed';
    overlay.style.top = '80px';
    overlay.style.right = '20px';
    overlay.setAttribute('data-stj-placement', 'fixed');
    document.body.appendChild(overlay);
  }
  setTimeout(function () { _liMute = false; }, 0);
  if (listing && listing.platformJobId && String(listing.platformJobId) === String(getCurrentJobId())) {
    lastOverlayScore = localScore;
    lastOverlayBackend = backendData;
    lastProcessedJobId = String(listing.platformJobId);
    if (!currentListingData || String(currentListingData.platformJobId) !== String(listing.platformJobId)) {
      currentListingData = Object.assign({}, listing, { platform: 'linkedin' });
    }
  }
  if (typeof syncOverlayWithLinkedInDialogs === 'function') {
    syncOverlayWithLinkedInDialogs();
  }

  // Close button handler
  document.getElementById('ghost-close-btn')?.addEventListener('click', () => {
    overlay.remove();
    // Prevent the overlay from immediately re-appearing on the same job
    const closed = getCurrentJobId();
    dismissedJobId = closed;
    lastProcessedJobId = closed;
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

function pageHref() {
  try {
    return (window.location && window.location.href) || '';
  } catch (e) {
    return '';
  }
}

function getCurrentJobId() {
  const href = pageHref();
  if (!href) return null;
  if (STJ.extractLinkedInJobId) return STJ.extractLinkedInJobId(href);
  const match = href.match(/currentJobId=(\d+)/) || href.match(/\/jobs\/view\/(\d+)/);
  return match ? match[1] : null;
}

function isOnJobPage() {
  const url = pageHref();
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
    const jobId = getCurrentJobId();
    if (jobId && readHrefDetail(jobId)) return true;
    // Prefer both description AND a parsed top-card age (Baton/First Point
    // soak scored 6 because we ran before "5 months ago" was in the DOM).
    if (hasDesc && hasAge) return true;
    // Description is loaded. Don't hold an ageless listing until 80% of the
    // budget — a date that never arrives is "unknown", not a reason to wait.
    if (hasDesc && Date.now() - start > 1200) return true;
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
  if (typeof document === 'undefined' || !document.getElementById) return;
  const overlay = document.getElementById('ghost-detector-overlay');
  if (!overlay) return;
  const open = linkedInDialogOpen();
  overlay.style.visibility = open ? 'hidden' : '';
  overlay.style.pointerEvents = open ? 'none' : '';
}

function refreshLinkedInAfterMutation() {
  if (!extensionAlive()) { teardownGhostDetector(); return; }
  syncOverlayWithLinkedInDialogs();
  const jobId = getCurrentJobId();
  if (!jobId || getCurrentJobId() !== jobId) return;
  if (jobId !== lastProcessedJobId && !isProcessing) {
    processCurrentListing();
    return;
  }
  const overlay = document.getElementById('ghost-detector-overlay');
  if (!overlay && !isProcessing && lastOverlayScore && currentListingData &&
      String(currentListingData.platformJobId) === String(jobId)) {
    injectOverlay(lastOverlayScore, lastOverlayBackend, currentListingData);
  }
  refreshLinkedInListBadges();
}

function scheduleLinkedInRefresh() {
  if (_liRaf || _liMute) return;
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame.bind(window)
    : function (fn) { return setTimeout(fn, 16); };
  _liRaf = raf(function () {
    _liRaf = 0;
    if (_liMute) return;
    refreshLinkedInAfterMutation();
  });
}

function setupJobDetailObserver() {
  const container = linkedInDetailRoot()
    ? (document.querySelector('.jobs-search__job-details') ||
       document.querySelector('.scaffold-layout__detail') ||
       document.querySelector('#main') ||
       document.body)
    : document.body;

  if (!container || container._ghostObserverAttached) return;

  try { if (_ghostObserver) _ghostObserver.disconnect(); } catch (e) {}
  _ghostObserver = new MutationObserver(() => {
    if (!extensionAlive()) { teardownGhostDetector(); return; }
    if (_liMute) return;
    scheduleLinkedInRefresh();
  });

  _ghostObserver.observe(container, { childList: true, subtree: true });
  container._ghostObserverAttached = true;
  console.log('[SkipThisJob] MutationObserver attached to job detail container');
}

async function processCurrentListing() {
  if (!extensionAlive()) { teardownGhostDetector(); return; }
  const jobId = getCurrentJobId();
  if (!jobId || jobId === lastProcessedJobId || isProcessing) return;

  beginLinkedInJob(jobId);
  isProcessing = true;
  lastProcessedJobId = jobId;
  try {
    await runLinkedInListing(jobId);
  } catch (e) {
    console.warn('[SkipThisJob] processCurrentListing failed', e);
    isProcessing = false;
    lastProcessedJobId = null;
  }
}

function listingStillCurrent(jobId) {
  return !!jobId && getCurrentJobId() === jobId && dismissedJobId !== jobId;
}

function removeGhostOverlay() {
  document.querySelectorAll('#ghost-detector-overlay, [data-stj-overlay="1"]').forEach(function (el) {
    el.remove();
  });
}

function beginLinkedInJob(jobId) {
  document.querySelectorAll('#ghost-detector-overlay, [data-stj-overlay="1"]').forEach(function (el) {
    if (!jobId || el.getAttribute('data-stj-job-id') !== String(jobId)) el.remove();
  });
}

async function runLinkedInListing(jobId) {
  if (dismissedJobId && dismissedJobId !== jobId) dismissedJobId = null;

  // Adaptive wait — much more reliable than fixed 2s on cold loads
  const contentReady = await waitForLinkedInJobContent();
  if (getCurrentJobId() !== jobId || !listingStillCurrent(jobId)) {
    isProcessing = false;
    return;
  }
  if (!contentReady) {
    console.log('[SkipThisJob] Timed out waiting for job content — will retry on next poll');
    removeGhostOverlay();
    isProcessing = false;
    lastProcessedJobId = null; // allow retry
    return;
  }

  let listing = parseLinkedInListing();
  if (!listing.title || !listing.companyName) {
    const health = STJ.selectorHealth
      ? STJ.selectorHealth(listing, { platform: 'linkedin', require: ['title', 'companyName'] })
      : { missing: ['title', 'companyName'], state: 'unparsed' };
    if (STJ.logUnparsed) STJ.logUnparsed('linkedin', health);
    else console.warn('[SkipThisJob] unparsed linkedin — title, companyName. Not scoring.');
    removeGhostOverlay();
    isProcessing = false;
    lastProcessedJobId = null;
    return;
  }

  // Top-card age often paints after the description. Retry so Baton-like
  // "5 months ago" cannot score as a 6 with daysOpen still null.
  if (listing.daysOpen == null) {
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 350));
      if (getCurrentJobId() !== jobId) break;
      const again = parseLinkedInListing();
      if (again.platformJobId && again.platformJobId !== jobId) break;
      if (again.title) listing = again;
      if (listing.daysOpen != null) break;
    }
  }
  if (getCurrentJobId() !== jobId || (listing.platformJobId && listing.platformJobId !== jobId)) {
    console.warn('[SkipThisJob] LinkedIn job id changed during parse. Not scoring.');
    removeGhostOverlay();
    isProcessing = false;
    lastProcessedJobId = null;
    return;
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

  if (!listingStillCurrent(jobId)) {
    isProcessing = false;
    return;
  }
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
  if (!listingStillCurrent(jobId)) {
    isProcessing = false;
    return;
  }
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
  const jobCard = e.target.closest('a[href*="/jobs/view/"], [data-job-id], .job-card-container, .jobs-search-results__list-item, [componentkey^="job-card-component-ref-"]');
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

function isLegacyListCard(card) {
  if (!card || !card.getAttribute) return false;
  if (card.getAttribute('data-job-id') || card.getAttribute('data-occludable-job-id')) return true;
  const cl = card.classList;
  return !!(cl && (
    cl.contains('jobs-search-results__list-item') ||
    cl.contains('scaffold-layout__list-item') ||
    cl.contains('job-card-container')
  ));
}

function listBadgeAnchor(card) {
  if (!card || !card.querySelector) return card;
  const titled = card.querySelector('p');
  if (titled) return titled;
  return card.firstElementChild || card;
}

function cardParagraphText(el) {
  return String(el && el.textContent || '').replace(/\s+/g, ' ').trim();
}

function isLocationParagraph(text) {
  return /\([A-Za-z][A-Za-z -]*\)$/.test(text) || /,\s*[A-Z]{2}\b/.test(text);
}

function isBoilerplateParagraph(text) {
  if (!text) return true;
  if (/actively reviewing|easy apply|verified job|\bposted\b|\bago\b|benefit/i.test(text)) return true;
  if (/^viewed$/i.test(text)) return true;
  return false;
}

function parseJobCardParagraphs(card) {
  const ps = card.querySelectorAll ? card.querySelectorAll('p') : [];
  let title = '';
  let companyName = null;
  let location = null;
  let viewed = false;
  if (ps[0]) {
    const hidden = ps[0].querySelector('[aria-hidden="true"]');
    if (hidden) title = cardParagraphText(hidden);
    if (!title || title.length < 3) {
      title = cardParagraphText(ps[0]).replace(/\s*\(verified job\)\s*/ig, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  for (let i = 1; i < ps.length; i++) {
    const text = cardParagraphText(ps[i]);
    if (!text) continue;
    if (/\bviewed\b/i.test(text) && text.length < 24) viewed = true;
    if (isLocationParagraph(text)) {
      if (!location) location = text;
      continue;
    }
    if (isBoilerplateParagraph(text)) continue;
    if (!companyName && text.length < 120) companyName = text;
  }
  return { title: title, companyName: companyName, location: location, viewed: viewed };
}

function cardTitleText(card) {
  const fromParagraph = parseJobCardParagraphs(card).title;
  if (fromParagraph && fromParagraph.length >= 3 && fromParagraph.length < 180) return fromParagraph;
  const links = card.querySelectorAll('a[href*="/jobs/view/"]');
  let best = '';
  for (let i = 0; i < links.length; i++) {
    const raw = STJ.extensionChromeText ? STJ.extensionChromeText(links[i]) : (links[i].textContent || '');
    const t = String(raw).replace(/\s+/g, ' ').trim();
    if (t.length > best.length && t.length < 180) best = t;
  }
  if (best.length < 3) {
    for (let i = 0; i < links.length; i++) {
      const aria = links[i].getAttribute('aria-label') || links[i].getAttribute('title') || '';
      const t = String(aria).replace(/\s+/g, ' ').trim();
      if (t.length > best.length && t.length < 180) best = t;
    }
  }
  if (best.length >= 3) return best;
  const titleEl = card.querySelector(
    'a.job-card-list__title, a.job-card-container__link, .job-card-list__title--link, strong'
  );
  return String(titleEl && titleEl.textContent || '').replace(/\s+/g, ' ').trim();
}

function cardRowMetadata(card) {
  if (!card || !card.querySelectorAll || !STJ.parseLinkedInMetadataLine) return null;
  const nodes = card.querySelectorAll('p, div, span, li, time');
  const slot = { location: null, daysOpen: null, isRepost: null, applicantCount: null };
  let any = false;
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (STJ.isExtensionChromeNode && STJ.isExtensionChromeNode(el)) continue;
    // A node that also holds the title link glues the title onto the place.
    if (el.querySelector && el.querySelector('a[href*="/jobs/view/"]')) continue;
    const own = String(STJ.extensionChromeText ? STJ.extensionChromeText(el) : (el.textContent || '')).replace(/\s+/g, ' ').trim();
    if (!own || own.length > 220) continue;
    const parsed = STJ.parseLinkedInMetadataLine(own);
    if (!parsed) continue;
    const hasSignal = parsed.daysOpen != null || parsed.applicantCount != null || parsed.isRepost;
    if (!hasSignal) continue;
    any = true;
    if (!slot.location && parsed.location) slot.location = parsed.location;
    if (slot.daysOpen == null && parsed.daysOpen != null) slot.daysOpen = parsed.daysOpen;
    if (slot.isRepost == null && parsed.isRepost) slot.isRepost = true;
    if (slot.applicantCount == null && parsed.applicantCount != null) slot.applicantCount = parsed.applicantCount;
  }
  return any ? slot : null;
}

function parseLinkedInCard(card) {
  if (!card || !card.querySelector) return null;
  const title = cardTitleText(card);
  const platformJobId = jobIdFromCard(card);
  if (!title || title.length < 3) {
    // New-layout rows have no stable attributes. A row we cannot read is
    // skipped at debug level. Legacy cards still warn once.
    if (platformJobId && isLegacyListCard(card) && STJ.logUnparsedCard) {
      STJ.logUnparsedCard('linkedin', 'title selector missed');
    } else if (platformJobId) {
      console.debug('[SkipThisJob] skipped linkedin list row', platformJobId);
    }
    return null;
  }
  const paragraphs = parseJobCardParagraphs(card);
  const companyEl = card.querySelector(
    '.job-card-container__primary-description, .artdeco-entity-lockup__subtitle, .job-card-container__company-name, a[href*="/company/"]'
  );
  const dateEl = card.querySelector(
    'time, .job-card-container__listed-time, .job-card-list__footer-wrapper, .tvm__text'
  );
  const text = (STJ.extensionChromeText
    ? STJ.extensionChromeText(card)
    : (card.innerText || card.textContent || '')).toLowerCase();
  const meta = cardRowMetadata(card);
  const parseAge = STJ.parseLinkedInPostedAge || STJ.parseRelativeDays;
  const daysOpen = meta && meta.daysOpen != null
    ? meta.daysOpen
    : (parseAge && parseAge(text) != null
      ? parseAge(text)
      : (STJ.daysOpenFromCard
        ? STJ.daysOpenFromCard(card, dateEl, text)
        : null));
  const applicantCount = meta && meta.applicantCount != null
    ? meta.applicantCount
    : (STJ.parseApplicantCount ? STJ.parseApplicantCount(text) : null);
  const isRepost = (meta && meta.isRepost) || /reposted/.test(text) ? true : null;
  const reviewing = /actively reviewing applicants/i.test(text);
  return {
    title,
    companyName: companyEl ? companyEl.textContent.trim() : (paragraphs.companyName || null),
    location: (meta && meta.location) || paragraphs.location || null,
    platformJobId: platformJobId,
    daysOpen: daysOpen,
    isRepost: isRepost,
    salaryListed: STJ.looksLikeSalary && STJ.looksLikeSalary(text) ? true : undefined,
    applicantCount: applicantCount,
    easyApply: /easy apply/.test(text),
    viewed: paragraphs.viewed || /\bviewed\b/.test(text),
    engagementSignals: reviewing ? ['actively_reviewing'] : [],
    // A missing chip on a row is unparsed (0), not a confirmed absence.
    // The phrase on this row applies only to this row.
    engagementParsed: reviewing ? true : false,
    platform: 'linkedin',
  };
}

function refreshLinkedInListBadges() {
  if (!STJ.injectListBadge || !STJ.scoreListPreview || typeof document === 'undefined') return;
  const cards = findLinkedInJobCards();
  const seen = {};
  _liMute = true;
  try {
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      let parsed = null;
      try { parsed = parseLinkedInCard(card); } catch (e) { continue; }
      if (!parsed || !parsed.title) continue;
      const id = parsed.platformJobId || '';
      if (id && seen[id]) continue;
      if (id) seen[id] = true;
      const preview = STJ.scoreListPreview(parsed);
      const key = STJ.listBadgeKey ? STJ.listBadgeKey(card, parsed) : (id || null);
      const remembered = (STJ.lookupListBadgeScore && key && STJ.lookupListBadgeScore(key)) ||
        (STJ.readExistingBadge && STJ.readExistingBadge(card));
      const resolved = STJ.resolveListBadge
        ? STJ.resolveListBadge(preview, parsed, remembered)
        : { result: preview, kept: false };
      if (key && STJ.rememberListBadgeScore && !resolved.kept) {
        STJ.rememberListBadgeScore(key, resolved.result, {
          source: 'preview',
          daysOpen: parsed.daysOpen,
        });
      }
      const anchor = card.querySelector(
        'a.job-card-list__title, a.job-card-container__link, a[href*="/jobs/view/"], .job-card-list__title--link'
      ) || listBadgeAnchor(card);
      const stamped = Object.assign({}, resolved.result, {
        source: (resolved.result && resolved.result.source) || 'preview',
        daysOpen: resolved.result && resolved.result.daysOpen != null
          ? resolved.result.daysOpen
          : parsed.daysOpen,
      });
      STJ.injectListBadge(card, stamped, anchor);
      if (STJ.injectFreshBadge) STJ.injectFreshBadge(card, parsed, anchor);
      if (STJ.applyCurrentListDim) STJ.applyCurrentListDim(card, stamped.score);
    }
  } finally {
    // Clear before returning. The detail observer delivers our badge writes
    // and a later page mutation in one batch; a timer would still be muted
    // when that batch runs, and the Ghost Risk card would not come back.
    _liMute = false;
  }
}

function linkedInListRoot() {
  const known = document.querySelector('.scaffold-layout__list, .jobs-search-results-list, .jobs-search-results__list');
  if (known && known.querySelector('a[href*="/jobs/view/"]')) return known;
  const results = document.querySelector('[componentkey="SearchResultsMainContent"]');
  if (results && results.querySelector('[componentkey^="job-card-component-ref-"]')) return results;
  const cards = findLinkedInJobCards();
  return cards.length && cards[0].parentElement ? cards[0].parentElement : null;
}

function startLinkedInListBadges(opts) {
  if (_listBadgeObserver || !STJ.watchListBadges) return false;
  const root = linkedInListRoot();
  if (!root) return false;
  if (!root.id) root.setAttribute('data-stj-list-root', '1');
  const selector = root.id ? ('#' + root.id) : '[data-stj-list-root="1"]';
  _listBadgeObserver = STJ.watchListBadges({
    listRootSelector: selector,
    findCards() { return findLinkedInJobCards(); },
    parseCard: parseLinkedInCard,
    anchor(card) {
      return card.querySelector(
        'a.job-card-list__title, a.job-card-container__link, a[href*="/jobs/view/"], .job-card-list__title--link'
      ) || listBadgeAnchor(card);
    },
  });
  if (_listBadgeObserver && opts && opts.rescan) refreshLinkedInListBadges();
  return !!_listBadgeObserver;
}

// Initial run — only if we're on a job page
if (isOnJobPage()) {
  processCurrentListing();
  setupJobDetailObserver();
}
startLinkedInListBadges();

// Handle navigation within LinkedIn (SPA)
let lastObserverUrl = pageHref();
_ghostTimers.push(setInterval(() => {
  if (!extensionAlive()) { teardownGhostDetector(); return; }
  const href = pageHref();
  if (!href) return;
  if (isOnJobPage() && !_listBadgeObserver) startLinkedInListBadges({ rescan: true });
  if (href !== lastObserverUrl) {
    lastObserverUrl = href;

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
