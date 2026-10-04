'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('../extension/content/shared.js');
const { load: loadLinkedIn } = require('./helpers/linkedin-dom.js');
const { load: loadIndeed } = require('./helpers/indeed-dom.js');

const LABEL = 'Just posted — apply early';

function scoreOf(listing, platform) {
  return shared.scoreListingSignals(Object.assign({ platform: platform }, listing), { platform: platform });
}

test('just posted is informational and does not change the ghost score', () => {
  const fresh = {
    title: 'Engineer',
    companyName: 'Acme',
    daysOpen: 1,
    isRepost: false,
    salaryListed: false,
    descriptionParsed: true,
    description: 'Specific duties, HubSpot, a team of 8, and a salary of $140,000.',
  };
  const plain = scoreOf(fresh, 'linkedin');
  const tagged = scoreOf(Object.assign({ justPosted: true }, fresh), 'linkedin');
  const indeed = scoreOf(fresh, 'indeed');
  const indeedTagged = scoreOf(Object.assign({ justPosted: true }, fresh), 'indeed');

  assert.equal(plain.score, tagged.score);
  assert.equal(plain.label, tagged.label);
  assert.deepEqual(plain.signals, tagged.signals);
  assert.equal(indeed.score, indeedTagged.score);
  assert.deepEqual(indeed.signals, indeedTagged.signals);
  assert.equal(shared.justPostedEligible(fresh), true);
  assert.equal(shared.freshBadgeMarkup(fresh).includes(LABEL), true);
  assert.equal(plain.signals.includes(LABEL), false);
  assert.equal(indeed.signals.includes(LABEL), false);
  assert.ok(plain.signals.some((s) => /No salary listed/.test(s)));
  assert.ok(indeed.signals.some((s) => /No salary listed/.test(s)));
  assert.equal(shared.freshBadgeMarkup(fresh).includes('ghost-detector-signal'), false);

  const unknown = scoreOf({ title: 'Engineer', companyName: 'Acme', daysOpen: null, salaryListed: false }, 'linkedin');
  assert.equal(shared.justPostedEligible({ daysOpen: null }), false);
  assert.equal(shared.freshBadgeMarkup({ daysOpen: null }), '');
  assert.ok(unknown.signals.some((s) => /Posting age unknown/.test(s)));
  assert.equal(unknown.signals.includes(LABEL), false);

  const repost = {
    title: 'Engineer',
    companyName: 'Acme',
    daysOpen: 2,
    isRepost: true,
    salaryListed: true,
  };
  const repostScore = scoreOf(repost, 'linkedin');
  assert.equal(shared.justPostedEligible(repost), false);
  assert.equal(shared.freshBadgeMarkup(repost), '');
  assert.ok(repostScore.signals.some((s) => /Recycled listing/.test(s)));
  assert.equal(repostScore.signals.includes(LABEL), false);

  const older = scoreOf({ title: 'Engineer', daysOpen: 3, isRepost: false }, 'linkedin');
  assert.equal(shared.justPostedEligible({ daysOpen: 3, isRepost: false }), false);
  assert.equal(shared.justPostedEligible({ daysOpen: 2, isRepost: false }), true);
  assert.equal(shared.justPostedEligible({ daysOpen: 0, isRepost: false }), true);
  assert.equal(older.signals.includes(LABEL), false);

  const tracked = shared.buildTrackPayload(fresh, { platform: 'linkedin', listingHeuristic: plain.score });
  assert.equal(JSON.stringify(tracked).includes(LABEL), false);
  assert.equal(JSON.stringify(tracked).includes('Welcome'), false);
  assert.equal(tracked.daysOpen, 1);
});

test('LinkedIn and Indeed age phrases qualify only when parsed and not a repost', () => {
  const phrases = [
    ['Posted today', 0],
    ['Just posted', 0],
    ['2 hours ago', 0],
    ['5 hours ago', 0],
    ['Today', 0],
    ['1 day ago', 1],
    ['2 days ago', 2],
  ];
  for (const pair of phrases) {
    const days = shared.parseRelativeDays(pair[0]);
    assert.equal(days, pair[1], pair[0]);
    assert.equal(shared.justPostedEligible({ daysOpen: days, isRepost: false }), true, pair[0]);
    assert.equal(shared.justPostedEligible({ daysOpen: days, isRepost: true }), false, pair[0] + ' repost');
  }
  assert.equal(shared.parseRelativeDays('Reposted 2 days ago'), 2);
  assert.equal(shared.parseLinkedInMetadataLine('Reposted 2 days ago').isRepost, true);
  assert.equal(shared.justPostedEligible({
    daysOpen: shared.parseRelativeDays('Reposted 2 days ago'),
    isRepost: true,
  }), false);
  assert.equal(shared.parseRelativeDays('3 days ago'), 3);
  assert.equal(shared.justPostedEligible({ daysOpen: 3, isRepost: false }), false);
  assert.equal(shared.justPostedEligible({ daysOpen: null, isRepost: false }), false);
  assert.equal(shared.JUST_POSTED_LABEL, LABEL);
  assert.equal(/\d+%|better odds|48 hours/.test(LABEL), false);
});

