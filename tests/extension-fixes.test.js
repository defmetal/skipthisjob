'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load: loadIndeed } = require('./helpers/indeed-dom.js');
const { load: loadLinkedIn } = require('./helpers/linkedin-dom.js');

const SPECIFIC = [
  'Build React and Node services on AWS. Reports to the engineering manager.',
  'Team of 6. Python and SQL. You will own features end to end and review pull requests',
  'with the Austin office each week. The stack is React, Node, and Postgres.',
].join(' ');

function identicalFacts() {
  return {
    title: 'Software Engineer',
    companyName: 'Acme',
    daysOpen: 30,
    salaryListed: false,
    description: SPECIFIC + ' ' + 'x'.repeat(600),
    employerResponsive: null,
    engagementParsed: false,
    activelyReviewing: false,
    engagementSignals: [],
    hiringContactVisible: null,
    noResponseData: false,
  };
}

test('30-day Indeed listing with no engagement data stays below 75 and near LinkedIn', () => {
  const indeed = loadIndeed('<html><body></body></html>', 'https://www.indeed.com/jobs?q=x');
  const linkedin = loadLinkedIn('<html><body></body></html>', 'https://www.linkedin.com/feed/');
  try {
    const facts = identicalFacts();
    const indeedScore = indeed.window.scoreLocally(facts);
    const linkedinScore = linkedin.window.scoreLocally(facts);
    assert.ok(indeedScore.score < 75, 'Indeed unparsed engagement scored ' + indeedScore.score);
    assert.ok(
      Math.abs(indeedScore.score - linkedinScore.score) <= 15,
      'Indeed ' + indeedScore.score + ' vs LinkedIn ' + linkedinScore.score
    );
    assert.ok(!indeedScore.signals.some(s => /30\+ days old with no active review|classic dead end/i.test(s)));
    assert.ok(indeedScore.signals.some(s => /engagement unknown/i.test(s)));

    const parsed = indeed.window.scoreLocally({
      ...facts,
      engagementParsed: true,
      employerResponsive: false,
    });
    assert.ok(parsed.score > indeedScore.score, 'a read insights block with no review should still cost more');
    assert.ok(parsed.score < 75, 'one missing-basics combo must stay under Skip This Job, got ' + parsed.score);
    assert.ok(parsed.signals.some(s => /no active review/i.test(s)));
    assert.ok(parsed.signals.some(s => /no employer response/i.test(s)));
    assert.ok(parsed.signals.some(s => /missing basics/i.test(s)));
    assert.ok(!parsed.signals.some(s => /classic dead end|30\+ days old with no active review/i.test(s)));
  } finally {
    indeed.window.close();
    linkedin.window.close();
  }
});

test('Indeed date selector with no date does not block Posted N days ago in the pane', async () => {
  const html = '<html><body><div id="jobsearch-ViewjobPaneWrapper">' +
    '<h2 data-testid="jobsearch-JobInfoHeader-title"><span>Network Admin</span></h2>' +
    '<div data-testid="inlineHeader-companyName"><a>Globex</a></div>' +
    '<div class="jobsearch-JobInfoHeader-subtitle">Austin, TX</div>' +
    '<div id="jobDescriptionText">Posted 30+ days ago. Support the office network with Python and Linux. Reports to the director. Team of 4.</div>' +
    '</div></body></html>';
  const dom = loadIndeed(html, 'https://www.indeed.com/viewjob?jk=abc123def4567890');
  try {
    const listing = await dom.window.parseIndeedListing();
    assert.equal(listing.daysOpen, 30);
  } finally {
    dom.window.close();
  }
});

test('Indeed salary snippet on a sibling card does not set the viewed job salary', async () => {
  const html = '<html><body>' +
    '<div class="job_seen_beacon" data-jk="aaaaaaaaaaaaaaaa">' +
    '<span data-testid="attribute_snippet_testid">$80,000 per year</span>' +
    '</div>' +
    '<div id="jobsearch-ViewjobPaneWrapper">' +
    '<h2 data-testid="jobsearch-JobInfoHeader-title"><span>Analyst</span></h2>' +
    '<div data-testid="inlineHeader-companyName"><a>Initech</a></div>' +
    '<div id="jobDescriptionText">A long enough description about SQL reports to the manager and a team of 5 in Austin. Remote work is not available. We do not accept staffing agency submissions. Contract through 2027.</div>' +
    '</div></body></html>';
  const dom = loadIndeed(html, 'https://www.indeed.com/jobs?q=analyst&vjk=bbbbbbbbbbbbbbbb');
  try {
    const listing = await dom.window.parseIndeedListing();
    assert.equal(listing.salaryListed, null);
    assert.equal(listing.workArrangement, null);
    assert.notEqual(listing.isThirdParty, true);
  } finally {
    dom.window.close();
  }
});

test('Indeed home page does not keep retrying a parse', async () => {
  const notes = [];
  const dom = loadIndeed('<html><body><h1>Indeed</h1></body></html>', 'https://www.indeed.com/');
  dom.window.console.warn = (...args) => { notes.push(args.join(' ')); };
  dom.window.console.log = () => {};
  try {
    await new Promise((resolve) => setTimeout(resolve, 3200));
    assert.equal(notes.filter(n => /unparsed indeed/i.test(n)).length, 0);
  } finally {
    dom.window.close();
  }
});

test('llms.txt check count matches the signals catalog', () => {
  const signals = fs.readFileSync(path.join(__dirname, '../web/lib/signals.ts'), 'utf8');
  const llms = fs.readFileSync(path.join(__dirname, '../web/public/llms.txt'), 'utf8');
  const phrases = signals.match(/^\s+phrase: '/gm) || [];
  const stated = llms.match(/(\d+) distinct checks/);
  assert.ok(stated, 'llms.txt should state the check count');
  assert.equal(Number(stated[1]), phrases.length);
  assert.equal(phrases.length, 25);
  assert.doesNotMatch(signals, /id: 'indeed-baseline'/);
  assert.doesNotMatch(signals, /date missing', effect: '\+15'/);
});

test('overlay escapes backend signal text', () => {
  const shared = require('../extension/content/shared.js');
  const html = shared.overlaySignalsHtml(['<img src=x onerror=alert(1)>']);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.equal(shared.safeGlassdoorUrl('javascript:alert(1)'), '');
  assert.equal(
    shared.safeGlassdoorUrl('https://www.glassdoor.com/Overview/Working-at-Acme.htm'),
    'https://www.glassdoor.com/Overview/Working-at-Acme.htm'
  );
});

test('service worker no longer fetches Indeed search HTML', () => {
  const src = fs.readFileSync(path.join(__dirname, '../extension/background/service-worker.js'), 'utf8');
  assert.doesNotMatch(src, /SCAN_EMPLOYER_LISTINGS/);
  assert.doesNotMatch(src, /UPDATE_BADGE/);
  assert.match(src, /AbortSignal\.timeout/);
});
