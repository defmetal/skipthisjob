const test = require('node:test');
const assert = require('node:assert/strict');
const { ghostLabelForScore } = require('../web/lib/ghostLabel');

test('stored ghost labels use the extension 35/55/75 bands', () => {
  assert.equal(ghostLabelForScore(0), 'low');
  assert.equal(ghostLabelForScore(34), 'low');
  assert.equal(ghostLabelForScore(35), 'moderate');
  assert.equal(ghostLabelForScore(50), 'moderate');
  assert.equal(ghostLabelForScore(54), 'moderate');
  assert.equal(ghostLabelForScore(55), 'high');
  assert.equal(ghostLabelForScore(74), 'high');
  assert.equal(ghostLabelForScore(75), 'very_high');
  assert.equal(ghostLabelForScore(100), 'very_high');
  assert.equal(ghostLabelForScore('nope'), 'low');
});
