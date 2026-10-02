import { NextRequest } from 'next/server';
import { corsResponse, corsOptions } from '@/lib/cors';
import { supabaseAdmin } from '@/lib/supabase';
import {
  MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD,
  MIN_LISTINGS_FOR_LEADERBOARD,
  distinctListingReporters,
  prepareLeaderboard,
  type LeaderboardSortColumn,
  type LeaderboardSourceEmployer,
} from '@/lib/leaderboardEligibility';

const SORTABLE_COLUMNS: readonly LeaderboardSortColumn[] = [
  'ghost_score',
  'name_raw',
  'total_listings_tracked',
  'total_reports',
  'glassdoor_rating',
  'industry',
];

const PAGE_SIZE = 1000;
const CACHE_MS = 60_000;

/**
 * GET /api/leaderboard?limit=20&offset=0&sort_by=ghost_score&sort_dir=desc
 *
 * Qualifying employers only: at least MIN_LISTINGS_FOR_LEADERBOARD tracked
 * listings, or at least MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD distinct
 * reporters tied to a listing. Report-only rows must also be old enough
 * (see MIN_EVIDENCE_AGE_MS). An employer created in the last 24 hours is
 * not listed on listing volume alone. Personal-looking names and
 * empty/short/numeric names are dropped in prepareLeaderboard.
 * ghost_score in the response is the display score (thin listing history
 * is capped). Sort and pagination run after that, so the order matches
 * the numbers on the page.
 */
export async function OPTIONS() {
  return corsOptions();
}

type CandidateRow = LeaderboardSourceEmployer & {
  id: string;
  created_at?: string | null;
};

type CachedCandidates = {
  rows: LeaderboardSourceEmployer[];
  expires: number;
};

const REPORT_ID_CHUNK = 100;

let candidateCache: CachedCandidates | null = null;

async function loadQualifyingReports(ids: string[]) {
  const all: Array<{
    employer_id: string;
    anonymous_user_hash: string | null;
    listing_id: string | null;
    created_at: string | null;
  }> = [];
  for (let i = 0; i < ids.length; i += REPORT_ID_CHUNK) {
    const chunk = ids.slice(i, i + REPORT_ID_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('community_reports')
      .select('employer_id, anonymous_user_hash, listing_id, created_at')
      .in('employer_id', chunk)
      .not('listing_id', 'is', null);
    if (error) throw error;
    for (const row of data || []) all.push(row);
  }
  return all;
}

/**
 * Report-only candidates are rechecked against distinct listing-tied
 * reporters and the age of the oldest one. If that query fails, those
 * rows are dropped rather than shown on the raw total_reports counter.
 * Listing-qualified rows keep created_at so a brand-new employer waits
 * out MIN_EVIDENCE_AGE_MS. Older employers are not re-queried for
 * first_seen_at until migration 0006's helper exists; created_at is the
 * stand-in, which blocks the new-name spoof and leaves seeded employers.
 */
async function attachEvidence(rows: CandidateRow[]): Promise<LeaderboardSourceEmployer[]> {
  const reportOnly = rows.filter(
    (row) =>
      Number(row.total_listings_tracked || 0) < MIN_LISTINGS_FOR_LEADERBOARD &&
      Number(row.total_reports || 0) >= MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD
  );

  const byEmployer = new Map<string, { count: number; oldestAt: string | null }>();
  if (reportOnly.length > 0) {
    try {
      const reports = await loadQualifyingReports(reportOnly.map((row) => row.id));
      const grouped = new Map<string, typeof reports>();
      for (const report of reports) {
        const list = grouped.get(report.employer_id) || [];
        list.push(report);
        grouped.set(report.employer_id, list);
      }
      for (const row of reportOnly) {
        byEmployer.set(row.id, distinctListingReporters(grouped.get(row.id) || []));
      }
    } catch (error) {
      console.error('[SkipThisJob] Report evidence query failed; hiding report-only rows', error);
      for (const row of reportOnly) byEmployer.set(row.id, { count: 0, oldestAt: null });
    }
  }

  return rows.map((row) => {
    const evidence = byEmployer.get(row.id);
    if (!evidence) return row;
    return {
      ...row,
      qualifying_distinct_reporters: evidence.count,
      oldest_qualifying_report_at: evidence.oldestAt,
      total_reports: evidence.count,
    };
  });
}

async function loadCandidates(): Promise<LeaderboardSourceEmployer[]> {
  const now = Date.now();
  if (candidateCache && candidateCache.expires > now) return candidateCache.rows;

  const rows: CandidateRow[] = [];
  const evidenceFilter =
    `total_listings_tracked.gte.${MIN_LISTINGS_FOR_LEADERBOARD},` +
    `total_reports.gte.${MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD}`;

  for (let from = 0; from < 50_000; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('employers')
      .select(
        `
        id,
        created_at,
        name_raw,
        industry,
        company_size,
        ghost_score,
        ghost_label,
        total_reports,
        total_listings_tracked,
        glassdoor_rating,
        glassdoor_url
      `
      )
      .or(evidenceFilter)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const batch = (data || []) as CandidateRow[];
    for (const row of batch) {
      rows.push(row);
    }
    if (batch.length < PAGE_SIZE) break;
  }

  const checked = await attachEvidence(rows);
  candidateCache = { rows: checked, expires: now + CACHE_MS };
  return checked;
}

function parseBoundedInt(value: string | null, fallback: number, max: number): number {
  const n = parseInt(value || '', 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

export async function GET(request: NextRequest) {
  const limit = parseBoundedInt(request.nextUrl.searchParams.get('limit'), 20, 100);
  const offset = parseBoundedInt(request.nextUrl.searchParams.get('offset'), 0, 100_000);

  const sortByParam = request.nextUrl.searchParams.get('sort_by') || 'ghost_score';
  const sortBy: LeaderboardSortColumn = SORTABLE_COLUMNS.includes(sortByParam as LeaderboardSortColumn)
    ? (sortByParam as LeaderboardSortColumn)
    : 'ghost_score';

  const sortDirParam = request.nextUrl.searchParams.get('sort_dir') || 'desc';
  const ascending = sortDirParam === 'asc';

  let candidates: LeaderboardSourceEmployer[];
  try {
    candidates = await loadCandidates();
  } catch (error) {
    console.error('[SkipThisJob] Leaderboard query error:', error);
    return corsResponse({ error: 'Query failed' }, 500);
  }

  const ranked = prepareLeaderboard(candidates, sortBy, ascending);

  return corsResponse({
    employers: ranked.slice(offset, offset + limit),
    total: ranked.length,
    limit,
    offset,
    minimum_listings: MIN_LISTINGS_FOR_LEADERBOARD,
    minimum_reports: MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD,
  });
}
