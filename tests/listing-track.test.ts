import test from 'node:test';
import assert from 'node:assert/strict';
import {
  descriptionsAreIdentical,
  incrementListingsTracked,
  repostCountForListings,
  upsertRepostPattern,
} from '../web/lib/listingTrack.ts';
import { recomputeEmployerScore } from '../web/lib/employerScore.ts';

test('descriptions are identical only when at least two hashes agree', () => {
  assert.equal(descriptionsAreIdentical([]), false);
  assert.equal(descriptionsAreIdentical(['abc']), false);
  assert.equal(descriptionsAreIdentical([null, 'abc']), false);
  assert.equal(descriptionsAreIdentical(['abc', 'abc']), true);
  assert.equal(descriptionsAreIdentical(['abc', 'def']), false);
  assert.equal(repostCountForListings(1), null);
  assert.equal(repostCountForListings(2), 2);
});

function scriptedDb(steps: Array<Record<string, unknown>>) {
  const writes: Array<{ op: string; table: string; row?: unknown }> = [];
  let cursor = 0;
  function next() {
    if (cursor < steps.length) return Promise.resolve(steps[cursor++]);
    return Promise.resolve({ data: null, error: null, count: null });
  }
  function builder(table: string) {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = self;
    chain.eq = self;
    chain.neq = self;
    chain.gte = self;
    chain.not = self;
    chain.order = self;
    chain.limit = self;
    chain.maybeSingle = () => next();
    chain.single = () => next();
    chain.insert = (row: unknown) => {
      writes.push({ op: 'insert', table, row });
      return next();
    };
    chain.update = (row: unknown) => {
      writes.push({ op: 'update', table, row });
      return chain;
    };
    chain.then = (ok: (value: unknown) => unknown, err?: (reason: unknown) => unknown) =>
      next().then(ok, err);
    return chain;
  }
  return {
    writes,
    from(table: string) {
      return builder(table);
    },
    rpc() {
      return Promise.resolve({ data: null, error: { message: 'function increment_listings_tracked does not exist' } });
    },
  };
}

test('a single tracked listing does not insert a repost row', async () => {
  const db = scriptedDb([{ count: 1, data: null, error: null }]);
  await upsertRepostPattern(db as never, {
    employerId: 'emp',
    titleNormalized: 'analyst',
    city: 'austin',
    state: 'TX',
    postedDate: '2026-09-01',
    descriptionHash: 'aaaaaaaa',
    isNewListing: true,
  });
  assert.equal(db.writes.length, 0);
});

test('a repeat view does not write a repost row', async () => {
  const db = scriptedDb([]);
  await upsertRepostPattern(db as never, {
    employerId: 'emp',
    titleNormalized: 'analyst',
    city: 'austin',
    state: 'TX',
    postedDate: '2026-09-01',
    isNewListing: false,
  });
  assert.equal(db.writes.length, 0);
});

test('the second listing inserts occurrence_count 2', async () => {
  const db = scriptedDb([
    { count: 2, error: null },
    { data: [{ description_hash: 'aaaaaaaa' }, { description_hash: 'bbbbbbbb' }], error: null },
    { data: null, error: null },
    { data: { id: 'rp' }, error: null },
  ]);
  await upsertRepostPattern(db as never, {
    employerId: 'emp',
    titleNormalized: 'analyst',
    city: 'austin',
    state: 'TX',
    postedDate: '2026-09-01',
    descriptionHash: 'bbbbbbbb',
    isNewListing: true,
  });
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].op, 'insert');
  const row = db.writes[0].row as { occurrence_count: number; descriptions_identical: boolean };
  assert.equal(row.occurrence_count, 2);
  assert.equal(row.descriptions_identical, false);
});

test('missing increment RPC falls back to an update', async () => {
  const db = scriptedDb([{ error: null }]);
  await incrementListingsTracked(db as never, 'emp-1', 4);
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].op, 'update');
  assert.deepEqual(db.writes[0].row, { total_listings_tracked: 5 });
});

test('recompute does not log when the employer score is unchanged', async () => {
  const db = scriptedDb([
    { data: [{ heuristic_score: 40 }], error: null },
    { data: [], error: null },
    { data: [{ occurrence_count: 1, descriptions_identical: true }], error: null },
    { data: { ghost_score: 40, ghost_label: 'moderate' }, error: null },
  ]);
  const result = await recomputeEmployerScore(db as never, 'emp', 'new_listing');
  assert.deepEqual(result, { score: 40, label: 'moderate' });
  assert.equal(db.writes.length, 0);
});

test('recompute updates a stale label without an audit row when the score is unchanged', async () => {
  const db = scriptedDb([
    { data: [{ heuristic_score: 40 }], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: { ghost_score: 40, ghost_label: 'high' }, error: null },
    { error: null },
  ]);
  const result = await recomputeEmployerScore(db as never, 'emp', 'new_listing');
  assert.equal(result && result.label, 'moderate');
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].op, 'update');
  assert.equal(db.writes.some((write) => write.table === 'employer_score_log'), false);
});

test('recompute logs only when the numeric score changes', async () => {
  const db = scriptedDb([
    { data: [{ heuristic_score: 80 }], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: { ghost_score: 10, ghost_label: 'low' }, error: null },
    { error: null },
    { error: null },
  ]);
  const result = await recomputeEmployerScore(db as never, 'emp', 'new_listing');
  assert.equal(result && result.score, 80);
  assert.equal(result && result.label, 'very_high');
  assert.equal(db.writes.filter((write) => write.op === 'insert').length, 1);
  assert.equal(db.writes.find((write) => write.op === 'insert')?.table, 'employer_score_log');
});
