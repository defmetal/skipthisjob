import { NextRequest } from 'next/server';
import { corsResponse, corsOptions } from '@/lib/cors';
import { getSupabaseAdmin } from '@/lib/supabase';
import { recomputeEmployerScore } from '@/lib/employerScore';
import { enforceRateLimit } from '@/lib/rateLimit';
import { normalizeCompanyName } from '@/lib/normalizeCompanyName';
import { isAllowedPostOrigin } from '@/lib/originCheck';
import { isRecord, parseTrackBody } from '@/lib/requestValidation';
import {
  countSimilarRoles,
  incrementListingsTracked,
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
  if (!isAllowedPostOrigin(request.headers.get('origin'))) {
    return corsResponse({ error: 'Origin not allowed' }, 403);
  }

  const limited = enforceRateLimit(request, 'track', 40, 60_000);
  if (!limited.ok) return limited.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'Invalid JSON' }, 400);
  }
  if (!isRecord(body)) {
    return corsResponse({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = parseTrackBody(body);
  if (!parsed.ok) {
    return corsResponse({ error: parsed.error }, 400);
  }

  let db;
  try {
    db = getSupabaseAdmin();
  } catch (error) {
    console.error('[SkipThisJob] Supabase is not configured', error);
    return corsResponse({ error: 'Server is not configured' }, 500);
  }

  const track = parsed.value;

  if (track.mode === 'apply') {
    const { data: existing } = await db
      .from('listings')
      .select('id')
      .eq('platform', track.platform)
      .eq('platform_job_id', track.platformJobId)
      .maybeSingle();

    if (!existing) {
      return corsResponse({ error: 'Missing required fields' }, 400);
    }

    await persistListingSignals(db, existing.id, {
      userClickedApply: true,
      engagementSignals: track.engagementSignals,
      employerResponseTime: track.employerResponseTime,
      workArrangement: track.workArrangement,
      employmentType: track.employmentType,
    });

    return corsResponse({ success: true, apply: true, deduped: true });
  }

  const normalized = normalizeCompanyName(track.companyName);
  if (!normalized) {
    return corsResponse({ error: 'Invalid companyName' }, 400);
  }

  const normalizedTitle = track.jobTitle.toLowerCase().trim();
  const { city, state } = parseLocation(track.location);
  const postedDate =
    track.daysOpen != null
      ? new Date(Date.now() - track.daysOpen * 86400000).toISOString().split('T')[0]
      : null;

  let { data: employer } = await db
    .from('employers')
    .select('id, total_listings_tracked')
    .eq('name_normalized', normalized)
    .maybeSingle();

  if (!employer) {
    const { data: newEmployer, error: insertError } = await db
      .from('employers')
      .insert({
        name_raw: track.companyName,
        name_normalized: normalized,
        total_listings_tracked: 0,
      })
      .select('id, total_listings_tracked')
      .single();

    if (insertError) {
      const { data: retry } = await db
        .from('employers')
        .select('id, total_listings_tracked')
        .eq('name_normalized', normalized)
        .maybeSingle();
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
  let shouldRecompute = false;

  const { data: existing } = await db
    .from('listings')
    .select('id, heuristic_score')
    .eq('platform', track.platform)
    .eq('platform_job_id', track.platformJobId)
    .maybeSingle();

  if (!existing) {
    const { data: newListing, error: listingError } = await db
      .from('listings')
      .insert({
        employer_id: employer.id,
        platform: track.platform,
        platform_job_id: track.platformJobId,
        title_raw: track.jobTitle,
        title_normalized: normalizedTitle,
        location_raw: track.location,
        location_city: city || null,
        location_state: state,
        salary_listed: track.salaryListed,
        is_repost: track.isRepost,
        posted_date: postedDate,
        heuristic_score: track.listingHeuristic,
        description_hash: track.descriptionHash,
        source: 'extension',
      })
      .select('id')
      .single();

    if (!listingError && newListing) {
      listingId = newListing.id;
      isNewListing = true;
      if (track.listingHeuristic != null) shouldRecompute = true;
      await incrementListingsTracked(db, employer.id, employer.total_listings_tracked);
    }
  } else {
    listingId = existing.id;
    const previous =
      existing.heuristic_score == null ? null : Number(existing.heuristic_score);
    const heuristicChanged =
      track.listingHeuristic != null &&
      (previous == null || Math.abs(previous - track.listingHeuristic) > 0.049);
    await db
      .from('listings')
      .update({
        last_seen_at: new Date().toISOString(),
        ...(track.listingHeuristic != null ? { heuristic_score: track.listingHeuristic } : {}),
        ...(track.descriptionHash ? { description_hash: track.descriptionHash } : {}),
      })
      .eq('id', existing.id);
    if (heuristicChanged) shouldRecompute = true;
  }

  if (listingId) {
    const similarCount = await countSimilarRoles(db, employer.id, listingId, normalizedTitle);
    await persistListingSignals(db, listingId, {
      userClickedApply: track.userClickedApply,
      engagementSignals: track.engagementSignals,
      employerResponseTime: track.employerResponseTime,
      similarRolesCount: similarCount,
      workArrangement: track.workArrangement,
      employmentType: track.employmentType,
    });
  }

  if (isNewListing) {
    try {
      await upsertRepostPattern(db, {
        employerId: employer.id,
        titleNormalized: normalizedTitle,
        city,
        state,
        postedDate,
        descriptionHash: track.descriptionHash,
        isNewListing: true,
      });
    } catch (error) {
      console.error('[SkipThisJob] upsertRepostPattern failed:', error);
    }
  }

  if (shouldRecompute) {
    try {
      await recomputeEmployerScore(db, employer.id, 'new_listing');
    } catch (error) {
      console.error('[SkipThisJob] recomputeEmployerScore (track) failed:', error);
    }
  }

  return corsResponse({ success: true, isNewListing });
}
