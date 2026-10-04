'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('../extension/content/shared.js');
const { load } = require('./helpers/linkedin-dom.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const SEARCH_URL = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4423270116&origin=PREFERENCES_LANDING';

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function captureLogs(win) {
  const lines = [];
  win.console.log = (...args) => {
    lines.push(args.map((part) => (typeof part === 'string' ? part : String(part))).join(' '));
  };
  return lines;
}

function assertOneEach(signals) {
  const counts = {};
  for (const signal of Array.from(signals)) {
    const key = String(signal);
    counts[key] = (counts[key] || 0) + 1;
  }
  for (const [signal, count] of Object.entries(counts)) {
    assert.equal(count, 1, 'duplicate chip: ' + signal);
  }
}

function descriptionVerdicts(signals) {
  return Array.from(signals).filter((s) => (
    s === 'Very short job description' ||
    s === 'Short or limited job description' ||
    s === 'Detailed, specific job description' ||
    s === 'Job description unknown'
  )).map((s) => String(s));
}

function overlays(doc) {
  return doc.querySelectorAll('#ghost-detector-overlay, [data-stj-overlay="1"]');
}

function waitFor(fn, ms) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      let value;
      try { value = fn(); } catch (e) { value = null; }
      if (value) { resolve(value); return; }
      if (Date.now() - start > ms) { resolve(value); return; }
      setTimeout(tick, 20);
    };
    tick();
  });
}

test('old /jobs/view top card keeps legacy selectors as the only source', () => {
  const dom = load(readFixture('linkedin-job.html'), 'https://www.linkedin.com/jobs/view/4242424242');
  try {
    const lines = captureLogs(dom.window);
    const listing = dom.window.parseLinkedInListing();
    assert.equal(listing.title, 'Software Engineer');
    assert.equal(listing.companyName, 'Acme');
    assert.equal(listing.location, 'Austin, TX');
    assert.equal(listing.daysOpen, 3);
    assert.equal(listing.isRepost, false);
    assert.equal(listing.applicantCount, 25);
    assert.equal(listing.platformJobId, '4242424242');
    for (const field of ['title', 'companyName', 'location', 'daysOpen', 'isRepost', 'applicantCount', 'description']) {
      assert.equal(listing.fieldSources[field], 'legacy-selectors', field);
    }
    const sourceLine = lines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
    assert.ok(sourceLine, 'missing field-source log');
    assert.match(sourceLine, /title=legacy-selectors/);
    assert.match(sourceLine, /companyName=legacy-selectors/);
    assert.match(sourceLine, /daysOpen=legacy-selectors/);
  } finally {
    dom.window.close();
  }
});

test('search sidebar still scores the viewed legacy pane once', () => {
  const dom = load(
    readFixture('linkedin-search-sidebar.html'),
    'https://www.linkedin.com/jobs/search/?currentJobId=2222222222'
  );
  try {
    const listing = dom.window.parseLinkedInListing();
    assert.equal(listing.title, 'Viewed Analyst');
    assert.equal(listing.companyName, 'Viewed Co');
    assert.equal(listing.isRepost, false);
    assert.equal(listing.daysOpen, 3);
    assert.equal(listing.fieldSources.title, 'legacy-selectors');
    assert.equal(listing.fieldSources.isRepost, 'legacy-selectors');
    assert.equal(listing.fieldSources.daysOpen, 'legacy-selectors');
  } finally {
    dom.window.close();
  }
});

