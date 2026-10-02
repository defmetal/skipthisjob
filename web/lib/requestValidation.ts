const PLATFORMS = new Set(['linkedin', 'indeed']);
const WORK_ARRANGEMENTS = new Set(['remote', 'hybrid', 'onsite']);
const EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'internship']);
const OUTCOMES = new Set(['no_response', 'rejected', 'interviewed', 'offered', 'hired']);
const FLAG_REASONS = new Set([
  'no_response',
  'reposted',
  'vague_description',
  'suspected_evergreen',
]);

const LINKEDIN_JOB_ID = /^\d{6,20}$/;
const INDEED_JOB_ID = /^[a-f0-9]{16}$/;
// The extension stores crypto.randomUUID() (with hyphens). Hex-only hashes
// are accepted as well so a future id format is not required to match UUID.
const ANONYMOUS_HASH =
  /^(?:[a-f0-9]{16,64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const DESCRIPTION_HASH = /^[a-f0-9]{8,128}$/i;
const SIGNAL_TOKEN = /^[a-z0-9_]{1,40}$/;

export type Platform = 'linkedin' | 'indeed';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isValidPlatformJobId(platform: string, jobId: string): boolean {
  if (platform === 'linkedin') return LINKEDIN_JOB_ID.test(jobId);
  if (platform === 'indeed') return INDEED_JOB_ID.test(jobId.toLowerCase());
  return false;
}

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };
type Parsed<T> = Ok<T> | Err;

function fail(error: string): Err {
  return { ok: false, error };
}

function requiredString(value: unknown, field: string, max: number): Parsed<string> {
  if (typeof value !== 'string') return fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return fail(`${field} is required`);
  if (trimmed.length > max) return fail(`${field} is too long`);
  return { ok: true, value: trimmed };
}

function optionalString(value: unknown, field: string, max: number): Parsed<string | null> {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) return fail(`${field} is too long`);
  return { ok: true, value: trimmed || null };
}

function optionalBoolean(value: unknown, field: string): Parsed<boolean | null> {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== 'boolean') return fail(`${field} must be a boolean`);
  return { ok: true, value };
}

function optionalEnum(
  value: unknown,
  field: string,
  allowed: Set<string>
): Parsed<string | null> {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !allowed.has(value)) return fail(`Invalid ${field}`);
  return { ok: true, value };
}

export interface ParsedListingTrack {
  mode: 'listing';
  companyName: string;
  jobTitle: string;
  platform: Platform;
  platformJobId: string;
  location: string | null;
  salaryListed: boolean | null;
  isRepost: boolean | null;
  daysOpen: number | null;
  engagementSignals: string[];
  employerResponseTime: string | null;
  userClickedApply: boolean;
  workArrangement: string | null;
  employmentType: string | null;
  listingHeuristic: number | null;
  descriptionHash: string | null;
}

export interface ParsedApplyTrack {
  mode: 'apply';
  platform: Platform;
  platformJobId: string;
  engagementSignals: string[];
  employerResponseTime: string | null;
  workArrangement: string | null;
  employmentType: string | null;
}

export type ParsedTrack = ParsedListingTrack | ParsedApplyTrack;

function parsePlatform(value: unknown): Parsed<Platform> {
  if (typeof value !== 'string' || !PLATFORMS.has(value)) return fail('Invalid platform');
  return { ok: true, value: value as Platform };
}

function parseJobId(platform: Platform, value: unknown): Parsed<string> {
  if (typeof value !== 'string') return fail('platformJobId must be a string');
  const trimmed = value.trim();
  if (!isValidPlatformJobId(platform, trimmed)) return fail('Invalid platformJobId');
  return { ok: true, value: platform === 'indeed' ? trimmed.toLowerCase() : trimmed };
}

function parseSignals(value: unknown): Parsed<string[]> {
  if (value == null) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > 10) return fail('Invalid engagementSignals');
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !SIGNAL_TOKEN.test(item)) return fail('Invalid engagementSignals');
    out.push(item);
  }
  return { ok: true, value: out };
}

function parseDaysOpen(value: unknown): Parsed<number | null> {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 3650) {
    return fail('Invalid daysOpen');
  }
  return { ok: true, value };
}

function parseHeuristic(value: unknown): Parsed<number | null> {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('Invalid listingHeuristic');
  const clamped = Math.max(0, Math.min(100, Math.round(value * 10) / 10));
  return { ok: true, value: clamped };
}

function parseDescriptionHash(value: unknown): Parsed<string | null> {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !DESCRIPTION_HASH.test(value.trim())) {
    return fail('Invalid descriptionHash');
  }
  return { ok: true, value: value.trim().toLowerCase() };
}

/**
 * Validate a /api/track body. Returns 400-shaped errors instead of letting
 * a number or array reach String methods or Date(NaN).
 */
