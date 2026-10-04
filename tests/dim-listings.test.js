'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const shared = require('../extension/content/shared.js');
const { load: loadLinkedIn } = require('./helpers/linkedin-dom.js');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('dim thresholds: off, 75+, and 55+ only change opacity class', () => {
  const dom = new JSDOM('<ul><li id="row">Role</li></ul>');
  const row = dom.window.document.getElementById('row');
  const parentCount = () => row.parentElement.children.length;

  shared.applyListDim(row, 80, '75');
  assert.equal(row.classList.contains('stj-dimmed'), true);
  assert.equal(row.getAttribute('data-stj-dim'), '75');

  shared.applyListDim(row, 60, '75');
  assert.equal(row.classList.contains('stj-dimmed'), false);
  assert.equal(row.hasAttribute('data-stj-dim'), false);

  shared.applyListDim(row, 55, 55);
  assert.equal(row.classList.contains('stj-dimmed'), true);
  shared.applyListDim(row, 54, '55');
  assert.equal(row.classList.contains('stj-dimmed'), false);

  shared.applyListDim(row, 99, 'off');
  shared.applyListDim(row, 99, undefined);
  assert.equal(row.classList.contains('stj-dimmed'), false);
  assert.equal(parentCount(), 1);
  assert.equal(row.isConnected, true);
  assert.equal(shared.dimThresholdFromSetting(null), 0);
  assert.equal(shared.dimThresholdFromSetting('75'), 75);
  assert.equal(shared.dimThresholdFromSetting('55'), 55);
});

