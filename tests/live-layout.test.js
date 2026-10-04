'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../extension/content/shared.js');
const { load: loadIndeed } = require('./helpers/indeed-dom.js');
const { load: loadLinkedIn } = require('./helpers/linkedin-dom.js');

const VJK = 'bdcf974325e2454e';
const HOME = 'https://www.indeed.com/?vjk=' + VJK;
const SEARCH = 'https://www.indeed.com/jobs?q=marketing+manager&l=San+Antonio%2C+TX&vjk=' + VJK;
const LI_JOB = '4423270116';
const LI_SEARCH = 'https://www.linkedin.com/jobs/search-results/?currentJobId=' + LI_JOB;
const LI_VIEW = 'https://www.linkedin.com/jobs/view/' + LI_JOB + '/';

function captureLogs(win) {
  const lines = [];
  win.console.log = (...args) => {
    lines.push(args.map((part) => (typeof part === 'string' ? part : String(part))).join(' '));
  };
  return lines;
}

function indeedPage(opts) {
  const jobKey = opts.jobKey || VJK;
  const json = opts.jsonLd ? '<script type="application/ld+json">' + opts.jsonLd + '</script>' : '';
  const og = opts.ogTitle
    ? '<meta property="og:title" content="' + opts.ogTitle + '">'
    : '';
  return '<!DOCTYPE html><html><head><title>' + opts.docTitle + '</title>' + og + json + '</head><body>' +
    '<h1>Welcome, Austin</h1>' +
    '<h2>Jobs for you</h2>' +
    '<div id="jobsearch-ViewjobPaneWrapper" data-jk="' + jobKey + '">' +
    (opts.before || '<h2>Pay</h2>') +
    '<div data-testid="inlineHeader-companyName"><a>' + opts.company + '</a></div>' +
    '<h2>Job type</h2><h2>Benefits</h2><h2>Qualifications</h2>' +
    '<h2>Full job description</h2><h2>Shift and schedule</h2>' +
    (opts.after || '') +
    '</div></body></html>';
}

test('section labels are not Indeed job titles', () => {
  for (const label of ['Pay', 'Pay & benefits', 'Job type', 'Benefits', 'Qualifications', 'Full job description', 'Location', 'Profile insights', 'Job details', 'Shift and schedule', 'Welcome, Austin', 'Hi, Sam', 'Jobs for you']) {
    assert.equal(shared.isRejectedJobTitle(label), true, label);
  }
  assert.deepEqual(
    shared.parseIndeedPageTitle('Head of Marketing - Inato - Indeed'),
    { title: 'Head of Marketing', companyName: 'Inato' }
  );
  assert.deepEqual(
    shared.parseIndeedPageTitle('Head of Marketing - Inato - Indeed - job post'),
    { title: 'Head of Marketing', companyName: 'Inato' }
  );
  assert.deepEqual(
    shared.parseIndeedPageTitle('Marketing Manager- Harley-Davidson of Alamo City - Ed Morse Automotive Group - San Antonio, TX - Indeed'),
    { title: 'Marketing Manager- Harley-Davidson of Alamo City', companyName: 'Ed Morse Automotive Group' }
  );
  assert.equal(shared.parseIndeedPageTitle('Job type - Inato - Indeed'), null);
  assert.equal(shared.parseIndeedPageTitle('Pay - Inato - Indeed'), null);
});

test('Indeed home vjk ignores Pay and Job type and uses the page title', async () => {
  const dom = loadIndeed(indeedPage({
    docTitle: 'Head of Marketing - Inato - Indeed',
    company: 'Inato',
  }), HOME);
  try {
    const lines = captureLogs(dom.window);
    const listing = await dom.window.parseIndeedListing();
    assert.equal(listing.title, 'Head of Marketing');
    assert.equal(listing.companyName, 'Inato');
    assert.equal(listing.fieldSources.title, 'document.title');
    assert.notEqual(listing.title, 'Pay');
    assert.notEqual(listing.title, 'Job type');
    const sourceLine = lines.find((line) => line.includes('[SkipThisJob] Indeed field sources:'));
    assert.match(sourceLine, /title=document\.title/);
  } finally {
    dom.window.close();
  }
});

test('Indeed search uses the open-job page title instead of Job type', async () => {
  const dom = loadIndeed(indeedPage({
    docTitle: 'Marketing Manager- Harley-Davidson of Alamo City - Ed Morse Automotive Group - San Antonio, TX - Indeed',
    company: 'Ed Morse Automotive Group',
  }), SEARCH);
  try {
    const lines = captureLogs(dom.window);
    const listing = await dom.window.parseIndeedListing();
    assert.equal(listing.title, 'Marketing Manager- Harley-Davidson of Alamo City');
    assert.equal(listing.companyName, 'Ed Morse Automotive Group');
    assert.equal(listing.fieldSources.title, 'document.title');
    assert.match(
      lines.find((line) => line.includes('[SkipThisJob] Indeed field sources:')),
      /title=document\.title/
    );
  } finally {
    dom.window.close();
  }
});

test('a stable Indeed title element beats section headings and the SERP title', async () => {
  const dom = loadIndeed(indeedPage({
    docTitle: 'marketing manager jobs in San Antonio, TX',
    company: 'Ed Morse Automotive Group',
    before: '<h2 data-testid="jobsearch-JobInfoHeader-title"><span>Marketing Manager- Harley-Davidson of Alamo City</span></h2>',
  }), SEARCH);
  try {
    const listing = await dom.window.parseIndeedListing();
    assert.equal(listing.title, 'Marketing Manager- Harley-Davidson of Alamo City');
    assert.equal(listing.fieldSources.title, 'job-header');
  } finally {
    dom.window.close();
  }
});

