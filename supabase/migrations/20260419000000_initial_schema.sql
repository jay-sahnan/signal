-- Signal initial schema
-- Consolidated from 30 incremental migrations as of 2026-04-21.
-- For a cleaner single-file schema, run: supabase db reset && supabase db dump --local --schema public > <name>.sql


-- ===========================================
-- Source: 20260321000000_create_outbound_schema.sql
-- ===========================================
-- Outbound orchestrator schema: campaigns, companies, contacts

-- Campaigns table: ICP definition, offering, positioning, search criteria
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'discovery'
    check (status in ('discovery', 'researching', 'active', 'paused', 'completed')),
  icp jsonb default '{}'::jsonb,
  offering jsonb default '{}'::jsonb,
  positioning jsonb default '{}'::jsonb,
  search_criteria jsonb default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Companies table: discovered companies with relevance scores
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  domain text,
  url text,
  industry text,
  location text,
  description text,
  relevance_score numeric(3,1) default 0,
  status text not null default 'discovered'
    check (status in ('discovered', 'qualified', 'disqualified')),
  enrichment_data jsonb default '{}'::jsonb,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Contacts table: people at target companies
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  name text not null,
  title text,
  email text,
  linkedin_url text,
  twitter_url text,
  enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'in_progress', 'enriched', 'failed')),
  enrichment_data jsonb default '{}'::jsonb,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Indexes for common queries
create index if not exists idx_companies_campaign_id on companies(campaign_id);
create index if not exists idx_contacts_campaign_id on contacts(campaign_id);
create index if not exists idx_contacts_company_id on contacts(company_id);
-- Enable RLS on all tables
alter table campaigns enable row level security;
alter table companies enable row level security;
alter table contacts enable row level security;
-- Permissive policies (tighten with auth later)
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Allow all on campaigns') then
    create policy "Allow all on campaigns" on campaigns for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Allow all on companies') then
    create policy "Allow all on companies" on companies for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Allow all on contacts') then
    create policy "Allow all on contacts" on contacts for all using (true) with check (true);
  end if;
end $$;
-- Auto-update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
create or replace trigger campaigns_updated_at before update on campaigns
  for each row execute function update_updated_at_column();
create or replace trigger companies_updated_at before update on companies
  for each row execute function update_updated_at_column();
create or replace trigger contacts_updated_at before update on contacts
  for each row execute function update_updated_at_column();

-- ===========================================
-- Source: 20260322000000_add_contact_status.sql
-- ===========================================
-- Add qualification status to contacts for approve/reject workflow
alter table contacts add column status text not null default 'pending'
  check (status in ('pending', 'approved', 'rejected'));
create index if not exists idx_contacts_status on contacts(status);

