/**
 * Public leaderboard eligibility, display-score cap, and name screen.
 *
 * The stored employers.ghost_score is unchanged. This module only decides
 * who appears on the website leaderboard and what score is shown there.
 *
 * Evidence minimum (an employer must meet either bar):
 * - MIN_LISTINGS_FOR_LEADERBOARD tracked listings (default 5), or
 * - MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD community reports (default 3).
 * Reports are employers.total_reports: ghost flags and outcome reports.
 * The leaderboard "Reports" column is the same number.
 *
 * Thin-evidence display cap:
 * With fewer than MIN_LISTINGS_FOR_LEADERBOARD listings, the shown score
 * cannot exceed THIN_EVIDENCE_SCORE_CEILING (94). A single listing and no
 * reports cannot exceed SINGLE_LISTING_SCORE_CAP (59), so one posting
 * cannot display as 100. At or above the listing minimum the raw score
 * is shown (still clamped to 0–100).
 *
 *   cap = min(
 *     THIN_EVIDENCE_SCORE_CEILING,
 *     SINGLE_LISTING_SCORE_CAP
 *       + (listings - 1) * LISTING_CAP_STEP
 *       + reports * REPORT_CAP_STEP
 *   )
 *
 * Non-company name screen (conservative — when unsure, keep the row):
 * 1. Empty, very short, or numeric names are always omitted.
 *    Very short means fewer than 2 characters after trim, so "EY", "HP",
 *    and "3M" stay. Numeric means the trimmed name contains no letters
 *    ("12345", "---", "#1").
 * 2. Personal-name shape is omitted only when listing evidence is still
 *    few (below the listing minimum): exactly two short capitalized
 *    tokens, and neither token is a company suffix or company descriptor.
 *    Courtesy titles (Dr, Mr, Mrs, Ms, Prof) and single-letter initials
 *    ("Dean A. Davidson", "Dr Dean Davidson") are dropped before that
 *    count, so a middle initial does not hide a two-word name. Short
 *    means 2–12 letters. A token matches Title Case ("Dean") or ALL CAPS
 *    ("DEAN"). Hyphens, apostrophes, accents, a trailing generation
 *    suffix ("Dean Davidson Jr", "II"), or a lowercase name do not match,
 *    and the row is kept. Five or more listings also keep the row.
 *    Known miss: a two-word brand with no suffix and few listings
 *    ("Dollar Tree", "Blue Skies") can be screened out until it has
 *    enough tracked listings or a company token in the name.
 *
 * Evidence age: when the leaderboard route supplies created_at, a
 * listing-qualified employer must be at least MIN_EVIDENCE_AGE_MS old.
 * When it supplies qualifying_distinct_reporters, report-only eligibility
 * uses that distinct count (reports tied to a listing) and requires the
 * oldest such report to be at least MIN_EVIDENCE_AGE_MS old. Callers that
 * omit those fields keep the count-only check so existing rows still
 * resolve.
 */

export const MIN_LISTINGS_FOR_LEADERBOARD = 5;
export const MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD = 3;

/** New employers and new report-only evidence wait this long before listing. */
export const MIN_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

export { ghostLabelForScore } from './ghostLabel.js';

/** One listing and zero reports cannot display above this. */
export const SINGLE_LISTING_SCORE_CAP = 59;
/** Extra cap room for each listing after the first, while still thin. */
export const LISTING_CAP_STEP = 8;
/** Extra cap room per community report, while listing evidence is thin. */
export const REPORT_CAP_STEP = 5;
/**
 * Fewer than MIN_LISTINGS_FOR_LEADERBOARD listings never display 95–100,
 * no matter how many reports are on file.
 */
export const THIN_EVIDENCE_SCORE_CEILING = 94;

const SHORT_NAME_TOKEN_MIN = 2;
const SHORT_NAME_TOKEN_MAX = 12;

const NAME_TITLES = new Set([
  'dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'professor', 'sir',
]);

