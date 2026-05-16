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
    return {
      jobkey: job.jobkey || '',
      displayTitle: job.displayTitle || '',
      title: job.title || '',
      company: job.company || '',
      link: job.link || '',
      url: job.url || '',
      pubDate: job.pubDate || null,
      createDate: job.createDate || null,
      formattedRelativeTime: job.formattedRelativeTime || '',
      salarySnippet: { text: (job.salarySnippet && job.salarySnippet.text) || '' },
    };
  }

  function buildSnapshot() {
    const mosaic = window.mosaic;
    const providerData = mosaic && mosaic.providerData;
    if (!providerData || typeof providerData !== 'object') return null;

    const providers = {};
    let total = 0;

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

      if (!results || results.length === 0) continue;

      const slim = [];
      for (const job of results) {
        if (total >= MAX_JOBS) break;
        const p = pickJob(job);
        if (p) {
          slim.push(p);
          total++;
        }
      }
      if (slim.length) providers[key] = { results: slim };
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

    if (Object.keys(providers).length === 0 && !jobDetailsSectionText) {
      return null;
    }

    return {
      ts: Date.now(),
      url: location.href,
      providers: providers,
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