test('og:title and JSON-LD supply the Indeed title when headings are section labels', async () => {
  const ogDom = loadIndeed(indeedPage({
    docTitle: 'Indeed',
    ogTitle: 'Head of Marketing - Inato - Indeed',
    company: 'Inato',
  }), HOME);
  try {
    const listing = await ogDom.window.parseIndeedListing();
    assert.equal(listing.title, 'Head of Marketing');
    assert.equal(listing.fieldSources.title, 'og:title');
  } finally {
    ogDom.window.close();
  }

  const json = JSON.stringify({
    '@type': 'JobPosting',
    title: 'Head of Marketing',
    url: 'https://www.indeed.com/viewjob?jk=' + VJK,
    hiringOrganization: { '@type': 'Organization', name: 'Inato' },
  });
  const ldDom = loadIndeed(indeedPage({
    docTitle: 'it support jobs in San Antonio, TX',
    company: 'Inato',
    jsonLd: json,
  }), HOME);
  try {
    const listing = await ldDom.window.parseIndeedListing();
    assert.equal(listing.title, 'Head of Marketing');
    assert.equal(listing.companyName, 'Inato');
    assert.equal(listing.fieldSources.title, 'json-ld');
  } finally {
    ldDom.window.close();
  }
});

test('a rejected Indeed title stays unparsed and is not scored', async () => {
  const dom = loadIndeed(indeedPage({
    docTitle: 'marketing manager jobs in San Antonio, TX',
    company: 'Ed Morse Automotive Group',
  }), SEARCH);
  try {
    const listing = await dom.window.parseIndeedListing();
    assert.equal(listing.title, null);
    assert.equal(listing.companyName, 'Ed Morse Automotive Group');
    assert.equal(listing.fieldSources.title, null);
    let scored = false;
    const result = shared.scoreParsedListing(listing, () => { scored = true; return { score: 90 }; }, {
      platform: 'indeed',
      require: ['title', 'companyName'],
    });
    assert.equal(scored, false);
    assert.equal(result.state, 'unparsed');
    assert.equal(result.score, null);
    assert.ok(result.missing.includes('title'));
  } finally {
    dom.window.close();
  }
});

const HIDDEN = 'HIDDEN_SENTENCE_MARKER You will report to the Vice President of Product Marketing. Compensation is $180,000 per year. The team of 8 uses Salesforce, HubSpot, and Tableau. Eight years of experience are required. You own the outbound dialer narrative and the quarterly launch plan with the San Ramon office. ';
const COMPANY_MARKER = 'COMPANY_BLOCK_MARKER';

function linkedInColumn(includeOffsite) {
  return '<div id="column">' +
    '<div class="jobs-details" id="header-only">' +
      '<p><a href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">Senior Product Marketing Manager</a></p>' +
      '<p><a href="https://www.linkedin.com/company/five9/">Five9</a></p>' +
      '<p>United States · Reposted 2 weeks ago · Over 100 applicants</p>' +
    '</div>' +
    '<div id="jd">' +
      '<div class="ckyhd"><span class="ckyicon" aria-hidden="true"></span> About the job</div>' +
      '<div>Visible intro for the campaign role.</div>' +
      '<button type="button"><span>Show more</span></button>' +
      '<span hidden>' + HIDDEN.repeat(3) + '</span>' +
      (includeOffsite ? '<p>Responses managed off LinkedIn</p>' : '') +
      '<div><div>About the company</div><p>' + COMPANY_MARKER +
      ' This company blurb is long enough to steal the description if the section stop fails. '.repeat(8) +
      '</p></div>' +
    '</div></div>';
}

function linkedInSearch(includeOffsite) {
  return '<!DOCTYPE html><html><head><title>Jobs | LinkedIn</title></head><body>' +
    '<div class="ckylist" id="list">' +
      '<div class="ckya"><p><a href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">Senior Product Marketing Manager</a></p></div>' +
      '<div class="ckyb"><p><a href="https://www.linkedin.com/jobs/view/1111111111/">Other Role</a></p></div>' +
    '</div>' +
    '<aside id="insights">Responses managed off LinkedIn — less accountability</aside>' +
    linkedInColumn(includeOffsite) +
    '</body></html>';
}

function linkedInView(includeOffsite) {
  return '<!DOCTYPE html><html><head><title>Jobs | LinkedIn</title></head><body>' +
    linkedInColumn(includeOffsite) +
    '</body></html>';
}

function hasChip(score, pattern) {
  return score.signals.some((signal) => pattern.test(String(signal)));
}

test('About the job text, including collapsed Show more, is the description on both LinkedIn layouts', () => {
  const search = loadLinkedIn(linkedInSearch(true), LI_SEARCH);
  const view = loadLinkedIn(linkedInView(true), LI_VIEW);
  try {
    const searchLines = captureLogs(search.window);
    const viewLines = captureLogs(view.window);
    const searchListing = search.window.parseLinkedInListing();
    const viewListing = view.window.parseLinkedInListing();
    assert.equal(searchListing.fieldSources.description, 'about-job');
    assert.equal(viewListing.fieldSources.description, 'about-job');
    assert.equal(searchListing.description, viewListing.description);
    assert.match(searchListing.description, /HIDDEN_SENTENCE_MARKER/);
    assert.doesNotMatch(searchListing.description, /COMPANY_BLOCK_MARKER/);
    assert.doesNotMatch(searchListing.description, /Show more/);
    assert.equal(searchListing.responseManagedOffsite, true);
    assert.equal(viewListing.responseManagedOffsite, true);
    assert.match(
      searchLines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:')),
      /description=about-job/
    );
    assert.match(
      searchLines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:')),
      /responseManagedOffsite=job-pane/
    );
    assert.match(
      viewLines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:')),
      /responseManagedOffsite=job-pane/
    );
    const searchScore = search.window.scoreLocally(searchListing);
    const viewScore = view.window.scoreLocally(viewListing);
    assert.equal(searchScore.score, viewScore.score);
    assert.deepEqual(
      Array.from(searchScore.signals).map(String).sort(),
      Array.from(viewScore.signals).map(String).sort()
    );
    assert.equal(hasChip(searchScore, /Responses managed off LinkedIn/), true);
    assert.equal(hasChip(viewScore, /Responses managed off LinkedIn/), true);
  } finally {
    search.window.close();
    view.window.close();
  }
});