test('list scan dims from the card score already computed and does not remove nodes', async () => {
  const html = '<ul id="results"><li id="old" data-jk="aaa">Old Role</li><li id="fresh" data-jk="bbb">New Role</li></ul>';
  const dom = new JSDOM(html, { url: 'https://www.indeed.com/jobs?q=engineer', runScripts: 'outside-only' });
  let gets = 0;
  let listener = null;
  dom.window.chrome = {
    runtime: { id: 'test', lastError: null },
    storage: {
      local: {
        get(key, cb) {
          gets += 1;
          cb({ stjDimRisky: '75' });
        },
        set() {},
      },
      onChanged: { addListener(fn) { listener = fn; } },
    },
  };
  const sharedSrc = fs.readFileSync(path.join(__dirname, '../extension/content/shared.js'), 'utf8');
  dom.window.eval(sharedSrc);
  const STJ = dom.window.SkipThisJobShared;
  const list = dom.window.document.getElementById('results');
  STJ.watchListBadges({
    debounceMs: 15,
    listRootSelector: '#results',
    findCards() { return list.querySelectorAll('li'); },
    parseCard(card) {
      if (card.id === 'old') return { title: 'Old Role', daysOpen: 120, platform: 'indeed', platformJobId: 'aaa' };
      return { title: 'New Role', daysOpen: 1, salaryListed: true, platform: 'indeed', platformJobId: 'bbb' };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const oldCard = dom.window.document.getElementById('old');
  const freshCard = dom.window.document.getElementById('fresh');
  assert.equal(gets, 1, 'storage is read once per scan setup, not per card');
  assert.equal(oldCard.classList.contains('stj-dimmed'), true);
  assert.equal(freshCard.classList.contains('stj-dimmed'), false);
  assert.equal(list.children.length, 2);
  assert.equal(oldCard.isConnected, true);
  assert.ok(oldCard.querySelector('.stj-list-badge'));

  listener({ stjDimRisky: { newValue: 'off' } }, 'local');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(oldCard.classList.contains('stj-dimmed'), false);
  assert.equal(list.children.length, 2);
  dom.window.close();
});

test('list badge scans settle after one mutation', async () => {
  const html = '<ul id="results"><li id="a">Role A</li><li id="b">Role B</li></ul>';
  const dom = new JSDOM(html, { url: 'https://www.indeed.com/jobs?q=engineer', runScripts: 'outside-only' });
  dom.window.chrome = {
    runtime: { id: 'test', lastError: null },
    storage: {
      local: { get(_key, cb) { cb({ stjDimRisky: 'off' }); }, set() {} },
      onChanged: { addListener() {} },
    },
  };
  const sharedSrc = fs.readFileSync(path.join(__dirname, '../extension/content/shared.js'), 'utf8');
  dom.window.eval(sharedSrc);
  const STJ = dom.window.SkipThisJobShared;
  const list = dom.window.document.getElementById('results');
  let scans = 0;
  STJ.watchListBadges({
    debounceMs: 20,
    listRootSelector: '#results',
    onScan() { scans += 1; },
    findCards() { return list.querySelectorAll('li'); },
    parseCard() {
      return { title: 'Role', daysOpen: 10, salaryListed: true, platform: 'indeed', platformJobId: 'abc' };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const afterInit = scans;
  assert.ok(afterInit >= 1, 'initial scan should run');
  const extra = dom.window.document.createElement('li');
  extra.id = 'c';
  extra.textContent = 'Role C';
  list.appendChild(extra);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const afterMutation = scans - afterInit;
  assert.ok(afterMutation >= 1 && afterMutation <= 2, 'one mutation should settle within 2 scans, got ' + afterMutation);
  const settled = scans;
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(scans, settled, 'scans must stop while the list is idle');
  dom.window.close();
});

test('popup stores the dim setting and offers off, 75+, and 55+', () => {
  const html = fs.readFileSync(path.join(__dirname, '../extension/popup/popup.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../extension/popup/popup.js'), 'utf8');
  assert.match(html, /id="stj-dim"/);
  assert.match(html, /value="off"/);
  assert.match(html, /Dim Skip This Job \(75\+\)/);
  assert.match(html, /value="55"/);
  assert.match(js, /stjDimRisky/);
  assert.match(js, /chrome\.storage\.local\.set\(\{\s*stjDimRisky/);
  const popup = new JSDOM(html);
  assert.equal(popup.window.document.querySelector('#stj-help #stj-dim'), null);
  assert.ok(popup.window.document.getElementById('stj-dim'));
  popup.window.close();
  const css = fs.readFileSync(path.join(__dirname, '../extension/content/overlay.css'), 'utf8');
  assert.match(css, /\.stj-dimmed/);
  assert.match(css, /opacity:\s*0\.38/);
  assert.doesNotMatch(css, /\.stj-dimmed[^}]*display\s*:\s*none/);
});

const NEW_LAYOUT_LIST = '<div id="list">' +
  '<div id="row-risky">' +
    '<div><div><div>' +
      '<a href="https://www.linkedin.com/jobs/view/4423270116/">Head of Marketing</a>' +
    '</div></div></div>' +
    '<a href="https://www.linkedin.com/company/five9/">Five9</a>' +
    '<span>United States · Reposted 2 weeks ago · Over 100 people clicked apply</span>' +
  '</div>' +
  '<div id="row-unknown">' +
    '<div><a href="https://www.linkedin.com/jobs/view/1111111111/">Quiet Role</a></div>' +
    '<a href="https://www.linkedin.com/company/other/">Other Co</a>' +
    '<span>Canada</span>' +
  '</div>' +
  '<div id="row-empty">' +
    '<a href="https://www.linkedin.com/jobs/view/9999999999/"></a>' +
  '</div>' +
  '</div>';

test('new LinkedIn rows dim from a remembered score and follow the popup setting', async () => {
  let listener = null;
  const warns = [];
  const dom = loadLinkedIn(NEW_LAYOUT_LIST, 'https://www.linkedin.com/jobs/search-results/', {
    beforeScripts(win) {
      win.console.warn = (...args) => warns.push(args.map((part) => String(part)).join(' '));
    },
    decorateChrome(chrome) {
      chrome.storage.local.get = function (_key, cb) { cb({ stjDimRisky: '75' }); };
      chrome.storage.onChanged.addListener = function (fn) { listener = fn; };
    },
  });
  try {
    const doc = dom.window.document;
    const risky = doc.getElementById('row-risky');
    const unknown = doc.getElementById('row-unknown');
    const empty = doc.getElementById('row-empty');
    const parsed = dom.window.parseLinkedInCard(risky);
    assert.equal(parsed.companyName, 'Five9');
    assert.equal(parsed.location, 'United States');
    assert.equal(parsed.daysOpen, 14);
    assert.equal(parsed.isRepost, true);
    assert.equal(parsed.applicantCount, 100);
    const preview = dom.window.SkipThisJobShared.scoreListPreview(parsed);
    assert.ok(preview.score < 75, 'row text alone stays under 75, got ' + preview.score);

    await wait(800);
    assert.equal(risky.classList.contains('stj-dimmed'), false);
    assert.equal(unknown.classList.contains('stj-dimmed'), false);
    assert.equal(empty.classList.contains('stj-dimmed'), false);
    assert.equal(empty.querySelector('.stj-list-badge'), null);
    assert.ok(!warns.some((line) => /unparsed linkedin list card/i.test(line)));

    dom.window.SkipThisJobShared.rememberListBadgeScore(
      '4423270116',
      { score: 88, label: 'very_high', signals: [] },
      { source: 'detail', daysOpen: 14 }
    );
    dom.window.refreshLinkedInListBadges();

    assert.equal(risky.classList.contains('stj-dimmed'), true);
    assert.equal(risky.getAttribute('data-stj-dim'), '75');
    assert.equal(risky.querySelectorAll('.stj-list-badge').length, 1);
    assert.equal(risky.querySelector('.stj-list-badge').getAttribute('data-stj-score'), '88');
    assert.equal(unknown.classList.contains('stj-dimmed'), false);
    const unknownScore = Number(unknown.querySelector('.stj-list-badge').getAttribute('data-stj-score'));
    assert.ok(unknownScore < 55, 'unknown row score ' + unknownScore);
    assert.equal(empty.querySelector('.stj-list-badge'), null);
    assert.equal(doc.getElementById('list').children.length, 3);

    listener({ stjDimRisky: { newValue: 'off' } }, 'local');
    await wait(700);
    assert.equal(risky.classList.contains('stj-dimmed'), false);
    assert.equal(unknown.classList.contains('stj-dimmed'), false);
    assert.equal(risky.hasAttribute('data-stj-dim'), false);

    listener({ stjDimRisky: { newValue: '55' } }, 'local');
    await wait(700);
    assert.equal(risky.classList.contains('stj-dimmed'), true);
    assert.equal(risky.getAttribute('data-stj-dim'), '55');
    assert.equal(unknown.classList.contains('stj-dimmed'), false);

    dom.window.refreshLinkedInListBadges();
    dom.window.refreshLinkedInListBadges();
    assert.equal(risky.querySelectorAll('.stj-list-badge').length, 1);
    assert.equal(unknown.querySelectorAll('.stj-list-badge').length, 1);
    assert.equal(empty.querySelectorAll('.stj-list-badge').length, 0);
    assert.equal(risky.querySelector('.stj-list-badge').getAttribute('data-stj-score'), '88');
    assert.equal(doc.getElementById('list').children.length, 3);
    assert.equal(risky.isConnected, true);
  } finally {
    dom.window.close();
  }
});

test('legacy LinkedIn list rows still dim from a remembered detail score', async () => {
  const html = '<ul class="jobs-search-results-list" id="results">' +
    '<li class="jobs-search-results__list-item" id="old-row" data-occludable-job-id="4242424242">' +
      '<a class="job-card-list__title" href="/jobs/view/4242424242">Software Engineer</a>' +
      '<div class="job-card-container__primary-description">Acme</div>' +
      '<time>1 day ago</time>' +
    '</li>' +
    '<li class="jobs-search-results__list-item" id="fresh-row" data-occludable-job-id="5252525252">' +
      '<a class="job-card-list__title" href="/jobs/view/5252525252">Analyst</a>' +
      '<div class="job-card-container__primary-description">Other</div>' +
      '<span>Posted today</span>' +
    '</li>' +
    '</ul>';
  const dom = loadLinkedIn(html, 'https://www.linkedin.com/jobs/search/', {
    decorateChrome(chrome) {
      chrome.storage.local.get = function (_key, cb) { cb({ stjDimRisky: '75' }); };
    },
  });
  try {
    await wait(800);
    const row = dom.window.document.getElementById('old-row');
    const fresh = dom.window.document.getElementById('fresh-row');
    assert.equal(row.classList.contains('stj-dimmed'), false);
    dom.window.SkipThisJobShared.rememberListBadgeScore(
      '4242424242',
      { score: 90, label: 'very_high', signals: [] },
      { source: 'detail', daysOpen: 1 }
    );
    dom.window.refreshLinkedInListBadges();
    dom.window.refreshLinkedInListBadges();
    assert.equal(row.classList.contains('stj-dimmed'), true);
    assert.equal(row.getAttribute('data-stj-dim'), '75');
    assert.equal(row.querySelectorAll('.stj-list-badge').length, 1);
    assert.equal(row.querySelector('.stj-list-badge').getAttribute('data-stj-score'), '90');
    assert.equal(fresh.classList.contains('stj-dimmed'), false);
    assert.equal(dom.window.document.getElementById('results').children.length, 2);
  } finally {
    dom.window.close();
  }
});

test('dim stays off until the popup setting is on, so a remembered score does not dim', async () => {
  const html = '<div id="list">' +
    '<div id="row-a"><a href="https://www.linkedin.com/jobs/view/4423270116/">Head of Marketing</a>' +
      '<span>United States · Reposted 2 weeks ago</span></div>' +
    '<div id="row-b"><a href="https://www.linkedin.com/jobs/view/1111111111/">Other Role</a></div>' +
    '</div>';
  const dom = loadLinkedIn(html, 'https://www.linkedin.com/jobs/search-results/', {
    decorateChrome(chrome) {
      chrome.storage.local.get = function (_key, cb) { cb({}); };
    },
  });
  try {
    dom.window.SkipThisJobShared.rememberListBadgeScore(
      '4423270116',
      { score: 90, label: 'very_high', signals: [] },
      { source: 'detail', daysOpen: 14 }
    );
    dom.window.refreshLinkedInListBadges();
    await wait(800);
    const row = dom.window.document.getElementById('row-a');
    assert.equal(row.classList.contains('stj-dimmed'), false);
    assert.equal(row.hasAttribute('data-stj-dim'), false);
    assert.equal(row.querySelectorAll('.stj-list-badge').length, 1);
    assert.equal(row.querySelector('.stj-list-badge').getAttribute('data-stj-score'), '90');
  } finally {
    dom.window.close();
  }
});