const LINKEDIN_ROWS = '<div id="list">' +
  '<div id="today" data-job-id="1001">' +
    '<a href="https://www.linkedin.com/jobs/view/1001/">Product Designer</a>' +
    '<a href="https://www.linkedin.com/company/acme/">Acme</a>' +
    '<span>Posted today</span>' +
  '</div>' +
  '<div id="hours" data-job-id="1002">' +
    '<a href="https://www.linkedin.com/jobs/view/1002/">Analyst</a>' +
    '<a href="https://www.linkedin.com/company/beta/">Beta</a>' +
    '<span>2 hours ago</span>' +
  '</div>' +
  '<div id="just" data-job-id="1003">' +
    '<a href="https://www.linkedin.com/jobs/view/1003/">Writer</a>' +
    '<a href="https://www.linkedin.com/company/ink/">Ink</a>' +
    '<span>Just posted</span>' +
  '</div>' +
  '<div id="oneday" data-job-id="1004">' +
    '<a href="https://www.linkedin.com/jobs/view/1004/">Day Old</a>' +
    '<a href="https://www.linkedin.com/company/fox/">Fox</a>' +
    '<span>1 day ago</span>' +
  '</div>' +
  '<div id="repost" data-job-id="1005">' +
    '<a href="https://www.linkedin.com/jobs/view/1005/">Recycled Role</a>' +
    '<a href="https://www.linkedin.com/company/gamma/">Gamma</a>' +
    '<span>Reposted 2 days ago</span>' +
  '</div>' +
  '<div id="older" data-job-id="1006">' +
    '<a href="https://www.linkedin.com/jobs/view/1006/">Older Role</a>' +
    '<a href="https://www.linkedin.com/company/delta/">Delta</a>' +
    '<span>3 days ago</span>' +
  '</div>' +
  '<div id="unknown" data-job-id="1007">' +
    '<a href="https://www.linkedin.com/jobs/view/1007/">Quiet Role</a>' +
    '<a href="https://www.linkedin.com/company/echo/">Echo</a>' +
  '</div>' +
  '</div>';

test('LinkedIn list rows show one freshness badge only when age was parsed', () => {
  const dom = loadLinkedIn(LINKEDIN_ROWS, 'https://www.linkedin.com/feed/');
  try {
    const doc = dom.window.document;
    const STJ = dom.window.SkipThisJobShared;
    const expectBadge = ['today', 'hours', 'just', 'oneday'];
    const expectNone = ['repost', 'older', 'unknown'];
    const before = {};
    expectBadge.concat(expectNone).forEach((id) => {
      const card = doc.getElementById(id);
      const parsed = dom.window.parseLinkedInCard(card);
      before[id] = {
        score: STJ.scoreListPreview(parsed).score,
        signals: STJ.scoreListPreview(parsed).signals.slice(),
        daysOpen: parsed.daysOpen,
        isRepost: parsed.isRepost,
        title: parsed.title,
      };
    });
    assert.equal(before.today.daysOpen, 0);
    assert.equal(before.hours.daysOpen, 0);
    assert.equal(before.just.daysOpen, 0);
    assert.equal(before.oneday.daysOpen, 1);
    assert.equal(before.repost.daysOpen, 2);
    assert.equal(before.repost.isRepost, true);
    assert.equal(before.older.daysOpen, 3);
    assert.equal(before.unknown.daysOpen, null);
    assert.equal(before.today.title, 'Product Designer');

    dom.window.refreshLinkedInListBadges();
    dom.window.refreshLinkedInListBadges();

    expectBadge.forEach((id) => {
      const card = doc.getElementById(id);
      assert.equal(card.querySelectorAll('.stj-fresh-badge').length, 1, id);
      assert.equal(card.querySelector('.stj-fresh-badge').textContent, LABEL, id);
      assert.equal(card.querySelectorAll('.stj-list-badge').length, 1, id);
      const parsed = dom.window.parseLinkedInCard(card);
      const scored = STJ.scoreListPreview(parsed);
      assert.equal(scored.score, before[id].score, id);
      assert.deepEqual(scored.signals, before[id].signals, id);
      assert.equal(parsed.daysOpen, before[id].daysOpen, id);
      assert.equal(parsed.title.includes('Just posted'), false, id);
      assert.equal(parsed.title.includes('Welcome'), false, id);
    });
    expectNone.forEach((id) => {
      const card = doc.getElementById(id);
      assert.equal(card.querySelectorAll('.stj-fresh-badge').length, 0, id);
      assert.equal(card.querySelectorAll('.stj-list-badge').length, 1, id);
      const parsed = dom.window.parseLinkedInCard(card);
      assert.equal(STJ.scoreListPreview(parsed).score, before[id].score, id);
      assert.equal(parsed.daysOpen, before[id].daysOpen, id);
    });

    const unknown = doc.getElementById('unknown');
    STJ.injectFreshBadge(unknown, { daysOpen: 0, isRepost: false }, unknown.querySelector('a'));
    const polluted = dom.window.parseLinkedInCard(unknown);
    assert.equal(polluted.daysOpen, null);
    assert.equal(STJ.scoreListPreview(polluted).score, before.unknown.score);
    assert.equal(polluted.title.includes(LABEL), false);
    dom.window.refreshLinkedInListBadges();
    assert.equal(unknown.querySelectorAll('.stj-fresh-badge').length, 0);
  } finally {
    dom.window.close();
  }
});

