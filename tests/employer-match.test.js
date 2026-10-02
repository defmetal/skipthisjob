const test = require('node:test');
const assert = require('node:assert/strict');
const {
  acceptFirstWordMatch,
  escapeLikePattern,
  pickPrefixMatch,
  firstWordCandidate,
} = require('../web/lib/employerMatch');

test('short and wildcard names are not contains-matched onto bigger employers', () => {
  const rows = [
    { name_normalized: 'general electric', total_listings_tracked: 400 },
    { name_normalized: 'geico', total_listings_tracked: 20 },
    { name_normalized: 'meta platforms', total_listings_tracked: 80 },
  ];
  assert.equal(pickPrefixMatch('ge', rows), null);
  assert.equal(pickPrefixMatch('ey', rows), null);
  assert.equal(pickPrefixMatch('meta', rows), null);
  assert.equal(pickPrefixMatch('%', [{ name_normalized: '100% hire' }]), null);
});

test('a close prefix still matches and like wildcards are escaped', () => {
  const match = pickPrefixMatch('blue pearl', [
    { name_normalized: 'blue pearl vet', total_listings_tracked: 3 },
    { name_normalized: 'blue pearl veterinary group international', total_listings_tracked: 9 },
  ]);
  assert.equal(match.name_normalized, 'blue pearl vet');
  assert.equal(escapeLikePattern('100%_hire'), '100\\%\\_hire');
  assert.equal(escapeLikePattern('a\\b'), 'a\\\\b');
});

test('Apple Bank does not fall back to apple', () => {
  assert.equal(firstWordCandidate('apple'), null);
  assert.equal(firstWordCandidate('ge appliances'), null);
  assert.equal(firstWordCandidate('bank of america'), null);
  assert.equal(acceptFirstWordMatch('apple bank', 'apple'), false);
  assert.equal(acceptFirstWordMatch('general electric', 'general'), false);
});