-- ===========================================
-- Source: 20260323000000_create_user_profile.sql
-- ===========================================
-- User profile for outbound context (personal info, company, links, notes)
create table if not exists user_profile (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  company_name text,
  company_url text,
  personal_url text,
  linkedin_url text,
  twitter_url text,
  role_title text,
  offering_summary text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table user_profile enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Allow all on user_profile') then
    create policy "Allow all on user_profile" on user_profile for all using (true) with check (true);
  end if;
end $$;
create or replace trigger user_profile_updated_at before update on user_profile
  for each row execute function update_updated_at_column();

-- ===========================================
-- Source: 20260325000000_add_outreach_status.sql
-- ===========================================
-- Add outreach status to contacts for tracking email outreach pipeline
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS outreach_status text NOT NULL DEFAULT 'not_contacted'
  CHECK (outreach_status IN ('not_contacted', 'queued', 'sent', 'opened', 'replied', 'bounced'));
CREATE INDEX IF NOT EXISTS idx_contacts_outreach_status ON contacts(outreach_status);

-- ===========================================
-- Source: 20260326000000_add_priority_scores.sql
-- ===========================================
-- Add scoring reason to companies (relevance_score column already exists)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS score_reason text;
-- Add priority score and reason to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS priority_score numeric(3,1) DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS score_reason text;
-- Index for sorting contacts by priority
CREATE INDEX IF NOT EXISTS idx_contacts_priority_score ON contacts(priority_score DESC);

-- ===========================================
-- Source: 20260328000000_campaign_profiles.sql
-- ===========================================
-- Add label to user_profile so users can distinguish between profiles
alter table user_profile add column label text;
-- Link campaigns to a specific profile
alter table campaigns add column profile_id uuid references user_profile(id) on delete set null;

-- ===========================================
-- Source: 20260329100000_api_usage.sql
-- ===========================================
-- Track all external API calls for cost monitoring
CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,              -- 'claude', 'exa', 'apify', 'browserbase'
  operation TEXT NOT NULL,            -- 'chat', 'search', 'scrape-linkedin', 'scrape-twitter', 'fetch', 'browser-session', 'relevance-filter', 'score-contacts'
  tokens_input INTEGER,              -- for LLM calls
  tokens_output INTEGER,             -- for LLM calls
  estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',       -- model, query, url, etc.
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Index for querying by time range + service
CREATE INDEX idx_api_usage_created_at ON api_usage (created_at DESC);
CREATE INDEX idx_api_usage_service ON api_usage (service, created_at DESC);
CREATE INDEX idx_api_usage_campaign ON api_usage (campaign_id) WHERE campaign_id IS NOT NULL;

-- ===========================================
-- Source: 20260329110000_create_signals.sql
-- ===========================================
-- Signals catalog: reusable signal definitions
create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null,
  long_description text,
  category text not null default 'custom'
    check (category in ('hiring', 'funding', 'executive', 'product', 'engagement', 'custom')),
  icon text,
  execution_type text not null default 'agent_instructions'
    check (execution_type in ('browser_script', 'exa_search', 'tool_call', 'agent_instructions')),
  tool_key text,
  config jsonb default '{}'::jsonb,
  is_builtin boolean not null default false,
  is_public boolean not null default false,
  created_by uuid references user_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Campaign-signal join: which signals are active per campaign
create table if not exists campaign_signals (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  signal_id uuid not null references signals(id) on delete cascade,
  enabled boolean not null default true,
  config_override jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, signal_id)
);
-- Signal results: execution outputs
create table if not exists signal_results (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references signals(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  output jsonb not null default '{}'::jsonb,
  status text not null default 'success'
    check (status in ('success', 'failed', 'partial')),
  ran_at timestamptz not null default now()
);
-- Indexes
create index if not exists idx_signals_slug on signals(slug);
create index if not exists idx_signals_category on signals(category);
create index if not exists idx_signals_builtin on signals(is_builtin);
create index if not exists idx_campaign_signals_campaign on campaign_signals(campaign_id);
create index if not exists idx_campaign_signals_signal on campaign_signals(signal_id);
create index if not exists idx_signal_results_signal on signal_results(signal_id);
create index if not exists idx_signal_results_campaign on signal_results(campaign_id);
create index if not exists idx_signal_results_company on signal_results(company_id);
create index if not exists idx_signal_results_ran_at on signal_results(ran_at desc);
-- RLS
alter table signals enable row level security;
alter table campaign_signals enable row level security;
alter table signal_results enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Allow all on signals') then
    create policy "Allow all on signals" on signals for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Allow all on campaign_signals') then
    create policy "Allow all on campaign_signals" on campaign_signals for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Allow all on signal_results') then
    create policy "Allow all on signal_results" on signal_results for all using (true) with check (true);
  end if;
end $$;
-- Triggers
create or replace trigger signals_updated_at before update on signals
  for each row execute function update_updated_at_column();
create or replace trigger campaign_signals_updated_at before update on campaign_signals
  for each row execute function update_updated_at_column();
-- Seed built-in signals
insert into signals (name, slug, description, long_description, category, icon, execution_type, tool_key, config, is_builtin) values
(
  'Hiring Activity',
  'hiring-activity',
  'Scrape careers pages to detect hiring patterns as buying signals.',
  'Navigates to a company''s website, finds their careers or jobs page, and extracts structured job listings. Companies actively hiring for roles related to your offering are prime targets -- hiring volume, department focus, and role seniority all indicate budget and urgency.',
  'hiring',
  'Briefcase',
  'browser_script',
  'scrapeJobListings',
  '{"maxJobs": 20}'::jsonb,
  true
),
(
  'Funding & News',
  'funding-news',
  'Search for recent funding rounds, acquisitions, and company news.',
  'Uses semantic search to find recent funding announcements, acquisitions, partnerships, and press coverage. Recent funding often means budget for new tools and services. Major news events create natural outreach hooks.',
  'funding',
  'TrendingUp',
  'exa_search',
  null,
  '{"query": "{company} funding round OR acquisition OR raised series", "category": "news"}'::jsonb,
  true
),
(
  'Executive Changes',
  'executive-changes',
  'Detect new hires, promotions, and leadership changes at target companies.',
  'Searches for recent executive appointments, promotions, and leadership changes. New leaders in relevant roles often bring new budgets and initiatives -- a strong timing signal for outreach.',
  'executive',
  'UserCog',
  'exa_search',
  null,
  '{"query": "new {title} appointed OR hired OR promoted at {company}", "category": "news"}'::jsonb,
  true
),
(
  'Product Launches',
  'product-launches',
  'Monitor for new product announcements and feature releases.',
  'Tracks new product launches, major feature releases, and expansion announcements. Companies launching new products are often investing in supporting infrastructure, tooling, and services.',
  'product',
  'Rocket',
  'exa_search',
  null,
  '{"query": "{company} launches OR announces OR releases new product OR feature", "category": "news"}'::jsonb,
  true
),
(
  'Social Engagement',
  'social-engagement',
  'Analyze LinkedIn and Twitter activity for engagement signals.',
  'Reviews recent social media activity from key contacts -- LinkedIn posts, Twitter engagement, and content themes. Active posters with relevant content are more receptive to outreach. Recent posts about pain points your product solves are golden timing signals.',
  'engagement',
  'MessageCircle',
  'tool_call',
  'enrichContact',
  '{"focus": "social_activity"}'::jsonb,
  true
),
(
  'Website & Tech Stack',
  'website-tech-stack',
  'Analyze company websites for technology signals and content.',
  'Extracts and analyzes company website content, technology indicators, and messaging. Helps identify tech stack, positioning, growth stage, and potential pain points based on how they present themselves.',
  'product',
  'Globe',
  'tool_call',
  'extractWebContent',
  '{"includeStructuredData": true}'::jsonb,
  true
),
(
  'GitHub Stargazers',
  'github-stargazers',
  'Fetch actual stargazers from a company''s GitHub repos to find developers and decision-makers.',
  'Uses the GitHub API to fetch the real people who recently starred a company''s repositories. Returns full profiles: name, company, location, bio, follower count, and when they starred. Aggregates which companies and locations are represented. Useful for finding developers interested in specific technologies, identifying companies with active dev communities, and discovering technical decision-makers.',
  'engagement',
  'Star',
  'tool_call',
  'fetchGitHubStargazers',
  '{"maxStargazers": 10}'::jsonb,
  true
);

-- ===========================================
-- Source: 20260329200000_chat_history.sql
-- ===========================================
-- Persist chat conversations (messages stored as JSONB array of UIMessage)
CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'New chat',
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chats_updated_at ON chats (updated_at DESC);
CREATE INDEX idx_chats_campaign_id ON chats (campaign_id) WHERE campaign_id IS NOT NULL;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on chats" ON chats FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER chats_updated_at BEFORE UPDATE ON chats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- Source: 20260330000000_shared_knowledge_base.sql
-- ===========================================
-- Shared Knowledge Base: organizations and people tables
-- These tables are campaign-agnostic and store only raw, publicly-sourced data.
-- Campaign-specific data (scores, status, outreach) lives in junction tables.

-- Enable trigram extension for fuzzy name matching
create extension if not exists pg_trgm;
-- =============================================================================
-- 1. Create shared tables
-- =============================================================================

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text,
  url text,
  industry text,
  location text,
  description text,
  enrichment_data jsonb default '{}'::jsonb,
  enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'enriched', 'failed')),
  last_enriched_at timestamptz,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_organizations_domain
  on organizations(domain) where domain is not null;
create index if not exists idx_organizations_last_enriched
  on organizations(last_enriched_at);
create index if not exists idx_organizations_name_trgm
  on organizations using gin (name gin_trgm_ops);
create trigger organizations_updated_at
  before update on organizations
  for each row execute function update_updated_at_column();
alter table organizations enable row level security;
create policy "Allow all on organizations"
  on organizations for all using (true) with check (true);
create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  linkedin_url text,
  email text,
  twitter_url text,
  title text,
  organization_id uuid references organizations(id) on delete set null,
  enrichment_data jsonb default '{}'::jsonb,
  enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'in_progress', 'enriched', 'failed')),
  last_enriched_at timestamptz,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_people_linkedin
  on people(linkedin_url) where linkedin_url is not null;
create index if not exists idx_people_organization
  on people(organization_id);
create index if not exists idx_people_last_enriched
  on people(last_enriched_at);
create index if not exists idx_people_email
  on people(email) where email is not null;
create index if not exists idx_people_name_org
  on people(name, organization_id);
create trigger people_updated_at
  before update on people
  for each row execute function update_updated_at_column();
alter table people enable row level security;
create policy "Allow all on people"
  on people for all using (true) with check (true);
-- =============================================================================
-- 2. Create junction tables
-- =============================================================================

