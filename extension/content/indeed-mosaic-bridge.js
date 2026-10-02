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

  function textFromHtml(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20000);
  }

  function descriptionText(desc) {
    if (!desc) return '';
    if (typeof desc === 'string') return textFromHtml(desc);
    if (typeof desc === 'object') return textFromHtml(desc.content || desc.html || desc.text || '');
    return '';
  }

  function salaryTextFrom(header, model) {
    const candidates = [];
    if (header) candidates.push(header.salaryText, header.salary, header.extractedSalary);
    if (model) candidates.push(model.salary, model.extractedSalary);
    const meta = model && model.jobMetadataHeaderModel;
    if (meta) candidates.push(meta.salary, meta.salaryText);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c) continue;
      if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 200);
      if (typeof c === 'object') {
        const t = c.text || c.salaryText || c.display || '';
        if (t) return String(t).trim().slice(0, 200);
      }
    }
    return '';
  }

  function jobInfoFrom(node) {
    if (!node || typeof node !== 'object') return null;
    const wrapped = node.jobInfoWrapperModel &&
      (node.jobInfoWrapperModel.jobInfoModel || node.jobInfoWrapperModel);
    const model = wrapped || node.jobInfoModel || node;
    if (!model || typeof model !== 'object') return null;
    const header = model.jobInfoHeaderModel || model.header || null;
    const title = header && (header.jobTitle || header.title);
    const company = header && (header.companyName || header.company);
    if (!title && !company && !model.sanitizedJobDescription && !model.jobDescription) return null;
    return { model: model, header: header || {} };
  }

  // Standalone /viewjob does not publish window.mosaic. The posting lives
  // in window._rootProps.preloadedVJData (older pages: window._initialData).
  // The isolated content script cannot see those globals.
  function readViewJob() {
    const blobs = [];
    try {
      const root = window._rootProps;
      if (root && typeof root === 'object') {
        if (root.preloadedVJData && typeof root.preloadedVJData === 'object') blobs.push(root.preloadedVJData);
        blobs.push(root);
      }
    } catch (e) {}
    try {
      const initial = window._initialData;
      if (initial && typeof initial === 'object') blobs.push(initial);
    } catch (e) {}

    for (let i = 0; i < blobs.length; i++) {
      const found = jobInfoFrom(blobs[i]);
      if (!found) continue;
      const header = found.header;
      const model = found.model;
      const jobkey = String(header.jobKey || header.jobkey || model.jobKey || model.jobkey || '');
      const relative = header.formattedRelativeTime || header.relativeTime || model.formattedRelativeTime || '';
      const posted = header.datePosted || model.datePosted || null;
      return {
        jobkey: jobkey,
        title: String(header.jobTitle || header.title || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        company: String(header.companyName || header.company || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        location: String(header.formattedLocation || header.location || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        description: descriptionText(model.sanitizedJobDescription || model.jobDescription),
        salaryText: salaryTextFrom(header, model),
        formattedRelativeTime: String(relative || '').slice(0, 80),
        datePosted: typeof posted === 'string' ? posted : null,
      };
    }
    return null;
  }

  function viewJobRow(viewJob) {
    if (!viewJob || !viewJob.jobkey) return null;
    return {
      jobkey: viewJob.jobkey,
      displayTitle: viewJob.title || '',
      title: viewJob.title || '',
      company: viewJob.company || '',
      pubDate: viewJob.datePosted || null,
      formattedRelativeTime: viewJob.formattedRelativeTime || '',
      salarySnippet: { text: viewJob.salaryText || '' },
    };
  }

  function buildSnapshot() {
    const viewJob = readViewJob();
    const mosaic = window.mosaic;
    const providerData = mosaic && mosaic.providerData;
    if (!providerData || typeof providerData !== 'object') {
      if (!viewJob || (!viewJob.title && !viewJob.company)) return null;
      const row = viewJobRow(viewJob);
      return {
        ts: Date.now(),
        url: location.href,
        providers: {},
        jobs: row ? [row] : [],
        viewJob: viewJob,
      };
    }

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

    const viewRow = viewJobRow(viewJob);
    if (viewRow) addJob(viewRow, '_viewjob');

    if (Object.keys(providers).length === 0 && flat.length === 0 && !viewJob) {
      return null;
    }

    return {
      ts: Date.now(),
      url: location.href,
      providers: providers,
      jobs: flat,
      viewJob: viewJob,
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
      const viewKey = snap.viewJob
        ? (snap.viewJob.jobkey + '|' + snap.viewJob.title + '|' + snap.viewJob.company)
        : '';
      const fingerprint =
        json.length + '|' + snap.url + '|' + (snap.jobs ? snap.jobs.length : 0) +
        '|' + viewKey;
      if (fingerprint === lastWritten) return;
      const node = getNode();
      if (!node) return;
      node.textContent = json;
      lastWritten = fingerprint;
    } catch (e) {
      // Never throw into the page.
    }
  }

  // Poll until a snapshot with jobs exists, then stop. URL changes
  // (pushState / popstate) start a new burst. No forever 1.5s heartbeat.
  let ticks = 0;
  let fastTimer = null;

  function snapshotHasJobs() {
    const node = document.getElementById(NODE_ID);
    if (!node || !node.textContent) return false;
    try {
      const snap = JSON.parse(node.textContent);
      return !!(snap && Array.isArray(snap.jobs) && snap.jobs.length);
    } catch (e) {
      return false;
    }
  }

  function stopPoll() {
    if (fastTimer) {
      clearInterval(fastTimer);
      fastTimer = null;
    }
  }

  function startFastPoll() {
    if (fastTimer) return;
    ticks = 0;
    fastTimer = setInterval(() => {
      writeSnapshot();
      ticks += 1;
      if (snapshotHasJobs() || ticks > 100) stopPoll();
    }, 400);
  }

  // Re-snapshot immediately on SPA navigation (vjk= changes).
  const fireNav = () => setTimeout(() => {
    lastWritten = '';
    writeSnapshot();
    if (!snapshotHasJobs()) startFastPoll();
  }, 50);
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
  if (!snapshotHasJobs()) startFastPoll();
})();
