-- ============================================================================
-- Migration: 0003_add_listing_heuristic_score
-- Version: 0.1.9
-- Description:
--   Adds listings.heuristic_score — the extension's PRE-blend listing
--   heuristic (0-100, scoreLocally().score) submitted via /api/track.
--
--   The extension's smart scoring previously lived only client-side and was
--   never persisted, so employers.ghost_score (and the public leaderboard)
--   stayed frozen at Kaggle-seed values. Storing the per-listing heuristic
--   lets the server aggregate a real employer ghost_score from what users
--   actually see, without re-implementing (and drifting from) the scoring
--   logic. PRE-blend is stored deliberately: the blended score depends on
--   employers.ghost_score, so aggregating it would create a feedback loop.
-- ============================================================================

ALTER TABLE listings
ADD COLUMN IF NOT EXISTS heuristic_score NUMERIC(4,1);

COMMENT ON COLUMN listings.heuristic_score IS
    'Extension pre-blend listing heuristic 0-100 (scoreLocally().score). '
    'Aggregated by recomputeEmployerScore() into employers.ghost_score.';

CREATE INDEX IF NOT EXISTS idx_listings_employer_heuristic
    ON listings (employer_id, heuristic_score)
    WHERE heuristic_score IS NOT NULL;