create table if not exists campaign_organizations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  relevance_score numeric(3,1) default 0,
  score_reason text,
  status text not null default 'discovered'
    check (status in ('discovered', 'qualified', 'disqualified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, organization_id)
);
create index if not exists idx_campaign_orgs_campaign
  on campaign_organizations(campaign_id);
create index if not exists idx_campaign_orgs_org
  on campaign_organizations(organization_id);
create index if not exists idx_campaign_orgs_status
  on campaign_organizations(status);
create trigger campaign_organizations_updated_at
  before update on campaign_organizations
  for each row execute function update_updated_at_column();
alter table campaign_organizations enable row level security;
create policy "Allow all on campaign_organizations"
  on campaign_organizations for all using (true) with check (true);
create table if not exists campaign_people (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  outreach_status text not null default 'not_contacted'
    check (outreach_status in ('not_contacted', 'queued', 'sent', 'opened', 'replied', 'bounced')),
  priority_score numeric(3,1) default 0,
  score_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, person_id)
);
create index if not exists idx_campaign_people_campaign
  on campaign_people(campaign_id);
create index if not exists idx_campaign_people_person
  on campaign_people(person_id);
create index if not exists idx_campaign_people_status
  on campaign_people(status);
create index if not exists idx_campaign_people_outreach
  on campaign_people(outreach_status);
create index if not exists idx_campaign_people_priority
  on campaign_people(priority_score desc);
create trigger campaign_people_updated_at
  before update on campaign_people
  for each row execute function update_updated_at_column();
alter table campaign_people enable row level security;
create policy "Allow all on campaign_people"
  on campaign_people for all using (true) with check (true);
-- =============================================================================
-- 3. Migrate existing data
-- =============================================================================

-- 3a. Insert unique organizations from companies (dedup by domain)
insert into organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source, created_at, updated_at)
select distinct on (coalesce(c.domain, c.id::text))
  c.name,
  c.domain,
  c.url,
  c.industry,
  c.location,
  c.description,
  c.enrichment_data,
  case when c.enrichment_data ? 'enrichedAt' then 'enriched' else 'pending' end,
  case when c.enrichment_data ? 'enrichedAt'
    then (c.enrichment_data->>'enrichedAt')::timestamptz
    else null
  end,
  c.source,
  c.created_at,
  c.updated_at
from companies c
order by coalesce(c.domain, c.id::text), c.updated_at desc;
-- 3b. Create campaign_organizations links
insert into campaign_organizations (campaign_id, organization_id, relevance_score, score_reason, status)
select
  c.campaign_id,
  o.id,
  c.relevance_score,
  c.score_reason,
  c.status
from companies c
join organizations o on (
  (c.domain is not null and c.domain = o.domain)
  or (c.domain is null and c.name = o.name and coalesce(c.url, '') = coalesce(o.url, ''))
)
on conflict (campaign_id, organization_id) do nothing;
-- 3c. Insert unique people from contacts (dedup by linkedin_url)
insert into people (name, linkedin_url, email, twitter_url, title, organization_id, enrichment_data, enrichment_status, last_enriched_at, source, created_at, updated_at)
select distinct on (coalesce(ct.linkedin_url, ct.id::text))
  ct.name,
  ct.linkedin_url,
  ct.email,
  ct.twitter_url,
  ct.title,
  o.id,
  ct.enrichment_data,
  ct.enrichment_status,
  case when ct.enrichment_status = 'enriched' then ct.updated_at else null end,
  ct.source,
  ct.created_at,
  ct.updated_at
from contacts ct
left join companies comp on ct.company_id = comp.id
left join organizations o on (
  comp.domain is not null and comp.domain = o.domain
)
order by coalesce(ct.linkedin_url, ct.id::text), ct.updated_at desc;
-- 3d. Create campaign_people links
insert into campaign_people (campaign_id, person_id, status, outreach_status, priority_score, score_reason)
select
  ct.campaign_id,
  p.id,
  ct.status,
  ct.outreach_status,
  ct.priority_score,
  ct.score_reason
from contacts ct
join people p on (
  (ct.linkedin_url is not null and ct.linkedin_url = p.linkedin_url)
  or (ct.linkedin_url is null and ct.name = p.name)
)
on conflict (campaign_id, person_id) do nothing;
-- =============================================================================
-- 4. Rename old tables (safe rollback path)
-- =============================================================================

alter table companies rename to _companies_deprecated;
alter table contacts rename to _contacts_deprecated;

-- ===========================================
-- Source: 20260330010000_add_github_url_to_people.sql
-- ===========================================
-- Add github_url column to people for GitHub-based dedup
alter table people add column if not exists github_url text;
create unique index if not exists idx_people_github_url
  on people(github_url) where github_url is not null;

-- ===========================================
-- Source: 20260330020000_split_email_columns.sql
-- ===========================================
-- Split single email column into work + personal with verification timestamps
ALTER TABLE people RENAME COLUMN email TO work_email;
ALTER TABLE people ADD COLUMN personal_email TEXT;
ALTER TABLE people ADD COLUMN work_email_verified_at TIMESTAMPTZ;
ALTER TABLE people ADD COLUMN personal_email_verified_at TIMESTAMPTZ;
-- Update indexes: drop old email index, create new ones
DROP INDEX IF EXISTS idx_people_email;
CREATE INDEX idx_people_work_email ON people(work_email) WHERE work_email IS NOT NULL;
CREATE INDEX idx_people_personal_email ON people(personal_email) WHERE personal_email IS NOT NULL;

-- ===========================================
-- Source: 20260331000000_outreach_events.sql
-- ===========================================
-- Append-only log of outreach status transitions for time-series analytics
create table outreach_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now()
);
create index idx_outreach_events_campaign_date on outreach_events (campaign_id, created_at);
create index idx_outreach_events_date_status on outreach_events (created_at, status);
alter table outreach_events enable row level security;
create policy "Allow all on outreach_events"
  on outreach_events for all using (true) with check (true);
-- Auto-log outreach status changes from campaign_people
create or replace function log_outreach_event()
returns trigger as $$
begin
  if NEW.outreach_status is distinct from OLD.outreach_status
     and NEW.outreach_status != 'not_contacted' then
    insert into outreach_events (campaign_id, person_id, status)
    values (NEW.campaign_id, NEW.person_id, NEW.outreach_status);
  end if;
  return NEW;
end;
$$ language plpgsql;
create trigger trg_outreach_event
after update of outreach_status on campaign_people
for each row execute function log_outreach_event();

-- ===========================================
-- Source: 20260332000000_remove_duplicate_github_signal.sql
-- ===========================================
-- Remove the duplicate "GitHub Stargazer People" signal created at runtime.
-- The canonical signal is "GitHub Stargazers" (slug: github-stargazers).
-- First unlink any campaign_signals referencing it, then delete the signal.
DELETE FROM campaign_signals
  WHERE signal_id IN (
    SELECT id FROM signals
    WHERE slug = 'github-stargazer-people'
       OR (name = 'GitHub Stargazer People' AND slug != 'github-stargazers')
  );
DELETE FROM signal_results
  WHERE signal_id IN (
    SELECT id FROM signals
    WHERE slug = 'github-stargazer-people'
       OR (name = 'GitHub Stargazer People' AND slug != 'github-stargazers')
  );
DELETE FROM signals
  WHERE slug = 'github-stargazer-people'
     OR (name = 'GitHub Stargazer People' AND slug != 'github-stargazers');

