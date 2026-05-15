import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { corsResponse, corsOptions } from '@/lib/cors';

// Simple in-memory cache for fresh employer scores (reduces DB load on repeated lookups)
const freshScoreCache = new Map<string, { result: any; timestamp: number }>();
const FRESH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function OPTIONS() {
  return corsOptions();
}

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name');
  if (!name) {
    return corsResponse({ error: 'Missing name parameter' }, 400);
  }

  const selectFields = `
    id,
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
  for (let i = 0; i < 4; i++) {
    const before = normalized;
    normalized = normalized.replace(suffixes, '').trim();
    if (normalized === before) break;
  }
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // 1. Exact match
  let { data: employer } = await supabaseAdmin
    .from('employers')
    .select(selectFields)
    .eq('name_normalized', normalized)
    .single();

  if (!employer) {
    // 2. Fuzzy
    const { data: fuzzy1 } = await supabaseAdmin
      .from('employers')
      .select(selectFields)
      .ilike('name_normalized', `%${normalized}%`)
      .order('total_listings_tracked', { ascending: false })
      .limit(1);
    if (fuzzy1 && fuzzy1.length > 0) employer = fuzzy1[0];
  }

  if (!employer) {
    // 3. Reverse fuzzy on first word
    const coreName = normalized.split(' ')[0];
    if (coreName && coreName.length >= 3) {
      const { data: fuzzy2 } = await supabaseAdmin
        .from('employers')
        .select(selectFields)
        .eq('name_normalized', coreName)
        .single();
      if (fuzzy2) employer = fuzzy2;
    }
  }

  if (!employer) {
    return corsResponse({ score: null, found: false });
  }

  // === Fresh score with caching ===
  // The two extra queries (community_reports + repost_patterns) are expensive.
  // We cache the result for 10 minutes to avoid hammering the DB on repeated views
  // of the same company (very common when users browse multiple jobs).
  let fresh = null;
  const cacheKey = employer.id;
  const cached = freshScoreCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < FRESH_CACHE_TTL_MS) {
    fresh = cached.result;
  } else {
    fresh = await computeFreshEmployerScore(employer.id, employer.ghost_score);
    freshScoreCache.set(cacheKey, { result: fresh, timestamp: Date.now() });
  }

  return buildResponse(employer, fresh);
}

/**
 * Compute a live-adjusted ghost score using recent community reports and repost patterns.
 * Falls back to the stored ghost_score when there is little recent activity.
 */
type FreshScoreResult = {
  score: number;
  signals: string[];
  hasFreshData: boolean;
};

async function computeFreshEmployerScore(
  employerId: string,
  storedScore: number | null
): Promise<FreshScoreResult> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Recent community reports
  const { data: reports } = await supabaseAdmin
    .from('community_reports')
    .select('report_type, outcome, created_at')
    .eq('employer_id', employerId)
    .gte('created_at', ninetyDaysAgo);

  // Repost patterns for this employer
  const { data: reposts } = await supabaseAdmin
    .from('repost_patterns')
    .select('occurrence_count, descriptions_identical, updated_at')
    .eq('employer_id', employerId)
    .order('occurrence_count', { ascending: false })
    .limit(5);

  let liveScore = storedScore ?? 40;
  const liveSignals: string[] = [];

  const totalReports = reports?.length || 0;
  if (totalReports >= 3) {
    const noResponse = (reports || []).filter(
      r => r.outcome === 'no_response' || r.report_type === 'ghost_flag'
    ).length;
    const noResponseRate = noResponse / totalReports;

    if (noResponseRate >= 0.75) {
      liveScore = Math.max(liveScore, 68);
      liveSignals.push(`${Math.round(noResponseRate * 100)}% of recent applicants got no response`);
    } else if (noResponseRate >= 0.55) {
      liveScore = Math.max(liveScore, 52);
      liveSignals.push(`${Math.round(noResponseRate * 100)}% recent no-response rate`);
    }
    if (totalReports >= 8) {
      liveSignals.push(`${totalReports} recent community reports`);
    }
  }

  // Repost frequency (very strong ghost signal)
  const safeReposts = reposts || [];
  if (safeReposts.length > 0) {
    const maxRepost = Math.max(0, ...safeReposts.map(r => r.occurrence_count || 0));
    const hasIdentical = safeReposts.some(r => r.descriptions_identical);

    if (maxRepost >= 6) {
      liveScore = Math.max(liveScore, 75);
      liveSignals.push(`Same role reposted ${maxRepost}x recently`);
    } else if (maxRepost >= 4) {
      liveScore = Math.max(liveScore, 62);
      liveSignals.push(`Role reposted ${maxRepost}x in recent months`);
    }
    if (hasIdentical && maxRepost >= 3) {
      liveScore += 6;
      liveSignals.push('Identical description across reposts');
    }
  }

  // Blend: 55% live signals + 45% stored score when we have meaningful recent data
  let finalLive = liveScore;
  if (totalReports >= 2 || safeReposts.length > 0) {
    const stored = storedScore ?? 45;
    finalLive = Math.round(stored * 0.45 + liveScore * 0.55);
  }

  const hasFreshData = totalReports >= 2 || safeReposts.length > 0;

  return {
    score: Math.min(100, Math.max(0, Math.round(finalLive))),
    signals: liveSignals,
    hasFreshData,
  };
}

function buildResponse(
  employer: any,
  fresh?: { score: number; signals: string[]; hasFreshData: boolean }
) {
  const signals: string[] = [];
  let finalScore = employer.ghost_score ?? 40;
  let label = employer.ghost_label || 'moderate';

  // Prefer fresh live score when we have recent activity
  if (fresh && fresh.hasFreshData && fresh.score != null) {
    finalScore = fresh.score;
    signals.push(...fresh.signals);
  } else {
    // Fall back to stored signals
    if (employer.total_reports >= 10) {
      signals.push(`${employer.total_reports} community ghost reports`);
    }
  }

  if (employer.glassdoor_rating && employer.glassdoor_rating < 3.0) {
    signals.push(`Glassdoor rating: ${employer.glassdoor_rating}/5`);
  }
  if (employer.glassdoor_offer_rate && employer.glassdoor_offer_rate < 0.2) {
    signals.push(`Only ${Math.round(employer.glassdoor_offer_rate * 100)}% of Glassdoor interviewees got offers`);
  }

  let glassdoor = null;
  if (employer.glassdoor_rating != null) {
    glassdoor = {
      rating: employer.glassdoor_rating,
      offerRate: employer.glassdoor_offer_rate,
      positiveRate: employer.glassdoor_positive_rate,
      url: employer.glassdoor_url,
    };
  }

  // Recompute label from whichever score we are returning
  if (finalScore >= 75) label = 'very_high';
  else if (finalScore >= 50) label = 'high';
  else if (finalScore >= 25) label = 'moderate';
  else label = 'low';

  return corsResponse({
    score: finalScore,
    label,
    signals: Array.from(new Set(signals)), // dedupe
    totalReports: employer.total_reports,
    totalListings: employer.total_listings_tracked,
    glassdoor,
    found: true,
    live: !!(fresh && fresh.hasFreshData),
  });
}
