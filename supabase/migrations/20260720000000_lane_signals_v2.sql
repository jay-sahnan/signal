-- Signal Engine v2 — lane-specific signals
-- See docs/plans/2026-07-20-signal-engine-v2.md. Three lanes:
--   Lane 1 AI QA · Lane 2 Long-horizon tasks · Lane 3 AI for customer ops
-- Market cut (all lanes): SMBs across regulated industries, FS-led.
--
-- All are exa_search recipes (news/web queries, {company} templated), grounded
-- in ~35 mined sales/customer calls. Existing signals already cover the generic
-- triggers (executive-changes = new leader, funding-news, product-launches,
-- hiring-activity, website-tech-stack, google-reviews) so this adds only the
-- lane-specific ones. config carries tier/scoreBoost/lane for downstream scoring.
-- scoreBoost is negative for the suppressor. Idempotent.

INSERT INTO signals (name, slug, description, long_description, category, icon, execution_type, tool_key, config, is_builtin)
VALUES
-- ── Lane 1: AI QA (QA the AI + humans; cost-reduce AI CX platforms) ──────────
(
  'AI CX Platform Deployed',
  'ai-cx-platform-deployed',
  'Company has deployed an AI customer-service agent platform (Sierra, Decagon, Ada, Intercom Fin, Zendesk AI) — the AI now needs QA.',
  'When a company rolls out an AI CX agent, nobody is grading what the AI says. Rulebase QAs the AI and the humans together and cuts the cost of running the platform. Strongest Lane 1 entry point.',
  'product', 'Bot', 'exa_search', NULL,
  '{"query": "\"{company}\" (Sierra OR Decagon OR Ada OR \"Intercom Fin\" OR \"Fin AI\" OR \"Zendesk AI\" OR \"AI agent\" OR \"AI customer service\" OR \"resolution bot\") (launched OR deployed OR \"rolled out\" OR \"goes live\" OR partners) 2025 OR 2026", "category": "news", "tier": 2, "scoreBoost": 4, "lane": 1}'::jsonb,
  true
),
(
  'QA Tool In Use (Displacement)',
  'qa-tool-in-use',
  'Company runs a legacy/point QA tool (MaestroQA, EvaluAgent, Klaus, PlayVox, Level AI, PerformLine, Ripit) — displacement target, converts fastest near renewal.',
  'Every core won logo displaced a manual or legacy QA tool. Public mention of an incumbent QA tool marks a displacement opportunity; a clean technographic version arrives with the Crustdata tool.',
  'custom', 'ArrowRightLeft', 'exa_search', NULL,
  '{"query": "\"{company}\" (MaestroQA OR EvaluAgent OR Klaus OR PlayVox OR \"Level AI\" OR PerformLine OR Ripit OR Loris OR \"quality assurance platform\") (support OR CX OR \"customer service\" OR \"contact center\") 2025 OR 2026", "category": "news", "tier": 2, "scoreBoost": 4, "lane": 1}'::jsonb,
  true
),
(
  'CX QA / Quality Hiring',
  'qa-quality-hiring',
  'Open reqs for CX Quality / QA roles — building a QA function manually, ready for automation.',
  'Hiring humans to grade tickets means QA is manual and scaling linearly. Route to Lane 1.',
  'hiring', 'Briefcase', 'exa_search', NULL,
  '{"query": "\"{company}\" (hiring OR careers OR \"job posting\") (\"Quality Analyst\" OR \"QA Analyst\" OR \"Quality Assurance\" OR \"CX Quality\" OR \"Head of Quality\" OR \"QA Manager\") (support OR customer OR CX) 2025 OR 2026", "category": "news", "tier": 3, "scoreBoost": 2, "lane": 1}'::jsonb,
  true
),
-- ── Lane 2: Long-horizon tasks (customer + growth ops over time) ─────────────
(
  'Onboarding / Activation Hiring',
  'onboarding-activation-hiring',
  'Open reqs for onboarding / implementation / activation / underwriting roles — manual multi-step onboarding scaling with headcount.',
  'A burst of onboarding/activation hiring (especially after funding) is the strongest Lane 2 trigger — the multi-step task is manual and revenue is gated behind it.',
  'hiring', 'Briefcase', 'exa_search', NULL,
  '{"query": "\"{company}\" (hiring OR careers) (\"Onboarding Specialist\" OR \"Implementation Manager\" OR \"Activation\" OR \"Merchant Onboarding\" OR \"Customer Onboarding\" OR \"Underwriting\" OR \"KYB Analyst\") 2025 OR 2026", "category": "news", "tier": 3, "scoreBoost": 2, "lane": 2}'::jsonb,
  true
),
(
  'Reactivation / Churn Motion',
  'reactivation-churn-language',
  'Company is running (or hiring for) reactivation, win-back, retention, or dormant-account recovery — a long-horizon revenue task.',
  'Evidence the money exists and nobody owns collecting it over time. Anchor Lane 2 value against the recovered revenue.',
  'custom', 'TrendingUp', 'exa_search', NULL,
  '{"query": "\"{company}\" (reactivation OR \"dormant accounts\" OR \"win-back\" OR churn OR retention OR \"re-engagement\" OR \"stalled onboarding\" OR \"recovered revenue\") 2025 OR 2026", "category": "news", "tier": 2, "scoreBoost": 3, "lane": 2}'::jsonb,
  true
),
(
  'New Market / License Launch',
  'new-market-license-launch',
  'Payments/banking/lending/insurance license approval or new-market entry — a new onboarding flow and compliance regime built from scratch.',
  'A new licence or market means onboarding logic forks and stalls multiply over time. Lane 2 / Lane 3 depending on the workflow.',
  'product', 'Globe', 'exa_search', NULL,
  '{"query": "\"{company}\" (license OR licence OR \"new market\" OR \"expands to\" OR \"goes live in\" OR \"launches in\" OR \"granted approval\") (payments OR banking OR lending OR insurance OR remittance OR EMI) 2025 OR 2026", "category": "news", "tier": 2, "scoreBoost": 3, "lane": 2}'::jsonb,
  true
),
-- ── Lane 3: AI for customer ops (front-line ops agents, Gradient Labs style) ─
(
  'Evaluating Autonomous Support Agents',
  'evaluating-ai-support-agents',
  'Company is in-market for autonomous customer-ops agents (Gradient Labs, Sierra, Decagon) — direct Lane 3 intent.',
  'A company evaluating agentic support is deciding whether agents run the ops. Reach them during the evaluation.',
  'custom', 'Bot', 'exa_search', NULL,
  '{"query": "\"{company}\" (\"Gradient Labs\" OR Sierra OR Decagon OR Ada OR \"AI agent\" OR \"autonomous agent\" OR \"AI resolution\" OR agentic) (evaluating OR piloting OR \"in talks\" OR RFP OR selecting OR trialing) (\"customer support\" OR \"customer service\" OR operations) 2025 OR 2026", "category": "news", "tier": 2, "scoreBoost": 3, "lane": 3}'::jsonb,
  true
),
(
  'Support / Ops Scale Hiring',
  'support-scale-hiring',
  'Company scaling front-line support/ops headcount (incl. BPO) — linear-scaling ops cost ripe for agents.',
  'Heavy front-line hiring signals ops volume growing faster than tooling — the Lane 3 automation opening.',
  'hiring', 'Briefcase', 'exa_search', NULL,
  '{"query": "\"{company}\" (hiring OR careers) (\"Customer Support\" OR \"Support Specialist\" OR \"Contact Center\" OR \"Customer Service\" OR \"Operations Associate\" OR BPO) (team OR \"multiple roles\" OR scaling OR expanding) 2025 OR 2026", "category": "news", "tier": 3, "scoreBoost": 1, "lane": 3}'::jsonb,
  true
),
-- ── Cross-lane: negative suppressor ─────────────────────────────────────────
(
  'Internal-Build / LLM-Native (Suppressor)',
  'internal-build-suppressor',
  'Company is building its own QA/CX/compliance tooling on Claude/LLMs in-house — the biggest historical loss pattern. Negative signal.',
  'Relay, Ramp, Stash, Zolve, Capital One and Bill.com all built their own. Hiring AI/ML engineers for internal compliance/QA tooling, or public "we built our own" content, predicts a loss. scoreBoost is negative to suppress these.',
  'custom', 'Ban', 'exa_search', NULL,
  '{"query": "\"{company}\" (\"built our own\" OR \"in-house\" OR \"internal tool\" OR \"AI engineer\" OR \"ML engineer\" OR \"applied AI\") (QA OR quality OR compliance OR \"customer support\" OR agents) 2025 OR 2026", "category": "news", "tier": 0, "scoreBoost": -4, "lane": 0}'::jsonb,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  long_description = EXCLUDED.long_description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  execution_type = EXCLUDED.execution_type,
  config = EXCLUDED.config;