-- ===========================================
-- Source: 20260333000000_api_usage_action_id.sql
-- ===========================================
-- Group related API calls under a single user-initiated action
-- e.g. "Enrich person: John Smith" triggers LinkedIn + Twitter + 3 Exa searches
ALTER TABLE api_usage ADD COLUMN action_id UUID;
ALTER TABLE api_usage ADD COLUMN action_label TEXT;
CREATE INDEX idx_api_usage_action ON api_usage (action_id) WHERE action_id IS NOT NULL;

-- ===========================================
-- Source: 20260334000000_tracking_system.sql
-- ===========================================
-- ============================================================
-- Tracking system: recurring signal execution with change detection
-- ============================================================

-- 1. Fix signal_results FKs (currently reference deprecated companies/contacts)
-- Drop old FK constraints
alter table signal_results drop constraint if exists signal_results_company_id_fkey;
alter table signal_results drop constraint if exists signal_results_contact_id_fkey;
-- Rename columns to match shared knowledge base
alter table signal_results rename column company_id to organization_id;
alter table signal_results rename column contact_id to person_id;
-- Drop old index on old column name
drop index if exists idx_signal_results_company;
-- Add new FKs to shared knowledge base tables
alter table signal_results
  add constraint signal_results_organization_id_fkey
  foreign key (organization_id) references organizations(id) on delete cascade;
alter table signal_results
  add constraint signal_results_person_id_fkey
  foreign key (person_id) references people(id) on delete cascade;
-- Re-create index with new column name
create index if not exists idx_signal_results_organization on signal_results(organization_id);
create index if not exists idx_signal_results_person on signal_results(person_id);
-- 2. Tracking configs: what to track, how often, when to flag
create table if not exists tracking_configs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  person_id uuid references people(id) on delete cascade,
  signal_id uuid not null references signals(id) on delete cascade,
  schedule text not null default 'weekly'
    check (schedule in ('daily', 'weekly', 'biweekly', 'monthly')),
  threshold_rules jsonb not null default '[]'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed')),
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (organization_id is not null or person_id is not null)
);
-- Unique constraint: one tracking config per campaign + entity + signal
create unique index idx_tracking_configs_unique_org
  on tracking_configs(campaign_id, organization_id, signal_id)
  where organization_id is not null;
create unique index idx_tracking_configs_unique_person
  on tracking_configs(campaign_id, person_id, signal_id)
  where person_id is not null;
create index idx_tracking_configs_campaign on tracking_configs(campaign_id);
create index idx_tracking_configs_status on tracking_configs(status);
create index idx_tracking_configs_next_run on tracking_configs(next_run_at)
  where status = 'active';
-- 3. Tracking snapshots: normalized signal output for diffing
create table if not exists tracking_snapshots (
  id uuid primary key default gen_random_uuid(),
  tracking_config_id uuid not null references tracking_configs(id) on delete cascade,
  snapshot_data jsonb not null,
  snapshot_hash text not null,
  captured_at timestamptz not null default now()
);
create index idx_snapshots_config on tracking_snapshots(tracking_config_id, captured_at desc);
-- 4. Tracking changes: structured change records for UI display
create table if not exists tracking_changes (
  id uuid primary key default gen_random_uuid(),
  tracking_config_id uuid not null references tracking_configs(id) on delete cascade,
  change_type text not null
    check (change_type in ('added', 'removed', 'count_change', 'threshold_crossed')),
  field_path text,
  previous_value jsonb,
  current_value jsonb,
  description text not null,
  detected_at timestamptz not null default now()
);
create index idx_changes_config on tracking_changes(tracking_config_id, detected_at desc);
-- 5. Add tracking_config_id to signal_results
alter table signal_results add column if not exists tracking_config_id uuid
  references tracking_configs(id) on delete set null;
create index if not exists idx_signal_results_tracking
  on signal_results(tracking_config_id, ran_at desc)
  where tracking_config_id is not null;
-- 6. Add readiness_tag to campaign junction tables
alter table campaign_organizations add column if not exists readiness_tag text
  check (readiness_tag is null or readiness_tag in ('ready_to_contact', 'monitoring', 'not_ready'));
alter table campaign_people add column if not exists readiness_tag text
  check (readiness_tag is null or readiness_tag in ('ready_to_contact', 'monitoring', 'not_ready'));
create index if not exists idx_campaign_orgs_readiness on campaign_organizations(readiness_tag)
  where readiness_tag is not null;
create index if not exists idx_campaign_people_readiness on campaign_people(readiness_tag)
  where readiness_tag is not null;
-- 7. RLS (permissive for now, matching existing pattern)
alter table tracking_configs enable row level security;
alter table tracking_snapshots enable row level security;
alter table tracking_changes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Allow all on tracking_configs') then
    create policy "Allow all on tracking_configs" on tracking_configs for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Allow all on tracking_snapshots') then
    create policy "Allow all on tracking_snapshots" on tracking_snapshots for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Allow all on tracking_changes') then
    create policy "Allow all on tracking_changes" on tracking_changes for all using (true) with check (true);
  end if;
end $$;
-- 8. Triggers
create or replace trigger tracking_configs_updated_at before update on tracking_configs
  for each row execute function update_updated_at_column();

-- ===========================================
-- Source: 20260335000000_multi_tenant_auth.sql
-- ===========================================
-- ============================================================
-- Multi-tenant auth: user_id columns + proper RLS policies
-- ============================================================

