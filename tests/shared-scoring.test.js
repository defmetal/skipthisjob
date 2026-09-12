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

test('parseRelativeDays reads LinkedIn compact month labels', () => {
  assert.equal(shared.parseRelativeDays('3mo ago'), 90);
  assert.equal(shared.parseRelativeDays('Posted 5 mo ago'), 150);
  assert.equal(shared.parseRelativeDays('3 months ago'), 90);
  assert.equal(shared.parseRelativeDays('about 2 months ago'), 60);
});

test('age floors: 60→50, 90→75, 120→88 (harsh-biased high end)', () => {
  assert.equal(shared.ageFloorForDays(59), 0);
  assert.equal(shared.ageFloorForDays(60), 50);
  assert.equal(shared.ageFloorForDays(90), 75);
  assert.equal(shared.ageFloorForDays(120), 88);
  assert.equal(shared.ageFloorForDays(150), 88);
});

test('age floors hold after detailed description + actively reviewing', () => {
  const specific = [
    'Build React and Node services on AWS. Reports to the VP of Engineering.',
    'Team of 8. Python, SQL, 5 years. Compensation $140,000.',
    'You will own features end to end, review PRs, and participate in on-call.',
  ].join(' ');

  const hilton = shared.scoreListingSignals({
    title: 'Software Engineer Android',
    daysOpen: 150,
    engagementSignals: ['actively_reviewing'],
    salaryListed: false,
    description: specific,
  }, { platform: 'linkedin', vagueness: 0.1 });
  assert.ok(hilton.score >= 88, '5-month listing must not fall below 88, got ' + hilton.score);
  assert.equal(hilton.label, 'very_high');

  const popular = shared.scoreListingSignals({
    title: 'Shopify Web Developer',
    daysOpen: 90,
    applicantCount: 100,
    easyApply: true,
    salaryListed: false,
    hiringContactVisible: false,
    description: specific,
  }, {
    platform: 'linkedin',
    vagueness: 0.1,
    afterShared(score, signals) {
      score += 10;
      signals.push('No hiring contact — no one to follow up with');
      return { score, signals };
    },
  });
  assert.ok(popular.score >= 85, '3-month Easy Apply + 100 apps must feel costly, got ' + popular.score);
  assert.equal(popular.label, 'very_high');

  const hum = shared.scoreListingSignals({
    title: 'Full Stack Engineer',
    daysOpen: 60,
    applicantCount: 100,
    salaryListed: false,
    description: specific,
  }, { platform: 'linkedin', vagueness: 0.1 });
  assert.ok(hum.score >= 50, '2-month + 100 apps must be ≥50, got ' + hum.score);
  assert.ok(hum.score >= 55, 'crowded 60-day listing should be costly to ignore, got ' + hum.score);

  const mentium = shared.scoreListingSignals({
    title: 'Lead Software Engineer',
    daysOpen: 60,
    engagementSignals: ['actively_reviewing'],
    salaryListed: false,
    description: specific,
  }, { platform: 'linkedin', vagueness: 0.1 });
  assert.ok(mentium.score >= 50);
  assert.ok(mentium.score < 75, '2-month reviewing role should not jump to 90d floor, got ' + mentium.score);
});

test('Easy Apply + 100 apps is not swallowed by the age floor', () => {
  const bare = shared.scoreListPreview({ title: 'Engineer', daysOpen: 90 });
  const crowded = shared.scoreListPreview({
    title: 'Engineer',
    daysOpen: 90,
    easyApply: true,
    applicantCount: 100,
  });
  assert.ok(bare.score >= 75);
  assert.ok(crowded.score > bare.score, 'crowded Easy Apply 90d must beat bare 90d (' + crowded.score + ' vs ' + bare.score + ')');
  assert.equal(crowded.label, 'very_high');
});

test('engagement credit is capped on 60–120+ day listings', () => {
  assert.equal(shared.engagementCreditForAge(21), 8);
  assert.equal(shared.engagementCreditForAge(60), 3);
  assert.equal(shared.engagementCreditForAge(90), 2);
  assert.equal(shared.engagementCreditForAge(120), 0);

  const old = shared.applyEngagementScoring(
    { engagementSignals: ['actively_reviewing'], daysOpen: 150 },
    50,
    []
  );
  assert.equal(old.score, 50, '120+ day reviewing badge must not discount');

  const mid = shared.applyEngagementScoring(
    { engagementSignals: ['actively_reviewing'], daysOpen: 90 },
    70,
    []
  );
  assert.equal(mid.score, 68);
});

