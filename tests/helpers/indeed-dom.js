'use strict';

// Loads extension/content/shared.js + indeed.js into a jsdom window with a
// stubbed chrome API so parseIndeedListing() can be exercised on fixtures.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../../extension/content');
const sharedSrc = fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8');
const indeedSrc = fs.readFileSync(path.join(ROOT, 'indeed.js'), 'utf8');

function mosaicNode(jobs) {
  return '<script id="__stj_mosaic" type="application/json">' +
    JSON.stringify({ jobs: jobs }) + '</script>';
}

function load(html, url) {
  const dom = new JSDOM(html, { url: url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.chrome = {
    runtime: { id: 'test', sendMessage() {}, lastError: null },
    storage: {
      local: { get(k, cb) { cb({}); }, set(o, cb) { if (cb) cb(); } },
    },
  };
  w.eval(sharedSrc);
  w.eval(indeedSrc);
  return dom;
}

module.exports = { load, mosaicNode };
