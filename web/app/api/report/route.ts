import { NextRequest } from 'next/server';
import { corsResponse, corsOptions } from '@/lib/cors';
import { getSupabaseAdmin } from '@/lib/supabase';
import { recomputeEmployerScore } from '@/lib/employerScore';
import { enforceRateLimit } from '@/lib/rateLimit';
import { normalizeCompanyName } from '@/lib/normalizeCompanyName';
import { distinctListingReporters } from '@/lib/leaderboardEligibility';
import { isAllowedPostOrigin } from '@/lib/originCheck';
import { isRecord, parseReportBody } from '@/lib/requestValidation';

/**
 * POST /api/report
 *
 * Accepts a community report (ghost flag or outcome) from the extension.
 * A report counts toward employers.total_reports only when it is tied to a
 * platform job id (and therefore a listing row). Repeat reports from the
 * same anonymous id return 409 instead of overwriting the first.
 */
export async function OPTIONS() {
  return corsOptions();
}

export async function POST(request: NextRequest) {
  if (!isAllowedPostOrigin(request.headers.get('origin'))) {
    return corsResponse({ error: 'Origin not allowed' }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'Invalid JSON' }, 400);
  }
  if (!isRecord(body)) {
    return corsResponse({ error: 'Invalid JSON body' }, 400);
  }

  const hashKey =
    typeof body.anonymousUserHash === 'string' ? body.anonymousUserHash.slice(0, 128) : undefined;
  const limited = enforceRateLimit(request, 'report', 8, 60_000, hashKey);
  if (!limited.ok) return limited.response;

  const parsed = parseReportBody(body);
  if (!parsed.ok) {
    return corsResponse({ error: parsed.error }, 400);
  }
  const report = parsed.value;

  let db;
  try {
    db = getSupabaseAdmin();
  } catch (error) {
    console.error('[SkipThisJob] Supabase is not configured', error);
    return corsResponse({ error: 'Server is not configured' }, 500);
  }

  const normalizedCompany = normalizeCompanyName(report.companyName);
  if (!normalizedCompany) {
    return corsResponse({ error: 'Invalid companyName' }, 400);
  }
  const normalizedTitle = report.jobTitle.toLowerCase().trim();

  let { data: employer } = await db
    .from('employers')
    .select('id')
    .eq('name_normalized', normalizedCompany)
    .maybeSingle();

  if (!employer) {
    const { data: newEmployer, error: insertError } = await db
      .from('employers')
      .insert({
        name_raw: report.companyName,
        name_normalized: normalizedCompany,
      })
      .select('id')
      .single();

    if (insertError) {
      const { data: retryEmployer } = await db
        .from('employers')
        .select('id')
        .eq('name_normalized', normalizedCompany)
        .maybeSingle();
      employer = retryEmployer;
    } else {
      employer = newEmployer;
    }
  }

  if (!employer) {
    return corsResponse({ error: 'Failed to resolve employer' }, 500);
  }

  let { data: listing } = await db
    .from('listings')
    .select('id')
    .eq('platform', report.platform)
    .eq('platform_job_id', report.platformJobId)
    .maybeSingle();

  if (!listing) {
    const { data: newListing, error: listingError } = await db
      .from('listings')
      .insert({
        employer_id: employer.id,
        platform: report.platform,
        platform_job_id: report.platformJobId,
        title_raw: report.jobTitle,
        title_normalized: normalizedTitle,
        source: 'extension',
      })
      .select('id')
      .single();
    if (listingError || !newListing) {
      console.error('[SkipThisJob] Report listing insert failed:', listingError);
      return corsResponse({ error: 'Failed to save report' }, 500);
    }
    listing = newListing;
  }

  const { data: duplicate } = await db
    .from('community_reports')
    .select('id')
    .eq('anonymous_user_hash', report.anonymousUserHash)
    .eq('listing_id', listing.id)
    .maybeSingle();
  if (duplicate) {
    return corsResponse({ error: 'Already reported', duplicate: true }, 409);
  }

  const reportData: {
    employer_id: string;
    listing_id: string;
    anonymous_user_hash: string;
    report_type: string;
    platform: string;
    flag_reasons?: string[];
    outcome?: string | null;
  } = {
    employer_id: employer.id,
    listing_id: listing.id,
    anonymous_user_hash: report.anonymousUserHash,
    report_type: report.reportType,
    platform: report.platform,
  };
  if (report.reportType === 'ghost_flag') {
    reportData.flag_reasons = report.flagReasons;
  } else {
    reportData.outcome = report.outcome;
  }

  const { error: reportError } = await db.from('community_reports').insert(reportData);
  if (reportError) {
    if (reportError.code === '23505') {
      return corsResponse({ error: 'Already reported', duplicate: true }, 409);
    }
    console.error('[SkipThisJob] Report insert error:', reportError);
    return corsResponse({ error: 'Failed to save report' }, 500);
  }

  const { data: reportRows, error: countError } = await db
    .from('community_reports')
    .select('anonymous_user_hash, listing_id')
    .eq('employer_id', employer.id)
    .not('listing_id', 'is', null);

  const totalReports = countError ? null : distinctListingReporters(reportRows || []).count;
  if (totalReports != null) {
    await db.from('employers').update({ total_reports: totalReports }).eq('id', employer.id);
  } else {
    console.error('[SkipThisJob] Qualifying report recount failed:', countError);
  }

  const { count: listingCount } = await db
    .from('community_reports')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', listing.id);

  let ghostScore: number | null = null;
  let ghostLabel: string | null = null;
  try {
    const recomputed = await recomputeEmployerScore(db, employer.id, 'new_report');
    ghostScore = recomputed?.score ?? null;
    ghostLabel = recomputed?.label ?? null;
  } catch (error) {
    console.error('[SkipThisJob] recomputeEmployerScore (report) failed:', error);
  }

  return corsResponse({
    success: true,
    totalReports: totalReports || 0,
    listingReports: listingCount || 0,
    ghostScore,
    ghostLabel,
  });
}
