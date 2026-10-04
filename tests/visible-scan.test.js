'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { load: loadLinkedIn } = require('./helpers/linkedin-dom.js');

const WARNING = 'Opens listings for you to fill in scores. Slight risk of triggering bot detection.';
const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function jobsUrl(id) {
  return 'https://www.linkedin.com/jobs/search-results/?currentJobId=' + (id || '1111111111');
}

function loadPage(html, url, store) {
  const listeners = [];
  const dom = loadLinkedIn(html, url, {
    decorateChrome(chrome) {
      chrome.storage.local.get = function (key, cb) {
        const out = {};
        if (typeof key === 'string' && store && Object.prototype.hasOwnProperty.call(store, key)) {
          out[key] = store[key];
        }
        if (cb) cb(out);
      };
      chrome.storage.local.set = function (obj, cb) {
        if (store && obj) Object.assign(store, obj);
        if (cb) cb();
      };
      chrome.storage.onChanged.addListener = function (fn) { listeners.push(fn); };
    },
  });
  dom._scanListeners = listeners;
  return dom;
}

function emitStorage(dom, key, value) {
  (dom._scanListeners || []).forEach((fn) => {
    fn({ [key]: { newValue: value } }, 'local');
  });
}

function rowIds(count, prefix) {
  const rows = [];
  for (let i = 0; i < count; i++) rows.push({ id: (prefix || 'job-') + (i + 1) });
  return rows;
}

async function runScan(win, overrides) {
  const progress = [];
  const delays = [];
  const clicked = [];
  let restored = null;
  const opts = Object.assign({
    rows: rowIds(3),
    rng: () => 0,
    sleep: async (ms) => { delays.push(ms); return true; },
    clickRow(row) { clicked.push(row.id); },
    waitForScore: async () => ({ ok: true }),
    shouldStop: () => false,
    safety: () => null,
    isForeground: () => true,
    onProgress(text) { progress.push(text); },
    onDelay(ms) { delays.push(ms); },
    restore(id) { restored = id; },
    originalJobId: 'orig-job',
  }, overrides || {});
  // onDelay and sleep both record delays. Prefer the runner's sleep only.
  if (!overrides || !overrides.sleep) {
    opts.onDelay = undefined;
  }
  if (overrides && overrides.onDelay) opts.onDelay = overrides.onDelay;
  const result = await win.runVisibleListingScan(opts);
  return { result, progress, delays, clicked, restored };
}

const BOTH_LAYOUTS = `
<div componentkey="SearchResultsMainContent">
  <div role="button" id="new-row" componentkey="job-card-component-ref-1111111111">
    <div componentkey="job-card-component-ref-1111111111">
      <p><span aria-hidden="true">Engineer</span></p>
      <p>Acme</p>
      <p>Austin, TX · 3 months ago</p>
      <a href="https://www.linkedin.com/jobs/view/1111111111/">Engineer</a>
      <button id="new-apply" class="jobs-apply-button">Easy Apply</button>
    </div>
  </div>
  <div role="button" id="new-row-2" componentkey="job-card-component-ref-2222222222">
    <p><span aria-hidden="true">Designer</span></p>
    <p>Other Co</p>
    <a href="https://www.linkedin.com/jobs/view/2222222222/">Designer</a>
  </div>
</div>
<ul class="jobs-search-results-list">
  <li id="legacy-row" class="jobs-search-results__list-item" data-occludable-job-id="3333333333">
    <a id="legacy-link" class="job-card-container__link" href="https://www.linkedin.com/jobs/view/3333333333/">Analyst Easy Apply</a>
    <button id="legacy-apply" class="jobs-apply-button">Easy Apply</button>
    <a id="legacy-company" href="https://www.linkedin.com/company/acme/">Acme</a>
  </li>
  <li id="legacy-apply-only" class="jobs-search-results__list-item" data-occludable-job-id="4444444444">
    <a id="apply-link" href="https://www.linkedin.com/jobs/view/4444444444/">Easy Apply</a>
    <button class="jobs-apply-button">Apply</button>
  </li>
</ul>
<button id="lonely-apply" class="jobs-apply-button">Easy Apply</button>
<div class="jobs-description"><h1>Complete a CAPTCHA training module</h1><p>Background verification is required. This is not unusual activity.</p></div>
`;

