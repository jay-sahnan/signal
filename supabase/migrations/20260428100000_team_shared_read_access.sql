-- Team-shared read access: any authenticated user can see all campaigns,
-- companies, contacts, signals, and related data. Write operations stay
-- scoped to the owner so only you can edit your own campaigns.
--
-- This makes Michael (and anyone who signs up) see the same dashboard view.

-- ── Campaigns ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "campaigns_select" ON campaigns;
CREATE POLICY "campaigns_select" ON campaigns FOR SELECT TO authenticated
  USING (true);

-- ── Campaign child tables (SELECT via campaign join) ───────────────────────
DROP POLICY IF EXISTS "camp_orgs_select" ON campaign_organizations;
CREATE POLICY "camp_orgs_select" ON campaign_organizations FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "camp_people_select" ON campaign_people;
CREATE POLICY "camp_people_select" ON campaign_people FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "camp_signals_select" ON campaign_signals;
CREATE POLICY "camp_signals_select" ON campaign_signals FOR SELECT TO authenticated
  USING (true);

-- ── Tracking (reads via campaign) ──────────────────────────────────────────
DROP POLICY IF EXISTS "tracking_configs_select" ON tracking_configs;
CREATE POLICY "tracking_configs_select" ON tracking_configs FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "snapshots_select" ON tracking_snapshots;
CREATE POLICY "snapshots_select" ON tracking_snapshots FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "changes_select" ON tracking_changes;
CREATE POLICY "changes_select" ON tracking_changes FOR SELECT TO authenticated
  USING (true);

-- ── Outreach events ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "outreach_select" ON outreach_events;
CREATE POLICY "outreach_select" ON outreach_events FOR SELECT TO authenticated
  USING (true);

-- ── Chats (team can see all chats) ─────────────────────────────────────────
DROP POLICY IF EXISTS "chats_select" ON chats;
CREATE POLICY "chats_select" ON chats FOR SELECT TO authenticated
  USING (true);

-- ── Sequences & enrollments ────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sequences') THEN
    DROP POLICY IF EXISTS "sequences_sel" ON sequences;
    CREATE POLICY "sequences_sel" ON sequences FOR SELECT TO authenticated USING (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sequence_steps') THEN
    DROP POLICY IF EXISTS "seq_steps_sel" ON sequence_steps;
    CREATE POLICY "seq_steps_sel" ON sequence_steps FOR SELECT TO authenticated USING (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sequence_enrollments') THEN
    DROP POLICY IF EXISTS "seq_enroll_sel" ON sequence_enrollments;
    CREATE POLICY "seq_enroll_sel" ON sequence_enrollments FOR SELECT TO authenticated USING (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'email_drafts') THEN
    DROP POLICY IF EXISTS "drafts_sel" ON email_drafts;
    CREATE POLICY "drafts_sel" ON email_drafts FOR SELECT TO authenticated USING (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sent_emails') THEN
    DROP POLICY IF EXISTS "sent_sel" ON sent_emails;
    CREATE POLICY "sent_sel" ON sent_emails FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
