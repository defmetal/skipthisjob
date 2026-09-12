import { NextRequest } from 'next/server';
import { corsResponse, corsOptions } from '@/lib/cors';
import { supabaseAdmin } from '@/lib/supabase';
import { recomputeEmployerScore } from '@/lib/employerScore';
import { enforceRateLimit } from '@/lib/rateLimit';
import {
  countSimilarRoles,
  parseLocation,
  persistListingSignals,
  upsertRepostPattern,
} from '@/lib/listingTrack';

/**
 * POST /api/track
 *
 * Passively tracks job listing metadata + signals from extension views.
 * listingHeuristic is the extension pre-blend score (scoreLocally().score).
 *
 * Apply-click events may arrive as a full listing payload or as a
 * platform + platformJobId lookup (USER_CLICKED_APPLY fallback).
 */
export async function OPTIONS() {
  return corsOptions();
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'Invalid JSON' }, 400);
  }

  const limited = enforceRateLimit(request, 'track', 40, 60_000);
  if (!limited.ok) return limited.response;

  const {
    companyName,
    jobTitle,
    platform,
    platformJobId,
    location,
    salaryListed,
    isRepost,
    daysOpen,
    engagementSignals,
    employerResponseTime,
    userClickedApply,
    workArrangement,
    employmentType,
    listingHeuristic,
    descriptionHash,
  } = body;

  const heuristicScore =
    typeof listingHeuristic === 'number' && Number.isFinite(listingHeuristic)
      ? Math.max(0, Math.min(100, Math.round(listingHeuristic * 10) / 10))
      : null;

  const postedDate =
    daysOpen != null ? new Date(Date.now() - daysOpen * 86400000).toISOString().split('T')[0] : null;

  // Apply-only fallback: resolve an existing listing by platform job id
  // when the lightweight USER_CLICKED_APPLY path omitted company/title.
  if (userClickedApply && platform && platformJobId && (!companyName || !jobTitle)) {
    const { data: existing } = await supabaseAdmin
      .from('listings')
      .select('id, employer_id, title_normalized, location_city, location_state')
      .eq('platform', platform)
      .eq('platform_job_id', platformJobId)
      .maybeSingle();

    if (!existing) {
      return corsResponse({ error: 'Missing required fields' }, 400);
    }

    await persistListingSignals(supabaseAdmin, existing.id, {
      userClickedApply: true,
      engagementSignals: engagementSignals || [],
      employerResponseTime: employerResponseTime || null,
      workArrangement: workArrangement || null,
      employmentType: employmentType || null,
    });

    return corsResponse({ success: true, apply: true, deduped: true });
  }

  if (!companyName || !jobTitle || !platform) {
    return corsResponse({ error: 'Missing required fields' }, 400);
  }

  // Normalize company name (same logic as score API)
  let normalized = companyName.toLowerCase().trim().replace(/\.com\b/gi, '');
  const suffixes = /\s+(inc\.?|llc\.?|llp\.?|corp\.?|ltd\.?|co\.?|company|corporation|group|holdings|services|consulting|solutions|enterprises|technologies|international|worldwide|global|north america|usa|us)$/i;
  for (let i = 0; i < 4; i++) {
    const before = normalized;
    normalized = normalized.replace(suffixes, '').trim();
    if (normalized === before) break;
  }
  normalized = normalized.replace(/\s+/g, ' ').trim();

  const normalizedTitle = jobTitle.toLowerCase().trim();
  const { city, state } = parseLocation(location);

  // Upsert employer
  let { data: employer } = await supabaseAdmin
    .from('employers')
    .select('id, total_listings_tracked')
    .eq('name_normalized', normalized)
    .single();

  if (!employer) {
    const { data: newEmployer, error: insertError } = await supabaseAdmin
      .from('employers')
      .insert({
        name_raw: companyName.trim(),
        name_normalized: normalized,
        total_listings_tracked: 0,
      })
      .select('id, total_listings_tracked')
      .single();

    if (insertError) {
      const { data: retry } = await supabaseAdmin
        .from('employers')
        .select('id, total_listings_tracked')
        .eq('name_normalized', normalized)
        .single();
      employer = retry;
    } else {
      employer = newEmployer;
    }
  }

  if (!employer) {
    return corsResponse({ error: 'Failed to resolve employer' }, 500);
  }

  let listingId: string | null = null;
  let isNewListing = false;

  if (platformJobId) {
    const { data: existing } = await supabaseAdmin
      .from('listings')
      .select('id')
      .eq('platform', platform)
      .eq('platform_job_id', platformJobId)
      .maybeSingle();

    if (!existing) {
      const { data: newListing, error: listingError } = await supabaseAdmin
        .from('listings')
        .insert({
          employer_id: employer.id,
          platform,
          platform_job_id: platformJobId,
          title_raw: jobTitle,
          title_normalized: normalizedTitle,
          location_raw: location || null,
          location_city: city || null,
          location_state: state,
          salary_listed: salaryListed ?? false,
          is_repost: isRepost ?? false,
          posted_date: postedDate,
          heuristic_score: heuristicScore,
          description_hash: descriptionHash || null,
          source: 'extension',
        })
        .select('id')
        .single();

      if (!listingError && newListing) {
        listingId = newListing.id;
        isNewListing = true;
        await supabaseAdmin
          .from('employers')
          .update({
            total_listings_tracked: (employer.total_listings_tracked || 0) + 1,
          })
          .eq('id', employer.id);
      }
    } else {
      listingId = existing.id;
      await supabaseAdmin
        .from('listings')
        .update({
          last_seen_at: new Date().toISOString(),
          ...(heuristicScore != null ? { heuristic_score: heuristicScore } : {}),
          ...(descriptionHash ? { description_hash: descriptionHash } : {}),
        })
        .eq('id', existing.id);
    }
  }

  if (listingId) {
    const similarCount = await countSimilarRoles(
      supabaseAdmin,
      employer.id,
      listingId,
      normalizedTitle
    );

    await persistListingSignals(supabaseAdmin, listingId, {
      userClickedApply: userClickedApply ?? false,
      engagementSignals: engagementSignals || [],
      employerResponseTime: employerResponseTime || null,
      similarRolesCount: similarCount,
      workArrangement: workArrangement || null,
      employmentType: employmentType || null,
    });

    try {
      await upsertRepostPattern(supabaseAdmin, {
        employerId: employer.id,
        titleNormalized: normalizedTitle,
        city,
        state,
        postedDate,
        descriptionHash: descriptionHash || null,
        isNewListing,
      });
    } catch (e) {
      console.error('upsertRepostPattern failed:', e);
    }
  }

  if (heuristicScore != null) {
    try {
      await recomputeEmployerScore(supabaseAdmin, employer.id, 'new_listing');
    } catch (e) {
      console.error('recomputeEmployerScore (track) failed:', e);
    }
  }

  return corsResponse({ success: true, isNewListing });
}
