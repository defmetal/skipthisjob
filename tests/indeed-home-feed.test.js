'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('../extension/content/shared.js');
const { load } = require('./helpers/indeed-dom.js');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures/indeed-home-feed.html'), 'utf8');
const VJK = 'bdcf974325e2454e';
const HOME = 'https://www.indeed.com/?vjk=' + VJK;

test('greeting headings are not job titles', () => {
  for (const heading of [
    'Welcome, Austin',
    'Hi, Austin',
    'Hello, Sam',
    'Jobs for you',
    'Recommended',
    'Recommended for you',
    'Sign in to see your jobs',
    'it support jobs in San Antonio, TX',
  ]) {
    assert.equal(shared.isRejectedJobTitle(heading), true, heading);
    assert.equal(shared.sanitizeJobTitle(heading), null, heading);
  }
  assert.equal(shared.isRejectedJobTitle('Head of Marketing'), false);
  assert.equal(shared.sanitizeJobTitle('Head of Marketing'), 'Head of Marketing');
});

test('stored scores, flags, and reports drop a greeting title', () => {
  const listing = {
    title: 'Welcome, Austin',
    companyName: 'DNA Media',
    platform: 'indeed',
    platformJobId: VJK,
    listingUrl: HOME,
  };
  const track = shared.buildTrackPayload(listing, { platform: 'indeed' });
  assert.equal(track.jobTitle, null);
  assert.equal(JSON.stringify(track).includes('Welcome, Austin'), false);
  assert.equal(JSON.stringify(track).includes('Austin'), false);

  const report = shared.mergeApplyPayload({ platform: 'indeed', url: HOME }, listing);
  assert.equal(report.jobTitle, null);
  assert.equal(JSON.stringify(report).includes('Welcome, Austin'), false);

  let stored = { stjActiveListing: { title: 'Welcome, Austin', companyName: 'DNA Media', score: 8 } };
  const chromeApi = {
    storage: {
      local: {
        set(obj) { stored = obj; },
        remove(key) { delete stored[key]; },
      },
    },
  };
  const previous = global.chrome;
  global.chrome = chromeApi;
  try {
    const published = shared.publishActiveListing(listing, { score: 8, label: 'low', signals: ['Open 16 days'] }, 'indeed');
    assert.equal(published, null);
    assert.equal(stored.stjActiveListing, undefined);
  } finally {
    global.chrome = previous;
  }
});

test('Indeed home feed uses the open vjk pane, not the greeting or another employer', async () => {
  const dom = load(FIXTURE, HOME);
  try {
    const listing = await dom.window.parseIndeedListing();
    assert.equal(listing.title, 'Head of Marketing');
    assert.equal(listing.companyName, 'Inato');
    assert.equal(listing.platformJobId, VJK);
    assert.equal(listing.daysOpen, 16);
    const blob = JSON.stringify(listing);
    assert.equal(blob.includes('Welcome, Austin'), false);
    assert.equal(blob.includes('DNA Media'), false);

    const track = shared.buildTrackPayload(listing, { platform: 'indeed' });
    assert.equal(track.jobTitle, 'Head of Marketing');
    assert.equal(JSON.stringify(track).includes('Welcome, Austin'), false);
  } finally {
    dom.window.close();
  }
});

test('a pane for a different job is unparsed and is not scored', async () => {
  const html = FIXTURE
    .replace('data-jk="' + VJK + '"', 'data-jk="aaaaaaaaaaaaaaaa"')
    .replace('Head of Marketing', 'Other Role')
    .replace('>Inato<', '>Other Co<')
    .replace('/viewjob?jk=' + VJK, '/viewjob?jk=aaaaaaaaaaaaaaaa');
  const dom = load(html, HOME);
  try {
    const listing = await dom.window.parseIndeedListing();
    assert.equal(listing.title, null);
    assert.equal(listing.companyName, null);
    assert.equal(listing.platformJobId, VJK);
    const blob = JSON.stringify(listing);
    assert.equal(blob.includes('Welcome, Austin'), false);
    assert.equal(blob.includes('DNA Media'), false);
    assert.equal(blob.includes('Other Role'), false);
    assert.equal(blob.includes('Other Co'), false);

    const gated = shared.scoreParsedListing(listing, () => {
      throw new Error('mismatched home-feed fields must not be scored');
    }, { platform: 'indeed', require: ['title', 'companyName'] });
    assert.equal(gated.state, 'unparsed');
    assert.ok(gated.missing.includes('title'));
    assert.equal(gated.score, null);
    assert.equal(gated.result, null);
  } finally {
    dom.window.close();
  }
});