-- 1. Add user_id columns (nullable for backfill, NOT NULL added later)
ALTER TABLE campaigns    ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE chats        ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE api_usage    ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user    ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_user        ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profile_user ON user_profile(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_user    ON api_usage(user_id);
-- Enable RLS on api_usage (was missing)
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
-- 2. Drop all existing permissive policies
DROP POLICY IF EXISTS "Allow all on campaigns" ON campaigns;
DROP POLICY IF EXISTS "Allow all on companies" ON _companies_deprecated;
DROP POLICY IF EXISTS "Allow all on contacts" ON _contacts_deprecated;
DROP POLICY IF EXISTS "Allow all on user_profile" ON user_profile;
DROP POLICY IF EXISTS "Allow all on organizations" ON organizations;
DROP POLICY IF EXISTS "Allow all on people" ON people;
DROP POLICY IF EXISTS "Allow all on campaign_organizations" ON campaign_organizations;
DROP POLICY IF EXISTS "Allow all on campaign_people" ON campaign_people;
DROP POLICY IF EXISTS "Allow all on signals" ON signals;
DROP POLICY IF EXISTS "Allow all on campaign_signals" ON campaign_signals;
DROP POLICY IF EXISTS "Allow all on signal_results" ON signal_results;
DROP POLICY IF EXISTS "Allow all on chats" ON chats;
DROP POLICY IF EXISTS "Allow all on outreach_events" ON outreach_events;
DROP POLICY IF EXISTS "Allow all on tracking_configs" ON tracking_configs;
DROP POLICY IF EXISTS "Allow all on tracking_snapshots" ON tracking_snapshots;
DROP POLICY IF EXISTS "Allow all on tracking_changes" ON tracking_changes;
-- 3. Global tables: any authenticated user can read/write
-- (shared enrichment pool)

-- organizations
CREATE POLICY "orgs_select" ON organizations FOR SELECT TO authenticated USING (true);
CREATE POLICY "orgs_insert" ON organizations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "orgs_update" ON organizations FOR UPDATE TO authenticated USING (true);
-- people
CREATE POLICY "people_select" ON people FOR SELECT TO authenticated USING (true);
CREATE POLICY "people_insert" ON people FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "people_update" ON people FOR UPDATE TO authenticated USING (true);
-- signals: readable by all, customs editable by creator only
CREATE POLICY "signals_select" ON signals FOR SELECT TO authenticated USING (true);
CREATE POLICY "signals_insert" ON signals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "signals_update" ON signals FOR UPDATE TO authenticated
  USING (is_builtin = false AND created_by IN (
    SELECT id FROM user_profile WHERE user_id = auth.uid()
  ));
CREATE POLICY "signals_delete" ON signals FOR DELETE TO authenticated
  USING (is_builtin = false AND created_by IN (
    SELECT id FROM user_profile WHERE user_id = auth.uid()
  ));
-- signal_results: shared execution data
CREATE POLICY "signal_results_select" ON signal_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "signal_results_insert" ON signal_results FOR INSERT TO authenticated WITH CHECK (true);
-- 4. Direct owner tables: auth.uid() = user_id

-- campaigns
CREATE POLICY "campaigns_select" ON campaigns FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "campaigns_insert" ON campaigns FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "campaigns_update" ON campaigns FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "campaigns_delete" ON campaigns FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
-- chats
CREATE POLICY "chats_select" ON chats FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "chats_insert" ON chats FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "chats_update" ON chats FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "chats_delete" ON chats FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
-- user_profile
CREATE POLICY "profile_select" ON user_profile FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "profile_insert" ON user_profile FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profile_update" ON user_profile FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "profile_delete" ON user_profile FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
-- api_usage: user can read own, system can insert for anyone
CREATE POLICY "usage_select" ON api_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "usage_insert" ON api_usage FOR INSERT TO authenticated
  WITH CHECK (true);
-- 5. Transitive tables: access via campaign ownership

-- campaign_organizations
CREATE POLICY "camp_orgs_select" ON campaign_organizations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "camp_orgs_insert" ON campaign_organizations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "camp_orgs_update" ON campaign_organizations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "camp_orgs_delete" ON campaign_organizations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
-- campaign_people
CREATE POLICY "camp_people_select" ON campaign_people FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "camp_people_insert" ON campaign_people FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "camp_people_update" ON campaign_people FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "camp_people_delete" ON campaign_people FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
-- campaign_signals
CREATE POLICY "camp_signals_select" ON campaign_signals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "camp_signals_insert" ON campaign_signals FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "camp_signals_update" ON campaign_signals FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "camp_signals_delete" ON campaign_signals FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
-- tracking_configs
CREATE POLICY "tracking_configs_select" ON tracking_configs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "tracking_configs_insert" ON tracking_configs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "tracking_configs_update" ON tracking_configs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
CREATE POLICY "tracking_configs_delete" ON tracking_configs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));
-- outreach_events (via campaign_id -> campaigns)
CREATE POLICY "outreach_select" ON outreach_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.id = campaign_id AND c.user_id = auth.uid()
  ));
CREATE POLICY "outreach_insert" ON outreach_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.id = campaign_id AND c.user_id = auth.uid()
  ));
-- 6. Deeply transitive: tracking_snapshots, tracking_changes
-- (via tracking_configs -> campaigns)

CREATE POLICY "snapshots_select" ON tracking_snapshots FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tracking_configs tc
    JOIN campaigns c ON c.id = tc.campaign_id
    WHERE tc.id = tracking_config_id AND c.user_id = auth.uid()
  ));
CREATE POLICY "snapshots_insert" ON tracking_snapshots FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM tracking_configs tc
    JOIN campaigns c ON c.id = tc.campaign_id
    WHERE tc.id = tracking_config_id AND c.user_id = auth.uid()
  ));
CREATE POLICY "changes_select" ON tracking_changes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tracking_configs tc
    JOIN campaigns c ON c.id = tc.campaign_id
    WHERE tc.id = tracking_config_id AND c.user_id = auth.uid()
  ));
CREATE POLICY "changes_insert" ON tracking_changes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM tracking_configs tc
    JOIN campaigns c ON c.id = tc.campaign_id
    WHERE tc.id = tracking_config_id AND c.user_id = auth.uid()
  ));
-- 7. Service role bypass: allow the service_role to do everything
-- (for QStash webhooks, cost tracker, and admin operations)
-- The service_role already bypasses RLS by default in Supabase,
-- so no explicit policies are needed for it.;

-- ===========================================
-- Source: 20260336000000_add_google_reviews_signal.sql
-- ===========================================
INSERT INTO signals (name, slug, description, long_description, category, icon, execution_type, tool_key, config, is_builtin)
VALUES (
  'Google Reviews',
  'google-reviews',
  'Fetch Google ratings and reviews to gauge customer sentiment and reputation.',
  'Uses the Google Places API to find a company''s Google Business listing and extract their rating, review count, and recent review text. Strong ratings with high volume signal a healthy, established business. Negative review patterns can reveal pain points your product addresses. Review content provides natural conversation starters for outreach.',
  'engagement',
  'StarHalf',
  'tool_call',
  'getGoogleReviews',
  '{"maxReviews": 5}'::jsonb,
  true
);

-- ===========================================
-- Source: 20260417000000_agentmail_integration.sql
-- ===========================================
-- AgentMail email integration: settings, drafts, sent emails, expanded outreach statuses
-- 2026-04-17

-- ── user_settings ──────────────────────────────────────────────────────────
-- Per-user email configuration (one row per user).
create table if not exists user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  agentmail_inbox_id text,
  from_name text,
  reply_to_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- ── email_drafts ───────────────────────────────────────────────────────────
-- Drafts composed by the AI before sending.
create table if not exists email_drafts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  campaign_people_id uuid not null references campaign_people(id) on delete cascade,
  user_id uuid not null,
  to_email text not null,
  subject text not null,
  body_html text not null,
  body_text text,
  reply_to text,
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'sent', 'discarded')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_email_drafts_campaign_status
  on email_drafts(campaign_id, status);
create index if not exists idx_email_drafts_cleanup
  on email_drafts(created_at, status);
