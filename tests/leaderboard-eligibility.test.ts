import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_LISTINGS_FOR_LEADERBOARD,
  MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD,
  SINGLE_LISTING_SCORE_CAP,
  THIN_EVIDENCE_SCORE_CEILING,
  bandNameForScore,
  confidenceLabel,
  displayedGhostScore,
  distinctListingReporters,
  isEligibleEmployer,
  leaderboardMinimumNote,
  looksLikePersonalName,
  prepareLeaderboard,
} from '../web/lib/leaderboardEligibility.ts';

test('evidence thresholds are the named defaults', () => {
  assert.equal(MIN_LISTINGS_FOR_LEADERBOARD, 5);
  assert.equal(MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD, 3);
});

test('one listing and zero reports cannot display as 100 and does not qualify', () => {
  const row = { name_raw: 'Members Health Inc.', ghost_score: 100, total_listings_tracked: 1, total_reports: 0 };
  assert.equal(isEligibleEmployer(row), false);
  const shown = displayedGhostScore(100, 1, 0);
  assert.equal(shown, SINGLE_LISTING_SCORE_CAP);
  assert.ok(shown < 100);
  assert.equal(bandNameForScore(shown), 'Likely a Waste of Time');
});

test('five listings keep a raw score of 100 and qualify', () => {
  const row = { name_raw: 'Leidos', ghost_score: 100, total_listings_tracked: 5, total_reports: 0 };
  assert.equal(isEligibleEmployer(row), true);
  assert.equal(displayedGhostScore(100, 5, 0), 100);
  assert.equal(displayedGhostScore(82.4, 129, 1), 82.4);
});

test('thin listing evidence stays under 100 even with many reports', () => {
  assert.ok(displayedGhostScore(100, 1, 3) < 100);
  assert.ok(displayedGhostScore(100, 4, 3) <= THIN_EVIDENCE_SCORE_CEILING);
  assert.ok(displayedGhostScore(100, 1, 50) <= THIN_EVIDENCE_SCORE_CEILING);
  assert.equal(displayedGhostScore(100, 3, 3), 90);
  assert.equal(displayedGhostScore(68, 0, 3), 66);
});

test('the cap never raises a score', () => {
  assert.equal(displayedGhostScore(40, 20, 0), 40);
  assert.equal(displayedGhostScore(10, 1, 0), 10);
  assert.equal(displayedGhostScore(null, 8, 0), 0);
  assert.equal(displayedGhostScore(-5, 8, 0), 0);
});

test('three community reports qualify a company that still has few listings', () => {
  const row = {
    name_raw: 'CHL Systems',
    ghost_score: 100,
    total_listings_tracked: 3,
    total_reports: 3,
  };
  assert.equal(isEligibleEmployer(row), true);
  const [shown] = prepareLeaderboard([row], 'ghost_score', false);
  assert.equal(shown.ghost_score, 90);
  assert.equal(shown.confidence, 'Based on 3 listings, 3 reports');
  assert.notEqual(shown.ghost_score, 100);
});

test('two listings and two reports are not enough', () => {
  assert.equal(
    isEligibleEmployer({
      name_raw: 'Lutron Electronics Co., Inc',
      ghost_score: 100,
      total_listings_tracked: 2,
      total_reports: 2,
    }),
    false
  );
});

test('personal names with few listings are omitted; the same name with enough listings stays', () => {
  assert.equal(looksLikePersonalName('Dean Davidson', 1), true);
  assert.equal(looksLikePersonalName('DEAN DAVIDSON', 2), true);
  assert.equal(
    isEligibleEmployer({
      name_raw: 'Dean Davidson',
      ghost_score: 100,
      total_listings_tracked: 1,
      total_reports: 3,
    }),
    false
  );
  assert.equal(
    isEligibleEmployer({
      name_raw: 'Dean Davidson',
      ghost_score: 80,
      total_listings_tracked: 5,
      total_reports: 0,
    }),
    true
  );
});

