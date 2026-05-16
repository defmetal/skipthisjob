import { NextRequest } from 'next/server';
import { corsResponse, corsOptions } from '@/lib/cors';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/track
 *
 * Passively tracks job listing metadata + signals from extension views (0.1.8+).
 *
 * Body now includes optional signals:
 * - userClickedApply
 * - engagementSignals
 * - employerResponseTime
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

  const {
    companyName,
    jobTitle,
    platform,
    platformJobId,
    location,
    salaryListed,
    isRepost,
    daysOpen,
    // 0.1.8 new signals
    engagementSignals,
    employerResponseTime,
    userClickedApply,
    // Additional 0.1.8 signals
    workArrangement,
    employmentType,
  } = body;

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
      // Race condition — try fetch again
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

  // Upsert listing (deduplicate by platform + platformJobId)
  if (platformJobId) {
    const { data: existing } = await supabaseAdmin
      .from('listings')
      .select('id')
      .eq('platform', platform)
      .eq('platform_job_id', platformJobId)
      .single();

    if (!existing) {
      // Parse location into city/state
      let city = null;
      let state = null;
      if (location) {
        const parts = location.split(',').map((p: string) => p.trim());
        city = parts[0]?.toLowerCase() || null;
        state = parts[1]?.trim() || null;
      }

      // Insert new listing and capture the ID
      const { data: newListing, error: listingError } = await supabaseAdmin
        .from('listings')
        .insert({
          employer_id: employer.id,
          platform,
          platform_job_id: platformJobId,
          title_raw: jobTitle,
          title_normalized: normalizedTitle,
          location_raw: location || null,
          location_city: city,
          location_state: state,
          salary_listed: salaryListed ?? false,
          is_repost: isRepost ?? false,
          posted_date: daysOpen != null ? new Date(Date.now() - daysOpen * 86400000).toISOString().split('T')[0] : null,
          source: 'extension',
        })
        .select('id')
        .single();

      if (!listingError && newListing) {
        // Increment employer listing count
        await supabaseAdmin
          .from('employers')
          .update({
            total_listings_tracked: (employer.total_listings_tracked || 0) + 1,
          })
          .eq('id', employer.id);

        // 0.1.8: Smarter similar roles count (title similarity)
        const { data: otherListingsNew } = await supabaseAdmin
          .from('listings')
          .select('title_normalized')
          .eq('employer_id', employer.id)
          .eq('is_active', true)
          .neq('id', newListing.id);

        let similarCountNew = 0;
        if (otherListingsNew && otherListingsNew.length > 0 && normalizedTitle) {
          similarCountNew = otherListingsNew.filter(l => {
            if (!l.title_normalized) return false;
            const wordsA = new Set(normalizedTitle.split(/\s+/).filter((w: string) => w.length > 3));
            const wordsB = new Set(l.title_normalized.split(/\s+/).filter((w: string) => w.length > 3));
            let overlap = 0;
            wordsA.forEach(w => { if (wordsB.has(w)) overlap++; });
            return overlap >= 3; // stricter: at least 3 significant words
          }).length;
        }

        await supabaseAdmin
          .from('listing_signals')
          .insert({
            listing_id: newListing.id,
            user_clicked_apply: userClickedApply ?? false,
            engagement_signals: engagementSignals || [],
            employer_response_time: employerResponseTime || null,
            similar_roles_count: similarCountNew,
            work_arrangement: workArrangement || null,
            employment_type: employmentType || null,
          });
      }
    } else {
      // Update last_seen_at on existing listing
      await supabaseAdmin
        .from('listings')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', existing.id);

      // 0.1.8: Smarter similar roles count (title similarity)
      const { data: otherListingsExisting } = await supabaseAdmin
        .from('listings')
        .select('title_normalized')
        .eq('employer_id', employer.id)
        .eq('is_active', true)
        .neq('id', existing.id);

      let similarCountExisting = 0;
      if (otherListingsExisting && otherListingsExisting.length > 0 && normalizedTitle) {
        similarCountExisting = otherListingsExisting.filter(l => {
          if (!l.title_normalized) return false;
          const wordsA = new Set(normalizedTitle.split(/\s+/).filter((w: string) => w.length > 3));
          const wordsB = new Set(l.title_normalized.split(/\s+/).filter((w: string) => w.length > 3));
          let overlap = 0;
          wordsA.forEach(w => { if (wordsB.has(w)) overlap++; });
          return overlap >= 3; // stricter: at least 3 significant words
        }).length;
      }

      await supabaseAdmin
        .from('listing_signals')
        .insert({
          listing_id: existing.id,
          user_clicked_apply: userClickedApply ?? false,
          engagement_signals: engagementSignals || [],
          employer_response_time: employerResponseTime || null,
          similar_roles_count: similarCountExisting,
          work_arrangement: workArrangement || null,
          employment_type: employmentType || null,
        });
    }
  }

  return corsResponse({ success: true });
}
