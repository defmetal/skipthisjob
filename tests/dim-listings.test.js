'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const shared = require('../extension/content/shared.js');

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