test('company suffixes, descriptors, and longer tokens are kept', () => {
  assert.equal(looksLikePersonalName('Cisco Systems', 2), false);
  assert.equal(looksLikePersonalName('Abbott Laboratories', 2), false);
  assert.equal(looksLikePersonalName('Baker Roofing Company', 1), false);
  assert.equal(looksLikePersonalName('Acme Inc', 1), false);
  assert.equal(looksLikePersonalName('John Smith, LLC', 0), false);
  assert.equal(looksLikePersonalName('Dean Davidson Jr', 1), false);
  assert.equal(
    isEligibleEmployer({
      name_raw: 'Cisco Systems',
      ghost_score: 100,
      total_listings_tracked: 2,
      total_reports: 3,
    }),
    true
  );
  assert.equal(
    isEligibleEmployer({
      name_raw: 'General Motors',
      ghost_score: 70,
      total_listings_tracked: 4,
      total_reports: 3,
    }),
    true
  );
});

test('empty, very short, and numeric names are omitted even with many listings', () => {
  for (const name of ['', '   ', 'A', '12345', '12 34', '---', '#1']) {
    assert.equal(
      isEligibleEmployer({
        name_raw: name,
        ghost_score: 90,
        total_listings_tracked: 20,
        total_reports: 0,
      }),
      false,
      name
    );
  }
  assert.equal(
    isEligibleEmployer({ name_raw: 'EY', ghost_score: 21, total_listings_tracked: 5, total_reports: 0 }),
    true
  );
  assert.equal(
    isEligibleEmployer({ name_raw: '3M', ghost_score: 40, total_listings_tracked: 5, total_reports: 0 }),
    true
  );
  assert.equal(
    isEligibleEmployer({ name_raw: 'HP', ghost_score: 40, total_listings_tracked: 5, total_reports: 0 }),
    true
  );
});

test('score sort uses the capped display score, only among qualifiers', () => {
  const rows = prepareLeaderboard(
    [
      { name_raw: 'Thin Co', ghost_score: 100, total_listings_tracked: 1, total_reports: 3 },
      { name_raw: 'One Listing Inc', ghost_score: 100, total_listings_tracked: 1, total_reports: 0 },
      { name_raw: 'Solid Corp', ghost_score: 96, total_listings_tracked: 12, total_reports: 0 },
      { name_raw: 'Dean Davidson', ghost_score: 100, total_listings_tracked: 1, total_reports: 4 },
      { name_raw: '', ghost_score: 100, total_listings_tracked: 40, total_reports: 0 },
    ],
    'ghost_score',
    false
  );
  assert.deepEqual(
    rows.map((row) => [row.name_raw, row.ghost_score]),
    [
      ['Solid Corp', 96],
      ['Thin Co', 74],
    ]
  );
  assert.equal(rows[0].confidence, 'Based on 12 listings, 0 reports');
  assert.equal(rows[1].confidence, 'Based on 1 listing, 3 reports');
});

test('other sorts still exclude employers below the evidence minimum', () => {
  const rows = prepareLeaderboard(
    [
      { name_raw: 'Zebra LLC', ghost_score: 10, total_listings_tracked: 1, total_reports: 0 },
      { name_raw: 'Alpha Inc', ghost_score: 40, total_listings_tracked: 6, total_reports: 0 },
      { name_raw: 'Mid Co', ghost_score: 50, total_listings_tracked: 9, total_reports: 1 },
    ],
    'name_raw',
    true
  );
  assert.deepEqual(
    rows.map((row) => row.name_raw),
    ['Alpha Inc', 'Mid Co']
  );
});

test('confidence copy pluralizes, and the page note states the minimum', () => {
  assert.equal(confidenceLabel(1, 0), 'Based on 1 listing, 0 reports');
  assert.equal(confidenceLabel(5, 3), 'Based on 5 listings, 3 reports');
  const note = leaderboardMinimumNote();
  assert.match(note, new RegExp(`${MIN_LISTINGS_FOR_LEADERBOARD} tracked listings`));
  assert.match(note, new RegExp(`${MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD} community reports`));
  assert.match(note, /cannot show as 100/);
  assert.equal(
    note,
    'Only employers with at least 5 tracked listings or 3 community reports from different people are listed. A report counts only when it is tied to a specific listing, and new evidence waits 24 hours before an employer can appear. Scores from fewer than 5 listings are capped, so a single posting cannot show as 100. Personal names with only a few listings, and empty, very short, or numeric names, are left off.'
  );
});