test('detailed description credit is only -1 and cannot beat an age floor', () => {
  const signals = [];
  const result = shared.applyDescriptionQuality(20, signals, 0.05);
  assert.equal(result.score, 20, 'detailed JD must not discount under 0.2.2 bias');
  assert.ok(signals.some(s => /Detailed, specific/i.test(s)));

  const floored = shared.scoreListingSignals({
    title: 'Engineer',
    daysOpen: 120,
    description: 'React Node AWS. Reports to the director. Team of 6. $160,000. 5 years.',
    engagementSignals: ['actively_reviewing'],
    salaryListed: true,
  }, { platform: 'linkedin', vagueness: 0.05 });
  assert.ok(floored.score >= 88);
});

test('list badge and detail stay in the same band for the same card', () => {
  const specific = 'React Node AWS. Reports to engineering. Team of 4. $120,000. 4 years.';

  const freshCard = { title: 'Engineer', daysOpen: 3, salaryListed: true };
  const freshPreview = shared.scoreListPreview(freshCard);
  const freshDetail = shared.scoreListingSignals({
    ...freshCard,
    description: specific,
    hiringContactVisible: true,
  }, { platform: 'linkedin', vagueness: 0.1 });
  assert.ok(freshPreview.score < 25);
  assert.ok(freshDetail.score < 25);
  assert.ok(
    Math.abs(freshPreview.score - freshDetail.score) <= 15,
    'fresh badge ' + freshPreview.score + ' vs detail ' + freshDetail.score
  );

  const oldCard = { title: 'Engineer', daysOpen: 90 };
  const oldPreview = shared.scoreListPreview(oldCard);
  const oldDetail = shared.scoreListingSignals({
    ...oldCard,
    description: specific,
    engagementSignals: ['actively_reviewing'],
    salaryListed: false,
  }, { platform: 'linkedin', vagueness: 0.1 });
  assert.ok(oldPreview.score >= 75);
  assert.ok(oldDetail.score >= 75);
  assert.ok(
    Math.abs(oldPreview.score - oldDetail.score) <= 20,
    'stale badge ' + oldPreview.score + ' vs detail ' + oldDetail.score
  );
});

test('responses managed off LinkedIn is a consistent +10', () => {
  const a = shared.scoreListingSignals({
    title: 'Senior Software Engineer',
    daysOpen: 30,
    responseManagedOffsite: true,
    salaryListed: false,
  }, { platform: 'linkedin' });
  const b = shared.scoreListingSignals({
    title: 'Senior Software Engineer',
    daysOpen: 30,
    responseManagedOffsite: true,
    salaryListed: false,
  }, { platform: 'linkedin' });
  assert.equal(a.score, b.score);
  assert.ok(a.signals.some(s => /managed off LinkedIn/i.test(s)));
  assert.ok(a.score >= 30);
});

test('broken template text is a low-effort risk chip', () => {
  assert.equal(shared.hasBrokenTemplate('Join {:companyName} as an engineer'), true);
  assert.equal(shared.hasBrokenTemplate('We are a real company with a real JD'), false);
  const scored = shared.scoreListingSignals({
    title: 'Engineer',
    daysOpen: 10,
    description: 'Work at {:companyName} in {{location}}',
    salaryListed: true,
  }, { platform: 'linkedin' });
  assert.ok(scored.signals.some(s => /placeholder/i.test(s)));
});

test('Indeed shared path keeps a typical 7-day role low and still floors 60d', () => {
  const specific = 'C++ Python Linux real-time systems. Reports to the engineering director. Team of 6. $120,000.';
  const fresh = shared.scoreListingSignals({
    title: 'Staff Engineer',
    daysOpen: 7,
    salaryListed: true,
    description: specific,
    employerResponsive: true,
  }, {
    platform: 'indeed',
    vagueness: 0.1,
    afterShared(score, signals) {
      score -= 5;
      signals.push('✓ Employer responds quickly');
      return { score, signals };
    },
  });
  assert.ok(fresh.score < 30, 'Indeed 7-day typical scored ' + fresh.score);

  const stale = shared.scoreListingSignals({
    title: 'Staff Engineer',
    daysOpen: 60,
    salaryListed: false,
    description: specific,
  }, { platform: 'indeed', vagueness: 0.1 });
  assert.ok(stale.score >= 50, 'Indeed 60-day must honor age floor, got ' + stale.score);
});

test('fresh 3-day role stays Worth Applying', () => {
  const fresh = shared.scoreListingSignals({
    title: 'Engineer',
    daysOpen: 3,
    salaryListed: true,
    description: 'React Node AWS. Reports to the director. Team of 5. $130,000. 3 years.',
  }, { platform: 'linkedin', vagueness: 0.1 });
  assert.ok(fresh.score < 25, 'fresh role scored ' + fresh.score);
  assert.equal(fresh.label, 'low');
});
