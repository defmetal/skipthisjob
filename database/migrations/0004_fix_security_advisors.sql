-- Migration: fix_security_advisors_rls_views_search_path
-- Applied on Supabase project mnlflfthvusvcgkxrzpr (2026-09-12)
-- Clears ERROR advisors: RLS on listing_signals, SECURITY DEFINER views,
-- and mutable search_path on update_modified_column.

-- 1) Enable RLS on listing_signals (service role bypasses RLS; no public policies)
ALTER TABLE public.listing_signals ENABLE ROW LEVEL SECURITY;

-- 2) Recreate views as security_invoker so caller RLS applies
DROP VIEW IF EXISTS public.v_ghost_leaderboard;
CREATE VIEW public.v_ghost_leaderboard
WITH (security_invoker = true) AS
SELECT
    e.id,
    e.name_raw,
    e.industry,
    e.company_size,
    e.ghost_score,
    e.ghost_label,
    e.total_reports,
    e.total_listings_tracked,
    e.glassdoor_rating,
    e.glassdoor_offer_rate,
    COUNT(DISTINCT rp.id) FILTER (WHERE rp.occurrence_count >= 3) AS repeat_roles,
    MAX(rp.occurrence_count) AS worst_repost_count
FROM employers e
LEFT JOIN repost_patterns rp ON rp.employer_id = e.id
WHERE e.ghost_score >= 50
GROUP BY e.id
ORDER BY e.ghost_score DESC;

DROP VIEW IF EXISTS public.v_employer_quick_lookup;
CREATE VIEW public.v_employer_quick_lookup
WITH (security_invoker = true) AS
SELECT
    e.name_normalized,
    e.ghost_score,
    e.ghost_label,
    e.total_reports,
    e.glassdoor_rating,
    e.glassdoor_url,
    e.glassdoor_offer_rate,
    e.glassdoor_positive_rate,
    e.is_high_turnover_industry,
    e.company_size
FROM employers e;

-- 3) Lock search_path on updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