test('display bands stay on the extension boundaries', () => {
  assert.equal(bandNameForScore(0), 'Worth Applying');
  assert.equal(bandNameForScore(34), 'Worth Applying');
  assert.equal(bandNameForScore(35), 'Proceed with Caution');
  assert.equal(bandNameForScore(54), 'Proceed with Caution');
  assert.equal(bandNameForScore(55), 'Likely a Waste of Time');
  assert.equal(bandNameForScore(74), 'Likely a Waste of Time');
  assert.equal(bandNameForScore(75), 'Skip This Job');
  assert.equal(bandNameForScore(100), 'Skip This Job');
});

test('titles and middle initials are screened as personal names', () => {
  assert.equal(looksLikePersonalName('Dean A. Davidson', 1), true);
  assert.equal(looksLikePersonalName('Dr Dean Davidson', 1), true);
  assert.equal(looksLikePersonalName('Dr. Dean Davidson', 2), true);
  assert.equal(looksLikePersonalName('Dean Davidson Jr', 1), false);
  assert.equal(
    isEligibleEmployer({
      name_raw: 'Dean A. Davidson',
      ghost_score: 90,
      total_listings_tracked: 1,
      total_reports: 3,
    }),
    false
  );
});

test('new employers and fresh report-only evidence wait 24 hours', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  assert.equal(
    isEligibleEmployer(
      {
        name_raw: 'Brand New LLC',
        ghost_score: 100,
        total_listings_tracked: 8,
        total_reports: 0,
        created_at: '2026-10-02T11:00:00Z',
      },
      now
    ),
    false
  );
  assert.equal(
    isEligibleEmployer(
      {
        name_raw: 'Established LLC',
        ghost_score: 80,
        total_listings_tracked: 8,
        total_reports: 0,
        created_at: '2026-08-01T00:00:00Z',
      },
      now
    ),
    true
  );
  assert.equal(
    isEligibleEmployer(
      {
        name_raw: 'Fresh Reports Inc',
        ghost_score: 90,
        total_listings_tracked: 1,
        total_reports: 3,
        qualifying_distinct_reporters: 3,
        oldest_qualifying_report_at: '2026-10-02T11:00:00Z',
      },
      now
    ),
    false
  );
  assert.equal(
    isEligibleEmployer(
      {
        name_raw: 'Ripe Reports Inc',
        ghost_score: 90,
        total_listings_tracked: 1,
        total_reports: 9,
        qualifying_distinct_reporters: 3,
        oldest_qualifying_report_at: '2026-09-01T00:00:00Z',
      },
      now
    ),
    true
  );
  assert.equal(
    isEligibleEmployer(
      {
        name_raw: 'Same Person Inc',
        ghost_score: 90,
        total_listings_tracked: 1,
        total_reports: 5,
        qualifying_distinct_reporters: 2,
        oldest_qualifying_report_at: '2026-08-01T00:00:00Z',
      },
      now
    ),
    false
  );
});

test('reports without a listing id do not count as distinct reporters', () => {
  const summary = distinctListingReporters([
    { anonymous_user_hash: 'a', listing_id: null, created_at: '2026-01-01T00:00:00Z' },
    { anonymous_user_hash: 'a', listing_id: 'listing-1', created_at: '2026-01-02T00:00:00Z' },
    { anonymous_user_hash: 'a', listing_id: 'listing-2', created_at: '2026-02-01T00:00:00Z' },
    { anonymous_user_hash: 'b', listing_id: 'listing-3', created_at: '2026-03-01T00:00:00Z' },
  ]);
  assert.equal(summary.count, 2);
  assert.equal(summary.oldestAt, '2026-01-02T00:00:00.000Z');
});
