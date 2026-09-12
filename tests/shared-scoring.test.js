'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../extension/content/shared.js');

test('isActivelyReviewing reads engagementSignals snake_case key', () => {
  assert.equal(shared.isActivelyReviewing({ engagementSignals: ['actively_reviewing'] }), true);
  assert.equal(shared.isActivelyReviewing({ engagementSignals: ['urgently_hiring'] }), false);
  assert.equal(shared.isActivelyReviewing({ activelyReviewing: true }), true);
  assert.equal(shared.isActivelyReviewing({}), false);
});

test('applyEngagementScoring credits actively_reviewing and skips stale penalty', () => {
  const listing = { engagementSignals: ['actively_reviewing'], daysOpen: 40 };
  const signals = [];
  const result = shared.applyEngagementScoring(listing, 50, signals);
  assert.equal(result.activelyReviewing, true);
  assert.equal(result.score, 42);
  assert.ok(signals.some(s => /actively reviewing/i.test(s)));
  assert.ok(!signals.some(s => /No active review/i.test(s)));
});

test('applyEngagementScoring penalizes old listings with no review signal', () => {
  const listing = { engagementSignals: [], daysOpen: 21 };
  const signals = [];
  const result = shared.applyEngagementScoring(listing, 50, signals);
  assert.equal(result.activelyReviewing, false);
  assert.equal(result.score, 60);
  assert.ok(signals.some(s => /No active review/i.test(s)));
});

test('applyEngagementScoring does not penalize fresh listings without review', () => {
  const listing = { engagementSignals: [], daysOpen: 3 };
  const result = shared.applyEngagementScoring(listing, 20, []);
  assert.equal(result.score, 20);
});

test('extractIndeedJobKey accepts jk= and vjk=', () => {
  assert.equal(
    shared.extractIndeedJobKey('https://www.indeed.com/viewjob?jk=abc123def456'),
    'abc123def456'
  );
  assert.equal(
    shared.extractIndeedJobKey('https://www.indeed.com/jobs?q=eng&vjk=deadbeefcafebabe'),
    'deadbeefcafebabe'
  );
  assert.equal(
    shared.extractIndeedJobKey('https://www.indeed.com/jobs?q=eng&from=searchonhp&vjk=aa11bb22cc33dd44&advn=1'),
    'aa11bb22cc33dd44'
  );
  assert.equal(shared.extractIndeedJobKey('https://www.indeed.com/jobs?q=eng'), null);
});

test('buildTrackPayload and mergeApplyPayload include required track fields', () => {
  const listing = {
    title: 'Staff Engineer',
    companyName: 'Acme Corp',
    platformJobId: 'abc123',
    listingUrl: 'https://www.indeed.com/viewjob?jk=abc123',
    location: 'Austin, TX',
    engagementSignals: ['actively_reviewing'],
    listingHeuristic: 41,
  };
  const track = shared.buildTrackPayload(listing, { platform: 'indeed', userClickedApply: true });
  assert.equal(track.companyName, 'Acme Corp');
  assert.equal(track.jobTitle, 'Staff Engineer');
  assert.equal(track.platform, 'indeed');
  assert.equal(track.userClickedApply, true);
  assert.equal(track.listingHeuristic, 41);
  assert.ok(shared.applyPayloadIsComplete(track));

  const merged = shared.mergeApplyPayload(
    { type: 'USER_CLICKED_APPLY', platform: 'indeed', url: listing.listingUrl },
    track
  );
  assert.equal(merged.companyName, 'Acme Corp');
  assert.equal(merged.jobTitle, 'Staff Engineer');
  assert.equal(merged.platformJobId, 'abc123');
  assert.equal(merged.userClickedApply, true);
  assert.ok(shared.applyPayloadIsComplete(merged));
});

test('hashDescription is stable and ignores whitespace case', () => {
  const a = shared.hashDescription('Build APIs  in Node');
  const b = shared.hashDescription('build apis in node');
  assert.equal(typeof a, 'string');
  assert.equal(a.length, 8);
  assert.equal(a, b);
  assert.equal(shared.hashDescription(''), null);
});

test('Indeed combo penalties do not stack when engagementSignals has actively_reviewing', () => {
  const listing = {
    engagementSignals: ['actively_reviewing'],
    daysOpen: 40,
    salaryListed: false,
    employerResponsive: false,
  };
  const signals = [];
  let score = 50;
  const engagement = shared.applyEngagementScoring(listing, score, signals);
  score = engagement.score;
  const activelyReviewing = engagement.activelyReviewing;
  const missingBasics = !listing.salaryListed && !listing.employerResponsive && !activelyReviewing;
  if (listing.daysOpen >= 14 && missingBasics) score += 24;
  if (listing.daysOpen >= 30 && !activelyReviewing) score += 14;
  if (listing.daysOpen >= 30 && !activelyReviewing && !listing.employerResponsive && !listing.salaryListed) {
    score += 12;
  }
  assert.equal(activelyReviewing, true);
  assert.equal(score, 42, 'reviewing listings must not eat stale/no-review combo penalties');
});

test('scoreListPreview stays conservative without description penalties', () => {
  const fresh = shared.scoreListPreview({ title: 'Engineer', daysOpen: 1, salaryListed: true });
  const stale = shared.scoreListPreview({ title: 'Engineer', daysOpen: 45, isRepost: true, salaryListed: false });
  assert.ok(fresh.score < 30);
  assert.ok(stale.score > fresh.score);
  assert.ok(stale.score < 90, 'list preview must not stack full-detail missing-field penalties');
});
