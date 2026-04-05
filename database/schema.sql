-- ============================================================
-- Ghost Job Detector - Supabase Database Schema
-- ============================================================

-- ============================================================
-- EMPLOYERS
-- Normalized employer records with Glassdoor enrichment
-- ============================================================
CREATE TABLE employers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_raw        TEXT NOT NULL,              -- original scraped name
    name_normalized TEXT NOT NULL,              -- cleaned/lowered for matching
    glassdoor_id    TEXT,                       -- matched Glassdoor employer ID
    glassdoor_url   TEXT,
    glassdoor_rating        NUMERIC(2,1),       -- overall rating 1.0-5.0
    glassdoor_review_count  INTEGER DEFAULT 0,
    glassdoor_interview_count INTEGER DEFAULT 0,
    glassdoor_offer_rate    NUMERIC(4,3),       -- % of interviews resulting in offer
    glassdoor_positive_rate NUMERIC(4,3),       -- % positive interview experiences
    company_size    TEXT,                       -- e.g. '1001-5000', '10001+'
    industry        TEXT,
    website_domain  TEXT,                       -- for domain-based matching
    ghost_score     NUMERIC(4,1) DEFAULT 0,    -- computed 0-100
    ghost_label     TEXT DEFAULT 'unknown',     -- low / moderate / high / very_high / unknown
    total_reports   INTEGER DEFAULT 0,
    total_listings_tracked INTEGER DEFAULT 0,
    is_high_turnover_industry BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_employer_normalized UNIQUE (name_normalized)
);

CREATE INDEX idx_employers_normalized ON employers (name_normalized);
CREATE INDEX idx_employers_domain ON employers (website_domain);
CREATE INDEX idx_employers_ghost_score ON employers (ghost_score DESC);
CREATE INDEX idx_employers_glassdoor_id ON employers (glassdoor_id);

-- ============================================================
-- LISTINGS
-- Individual job listing snapshots observed by users or seeded
-- ============================================================
CREATE TABLE listings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_id     UUID NOT NULL REFERENCES employers(id),
    platform        TEXT NOT NULL,              -- 'linkedin', 'indeed', 'glassdoor'
    platform_job_id TEXT,                       -- platform-specific ID if extractable
    title_raw       TEXT NOT NULL,
    title_normalized TEXT NOT NULL,             -- lowered, stripped of seniority noise
    location_raw    TEXT,
    location_city   TEXT,
    location_state  TEXT,
    location_country TEXT DEFAULT 'US',
    description_hash TEXT,                     -- SHA-256 of cleaned description for similarity
    salary_listed   BOOLEAN DEFAULT FALSE,
    salary_min      INTEGER,
    salary_max      INTEGER,
    hiring_contact_visible BOOLEAN,            -- is a recruiter/HM shown?
    is_repost       BOOLEAN DEFAULT FALSE,     -- platform labeled "Reposted"
    applicant_count_estimate INTEGER,          -- parsed from DOM ("200+" → 200)
    posted_date     DATE,
    first_seen_at   TIMESTAMPTZ DEFAULT NOW(), -- when our system first saw it
    last_seen_at    TIMESTAMPTZ DEFAULT NOW(), -- most recent observation
    is_active       BOOLEAN DEFAULT TRUE,
    source          TEXT DEFAULT 'extension',  -- 'extension', 'seed_kaggle', 'seed_theirstack'
    seniority_level TEXT,                      -- 'entry', 'mid', 'senior', 'director', 'vp', 'c_suite'

    CONSTRAINT uq_listing_platform UNIQUE (platform, platform_job_id)
);

CREATE INDEX idx_listings_employer ON listings (employer_id);
CREATE INDEX idx_listings_title_loc ON listings (employer_id, title_normalized, location_city);
CREATE INDEX idx_listings_posted ON listings (posted_date DESC);
CREATE INDEX idx_listings_desc_hash ON listings (description_hash);

-- ============================================================
-- REPOST_PATTERNS
-- Precomputed: how many times has this employer posted this
-- same role in the same location?
-- ============================================================
CREATE TABLE repost_patterns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_id     UUID NOT NULL REFERENCES employers(id),
    title_normalized TEXT NOT NULL,
    location_city   TEXT,
    location_state  TEXT,
    occurrence_count INTEGER DEFAULT 1,
    first_posted    DATE,
    last_posted     DATE,
    avg_days_open   NUMERIC(6,1),
    descriptions_identical BOOLEAN DEFAULT FALSE, -- all description_hashes match
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_repost_pattern UNIQUE (employer_id, title_normalized, location_city)
);

CREATE INDEX idx_repost_employer ON repost_patterns (employer_id);
CREATE INDEX idx_repost_count ON repost_patterns (occurrence_count DESC);

