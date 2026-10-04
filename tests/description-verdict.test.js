'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('../extension/content/shared.js');
const { load: loadIndeed } = require('./helpers/indeed-dom.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const SNIPPET = '$230,000 - $250,000 a year. Reports to the CMO. 8+ years of marketing.';

function descriptionVerdicts(signals) {
  return Array.from(signals).filter((s) => (
    s === 'Very short job description' ||
    s === 'Short or limited job description' ||
    s === 'Detailed, specific job description'
  )).map((s) => String(s));
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

test('a short specific description emits one length chip, not both verdicts', () => {
  // This string is what the /?vjk= feed card exposed as the description.
  // Before the fix it was both "Very short" (+5) and "Detailed, specific" (−1).
  const scored = shared.scoreListingSignals({
    title: 'Head of Marketing',
    companyName: 'Inato',
    daysOpen: 45,
    salaryListed: true,
    description: SNIPPET,
    descriptionParsed: true,
  }, { platform: 'indeed', vagueness: 0 });
  assert.deepEqual(descriptionVerdicts(scored.signals), ['Very short job description']);
  assert.ok(!scored.signals.includes('Detailed, specific job description'));
  assertOneEach(scored.signals);
});

test('an unparsed description adds 0 and shows no length chip', () => {
  const base = {
    title: 'Head of Marketing',
    companyName: 'Inato',
    daysOpen: 45,
    salaryListed: true,
  };
  const missing = shared.scoreListingSignals({ ...base, description: null }, {
    platform: 'indeed',
    vagueness: 0,
  });
  const unparsed = shared.scoreListingSignals({
    ...base,
    description: SNIPPET,
    descriptionParsed: false,
  }, { platform: 'indeed', vagueness: 0 });
  assert.equal(unparsed.score, missing.score);
  assert.ok(unparsed.signals.includes('Job description unknown'));
  assert.deepEqual(descriptionVerdicts(unparsed.signals), []);
  assert.ok(!unparsed.signals.some((s) => /very short|short or limited|detailed, specific/i.test(s)));
  assertOneEach(unparsed.signals);
});

test('a loaded long specific description emits only the detailed chip', () => {
  const long = [
    'Own campaign strategy and report to the CMO. Team of 8.',
    'The stack includes HubSpot and Salesforce.',
    'Compensation is $230,000 a year. 8+ years of B2B marketing.',
    'A'.repeat(420),
  ].join(' ');
  assert.ok(long.length > 280);
  const scored = shared.scoreListingSignals({
    title: 'Head of Marketing',
    daysOpen: 45,
    salaryListed: true,
    description: long,
    descriptionParsed: true,
  }, { platform: 'indeed', vagueness: 0 });
  assert.deepEqual(descriptionVerdicts(scored.signals), ['Detailed, specific job description']);
  assertOneEach(scored.signals);
});

test('Indeed /?vjk= homepage uses the full JD and one description chip', async () => {
  const html = fs.readFileSync(path.join(FIXTURES, 'indeed-vjk-home.html'), 'utf8');
  const dom = loadIndeed(html, 'https://www.indeed.com/?vjk=bdcf974325e2454e');
  try {
    const snippetNode = dom.window.document.querySelector('.jobsearch-JobComponent-description');
    assert.ok(snippetNode, 'fixture must still contain the short card snippet');
    assert.equal(snippetNode.textContent.trim(), SNIPPET);
    assert.equal(dom.window.document.querySelector('#jobDescriptionText'), null);
    assert.equal(dom.window.document.querySelector('#jobsearch-ViewjobPaneWrapper'), null);

    const listing = await dom.window.parseIndeedListing();
    assert.equal(listing.title, 'Head of Marketing');
    assert.equal(listing.companyName, 'Inato');
    assert.equal(listing.daysOpen, 45);
    assert.equal(listing.platformJobId, 'bdcf974325e2454e');
    assert.equal(listing.salaryListed, true);
    assert.equal(listing.appliesOffsite, true);
    assert.equal(listing.descriptionParsed, true);
    assert.equal(listing.descriptionSource, 'mosaic-bridge');
    assert.ok(listing.description.length > 280);
    assert.notEqual(listing.description.trim(), SNIPPET);

    const scored = dom.window.scoreLocally(listing);
    assert.deepEqual(descriptionVerdicts(scored.signals), ['Detailed, specific job description']);
    assert.ok(!scored.signals.includes('Very short job description'));
    assert.ok(!scored.signals.includes('Job description unknown'));
    assertOneEach(scored.signals);
  } finally {
    dom.window.close();
  }
});
