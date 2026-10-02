import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreResponseForEvidence } from '../web/lib/freshEmployerScore.ts';

const now = Date.parse('2026-10-02T12:00:00Z');
const recent = '2026-09-15T00:00:00Z';

const employer = {
  ghost_score: 40,
  total_reports: 0,
  total_listings_tracked: 1,
  glassdoor_rating: null,
};

test('GET /api/employer/score live is false for one tracked listing', () => {
  const body = scoreResponseForEvidence(
    employer,
    [],
    [{ occurrence_count: 1, descriptions_identical: true, updated_at: recent }],
    0,
    now
  );
  assert.equal(body.live, false);
  assert.equal(body.found, true);
  assert.equal(body.score, 40);
});

test('GET /api/employer/score live is true for a real repeat or two reports', () => {
  const repeated = scoreResponseForEvidence(
    employer,
    [],
    [{ occurrence_count: 2, descriptions_identical: false, updated_at: recent }],
    0,
    now
  );
  assert.equal(repeated.live, true);

  const reports = scoreResponseForEvidence(
    employer,
    [{ outcome: 'no_response', report_type: 'outcome' }, { outcome: 'rejected', report_type: 'outcome' }],
    [],
    0,
    now
  );
  assert.equal(reports.live, true);

  const oneReport = scoreResponseForEvidence(
    employer,
    [{ outcome: 'no_response', report_type: 'ghost_flag' }],
    [],
    0,
    now
  );
  assert.equal(oneReport.live, false);
});

test('GET /api/employer/score ignores a stale repost pattern', () => {
  const body = scoreResponseForEvidence(
    employer,
    [],
    [{ occurrence_count: 8, descriptions_identical: true, updated_at: '2020-01-01T00:00:00Z' }],
    0,
    now
  );
  assert.equal(body.live, false);
});

test('GET /api/employer/score labels follow 35/55/75', () => {
  const labelFor = (score: number) =>
    scoreResponseForEvidence({ ...employer, ghost_score: score }, [], [], 0, now).label;
  assert.equal(labelFor(34), 'low');
  assert.equal(labelFor(35), 'moderate');
  assert.equal(labelFor(50), 'moderate');
  assert.equal(labelFor(54), 'moderate');
  assert.equal(labelFor(55), 'high');
  assert.equal(labelFor(74), 'high');
  assert.equal(labelFor(75), 'very_high');
});
