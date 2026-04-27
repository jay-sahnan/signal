-- Rulebase signal definitions — redesigned from first principles
-- 2026-04-27
--
-- Signal tiers:
--   Tier 1: Compelled buyer (consent order, enforcement action)
--   Tier 2: Triggered buyer (new CCO hire, rising CFPB complaints, PE acquisition, Trustpilot surge)
--   Tier 3: Active buyer (compliance/QA job posting, AI deployment, UDAAP risk, CX scaling)
--
-- Every signal must answer: "Why should I call THIS company THIS week?"
-- Signals must be verifiable, timely, and differentiating.

INSERT INTO signals (name, slug, description, long_description, category, icon, execution_type, tool_key, config, is_builtin)
VALUES
-- Tier 1: Compelled Buyer
(
  'Consent Order / Enforcement Action',
  'consent-order-enforcement',
  'Active CFPB consent order, state AG settlement, or enforcement action requiring compliance improvements.',
  'Companies under consent orders are compelled buyers — they must improve monitoring. This is the highest-value signal. Searches for specific enforcement language (consent order, civil money penalty, enforcement action) tied to the company.',
  'custom',
  'Shield',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" consent order OR enforcement action OR CFPB fine OR civil money penalty 2025 OR 2026", "numResults": 5, "daysBack": 180, "tier": 1, "scoreBoost": 5}'::jsonb,
  true
),
-- Tier 2: Triggered Buyer
(
  'New Compliance / CX Leader Hired',
  'new-leader-hired',
  'New CCO, Head of CX, VP Operations, or General Counsel hired in last 90 days.',
  'A new compliance or CX leader triggers tool evaluation within 90 days. This is the single strongest buying signal after enforcement — new leaders audit processes and buy tools. Searches for hiring/appointment announcements for specific C-suite and VP titles.',
  'hiring',
  'UserPlus',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" hired OR appointed OR named Chief Compliance Officer OR Head of CX OR VP Customer Experience OR VP Operations OR CCO OR General Counsel", "numResults": 5, "daysBack": 90, "tier": 2, "scoreBoost": 4}'::jsonb,
  true
),
(
  'Rising CFPB Complaints',
  'rising-cfpb-complaints',
  'CFPB complaint volume rising for this company — precedes enforcement action.',
  'Rising CFPB complaints are a leading indicator of enforcement. The CFPB uses complaint data to prioritise supervisory exams. Companies with rising volumes have a bullseye on them and are under pressure to improve complaint capture.',
  'custom',
  'TrendingUp',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" CFPB complaints rising OR increasing OR surge OR volume consumer financial protection", "numResults": 5, "daysBack": 60, "tier": 2, "scoreBoost": 4}'::jsonb,
  true
),
(
  'Trustpilot / Public Review Deterioration',
  'trustpilot-review-surge',
  'Deteriorating Trustpilot scores, rising negative reviews, and recurring complaint themes.',
  'A review surge is the earliest public indicator that complaint handling is broken. Public complaints mirror internal failures — for every Trustpilot complaint there are 5-10 unlogged expressions of dissatisfaction in calls.',
  'engagement',
  'Star',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" Trustpilot OR BBB complaints OR terrible service OR worst experience OR scam", "numResults": 5, "daysBack": 30, "tier": 2, "scoreBoost": 3}'::jsonb,
  true
),
(
  'PE Acquisition / Ownership Change',
  'pe-acquisition-funding',
  'Recent PE acquisition, ownership change, or major funding round.',
  'PE-backed lenders face compliance growing pains post-acquisition. New ownership wants compliance risk quantified and controlled — creates urgent tool evaluation. Also applies to funding rounds that signal scaling and compliance maturity gaps.',
  'funding',
  'DollarSign',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" acquired OR private equity acquisition OR new ownership OR ownership change auto finance OR lending", "numResults": 5, "daysBack": 180, "tier": 2, "scoreBoost": 3}'::jsonb,
  true
),
-- Tier 3: Active Buyer
(
  'Compliance / QA Job Posting',
  'compliance-qa-job-posting',
  'Active job postings for compliance monitoring, QA, complaints, or UDAAP roles.',
  'Companies hiring for compliance/QA roles signal that the current approach is not working. Job postings mentioning "complaint management", "UDAAP monitoring", "QA automation", or "quality analyst" indicate active tool evaluation or gaps in coverage.',
  'hiring',
  'Briefcase',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" hiring OR job OR career complaint OR QA Manager OR Quality Analyst OR compliance monitoring OR UDAAP OR fair lending", "numResults": 5, "daysBack": 30, "tier": 3, "scoreBoost": 2}'::jsonb,
  true
),
(
  'AI Agent Deployment',
  'ai-agent-adoption-cx',
  'Company deploying AI agents or chatbots for customer interactions.',
  'Companies rolling out AI agents create a new QA problem: who QAs the AI? Traditional manual QA cannot review AI-handled conversations at scale. Regulators expect the same oversight on AI as human interactions.',
  'product',
  'Bot',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" deployed OR launched AI agent OR AI chatbot OR voice AI OR conversational AI customer service", "numResults": 5, "daysBack": 60, "tier": 3, "scoreBoost": 2}'::jsonb,
  true
),
(
  'UDAAP / Sales Practice Risk',
  'udaap-sales-practice-risk',
  'Evidence of UDAAP violations, misleading sales practices, or disclosure failures.',
  'Companies with UDAAP or fair lending risk indicators are active targets for sales compliance monitoring. Searches for specific regulatory language tied to the company.',
  'custom',
  'AlertTriangle',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" UDAAP violation OR misleading sales OR disclosure failure OR fair lending violation OR deceptive practice", "numResults": 5, "daysBack": 90, "tier": 3, "scoreBoost": 2}'::jsonb,
  true
),
(
  'CX Team Scaling',
  'cx-team-scaling',
  'Company actively growing customer support or CX team — scaling pain signal.',
  'A company scaling from 40 to 100+ customer-facing agents hits acute QA pain. Manual QA breaks down at scale. Growth is a universal pain amplifier for QA and compliance gaps. Requires 2+ hits to confirm (reduces false positives).',
  'hiring',
  'Users',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" growing customer support OR expanding CX team OR hired customer experience OR scaling contact center", "numResults": 5, "daysBack": 30, "tier": 3, "scoreBoost": 1, "minHits": 2}'::jsonb,
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