test('a search-only off-LinkedIn aside scores 0 on both layouts', () => {
  const search = loadLinkedIn(linkedInSearch(false), LI_SEARCH);
  const view = loadLinkedIn(linkedInView(false), LI_VIEW);
  const withPhrase = loadLinkedIn(linkedInSearch(true), LI_SEARCH);
  try {
    const lines = captureLogs(search.window);
    const searchListing = search.window.parseLinkedInListing();
    const viewListing = view.window.parseLinkedInListing();
    const phraseListing = withPhrase.window.parseLinkedInListing();
    assert.equal(searchListing.responseManagedOffsite, false);
    assert.equal(viewListing.responseManagedOffsite, false);
    assert.equal(searchListing.fieldSources.description, 'about-job');
    assert.equal(viewListing.fieldSources.description, 'about-job');
    assert.match(searchListing.description, /HIDDEN_SENTENCE_MARKER/);
    const searchScore = search.window.scoreLocally(searchListing);
    const viewScore = view.window.scoreLocally(viewListing);
    const phraseScore = withPhrase.window.scoreLocally(phraseListing);
    assert.equal(searchScore.score, viewScore.score);
    assert.equal(hasChip(searchScore, /Responses managed off LinkedIn/), false);
    assert.equal(hasChip(viewScore, /Responses managed off LinkedIn/), false);
    assert.equal(phraseScore.score - searchScore.score, 10);
    assert.match(
      lines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:')),
      /responseManagedOffsite=none/
    );
  } finally {
    search.window.close();
    view.window.close();
    withPhrase.window.close();
  }
});

test('meta description is the last LinkedIn description fallback', () => {
  const html = '<!DOCTYPE html><html><head>' +
    '<meta property="og:description" content="' + HIDDEN.repeat(2) + '">' +
    '<title>Senior Product Marketing Manager | Five9 | LinkedIn</title>' +
    '</head><body>' +
    '<div id="column"><p><a href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">Senior Product Marketing Manager</a></p>' +
    '<p><a href="https://www.linkedin.com/company/five9/">Five9</a></p></div>' +
    '</body></html>';
  const dom = loadLinkedIn(html, LI_VIEW);
  try {
    const listing = dom.window.parseLinkedInListing();
    assert.equal(listing.fieldSources.description, 'og:description');
    assert.match(listing.description, /HIDDEN_SENTENCE_MARKER/);
  } finally {
    dom.window.close();
  }
});

function nestCky(inner, depth) {
  let html = inner;
  for (let i = 0; i < depth; i++) html = '<div class="cky' + i.toString(36) + '">' + html + '</div>';
  return html;
}

function ckyRows() {
  const titles = [
    ['1000000001', 'Marketing Manager'],
    ['1000000002', 'Brand Lead'],
    ['1000000003', 'Content Manager'],
    ['1000000004', 'Growth Lead'],
  ];
  const rows = titles.map(([id, title]) => {
    const anchor = '<p><a href="https://www.linkedin.com/jobs/view/' + id + '/">' + title + '</a></p>';
    return '<div class="ckyrow" data-display-contents>' + nestCky(anchor, 20) + '</div>';
  }).join('');
  return '<div class="ckylist" id="cky-list">' + rows + '</div>' +
    '<div id="detail">' +
      '<p><a href="https://www.linkedin.com/jobs/view/1000000001/">Marketing Manager</a></p>' +
      '<a href="https://www.linkedin.com/company/acme/">Acme</a>' +
      '<p>United States · Reposted 2 weeks ago · Over 100 applicants</p>' +
    '</div>';
}

test('cky display-contents rows get one badge each, including a remembered score', () => {
  const dom = loadLinkedIn('<!DOCTYPE html><html><body>' + ckyRows() + '</body></html>', LI_SEARCH);
  try {
    const doc = dom.window.document;
    const lines = captureLogs(dom.window);
    const cards = dom.window.findLinkedInJobCards();
    assert.equal(cards.length, 4);
    assert.match(
      lines.find((line) => line.includes('[SkipThisJob] LinkedIn list rows:')),
      /LinkedIn list rows: 4/
    );
    for (const card of cards) {
      assert.match(card.className, /cky/);
      assert.equal(card.hasAttribute('data-job-id'), false);
      assert.equal(card.hasAttribute('data-occludable-job-id'), false);
      assert.equal(card.hasAttribute('componentkey'), false);
      assert.equal(card.hasAttribute('data-display-contents'), true);
      assert.ok(card.querySelector('p a[href*="/jobs/view/"]'));
    }
    assert.equal(cards.some((card) => card.id === 'detail'), false);
    dom.window.SkipThisJobShared.rememberListBadgeScore(
      '1000000001',
      { score: 88, label: 'very_high', signals: [] },
      { source: 'detail', daysOpen: null }
    );
    dom.window.refreshLinkedInListBadges();
    dom.window.refreshLinkedInListBadges();
    assert.equal(doc.querySelectorAll('.stj-list-badge').length, 4);
    for (const card of cards) {
      assert.equal(card.querySelectorAll('.stj-list-badge').length, 1);
    }
    assert.equal(doc.querySelectorAll('#detail .stj-list-badge').length, 0);
    const remembered = cards.find((card) => card.querySelector('a[href*="1000000001"]'));
    assert.equal(remembered.querySelector('.stj-list-badge').getAttribute('data-stj-score'), '88');
    assert.equal(remembered.querySelector('.stj-list-badge').getAttribute('data-stj-source'), 'detail');
  } finally {
    dom.window.close();
  }
});

