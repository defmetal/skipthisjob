/**
 * Stored employers.ghost_label bands. Same cut points as the extension
 * overlay and bandNameForScore (35 / 55 / 75):
 *   0–34 low, 35–54 moderate, 55–74 high, 75–100 very_high.
 *
 * @param {unknown} score
 * @returns {'very_high' | 'high' | 'moderate' | 'low'}
 */
function ghostLabelForScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'low';
  if (n >= 75) return 'very_high';
  if (n >= 55) return 'high';
  if (n >= 35) return 'moderate';
  return 'low';
}

module.exports = { ghostLabelForScore };