export function parseTrackBody(body: unknown): Parsed<ParsedTrack> {
  if (!isRecord(body)) return fail('Invalid JSON body');

  const platform = parsePlatform(body.platform);
  if (!platform.ok) return platform;
  const platformJobId = parseJobId(platform.value, body.platformJobId);
  if (!platformJobId.ok) return platformJobId;
  const engagementSignals = parseSignals(body.engagementSignals);
  if (!engagementSignals.ok) return engagementSignals;
  const employerResponseTime = optionalString(body.employerResponseTime, 'employerResponseTime', 80);
  if (!employerResponseTime.ok) return employerResponseTime;
  const workArrangement = optionalEnum(body.workArrangement, 'workArrangement', WORK_ARRANGEMENTS);
  if (!workArrangement.ok) return workArrangement;
  const employmentType = optionalEnum(body.employmentType, 'employmentType', EMPLOYMENT_TYPES);
  if (!employmentType.ok) return employmentType;

  const applyFlag = body.userClickedApply;
  if (applyFlag != null && typeof applyFlag !== 'boolean') return fail('userClickedApply must be a boolean');
  const userClickedApply = applyFlag === true;

  const companyMissing = body.companyName == null || body.companyName === '';
  const titleMissing = body.jobTitle == null || body.jobTitle === '';
  if (userClickedApply && (companyMissing || titleMissing)) {
    return {
      ok: true,
      value: {
        mode: 'apply',
        platform: platform.value,
        platformJobId: platformJobId.value,
        engagementSignals: engagementSignals.value,
        employerResponseTime: employerResponseTime.value,
        workArrangement: workArrangement.value,
        employmentType: employmentType.value,
      },
    };
  }

  const companyName = requiredString(body.companyName, 'companyName', 200);
  if (!companyName.ok) return companyName;
  const jobTitle = requiredString(body.jobTitle, 'jobTitle', 300);
  if (!jobTitle.ok) return jobTitle;
  const location = optionalString(body.location, 'location', 200);
  if (!location.ok) return location;
  const salaryListed = optionalBoolean(body.salaryListed, 'salaryListed');
  if (!salaryListed.ok) return salaryListed;
  const isRepost = optionalBoolean(body.isRepost, 'isRepost');
  if (!isRepost.ok) return isRepost;
  const daysOpen = parseDaysOpen(body.daysOpen);
  if (!daysOpen.ok) return daysOpen;
  const listingHeuristic = parseHeuristic(body.listingHeuristic);
  if (!listingHeuristic.ok) return listingHeuristic;
  const descriptionHash = parseDescriptionHash(body.descriptionHash);
  if (!descriptionHash.ok) return descriptionHash;

  return {
    ok: true,
    value: {
      mode: 'listing',
      companyName: companyName.value,
      jobTitle: jobTitle.value,
      platform: platform.value,
      platformJobId: platformJobId.value,
      location: location.value,
      salaryListed: salaryListed.value,
      isRepost: isRepost.value,
      daysOpen: daysOpen.value,
      engagementSignals: engagementSignals.value,
      employerResponseTime: employerResponseTime.value,
      userClickedApply,
      workArrangement: workArrangement.value,
      employmentType: employmentType.value,
      listingHeuristic: listingHeuristic.value,
      descriptionHash: descriptionHash.value,
    },
  };
}

export interface ParsedReport {
  reportType: 'ghost_flag' | 'outcome';
  companyName: string;
  jobTitle: string;
  platform: Platform;
  platformJobId: string;
  anonymousUserHash: string;
  flagReasons: string[];
  outcome: string | null;
}

export function parseReportBody(body: unknown): Parsed<ParsedReport> {
  if (!isRecord(body)) return fail('Invalid JSON body');

  if (body.reportType !== 'ghost_flag' && body.reportType !== 'outcome') {
    return fail('Invalid reportType');
  }
  const companyName = requiredString(body.companyName, 'companyName', 200);
  if (!companyName.ok) return companyName;
  const jobTitle = requiredString(body.jobTitle, 'jobTitle', 300);
  if (!jobTitle.ok) return jobTitle;
  const platform = parsePlatform(body.platform);
  if (!platform.ok) return platform;
  const platformJobId = parseJobId(platform.value, body.platformJobId);
  if (!platformJobId.ok) return platformJobId;
  const anonymousUserHash = requiredString(body.anonymousUserHash, 'anonymousUserHash', 80);
  if (!anonymousUserHash.ok) return anonymousUserHash;
  if (!ANONYMOUS_HASH.test(anonymousUserHash.value)) return fail('Invalid anonymousUserHash');

  let flagReasons: string[] = [];
  let outcome: string | null = null;
  if (body.reportType === 'ghost_flag') {
    if (!Array.isArray(body.flagReasons) || body.flagReasons.length < 1 || body.flagReasons.length > 10) {
      return fail('Invalid flagReasons');
    }
    for (const reason of body.flagReasons) {
      if (typeof reason !== 'string' || !FLAG_REASONS.has(reason)) return fail('Invalid flagReasons');
      flagReasons.push(reason);
    }
  } else {
    if (typeof body.outcome !== 'string' || !OUTCOMES.has(body.outcome)) return fail('Invalid outcome');
    outcome = body.outcome;
  }

  return {
    ok: true,
    value: {
      reportType: body.reportType,
      companyName: companyName.value,
      jobTitle: jobTitle.value,
      platform: platform.value,
      platformJobId: platformJobId.value,
      anonymousUserHash: anonymousUserHash.value.toLowerCase(),
      flagReasons,
      outcome,
    },
  };
}
