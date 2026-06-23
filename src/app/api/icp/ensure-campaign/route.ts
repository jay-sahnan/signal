import { getSupabaseAndUser } from "@/lib/supabase/server";
import { getPreset } from "@/lib/rulebase/icp-presets";

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  const body = await request.json();
  const { presetSlug } = body as { presetSlug: string };

  if (!presetSlug) {
    return Response.json({ error: "presetSlug is required" }, { status: 400 });
  }

  const preset = getPreset(presetSlug);
  if (!preset) {
    return Response.json(
      { error: `Unknown preset: ${presetSlug}` },
      { status: 400 },
    );
  }

  // Check if a campaign already exists for this preset
  const { data: existing } = await supabase
    .from("campaigns")
    .select("id")
    .eq("icp_preset_slug", presetSlug)
    .eq("user_id", user.id)
    .limit(1);

  if (existing && existing.length > 0) {
    return Response.json({ campaignId: existing[0].id });
  }

  // Create a new campaign for this preset
  const { data: newCampaign, error: createError } = await supabase
    .from("campaigns")
    .insert({
      name: `${preset.name} Targets`,
      status: "active",
      icp_preset_slug: preset.slug,
      icp: preset.icp,
      offering: preset.offering,
      positioning: preset.positioning,
      user_id: user.id,
    })
    .select("id")
    .single();

  if (createError || !newCampaign) {
    return Response.json(
      { error: `Failed to create campaign: ${createError?.message}` },
      { status: 500 },
    );
  }

  // Apply preset signals
  const { data: signals } = await supabase
    .from("signals")
    .select("id, slug")
    .in("slug", preset.signalSlugs);

  if (signals && signals.length > 0) {
    await supabase.from("campaign_signals").upsert(
      signals.map((s) => ({
        campaign_id: newCampaign.id as string,
        signal_id: s.id as string,
        enabled: true,
        config_override: {},
      })),
      { onConflict: "campaign_id,signal_id" },
    );
  }

  return Response.json({ campaignId: newCampaign.id });
}
