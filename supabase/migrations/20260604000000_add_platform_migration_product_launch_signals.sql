-- Add two new signals referenced by updated ICP presets:
--   platform-migration  (Tier 2, QA + Customer Intelligence)
--   product-launch       (Tier 3, Customer Intelligence)

INSERT INTO signals (name, slug, description, long_description, category, icon, execution_type, tool_key, config, is_builtin)
VALUES
(
  'Platform Migration / Re-platforming',
  'platform-migration',
  'Company migrating CX platforms (Zendesk→Intercom, Salesforce→Freshdesk, etc.) in 2025-2026.',
  'Companies mid-migration between CX or support platforms face a QA blind spot — old tooling is disconnected, new tooling is not fully instrumented. This is a high-intent window for QA and conversation intelligence.',
  'product',
  'ArrowRightLeft',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (migrating OR switching OR re-platforming OR moving to) (Zendesk OR Intercom OR Freshdesk OR Salesforce Service Cloud OR Kustomer OR Gladly OR Dixa) 2025 OR 2026", "numResults": 5, "daysBack": 90, "tier": 2, "scoreBoost": 3}'::jsonb,
  true
),
(
  'New Product Launch / Line Expansion',
  'product-launch',
  'Company launching new product line, market, or program that creates new conversation volume in 2025-2026.',
  'A new product launch or market expansion creates a spike in unfamiliar conversations — new complaint types, new questions, new risk surfaces. Teams cannot see what is happening without conversation intelligence.',
  'product',
  'Rocket',
  'exa_search',
  NULL,
  '{"query": "\"{company}\" (launched OR launching OR new product OR expanding into OR new market OR new program) (fintech OR lending OR banking OR insurance) 2025 OR 2026", "numResults": 5, "daysBack": 90, "tier": 3, "scoreBoost": 2}'::jsonb,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  long_description = EXCLUDED.long_description,
  config = EXCLUDED.config;
