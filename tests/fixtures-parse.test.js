'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('../extension/content/shared.js');
const { load: loadIndeed } = require('./helpers/indeed-dom.js');
const { load: loadLinkedIn } = require('./helpers/linkedin-dom.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const bridgeSrc = fs.readFileSync(path.join(__dirname, '../extension/content/indeed-mosaic-bridge.js'), 'utf8');

function installViewJobBridge(dom) {
  const node = dom.window.document.getElementById('stj-viewjob-rootprops');
  if (node && node.textContent) dom.window._rootProps = JSON.parse(node.textContent);
  dom.window.eval(bridgeSrc);
}

function waitForOverlay(win, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const el = win.document.getElementById('ghost-detector-overlay');
      if (el && /\d+\/100/.test(el.textContent || '')) {
        resolve(el);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(el);
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

test('LinkedIn job fixture parses and scores loaded fields only', () => {
  const dom = loadLinkedIn(
    readFixture('linkedin-job.html'),
    'https://www.linkedin.com/jobs/view/4242424242'
  );
  try {
    const listing = dom.window.parseLinkedInListing();
    assert.equal(listing.title, 'Software Engineer');
    assert.equal(listing.companyName, 'Acme');
    assert.equal(listing.daysOpen, 3);
    assert.equal(listing.platformJobId, '4242424242');
    assert.ok(listing.description && listing.description.length > 80);
    assert.equal(listing.salaryListed, true);

    const health = shared.selectorHealth(listing, { platform: 'linkedin' });
    assert.equal(health.state, 'parsed');

    const scored = dom.window.scoreLocally(listing);
    assert.equal(typeof scored.score, 'number');
    assert.ok(!scored.signals.some(s => /posting age unknown|job description unknown|salary unknown/i.test(s)));

    const card = dom.window.document.querySelector('.jobs-search-results__list-item');
    const parsedCard = dom.window.parseLinkedInCard(card);
    assert.equal(parsedCard.title, 'Software Engineer');
    assert.equal(parsedCard.companyName, 'Acme');
    assert.equal(parsedCard.daysOpen, 3);
    assert.equal(parsedCard.platformJobId, '4242424242');
    const preview = shared.scoreListPreview(parsedCard);
    assert.equal(typeof preview.score, 'number');
    assert.ok(!preview.signals.some(s => /unknown/i.test(s)));
  } finally {
    dom.window.close();
  }
});

test('Indeed /viewjob fixture produces an overlay from the page model', async () => {
  const dom = loadIndeed(
    readFixture('indeed-viewjob.html'),
    'https://www.indeed.com/viewjob?jk=abc123def4567890'
  );
  try {
    assert.equal(dom.window.document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]'), null);
    assert.equal(shared.parseIndeedPageTitle(dom.window.document.title), null);
    assert.equal(dom.window.document.querySelector('[data-testid="inlineHeader-companyName"]'), null);

    installViewJobBridge(dom);
    const snap = JSON.parse(dom.window.document.getElementById('__stj_mosaic').textContent);
    assert.equal(snap.viewJob.title, 'Staff Engineer');
    assert.equal(snap.viewJob.company, 'Acme');

    const listing = await dom.window.parseIndeedListing();
    assert.equal(listing.title, 'Staff Engineer');
    assert.equal(listing.companyName, 'Acme');
    assert.equal(listing.daysOpen, 3);
    assert.equal(listing.platformJobId, 'abc123def4567890');
    assert.equal(listing.salaryListed, true);
    assert.equal(listing.location, 'Austin, TX');
    assert.ok(listing.description && listing.description.length > 280);
    assert.equal(listing.employerResponsive, null);

    const health = shared.selectorHealth(listing, { platform: 'indeed' });
    assert.equal(health.state, 'parsed');
    const scored = dom.window.scoreLocally(listing);
    assert.ok(scored.signals.some(s => /employer response unknown/i.test(s)));
    assert.ok(!scored.signals.some(s => /no employer response data|no salary listed|posting age unknown|job description unknown|salary unknown/i.test(s)));
    assert.equal(typeof scored.score, 'number');

    const overlay = await waitForOverlay(dom.window, 8000);
    assert.ok(overlay, 'standalone /viewjob must inject #ghost-detector-overlay');
    const text = overlay.textContent || '';
    assert.match(text, /Staff Engineer/);
    assert.match(text, /Acme/);
    assert.match(text, new RegExp(scored.score + '/100'));
    assert.match(text, /Employer response unknown/i);
    assert.doesNotMatch(text, /No employer response data/);
  } finally {
    dom.window.close();
  }
});

test('legacy window._initialData viewjob model is mirrored for the overlay path', () => {
  const dom = loadIndeed('<html><head><title>Indeed</title></head><body></body></html>', 'https://www.indeed.com/viewjob?jk=abc123def4567890');
  try {
    dom.window._initialData = {
      jobInfoWrapperModel: {
        jobInfoModel: {
          sanitizedJobDescription: { content: '<p>Legacy description that is long enough to count as loaded copy for the overlay.</p>' },
          jobInfoHeaderModel: {
            jobTitle: 'Legacy Role',
            companyName: 'Legacy Co',
            jobKey: 'abc123def4567890',
          },
        },
      },
    };
    dom.window.eval(bridgeSrc);
    const snap = JSON.parse(dom.window.document.getElementById('__stj_mosaic').textContent);
    assert.equal(snap.viewJob.title, 'Legacy Role');
    assert.equal(snap.viewJob.company, 'Legacy Co');
    assert.match(snap.viewJob.description, /Legacy description/);
    assert.equal(snap.jobs[0].jobkey, 'abc123def4567890');
  } finally {
    dom.window.close();
  }
});

test('Indeed SERP card fixture parses without inventing a description penalty', () => {
  const dom = loadIndeed(
    readFixture('indeed-serp-card.html'),
    'https://www.indeed.com/jobs?q=warehouse&vjk=abc123def4567890'
  );
  try {
    const card = dom.window.document.querySelector('.job_seen_beacon');
    const parsed = dom.window.parseIndeedCard(card);
    assert.equal(parsed.title, 'Warehouse Associate');
    assert.equal(parsed.companyName, 'Northwind');
    assert.equal(parsed.platformJobId, 'abc123def4567890');
    assert.equal(parsed.daysOpen, 45);
    assert.equal(parsed.salaryListed, true);
    const preview = shared.scoreListPreview(parsed);
    assert.ok(preview.score > 0, 'known age on a card should score');
    assert.ok(!preview.signals.some(s => /description|unknown/i.test(s)));
  } finally {
    dom.window.close();
  }
});

test('non-English page with drifted selectors is unparsed and not scored', async () => {
  const html = readFixture('unparsed-fr.html');
  const indeed = loadIndeed(html, 'https://www.indeed.com/viewjob?jk=ff00ff00ff00ff00');
  const linkedin = loadLinkedIn(html, 'https://www.linkedin.com/feed/');
  const notes = [];
  const sink = (...args) => { notes.push(args.join(' ')); };
  indeed.window.console.warn = sink;
  linkedin.window.console.warn = sink;
  try {
    const listing = await indeed.window.parseIndeedListing();
    assert.ok(!listing.companyName);
    const gated = shared.scoreParsedListing(listing, () => {
      throw new Error('unparsed Indeed page must not be scored');
    }, { platform: 'indeed', require: ['title', 'companyName'] });
    assert.equal(gated.state, 'unparsed');
    assert.equal(gated.score, null);

    const indeedCard = indeed.window.document.querySelector('.job_seen_beacon');
    assert.equal(indeed.window.parseIndeedCard(indeedCard), null);

    const liCard = linkedin.window.document.querySelector('[data-occludable-job-id]');
    assert.equal(linkedin.window.parseLinkedInCard(liCard), null);
  } finally {
    indeed.window.close();
    linkedin.window.close();
  }
  assert.ok(notes.some(n => /unparsed indeed list card/i.test(n) && /not scoring/i.test(n)));
  assert.ok(notes.some(n => /unparsed linkedin list card/i.test(n) && /not scoring/i.test(n)));
});

test('Indeed and LinkedIn scoreLocally: loaded short copy costs, a missing description does not', () => {
  const indeed = loadIndeed('<html><body></body></html>', 'https://www.indeed.com/jobs?q=x');
  const linkedin = loadLinkedIn('<html><body></body></html>', 'https://www.linkedin.com/feed/');
  try {
    const base = {
      title: 'Engineer',
      companyName: 'Acme',
      daysOpen: 7,
      salaryListed: true,
      employerResponsive: true,
      hiringContactVisible: true,
      engagementSignals: [],
    };
    const missingI = indeed.window.scoreLocally({ ...base, description: null, descriptionLength: 0 });
    const shortI = indeed.window.scoreLocally({
      ...base,
      description: 'We need a rockstar.',
      descriptionLength: 18,
    });
    assert.ok(missingI.signals.some(s => /job description unknown/i.test(s)));
    assert.ok(!missingI.signals.some(s => /very short|no description available/i.test(s)));
    assert.ok(shortI.signals.some(s => /very short job description/i.test(s)));
    assert.ok(shortI.score > missingI.score);

    const missingL = linkedin.window.scoreLocally({ ...base, description: null });
    const shortL = linkedin.window.scoreLocally({ ...base, description: 'Short listing copy.' });
    assert.ok(missingL.signals.some(s => /job description unknown/i.test(s)));
    assert.ok(!missingL.signals.some(s => /very short|no or very weak/i.test(s)));
    assert.ok(shortL.signals.some(s => /very short job description/i.test(s)));
    assert.ok(shortL.score > missingL.score);
  } finally {
    indeed.window.close();
    linkedin.window.close();
  }
});