test('LinkedIn full card shows the freshness badge beside warning chips', () => {
  const dom = loadLinkedIn('<div id="job"></div>', 'https://www.linkedin.com/feed/');
  try {
    const listing = {
      title: 'Product Designer',
      companyName: 'Acme',
      daysOpen: 0,
      isRepost: false,
      salaryListed: false,
      platform: 'linkedin',
      platformJobId: '1001',
      descriptionParsed: true,
      description: 'Specific duties with HubSpot, a team of 8, and $140,000.',
    };
    const scored = dom.window.SkipThisJobShared.scoreListingSignals(listing, { platform: 'linkedin' });
    dom.window.injectOverlay(scored, null, listing);
    dom.window.injectOverlay(scored, null, listing);
    const doc = dom.window.document;
    const overlays = doc.querySelectorAll('#ghost-detector-overlay, [data-stj-overlay="1"]');
    assert.equal(overlays.length, 1);
    const overlay = overlays[0];
    assert.equal(overlay.querySelectorAll('.stj-fresh-badge').length, 1);
    assert.equal(overlay.querySelector('.stj-fresh-badge').textContent, LABEL);
    const signals = overlay.querySelector('.ghost-detector-signals');
    assert.ok(signals);
    assert.equal(signals.contains(overlay.querySelector('.stj-fresh-badge')), false);
    assert.equal(signals.querySelectorAll('.ghost-detector-signal').length, scored.signals.length);
    assert.ok(Array.from(signals.querySelectorAll('.ghost-detector-signal')).some((el) => /No salary listed/.test(el.textContent)));
    assert.equal(signals.textContent.includes(LABEL), false);
    assert.equal(overlay.querySelector('.ghost-detector-score').textContent, scored.score + '/100');

    const repost = Object.assign({}, listing, { isRepost: true, daysOpen: 1 });
    const repostScore = dom.window.SkipThisJobShared.scoreListingSignals(repost, { platform: 'linkedin' });
    dom.window.injectOverlay(repostScore, null, repost);
    const again = doc.getElementById('ghost-detector-overlay');
    assert.equal(again.querySelectorAll('.stj-fresh-badge').length, 0);
    assert.ok(again.textContent.includes('Recycled listing'));
    assert.equal(again.querySelector('.ghost-detector-score').textContent, repostScore.score + '/100');
  } finally {
    dom.window.close();
  }
});

function indeedCard(id, jk, dateText) {
  return '<div class="job_seen_beacon" data-jk="' + jk + '" id="' + id + '">' +
    '<h2 class="jobTitle"><a id="job_' + jk + '"><span>Designer</span></a></h2>' +
    '<span data-testid="company-name">Acme</span>' +
    (dateText ? '<span class="date">' + dateText + '</span>' : '') +
    '</div>';
}

