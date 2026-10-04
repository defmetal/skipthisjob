'use strict';

// Loads extension/content/shared.js + linkedin.js into a jsdom window with a
// stubbed chrome API so parseLinkedInListing() / parseLinkedInCard() can run.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../../extension/content');
const sharedSrc = fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8');
const linkedinSrc = fs.readFileSync(path.join(ROOT, 'linkedin.js'), 'utf8');

function load(html, url, hooks) {
  const dom = new JSDOM(html, { url: url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  if (hooks && typeof hooks.beforeScripts === 'function') hooks.beforeScripts(w);
  w.chrome = {
    runtime: {
      id: 'test',
      sendMessage(_msg, cb) { if (cb) cb(null); },
      lastError: null,
      onMessage: { addListener() {} },
    },
    storage: {
      local: { get(k, cb) { if (cb) cb({}); }, set(o, cb) { if (cb) cb(); } },
      onChanged: { addListener() {} },
    },
  };
  w.eval(sharedSrc);
  w.eval(linkedinSrc);
  return dom;
}

module.exports = { load };
