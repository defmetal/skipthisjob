import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/employer/score?name=CompanyName
 *
 * Returns the ghost score and metadata for an employer.
 * Called by the Chrome extension on every job listing view.
 *
 * Response shape:
 * {
 *   score: number,
 *   label: 'low' | 'moderate' | 'high' | 'very_high',
 *   signals: string[],
 *   totalReports: number,
 *   totalListings: number,
 *   glassdoor?: { rating, offerRate, url } | null
 * }
 */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name');
  if (!name) {
    return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 });
  }

  // Normalize: lowercase, trim, strip common suffixes
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/\s+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.?|company|corporation|group|holdings)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Look up employer
  const { data: employer, error } = await supabaseAdmin
    .from('employers')
    .select(`
      ghost_score,
      ghost_label,
      total_reports,
      total_listings_tracked,
      glassdoor_rating,
      glassdoor_offer_rate,
      glassdoor_positive_rate,
      glassdoor_url,
      is_high_turnover_industry,
      company_size,
      industry
    `)
    .eq('name_normalized', normalized)
    .single();

  if (error || !employer) {
    // Try fuzzy match (contains)
    const { data: fuzzyResults } = await supabaseAdmin
      .from('employers')
      .select(`
        ghost_score,
        ghost_label,
        total_reports,
        total_listings_tracked,
        glassdoor_rating,
        glassdoor_offer_rate,
        glassdoor_positive_rate,
        glassdoor_url,
        is_high_turnover_industry,
        company_size,
        industry
      `)
      .ilike('name_normalized', `%${normalized}%`)
      .order('total_reports', { ascending: false })
      .limit(1);

    if (!fuzzyResults || fuzzyResults.length === 0) {
      // No data — extension will use heuristic-only scoring
      return NextResponse.json({ score: null, found: false });
    }

    return buildResponse(fuzzyResults[0]);
  }

  return buildResponse(employer);
}

function buildResponse(employer: any) {
  const signals: string[] = [];

  if (employer.total_reports >= 10) {
    signals.push(`${employer.total_reports} community ghost reports`);
  }

  if (employer.glassdoor_rating && employer.glassdoor_rating < 3.0) {
    signals.push(`Glassdoor rating: ${employer.glassdoor_rating}/5`);
  }

  if (employer.glassdoor_offer_rate && employer.glassdoor_offer_rate < 0.2) {
    signals.push(
      `Only ${Math.round(employer.glassdoor_offer_rate * 100)}% of Glassdoor interviewees got offers`
    );
  }

  // Build Glassdoor object only if data exists
  let glassdoor = null;
  if (employer.glassdoor_rating != null) {
    glassdoor = {
      rating: employer.glassdoor_rating,
      offerRate: employer.glassdoor_offer_rate,
      positiveRate: employer.glassdoor_positive_rate,
      url: employer.glassdoor_url,
    };
  }

  return NextResponse.json({
    score: employer.ghost_score,
    label: employer.ghost_label,
    signals,
    totalReports: employer.total_reports,
    totalListings: employer.total_listings_tracked,
    glassdoor,
    found: true,
  });
}
