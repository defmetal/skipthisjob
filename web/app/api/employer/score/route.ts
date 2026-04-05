import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { corsResponse, corsOptions } from '@/lib/cors';

export async function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name');
  if (!name) {
    return corsResponse({ error: 'Missing name parameter' }, 400);
  }

  const selectFields = `
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
  `;

  // Normalize: lowercase, trim, strip common suffixes iteratively
  let normalized = name.toLowerCase().trim().replace(/\.com\b/gi, '');
  const suffixes = /\s+(inc\.?|llc\.?|llp\.?|corp\.?|ltd\.?|co\.?|company|corporation|group|holdings|services|consulting|solutions|enterprises|technologies|international|worldwide|global|north america|usa|us)$/i;
  // Strip suffixes repeatedly (handles "Services LLC", "Consulting Group Inc", etc.)
  for (let i = 0; i < 4; i++) {
    const before = normalized;
    normalized = normalized.replace(suffixes, '').trim();
    if (normalized === before) break;
  }
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // 1. Exact match
  const { data: employer } = await supabaseAdmin
    .from('employers')
    .select(selectFields)
    .eq('name_normalized', normalized)
    .single();

  if (employer) return buildResponse(employer);

  // 2. Fuzzy: database entry contains our search term
  const { data: fuzzy1 } = await supabaseAdmin
    .from('employers')
    .select(selectFields)
    .ilike('name_normalized', `%${normalized}%`)
    .order('total_listings_tracked', { ascending: false })
    .limit(1);

  if (fuzzy1 && fuzzy1.length > 0) return buildResponse(fuzzy1[0]);

  // 3. Reverse fuzzy: our search term contains the database entry
  //    Extract the first word as the core brand name and try that
  const coreName = normalized.split(' ')[0];
  if (coreName && coreName.length >= 3) {
    const { data: fuzzy2 } = await supabaseAdmin
      .from('employers')
      .select(selectFields)
      .eq('name_normalized', coreName)
      .single();

    if (fuzzy2) return buildResponse(fuzzy2);
  }

  // No match found
  return corsResponse({ score: null, found: false });
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

  return corsResponse({
    score: employer.ghost_score,
    label: employer.ghost_label,
    signals,
    totalReports: employer.total_reports,
    totalListings: employer.total_listings_tracked,
    glassdoor,
    found: true,
  });
}
