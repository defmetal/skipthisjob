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
 * Identical copy is meaningful only once at least two description hashes
 * exist. A single listing used to set descriptions_identical = true
 * (unique set size <= 1), so the first real repost inherited a false flag.
 */
export function descriptionsAreIdentical(hashes: Array<string | null | undefined>): boolean {
  const present = hashes.filter((h): h is string => typeof h === 'string' && h.length > 0);
  if (present.length < 2) return false;
  return new Set(present).size === 1;
}

/** No repost row until the same title+city has been tracked twice. */
export function repostCountForListings(listingCount: number | null | undefined): number | null {
  const count = Number(listingCount);
  if (!Number.isFinite(count) || count < 2) return null;
  return Math.floor(count);
}

let incrementFallbackWarned = false;

/**
 * Atomic increment when database/migrations/0006 has been applied.
 * Until then, fall back to a read-modify-write so tracking still works.
 */
export async function incrementListingsTracked(
  db: SupabaseClient,
  employerId: string,
  previousCount: number | null | undefined
): Promise<void> {
  const { error } = await db.rpc('increment_listings_tracked', {
    target_employer_id: employerId,
  });
  if (!error) return;
  if (!incrementFallbackWarned) {
    incrementFallbackWarned = true;
    console.error(
      '[SkipThisJob] increment_listings_tracked RPC unavailable; falling back until database/migrations/0006_api_integrity.sql is applied'
    );
  }
  await db
    .from('employers')
    .update({ total_listings_tracked: (previousCount || 0) + 1 })
    .eq('id', employerId);
}

/**
 * Keep repost_patterns live: write a row only once a second listing is
 * seen for this employer + normalized title + city. Re-views of a listing
 * the caller already stored (isNewListing false) do not touch the table.
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
  if (!args.isNewListing) return;

  const cityKey = args.city || '';
  const { count } = await db
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('employer_id', args.employerId)
    .eq('title_normalized', args.titleNormalized)
    .eq('location_city', cityKey);

  const occurrence = repostCountForListings(count);
  if (occurrence == null) return;

  const { data: hashRows } = await db
    .from('listings')
    .select('description_hash')
    .eq('employer_id', args.employerId)
    .eq('title_normalized', args.titleNormalized)
    .eq('is_active', true);

  const hashes = (hashRows || []).map(
    (r: { description_hash: string | null }) => r.description_hash
  );
  if (args.descriptionHash && !hashes.includes(args.descriptionHash)) {
    hashes.push(args.descriptionHash);
  }
  const descriptionsIdentical = descriptionsAreIdentical(hashes);

  const { data: existing } = await db
    .from('repost_patterns')
    .select('id, first_posted, last_posted')
    .eq('employer_id', args.employerId)
    .eq('title_normalized', args.titleNormalized)
    .eq('location_city', cityKey)
    .maybeSingle();

  if (!existing) {
    await db.from('repost_patterns').insert({
      employer_id: args.employerId,
      title_normalized: args.titleNormalized,
      location_city: cityKey,
      location_state: args.state,
      occurrence_count: occurrence,
      first_posted: args.postedDate,
      last_posted: args.postedDate,
      descriptions_identical: descriptionsIdentical,
    });
    return;
  }

  let lastPosted = existing.last_posted || args.postedDate;
  if (args.postedDate && (!lastPosted || args.postedDate > lastPosted)) {
    lastPosted = args.postedDate;
  }

  await db
    .from('repost_patterns')
    .update({
      occurrence_count: occurrence,
      last_posted: lastPosted,
      descriptions_identical: descriptionsIdentical,
      ...(args.state ? { location_state: args.state } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);
}