-- ── sent_emails ────────────────────────────────────────────────────────────
-- Maps AgentMail message IDs back to campaign_people for status tracking.
create table if not exists sent_emails (
  id uuid primary key default gen_random_uuid(),
  agentmail_message_id text not null unique,
  draft_id uuid references email_drafts(id) on delete set null,
  campaign_people_id uuid not null references campaign_people(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  user_id uuid not null,
  to_email text not null,
  from_email text not null,
  subject text not null,
  status text not null default 'sent',
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_sent_emails_campaign
  on sent_emails(campaign_id);
create index if not exists idx_sent_emails_campaign_people
  on sent_emails(campaign_people_id);
-- ── Expand outreach_status values ──────────────────────────────────────────
-- Add delivered, clicked, complained to align with email event types.
alter table campaign_people drop constraint if exists campaign_people_outreach_status_check;
alter table campaign_people add constraint campaign_people_outreach_status_check
  check (outreach_status in (
    'not_contacted', 'queued', 'sent', 'delivered',
    'opened', 'clicked', 'replied', 'bounced', 'complained'
  ));
-- ── RLS policies ───────────────────────────────────────────────────────────

-- user_settings: owner-only
alter table user_settings enable row level security;
create policy "user_settings_select" on user_settings
  for select using (user_id = auth.uid());
create policy "user_settings_insert" on user_settings
  for insert with check (user_id = auth.uid());
create policy "user_settings_update" on user_settings
  for update using (user_id = auth.uid());
create policy "user_settings_delete" on user_settings
  for delete using (user_id = auth.uid());
-- email_drafts: owner-only
alter table email_drafts enable row level security;
create policy "email_drafts_select" on email_drafts
  for select using (user_id = auth.uid());
create policy "email_drafts_insert" on email_drafts
  for insert with check (user_id = auth.uid());
create policy "email_drafts_update" on email_drafts
  for update using (user_id = auth.uid());
create policy "email_drafts_delete" on email_drafts
  for delete using (user_id = auth.uid());
-- sent_emails: transitive via campaign ownership
alter table sent_emails enable row level security;
create policy "sent_emails_select" on sent_emails
  for select using (
    exists (
      select 1 from campaigns c
      where c.id = sent_emails.campaign_id
        and c.user_id = auth.uid()
    )
  );
create policy "sent_emails_insert" on sent_emails
  for insert with check (user_id = auth.uid());
create policy "sent_emails_update" on sent_emails
  for update using (user_id = auth.uid());

-- ===========================================
-- Source: 20260418000000_sequences.sql
-- ===========================================
-- Signal-driven outreach sequences
-- 2026-04-18

-- ── sequences ──────────────────────────────────────────────────────────────
create table if not exists sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  user_id uuid not null,
  trigger_signal_id uuid references signals(id),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sequences_campaign on sequences(campaign_id);
create index if not exists idx_sequences_status on sequences(status);
-- ── sequence_steps ─────────────────────────────────────────────────────────
create table if not exists sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references sequences(id) on delete cascade,
  step_number int not null,
  step_type text not null default 'email'
    check (step_type in ('email')),
  delay_days int,
  delay_hours int,
  condition text default 'no_reply'
    check (condition in ('no_reply', 'no_open', 'opened_no_reply', 'always')),
  created_at timestamptz not null default now(),
  unique (sequence_id, step_number)
);
-- ── sequence_enrollments ───────────────────────────────────────────────────
create table if not exists sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references sequences(id) on delete cascade,
  campaign_people_id uuid not null references campaign_people(id) on delete cascade,
  person_id uuid not null references people(id),
  current_step int not null default 1,
  status text not null default 'waiting'
    check (status in ('waiting', 'queued', 'active', 'replied', 'bounced', 'completed', 'removed')),
  waiting_since timestamptz default now(),
  next_send_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, campaign_people_id)
);
create index if not exists idx_enrollments_status on sequence_enrollments(status);
create index if not exists idx_enrollments_next_send on sequence_enrollments(next_send_at)
  where status = 'active' and next_send_at is not null;
-- ── Extend email_drafts for sequences ──────────────────────────────────────
alter table email_drafts add column if not exists sequence_id uuid references sequences(id);
alter table email_drafts add column if not exists sequence_step_id uuid references sequence_steps(id);
alter table email_drafts add column if not exists enrollment_id uuid references sequence_enrollments(id);
alter table email_drafts add column if not exists ai_reasoning text;
alter table email_drafts add column if not exists review_status text default 'pending'
  check (review_status in ('pending', 'approved', 'rejected'));
create index if not exists idx_email_drafts_sequence on email_drafts(sequence_id, review_status)
  where sequence_id is not null;
-- ── RLS policies ───────────────────────────────────────────────────────────

alter table sequences enable row level security;
create policy "sequences_select" on sequences
  for select using (user_id = auth.uid());
create policy "sequences_insert" on sequences
  for insert with check (user_id = auth.uid());
create policy "sequences_update" on sequences
  for update using (user_id = auth.uid());
create policy "sequences_delete" on sequences
  for delete using (user_id = auth.uid());
alter table sequence_steps enable row level security;
create policy "sequence_steps_select" on sequence_steps
  for select using (
    exists (select 1 from sequences s where s.id = sequence_steps.sequence_id and s.user_id = auth.uid())
  );
create policy "sequence_steps_insert" on sequence_steps
  for insert with check (
    exists (select 1 from sequences s where s.id = sequence_steps.sequence_id and s.user_id = auth.uid())
  );
create policy "sequence_steps_update" on sequence_steps
  for update using (
    exists (select 1 from sequences s where s.id = sequence_steps.sequence_id and s.user_id = auth.uid())
  );
create policy "sequence_steps_delete" on sequence_steps
  for delete using (
    exists (select 1 from sequences s where s.id = sequence_steps.sequence_id and s.user_id = auth.uid())
  );
alter table sequence_enrollments enable row level security;
create policy "enrollments_select" on sequence_enrollments
  for select using (
    exists (select 1 from sequences s where s.id = sequence_enrollments.sequence_id and s.user_id = auth.uid())
  );
create policy "enrollments_insert" on sequence_enrollments
  for insert with check (
    exists (select 1 from sequences s where s.id = sequence_enrollments.sequence_id and s.user_id = auth.uid())
  );
create policy "enrollments_update" on sequence_enrollments
  for update using (
    exists (select 1 from sequences s where s.id = sequence_enrollments.sequence_id and s.user_id = auth.uid())
  );
create policy "enrollments_delete" on sequence_enrollments
  for delete using (
    exists (select 1 from sequences s where s.id = sequence_enrollments.sequence_id and s.user_id = auth.uid())
  );

-- ===========================================
-- Source: 20260418100000_fix_signals.sql
-- ===========================================
-- Fix signal configuration and mark all standard signals as built-in
-- 2026-04-18

-- Mark all signals as built-in except ones with 'real estate' or 'listing' in the name
UPDATE signals SET is_builtin = true WHERE slug IN (
  'hiring-activity',
  'funding-news',
  'executive-changes',
  'product-launches',
  'social-engagement',
  'website-tech-stack',
  'github-stargazers',
  'google-reviews'
);
-- Also mark any custom signals as built-in if they're general-purpose
-- (user will keep real-estate-specific ones as custom)
UPDATE signals SET is_builtin = true
WHERE slug NOT IN (
  'hiring-activity', 'funding-news', 'executive-changes',
  'product-launches', 'social-engagement', 'website-tech-stack',
  'github-stargazers', 'google-reviews'
)
AND name NOT ILIKE '%real estate%'
AND name NOT ILIKE '%listing%'
AND name NOT ILIKE '%property%'
AND slug NOT ILIKE '%real-estate%'
AND slug NOT ILIKE '%listing%';
-- Fix exa_search query templates to use consistent {company} syntax
UPDATE signals SET config = jsonb_set(
  config,
  '{query}',
  to_jsonb(replace(config->>'query', '{{company}}', '{company}'))
)
WHERE execution_type = 'exa_search'
AND config->>'query' LIKE '%{{company}}%';