function realJobCard(id, opts) {
  const title = opts.title;
  const verified = opts.verified === false
    ? ''
    : '<span>' + title + ' (Verified job)</span>';
  const visible = opts.verified === false
    ? '<span>' + title + '</span>'
    : '<span aria-hidden="true">' + title + '<span> </span></span>';
  const reviewing = opts.reviewing ? '<p><span>Actively reviewing applicants</span></p>' : '';
  const easy = opts.easy ? '<p>Easy Apply</p>' : '';
  const viewed = opts.viewed ? '<p>Viewed</p>' : '';
  const benefits = opts.benefits ? '<p>401(k), +1 benefit</p>' : '';
  const age = opts.age || '2 weeks ago';
  return '<div role="button" tabindex="0" class="ckyrow" componentkey="job-card-component-ref-' + id + '">' +
    '<div class="ckyinner" componentkey="job-card-component-ref-' + id + '">' +
      '<div data-display-contents="true"><p>' + verified + visible + '</p></div>' +
      '<div><p>' + opts.company + '</p></div>' +
      '<p>' + opts.location + '</p>' +
      benefits + reviewing + viewed +
      '<p><span class="ckya5p">Posted ' + age + '</span><span aria-hidden="true">' + age + '</span></p>' +
      easy +
      '<p>Over 500 people clicked apply</p>' +
    '</div></div>';
}

function realResultsList() {
  const rows = [];
  for (let i = 0; i < 25; i++) {
    const id = String(4467585708 + i);
    rows.push(realJobCard(id, {
      title: i === 0 ? 'VP Media Operations' : (i === 1 ? 'Programmatic Media Group Manager' : 'Role ' + i),
      company: i === 0 ? 'Daniel Brian Advertising' : (i === 1 ? 'Citi' : 'Company ' + i),
      location: i === 0 ? 'Rochester, MI (Hybrid)' : (i === 1 ? 'Irving, TX (Hybrid)' : 'Austin, TX (On-site)'),
      reviewing: i < 6,
      easy: i < 15,
      viewed: i === 0,
      benefits: i === 1,
      verified: i !== 2,
      age: i === 3 ? '5 days ago' : (i === 1 ? '1 week ago' : '2 weeks ago'),
    }));
    if (i < 24) rows.push('<hr>');
  }
  return '<div componentkey="SearchResultsMainContent">' + rows.join('') + '</div>';
}

const OPEN_JD = ('Five9 is hiring a Senior Product Marketing Manager for the contact center. ' +
  'You will report to the Vice President of Product Marketing. The team of 8 uses Salesforce, HubSpot, and Tableau. ' +
  'Compensation is $180,000 per year. Eight years of experience are required. You own the outbound narrative and the quarterly launch plan. ').repeat(3);

function openJobPane() {
  return '<div id="detail" componentkey="8f3a1c2e-1111-4222-8333-444455556666">' +
    '<p><a href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">Senior Product Marketing Manager</a></p>' +
    '<p><a href="https://www.linkedin.com/company/five9/">Five9</a></p>' +
    '<p>United States · Reposted 3 months ago · Over 100 applicants</p>' +
    '<div id="jd">' + OPEN_JD + '</div>' +
    '</div>';
}

test('real job-card rows have no view links and log 25', () => {
  const html = '<!DOCTYPE html><html><body>' + realResultsList() + openJobPane() + '</body></html>';
  const dom = loadLinkedIn(html, LI_SEARCH);
  try {
    const doc = dom.window.document;
    const lines = captureLogs(dom.window);
    const cards = dom.window.findLinkedInJobCards();
    assert.equal(cards.length, 25);
    assert.match(
      lines.find((line) => line.includes('[SkipThisJob] LinkedIn list rows:')),
      /LinkedIn list rows: 25/
    );
    assert.equal(doc.querySelectorAll('a[href*="/jobs/view/"]').length, 1);
    assert.equal(doc.querySelectorAll('[componentkey^="job-card-component-ref-"]').length, 50);
    for (const card of cards) {
      assert.equal(card.getAttribute('role'), 'button');
      assert.match(card.getAttribute('componentkey'), /^job-card-component-ref-\d+$/);
      assert.equal(card.querySelector('a[href*="/jobs/view/"]'), null);
    }
    const first = cards.find((card) => card.getAttribute('componentkey') === 'job-card-component-ref-4467585708');
    const parsed = dom.window.parseLinkedInCard(first);
    assert.equal(parsed.title, 'VP Media Operations');
    assert.equal(parsed.companyName, 'Daniel Brian Advertising');
    assert.equal(parsed.location, 'Rochester, MI (Hybrid)');
    assert.equal(parsed.daysOpen, 14);
    assert.equal(parsed.platformJobId, '4467585708');
    assert.equal(parsed.easyApply, true);
    assert.equal(parsed.viewed, true);
    assert.equal(parsed.engagementSignals.length, 1);
    assert.equal(String(parsed.engagementSignals[0]), 'actively_reviewing');
    assert.equal(dom.window.SkipThisJobShared.listBadgeKey(first, parsed), '4467585708');
    const plain = cards.find((card) => card.getAttribute('componentkey') === 'job-card-component-ref-4467585710');
    assert.equal(dom.window.parseLinkedInCard(plain).title, 'Role 2');

    dom.window.refreshLinkedInListBadges();
    dom.window.refreshLinkedInListBadges();
    assert.equal(doc.querySelectorAll('.stj-list-badge').length, 25);
    for (const card of cards) {
      assert.equal(card.querySelectorAll('.stj-list-badge').length, 1);
      assert.equal(card.querySelector('.stj-list-badge').parentElement.tagName, 'P');
    }
    assert.equal(doc.querySelectorAll('#detail .stj-list-badge').length, 0);
    dom.window.SkipThisJobShared.applyListDim(first, 90, 75);
    assert.equal(first.classList.contains('stj-dimmed'), true);
    assert.equal(first.querySelector('.ckyinner').classList.contains('stj-dimmed'), false);
  } finally {
    dom.window.close();
  }
});

