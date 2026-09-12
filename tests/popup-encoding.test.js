'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popupHtmlPath = path.join(__dirname, '../extension/popup/popup.html');
const popupJsPath = path.join(__dirname, '../extension/popup/popup.js');

test('popup.html declares UTF-8 and does not embed a raw bullet in CSS', () => {
  const html = fs.readFileSync(popupHtmlPath, 'utf8');
  assert.match(html, /<meta\s+charset=["']UTF-8["']/i);
  assert.doesNotMatch(
    html,
    /content:\s*"•/,
    'raw U+2022 in the HTML file is what Chrome mis-decodes as â€¢ without charset'
  );
  assert.match(
    html,
    /content:\s*"\\2022/,
    'CSS unicode escape stays a bullet regardless of HTML decoding'
  );
});

test('popup.js renders signals as list items without injecting bullet code points', () => {
  const js = fs.readFileSync(popupJsPath, 'utf8');
  assert.match(js, /<li>/);
  assert.doesNotMatch(js, /\\u2022|•|&bull;/);
});
