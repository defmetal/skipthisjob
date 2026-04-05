import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/report
 *
 * Accepts a community report (ghost flag or outcome) from the extension.
 *
 * Body:
 * {
 *   reportType: 'ghost_flag' | 'outcome',
 *   companyName: string,
 *   jobTitle: string,
 *   platformJobId?: string,
 *   listingUrl?: string,
 *   platform: 'linkedin' | 'indeed',
 *   anonymousUserHash: string,
 *   flagReasons?: string[],       // for ghost_flag
 *   outcome?: string,             // for outcome: 'no_response' | 'rejected' | 'interviewed' | 'offered'
 * }
 */
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    reportType,
    companyName,
    jobTitle,
    platformJobId,
    listingUrl,
    platform,
    anonymousUserHash,
    flagReasons,
    outcome,
  } = body;

  // Validate required fields
  if (!reportType || !companyName || !anonymousUserHash || !platform) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (reportType !== 'ghost_flag' && reportType !== 'outcome') {
    return NextResponse.json({ error: 'Invalid reportType' }, { status: 400 });
  }

  const normalizedCompany = companyName
    .toLowerCase()
    .trim()
    .replace(/\s+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.?|company|corporation|group|holdings)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizedTitle = jobTitle
    ? jobTitle.toLowerCase().trim()
    : null;

  // --- Upsert employer if not exists ---
  let { data: employer } = await supabaseAdmin
    .from('employers')
    .select('id')
    .eq('name_normalized', normalizedCompany)
    .single();

  if (!employer) {
    const { data: newEmployer, error: insertError } = await supabaseAdmin
      .from('employers')
      .insert({
        name_raw: companyName.trim(),
        name_normalized: normalizedCompany,
      })
      .select('id')
      .single();

    if (insertError) {
      // Might be a race condition — try to fetch again
      const { data: retryEmployer } = await supabaseAdmin
        .from('employers')
        .select('id')
        .eq('name_normalized', normalizedCompany)
        .single();
      employer = retryEmployer;
    } else {
      employer = newEmployer;
    }
  }

  if (!employer) {
    return NextResponse.json({ error: 'Failed to resolve employer' }, { status: 500 });
  }

  // --- Upsert listing if platformJobId exists ---
  let listingId = null;
  if (platformJobId && normalizedTitle) {
    let { data: listing } = await supabaseAdmin
      .from('listings')
      .select('id')
      .eq('platform', platform)
      .eq('platform_job_id', platformJobId)
      .single();

    if (!listing) {
      const { data: newListing } = await supabaseAdmin
        .from('listings')
        .insert({
          employer_id: employer.id,
          platform,
          platform_job_id: platformJobId,
          title_raw: jobTitle,
          title_normalized: normalizedTitle,
          source: 'extension',
        })
        .select('id')
        .single();
      listing = newListing;
    }

    listingId = listing?.id || null;
  }

  // --- Insert community report ---
  const reportData: any = {
    employer_id: employer.id,
    listing_id: listingId,
    anonymous_user_hash: anonymousUserHash,
    report_type: reportType,
    platform,
  };

  if (reportType === 'ghost_flag') {
    reportData.flag_reasons = flagReasons || [];
  } else if (reportType === 'outcome') {
    reportData.outcome = outcome;
  }

  const { error: reportError } = await supabaseAdmin
    .from('community_reports')
    .upsert(reportData, {
      onConflict: 'anonymous_user_hash,listing_id',
    });

  if (reportError) {
    // If it's a unique constraint violation, user already reported
    if (reportError.code === '23505') {
      return NextResponse.json({ error: 'Already reported', duplicate: true }, { status: 409 });
    }
    console.error('Report insert error:', reportError);
    return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
  }

  // --- Increment employer report count ---
  await supabaseAdmin.rpc('increment_employer_reports', {
    employer_uuid: employer.id,
  });

  // If the RPC doesn't exist yet, fall back to a manual update
  // This is a simple version — production would recompute the full score
  await supabaseAdmin
    .from('employers')
    .update({
      total_reports: (await supabaseAdmin
        .from('community_reports')
        .select('id', { count: 'exact', head: true })
        .eq('employer_id', employer.id)
      ).count || 0,
    })
    .eq('id', employer.id);

  return NextResponse.json({ success: true });
}