test('list-row review and Easy Apply text does not score the open job', () => {
  const search = loadLinkedIn(
    '<!DOCTYPE html><html><head><title>Jobs | LinkedIn</title></head><body>' +
      realResultsList() + openJobPane() + '</body></html>',
    LI_SEARCH
  );
  const view = loadLinkedIn(
    '<!DOCTYPE html><html><head><title>Jobs | LinkedIn</title></head><body>' +
      openJobPane() + '</body></html>',
    LI_VIEW
  );
  try {
    const searchLines = captureLogs(search.window);
    const viewLines = captureLogs(view.window);
    const searchListing = search.window.parseLinkedInListing();
    const viewListing = view.window.parseLinkedInListing();
    assert.equal(searchListing.easyApply, false);
    assert.equal(viewListing.easyApply, false);
    assert.equal(searchListing.activelyReviewing, false);
    assert.equal(viewListing.activelyReviewing, false);
    assert.equal(searchListing.engagementSignals.length, 0);
    assert.equal(searchListing.applicantCount, 100);
    assert.equal(viewListing.applicantCount, 100);
    assert.equal(searchListing.daysOpen, 90);
    assert.equal(viewListing.daysOpen, 90);
    assert.equal(searchListing.fieldSources.description, 'detail-text');
    assert.equal(viewListing.fieldSources.description, 'detail-text');
    assert.match(
      searchLines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:')),
      /easyApply=none/
    );
    assert.match(
      searchLines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:')),
      /activelyReviewing=none/
    );
    assert.match(
      viewLines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:')),
      /activelyReviewing=none/
    );
    const searchScore = search.window.scoreLocally(searchListing);
    const viewScore = view.window.scoreLocally(viewListing);
    assert.equal(searchScore.score, viewScore.score);
    assert.deepEqual(
      Array.from(searchScore.signals).map(String).sort(),
      Array.from(viewScore.signals).map(String).sort()
    );
    assert.equal(hasChip(searchScore, /actively reviewing/i), false);
    assert.equal(hasChip(viewScore, /actively reviewing/i), false);
    assert.equal(hasChip(searchScore, /Easy Apply/i), false);
    assert.equal(hasChip(viewScore, /No active review signals/), true);
    assert.equal(hasChip(viewScore, /No active review signals/), true);
  } finally {
    search.window.close();
    view.window.close();
  }
});

function deepPaneMarkup(withChrome) {
  const sentence = 'You will report to the Vice President of Product Marketing. The team of 8 uses Salesforce, HubSpot, and Tableau. Eight years of experience are required. You own the outbound dialer narrative and the quarterly launch plan with the San Ramon office. ';
  let desc = '';
  while (desc.length < 1500) desc += sentence;
  const chrome = withChrome
    ? '<div id="ghost-detector-overlay" data-stj-overlay="1"><div class="ghost-detector-card">' +
      '<span class="ghost-detector-signal">Employer actively reviewing applications</span>' +
      '<span class="stj-list-badge">Easy Apply</span>' +
      '<span class="ghost-detector-signal">Salary: $90,000 per year</span>' +
      '</div></div>'
    : '';
  let block = '<div id="hdr"><p><a id="deep-title" href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">Senior Product Marketing Manager</a></p>' +
    '<p><a href="https://www.linkedin.com/company/five9/">Five9</a></p>' +
    '<p>United States · Reposted 3 months ago · Over 100 applicants</p></div>';
  for (let i = 0; i < 6; i++) block = '<div class="nest">' + block + '</div>';
  return '<div id="pane-top"><div id="above-uuid">' +
    '<div id="uuid" componentkey="8f3a1c2e-1111-4222-8333-444455556666">' + block +
    '<h2>About the job</h2><div id="jd">' + desc + '</div>' + chrome +
    '</div></div></div>';
}

function deepSearchShell(withChrome) {
  const list = '<div componentkey="SearchResultsMainContent">' +
    realJobCard('4467585708', {
      title: 'VP Media Operations',
      company: 'Daniel Brian Advertising',
      location: 'Rochester, MI (Hybrid)',
      reviewing: true,
      easy: true,
      viewed: true,
    }) +
    '</div>';
  return '<div id="shell" class="jobs-search-results-list">' + list + deepPaneMarkup(withChrome) + '</div>';
}

