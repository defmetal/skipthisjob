import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { corsResponse, corsOptions } from '@/lib/cors';
import { enforceRateLimit } from '@/lib/rateLimit';
import { normalizeCompanyName } from '@/lib/normalizeCompanyName';
import {
  acceptFirstWordMatch,
  escapeLikePattern,
  firstWordCandidate,
  pickPrefixMatch,
  MIN_FUZZY_LENGTH,
} from '@/lib/employerMatch';
import {
  scoreResponseForEvidence,
  type FreshReportRow,
  type FreshRepostRow,
} from '@/lib/freshEmployerScore';
import { isValidPlatformJobId } from '@/lib/requestValidation';

const freshScoreCache = new Map<
  string,
  { reports: FreshReportRow[]; reposts: FreshRepostRow[]; timestamp: number }
>();
const FRESH_CACHE_TTL_MS = 10 * 60 * 1000;

const SELECT_FIELDS = `
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
  industry,
  name_normalized
`;

export async function OPTIONS() {
  return corsOptions();
}

type EmployerRow = {
  id: string;
  name_normalized: string;
  ghost_score: number | null;
  ghost_label: string | null;
  total_reports: number | null;
  total_listings_tracked: number | null;
  glassdoor_rating: number | null;
  glassdoor_offer_rate: number | null;
  glassdoor_positive_rate: number | null;
  glassdoor_url: string | null;
};

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, 'score', 80, 60_000);
  if (!limited.ok) return limited.response;

  let db;
  try {
    db = getSupabaseAdmin();
  } catch (error) {
    console.error('[SkipThisJob] Supabase is not configured', error);
    return corsResponse({ error: 'Server is not configured' }, 500);
  }

  const name = request.nextUrl.searchParams.get('name');
  if (!name || !name.trim()) {
    return corsResponse({ error: 'Missing name parameter' }, 400);
  }
  if (name.length > 300) {
    return corsResponse({ error: 'Name is too long' }, 400);
  }

  const platform = request.nextUrl.searchParams.get('platform');
  const jobId = request.nextUrl.searchParams.get('jobId');
  const bypassCache = request.nextUrl.searchParams.get('fresh') === '1';
  const normalized = normalizeCompanyName(name);
  if (!normalized) {
    return corsResponse({ score: null, found: false });
  }

  const employer = await findEmployer(db, normalized);
  if (!employer) {
    return corsResponse({ score: null, found: false });
  }

  const now = Date.now();
  const cached = freshScoreCache.get(employer.id);
  let reports: FreshReportRow[];
  let reposts: FreshRepostRow[];
  if (!bypassCache && cached && now - cached.timestamp < FRESH_CACHE_TTL_MS) {
    reports = cached.reports;
    reposts = cached.reposts;
  } else {
    const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reportRows } = await db
      .from('community_reports')
      .select('report_type, outcome, created_at')
      .eq('employer_id', employer.id)
      .gte('created_at', ninetyDaysAgo);
    reports = reportRows || [];

    const { data: repostRows } = await db
      .from('repost_patterns')
      .select('occurrence_count, descriptions_identical, updated_at')
      .eq('employer_id', employer.id)
      .order('occurrence_count', { ascending: false })
      .limit(5);
    reposts = repostRows || [];
    freshScoreCache.set(employer.id, { reports, reposts, timestamp: now });
  }

  let listingReports = 0;
  if (
    platform &&
    jobId &&
    (platform === 'linkedin' || platform === 'indeed') &&
    isValidPlatformJobId(platform, jobId)
  ) {
    const { data: listing } = await db
      .from('listings')
      .select('id')
      .eq('platform', platform)
      .eq('platform_job_id', platform === 'indeed' ? jobId.toLowerCase() : jobId)
      .maybeSingle();
    if (listing) {
      const { count } = await db
        .from('community_reports')
        .select('id', { count: 'exact', head: true })
        .eq('listing_id', listing.id);
      listingReports = count || 0;
    }
  }

  const body = scoreResponseForEvidence(employer, reports, reposts, listingReports, now);
  return corsResponse(body);
}

async function findEmployer(
  db: ReturnType<typeof getSupabaseAdmin>,
  normalized: string
): Promise<EmployerRow | null> {
  const { data: exact } = await db
    .from('employers')
    .select(SELECT_FIELDS)
    .eq('name_normalized', normalized)
    .maybeSingle();
  if (exact) return exact as EmployerRow;

  if (normalized.length >= MIN_FUZZY_LENGTH) {
    const { data: rows } = await db
      .from('employers')
      .select(SELECT_FIELDS)
      .ilike('name_normalized', `${escapeLikePattern(normalized)}%`)
      .order('total_listings_tracked', { ascending: false })
      .limit(8);
    const prefix = pickPrefixMatch(normalized, rows || []) as EmployerRow | null;
    if (prefix) return prefix;
  }

  const first = firstWordCandidate(normalized);
  if (first) {
    const { data: row } = await db
      .from('employers')
      .select(SELECT_FIELDS)
      .eq('name_normalized', first)
      .maybeSingle();
    if (row && acceptFirstWordMatch(normalized, (row as EmployerRow).name_normalized)) {
      return row as EmployerRow;
    }
  }

  return null;
}
