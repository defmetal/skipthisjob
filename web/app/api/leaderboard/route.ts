import { NextRequest } from 'next/server';
import { corsResponse, corsOptions } from '@/lib/cors';
import { supabaseAdmin } from '@/lib/supabase';

const SORTABLE_COLUMNS = [
  'ghost_score',
  'name_raw',
  'total_listings_tracked',
  'total_reports',
  'glassdoor_rating',
  'industry',
] as const;

type SortColumn = (typeof SORTABLE_COLUMNS)[number];

/**
 * GET /api/leaderboard?limit=20&offset=0&sort_by=ghost_score&sort_dir=desc
 *
 * Returns the worst ghost job offenders, ranked by ghost score.
 * Powers the public leaderboard on the website.
 */
export async function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get('limit') || '20'),
    100
  );
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0');

  const sortByParam = request.nextUrl.searchParams.get('sort_by') || 'ghost_score';
  const sortBy: SortColumn = SORTABLE_COLUMNS.includes(sortByParam as SortColumn)
    ? (sortByParam as SortColumn)
    : 'ghost_score';

  const sortDirParam = request.nextUrl.searchParams.get('sort_dir') || 'desc';
  const ascending = sortDirParam === 'asc';

  const { data, error, count } = await supabaseAdmin
    .from('employers')
    .select(
      `
      name_raw,
      industry,
      company_size,
      ghost_score,
      ghost_label,
      total_reports,
      total_listings_tracked,
      glassdoor_rating,
      glassdoor_url
    `,
      { count: 'exact' }
    )
    .or('ghost_score.gte.25,total_reports.gt.0')
    .order(sortBy, { ascending, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('Leaderboard query error:', error);
	return corsResponse({ error: 'Query failed' }, 500);
  }

  return corsResponse({
    employers: data || [],
    total: count || 0,
    limit,
    offset,
  });
}
