import { NextRequest } from 'next/server';
import { corsResponse, corsOptions } from '@/lib/cors';
import { supabaseAdmin } from '@/lib/supabase';
import {
  MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD,
  MIN_LISTINGS_FOR_LEADERBOARD,
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
 * listings, or at least MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD community
 * reports. Personal-looking names and empty/short/numeric names are dropped
 * in prepareLeaderboard. ghost_score in the response is the display score
 * (thin listing history is capped). Sort and pagination run after that, so
 * the order matches the numbers on the page.
 */
export async function OPTIONS() {
  return corsOptions();
}

type CachedCandidates = {
  rows: LeaderboardSourceEmployer[];
  expires: number;
};

let candidateCache: CachedCandidates | null = null;

async function loadCandidates(): Promise<LeaderboardSourceEmployer[]> {
  const now = Date.now();
  if (candidateCache && candidateCache.expires > now) return candidateCache.rows;

  const rows: LeaderboardSourceEmployer[] = [];
  const evidenceFilter =
    `total_listings_tracked.gte.${MIN_LISTINGS_FOR_LEADERBOARD},` +
    `total_reports.gte.${MIN_COMMUNITY_REPORTS_FOR_LEADERBOARD}`;

  for (let from = 0; from < 50_000; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('employers')
      .select(
        `
        id,
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

    const batch = data || [];
    for (const row of batch) {
      rows.push(row);
    }
    if (batch.length < PAGE_SIZE) break;
  }

  candidateCache = { rows, expires: now + CACHE_MS };
  return rows;
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