/**
 * Legal suffixes and words that mark a company rather than a person.
 * If either of the two tokens normalizes to one of these, the personal-name
 * rule does not apply.
 */
const COMPANY_TOKENS = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'companies', 'plc', 'pllc', 'pc', 'lp', 'gmbh', 'ag', 'sa',
  'nv', 'bv', 'sarl', 'pty',
  'group', 'holdings', 'holding', 'services', 'service', 'consulting',
  'solutions', 'solution', 'enterprises', 'enterprise', 'technologies',
  'technology', 'tech', 'systems', 'system', 'labs', 'lab', 'studio', 'studios',
  'agency', 'partners', 'partner', 'associates', 'associate', 'industries',
  'industry', 'health', 'healthcare', 'hospital', 'medical', 'clinic', 'dental',
  'university', 'college', 'school', 'institute', 'foundation', 'bank',
  'capital', 'financial', 'finance', 'insurance', 'realty', 'properties',
  'property', 'construction', 'engineering', 'electric', 'electronics',
  'energy', 'power', 'motors', 'automotive', 'auto', 'foods', 'food',
  'restaurant', 'cafe', 'hotel', 'logistics', 'software', 'network', 'networks',
  'communications', 'manufacturing', 'laboratories', 'laboratory', 'robotics',
  'international', 'national', 'global', 'worldwide', 'management',
  'department', 'center', 'centers', 'entertainment', 'aerospace', 'sales',
  'brothers', 'sons', 'pharma', 'pharmaceutical', 'staffing', 'recruiting',
]);

export type LeaderboardSortColumn =
  | 'ghost_score'
  | 'name_raw'
  | 'total_listings_tracked'
  | 'total_reports'
  | 'glassdoor_rating'
  | 'industry';

export interface LeaderboardSourceEmployer {
  name_raw: string | null;
  industry?: string | null;
  company_size?: string | null;
  ghost_score?: number | string | null;
  ghost_label?: string | null;
  total_reports?: number | string | null;
  total_listings_tracked?: number | string | null;
  glassdoor_rating?: number | string | null;
  glassdoor_url?: string | null;
  id?: string;
  created_at?: string | null;
  /**
   * When set (including null), listing eligibility uses this timestamp
   * instead of created_at. Null means the listing age could not be proven.
   */
  oldest_listing_at?: string | null;
  /** Distinct anonymous users whose report is tied to a listing. */
  qualifying_distinct_reporters?: number;
  oldest_qualifying_report_at?: string | null;
}

export interface LeaderboardEmployer {
  name_raw: string;
  industry: string | null;
  company_size: string | null;
  /** Score shown on the leaderboard, after the thin-evidence cap. */
  ghost_score: number;
  ghost_label: string | null;
  total_reports: number;
  total_listings_tracked: number;
  glassdoor_rating: number | string | null;
  glassdoor_url: string | null;
  confidence: string;
}

/** Same display names as web/lib/signals.ts SCORE_BANDS and the extension overlay. */
export function bandNameForScore(score: number): string {
  if (score >= 75) return 'Skip This Job';
  if (score >= 55) return 'Likely a Waste of Time';
  if (score >= 35) return 'Proceed with Caution';
  return 'Worth Applying';
}

export function leaderboardMinimumNote(): string {
  // One string literal on purpose. Next's production server compiler
  // constant-folds multi-argument String#concat and drops every argument
  // after the first, which deleted the words around these numbers when the
  // sentence was built from concatenated templates.
  return 'Only employers with at least 5 tracked listings or 3 community reports from different people are listed. A report counts only when it is tied to a specific listing, and new evidence waits 24 hours before an employer can appear. Scores from fewer than 5 listings are capped, so a single posting cannot show as 100. Personal names with only a few listings, and empty, very short, or numeric names, are left off.';
}

