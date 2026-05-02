-- Department + seniority on people, populated by Claude during enrichment.
-- Used by the company org chart at /companies/[id] to lay people out
-- in department clusters with vertical seniority ordering.

alter table people
  add column if not exists department text,
  add column if not exists seniority text
    check (seniority in ('founder','head','lead','ic','intern')),
  add column if not exists role_summary text;

create index if not exists idx_people_org_department
  on people(organization_id, department);
