const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCompanyName } = require('../web/lib/normalizeCompanyName');

test('Amazon.com Services LLC and Deloitte Consulting LLP share the API normalizer', () => {
  assert.equal(normalizeCompanyName('Amazon.com Services LLC'), 'amazon');
  assert.equal(normalizeCompanyName('amazon'), 'amazon');
  assert.equal(normalizeCompanyName('Deloitte Consulting LLP'), 'deloitte');
  assert.equal(normalizeCompanyName('Acme Inc.'), 'acme');
});

test('non-strings and suffix-only names do not throw', () => {
  assert.equal(normalizeCompanyName(123), '');
  assert.equal(normalizeCompanyName(null), '');
  assert.equal(normalizeCompanyName('Inc.'), 'inc.');
  assert.equal(normalizeCompanyName('Services LLC'), 'services');
  assert.equal(normalizeCompanyName('EY'), 'ey');
});

test('track, score, report, and seeding call the shared normalizer', () => {
  const fs = require('fs');
  const files = [
    'web/app/api/track/route.ts',
    'web/app/api/employer/score/route.ts',
    'web/app/api/report/route.ts',
    'seeding/seed-kaggle.js',
    'seeding/seed-glassdoor.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /normalizeCompanyName/, file);
    assert.doesNotMatch(source, /function normalizeCompany\b/, file);
  }
});
