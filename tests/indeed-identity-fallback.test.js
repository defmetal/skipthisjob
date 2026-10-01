'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../extension/content/shared.js');

test('parseIndeedPageTitle splits Title - Company - Location | Indeed.com', () => {
  assert.deepEqual(shared.parseIndeedPageTitle('Sr Engineer - Foo - Bar Inc - Remote | Indeed.com'),
    { title: 'Sr Engineer - Foo', companyName: 'Bar Inc' });
  assert.deepEqual(shared.parseIndeedPageTitle('Data Analyst - Hooli - Austin, TX'),
    { title: 'Data Analyst', companyName: 'Hooli' });
});

test('parseIndeedPageTitle rejects SERP titles and ambiguous strings', () => {
  assert.equal(shared.parseIndeedPageTitle('it support jobs in San Antonio, TX'), null);
  assert.equal(shared.parseIndeedPageTitle('Indeed.com | Job Search'), null);
  assert.equal(shared.parseIndeedPageTitle(''), null);
});

test('readJobPostingIdentity handles @graph, arrays and string orgs', () => {
  assert.deepEqual(
    shared.readJobPostingIdentity(JSON.stringify({ '@graph': [{ '@type': 'WebSite' }, { '@type': ['JobPosting'], title: 'A', hiringOrganization: 'Org' }] })),
    { title: 'A', companyName: 'Org' });
  assert.equal(shared.readJobPostingIdentity('not json'), null);
});

test('resolveIndeedIdentity: exact jk only (never a neighbor), SERP heading discarded', () => {
  const r = shared.resolveIndeedIdentity({
    current: { title: 'it support jobs in San Antonio, TX', companyName: null },
    jobKey: 'ABC123',
    mosaicJobs: [{ jobkey: 'abc124', displayTitle: 'Wrong', company: 'Wrong Co' }, { jobkey: 'abc123', displayTitle: 'Right', company: 'Right Co' }],
  });
  assert.equal(r.title, 'Right');
  assert.equal(r.companyName, 'Right Co');
  assert.deepEqual(r.sources, ['mosaic']);
});

test('resolveIndeedIdentity returns nulls when nothing matches', () => {
  const r = shared.resolveIndeedIdentity({ current: {}, jobKey: 'zz', mosaicJobs: [{ jobkey: 'yy', displayTitle: 'x', company: 'y' }] });
  assert.equal(r.title, null);
  assert.equal(r.companyName, null);
});

test('storage.session access error falls back to storage.local; timeouts do not hang', async () => {
  const store = {};
  const chromeApi = {
    runtime: { lastError: null },
    storage: {
      session: { get(k, cb) { chromeApi.runtime.lastError = { message: 'Access to storage is not allowed from this context.' }; cb(undefined); chromeApi.runtime.lastError = null; }, set() {} },
      local: { get(k, cb) { cb(JSON.parse(JSON.stringify(store))); }, set(o, cb) { Object.assign(store, o); if (cb) cb(); } },
    },
  };
  assert.equal(await shared.rememberIndeedJobSignals('abc', { daysOpen: 12 }, chromeApi, 200), true);
  const got = await shared.recallIndeedJobSignals('abc', chromeApi, 200);
  assert.equal(got.daysOpen, 12);

  const hanging = { runtime: {}, storage: { local: { get() {}, set() {} } } };
  const t0 = Date.now();
  assert.equal(await shared.recallIndeedJobSignals('abc', hanging, 50), null);
  assert.ok(Date.now() - t0 < 1000);
});