test('popup toggle defaults off, stores only on change, and has one warning line', () => {
  const html = read('extension/popup/popup.html');
  const js = read('extension/popup/popup.js');
  const wrap = new JSDOM(html).window.document.getElementById('stj-scan-wrap');
  assert.ok(wrap);
  assert.deepEqual([...wrap.children].map((el) => el.tagName), ['LABEL', 'P']);
  assert.equal(wrap.querySelectorAll('p').length, 1);
  assert.equal(wrap.querySelector('p').textContent, WARNING);
  assert.equal(wrap.querySelector('button'), null);
  const box = wrap.querySelector('#stj-scan-visible');
  assert.equal(box.checked, false);
  assert.equal(box.hasAttribute('checked'), false);
  assert.equal(html.split(WARNING).length - 1, 1);
  assert.equal(read('extension/content/overlay.css').includes(WARNING), false);
  assert.equal(read('extension/content/linkedin.js').includes(WARNING), false);
  assert.doesNotMatch(js, /\bconfirm\s*\(/);
  assert.doesNotMatch(read('extension/content/linkedin.js'), /\bconfirm\s*\(/);
  assert.match(js, /stjScanVisible/);
  assert.doesNotMatch(js, /runVisibleListingScan|SCAN_VISIBLE/);

  function boot(store) {
    const confirms = [];
    const sets = [];
    const dom = new JSDOM(html, { url: 'https://skipthisjob.com/', runScripts: 'outside-only' });
    const w = dom.window;
    w.confirm = () => { confirms.push(1); return true; };
    w.chrome = {
      runtime: { id: 'test', lastError: null, sendMessage(_msg, cb) { if (cb) cb(null); } },
      tabs: {
        query(_q, cb) { cb([{ id: 1, url: jobsUrl() }]); },
        sendMessage(_id, _msg, cb) { if (cb) cb(null); },
      },
      storage: {
        local: {
          get(key, cb) {
            const out = {};
            if (typeof key === 'string' && store && Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
            cb(out);
          },
          set(obj, cb) { sets.push(obj); if (cb) cb(); },
        },
        onChanged: { addListener() {} },
      },
    };
    w.eval(js);
    return { dom, sets, confirms };
  }

  const off = boot({});
  const offBox = off.dom.window.document.getElementById('stj-scan-visible');
  assert.equal(offBox.checked, false);
  assert.equal(off.sets.some((entry) => Object.prototype.hasOwnProperty.call(entry, 'stjScanVisible')), false);
  assert.equal(off.confirms.length, 0);
  offBox.checked = true;
  offBox.dispatchEvent(new off.dom.window.Event('change'));
  assert.equal(off.sets[off.sets.length - 1].stjScanVisible, true);
  assert.equal(off.confirms.length, 0);
  offBox.checked = false;
  offBox.dispatchEvent(new off.dom.window.Event('change'));
  assert.equal(off.sets[off.sets.length - 1].stjScanVisible, false);
  off.dom.window.close();

  const on = boot({ stjScanVisible: true });
  assert.equal(on.dom.window.document.getElementById('stj-scan-visible').checked, true);
  assert.equal(on.sets.length, 0);
  on.dom.window.close();

  const stringly = boot({ stjScanVisible: 'true' });
  assert.equal(stringly.dom.window.document.getElementById('stj-scan-visible').checked, false);
  stringly.dom.window.close();
});

test('manifest version and permissions are unchanged', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.version, '0.2.6');
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab']);
  assert.deepEqual(manifest.host_permissions, [
    '*://*.linkedin.com/*',
    '*://*.indeed.com/*',
    'https://skipthisjob.com/*',
  ]);
  assert.deepEqual(manifest.content_scripts.map((script) => script.matches), [
    ['*://*.linkedin.com/jobs/*', '*://*.linkedin.com/feed/*'],
    ['*://*.indeed.com/*'],
    ['*://*.indeed.com/*'],
  ]);
  assert.deepEqual(manifest.content_scripts.map((script) => script.js), [
    ['content/shared.js', 'content/linkedin.js'],
    ['content/indeed-mosaic-bridge.js'],
    ['content/shared.js', 'content/indeed.js'],
  ]);
  assert.equal(read('extension/content/indeed.js').includes('Scan visible listings'), false);
  assert.equal(read('extension/background/service-worker.js').includes('Scan visible listings'), false);
});

test('scan does not start on load when the setting is off or on', async () => {
  const linkedin = read('extension/content/linkedin.js');
  assert.equal(linkedin.split('runVisibleListingScan(').length - 1, 1);

  const off = loadPage('<div id="list"></div>', jobsUrl(), {});
  try {
    assert.equal(off.window.document.getElementById('stj-scan-bar'), null);
    let runs = 0;
    off.window.runVisibleListingScan = () => { runs += 1; return Promise.resolve({}); };
    off.window.onScanStartClick();
    assert.equal(runs, 0);
  } finally {
    off.window.close();
  }

  const on = loadPage(BOTH_LAYOUTS, jobsUrl(), { stjScanVisible: true });
  try {
    const doc = on.window.document;
    const bar = doc.getElementById('stj-scan-bar');
    assert.ok(bar);
    assert.equal(doc.getElementById('stj-scan-start').textContent, 'Scan visible listings');
    assert.equal(doc.getElementById('stj-scan-stop').hidden, true);
    assert.equal(doc.getElementById('stj-scan-progress').textContent, '');
    let runs = 0;
    const rowClicks = [];
    doc.addEventListener('click', (event) => {
      const row = event.target.closest && event.target.closest(
        '[componentkey^="job-card-component-ref-"], .jobs-search-results__list-item, .jobs-apply-button'
      );
      if (row && !event.target.closest('#stj-scan-bar')) rowClicks.push(row.id || row.className);
    }, true);
    on.window.runVisibleListingScan = () => { runs += 1; return Promise.resolve({}); };
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(runs, 0);
    assert.deepEqual(rowClicks, []);
    emitStorage(on, 'stjScanVisible', true);
    assert.equal(runs, 0);
    assert.ok(doc.getElementById('stj-scan-bar'));
  } finally {
    on.window.close();
  }
});

test('the scan button is the only way to start, and Stop is visible while scanning', async () => {
  const dom = loadPage(BOTH_LAYOUTS, jobsUrl(), { stjScanVisible: true });
  try {
    const doc = dom.window.document;
    let runs = 0;
    let release;
    dom.window.runVisibleListingScan = function (deps) {
      runs += 1;
      assert.equal(typeof deps.clickRow, 'function');
      assert.equal(typeof deps.restore, 'function');
      assert.equal(deps.rows.length <= 25, true);
      deps.onProgress('Scanning 7/25');
      assert.equal(doc.getElementById('stj-scan-progress').textContent, 'Scanning 7/25');
      assert.equal(doc.getElementById('stj-scan-stop').hidden, false);
      assert.equal(doc.getElementById('stj-scan-start').hidden, true);
      doc.getElementById('stj-scan-stop').click();
      assert.equal(deps.shouldStop(), true);
      deps.onProgress('Stopped');
      assert.equal(doc.getElementById('stj-scan-progress').textContent, 'Stopped');
      return new Promise((resolve) => { release = resolve; });
    };
    doc.getElementById('stj-scan-start').click();
    doc.getElementById('stj-scan-start').click();
    assert.equal(runs, 1);
    release({ stopped: true, reason: 'Stopped' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(doc.getElementById('stj-scan-stop').hidden, true);
    assert.equal(doc.getElementById('stj-scan-start').hidden, false);
    doc.getElementById('stj-scan-start').click();
    assert.equal(runs, 2);
  } finally {
    dom.window.close();
  }
});

test('turning the setting off removes the button and does not scan', () => {
  const dom = loadPage(BOTH_LAYOUTS, jobsUrl(), { stjScanVisible: true });
  try {
    assert.ok(dom.window.document.getElementById('stj-scan-start'));
    let runs = 0;
    dom.window.runVisibleListingScan = () => { runs += 1; return Promise.resolve({}); };
    emitStorage(dom, 'stjScanVisible', false);
    assert.equal(dom.window.document.getElementById('stj-scan-bar'), null);
    dom.window.onScanStartClick();
    assert.equal(runs, 0);
    emitStorage(dom, 'stjScanVisible', true);
    assert.ok(dom.window.document.getElementById('stj-scan-start'));
    assert.equal(runs, 0);
  } finally {
    dom.window.close();
  }
});

test('a hidden tab never starts a scan', () => {
  const dom = loadPage(BOTH_LAYOUTS, jobsUrl(), { stjScanVisible: true });
  try {
    let runs = 0;
    dom.window.runVisibleListingScan = () => { runs += 1; return Promise.resolve({}); };
    Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => true });
    dom.window.document.getElementById('stj-scan-start').click();
    assert.equal(runs, 0);
    assert.equal(dom.window.document.getElementById('stj-scan-progress').textContent, 'Stopped: tab is in the background');
  } finally {
    dom.window.close();
  }
});

test('delay, batch size, and cap', async () => {
  const dom = loadPage('<div></div>', 'https://www.linkedin.com/feed/', {});
  try {
    const win = dom.window;
    const cfg = win.visibleScanConfig();
    assert.equal(cfg.cap, 25);
    assert.equal(cfg.batchSize, 5);
    assert.equal(cfg.rowDelayMin, 1500);
    assert.equal(cfg.rowDelayMax, 4000);
    assert.ok(cfg.batchPauseMin > cfg.rowDelayMax);
    assert.equal(win.visibleScanDelayMs(1, () => 0), 1500);
    assert.equal(win.visibleScanDelayMs(4, () => 1), 4000);
    assert.equal(win.visibleScanDelayMs(5, () => 0), cfg.batchPauseMin);
    assert.equal(win.visibleScanDelayMs(5, () => 1), cfg.batchPauseMax);
    assert.ok(win.visibleScanDelayMs(10, () => 0) > win.visibleScanDelayMs(9, () => 1));

    const six = await runScan(win, { rows: rowIds(6), originalJobId: 'orig-job' });
    assert.deepEqual(six.clicked, ['job-1', 'job-2', 'job-3', 'job-4', 'job-5', 'job-6']);
    assert.deepEqual(six.delays, [1500, 1500, 1500, 1500, cfg.batchPauseMin]);
    assert.equal(six.progress[0], 'Scanning 1/6');
    assert.equal(six.progress[5], 'Scanning 6/6');
    assert.equal(six.restored, 'orig-job');
    assert.equal(six.result.restored, true);

    const capped = await runScan(win, {
      rows: rowIds(40).concat([{ id: 'job-1' }]),
      rng: () => 1,
    });
    assert.equal(capped.clicked.length, 25);
    assert.equal(capped.clicked[0], 'job-1');
    assert.equal(capped.clicked[24], 'job-25');
    assert.equal(capped.delays.length, 24);
    assert.equal(capped.progress[6], 'Scanning 7/25');
    assert.equal(capped.progress[24], 'Scanning 25/25');
    capped.delays.forEach((ms, index) => {
      const completed = index + 1;
      if (completed % 5 === 0) assert.equal(ms, cfg.batchPauseMax);
      else assert.equal(ms, cfg.rowDelayMax);
    });
    assert.equal(capped.clicked.filter((id) => id === 'job-1').length, 1);

    const exactBatch = await runScan(win, { rows: rowIds(5) });
    assert.equal(exactBatch.delays.length, 4);
    assert.ok(exactBatch.delays.every((ms) => ms === 1500));
  } finally {
    dom.window.close();
  }
});

test('stop, auto-stop, background, and restore', async () => {
  const dom = loadPage('<div></div>', 'https://www.linkedin.com/feed/', {});
  try {
    const win = dom.window;

    let clicks = 0;
    const stopped = await runScan(win, {
      rows: rowIds(10),
      shouldStop: () => clicks >= 4,
      clickRow() { clicks += 1; },
    });
    assert.equal(clicks, 4);
    assert.equal(stopped.progress[stopped.progress.length - 1], 'Stopped');
    assert.equal(stopped.restored, 'orig-job');
    assert.equal(stopped.result.scanned, 4);

    const reasons = [
      'Stopped: CAPTCHA',
      'Stopped: unusual activity',
      'Stopped: rate limit',
      'Stopped: verification checkpoint',
      'Stopped: left the jobs page',
    ];
    for (const reason of reasons) {
      let n = 0;
      let restored = false;
      const outcome = await runScan(win, {
        rows: rowIds(8),
        clickRow() { n += 1; },
        safety: () => (n >= 2 ? reason : null),
        restore() { restored = true; },
      });
      assert.equal(n, 2, reason);
      assert.equal(restored, false, reason);
      assert.equal(outcome.progress[outcome.progress.length - 1], reason);
      assert.equal(outcome.result.restored, false);
    }

    const aborted = await runScan(win, {
      rows: rowIds(5),
      waitForScore: async (_row, index) => {
        if (index === 1) return { aborted: true, reason: 'Stopped: CAPTCHA' };
        return { ok: true };
      },
    });
    assert.deepEqual(aborted.clicked, ['job-1', 'job-2']);
    assert.equal(aborted.restored, null);
    assert.equal(aborted.progress[aborted.progress.length - 1], 'Stopped: CAPTCHA');

    const userWait = await runScan(win, {
      rows: rowIds(5),
      waitForScore: async (_row, index) => (index === 0 ? { aborted: true, reason: 'Stopped', user: true } : { ok: true }),
    });
    assert.deepEqual(userWait.clicked, ['job-1']);
    assert.equal(userWait.restored, 'orig-job');

    const hidden = await runScan(win, {
      rows: rowIds(5),
      isForeground: () => false,
    });
    assert.deepEqual(hidden.clicked, []);
    assert.equal(hidden.restored, null);
    assert.equal(hidden.progress[0], 'Stopped: tab is in the background');

    let seen = 0;
    const hiddenMid = await runScan(win, {
      rows: rowIds(5),
      clickRow() { seen += 1; },
      isForeground: () => seen < 2,
    });
    assert.equal(seen, 2);
    assert.equal(hiddenMid.restored, null);
    assert.equal(hiddenMid.progress[hiddenMid.progress.length - 1], 'Stopped: tab is in the background');

    const noOriginal = await runScan(win, { rows: rowIds(2), originalJobId: null });
    assert.equal(noOriginal.restored, null);
    assert.equal(noOriginal.result.restored, false);

    const empty = await runScan(win, { rows: [] });
    assert.deepEqual(empty.clicked, []);
    assert.deepEqual(empty.progress, ['No visible listings']);
    assert.equal(empty.restored, null);
  } finally {
    dom.window.close();
  }
});

test('safety reasons come from the page, not from a real job description', () => {
  const dom = loadPage(BOTH_LAYOUTS, jobsUrl(), {});
  try {
    const win = dom.window;
    assert.equal(win.currentScanSafetyReason(), null);
    assert.equal(win.scanSafetyReason({
      href: jobsUrl(),
      path: '/jobs/search-results/',
      title: 'Engineer | LinkedIn',
      challengeText: '',
    }), null);
    assert.equal(win.scanSafetyReason({
      href: 'https://www.linkedin.com/checkpoint/challenge/abc',
      path: '/checkpoint/challenge/abc',
      title: '',
    }), 'Stopped: verification checkpoint');
    assert.equal(win.scanSafetyReason({
      href: 'https://www.linkedin.com/feed/',
      path: '/feed/',
      title: 'Feed | LinkedIn',
    }), 'Stopped: left the jobs page');
    assert.equal(win.scanSafetyReason({
      href: jobsUrl(),
      path: '/jobs/search-results/',
      title: "We've detected unusual activity",
    }), 'Stopped: unusual activity');
    assert.equal(win.scanSafetyReason({
      href: jobsUrl(),
      path: '/jobs/search-results/',
      title: 'Too many requests',
    }), 'Stopped: rate limit');
    assert.equal(win.scanSafetyReason({
      href: 'https://www.linkedin.com/jobs/search/?captcha=1',
      path: '/jobs/search/',
      title: '',
    }), 'Stopped: CAPTCHA');

    win.document.title = "Let's do a quick security check";
    assert.equal(win.currentScanSafetyReason(), 'Stopped: verification checkpoint');
    win.document.title = 'Engineer | LinkedIn';
    const challenge = win.document.createElement('h1');
    challenge.textContent = "We've detected unusual activity";
    win.document.body.appendChild(challenge);
    assert.equal(win.currentScanSafetyReason(), 'Stopped: unusual activity');
    challenge.remove();

    const frame = win.document.createElement('iframe');
    frame.setAttribute('src', 'https://www.google.com/recaptcha/api2/anchor');
    win.document.body.appendChild(frame);
    assert.equal(win.currentScanSafetyReason(), 'Stopped: CAPTCHA');
    frame.remove();
    assert.equal(win.currentScanSafetyReason(), null);

    win.history.pushState({}, '', 'https://www.linkedin.com/feed/');
    assert.equal(win.currentScanSafetyReason(), 'Stopped: left the jobs page');
  } finally {
    dom.window.close();
  }
});

test('both layouts click one list row per job and store the opened-job score once', () => {
  const dom = loadPage(BOTH_LAYOUTS, 'https://www.linkedin.com/feed/', {});
  try {
    const win = dom.window;
    const doc = win.document;
    const rows = win.collectVisibleScanRows();
    const ids = [...rows.map((row) => row.id)].sort();
    assert.deepEqual(ids, ['1111111111', '2222222222', '3333333333', '4444444444']);
    assert.equal(doc.querySelectorAll('[componentkey="job-card-component-ref-1111111111"]').length, 2);
    assert.equal(rows.filter((row) => row.id === '1111111111').length, 1);

    const newTarget = win.scanClickTarget(doc.getElementById('new-row'));
    assert.equal(newTarget, doc.getElementById('new-row'));
    assert.equal(newTarget.getAttribute('role'), 'button');
    assert.notEqual(newTarget, doc.getElementById('new-apply'));

    const legacyTarget = win.scanClickTarget(doc.getElementById('legacy-row'));
    assert.equal(legacyTarget, doc.getElementById('legacy-link'));
    assert.notEqual(legacyTarget, doc.getElementById('legacy-apply'));
    assert.notEqual(legacyTarget, doc.getElementById('legacy-company'));

    const applyOnly = win.scanClickTarget(doc.getElementById('legacy-apply-only'));
    assert.equal(applyOnly, doc.getElementById('legacy-apply-only'));
    assert.notEqual(applyOnly.id, 'apply-link');
    assert.equal(win.scanClickTarget(doc.getElementById('lonely-apply')), null);
    assert.equal(win.scanClickTarget(doc.getElementById('legacy-company')), null);

    const messages = [];
    win.chrome.runtime.sendMessage = (msg, cb) => { messages.push(msg); if (cb) cb(null); };
    win.currentListingData = {
      platformJobId: '3333333333',
      companyName: 'Acme',
      title: 'Analyst',
      platform: 'linkedin',
      userClickedApply: false,
    };
    const clicked = win.clickScanRow(doc.getElementById('legacy-row'));
    assert.equal(clicked, doc.getElementById('legacy-link'));
    assert.equal(win.currentListingData.userClickedApply, false);
    assert.equal(messages.some((msg) => msg && (msg.type === 'USER_CLICKED_APPLY' || (msg.listingData && msg.listingData.userClickedApply))), false);
    win.clickScanRow(doc.getElementById('new-row'));
    assert.equal(win.currentListingData.userClickedApply, false);

    function openedListing(id, title) {
      return {
        title: title,
        companyName: 'Acme',
        platformJobId: id,
        daysOpen: 90,
        isRepost: true,
        salaryListed: false,
        hiringContactVisible: false,
        noResponseData: true,
        description: 'Short and vague.',
        descriptionParsed: true,
        applicantCount: 400,
        engagementSignals: [],
        platform: 'linkedin',
      };
    }

    const stamped = {};
    rows.forEach((row) => {
      const listing = openedListing(row.id, row.id === '2222222222' ? 'Designer' : 'Engineer');
      const opened = win.scoreLocally(listing);
      const parsed = win.parseLinkedInCard(row.card);
      if (parsed && parsed.title) {
        const preview = win.SkipThisJobShared.scoreListPreview(parsed);
        assert.notEqual(opened.score, preview.score, row.id);
      }
      win.stampListBadgeForCurrentJob(listing, opened);
      win.stampListBadgeForCurrentJob(listing, opened);
      stamped[row.id] = opened;
      const remembered = win.SkipThisJobShared.lookupListBadgeScore(row.id);
      assert.equal(remembered.source, 'detail');
      assert.equal(remembered.score, opened.score);
      assert.deepEqual(remembered.signals, opened.signals);
      assert.equal(row.card.querySelectorAll('.stj-list-badge').length, 1);
      const badge = row.card.querySelector('.stj-list-badge');
      assert.equal(badge.getAttribute('data-stj-score'), String(opened.score));
      assert.equal(badge.getAttribute('data-stj-source'), 'detail');
    });
    assert.equal(doc.querySelectorAll('.stj-list-badge').length, 4);
    assert.equal(doc.querySelectorAll('#ghost-detector-overlay, [data-stj-overlay="1"]').length, 0);

    win.refreshLinkedInListBadges();
    rows.forEach((row) => {
      const opened = stamped[row.id];
      const remembered = win.SkipThisJobShared.lookupListBadgeScore(row.id);
      assert.equal(remembered.score, opened.score);
      assert.equal(remembered.signals.length, opened.signals.length);
      assert.equal(row.card.querySelectorAll('.stj-list-badge').length, 1);
    });
    assert.equal(doc.querySelectorAll('#ghost-detector-overlay').length, 0);

    const depsSrc = linkedinSlice('function buildVisibleScanDeps', 'function onScanStartClick');
    assert.equal(depsSrc.includes('injectOverlay'), false);
    assert.equal(depsSrc.includes('fetch('), false);
    assert.equal(depsSrc.includes('fetchEmployerScore'), false);
  } finally {
    dom.window.close();
  }
});

function linkedinSlice(startMark, endMark) {
  const src = read('extension/content/linkedin.js');
  const start = src.indexOf(startMark);
  const end = src.indexOf(endMark, start + startMark.length);
  assert.ok(start !== -1 && end !== -1);
  return src.slice(start, end);
}

test('runner stores the same score opening the job would, then restores the original row', async () => {
  const dom = loadPage(BOTH_LAYOUTS, 'https://www.linkedin.com/feed/', { stjScanVisible: true });
  try {
    const win = dom.window;
    const allRows = win.collectVisibleScanRows();
    const rows = ['1111111111', '2222222222'].map((id) => allRows.find((row) => row.id === id));
    const targets = [];
    const scores = {};
    let restoredId = null;
    const run = await runScan(win, {
      rows: rows,
      originalJobId: '1111111111',
      clickRow(row) {
        const target = win.scanClickTarget(row.card);
        targets.push(target);
        const listing = {
          title: 'Engineer',
          companyName: 'Acme',
          platformJobId: row.id,
          daysOpen: 90,
          isRepost: true,
          salaryListed: false,
          hiringContactVisible: false,
          noResponseData: true,
          description: 'Short and vague.',
          descriptionParsed: true,
          applicantCount: 400,
          engagementSignals: [],
          platform: 'linkedin',
        };
        const opened = win.scoreLocally(listing);
        scores[row.id] = opened;
        win.stampListBadgeForCurrentJob(listing, opened);
      },
      waitForScore(row) {
        const mem = win.SkipThisJobShared.lookupListBadgeScore(row.id);
        assert.equal(mem.score, scores[row.id].score);
        assert.deepEqual(mem.signals, scores[row.id].signals);
        return { ok: true };
      },
      restore(id) {
        restoredId = id;
        const card = win.collectVisibleScanRows().find((row) => row.id === id).card;
        const target = win.scanClickTarget(card);
        assert.equal(target, win.document.getElementById('new-row'));
        assert.notEqual(target, win.document.getElementById('new-apply'));
        return target;
      },
    });
    assert.equal(targets.length, 2);
    assert.equal(targets[0].id, 'new-row');
    assert.notEqual(targets[0], win.document.getElementById('new-apply'));
    assert.equal(restoredId, '1111111111');
    assert.equal(run.result.restored, true);
    assert.equal(win.document.querySelectorAll('.stj-list-badge').length, 2);
    assert.equal(win.document.querySelectorAll('#ghost-detector-overlay').length, 0);
  } finally {
    dom.window.close();
  }
});
