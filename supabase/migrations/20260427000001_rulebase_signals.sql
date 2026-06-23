-- Rulebase signal definitions — redesigned from first principles
-- 2026-04-27 (updated 2026-04-28: enforce current-year recency)
--
-- Signal tiers:
--   Tier 1: Compelled buyer (consent order, enforcement action)
--   Tier 2: Triggered buyer (new CCO hire, rising CFPB complaints, PE acquisition, Trustpilot surge)
--   Tier 3: Active buyer (compliance/QA job posting, AI deployment, UDAAP risk, CX scaling)
--
-- Every signal must answer: "Why should I call THIS company THIS week?"
-- Signals must be verifiable, timely, and differentiating.
-- ALL signals must return results from 2025-2026 only. Old cases are noise unless recently settled.

INSERT INTO signals (name, slug, description, long_description, category, icon, execution_type, tool_key, config, is_builtin)
VALUES
-- Tier 1: Compelled Buyer
(
  'Consent Order / Enforcement Action',
  'consent-order-enforcement',
  'Active or recently settled CFPB consent order, state AG settlement, or enforcement action (2025-2026 only).',
  'Companies under consent orders are compelled buyers — they must improve monitoring. This is the highest-value signal. Only matches enforcement activity from 2025 or 2026, including recently settled cases.',
  'custom',
  'Shield',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (consent order OR enforcement action OR CFPB fine OR civil money penalty OR recently settled OR settlement agreement) (2025 OR 2026)", "numResults": 5, "daysBack": 365, "tier": 1, "scoreBoost": 5}'::jsonb,
  true
),
-- Tier 2: Triggered Buyer
(
  'New Compliance / CX Leader Hired',
  'new-leader-hired',
  'New CCO, Head of CX, VP Operations, or General Counsel hired in last 90 days.',
  'A new compliance or CX leader triggers tool evaluation within 90 days. Searches for hiring/appointment announcements for specific C-suite and VP titles. Only recent announcements.',
  'hiring',
  'UserPlus',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (hired OR appointed OR named OR joins) (Chief Compliance Officer OR Head of CX OR VP Customer Experience OR VP Operations OR CCO OR General Counsel) 2025 OR 2026", "numResults": 5, "daysBack": 90, "tier": 2, "scoreBoost": 4}'::jsonb,
  true
),
(
  'Rising CFPB Complaints',
  'rising-cfpb-complaints',
  'CFPB complaint volume rising for this company in 2025-2026.',
  'Rising CFPB complaints are a leading indicator of enforcement. Only matches recent complaint trends, not historical volumes.',
  'custom',
  'TrendingUp',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" CFPB complaints (rising OR increasing OR surge OR record) 2025 OR 2026", "numResults": 5, "daysBack": 90, "tier": 2, "scoreBoost": 4}'::jsonb,
  true
),
(
  'Trustpilot / Public Review Deterioration',
  'trustpilot-review-surge',
  'Deteriorating Trustpilot scores or rising negative reviews in 2025-2026.',
  'A review surge is the earliest public indicator that complaint handling is broken. Only matches recent review trends.',
  'engagement',
  'Star',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (Trustpilot OR BBB) (complaints OR terrible service OR worst experience OR scam OR 1 star) 2025 OR 2026", "numResults": 5, "daysBack": 60, "tier": 2, "scoreBoost": 3}'::jsonb,
  true
),
(
  'PE Acquisition / Ownership Change',
  'pe-acquisition-funding',
  'Recent PE acquisition, ownership change, or major funding round in 2025-2026.',
  'PE-backed lenders face compliance growing pains post-acquisition. Only matches deals announced in 2025 or 2026.',
  'funding',
  'DollarSign',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (acquired OR private equity OR new ownership OR funding round OR raises) 2025 OR 2026", "numResults": 5, "daysBack": 180, "tier": 2, "scoreBoost": 3}'::jsonb,
  true
),
-- Tier 3: Active Buyer
(
  'Compliance / QA Job Posting',
  'compliance-qa-job-posting',
  'Active job postings for compliance monitoring, QA, complaints, or UDAAP roles.',
  'Companies hiring for compliance/QA roles signal that the current approach is not working. Only matches currently open positions.',
  'hiring',
  'Briefcase',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (hiring OR job posting OR career) (complaint OR QA Manager OR Quality Analyst OR compliance monitoring OR UDAAP OR fair lending) 2025 OR 2026", "numResults": 5, "daysBack": 30, "tier": 3, "scoreBoost": 2}'::jsonb,
  true
),
(
  'AI Agent Deployment',
  'ai-agent-adoption-cx',
  'Company deploying AI agents or chatbots for customer interactions in 2025-2026.',
  'Companies rolling out AI agents create a new QA problem: who QAs the AI? Only matches recent deployments.',
  'product',
  'Bot',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (deployed OR launched OR rolling out) (AI agent OR AI chatbot OR voice AI OR conversational AI) customer service 2025 OR 2026", "numResults": 5, "daysBack": 90, "tier": 3, "scoreBoost": 2}'::jsonb,
  true
),
(
  'UDAAP / Sales Practice Risk',
  'udaap-sales-practice-risk',
  'Evidence of UDAAP violations or misleading sales practices in 2025-2026.',
  'Companies with recent UDAAP or fair lending risk indicators. Only matches current-year activity, not historical violations.',
  'custom',
  'AlertTriangle',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (UDAAP violation OR misleading sales OR disclosure failure OR fair lending violation OR deceptive practice) 2025 OR 2026", "numResults": 5, "daysBack": 180, "tier": 3, "scoreBoost": 2}'::jsonb,
  true
),
(
  'CX Team Scaling',
  'cx-team-scaling',
  'Company actively growing customer support or CX team in 2025-2026.',
  'A company scaling support operations hits acute QA pain. Only matches recent scaling activity.',
  'hiring',
  'Users',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (growing customer support OR expanding CX team OR scaling contact center OR hiring customer experience) 2025 OR 2026", "numResults": 5, "daysBack": 60, "tier": 3, "scoreBoost": 1, "minHits": 2}'::jsonb,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  long_description = EXCLUDED.long_description,
  config = EXCLUDED.config;

-- Remove old signals that were too vague or noise
DELETE FROM signals WHERE slug IN (
  'regulatory-action',
  'cx-ops-hiring',
  'tech-stack-no-incumbent',
  'fast-growth-scaling',
  'multi-state-expansion',
  'customer-facing-headcount'
) AND NOT EXISTS (
  SELECT 1 FROM signal_results WHERE signal_results.signal_id = signals.id
);
