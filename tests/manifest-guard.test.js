'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Published 0.2.2 / 0.2.3 permission set. A diff here fails the build.
// Austin approves host, permission, and match changes separately.
const PUBLISHED = {
  permissions: ['storage', 'activeTab'],
  host_permissions: [
    '*://*.linkedin.com/*',
    '*://*.indeed.com/*',
    'https://skipthisjob.com/*',
  ],
  content_scripts_matches: [
    ['*://*.linkedin.com/jobs/*', '*://*.linkedin.com/feed/*'],
    ['*://*.indeed.com/*'],
    ['*://*.indeed.com/*'],
  ],
};

test('manifest permissions, host_permissions, and content_scripts.matches match 0.2.2/0.2.3', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, PUBLISHED.permissions);
  assert.deepEqual(manifest.host_permissions, PUBLISHED.host_permissions);
  assert.equal(manifest.content_scripts.length, PUBLISHED.content_scripts_matches.length);
  manifest.content_scripts.forEach((script, i) => {
    assert.deepEqual(script.matches, PUBLISHED.content_scripts_matches[i]);
  });
});
