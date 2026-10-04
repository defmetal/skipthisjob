'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../extension/content/shared.js');
const { load } = require('./helpers/linkedin-dom.js');

const JOB = '4423270116';
const URL = 'https://www.linkedin.com/jobs/search-results/?currentJobId=' + JOB;

function page(metaHtml, nest) {
  const titleBlock = nest || (
    '<div id="tight">' +
      '<a href="https://www.linkedin.com/jobs/view/' + JOB + '/">Senior Product Marketing Manager</a>' +
      '<a href="https://www.linkedin.com/company/five9/">Five9</a>' +
      '<p>United States · On-site</p>' +
    '</div>'
  );
  return '<!DOCTYPE html><html><head><title>Jobs | LinkedIn</title></head><body>' +
    '<div id="list">' +
      '<div><a href="https://www.linkedin.com/jobs/view/' + JOB + '/">Senior Product Marketing Manager</a></div>' +
      '<div><a href="https://www.linkedin.com/jobs/view/1111111111/"></a></div>' +
    '</div>' +
    '<div id="detail">' + titleBlock + metaHtml + '</div>' +
    '<div componentkey="widget-123456789">not a job card</div>' +
    '</body></html>';
}

function assertMeta(listing, expected) {
  assert.equal(listing.companyName, 'Five9');
  assert.equal(listing.location, expected.location);
  assert.equal(listing.daysOpen, expected.daysOpen);
  assert.equal(listing.isRepost, expected.isRepost);
  assert.equal(listing.applicantCount, expected.applicantCount);
  assert.equal(listing.fieldSources.daysOpen, 'href-detail');
  assert.equal(listing.fieldSources.applicantCount, 'href-detail');
  if (expected.isRepost) assert.equal(listing.fieldSources.isRepost, 'href-detail');
  const signals = listing._signals || [];
  assert.equal(signals.filter((s) => s === 'Posting age unknown').length, 0);
}

function parseWithLogs(html) {
  const lines = [];
  const warns = [];
  const dom = load(html, URL, {
    beforeScripts(win) {
      win.console.log = (...args) => {
        lines.push(args.map((part) => (typeof part === 'string' ? part : String(part))).join(' '));
      };
      win.console.warn = (...args) => {
        warns.push(args.map((part) => String(part)).join(' '));
      };
    },
  });
  const listing = dom.window.parseLinkedInListing();
  const scored = dom.window.scoreLocally(listing);
  listing._signals = Array.from(scored.signals).map((s) => String(s));
  return { dom, listing, lines, warns, scored };
}

test('metadata phrases each produce one age, repost, and applicant value', () => {
  const line = shared.parseLinkedInMetadataLine('United States · Reposted 2 weeks ago · Over 100 people clicked apply');
  assert.equal(line.location, 'United States');
  assert.equal(line.daysOpen, 14);
  assert.equal(line.isRepost, true);
  assert.equal(line.applicantCount, 100);

  assert.equal(shared.parseLinkedInMetadataLine('Austin, TX · Posted 4 days ago · 12 applicants').daysOpen, 4);
  assert.equal(shared.parseLinkedInMetadataLine('Austin, TX · Posted 4 days ago · 12 applicants').isRepost, null);
  assert.equal(shared.parseLinkedInMetadataLine('Austin, TX · Posted 4 days ago · 12 applicants').applicantCount, 12);

  const hours = shared.parseLinkedInMetadataLine('Remote · Reposted 5 hours ago · 3 applicants');
  assert.equal(hours.daysOpen, 0);
  assert.equal(hours.isRepost, true);
  assert.equal(hours.applicantCount, 3);

  const mins = shared.parseLinkedInMetadataLine('Remote · Reposted 8 minutes ago · 3 people clicked apply');
  assert.equal(mins.daysOpen, 0);
  assert.equal(mins.isRepost, true);
  assert.equal(mins.applicantCount, 3);

  const months = shared.parseLinkedInMetadataLine('Remote · Reposted 2 months ago · Over 100 applicants');
  assert.equal(months.daysOpen, 60);
  assert.equal(months.applicantCount, 100);

  const first = shared.parseLinkedInMetadataLine('Remote · Posted 1 day ago · Be among the first 25 applicants');
  assert.equal(first.daysOpen, 1);
  assert.equal(first.isRepost, null);
  assert.equal(first.applicantCount, 25);

  const glued = shared.parseLinkedInMetadataLine('United StatesReposted 2 weeks agoOver 100 people clicked apply');
  assert.equal(glued.daysOpen, 14);
  assert.equal(glued.isRepost, true);
  assert.equal(glued.applicantCount, 100);
  assert.equal(glued.location, 'United States');

  const withCompany = shared.parseLinkedInMetadataLine('Five9 · United States · Reposted 2 weeks ago · Over 100 people clicked apply');
  assert.equal(withCompany.location, 'United States');
  assert.equal(withCompany.daysOpen, 14);
  assert.equal(withCompany.applicantCount, 100);

  const workplace = shared.parseLinkedInMetadataLine('United States · On-site · Reposted 2 weeks ago · Over 100 applicants');
  assert.equal(workplace.location, 'United States');
  assert.equal(workplace.daysOpen, 14);
  assert.equal(workplace.isRepost, true);
});

