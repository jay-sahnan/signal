-- CSV-import provenance: uploads are suggestions, not ground truth
-- 2026-08-01
--
-- Target-list imports were recording affiliation as `user_entered` (1.0) and
-- emails as `provider_found` (0.75). Both were lies about where the data came
-- from, and the first one was dangerous: a CSV is routinely an AI-generated
-- prospect list or a stale export from another tool, yet `user_entered` is the
-- human-override rank that nothing — not even a verifier proving the person
-- answers mail at a different company's domain — can ever displace.
--
-- `csv_import` names the real source so the application can rank it where it
-- belongs: strong enough to act on (imported contacts stay draftable), weak
-- enough that Signal's own verification (`email_domain`, a deliverable mailbox
-- at the employer's domain) and an explicit human edit both outrank it.
--
-- Transaction-wrapped for the same reason as 20260801000000: each CHECK has to
-- be dropped and recreated to admit the new value, and a failure between the
-- two statements would leave the column unconstrained. SET LOCAL also only
-- applies inside a transaction block.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Admit csv_import to work_email_source
-- ────────────────────────────────────────────────────────────────────────────
alter table people
  drop constraint if exists people_work_email_source_check;

alter table people
  add constraint people_work_email_source_check
    check (
      work_email_source is null
      or work_email_source in
        ('user_entered', 'send_confirmed', 'team_page', 'exa_search',
         'pattern_derived', 'provider_found', 'csv_import')
    );

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Admit csv_import to affiliation_source
-- ────────────────────────────────────────────────────────────────────────────
-- Application weight 0.85: above the send threshold (0.6) so imported contacts
-- can be drafted for immediately, below email_domain (0.95) and user_entered
-- (1.0) so machine verification and human edits can both correct a bad upload.
alter table people
  drop constraint if exists people_affiliation_source_check;

alter table people
  add constraint people_affiliation_source_check
    check (
      affiliation_source is null
      or affiliation_source in
        ('user_entered', 'email_domain', 'team_page', 'linkedin_profile',
         'llm_verified', 'search_stamp', 'csv_import')
    );

commit;