export function confidenceLabel(listings: number, reports: number): string {
  const listingWord = listings === 1 ? 'listing' : 'listings';
  const reportWord = reports === 1 ? 'report' : 'reports';
  return `Based on ${listings} ${listingWord}, ${reports} ${reportWord}`;
}

function asCount(value: number | string | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function meetsEvidenceMinimum(listings: number, reports: number): boolean {
  return (
    listings >= MIN_LISTINGS_FOR_LEADERBOARD ||
    reports >= MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD
  );
}

export function evidenceAgeMet(iso: string | null | undefined, now = Date.now()): boolean {
  if (!iso) return false;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return false;
  return now - then >= MIN_EVIDENCE_AGE_MS;
}

export function distinctListingReporters(
  reports: Array<{
    anonymous_user_hash?: string | null;
    listing_id?: string | null;
    created_at?: string | null;
  }>
): { count: number; oldestAt: string | null } {
  let oldest: number | null = null;
  const hashes = new Set<string>();
  for (const report of reports) {
    if (!report.listing_id || !report.anonymous_user_hash) continue;
    hashes.add(report.anonymous_user_hash);
    if (!report.created_at) continue;
    const then = Date.parse(report.created_at);
    if (!Number.isFinite(then)) continue;
    if (oldest == null || then < oldest) oldest = then;
  }
  return {
    count: hashes.size,
    oldestAt: oldest == null ? null : new Date(oldest).toISOString(),
  };
}

function listingEvidenceMature(employer: LeaderboardSourceEmployer, now: number): boolean {
  const listings = asCount(employer.total_listings_tracked);
  if (listings < MIN_LISTINGS_FOR_LEADERBOARD) return false;
  if (employer.oldest_listing_at !== undefined) {
    return evidenceAgeMet(employer.oldest_listing_at, now);
  }
  if (employer.created_at !== undefined) {
    return evidenceAgeMet(employer.created_at, now);
  }
  return true;
}

function reportEvidenceMature(employer: LeaderboardSourceEmployer, now: number): boolean {
  if (
    employer.qualifying_distinct_reporters !== undefined ||
    employer.oldest_qualifying_report_at !== undefined
  ) {
    const distinct = asCount(employer.qualifying_distinct_reporters);
    if (distinct < MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD) return false;
    return evidenceAgeMet(employer.oldest_qualifying_report_at, now);
  }
  return asCount(employer.total_reports) >= MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD;
}

/**
 * Highest score we will display for this much evidence.
 * Returns 100 once listing volume meets the leaderboard minimum.
 */
export function evidenceScoreCap(listings: number, reports: number): number {
  const tracked = asCount(listings);
  const reported = asCount(reports);
  if (tracked >= MIN_LISTINGS_FOR_LEADERBOARD) return 100;
  const cap =
    SINGLE_LISTING_SCORE_CAP +
    (tracked - 1) * LISTING_CAP_STEP +
    reported * REPORT_CAP_STEP;
  return Math.max(0, Math.min(THIN_EVIDENCE_SCORE_CEILING, cap));
}

/** Display score. Never raises the stored score, and never leaves 0–100. */
export function displayedGhostScore(
  raw: number | string | null | undefined,
  listings: number,
  reports: number
): number {
  const score = Number(raw);
  const safe = Number.isFinite(score) ? score : 0;
  const capped = Math.min(safe, evidenceScoreCap(listings, reports));
  const rounded = Math.round(capped * 10) / 10;
  return Math.max(0, Math.min(100, rounded));
}

/** Empty, a single character, or no letters at all (digits and punctuation). */
export function isUnusableEmployerName(name: string | null | undefined): boolean {
  if (name == null) return true;
  const trimmed = String(name).trim();
  if (trimmed.length < SHORT_NAME_TOKEN_MIN) return true;
  if (!/[A-Za-z]/.test(trimmed)) return true;
  return false;
}

function companyTokenKey(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isMiddleInitial(token: string): boolean {
  return /^[A-Za-z]\.?$/.test(token);
}

function isShortCapitalizedToken(token: string): boolean {
  if (/^[A-Z][a-z]+$/.test(token)) {
    return token.length >= SHORT_NAME_TOKEN_MIN && token.length <= SHORT_NAME_TOKEN_MAX;
  }
  if (/^[A-Z]+$/.test(token)) {
    return token.length >= SHORT_NAME_TOKEN_MIN && token.length <= SHORT_NAME_TOKEN_MAX;
  }
  return false;
}

/**
 * True when the name looks like a person and listing volume is still few.
 * See the file header for what "conservative" keeps.
 */
export function looksLikePersonalName(
  name: string | null | undefined,
  listings: number
): boolean {
  if (asCount(listings) >= MIN_LISTINGS_FOR_LEADERBOARD) return false;
  if (name == null) return false;
  const tokens = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !NAME_TITLES.has(companyTokenKey(token)))
    .filter((token) => !isMiddleInitial(token));
  if (tokens.length !== 2) return false;
  if (tokens.some((token) => COMPANY_TOKENS.has(companyTokenKey(token)))) return false;
  return tokens.every(isShortCapitalizedToken);
}

export function isEligibleEmployer(
  employer: LeaderboardSourceEmployer,
  now = Date.now()
): boolean {
  const listings = asCount(employer.total_listings_tracked);
  if (!listingEvidenceMature(employer, now) && !reportEvidenceMature(employer, now)) return false;
  if (isUnusableEmployerName(employer.name_raw)) return false;
  if (looksLikePersonalName(employer.name_raw, listings)) return false;
  return true;
}

export function toLeaderboardEmployer(employer: LeaderboardSourceEmployer): LeaderboardEmployer {
  const listings = asCount(employer.total_listings_tracked);
  const reports = asCount(employer.total_reports);
  const name = employer.name_raw == null ? '' : String(employer.name_raw).trim();
  return {
    name_raw: name,
    industry: employer.industry ?? null,
    company_size: employer.company_size ?? null,
    ghost_score: displayedGhostScore(employer.ghost_score, listings, reports),
    ghost_label: employer.ghost_label ?? null,
    total_reports: reports,
    total_listings_tracked: listings,
    glassdoor_rating: employer.glassdoor_rating ?? null,
    glassdoor_url: employer.glassdoor_url ?? null,
    confidence: confidenceLabel(listings, reports),
  };
}

function numericOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function compareValues(
  a: number | string | null,
  b: number | string | null,
  ascending: boolean
): number {
  const aMissing = a == null || a === '';
  const bMissing = b == null || b === '';
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  let cmp = 0;
  if (typeof a === 'number' && typeof b === 'number') cmp = a - b;
  else cmp = String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
  return ascending ? cmp : -cmp;
}

function sortValue(row: LeaderboardEmployer, sortBy: LeaderboardSortColumn): number | string | null {
  if (sortBy === 'ghost_score') return row.ghost_score;
  if (sortBy === 'total_listings_tracked') return row.total_listings_tracked;
  if (sortBy === 'total_reports') return row.total_reports;
  if (sortBy === 'glassdoor_rating') return numericOrNull(row.glassdoor_rating);
  if (sortBy === 'industry') return row.industry;
  return row.name_raw;
}

/** Qualifying rows only, ordered by the displayed score when sorting on score. */
export function prepareLeaderboard(
  employers: LeaderboardSourceEmployer[],
  sortBy: LeaderboardSortColumn,
  ascending: boolean
): LeaderboardEmployer[] {
  const rows = employers.filter(isEligibleEmployer).map(toLeaderboardEmployer);
  rows.sort((a, b) => {
    const primary = compareValues(sortValue(a, sortBy), sortValue(b, sortBy), ascending);
    if (primary !== 0) return primary;
    return a.name_raw.localeCompare(b.name_raw, undefined, { sensitivity: 'base' });
  });
  return rows;
}
