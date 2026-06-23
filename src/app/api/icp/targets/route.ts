import { getSupabaseAndUser } from "@/lib/supabase/server";

/**
 * GET /api/icp/targets?preset=qa
 * Returns all companies linked to an ICP campaign, split into enriched vs pending.
 */
export async function GET(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase } = ctx;

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset") || "qa";

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id")
    .eq("icp_preset_slug", preset);

  const campaignIds = (campaigns ?? []).map((c) => c.id as string);
  if (campaignIds.length === 0) {
    return Response.json({
      enriched: [],
      pending: [],
      stats: { total: 0, enriched: 0, pending: 0 },
    });
  }

  const { data: rows } = await supabase
    .from("campaign_organizations")
    .select(
      `
      id,
      relevance_score,
      status,
      organization:organizations!inner(
        id, name, domain, industry, location, enrichment_status
      )
    `,
    )
    .in("campaign_id", campaignIds)
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .limit(500);

  const all = (rows ?? []) as unknown as Array<Record<string, unknown>>;

  const enriched: Array<Record<string, unknown>> = [];
  const pending: Array<Record<string, unknown>> = [];

  for (const row of all) {
    const org = row.organization as Record<string, unknown>;
    const item = {
      orgId: org.id,
      name: org.name,
      domain: org.domain,
      industry: org.industry,
      location: org.location,
      enrichmentStatus: org.enrichment_status,
      score: row.relevance_score,
      status: row.status,
    };
    if (row.relevance_score !== null) {
      enriched.push(item);
    } else {
      pending.push(item);
    }
  }

  return Response.json({
    enriched,
    pending,
    stats: {
      total: all.length,
      enriched: enriched.length,
      pending: pending.length,
    },
  });
}
