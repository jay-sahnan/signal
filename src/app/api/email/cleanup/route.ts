import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Draft cleanup endpoint. Call via cron or QStash schedule.
 * - Deletes discarded drafts older than 7 days
 * - Deletes stale drafts (never sent) older than 30 days
 */
export async function POST() {
  const supabase = getAdminClient();

  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Delete old discarded drafts
  const { count: discardedCount } = await supabase
    .from("email_drafts")
    .delete({ count: "exact" })
    .eq("status", "discarded")
    .lt("created_at", sevenDaysAgo);

  // Delete stale unsent drafts
  const { count: staleCount } = await supabase
    .from("email_drafts")
    .delete({ count: "exact" })
    .eq("status", "draft")
    .lt("created_at", thirtyDaysAgo);

  return NextResponse.json({
    cleaned: {
      discarded: discardedCount ?? 0,
      stale: staleCount ?? 0,
    },
  });
}
