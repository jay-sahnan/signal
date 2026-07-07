-- Seed the Revenue Agent campaign so the daily pipeline + briefing run for it.
-- The pipeline SKIPS a preset when no campaign exists, so this row is what
-- switches the Revenue Agent motion on.
--
-- Deliberately seeds NO companies: the campaign fills purely from event-first
-- discovery (signal-discovery.ts) on each cron run, and the brief is ordered
-- newest-first — so the list refreshes daily instead of replaying a static CSV.
-- Idempotent.

INSERT INTO campaigns (name, status, icp_preset_slug)
SELECT 'Revenue Agent Targets', 'active', 'revenue-agent'
WHERE NOT EXISTS (
  SELECT 1 FROM campaigns WHERE icp_preset_slug = 'revenue-agent'
);

-- Enable the Revenue Agent signal set on that campaign.
INSERT INTO campaign_signals (campaign_id, signal_id, enabled, config_override)
SELECT c.id, s.id, true, '{}'::jsonb
FROM campaigns c
JOIN signals s ON s.slug IN (
  'ma-book-of-business-transfer', 'sponsor-bank-baas-change',
  'new-revenue-ops-leader', 'new-market-license', 'activation-metric-reported',
  'manual-revenue-recovery', 'onboarding-kyb-hiring', 'open-enrollment-window',
  'platform-migration', 'pe-acquisition-funding'
)
WHERE c.icp_preset_slug = 'revenue-agent'
ON CONFLICT (campaign_id, signal_id) DO NOTHING;