test('new search-results layout reads the detail pane from the job link', async () => {
  const dom = load(readFixture('linkedin-search-results.html'), SEARCH_URL);
  const doc = dom.window.document;
  try {
    const lines = captureLogs(dom.window);
    const listing = dom.window.parseLinkedInListing();
    const again = dom.window.parseLinkedInListing();
    assert.equal(listing.title, 'Senior Product Marketing Manager - Campaign Management & Outbound');
    assert.equal(listing.companyName, 'Five9');
    assert.equal(listing.location, 'United States');
    assert.equal(listing.daysOpen, 14);
    assert.equal(listing.isRepost, true);
    assert.equal(listing.applicantCount, 100);
    assert.equal(listing.platformJobId, '4423270116');
    assert.equal(listing.descriptionParsed, false);
    assert.equal(again.title, listing.title);
    assert.equal(again.companyName, listing.companyName);
    assert.equal(again.daysOpen, listing.daysOpen);
    assert.equal(again.applicantCount, listing.applicantCount);
    assert.equal(again.isRepost, listing.isRepost);
    for (const field of ['title', 'companyName', 'location', 'daysOpen', 'isRepost', 'applicantCount']) {
      assert.equal(listing.fieldSources[field], 'href-detail', field);
    }
    const sourceLine = lines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
    assert.ok(sourceLine);
    assert.match(sourceLine, /title=href-detail/);
    assert.match(sourceLine, /companyName=href-detail/);
    assert.match(sourceLine, /location=href-detail/);
    assert.match(sourceLine, /daysOpen=href-detail/);
    assert.match(sourceLine, /isRepost=href-detail/);
    assert.match(sourceLine, /applicantCount=href-detail/);

    const scored = dom.window.scoreLocally(listing);
    assert.deepEqual(descriptionVerdicts(scored.signals), ['Job description unknown']);
    assert.equal(scored.signals.filter((s) => /recycled listing/i.test(s)).length, 1);
    assert.equal(scored.signals.filter((s) => s === 'Open 14 days').length, 1);
    assert.equal(scored.signals.filter((s) => /100\+ applicants/i.test(s)).length, 1);
    assertOneEach(scored.signals);

    const cards = dom.window.findLinkedInJobCards();
    assert.equal(cards.length, 2);
    for (const card of cards) {
      assert.equal(card.closest('#detail-a'), null);
      assert.equal(card.closest('#detail-b'), null);
      assert.ok(!/Five9|Other Co/.test(card.textContent));
    }

    dom.window.refreshLinkedInListBadges();
    dom.window.refreshLinkedInListBadges();
    assert.equal(doc.querySelectorAll('.stj-list-badge').length, 2);
    for (const card of dom.window.findLinkedInJobCards()) {
      assert.equal(card.querySelectorAll('.stj-list-badge').length, 1);
    }
    assert.equal(doc.querySelector('#detail-a').querySelectorAll('.stj-list-badge').length, 0);
    assert.equal(doc.querySelector('#detail-b').querySelectorAll('.stj-list-badge').length, 0);

    const overlay = await waitFor(() => doc.getElementById('ghost-detector-overlay'), 2000);
    assert.ok(overlay);
    assert.equal(overlays(doc).length, 1);
    assert.equal(overlay.getAttribute('data-stj-job-id'), '4423270116');
    await new Promise((resolve) => setTimeout(resolve, 40));

    dom.window.injectOverlay(scored, null, listing);
    dom.window.injectOverlay(scored, null, listing);
    assert.equal(overlays(doc).length, 1);
    assert.equal(doc.getElementById('ghost-detector-overlay').getAttribute('data-stj-job-id'), '4423270116');

    doc.getElementById('ghost-detector-overlay').remove();
    dom.window.refreshLinkedInAfterMutation();
    assert.equal(overlays(doc).length, 1);
    assert.equal(doc.getElementById('ghost-detector-overlay').getAttribute('data-stj-job-id'), '4423270116');

    doc.getElementById('ghost-detector-overlay').remove();
    doc.body.appendChild(doc.createElement('span'));
    const reinjected = await waitFor(() => doc.getElementById('ghost-detector-overlay'), 500);
    assert.ok(reinjected, 'a mutation must put the card back');
    assert.equal(overlays(doc).length, 1);

    let peak = overlays(doc).length;
    const observer = new dom.window.MutationObserver(() => {
      peak = Math.max(peak, overlays(doc).length);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    dom.window.history.pushState({}, '', 'https://www.linkedin.com/jobs/search-results/?currentJobId=1111111111&origin=PREFERENCES_LANDING');
    await dom.window.processCurrentListing();
    const replaced = await waitFor(() => {
      const el = doc.getElementById('ghost-detector-overlay');
      return el && el.getAttribute('data-stj-job-id') === '1111111111' ? el : null;
    }, 2000);
    assert.ok(replaced, 'navigating must replace the card');
    assert.equal(overlays(doc).length, 1);
    assert.ok(peak <= 1, 'overlay count peaked at ' + peak);
    const next = dom.window.parseLinkedInListing();
    assert.equal(next.title, 'Other Role');
    assert.equal(next.companyName, 'Other Co');
    assert.equal(next.location, 'Canada');
    assert.equal(next.daysOpen, 1);
    assert.equal(next.isRepost, null);
    assert.equal(next.applicantCount, 5);
    assert.equal(next.platformJobId, '1111111111');
    assert.equal(next.fieldSources.title, 'href-detail');
    observer.disconnect();
  } finally {
    dom.window.close();
  }
});

test('a list-only job does not inherit the open detail pane', () => {
  const html = `<!DOCTYPE html><html><head><title>Jobs | LinkedIn</title></head><body>
    <div id="row-b"><p><a href="https://www.linkedin.com/jobs/view/1111111111/">List Only Role</a></p></div>
    <div id="detail-a">
      <p><a href="https://www.linkedin.com/jobs/view/4423270116/">Senior Product Marketing Manager</a></p>
      <p><a href="https://www.linkedin.com/company/five9/">Five9</a></p>
      <p>United States · Reposted 2 weeks ago · Over 100 people clicked apply</p>
    </div>
  </body></html>`;
  const dom = load(html, 'https://www.linkedin.com/jobs/search-results/?currentJobId=1111111111');
  try {
    const listing = dom.window.parseLinkedInListing();
    assert.equal(listing.title, 'List Only Role');
    assert.equal(listing.companyName, null);
    assert.equal(listing.location, null);
    assert.equal(listing.isRepost, null);
    assert.equal(listing.daysOpen, null);
    assert.equal(listing.salaryListed, null);
    assert.equal(listing.hiringContactVisible, null);
    assert.equal(listing.engagementParsed, false);
  } finally {
    dom.window.close();
  }
});

test('componentkey detail is used only when earlier approaches miss', () => {
  const dom = load(
    readFixture('linkedin-componentkey.html'),
    'https://www.linkedin.com/jobs/search-results/?currentJobId=4423270116'
  );
  try {
    const lines = captureLogs(dom.window);
    const listing = dom.window.parseLinkedInListing();
    assert.equal(listing.title, 'Component Key Title');
    assert.equal(listing.companyName, 'Component Co');
    assert.equal(listing.location, 'Austin, TX');
    assert.equal(listing.daysOpen, 4);
    assert.equal(listing.applicantCount, 12);
    assert.equal(listing.isRepost, null);
    for (const field of ['title', 'companyName', 'location', 'daysOpen', 'applicantCount']) {
      assert.equal(listing.fieldSources[field], 'componentkey', field);
    }
    const sourceLine = lines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
    assert.match(sourceLine, /title=componentkey/);
  } finally {
    dom.window.close();
  }
});

test('ghostjob top card is used only when earlier approaches miss', () => {
  const dom = load(
    readFixture('linkedin-ghostjob-topcard.html'),
    'https://www.linkedin.com/jobs/view/4423270116'
  );
  try {
    const lines = captureLogs(dom.window);
    const listing = dom.window.parseLinkedInListing();
    assert.equal(listing.title, 'Ghostjob Title');
    assert.equal(listing.companyName, 'Ghost Co');
    assert.equal(listing.location, 'Remote US');
    assert.equal(listing.daysOpen, 7);
    assert.equal(listing.applicantCount, 8);
    for (const field of ['title', 'companyName', 'location', 'daysOpen', 'applicantCount']) {
      assert.equal(listing.fieldSources[field], 'ghostjob-top-card', field);
    }
    const sourceLine = lines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
    assert.match(sourceLine, /title=ghostjob-top-card/);
  } finally {
    dom.window.close();
  }
});

test('JSON-LD JobPosting is used only when earlier approaches miss', () => {
  const dom = load(
    readFixture('linkedin-jsonld.html'),
    'https://www.linkedin.com/jobs/view/4423270116'
  );
  try {
    const lines = captureLogs(dom.window);
    const listing = dom.window.parseLinkedInListing();
    assert.equal(listing.title, 'JSON Title');
    assert.equal(listing.companyName, 'JSON Co');
    assert.equal(listing.location, 'Dallas, TX');
    assert.equal(listing.daysOpen, shared.daysOpenFromIso('2026-09-20'));
    assert.ok(listing.description.includes('JSONLD_ONLY_DESCRIPTION'));
    assert.equal(listing.descriptionParsed, true);
    for (const field of ['title', 'companyName', 'location', 'daysOpen', 'description']) {
      assert.equal(listing.fieldSources[field], 'json-ld', field);
    }
    const sourceLine = lines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
    assert.match(sourceLine, /title=json-ld/);
    assert.match(sourceLine, /description=json-ld/);
  } finally {
    dom.window.close();
  }
});

test('og:title fills identity and does not fall through to document.title', () => {
  const dom = load(
    readFixture('linkedin-og-meta.html'),
    'https://www.linkedin.com/jobs/view/4423270116'
  );
  try {
    const lines = captureLogs(dom.window);
    const listing = dom.window.parseLinkedInListing();
    assert.equal(listing.title, 'OG Title');
    assert.equal(listing.companyName, 'OG Company');
    assert.equal(listing.fieldSources.title, 'og-meta');
    assert.equal(listing.fieldSources.companyName, 'og-meta');
    assert.equal(listing.daysOpen, null);
    const sourceLine = lines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
    assert.match(sourceLine, /title=og-meta/);
    assert.doesNotMatch(sourceLine, /document-title/);
  } finally {
    dom.window.close();
  }
});

test('document.title fills identity when nothing earlier matched', () => {
  const dom = load(
    readFixture('linkedin-document-title.html'),
    'https://www.linkedin.com/jobs/view/4423270116'
  );
  try {
    const lines = captureLogs(dom.window);
    const listing = dom.window.parseLinkedInListing();
    assert.equal(listing.title, 'Doc Title');
    assert.equal(listing.companyName, 'Doc Company');
    assert.equal(listing.fieldSources.title, 'document-title');
    assert.equal(listing.fieldSources.companyName, 'document-title');
    const sourceLine = lines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
    assert.match(sourceLine, /title=document-title/);
    assert.match(sourceLine, /companyName=document-title/);
  } finally {
    dom.window.close();
  }
});

test('every approach succeeding at once keeps the first value, one card, and one chip', async () => {
  const dom = load(
    readFixture('linkedin-all-approaches.html'),
    'https://www.linkedin.com/jobs/view/4242424242'
  );
  const doc = dom.window.document;
  try {
    const lines = captureLogs(dom.window);
    const listing = dom.window.parseLinkedInListing();
    assert.equal(listing.title, 'Legacy Title');
    assert.equal(listing.companyName, 'Legacy Co');
    assert.equal(listing.location, 'Legacy City');
    assert.equal(listing.daysOpen, 3);
    assert.equal(listing.isRepost, false);
    assert.equal(listing.applicantCount, 10);
    assert.ok(listing.description.includes('LEGACY_ONLY_DESCRIPTION'));
    assert.ok(!listing.description.includes('JSONLD_ONLY_DESCRIPTION'));
    assert.ok(!/Href Title|Ghost Title|JSON Title|OG Title|Doc Title/.test(listing.title));
    assert.ok(!/Href Co|Ghost Co|JSON Co|OG Company|Doc Company/.test(listing.companyName));
    for (const field of ['title', 'companyName', 'location', 'daysOpen', 'isRepost', 'applicantCount', 'description']) {
      assert.equal(listing.fieldSources[field], 'legacy-selectors', field);
    }
    const sourceLine = lines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
    assert.ok(sourceLine);
    assert.match(sourceLine, /title=legacy-selectors/);
    assert.match(sourceLine, /isRepost=legacy-selectors/);
    assert.match(sourceLine, /daysOpen=legacy-selectors/);
    assert.match(sourceLine, /applicantCount=legacy-selectors/);
    assert.doesNotMatch(sourceLine, /href-detail|componentkey|ghostjob-top-card|json-ld|og-meta|document-title/);

    const scored = dom.window.scoreLocally(listing);
    assert.deepEqual(descriptionVerdicts(scored.signals), ['Detailed, specific job description']);
    assert.ok(!scored.signals.some((s) => /recycled listing|crowded listing|Open 14 days|Open 9 days/i.test(s)));
    assert.equal(scored.signals.filter((s) => s === 'Open 3 days').length, 1);
    assertOneEach(scored.signals);

    const overlay = await waitFor(() => doc.getElementById('ghost-detector-overlay'), 2000);
    assert.ok(overlay);
    await new Promise((resolve) => setTimeout(resolve, 40));
    dom.window.injectOverlay(scored, null, listing);
    dom.window.injectOverlay(scored, null, listing);
    assert.equal(overlays(doc).length, 1);
    assert.equal(doc.getElementById('ghost-detector-overlay').getAttribute('data-stj-job-id'), '4242424242');

    dom.window.beginLinkedInJob('7777777777');
    const replacement = Object.assign({}, listing, { platformJobId: '7777777777', title: 'Next Title' });
    dom.window.history.pushState({}, '', 'https://www.linkedin.com/jobs/view/7777777777');
    dom.window.injectOverlay(scored, null, replacement);
    assert.equal(overlays(doc).length, 1);
    assert.equal(doc.getElementById('ghost-detector-overlay').getAttribute('data-stj-job-id'), '7777777777');
  } finally {
    dom.window.close();
  }
});