test('open-job pane is the highest ancestor without list rows', () => {
  const search = loadLinkedIn(
    '<!DOCTYPE html><html><head><title>Jobs | LinkedIn</title></head><body>' +
      deepSearchShell(true) + '</body></html>',
    LI_SEARCH
  );
  const view = loadLinkedIn(
    '<!DOCTYPE html><html><head><title>Jobs | LinkedIn</title></head><body>' +
      deepPaneMarkup(false) + '</body></html>',
    LI_VIEW
  );
  try {
    const searchDoc = search.window.document;
    const anchor = searchDoc.getElementById('deep-title');
    let el = anchor;
    let uuidDepth = null;
    let topDepth = null;
    for (let depth = 0; el && depth < 20; depth++) {
      if (el.id === 'uuid') uuidDepth = depth;
      if (el.id === 'pane-top') topDepth = depth;
      el = el.parentElement;
    }
    assert.equal(uuidDepth, 9);
    assert.ok(topDepth > uuidDepth);
    const pane = search.window.openJobDetailRoot(LI_JOB);
    assert.equal(pane && pane.id, 'pane-top');
    assert.equal(pane.querySelector('[componentkey^="job-card-component-ref-"]'), null);
    assert.equal(pane.querySelector('h2').textContent, 'About the job');
    const hdrLen = (searchDoc.getElementById('hdr').textContent || '').replace(/\s+/g, ' ').trim().length;
    const paneLen = (pane.textContent || '').replace(/\s+/g, ' ').trim().length;
    assert.ok(paneLen > hdrLen + 1000, 'pane ' + paneLen + ' vs header ' + hdrLen);

    const searchLines = captureLogs(search.window);
    const viewLines = captureLogs(view.window);
    const searchListing = search.window.parseLinkedInListing();
    const viewListing = view.window.parseLinkedInListing();
    const searchSources = searchLines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
    const viewSources = viewLines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
    assert.match(searchSources, new RegExp('paneDepth=' + topDepth + '\\b'));
    const chars = Number((searchSources.match(/paneChars=(\d+)/) || [])[1]);
    assert.ok(chars > hdrLen + 1000, 'logged paneChars ' + chars);
    assert.match(viewSources, /paneDepth=/);
    assert.equal(searchListing.fieldSources.description, 'about-job');
    assert.equal(viewListing.fieldSources.description, 'about-job');
    assert.ok(searchListing.description.length >= 1500);
    assert.equal(/actively reviewing/i.test(searchListing.description), false);
    assert.equal(/90,000/.test(searchListing.description), false);
    assert.equal(searchListing.salaryListed, false);
    assert.equal(viewListing.salaryListed, false);
    assert.equal(searchListing.easyApply, false);
    assert.equal(viewListing.easyApply, false);
    assert.equal(searchListing.activelyReviewing, false);
    assert.equal(searchListing.engagementParsed, true);
    assert.equal(searchListing.hiringContactVisible, false);
    assert.equal(searchListing.applicantCount, 100);
    assert.equal(searchListing.daysOpen, 90);
    const searchScore = search.window.scoreLocally(searchListing);
    const viewScore = view.window.scoreLocally(viewListing);
    assert.equal(searchScore.score, viewScore.score);
    assert.equal(hasChip(searchScore, /No salary listed/), true);
    assert.equal(hasChip(searchScore, /No active review signals/), true);
    assert.equal(hasChip(searchScore, /No hiring contact/), true);
    assert.equal(hasChip(searchScore, /Detailed, specific job description/), true);
    assert.equal(hasChip(searchScore, /actively reviewing/i), false);
    assert.equal(hasChip(searchScore, /Easy Apply/i), false);
    assert.deepEqual(
      Array.from(searchScore.signals).map(String).sort(),
      Array.from(viewScore.signals).map(String).sort()
    );
  } finally {
    search.window.close();
    view.window.close();
  }
});

function parityBody() {
  const sentence = 'You will report to the Vice President of Product Marketing. The team of 8 uses Salesforce, HubSpot, and Tableau. Eight years of experience are required. You own the outbound dialer narrative and the quarterly launch plan with the San Ramon office. ';
  let desc = '';
  while (desc.length < 1500) desc += sentence;
  return '<h2>About the job</h2>' +
    '<div id="jd">' + desc + '</div>' +
    '<div data-testid="expandable-text-box">EXPANDABLE_BODY_MARKER The team of 8 uses Salesforce every week.</div>';
}

function parityHeaderNest() {
  let block = '<div id="hdr"><p><a id="title-anchor" href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">Senior Product Marketing Manager</a></p>' +
    '<p><a href="https://www.linkedin.com/company/five9/">Five9</a></p>' +
    '<p>United States · Reposted 3 months ago · Over 100 applicants</p></div>';
  for (let i = 0; i < 6; i++) block = '<div class="nest">' + block + '</div>';
  return block;
}

function similarJobsModule() {
  return '<section id="similar"><h3>Similar jobs</h3>' +
    '<a href="https://www.linkedin.com/jobs/view/9999999999/">Other Role</a>' +
    '<p>Easy Apply</p>' +
    '<p>Actively reviewing applicants</p>' +
    '<p>Over 500 people clicked apply</p>' +
    '<p>Responses managed off LinkedIn</p></section>';
}

function parityColumn(opts) {
  return '<div id="pane-top"><div id="above-uuid">' +
    '<div id="uuid" componentkey="8f3a1c2e-1111-4222-8333-444455556666">' +
    parityHeaderNest() +
    (opts.body ? parityBody() : '') +
    (opts.similar ? similarJobsModule() : '') +
    '</div></div></div>';
}

function paritySearchHtml(opts) {
  const list = '<div componentkey="SearchResultsMainContent">' +
    realJobCard('4467585708', {
      title: 'VP Media Operations',
      company: 'Daniel Brian Advertising',
      location: 'Rochester, MI (Hybrid)',
      reviewing: true,
      easy: true,
    }) +
    '</div>';
  return '<!DOCTYPE html><html><head><title>Jobs | LinkedIn</title></head><body>' +
    '<div id="shell" class="jobs-search-results-list">' + list + parityColumn(opts) + '</div>' +
    '</body></html>';
}

function parityViewHtml() {
  return '<!DOCTYPE html><html><head><title>Jobs | LinkedIn</title></head><body>' +
    parityColumn({ body: true, similar: false }) +
    '</body></html>';
}

function chipSet(score) {
  return Array.from(score.signals).map(String).sort();
}

