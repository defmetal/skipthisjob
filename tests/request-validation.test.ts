import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReportBody, parseTrackBody } from '../web/lib/requestValidation.ts';
import { isAllowedPostOrigin, PUBLISHED_EXTENSION_ORIGIN } from '../web/lib/originCheck.ts';

const LINKEDIN_ID = '3812345678';
const INDEED_ID = '0d671325e0a42f3c';
const USER = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function listingBody(overrides: Record<string, unknown> = {}) {
  return {
    companyName: 'Amazon.com Services LLC',
    jobTitle: 'Warehouse Associate',
    platform: 'linkedin',
    platformJobId: LINKEDIN_ID,
    daysOpen: 12,
    salaryListed: null,
    isRepost: false,
    listingHeuristic: 40,
    ...overrides,
  };
}

test('malformed track bodies are 400-shaped errors, not throws', () => {
  assert.equal(parseTrackBody(null).ok, false);
  assert.equal(parseTrackBody([]).ok, false);
  assert.equal(parseTrackBody(listingBody({ companyName: 123 })).ok, false);
  assert.equal(parseTrackBody(listingBody({ jobTitle: { bad: true } })).ok, false);
  assert.equal(parseTrackBody(listingBody({ daysOpen: '30' })).ok, false);
  assert.equal(parseTrackBody(listingBody({ daysOpen: Number.NaN })).ok, false);
  assert.equal(parseTrackBody(listingBody({ daysOpen: 9000 })).ok, false);
  assert.equal(parseTrackBody(listingBody({ platform: 'glassdoor' })).ok, false);
  assert.equal(parseTrackBody(listingBody({ platformJobId: 'abc' })).ok, false);
  assert.equal(parseTrackBody(listingBody({ platform: 'indeed', platformJobId: 'abc123' })).ok, false);
  assert.equal(parseTrackBody(listingBody({ companyName: 'x'.repeat(500) })).ok, false);
  assert.equal(parseTrackBody(listingBody({ engagementSignals: 'actively_reviewing' })).ok, false);
  assert.equal(parseTrackBody(listingBody({ salaryListed: 'false' })).ok, false);
});

test('a valid track keeps unknown booleans null and lowercases Indeed ids', () => {
  const parsed = parseTrackBody(listingBody({
    platform: 'indeed',
    platformJobId: INDEED_ID.toUpperCase(),
    salaryListed: null,
    isRepost: null,
    daysOpen: null,
    descriptionHash: 'ab12cd34',
  }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.value.mode !== 'listing') return;
  assert.equal(parsed.value.platformJobId, INDEED_ID);
  assert.equal(parsed.value.salaryListed, null);
  assert.equal(parsed.value.isRepost, null);
  assert.equal(parsed.value.daysOpen, null);
  assert.equal(parsed.value.descriptionHash, 'ab12cd34');
});

test('apply-only track still requires a real platform job id', () => {
  const parsed = parseTrackBody({
    userClickedApply: true,
    platform: 'linkedin',
    platformJobId: LINKEDIN_ID,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.mode, 'apply');
  assert.equal(parseTrackBody({ userClickedApply: true, platform: 'linkedin' }).ok, false);
});

test('reports require a platform job id and a uuid or hex anonymous id', () => {
  const good = parseReportBody({
    reportType: 'ghost_flag',
    companyName: 'Amazon.com Services LLC',
    jobTitle: 'Warehouse Associate',
    platform: 'linkedin',
    platformJobId: LINKEDIN_ID,
    anonymousUserHash: USER,
    flagReasons: ['no_response'],
  });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.value.anonymousUserHash, USER);

  const hex = parseReportBody({
    reportType: 'outcome',
    companyName: 'Acme',
    jobTitle: 'Analyst',
    platform: 'indeed',
    platformJobId: INDEED_ID,
    anonymousUserHash: 'ab'.repeat(16),
    outcome: 'offered',
  });
  assert.equal(hex.ok, true);

  assert.equal(parseReportBody({
    reportType: 'ghost_flag',
    companyName: 'Acme',
    jobTitle: 'Analyst',
    platform: 'linkedin',
    anonymousUserHash: USER,
    flagReasons: ['no_response'],
  }).ok, false);
  assert.equal(parseReportBody({
    reportType: 'ghost_flag',
    companyName: 'Acme',
    jobTitle: 'Analyst',
    platform: 'linkedin',
    platformJobId: LINKEDIN_ID,
    anonymousUserHash: 'short',
    flagReasons: ['no_response'],
  }).ok, false);
  assert.equal(parseReportBody({
    reportType: 'outcome',
    companyName: 'Acme',
    jobTitle: 'Analyst',
    platform: 'linkedin',
    platformJobId: LINKEDIN_ID,
    anonymousUserHash: USER,
    outcome: 'ghosted',
  }).ok, false);
  assert.equal(parseReportBody({
    reportType: 'ghost_flag',
    companyName: 5,
    jobTitle: 'Analyst',
    platform: 'linkedin',
    platformJobId: LINKEDIN_ID,
    anonymousUserHash: USER,
    flagReasons: ['no_response'],
  }).ok, false);
});

test('post origin allows the extension and rejects other websites', () => {
  assert.equal(isAllowedPostOrigin(null), true);
  assert.equal(isAllowedPostOrigin('null'), true);
  assert.equal(isAllowedPostOrigin(PUBLISHED_EXTENSION_ORIGIN), true);
  assert.equal(isAllowedPostOrigin('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), true);
  assert.equal(isAllowedPostOrigin('https://www.skipthisjob.com'), true);
  assert.equal(isAllowedPostOrigin('https://evil.example'), false);
  assert.equal(isAllowedPostOrigin('http://localhost:3000'), true);
});