-- ===========================================
-- Source: 20260418200000_fix_signal_execution_types.sql
-- ===========================================
-- Fix signals that were incorrectly changed to agent_instructions
-- These should be executable types so they can run in tracking

-- github-stargazers: should be tool_call with fetchGitHubStargazers
UPDATE signals SET
  execution_type = 'tool_call',
  tool_key = 'fetchGitHubStargazers',
  config = '{"maxStargazers": 10}'::jsonb
WHERE slug = 'github-stargazers' AND execution_type = 'agent_instructions';
-- pricing-changes: should be browser_script (has a hardcoded recipe)
UPDATE signals SET
  execution_type = 'browser_script',
  tool_key = null
WHERE slug = 'pricing-changes' AND execution_type = 'agent_instructions';
-- changelog-monitor: make it exa_search so it can auto-execute
UPDATE signals SET
  execution_type = 'exa_search',
  tool_key = null,
  config = '{"query": "{company} changelog OR release notes OR what''s new", "category": "news"}'::jsonb
WHERE slug = 'changelog-monitor' AND execution_type = 'agent_instructions';
-- terms-conditions-changes: make it browser_script with extractWebContent
UPDATE signals SET
  execution_type = 'browser_script',
  tool_key = 'extractWebContent',
  config = '{"instructions": "Navigate to the terms and conditions or privacy policy page and extract key terms, dates, and changes."}'::jsonb
WHERE slug = 'terms-conditions-changes' AND execution_type = 'agent_instructions';

-- ===========================================
-- Source: 20260420000000_drop_campaign_people_status.sql
-- ===========================================
-- Drop the contact-level approval flag. Approval now lives exclusively on
-- email drafts (email_drafts.review_status). campaign_people retains
-- outreach_status for delivery tracking and priority_score for ranking.

drop index if exists idx_campaign_people_status;

alter table campaign_people
  drop column if exists status;

-- ===========================================
-- Source: 20260420010000_email_drafts_sequence_cascade.sql
-- ===========================================
-- email_drafts FKs to sequences / sequence_steps / sequence_enrollments were
-- added in 20260418000000_sequences without ON DELETE, defaulting to NO ACTION.
-- Deleting a sequence (or step/enrollment) would fail or leave drafts orphaned.
-- Re-create those FKs with ON DELETE CASCADE so cleanup works end-to-end.

alter table email_drafts
  drop constraint if exists email_drafts_sequence_id_fkey,
  drop constraint if exists email_drafts_sequence_step_id_fkey,
  drop constraint if exists email_drafts_enrollment_id_fkey;

alter table email_drafts
  add constraint email_drafts_sequence_id_fkey
    foreign key (sequence_id) references sequences(id) on delete cascade,
  add constraint email_drafts_sequence_step_id_fkey
    foreign key (sequence_step_id) references sequence_steps(id) on delete cascade,
  add constraint email_drafts_enrollment_id_fkey
    foreign key (enrollment_id) references sequence_enrollments(id) on delete cascade;

-- ===========================================
-- Source: 20260420020000_agentmail_thread_id.sql
-- ===========================================
-- Track AgentMail thread IDs on sent_emails so inbound replies (message.received
-- webhooks) can be linked back to the originating outbound message.
alter table sent_emails add column if not exists agentmail_thread_id text;
create index if not exists idx_sent_emails_thread on sent_emails(agentmail_thread_id);