-- ============================================================
-- COMMUNITY_REPORTS
-- User-submitted thumbs-down / outcome reports
-- ============================================================
CREATE TABLE community_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id      UUID REFERENCES listings(id),
    employer_id     UUID NOT NULL REFERENCES employers(id),
    anonymous_user_hash TEXT NOT NULL,          -- browser-generated, not PII
    report_type     TEXT NOT NULL,              -- 'ghost_flag', 'outcome'
    
    -- ghost_flag fields
    flag_reasons    TEXT[],                     -- ['no_response', 'reposted', 'vague_description', 'suspected_evergreen']
    
    -- outcome fields (if report_type = 'outcome')
    outcome         TEXT,                       -- 'no_response', 'rejected', 'interviewed', 'offered', 'hired'
    days_to_response INTEGER,                  -- how many days until they heard back (NULL = never)
    
    platform        TEXT,                       -- where they saw the listing
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    -- one report per user per listing
    CONSTRAINT uq_report_user_listing UNIQUE (anonymous_user_hash, listing_id)
);

CREATE INDEX idx_reports_employer ON community_reports (employer_id);
CREATE INDEX idx_reports_listing ON community_reports (listing_id);
CREATE INDEX idx_reports_type ON community_reports (report_type);

-- ============================================================
-- HIGH TURNOVER ROLE PATTERNS
-- Known role titles that are legitimately evergreen
-- Used to reduce ghost scores for expected high-churn roles
-- ============================================================
CREATE TABLE high_turnover_roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_pattern   TEXT NOT NULL,             -- regex or keyword pattern
    industry        TEXT,                      -- optional: only in this industry
    reason          TEXT                       -- 'retail_hourly', 'food_service', 'healthcare_bedside', 'logistics'
);

-- Seed common high-turnover patterns
INSERT INTO high_turnover_roles (title_pattern, reason) VALUES
    ('barista', 'food_service'),
    ('crew member', 'food_service'),
    ('team member', 'food_service'),
    ('cashier', 'retail_hourly'),
    ('sales associate', 'retail_hourly'),
    ('retail associate', 'retail_hourly'),
    ('store associate', 'retail_hourly'),
    ('warehouse associate', 'logistics'),
    ('delivery driver', 'logistics'),
    ('package handler', 'logistics'),
    ('registered nurse', 'healthcare_bedside'),
    ('licensed practical nurse', 'healthcare_bedside'),
    ('certified nursing assistant', 'healthcare_bedside'),
    ('cna', 'healthcare_bedside'),
    ('home health aide', 'healthcare_bedside'),
    ('caregiver', 'healthcare_bedside'),
    ('security officer', 'security'),
    ('security guard', 'security'),
    ('janitor', 'facilities'),
    ('custodian', 'facilities'),
    ('housekeeper', 'hospitality'),
    ('front desk', 'hospitality'),
    ('dishwasher', 'food_service'),
    ('line cook', 'food_service'),
    ('server', 'food_service'),
    ('host', 'food_service'),
    ('bartender', 'food_service'),
    ('call center', 'call_center'),
    ('customer service representative', 'call_center'),
    ('cdl driver', 'logistics'),
    ('truck driver', 'logistics'),
    ('forklift operator', 'logistics'),
    ('picker', 'logistics'),
    ('packer', 'logistics'),
    ('stocker', 'retail_hourly'),
    ('merchandiser', 'retail_hourly'),
    ('phlebotomist', 'healthcare_bedside'),
    ('medical assistant', 'healthcare_bedside'),
    ('dental hygienist', 'healthcare_bedside'),
    ('substitute teacher', 'education');

-- ============================================================
-- HIGH TURNOVER INDUSTRIES
-- ============================================================
CREATE TABLE high_turnover_industries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    industry    TEXT NOT NULL UNIQUE,
    modifier    NUMERIC(3,2) DEFAULT 0.5       -- multiplier to reduce ghost score (0.0-1.0)
);

INSERT INTO high_turnover_industries (industry, modifier) VALUES
    ('Restaurants & Food Service', 0.40),
    ('Retail & Wholesale', 0.50),
    ('Staffing & Outsourcing', 0.45),
    ('Hotels & Travel Accommodation', 0.45),
    ('Healthcare', 0.55),
    ('Transportation & Logistics', 0.50),
    ('Security & Protective Services', 0.50),
    ('Fast Food & Quick Service', 0.35),
    ('Grocery', 0.45),
    ('Call Center / Customer Service', 0.50);

-- ============================================================
-- EMPLOYER_SCORE_LOG
-- Audit trail of score changes over time
-- ============================================================
CREATE TABLE employer_score_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_id     UUID NOT NULL REFERENCES employers(id),
    previous_score  NUMERIC(4,1),
    new_score       NUMERIC(4,1),
    trigger_reason  TEXT,                       -- 'new_report', 'new_listing', 'scheduled_recompute', 'seed'
    computed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_score_log_employer ON employer_score_log (employer_id, computed_at DESC);

-- ============================================================
-- VIEWS
-- ============================================================

-- Employer leaderboard for the website (worst offenders)
CREATE VIEW v_ghost_leaderboard AS
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

-- Quick lookup for the extension
CREATE VIEW v_employer_quick_lookup AS
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

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_employers_updated
    BEFORE UPDATE ON employers
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER trg_repost_patterns_updated
    BEFORE UPDATE ON repost_patterns
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();
