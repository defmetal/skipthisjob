-- Migration: lock_down_public_table_access
-- Applied on Supabase project mnlflfthvusvcgkxrzpr (2026-09-12)
-- Removes misleading "Service role full access" policies (USING true for public)
-- and revokes anon/authenticated privileges. API uses service_role (supabaseAdmin).

DROP POLICY IF EXISTS "Service role full access" ON public.community_reports;
DROP POLICY IF EXISTS "Service role full access" ON public.employer_score_log;
DROP POLICY IF EXISTS "Service role full access" ON public.employers;
DROP POLICY IF EXISTS "Service role full access" ON public.high_turnover_industries;
DROP POLICY IF EXISTS "Service role full access" ON public.high_turnover_roles;
DROP POLICY IF EXISTS "Service role full access" ON public.listings;
DROP POLICY IF EXISTS "Service role full access" ON public.repost_patterns;

REVOKE ALL ON TABLE public.community_reports FROM anon, authenticated;
REVOKE ALL ON TABLE public.employer_score_log FROM anon, authenticated;
REVOKE ALL ON TABLE public.employers FROM anon, authenticated;
REVOKE ALL ON TABLE public.high_turnover_industries FROM anon, authenticated;
REVOKE ALL ON TABLE public.high_turnover_roles FROM anon, authenticated;
REVOKE ALL ON TABLE public.listing_signals FROM anon, authenticated;
REVOKE ALL ON TABLE public.listings FROM anon, authenticated;
REVOKE ALL ON TABLE public.repost_patterns FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_employer_quick_lookup FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_ghost_leaderboard FROM anon, authenticated;