test('metadata DOM variants all read age, repost, and applicants once', () => {
  const variants = [
    {
      name: 'spans with separators',
      html: '<p><span>United States</span> · <span>Reposted 2 weeks ago</span> · <span>Over 100 people clicked apply</span></p>',
    },
    {
      name: 'single text node',
      html: '<p>United States · Reposted 2 weeks ago · Over 100 people clicked apply</p>',
    },
    {
      name: 'separator text nodes',
      html: '<p><span>United States</span> · <span>Reposted 2 weeks ago</span> · <span>Over 100 applicants</span></p>',
    },
    {
      name: 'separator elements',
      html: '<div><span>United States</span><span> · </span><span>Reposted 2 weeks ago</span><span> · </span><span>Over 100 people clicked apply</span></div>',
    },
    {
      name: 'nested wrappers',
      html: '<div><div><div><span>United States</span> · <span>Reposted 2 weeks ago</span> · <span>Over 100 people clicked apply</span></div></div></div>',
    },
    {
      name: 'nbsp separators',
      html: '<p>United States\u00a0·\u00a0Reposted 2 weeks ago\u00a0·\u00a0Over 100 applicants</p>',
    },
    {
      name: 'newlines instead of dots',
      html: '<p><span>United States</span><br><span>Reposted 2 weeks ago</span><br><span>Over 100 people clicked apply</span></p>',
    },
    {
      name: 'concatenated spans',
      html: '<p><span>United States</span><span>Reposted 2 weeks ago</span><span>Over 100 people clicked apply</span></p>',
    },
    {
      name: 'sibling spans beside the title',
      html: '<span>United States</span><span> · </span><span>Reposted 2 weeks ago</span><span> · </span><span>Over 100 people clicked apply</span>',
    },
  ];
  for (const variant of variants) {
    const { dom, listing, lines, warns } = parseWithLogs(page(variant.html));
    try {
      assert.equal(listing.daysOpen, 14, variant.name);
      assert.equal(listing.isRepost, true, variant.name);
      assert.equal(listing.applicantCount, 100, variant.name);
      assert.equal(listing.location, 'United States', variant.name);
      assert.equal(listing.fieldSources.daysOpen, 'href-detail', variant.name);
      assert.equal(listing.fieldSources.isRepost, 'href-detail', variant.name);
      assert.equal(listing.fieldSources.applicantCount, 'href-detail', variant.name);
      assert.ok(!listing._signals.includes('Posting age unknown'), variant.name);
      assert.equal(listing._signals.filter((s) => /recycled listing/i.test(s)).length, 1, variant.name);
      const dayLines = lines.filter((line) => line.includes('[SkipThisJob] Days open:'));
      assert.equal(dayLines.length, 1, variant.name);
      assert.match(dayLines[0], /14 from: href-detail/);
      assert.ok(!dayLines[0].includes('top card'), variant.name);
      const metaLine = lines.find((line) => line.includes('[SkipThisJob] LinkedIn metadata line:'));
      assert.ok(metaLine && /Reposted 2 weeks ago/.test(metaLine), variant.name);
      const sourceLine = lines.find((line) => line.includes('[SkipThisJob] LinkedIn field sources:'));
      assert.match(sourceLine, /daysOpen=href-detail/);
      assert.match(sourceLine, /isRepost=href-detail/);
      assert.match(sourceLine, /applicantCount=href-detail/);
      assert.ok(!warns.some((line) => /unparsed linkedin list card/i.test(line)), variant.name);
    } finally {
      dom.window.close();
    }
  }
});

