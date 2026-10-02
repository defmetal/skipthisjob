/**
 * Fuzzy employer lookup guards.
 *
 * Contains-match (`%ge%`) attributes short queries to unrelated employers.
 * Prefix match is allowed only when the query is at least 4 characters and
 * the matched name is within 1.5× of the query length. The first-word
 * fallback is skipped for short tokens and common English words, and the
 * same length band applies so "Apple Bank" does not resolve to "apple".
 */

const MIN_FUZZY_LENGTH = 4;
const FUZZY_LENGTH_RATIO = 1.5;

const COMMON_FIRST_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'our',
  'inc', 'llc', 'ltd', 'corp', 'company', 'group', 'services', 'service',
  'bank', 'north', 'south', 'east', 'west', 'city', 'new', 'first',
  'national', 'general', 'american', 'united', 'home', 'best', 'plus',
  'team', 'staff', 'office', 'center', 'global', 'international',
]);

/**
 * @param {string} value
 * @returns {string}
 */
function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, (ch) => '\\' + ch);
}

/**
 * @param {string} query
 * @param {string} match
 * @param {number} [ratio]
 * @returns {boolean}
 */
function namesWithinLengthRatio(query, match, ratio = FUZZY_LENGTH_RATIO) {
  if (!query || !match) return false;
  const q = String(query).length;
  const m = String(match).length;
  if (q < MIN_FUZZY_LENGTH || m < 1) return false;
  return m <= q * ratio && q <= m * ratio;
}

/**
 * @param {string} query
 * @param {Array<{ name_normalized?: string | null }> | null | undefined} rows
 * @returns {any}
 */
function pickPrefixMatch(query, rows) {
  if (!query || String(query).length < MIN_FUZZY_LENGTH) return null;
  for (const row of rows || []) {
    const name = row && row.name_normalized;
    if (typeof name !== 'string' || !name.startsWith(query)) continue;
    if (name === query) return row;
    if (namesWithinLengthRatio(query, name)) return row;
  }
  return null;
}

/**
 * First token of a multi-word query, when it is safe to look up on its own.
 * A single-token query is already handled by exact match.
 *
 * @param {string} normalized
 * @returns {string | null}
 */
function firstWordCandidate(normalized) {
  const parts = String(normalized || '').split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0];
  if (first.length < MIN_FUZZY_LENGTH) return null;
  if (COMMON_FIRST_WORDS.has(first)) return null;
  return first;
}

/**
 * @param {string} query
 * @param {string | null | undefined} matchName
 * @returns {boolean}
 */
function acceptFirstWordMatch(query, matchName) {
  const first = firstWordCandidate(query);
  if (!first || matchName !== first) return false;
  return namesWithinLengthRatio(query, matchName);
}

module.exports = {
  MIN_FUZZY_LENGTH,
  FUZZY_LENGTH_RATIO,
  escapeLikePattern,
  namesWithinLengthRatio,
  pickPrefixMatch,
  firstWordCandidate,
  acceptFirstWordMatch,
};
