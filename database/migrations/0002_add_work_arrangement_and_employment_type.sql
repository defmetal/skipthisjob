-- ============================================================================
-- Migration: 0002_add_work_arrangement_and_employment_type
-- Version: 0.1.8
-- Description: 
--   Adds two new columns to listing_signals for additional passive signals:
--   - work_arrangement (remote, hybrid, onsite)
--   - employment_type (full_time, part_time, contract, internship, etc.)
-- ============================================================================

ALTER TABLE listing_signals
ADD COLUMN IF NOT EXISTS work_arrangement TEXT,
ADD COLUMN IF NOT EXISTS employment_type TEXT;

COMMENT ON COLUMN listing_signals.work_arrangement IS 
    'Work arrangement shown on the job (remote, hybrid, onsite)';

COMMENT ON COLUMN listing_signals.employment_type IS 
    'Employment type shown on the job (full_time, part_time, contract, internship, etc.)';
