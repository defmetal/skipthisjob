import { NextRequest } from 'next/server';
import { corsResponse, corsOptions } from '@/lib/cors';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/leaderboard?limit=20&offset=0
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
    .gte('ghost_score', 25)
    .order('ghost_score', { ascending: false })
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
