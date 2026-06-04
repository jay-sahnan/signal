-- Fix: campaigns created before multi-tenant migration have user_id = NULL.
-- The strict RLS policy (auth.uid() = user_id) silently rejects all those rows,
-- causing the campaigns page to return empty results.
-- Allow NULL user_id rows to be visible to any authenticated user until they
-- are backfilled with an owner.

DROP POLICY IF EXISTS "campaigns_select" ON campaigns;
CREATE POLICY "campaigns_select" ON campaigns FOR SELECT TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS "campaigns_update" ON campaigns;
CREATE POLICY "campaigns_update" ON campaigns FOR UPDATE TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS "campaigns_delete" ON campaigns;
CREATE POLICY "campaigns_delete" ON campaigns FOR DELETE TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);
