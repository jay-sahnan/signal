-- Revenue Agent (2.0) signal definitions
-- 2026-07-07 — for the Revenue Agent launch.
--
-- The existing catalogue only detects CX/QA/compliance triggers (QA job postings,
-- Trustpilot surges, CX team scaling, CFPB complaints). Those score the OLD
-- cost-side ICP. The Revenue Agent motion targets revenue gated behind multi-step
-- onboarding/activation, so it needs signals that detect a volume shock + deadline
-- on onboarding/verification, and a buyer who owns revenue.
--
-- Tiers:
--   Tier 1: Compelled — a deadline + volume shock nobody is sized for (M&A/book transfer, sponsor-bank change)
--   Tier 2: Triggered — budget + intent (new revenue-ops leader, new market/license, activation reported, manual recovery proof)
--   Tier 3: Active — process is manual and scaling linearly (onboarding/KYB hiring, open enrollment)
-- All signals return 2025-2026 results only.

INSERT INTO signals (name, slug, description, long_description, category, icon, execution_type, tool_key, config, is_builtin)
VALUES
-- Tier 1: Compelled buyer
(
  'M&A / Book-of-Business Transfer',
  'ma-book-of-business-transfer',
  'Company acquired a book of business, portfolio, or account base that must be re-onboarded, re-papered, or re-verified (2025-2026).',
  'The strongest Revenue Agent signal (Vestwell-Accrue template). An acquired book of accounts creates a deadline and a volume shock the onboarding/implementation team was never sized for — every acquired account must be re-onboarded before it generates revenue. Route to Implementation/Onboarding, never compliance.',
  'funding',
  'Zap',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (acquired OR acquisition OR \"book of business\" OR portfolio transfer OR \"migrating accounts\" OR re-onboard OR \"absorbed accounts\" OR \"customer book\") 2025 OR 2026", "numResults": 5, "daysBack": 180, "tier": 1, "scoreBoost": 5}'::jsonb,
  true
),
(
  'Sponsor Bank / BaaS Partner Change',
  'sponsor-bank-baas-change',
  'Fintech switching sponsor banks or affected by a BaaS partner exit/consent order, forcing mass re-KYC and re-onboarding (2025-2026).',
  'When a fintech changes sponsor banks (or a BaaS program winds down / the bank takes a consent order), the entire customer base gets re-KYC''d and re-onboarded under the new program. Forces mass re-onboarding on a deadline downstream.',
  'custom',
  'Globe',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (sponsor bank OR BaaS OR \"banking partner\" OR \"banking-as-a-service\") (change OR switch OR exit OR \"wind down\" OR \"wind-down\" OR consent order OR migrate) 2025 OR 2026", "numResults": 5, "daysBack": 180, "tier": 1, "scoreBoost": 4}'::jsonb,
  true
),
-- Tier 2: Triggered buyer
(
  'New Revenue-Ops Leader Hired',
  'new-revenue-ops-leader',
  'New COO, CRO, Chief Customer Officer, or Head/VP of Onboarding/Implementation/Activation in last 90 days.',
  'A new revenue-ops leader has a 90-day window to show impact and re-evaluates how onboarding/activation is run. This is the revenue-side equivalent of the old new-leader signal — targets the buyer who owns revenue, not cost.',
  'executive',
  'UserCog',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (hired OR appointed OR named OR joins) (COO OR \"Chief Operating Officer\" OR CRO OR \"Chief Revenue Officer\" OR \"Chief Customer Officer\" OR \"Head of Onboarding\" OR \"Head of Implementation\" OR \"VP Operations\" OR \"Head of Activation\") 2025 OR 2026", "numResults": 5, "daysBack": 90, "tier": 2, "scoreBoost": 4}'::jsonb,
  true
),
(
  'New Market / License Approval',
  'new-market-license',
  'Payments/banking license approval or launch in a new country — a new compliance regime and onboarding flow built from scratch (2025-2026).',
  'A new license or market entry means a new onboarding flow and per-market compliance parameters (Paystack four-market template). Onboarding logic forks and stalls multiply — the multi-market complexity is exactly the depth generic agent platforms will not do.',
  'product',
  'Rocket',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (license OR licence OR approved OR \"granted approval\" OR \"launches in\" OR \"expands to\" OR \"new market\" OR \"goes live in\") (payments OR banking OR EMI OR \"money transmitter\" OR remittance) 2025 OR 2026", "numResults": 5, "daysBack": 180, "tier": 2, "scoreBoost": 3}'::jsonb,
  true
),
(
  'Activation Metric Reported',
  'activation-metric-reported',
  'Company cites activation rate, time-to-revenue, merchant ramp, or funded-account growth in earnings/investor updates (2025-2026).',
  'If the activation metric is reported upward, budget sits with the economic buyer, not a tooling line item. Confirms the account measures revenue-gated onboarding at the board level — anchor pricing against the number they report.',
  'custom',
  'TrendingUp',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (\"activation rate\" OR \"time to revenue\" OR \"time-to-revenue\" OR \"merchant ramp\" OR \"funded accounts\" OR \"onboarding conversion\" OR \"time to first\") (earnings OR investor OR report OR quarter) 2025 OR 2026", "numResults": 5, "daysBack": 180, "tier": 2, "scoreBoost": 3}'::jsonb,
  true
),
(
  'Manual Revenue Recovery Proof',
  'manual-revenue-recovery',
  'Evidence the company ran a manual re-engagement/reactivation of stalled or dormant accounts and recovered revenue (2025-2026).',
  'The best possible signal (Flutterwave template — one email recovered ~$1M TPV): proof the money exists AND proof nobody owns collecting it. Quantify what continuous coverage would return and anchor pricing against it.',
  'funding',
  'Star',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (re-engagement OR reactivation OR \"dormant accounts\" OR \"stalled onboarding\" OR \"reactivated merchants\" OR \"recovered revenue\" OR \"win-back\") 2025 OR 2026", "numResults": 5, "daysBack": 180, "tier": 2, "scoreBoost": 4}'::jsonb,
  true
),
-- Tier 3: Active buyer
(
  'Onboarding / KYB Hiring',
  'onboarding-kyb-hiring',
  'Active job postings for Onboarding Specialists, Implementation Managers, KYC/KYB Analysts, or Merchant Underwriting roles.',
  'Hiring humans to chase cases means the onboarding process is manual and scaling linearly with volume. A burst of these postings after a funding round is the strongest version of this signal.',
  'hiring',
  'Briefcase',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (hiring OR \"job posting\" OR careers) (\"Onboarding Specialist\" OR \"Implementation Manager\" OR \"KYB Analyst\" OR \"KYC Analyst\" OR \"Merchant Underwriting\" OR \"Activation Analyst\" OR \"Merchant Onboarding\") 2025 OR 2026", "numResults": 5, "daysBack": 30, "tier": 3, "scoreBoost": 2, "minHits": 2}'::jsonb,
  true
),
(
  'Open Enrollment / Seasonal Volume Window',
  'open-enrollment-window',
  'Benefits/HSA-FSA/retirement platform approaching an open-enrollment or annual-enrollment window (2025-2026).',
  'Benefits administrators absorb massive enrollment volume in a fixed annual window (WEX/HealthEquity profile). Accounts do not fund until enrollment completes — approach 3-4 months before the season.',
  'product',
  'MessageCircle',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (\"open enrollment\" OR \"annual enrollment\" OR \"enrollment season\" OR \"benefits enrollment\" OR \"plan year\") 2025 OR 2026", "numResults": 5, "daysBack": 120, "tier": 3, "scoreBoost": 1}'::jsonb,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  long_description = EXCLUDED.long_description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  config = EXCLUDED.config;