test('age outside the company wrapper is read from a larger ancestor', () => {
  const html = page(
    '<div><span>United States</span><span>Reposted 2 weeks ago</span><span>Over 100 people clicked apply</span></div>'
  );
  const { dom, listing, lines } = parseWithLogs(html);
  try {
    assert.equal(listing.daysOpen, 14);
    assert.equal(listing.isRepost, true);
    assert.equal(listing.applicantCount, 100);
    assert.equal(listing.location, 'United States');
    assert.ok(!lines.some((line) => /no months\/weeks\/days-ago in top card/.test(line)));
    const scoredSignals = listing._signals;
    assert.equal(scoredSignals.filter((s) => s === 'Open 14 days').length, 1);
    assert.equal(scoredSignals.filter((s) => /100\+ applicants/.test(s)).length, 1);
  } finally {
    dom.window.close();
  }
});

test('detail pane scan finds the metadata line when it is outside the title nest', () => {
  let nest = '<a href="https://www.linkedin.com/jobs/view/' + JOB + '/">Senior Product Marketing Manager</a>' +
    '<a href="https://www.linkedin.com/company/five9/">Five9</a>';
  for (let i = 0; i < 12; i++) nest = '<div>' + nest + '</div>';
  const html = '<!DOCTYPE html><html><head><title>Jobs | LinkedIn</title></head><body><main>' +
    '<div id="list"><div><a href="https://www.linkedin.com/jobs/view/' + JOB + '/">Senior Product Marketing Manager</a></div>' +
    '<div><a href="https://www.linkedin.com/jobs/view/1111111111/">Other Role</a></div></div>' +
    nest +
    '<p>United States · Reposted 2 weeks ago · Over 100 applicants</p>' +
    '</main></body></html>';
  const { dom, listing } = parseWithLogs(html);
  try {
    assert.equal(listing.title, 'Senior Product Marketing Manager');
    assert.equal(listing.companyName, 'Five9');
    assert.equal(listing.daysOpen, 14);
    assert.equal(listing.isRepost, true);
    assert.equal(listing.applicantCount, 100);
    assert.equal(listing.location, 'United States');
    assert.equal(listing.fieldSources.daysOpen, 'href-detail');
  } finally {
    dom.window.close();
  }
});

test('new-layout rows that cannot be read do not warn', () => {
  const { dom, warns } = parseWithLogs(page('<p>United States · Posted 4 days ago · 12 applicants</p>'));
  try {
    const empty = dom.window.document.querySelector('#list div:last-child');
    assert.equal(dom.window.parseLinkedInCard(empty), null);
    const cards = dom.window.findLinkedInJobCards();
    assert.ok(cards.length >= 1);
    assert.ok(!cards.some((card) => card.getAttribute && card.getAttribute('componentkey') === 'widget-123456789'));
    assert.ok(!warns.some((line) => /unparsed linkedin list card/i.test(line)));
  } finally {
    dom.window.close();
  }
});
