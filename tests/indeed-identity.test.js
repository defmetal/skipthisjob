'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../extension/content/shared.js');

const SCI_TEC_JK = '719bcfe123c2054d';
const SCI_TEC_TITLE = 'Staff / Sr Staff C++ Software Engineer';
const SCI_TEC_COMPANY = 'SciTec';

const scitecMosaic = {
  jobkey: SCI_TEC_JK,
  displayTitle: SCI_TEC_TITLE,
  company: SCI_TEC_COMPANY,
  formattedRelativeTime: '30+ days ago',
  pubDate: Date.UTC(2026, 7, 10),
};

const neighborMosaic = {
  jobkey: 'aaaaaaaaaaaaaaaa',
  displayTitle: 'Senior Software Developer',
  company: 'TherapyNotes.com',
  formattedRelativeTime: '2 days ago',
  pubDate: Date.now() - 2 * 86400000,
};

const detailText = [
  SCI_TEC_TITLE,
  SCI_TEC_COMPANY,
  'Boulder, CO 80301',
  '$102,000 - $157,000 a year — Full-time',
  'C++ Python Linux real-time systems. Reports to the engineering director.',
].join('\n');

test('pickMosaicJobForListing requires exact jk — URL-key bonus must not pick a neighbor', () => {
  const picked = shared.pickMosaicJobForListing(
    [neighborMosaic, scitecMosaic],
    SCI_TEC_JK,
    SCI_TEC_TITLE,
    SCI_TEC_COMPANY
  );
  assert.equal(picked.jobkey, SCI_TEC_JK);
  assert.equal(shared.daysOpenFromMosaicJob(picked), 30);

  const wrong = shared.pickMosaicJobForListing(
    [neighborMosaic],
    SCI_TEC_JK,
    SCI_TEC_TITLE,
    SCI_TEC_COMPANY
  );
  assert.equal(wrong, null);
});

test('mosaicJobIdentity does not treat page jobKey-in-URL as identity for every row', () => {
  const neighbor = shared.mosaicJobIdentity(
    neighborMosaic,
    SCI_TEC_JK,
    SCI_TEC_TITLE,
    SCI_TEC_COMPANY
  );
  assert.equal(neighbor.exactKey, false);
  assert.ok(neighbor.identity < 100);
});

test('page-wide "Often replies in" does not leak into detail signals', () => {
  const spaPage = detailText + '\n\nOther employer\nOften replies in 1 day\nPosted 2 days ago';
  const leaked = shared.indeedDetailTextSignals(spaPage);
  assert.equal(leaked.employerResponsive, true, 'sanity: body text would leak');

  const scoped = shared.collectIndeedListingSignals({
    jobKey: SCI_TEC_JK,
    mosaicJobs: [scitecMosaic, neighborMosaic],
    pageTitle: SCI_TEC_TITLE,
    pageCompany: SCI_TEC_COMPANY,
    detailText: detailText,
    selectedCardText: '',
  });
  assert.equal(scoped.employerResponsive, false);
  assert.equal(scoped.daysOpen, 30);
});

test('SPA selected-card reply chip + mosaic age matches viewjob json-ld + cache', () => {
  const now = Date.UTC(2026, 8, 12);
  const spa = shared.collectIndeedListingSignals({
    jobKey: SCI_TEC_JK,
    mosaicJobs: [scitecMosaic, neighborMosaic],
    pageTitle: SCI_TEC_TITLE,
    pageCompany: SCI_TEC_COMPANY,
    detailText: detailText,
    selectedCardText: 'SciTec\nOften replies in 1 day\nEasily apply',
    nowMs: now,
  });

  const viewjob = shared.collectIndeedListingSignals({
    jobKey: SCI_TEC_JK,
    mosaicJobs: [],
    pageTitle: SCI_TEC_TITLE,
    pageCompany: SCI_TEC_COMPANY,
    detailText: detailText,
    selectedCardText: '',
    jsonLd: {
      '@type': 'JobPosting',
      title: SCI_TEC_TITLE,
      datePosted: '2026-08-13',
    },
    cached: {
      daysOpen: spa.daysOpen,
      employerResponsive: spa.employerResponsive,
      cachedAt: now,
    },
    nowMs: now,
  });

  assert.equal(spa.daysOpen, 30);
  assert.equal(spa.employerResponsive, true);
  assert.equal(viewjob.daysOpen, spa.daysOpen);
  assert.equal(viewjob.employerResponsive, spa.employerResponsive);
});

test('viewjob JobPosting datePosted is used when mosaic jobcards are absent', () => {
  const now = Date.UTC(2026, 8, 12);
  const days = shared.daysOpenFromJobPostingJsonLd(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      datePosted: '2026-08-13T00:00:00.000Z',
    }),
    now
  );
  assert.equal(days, 30);
});

test('indeed job-signal cache expires and keys by jk', () => {
  const now = 1_000_000;
  const map = shared.mergeIndeedJobCache({}, SCI_TEC_JK, { daysOpen: 30 }, now);
  assert.equal(shared.lookupIndeedJobCache(map, SCI_TEC_JK, now + 60 * 1000).daysOpen, 30);
  assert.equal(
    shared.lookupIndeedJobCache(map, SCI_TEC_JK, now + shared.INDEED_SIGNAL_CACHE_TTL_MS + 1),
    null
  );
  assert.equal(shared.lookupIndeedJobCache(map, 'deadbeefdeadbeef', now), null);
});

test('parseRelativeDays accepts Indeed 30+ and 5d labels', () => {
  assert.equal(shared.parseRelativeDays('30+ days ago'), 30);
  assert.equal(shared.parseRelativeDays('Posted 5d ago'), 5);
  assert.equal(shared.parseRelativeDays('2 weeks ago'), 14);
  assert.equal(shared.parseRelativeDays('just posted'), 0);
});
