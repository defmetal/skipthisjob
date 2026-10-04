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