test('search results with a similar-jobs link score the same as /jobs/view/', () => {
  const search = loadLinkedIn(paritySearchHtml({ body: true, similar: true }), LI_SEARCH);
  const view = loadLinkedIn(parityViewHtml(), LI_VIEW);
  try {
    const searchListing = search.window.parseLinkedInListing();
    const viewListing = view.window.parseLinkedInListing();
    assert.equal(searchListing.fieldSources.description, 'about-job');
    assert.equal(viewListing.fieldSources.description, 'about-job');
    assert.match(searchListing.description, /EXPANDABLE_BODY_MARKER/);
    assert.equal(searchListing.description, viewListing.description);
    assert.equal(/easy apply/i.test(searchListing.description), false);
    assert.equal(searchListing.easyApply, false);
    assert.equal(viewListing.easyApply, false);
    assert.equal(searchListing.activelyReviewing, false);
    assert.equal(viewListing.activelyReviewing, false);
    assert.equal(searchListing.responseManagedOffsite, false);
    assert.equal(viewListing.responseManagedOffsite, false);
    assert.equal(searchListing.applicantCount, 100);
    assert.equal(viewListing.applicantCount, 100);
    assert.equal(searchListing.salaryListed, false);
    assert.equal(viewListing.salaryListed, false);
    assert.equal(searchListing.hiringContactVisible, false);
    assert.equal(viewListing.hiringContactVisible, false);
    assert.ok(searchListing.paneChars >= 600, 'search paneChars ' + searchListing.paneChars);
    assert.ok(viewListing.paneChars >= 600, 'view paneChars ' + viewListing.paneChars);
    const pane = search.window.openJobDetailRoot(LI_JOB);
    assert.equal(pane.querySelector('h2').textContent, 'About the job');
    assert.equal(pane.querySelector('[componentkey^="job-card-component-ref-"]'), null);
    const searchScore = search.window.scoreLocally(searchListing);
    const viewScore = view.window.scoreLocally(viewListing);
    assert.equal(searchScore.score, viewScore.score);
    assert.deepEqual(chipSet(searchScore), chipSet(viewScore));
    assert.equal(hasChip(searchScore, /No salary listed/), true);
    assert.equal(hasChip(searchScore, /No active review signals/), true);
    assert.equal(hasChip(searchScore, /No hiring contact/), true);
    assert.equal(hasChip(searchScore, /Detailed, specific job description/), true);
    assert.equal(hasChip(searchScore, /Easy Apply/i), false);
    assert.equal(hasChip(searchScore, /Responses managed off LinkedIn/), false);
    assert.equal(hasChip(searchScore, /actively reviewing/i), false);
  } finally {
    search.window.close();
    view.window.close();
  }
});

test('a late About the job section re-scores to the same result as a loaded pane', () => {
  const late = loadLinkedIn(paritySearchHtml({ body: false, similar: false }), LI_SEARCH);
  const ready = loadLinkedIn(parityViewHtml(), LI_VIEW);
  try {
    const lines = captureLogs(late.window);
    const early = late.window.parseLinkedInListing();
    const earlyScore = late.window.scoreLocally(early);
    assert.equal(early.description, null);
    assert.equal(early.fieldSources.description || 'none', 'none');
    assert.ok(early.paneChars < 600, 'header paneChars ' + early.paneChars);
    const ancestors = lines.filter((line) => line.includes('[SkipThisJob] LinkedIn pane ancestor L'));
    assert.ok(ancestors.length >= 1);
    assert.match(ancestors[0], /tag=/);
    assert.match(ancestors[0], /role=/);
    assert.match(ancestors[0], /childCount=/);
    assert.match(ancestors[0], /text=/);
    assert.match(ancestors[0], /listRows=/);
    assert.match(ancestors[0], /viewIds=/);
    assert.match(ancestors[0], /reason=/);
    const summary = lines.find((line) => line.includes('[SkipThisJob] LinkedIn pane diagnostic'));
    assert.match(summary, /description=/);
    assert.match(summary, /descriptionLen=/);
    assert.match(summary, /stop=/);
    late.window.parseLinkedInListing();
    assert.equal(
      lines.filter((line) => line.includes('[SkipThisJob] LinkedIn pane ancestor L')).length,
      ancestors.length
    );

    const readyListing = ready.window.parseLinkedInListing();
    const readyScore = ready.window.scoreLocally(readyListing);
    assert.notEqual(earlyScore.score, readyScore.score);

    late.window.rememberScoredPane(early);
    const uuid = late.window.document.getElementById('uuid');
    uuid.insertAdjacentHTML('beforeend', parityBody());
    const rescored = late.window.rescoreLinkedInIfPaneGrew();
    assert.ok(rescored);
    assert.equal(rescored.score, readyScore.score);
    assert.deepEqual(chipSet(rescored), chipSet(readyScore));
    assert.equal(late.window.document.querySelectorAll('#ghost-detector-overlay').length, 1);
    assert.equal(late.window.rescoreLinkedInIfPaneGrew(), null);
    assert.equal(late.window.document.querySelectorAll('#ghost-detector-overlay').length, 1);
  } finally {
    late.window.close();
    ready.window.close();
  }
});

const CHIP_TITLE = 'Senior Product Marketing Manager - Campaign Management & Outbound';
const CHIP_META = 'United States · Reposted 2 weeks ago · Over 100 people clicked apply';

function chipTitleHtml() {
  return CHIP_TITLE.replace(/&/g, '&amp;');
}

function chipDetail(withTitleAnchor) {
  const titleAnchor = withTitleAnchor
    ? '<p><a href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">' + chipTitleHtml() + '</a></p>'
    : '';
  return '<div id="detail">' +
    '<a href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">Remote</a>' +
    '<a href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">Full-time</a>' +
    '<a href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">Easy Apply</a>' +
    titleAnchor +
    '<a href="https://www.linkedin.com/company/five9/">Five9</a>' +
    '<div id="meta">' +
      '<span>' + chipTitleHtml() + '</span>' +
      '<span>United States</span>' +
      '<span>Reposted 2 weeks ago</span>' +
      '<span>Over 100 people clicked apply</span>' +
      '<span>Promoted by hirer</span>' +
      '<span>Responses managed off LinkedIn</span>' +
    '</div>' +
  '</div>';
}

