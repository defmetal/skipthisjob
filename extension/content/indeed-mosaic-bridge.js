// ============================================================
// Indeed Mosaic Bridge — Skip This Job
// ============================================================
//
// Runs in the PAGE'S MAIN WORLD (manifest "world": "MAIN").
//
// Why this file exists:
//   Indeed publishes job posting dates only inside the page's own JS
//   (window.mosaic.providerData["mosaic-provider-jobcards-N"]...). The
//   regular content script (indeed.js) runs in Chrome's ISOLATED world,
//   which has a separate `window` — so window.mosaic is undefined there
//   and every date lookup failed 100% of the time.
//
//   This bridge reads window.mosaic in the main world and mirrors a
//   minimal snapshot into a DOM node (#__stj_mosaic) that the isolated
//   content script can read synchronously. Declarative MAIN-world
//   injection is used instead of an injected <script src> because
//   Indeed's strict CSP blocks injected script tags.

(function () {
  'use strict';

  const NODE_ID = '__stj_mosaic';
  const MAX_JOBS = 400;
  const MAX_SECTION_CHARS = 24000;

  function pickJob(job) {
    if (!job || typeof job !== 'object') return null;
    const jobkey = job.jobkey || job.jobKey || job.jk || '';
    if (!jobkey && !job.displayTitle && !job.title) return null;
    return {
      jobkey: jobkey,
      displayTitle: job.displayTitle || '',
      title: job.title || '',
      company: job.company || job.companyName || '',
      link: job.link || '',
      url: job.url || job.viewJobLink || '',
      pubDate: job.pubDate || job.datePublished || null,
      createDate: job.createDate || job.dateCreated || null,
      formattedRelativeTime: job.formattedRelativeTime || job.relativeTimeAgo || '',
      salarySnippet: { text: (job.salarySnippet && job.salarySnippet.text) || '' },
      employerResponsive: !!(job.employerResponsive || job.oftenReplies),
      oftenReplies: !!job.oftenReplies,
      urgentlyHiring: !!job.urgentlyHiring,
    };
  }

  function collectJobsDeep(node, out, seen, depth) {
    if (!node || typeof node !== 'object' || depth > 14) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (typeof node.jobkey === 'string' || typeof node.jobKey === 'string' || typeof node.jk === 'string') {
      const picked = pickJob(node);
      if (picked && picked.jobkey) out.push(picked);
    }
    if (Array.isArray(node)) {
      const limit = Math.min(node.length, 80);
      for (let i = 0; i < limit; i++) collectJobsDeep(node[i], out, seen, depth + 1);
      return;
    }
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length && i < 60; i++) {
      const v = node[keys[i]];
      if (v && typeof v === 'object') collectJobsDeep(v, out, seen, depth + 1);
    }
  }

  function buildSnapshot() {
    const mosaic = window.mosaic;
    const providerData = mosaic && mosaic.providerData;
    if (!providerData || typeof providerData !== 'object') return null;

    const providers = {};
    const flat = [];
    const seenKeys = {};
    let total = 0;

    function addJob(job, providerKey) {
      const p = pickJob(job);
      if (!p || !p.jobkey) return;
      const k = String(p.jobkey).toLowerCase();
      if (seenKeys[k]) return;
      seenKeys[k] = true;
      if (total >= MAX_JOBS) return;
      flat.push(p);
      total++;
      if (providerKey) {
        if (!providers[providerKey]) providers[providerKey] = { results: [] };
        providers[providerKey].results.push(p);
      }
    }

    for (const key of Object.keys(providerData)) {
      const provider = providerData[key];
      if (!provider) continue;

      let results = null;
      if (
        provider.metaData &&
        provider.metaData.mosaicProviderJobCardsModel &&
        Array.isArray(provider.metaData.mosaicProviderJobCardsModel.results)
      ) {
        results = provider.metaData.mosaicProviderJobCardsModel.results;
      } else if (Array.isArray(provider.results)) {
        results = provider.results;
      }

      if (results && results.length) {
        for (const job of results) addJob(job, key);
      }
    }

    // /viewjob and some right-pane providers keep the selected job outside
    // mosaicProviderJobCardsModel.results — walk the rest of the tree.
    if (flat.length < MAX_JOBS) {
      const deep = [];
      collectJobsDeep(providerData, deep, new Set(), 0);
      for (const job of deep) addJob(job, '_deep');
    }

    // Right-pane (vjk=) detail views keep the human-readable posting date
    // inside the job-details insights provider rather than in pubDate.
    let jobDetailsSectionText = '';
    try {
      const dp = providerData['js-match-insights-provider-job-details'];
      const section = dp && dp.jobDetailsSection;
      if (section) {
        jobDetailsSectionText = JSON.stringify(section)
          .toLowerCase()
          .slice(0, MAX_SECTION_CHARS);
      }
    } catch (e) {}

    if (Object.keys(providers).length === 0 && flat.length === 0 && !jobDetailsSectionText) {
      return null;
    }

    return {
      ts: Date.now(),
      url: location.href,
      providers: providers,
      jobs: flat,
      jobDetailsSectionText: jobDetailsSectionText,
    };
  }

  function getNode() {
    let node = document.getElementById(NODE_ID);
    if (!node) {
      node = document.createElement('script');
      node.type = 'application/json';
      node.id = NODE_ID;
      const root = document.documentElement || document.head || document.body;
      if (!root) return null;
      root.appendChild(node);
    }
    return node;
  }

  let lastWritten = '';

  function writeSnapshot() {
    try {
      const snap = buildSnapshot();
      if (!snap) return;
      const json = JSON.stringify(snap);
      // Skip the providers/section payload comparison cost: only the ts/url
      // change every tick, so compare everything except ts.
      const fingerprint =
        json.length + '|' + snap.url + '|' + JSON.stringify(snap.providers).length +
        '|' + (snap.jobs ? snap.jobs.length : 0) +
        '|' + snap.jobDetailsSectionText.length;
      if (fingerprint === lastWritten) return;
      const node = getNode();
      if (!node) return;
      node.textContent = json;
      lastWritten = fingerprint;
    } catch (e) {
      // Never throw into the page.
    }
  }

  // Indeed hydrates the mosaic providers late and is a SPA, so poll
  // aggressively at first, then settle into a slow heartbeat that still
  // catches client-side navigations between job listings.
  let ticks = 0;
  const fast = setInterval(() => {
    writeSnapshot();
    if (++ticks > 100) {
      clearInterval(fast);
      setInterval(writeSnapshot, 1500);
    }
  }, 400);

  // Re-snapshot immediately on SPA navigation (vjk= changes).
  const fireNav = () => setTimeout(writeSnapshot, 50);
  try {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () {
      const r = origPush.apply(this, arguments);
      fireNav();
      return r;
    };
    history.replaceState = function () {
      const r = origReplace.apply(this, arguments);
      fireNav();
      return r;
    };
    window.addEventListener('popstate', fireNav);
  } catch (e) {}

  writeSnapshot();
})();
