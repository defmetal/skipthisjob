'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../extension/lib/access.js');

function fakeChrome({ granted, requestResult, activeTab } = {}) {
  const calls = { badge: [], title: [], created: [], requested: [], reloaded: [] };
  let has = !!granted;
  return {
    calls,
    permissions: {
      contains: async () => has,
      request: async (p) => { calls.requested.push(p); has = requestResult !== undefined ? requestResult : true; return has; },
    },
    action: {
      setBadgeText: async (o) => calls.badge.push(o.text),
      setBadgeBackgroundColor: async () => {},
      setTitle: async (o) => calls.title.push(o.title),
    },
    tabs: {
      create: async (o) => calls.created.push(o.url),
      query: async () => [activeTab || { id: 7, url: 'https://www.indeed.com/jobs?q=x' }],
      reload: async (id) => calls.reloaded.push(id),
    },
    runtime: { getURL: (p) => 'chrome-extension://abc/' + p },
  };
}

test('required origins cover LinkedIn and Indeed', () => {
  assert.deepEqual(A.REQUIRED_ORIGINS, ['*://*.linkedin.com/*', '*://*.indeed.com/*']);
});

test('required origins equal restored host_permissions job sites only', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
  // Published 0.2.2 host set. Do not grow or narrow this.
  assert.deepEqual(m.host_permissions, [
    '*://*.linkedin.com/*',
    '*://*.indeed.com/*',
    'https://skipthisjob.com/*',
  ]);
  const jobHosts = m.host_permissions.filter((h) => /linkedin\.com|indeed\.com/.test(h));
  assert.deepEqual(A.REQUIRED_ORIGINS, jobHosts);
  assert.equal(A.REQUIRED_ORIGINS.some((o) => /skipthisjob/.test(o)), false);
  assert.equal(m.version, '0.2.3');
  for (const cs of m.content_scripts) {
    for (const match of cs.matches) assert.ok(match.startsWith('*://'), match);
  }
});

test('install with access missing: "!" badge + onboarding tab', async () => {
  const c = fakeChrome({ granted: false });
  const r = await A.handleInstalled({ reason: 'install' }, c);
  assert.equal(r.granted, false);
  assert.equal(r.openedOnboarding, true);
  assert.deepEqual(c.calls.badge, ['!']);
  assert.deepEqual(c.calls.created, ['chrome-extension://abc/onboarding/onboarding.html']);
});

test('update with access missing also opens onboarding', async () => {
  const c = fakeChrome({ granted: false });
  const r = await A.handleInstalled({ reason: 'update' }, c);
  assert.equal(r.openedOnboarding, true);
});

test('update with access granted: badge cleared, no onboarding', async () => {
  const c = fakeChrome({ granted: true });
  const r = await A.handleInstalled({ reason: 'update' }, c);
  assert.equal(r.granted, true);
  assert.equal(r.openedOnboarding, false);
  assert.deepEqual(c.calls.badge, ['']);
  assert.deepEqual(c.calls.created, []);
});

test('other onInstalled reasons (chrome_update) never open a tab', async () => {
  const c = fakeChrome({ granted: false });
  const r = await A.handleInstalled({ reason: 'chrome_update' }, c);
  assert.equal(r.openedOnboarding, false);
  assert.deepEqual(c.calls.badge, ['!']);
});

test('hasSiteAccess is false if permissions API throws or is absent', async () => {
  assert.equal(await A.hasSiteAccess({ permissions: { contains: async () => { throw new Error('x'); } } }), false);
  assert.equal(await A.hasSiteAccess({}), false);
});

test('requestSiteAccess granted: requests exact origins, clears badge, reloads active Indeed tab', async () => {
  const c = fakeChrome({ granted: false, requestResult: true });
  const r = await A.requestSiteAccess(c);
  assert.deepEqual(c.calls.requested, [{ origins: A.REQUIRED_ORIGINS }]);
  assert.equal(r.granted, true);
  assert.equal(r.reloaded, true);
  assert.deepEqual(c.calls.reloaded, [7]);
  assert.equal(c.calls.badge.at(-1), '');
});

test('requestSiteAccess denied: badge stays, nothing reloaded', async () => {
  const c = fakeChrome({ granted: false, requestResult: false });
  const r = await A.requestSiteAccess(c);
  assert.equal(r.granted, false);
  assert.equal(r.reloaded, false);
  assert.equal(c.calls.badge.at(-1), '!');
  assert.deepEqual(c.calls.reloaded, []);
});

test('active tab that is not LinkedIn/Indeed is not reloaded', async () => {
  const c = fakeChrome({ granted: false, requestResult: true, activeTab: { id: 3, url: 'https://example.com/' } });
  const r = await A.requestSiteAccess(c);
  assert.equal(r.reloaded, false);
});

test('popup.html ships the Enable button and loads access.js before popup.js', () => {
  const html = fs.readFileSync(path.join(__dirname, '../extension/popup/popup.html'), 'utf8');
  assert.match(html, /Enable on LinkedIn &amp; Indeed/);
  assert.ok(html.indexOf('lib/access.js') < html.indexOf('popup.js'));
});
