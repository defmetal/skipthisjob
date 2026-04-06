import { NextRequest } from 'next/server';
import { corsResponse, corsOptions } from '@/lib/cors';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/track
 *
 * Passively tracks job listing metadata from extension views.
 * No user data is collected — only public job listing information.
 *
 * Body:
 * {
 *   companyName: string,
 *   jobTitle: string,
 *   platform: 'linkedin' | 'indeed',
 *   platformJobId?: string,
 *   location?: string,
 *   salaryListed?: boolean,
 *   isRepost?: boolean,
 *   daysOpen?: number,
 * }
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

  const { companyName, jobTitle, platform, platformJobId, location, salaryListed, isRepost, daysOpen } = body;

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
        const parts = location.split(',').map(p => p.trim());
        city = parts[0]?.toLowerCase() || null;
        state = parts[1]?.trim() || null;
      }

      const { error: listingError } = await supabaseAdmin
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
        });

      if (!listingError) {
        // Increment employer listing count
        await supabaseAdmin
          .from('employers')
          .update({
            total_listings_tracked: (employer.total_listings_tracked || 0) + 1,
          })
          .eq('id', employer.id);
      }
    } else {
      // Update last_seen_at on existing listing
      await supabaseAdmin
        .from('listings')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
  }

  return corsResponse({ success: true });
}
