import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Recompute and persist an employer's aggregate ghost_score from real data.
 *
 * Why this exists: the extension's smart per-listing scoring used to live
 * only client-side and was never stored, so employers.ghost_score (and the
 * public leaderboard) stayed frozen at Kaggle-seed values. Extensions now
 * submit their PRE-blend listing heuristic (listings.heuristic_score); this
 * aggregates those plus community-report / repost signals into one employer
 * score, mirroring the extension's blend philosophy: the listing heuristic
 * is the base, and reports/reposts can only push the score UP (max()), never
 * suppress it — the same asymmetry as the client-side blendGhostScore().
 *
 * PRE-blend is deliberate: the blended client score depends on
 * employers.ghost_score, so aggregating it would create a feedback loop.
 */

type Trigger = 'new_listing' | 'new_report' | 'scheduled_recompute';

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function labelFor(score: number): string {
  if (score >= 75) return 'very_high';
  if (score >= 50) return 'high';
  if (score >= 25) return 'moderate';
  return 'low';
}

export async function recomputeEmployerScore(
  db: SupabaseClient,
  employerId: string,
  trigger: Trigger
): Promise<{ score: number; label: string } | null> {
  // 1. Base = median of this employer's recent active listing heuristics.
  //    Median (not mean) so one outlier listing can't swing the employer.
  const { data: rows } = await db
    .from('listings')
    .select('heuristic_score')
    .eq('employer_id', employerId)
    .eq('is_active', true)
    .not('heuristic_score', 'is', null)
    .order('last_seen_at', { ascending: false })
    .limit(50);

  const heuristics = (rows || [])
    .map((r: { heuristic_score: number | string | null }) => Number(r.heuristic_score))
    .filter((n: number) => Number.isFinite(n));
  const base = median(heuristics);

  // 2. Community reports (last 90d) + repost patterns — can only raise.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: reports } = await db
    .from('community_reports')
    .select('report_type, outcome, created_at')
    .eq('employer_id', employerId)
    .gte('created_at', ninetyDaysAgo);
  const { data: reposts } = await db
    .from('repost_patterns')
    .select('occurrence_count, descriptions_identical')
    .eq('employer_id', employerId)
    .order('occurrence_count', { ascending: false })
    .limit(5);

  // No heuristic data yet (e.g. report arrived before any tracked view) →
  // neutral 40 baseline, same fallback the read-path uses.
  let score = base != null ? base : 40;

  const totalReports = reports?.length || 0;
  if (totalReports >= 3) {
    const noResponse = (reports || []).filter(
      (r: { report_type: string; outcome: string }) =>
        r.outcome === 'no_response' || r.report_type === 'ghost_flag'
    ).length;
    const rate = noResponse / totalReports;
    if (rate >= 0.75) score = Math.max(score, 68);
    else if (rate >= 0.55) score = Math.max(score, 52);
  }

  const safeReposts = reposts || [];
  if (safeReposts.length > 0) {
    const maxRepost = Math.max(
      0,
      ...safeReposts.map((r: { occurrence_count: number | null }) => r.occurrence_count || 0)
    );
    if (maxRepost >= 6) score = Math.max(score, 75);
    else if (maxRepost >= 4) score = Math.max(score, 62);
    if (
      safeReposts.some((r: { descriptions_identical: boolean | null }) => r.descriptions_identical) &&
      maxRepost >= 3
    ) {
      score += 6;
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  const label = labelFor(score);

  // 3. Persist + audit-log the change.
  const { data: prev } = await db
    .from('employers')
    .select('ghost_score')
    .eq('id', employerId)
    .single();

  await db
    .from('employers')
    .update({ ghost_score: score, ghost_label: label, updated_at: new Date().toISOString() })
    .eq('id', employerId);

  await db.from('employer_score_log').insert({
    employer_id: employerId,
    previous_score: prev?.ghost_score ?? null,
    new_score: score,
    trigger_reason: trigger,
  });

  return { score, label };
}
