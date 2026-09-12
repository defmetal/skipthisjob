import type { SupabaseClient } from '@supabase/supabase-js';

const SIGNAL_WINDOW_MS = 6 * 60 * 60 * 1000;

export function parseLocation(location?: string | null): { city: string; state: string | null } {
  if (!location) return { city: '', state: null };
  const parts = location.split(',').map((p) => p.trim());
  return {
    city: (parts[0] || '').toLowerCase(),
    state: parts[1] || null,
  };
}

export async function countSimilarRoles(
  db: SupabaseClient,
  employerId: string,
  listingId: string,
  normalizedTitle: string
): Promise<number> {
  const { data: otherListings } = await db
    .from('listings')
    .select('title_normalized')
    .eq('employer_id', employerId)
    .eq('is_active', true)
    .neq('id', listingId);

  if (!otherListings || otherListings.length === 0 || !normalizedTitle) return 0;

  const wordsA = new Set(normalizedTitle.split(/\s+/).filter((w: string) => w.length > 3));
  return otherListings.filter((l) => {
    if (!l.title_normalized) return false;
    const wordsB = new Set(l.title_normalized.split(/\s+/).filter((w: string) => w.length > 3));
    let overlap = 0;
    wordsA.forEach((w) => { if (wordsB.has(w)) overlap++; });
    return overlap >= 3;
  }).length;
}

/**
 * Insert a listing_signals row, or update the recent one for this listing
 * so re-views do not grow the table unboundedly.
 */
export async function persistListingSignals(
  db: SupabaseClient,
  listingId: string,
  payload: {
    userClickedApply?: boolean;
    engagementSignals?: string[];
    employerResponseTime?: string | null;
    similarRolesCount?: number;
    workArrangement?: string | null;
    employmentType?: string | null;
  }
): Promise<{ deduped: boolean }> {
  const windowStart = new Date(Date.now() - SIGNAL_WINDOW_MS).toISOString();
  const { data: recent } = await db
    .from('listing_signals')
    .select('id, user_clicked_apply')
    .eq('listing_id', listingId)
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) {
    const shouldMarkApply = payload.userClickedApply && !recent.user_clicked_apply;
    if (shouldMarkApply) {
      await db
        .from('listing_signals')
        .update({ user_clicked_apply: true })
        .eq('id', recent.id);
    }
    return { deduped: true };
  }

  await db.from('listing_signals').insert({
    listing_id: listingId,
    user_clicked_apply: payload.userClickedApply ?? false,
    engagement_signals: payload.engagementSignals || [],
    employer_response_time: payload.employerResponseTime || null,
    similar_roles_count: payload.similarRolesCount ?? null,
    work_arrangement: payload.workArrangement || null,
    employment_type: payload.employmentType || null,
  });
  return { deduped: false };
}

/**
 * Keep repost_patterns live: increment occurrence when a *new* listing is
 * first seen for this employer + normalized title + city; compare
 * description hashes so identical-copy evergreen roles get flagged.
 */
export async function upsertRepostPattern(
  db: SupabaseClient,
  args: {
    employerId: string;
    titleNormalized: string;
    city: string;
    state: string | null;
    postedDate: string | null;
    descriptionHash?: string | null;
    isNewListing: boolean;
  }
): Promise<void> {
  const cityKey = args.city || '';
  const { data: existing } = await db
    .from('repost_patterns')
    .select('id, occurrence_count, first_posted, last_posted, descriptions_identical')
    .eq('employer_id', args.employerId)
    .eq('title_normalized', args.titleNormalized)
    .eq('location_city', cityKey)
    .maybeSingle();

  const { data: hashRows } = await db
    .from('listings')
    .select('description_hash')
    .eq('employer_id', args.employerId)
    .eq('title_normalized', args.titleNormalized)
    .eq('is_active', true);

  const hashes = (hashRows || [])
    .map((r: { description_hash: string | null }) => r.description_hash)
    .filter((h: string | null): h is string => !!h);
  if (args.descriptionHash && !hashes.includes(args.descriptionHash)) {
    hashes.push(args.descriptionHash);
  }
  const uniqueHashes = new Set(hashes);
  const descriptionsIdentical = uniqueHashes.size <= 1;

  if (!existing) {
    await db.from('repost_patterns').insert({
      employer_id: args.employerId,
      title_normalized: args.titleNormalized,
      location_city: cityKey,
      location_state: args.state,
      occurrence_count: 1,
      first_posted: args.postedDate,
      last_posted: args.postedDate,
      descriptions_identical: descriptionsIdentical,
    });
    return;
  }

  const nextCount = args.isNewListing
    ? (existing.occurrence_count || 1) + 1
    : existing.occurrence_count || 1;

  let lastPosted = existing.last_posted || args.postedDate;
  if (args.postedDate && (!lastPosted || args.postedDate > lastPosted)) {
    lastPosted = args.postedDate;
  }

  await db
    .from('repost_patterns')
    .update({
      occurrence_count: nextCount,
      last_posted: lastPosted,
      descriptions_identical: descriptionsIdentical,
      ...(args.state ? { location_state: args.state } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);
}