function chipList() {
  return '<div componentkey="SearchResultsMainContent">' +
    '<div role="button" componentkey="job-card-component-ref-' + LI_JOB + '">' +
      '<p><a href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">Remote</a></p>' +
      '<p><a href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">Easy Apply</a></p>' +
      '<p><a href="https://www.linkedin.com/jobs/view/' + LI_JOB + '/">' + chipTitleHtml() + '</a></p>' +
    '</div>' +
    '<div role="button" componentkey="job-card-component-ref-1111111111">' +
      '<p><a href="https://www.linkedin.com/jobs/view/1111111111/">Remote</a></p>' +
      '<p><a href="https://www.linkedin.com/jobs/view/1111111111/">Easy Apply</a></p>' +
      '<p><a href="https://www.linkedin.com/jobs/view/1111111111/">Other Role</a></p>' +
    '</div>' +
  '</div>';
}

function chipPage(opts) {
  return '<!DOCTYPE html><html><head><title>' + chipTitleHtml() + ' | Five9 | LinkedIn</title></head><body>' +
    (opts.list ? chipList() : '') +
    chipDetail(opts.titleAnchor !== false) +
    '</body></html>';
}

function assertCleanLinkedInTitle(listing, lines, titleSource) {
  assert.equal(listing.title, CHIP_TITLE);
  assert.notEqual(listing.title, 'Remote');
  assert.notEqual(listing.title, 'Easy Apply');
  assert.notEqual(listing.title, 'Full-time');
  assert.equal(listing.companyName, 'Five9');
  assert.equal(listing.location, 'United States');
  assert.equal(listing.daysOpen, 14);
  assert.equal(listing.isRepost, true);
  assert.equal(listing.applicantCount, 100);
  assert.equal(listing.metadataLine, CHIP_META);
  assert.equal(listing.metadataLine.includes(CHIP_TITLE), false);
  assert.equal(/Promoted by hirer|Responses managed off LinkedIn|nior|Linked$/.test(listing.metadataLine), false);
  assert.equal(listing.workArrangement, 'remote');
  assert.equal(listing.employmentType, 'full_time');
  assert.equal(listing.fieldSources.title, titleSource);
  const metaLog = lines.find((line) => line.includes('[SkipThisJob] LinkedIn metadata line:'));
  assert.equal(metaLog, '[SkipThisJob] LinkedIn metadata line: ' + CHIP_META);
  const sourceLine = lines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
  assert.match(sourceLine, new RegExp('title=' + titleSource));
}

test('a Remote chip sharing the job href is not the /jobs/view/ title', () => {
  const dom = loadLinkedIn(chipPage({ titleAnchor: true }), LI_VIEW);
  try {
    const lines = captureLogs(dom.window);
    const listing = dom.window.parseLinkedInListing();
    assertCleanLinkedInTitle(listing, lines, 'href-detail');
    const scored = dom.window.scoreLocally(listing);
    assert.equal(
      Array.from(scored.signals).filter((s) => s === 'Responses managed off LinkedIn — less accountability').length,
      1
    );
  } finally {
    dom.window.close();
  }
});

test('a Remote-only chip falls through to the /jobs/view/ document title', () => {
  const dom = loadLinkedIn(chipPage({ titleAnchor: false }), LI_VIEW);
  try {
    const lines = captureLogs(dom.window);
    const listing = dom.window.parseLinkedInListing();
    assertCleanLinkedInTitle(listing, lines, 'document-title');
  } finally {
    dom.window.close();
  }
});

test('search-results list chips do not replace the open job title', () => {
  const dom = loadLinkedIn(chipPage({ titleAnchor: true, list: true }), LI_SEARCH);
  try {
    const doc = dom.window.document;
    const lines = captureLogs(dom.window);
    const listing = dom.window.parseLinkedInListing();
    assertCleanLinkedInTitle(listing, lines, 'href-detail');
    const openRow = doc.querySelector('[componentkey="job-card-component-ref-' + LI_JOB + '"]');
    const otherRow = doc.querySelector('[componentkey="job-card-component-ref-1111111111"]');
    assert.equal(dom.window.parseLinkedInCard(openRow).title, CHIP_TITLE);
    assert.equal(dom.window.parseLinkedInCard(otherRow).title, 'Other Role');
    const scored = dom.window.scoreLocally(listing);
    assert.equal(
      Array.from(scored.signals).filter((s) => s === 'Responses managed off LinkedIn — less accountability').length,
      1
    );
  } finally {
    dom.window.close();
  }
});

test('list badges start once the cky rows exist', () => {
  const dom = loadLinkedIn('<!DOCTYPE html><html><body><div id="shell"></div></body></html>', LI_SEARCH);
  try {
    const doc = dom.window.document;
    assert.equal(dom.window.findLinkedInJobCards().length, 0);
    assert.equal(dom.window.startLinkedInListBadges({ rescan: true }), false);
    doc.getElementById('shell').innerHTML = ckyRows();
    assert.equal(dom.window.startLinkedInListBadges({ rescan: true }), true);
    assert.equal(doc.querySelectorAll('#cky-list .stj-list-badge').length, 4);
    assert.equal(doc.querySelectorAll('#detail .stj-list-badge').length, 0);
    dom.window.refreshLinkedInListBadges();
    assert.equal(doc.querySelectorAll('.stj-list-badge').length, 4);
  } finally {
    dom.window.close();
  }
});
