/**
 * One company-name normalizer for /api/track, /api/employer/score,
 * /api/report, and the seeding scripts.
 *
 * Lowercase, strip ".com", then peel legal and generic suffixes for up
 * to four passes so "Amazon.com Services LLC" and "Deloitte Consulting LLP"
 * land on the same row the score lookup uses.
 *
 * @param {unknown} name
 * @returns {string}
 */
function normalizeCompanyName(name) {
  if (typeof name !== 'string') return '';
  let normalized = name.toLowerCase().trim().replace(/\.com\b/gi, ' ');
  const suffixes =
    /\s+(north america|corporation|enterprises|technologies|international|consulting|solutions|worldwide|holdings|services|company|group|global|corp\.?|inc\.?|llc\.?|llp\.?|ltd\.?|co\.?|usa|us)$/i;
  for (let i = 0; i < 4; i++) {
    const before = normalized;
    normalized = normalized.replace(suffixes, '').trim();
    if (normalized === before) break;
  }
  return normalized.replace(/\s+/g, ' ').trim();
}

module.exports = { normalizeCompanyName };
