-- ICP preset support for Rulebase Signal Engine
-- 2026-04-27

-- Track which ICP preset a campaign uses
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS icp_preset_slug text;

-- Suggested targeting approach (AI-generated, cached)
ALTER TABLE campaign_organizations
  ADD COLUMN IF NOT EXISTS suggested_approach text,
  ADD COLUMN IF NOT EXISTS approach_generated_at timestamptz;

-- Generated email copy per contact (for Smartlead export)
ALTER TABLE campaign_people
  ADD COLUMN IF NOT EXISTS generated_email_subject text,
  ADD COLUMN IF NOT EXISTS generated_email_body text,
  ADD COLUMN IF NOT EXISTS email_generated_at timestamptz;