test('Indeed list rows and the full card keep score and warning chips', () => {
  const html = indeedCard('just', 'aaa111aaa111aaa1', 'Just posted') +
    indeedCard('today', 'bbb222bbb222bbb2', 'Today') +
    indeedCard('postedtoday', 'ccc333ccc333ccc3', 'Posted today') +
    indeedCard('oneday', 'ddd444ddd444ddd4', '1 day ago') +
    indeedCard('hours', 'eee555eee555eee5', '3 hours ago') +
    indeedCard('repost', 'fff666fff666fff6', 'Reposted 2 days ago') +
    indeedCard('older', 'ggg777ggg777ggg7', '4 days ago') +
    indeedCard('unknown', 'hhh888hhh888hhh8', '');
  const dom = loadIndeed(html, 'https://www.indeed.com/jobs?q=designer');
  try {
    const doc = dom.window.document;
    const STJ = dom.window.SkipThisJobShared;
    const show = ['just', 'today', 'postedtoday', 'oneday', 'hours'];
    const hide = ['repost', 'older', 'unknown'];
    const before = {};
    show.concat(hide).forEach((id) => {
      const card = doc.getElementById(id);
      const parsed = dom.window.parseIndeedCard(card);
      before[id] = {
        parsed: parsed,
        score: STJ.scoreListPreview(parsed).score,
        signals: STJ.scoreListPreview(parsed).signals.slice(),
      };
      const anchor = card.querySelector('h2');
      STJ.injectFreshBadge(card, parsed, anchor);
      STJ.injectFreshBadge(card, parsed, anchor);
    });
    assert.equal(before.just.parsed.daysOpen, 0);
    assert.equal(before.just.parsed.isRepost, false);
    assert.equal(before.today.parsed.daysOpen, 0);
    assert.equal(before.postedtoday.parsed.daysOpen, 0);
    assert.equal(before.oneday.parsed.daysOpen, 1);
    assert.equal(before.hours.parsed.daysOpen, 0);
    assert.equal(before.repost.parsed.isRepost, true);
    assert.equal(before.repost.parsed.daysOpen, 2);
    assert.equal(before.older.parsed.daysOpen, 4);
    assert.equal(before.unknown.parsed.daysOpen, null);

    show.forEach((id) => {
      const card = doc.getElementById(id);
      assert.equal(card.querySelectorAll('.stj-fresh-badge').length, 1, id);
      assert.equal(card.querySelector('.stj-fresh-badge').textContent, LABEL, id);
      const parsed = dom.window.parseIndeedCard(card);
      const scored = STJ.scoreListPreview(parsed);
      assert.equal(parsed.daysOpen, before[id].parsed.daysOpen, id);
      assert.equal(parsed.isRepost, before[id].parsed.isRepost, id);
      assert.equal(scored.score, before[id].score, id);
      assert.deepEqual(scored.signals, before[id].signals, id);
      assert.equal(parsed.title, 'Designer', id);
    });
    hide.forEach((id) => {
      const card = doc.getElementById(id);
      assert.equal(card.querySelectorAll('.stj-fresh-badge').length, 0, id);
      const parsed = dom.window.parseIndeedCard(card);
      assert.equal(parsed.daysOpen, before[id].parsed.daysOpen, id);
      assert.equal(STJ.scoreListPreview(parsed).score, before[id].score, id);
    });

    const listing = {
      title: 'Designer',
      companyName: 'Acme',
      daysOpen: 1,
      isRepost: false,
      salaryListed: false,
      platform: 'indeed',
      platformJobId: 'aaa111aaa111aaa1',
      descriptionParsed: true,
      description: 'Specific duties with HubSpot, a team of 8, and $140,000.',
    };
    const scored = STJ.scoreListingSignals(listing, { platform: 'indeed' });
    dom.window.injectOverlay(scored, null, listing);
    dom.window.injectOverlay(scored, null, listing);
    const overlay = doc.getElementById('ghost-detector-overlay');
    assert.equal(doc.querySelectorAll('#ghost-detector-overlay').length, 1);
    assert.equal(overlay.querySelectorAll('.stj-fresh-badge').length, 1);
    const signals = overlay.querySelector('.ghost-detector-signals');
    assert.equal(signals.contains(overlay.querySelector('.stj-fresh-badge')), false);
    assert.equal(signals.querySelectorAll('.ghost-detector-signal').length, scored.signals.length);
    assert.ok(Array.from(signals.querySelectorAll('.ghost-detector-signal')).some((el) => /No salary listed/.test(el.textContent)));
    assert.equal(overlay.querySelector('.ghost-detector-score').textContent, scored.score + '/100');
    assert.equal(overlay.textContent.includes('Welcome'), false);
  } finally {
    dom.window.close();
  }
});

test('freshness badge styles are teal and do not hide warning chips', () => {
  const css = fs.readFileSync(path.join(__dirname, '../extension/content/overlay.css'), 'utf8');
  assert.match(css, /\.stj-fresh-badge\s*\{[^}]*background:\s*#ecfeff/s);
  assert.match(css, /\.stj-fresh-badge\s*\{[^}]*color:\s*#0f766e/s);
  assert.doesNotMatch(css, /\.stj-fresh-badge\s*\{[^}]*display\s*:\s*none/s);
  assert.equal(css.includes('Slight risk of triggering bot detection'), false);
});