-- ===========================================
-- Source: 20260421000000_handle_new_user.sql
-- ===========================================
-- Auto-create a default user_profile row whenever a new auth.users row is
-- inserted. Without this, a fresh signup lands in the app with no profile
-- and tools that read `user_profile` return empty state until something
-- (e.g. the chat agent) lazily creates one.
--
-- SECURITY DEFINER lets the trigger write to public.user_profile while
-- running in the auth trigger context.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profile (user_id, label, name, email)
  values (
    new.id,
    'Default',
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================
-- Drop legacy renamed tables
-- ===========================================
-- The original `companies` and `contacts` tables were renamed during the
-- transition to the shared `organizations` / `people` pool. Data has been
-- backfilled; the renamed tables are no longer referenced anywhere in code.
drop table if exists _companies_deprecated cascade;
drop table if exists _contacts_deprecated cascade;

-- ===========================================
-- Source: 20260419010000_add_extra_signals.sql
-- ===========================================
-- Additional built-in signals ported from the original friday dashboard.
-- Google Reviews was a committed migration in friday; the other three were
-- created at runtime via the agent's updateSignal tool and never seeded.

insert into signals (name, slug, description, long_description, category, icon, execution_type, tool_key, config, is_builtin) values
(
  'Google Reviews',
  'google-reviews',
  'Fetch Google ratings and reviews to gauge customer sentiment and reputation.',
  'Uses the Google Places API to find a company''s Google Business listing and extract their rating, review count, and recent review text. Strong ratings with high volume signal a healthy, established business. Negative review patterns can reveal pain points your product addresses. Review content provides natural conversation starters for outreach.',
  'engagement',
  'StarHalf',
  'tool_call',
  'getGoogleReviews',
  '{"maxReviews": 5}'::jsonb,
  true
),
(
  'Pricing Changes',
  'pricing-changes',
  'Track competitor and prospect pricing page changes over time.',
  'Scrapes the company''s /pricing page, extracts every tier (name, price, billing period, top features), and diffs against the last 90 days of history. Surfaces added tiers, removed tiers, and price movements. Strong buying signal when a prospect raises prices (budget expansion) or a competitor changes positioning. Backed by a hardcoded Stagehand recipe.',
  'product',
  'TrendingUp',
  'browser_script',
  null,
  '{}'::jsonb,
  true
),
(
  'Changelog Monitor',
  'changelog-monitor',
  'Watch for new releases, changelogs, and "what''s new" announcements.',
  'Uses semantic search to find recent changelog entries, release notes, and product update posts. Active shipping cadence indicates an engineering-led org investing in their product -- a proxy for budget in adjacent tooling. Fresh releases are natural outreach hooks.',
  'product',
  'Rocket',
  'exa_search',
  null,
  '{"query": "{company} changelog OR release notes OR what''s new", "category": "news"}'::jsonb,
  true
),
(
  'Terms & Conditions Changes',
  'terms-conditions-changes',
  'Detect updates to a company''s terms of service or privacy policy.',
  'Navigates to the company''s terms and conditions or privacy policy page and extracts key terms, effective dates, and material changes. Policy updates often correlate with new products, pricing models, compliance initiatives, or geographic expansion -- all timing signals for outreach.',
  'custom',
  'Globe',
  'browser_script',
  'extractWebContent',
  '{"instructions": "Navigate to the terms and conditions or privacy policy page and extract key terms, dates, and changes."}'::jsonb,
  true
)
on conflict (slug) do nothing;

-- ===========================================
-- Source: 20260420000000_replace_threshold_rules_with_intent.sql
-- ===========================================
-- Replace rigid numeric threshold_rules with a plain-English intent field.
-- An LLM evaluator (src/lib/services/intent-evaluator.ts) compares each
-- tracking run's diff against this string to decide whether to flip
-- readiness_tag and fire outreach.

alter table tracking_configs
  add column intent text not null default '';

alter table tracking_configs
  drop column threshold_rules;

-- ===========================================
-- Source: 20260421000000_email_skills.sql
-- ===========================================
-- Email skills: user-authored rule packs that are merged into the email
-- composer's system prompt at draft time. Catalog table + polymorphic
-- attachment table (scope = user / profile / campaign). Mirrors the existing
-- signals + campaign_signals pattern.

-- ── email_skills: the catalog ──────────────────────────────────────────────
create table if not exists email_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade, -- null for built-ins
  name text not null,
  slug text not null,
  description text,
  instructions text not null,
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_email_skills_slug
  on email_skills(coalesce(user_id::text, '__builtin__'), slug);
create index if not exists idx_email_skills_user on email_skills(user_id);
create index if not exists idx_email_skills_builtin on email_skills(is_builtin);

create trigger email_skills_updated_at before update on email_skills
  for each row execute function update_updated_at_column();

alter table email_skills enable row level security;

create policy "email_skills_select" on email_skills for select to authenticated
  using (is_builtin = true or user_id = auth.uid());
create policy "email_skills_insert" on email_skills for insert to authenticated
  with check (user_id = auth.uid() and is_builtin = false);
create policy "email_skills_update" on email_skills for update to authenticated
  using (user_id = auth.uid() and is_builtin = false);
create policy "email_skills_delete" on email_skills for delete to authenticated
  using (user_id = auth.uid() and is_builtin = false);

-- ── email_skill_attachments: polymorphic join ──────────────────────────────
create table if not exists email_skill_attachments (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references email_skills(id) on delete cascade,
  scope_type text not null check (scope_type in ('user', 'profile', 'campaign')),
  scope_id uuid not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (skill_id, scope_type, scope_id)
);

create index if not exists idx_email_skill_attachments_scope
  on email_skill_attachments(scope_type, scope_id) where enabled = true;
create index if not exists idx_email_skill_attachments_skill
  on email_skill_attachments(skill_id);

alter table email_skill_attachments enable row level security;

-- Scope ownership is validated per-scope via transitive ownership checks.
create policy "email_skill_attachments_select" on email_skill_attachments
  for select to authenticated using (
    (scope_type = 'user' and scope_id = auth.uid())
    or (scope_type = 'profile' and exists (
      select 1 from user_profile p where p.id = scope_id and p.user_id = auth.uid()
    ))
    or (scope_type = 'campaign' and exists (
      select 1 from campaigns c where c.id = scope_id and c.user_id = auth.uid()
    ))
  );
create policy "email_skill_attachments_insert" on email_skill_attachments
  for insert to authenticated with check (
    (scope_type = 'user' and scope_id = auth.uid())
    or (scope_type = 'profile' and exists (
      select 1 from user_profile p where p.id = scope_id and p.user_id = auth.uid()
    ))
    or (scope_type = 'campaign' and exists (
      select 1 from campaigns c where c.id = scope_id and c.user_id = auth.uid()
    ))
  );
create policy "email_skill_attachments_update" on email_skill_attachments
  for update to authenticated using (
    (scope_type = 'user' and scope_id = auth.uid())
    or (scope_type = 'profile' and exists (
      select 1 from user_profile p where p.id = scope_id and p.user_id = auth.uid()
    ))
    or (scope_type = 'campaign' and exists (
      select 1 from campaigns c where c.id = scope_id and c.user_id = auth.uid()
    ))
  );
create policy "email_skill_attachments_delete" on email_skill_attachments
  for delete to authenticated using (
    (scope_type = 'user' and scope_id = auth.uid())
    or (scope_type = 'profile' and exists (
      select 1 from user_profile p where p.id = scope_id and p.user_id = auth.uid()
    ))
    or (scope_type = 'campaign' and exists (
      select 1 from campaigns c where c.id = scope_id and c.user_id = auth.uid()
    ))
  );

-- ── Seed built-in starter skills ───────────────────────────────────────────
insert into email_skills (user_id, name, slug, description, instructions, is_builtin) values
(
  null,
  'Short & direct',
  'short-and-direct',
  'Cap cold emails at 3 sentences; no pleasantries, no preamble.',
  $$Hard limit: 3 sentences for step 1, 2 sentences for follow-ups, 1 sentence for breakup.
Cut every word that does not carry weight — no "I hope this finds you well", no "I wanted to reach out", no "just checking in".
Subject line: under 40 characters, lowercase if possible, no punctuation fluff.$$,
  true
),
(
  null,
  'Founder voice',
  'founder-voice',
  'First-person, personal, skip formality. Written like a founder typing on their phone.',
  $$Write in first person ("I", not "we" or "our team").
Tone: warm, direct, a little informal. Contractions are fine. Starting a sentence with "And" or "But" is fine.
Mention that you are the founder/builder when it is natural — it earns trust.
Avoid: corporate pronouns, marketing taglines, anything that reads like it came from a marketing team.$$,
  true
),
(
  null,
  'Lead with the trigger signal',
  'lead-with-trigger',
  'Always open with the specific signal that flagged this prospect.',
  $$The first sentence MUST reference the concrete enrichment or trigger signal that surfaced this prospect (a recent post, hiring burst, funding round, product launch, etc.).
Do not open with "I saw you at [company]" or "I came across your profile". Open with the specific artifact: the post topic, the role they are hiring, the news headline.
If no specific signal is in the context, ask for one rather than inventing a hook.$$,
  true
),
(
  null,
  'Plain text preferred',
  'plain-text-preferred',
  'Strip HTML to a minimum. One link max. No formatting fluff.',
  $$HTML body should be nothing more than a few <p> tags and at most one <a> link. No <strong>, no <em>, no lists, no tables.
Prefer a calendar-link ask only when truly warranted; default to a one-line question that invites a plain reply.
Plain-text body must be a clean mirror of the HTML — readable without any rendering.$$,
  true
),
(
  null,
  'Mirror their vocabulary',
  'mirror-their-vocabulary',
  'Use words and phrasing from the prospect''s own bio, posts, or company site.',
  $$Scan the enrichment for language the prospect actually uses — their LinkedIn headline, a recent post, their company''s website copy — and echo one or two of those exact phrases in your email.
This is not about flattery; it is about proving you read the source material.
Never copy a full sentence. One noun phrase or one verb is plenty.$$,
  true
);
