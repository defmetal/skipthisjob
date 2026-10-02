-- Migration: api_integrity
--
-- OWNER: apply this by hand in the Supabase SQL editor for project
-- mnlflfthvusvcgkxrzpr. Do not run it from CI or from the app.
-- The API works before this file is applied:
--   * POST /api/track calls increment_listings_tracked and, if the function
--     is missing, falls back to a read-modify-write of total_listings_tracked.
--   * POST /api/report checks for an existing (anonymous_user_hash, listing_id)
--     row and inserts (so 23505 becomes a 409). The partial unique index
--     below only matters for legacy rows with listing_id IS NULL.
--   * Leaderboard eligibility uses employers.created_at and community_reports,
--     which already exist. It does not require the new indexes.
--   * ENABLE ROW LEVEL SECURITY is defense in depth. Migration 0005 already
--     REVOKEd anon/authenticated. Service role (the API) bypasses RLS.
--
-- If CREATE UNIQUE INDEX fails, duplicate (anonymous_user_hash, employer_id)
-- rows with a null listing_id already exist. Delete the extras, then re-run
-- that statement. Contains-search was removed from the score API, so this
-- migration does not add a pg_trgm index.

ALTER TABLE public.employers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repost_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_score_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.high_turnover_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.high_turnover_industries ENABLE ROW LEVEL SECURITY;

-- listing_signals was enabled in 0004. Repeat is harmless.
ALTER TABLE public.listing_signals ENABLE ROW LEVEL SECURITY;

-- Redundant beside UNIQUE (name_normalized) / uq_employer_normalized.
DROP INDEX IF EXISTS public.idx_employers_normalized;

-- Leaderboard candidate filter is an OR of these two columns.
CREATE INDEX IF NOT EXISTS idx_employers_listings_tracked
    ON public.employers (total_listings_tracked);
CREATE INDEX IF NOT EXISTS idx_employers_total_reports
    ON public.employers (total_reports);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_user_employer_no_listing
    ON public.community_reports (anonymous_user_hash, employer_id)
    WHERE listing_id IS NULL;

CREATE OR REPLACE FUNCTION public.increment_listings_tracked(target_employer_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    next_count INTEGER;
BEGIN
    UPDATE public.employers
    SET total_listings_tracked = COALESCE(total_listings_tracked, 0) + 1
    WHERE id = target_employer_id
    RETURNING total_listings_tracked INTO next_count;
    RETURN next_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_listings_tracked(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_listings_tracked(UUID) TO service_role;
