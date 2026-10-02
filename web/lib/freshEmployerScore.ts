import { ghostLabelForScore } from './ghostLabel.js';

export type FreshReportRow = {
  report_type?: string | null;
  outcome?: string | null;
};

export type FreshRepostRow = {
  occurrence_count?: number | null;
  descriptions_identical?: boolean | null;
  updated_at?: string | null;
};

export type FreshScoreResult = {
  score: number;
  signals: string[];
  hasFreshData: boolean;
};

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Repost rows that are real repeats (seen at least twice) and were updated
 * in the last 90 days. A single tracked view inserts nothing anymore, and
 * any legacy occurrence_count of 1 does not count as live evidence.
 */
export function liveReposts(reposts: FreshRepostRow[] | null | undefined, now = Date.now()): FreshRepostRow[] {
  const cutoff = now - NINETY_DAYS_MS;
  return (reposts || []).filter((row) => {
    const count = Number(row.occurrence_count) || 0;
    if (count < 2) return false;
    if (!row.updated_at) return false;
    const updated = Date.parse(row.updated_at);
    return Number.isFinite(updated) && updated >= cutoff;
  });
}

export function computeFreshEmployerScore(input: {
  storedScore: number | null;
  reports: FreshReportRow[] | null | undefined;
  reposts: FreshRepostRow[] | null | undefined;
  now?: number;
}): FreshScoreResult {
  const now = input.now ?? Date.now();
  const reports = input.reports || [];
  let liveScore = input.storedScore ?? 40;
  const liveSignals: string[] = [];

  const totalReports = reports.length;
  if (totalReports >= 3) {
    const noResponse = reports.filter(
      (r) => r.outcome === 'no_response' || r.report_type === 'ghost_flag'
    ).length;
    const noResponseRate = noResponse / totalReports;
    if (noResponseRate >= 0.75) {
      liveScore = Math.max(liveScore, 68);
      liveSignals.push(`${Math.round(noResponseRate * 100)}% of recent applicants got no response`);
    } else if (noResponseRate >= 0.55) {
      liveScore = Math.max(liveScore, 52);
      liveSignals.push(`${Math.round(noResponseRate * 100)}% recent no-response rate`);
    }
    if (totalReports >= 8) {
      liveSignals.push(`${totalReports} recent community reports`);
    }
  }

  const repeated = liveReposts(input.reposts, now);
  if (repeated.length > 0) {
    const maxRepost = Math.max(0, ...repeated.map((r) => Number(r.occurrence_count) || 0));
    const hasIdentical = repeated.some((r) => r.descriptions_identical);
    if (maxRepost >= 6) {
      liveScore = Math.max(liveScore, 75);
      liveSignals.push(`Same role reposted ${maxRepost}x recently`);
    } else if (maxRepost >= 4) {
      liveScore = Math.max(liveScore, 62);
      liveSignals.push(`Role reposted ${maxRepost}x in recent months`);
    }
    if (hasIdentical && maxRepost >= 3) {
      liveScore += 6;
      liveSignals.push('Identical description across reposts');
    }
  }

  const hasFreshData = totalReports >= 2 || repeated.length > 0;
  let finalLive = liveScore;
  if (hasFreshData) {
    const stored = input.storedScore ?? 45;
    finalLive = Math.round(stored * 0.45 + liveScore * 0.55);
  }

  return {
    score: Math.min(100, Math.max(0, Math.round(finalLive))),
    signals: liveSignals,
    hasFreshData,
  };
}

type ScoreEmployer = {
  ghost_score?: number | null;
  ghost_label?: string | null;
  total_reports?: number | null;
  total_listings_tracked?: number | null;
  glassdoor_rating?: number | null;
  glassdoor_offer_rate?: number | null;
  glassdoor_positive_rate?: number | null;
  glassdoor_url?: string | null;
};

/**
 * JSON body of GET /api/employer/score. `live` is true only when
 * computeFreshEmployerScore saw at least two recent reports or a repost
 * pattern with occurrence_count >= 2.
 */
export function scoreResponseForEvidence(
  employer: ScoreEmployer,
  reports: FreshReportRow[] | null | undefined,
  reposts: FreshRepostRow[] | null | undefined,
  listingReports = 0,
  now = Date.now()
) {
  const fresh = computeFreshEmployerScore({
    storedScore: employer.ghost_score ?? null,
    reports,
    reposts,
    now,
  });
  return buildEmployerScoreBody(employer, fresh, listingReports);
}

export function buildEmployerScoreBody(
  employer: ScoreEmployer,
  fresh: FreshScoreResult | null | undefined,
  listingReports = 0
) {
  const signals: string[] = [];
  let finalScore = employer.ghost_score ?? 40;

  if (fresh && fresh.hasFreshData && fresh.score != null) {
    finalScore = fresh.score;
    signals.push(...fresh.signals);
  } else if ((employer.total_reports || 0) >= 10) {
    signals.push(`${employer.total_reports} community ghost reports`);
  }

  if (listingReports > 0) {
    signals.unshift(
      `${listingReports} community report${listingReports === 1 ? '' : 's'} on this listing`
    );
  }

  if (employer.glassdoor_rating && employer.glassdoor_rating < 3.0) {
    signals.push(`Glassdoor rating: ${employer.glassdoor_rating}/5`);
  }
  if (employer.glassdoor_offer_rate && employer.glassdoor_offer_rate < 0.2) {
    signals.push(
      `Only ${Math.round(employer.glassdoor_offer_rate * 100)}% of Glassdoor interviewees got offers`
    );
  }

  let glassdoor = null;
  if (employer.glassdoor_rating != null) {
    glassdoor = {
      rating: employer.glassdoor_rating,
      offerRate: employer.glassdoor_offer_rate,
      positiveRate: employer.glassdoor_positive_rate,
      url: employer.glassdoor_url,
    };
  }

  return {
    score: finalScore,
    label: ghostLabelForScore(finalScore),
    signals: Array.from(new Set(signals)),
    totalReports: employer.total_reports,
    listingReports,
    totalListings: employer.total_listings_tracked,
    glassdoor,
    found: true,
    live: !!(fresh && fresh.hasFreshData),
  };
}
