-- ============================================================================
-- Migration: 0001_add_listing_signals
-- Version: 0.1.8
-- Description: 
--   Adds the listing_signals table to store passive data collected from the
--   Chrome extension. This includes apply clicks, engagement signals, 
--   employer response time, and similar roles count.
--   These signals will be used to improve ghost risk scoring in the 0.2 release.
-- ============================================================================

CREATE TABLE IF NOT EXISTS listing_signals (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Link to the existing listings table
    listing_id              UUID NOT NULL 
                            REFERENCES listings(id) 
                            ON DELETE CASCADE,
    
    -- Whether the user clicked the Apply button on this listing
    user_clicked_apply      BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Engagement signals shown on the job page
    -- Examples: 'actively_reviewing', 'hiring_multiple', 'urgently_hiring'
    engagement_signals      TEXT[] NOT NULL DEFAULT '{}',
    
    -- Normalized response time shown by the platform
    -- Examples: 'within_1_day', 'within_2_days', 'within_a_week', 'slow'
    employer_response_time  TEXT,
    
    -- Number of similar roles the same employer has open at the time of viewing
    -- (calculated on the backend)
    similar_roles_count     INTEGER,
    
    -- When this signal was recorded
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_listing_signals_listing_id 
    ON listing_signals (listing_id);

CREATE INDEX IF NOT EXISTS idx_listing_signals_created_at 
    ON listing_signals (created_at DESC);

-- Table and column comments for documentation
COMMENT ON TABLE listing_signals IS 
    'Stores passive signals collected from the Chrome extension when users view job listings. Used to improve ghost risk scoring in future versions.';

COMMENT ON COLUMN listing_signals.user_clicked_apply IS 
    'True if the user clicked the Apply button on this specific listing.';

COMMENT ON COLUMN listing_signals.engagement_signals IS 
    'Array of engagement indicators shown on the job page (e.g. actively_reviewing, urgently_hiring).';

COMMENT ON COLUMN listing_signals.employer_response_time IS 
    'Normalized response time shown by LinkedIn or Indeed (e.g. within_2_days, slow).';

COMMENT ON COLUMN listing_signals.similar_roles_count IS 
    'Number of similar roles the same employer had open when this listing was viewed.';
