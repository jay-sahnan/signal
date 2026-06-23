import { getSupabaseAndUser } from "@/lib/supabase/server";
import { getPreset, getPresetSignalSlugs } from "@/lib/rulebase/icp-presets";

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase } = ctx;

  const body = await request.json();
  const { campaignId, presetSlug } = body as {
    campaignId: string;
    presetSlug: string;
  };

  if (!campaignId || !presetSlug) {
    return Response.json(
      { error: "campaignId and presetSlug are required" },
      { status: 400 },
    );
  }

  const preset = getPreset(presetSlug);
  if (!preset) {
    return Response.json(
      { error: `Unknown preset: ${presetSlug}` },
      { status: 400 },
    );
  }

  // Update campaign with preset data
  const { error: updateError } = await supabase
    .from("campaigns")
    .update({
      icp_preset_slug: preset.slug,
      icp: preset.icp,
      offering: preset.offering,
      positioning: preset.positioning,
    })
    .eq("id", campaignId);

  if (updateError) {
    return Response.json(
      { error: `Failed to update campaign: ${updateError.message}` },
      { status: 500 },
    );
  }

  // Auto-enable mapped signals
  const signalSlugs = getPresetSignalSlugs(presetSlug);

  if (signalSlugs.length > 0) {
    // Look up signal IDs by slug
    const { data: signals } = await supabase
      .from("signals")
      .select("id, slug")
      .in("slug", signalSlugs);

    if (signals && signals.length > 0) {
      // Upsert campaign_signals for each mapped signal
      const upserts = signals.map((s) => ({
        campaign_id: campaignId,
        signal_id: s.id as string,
        enabled: true,
        config_override: {},
      }));

      const { error: signalError } = await supabase
        .from("campaign_signals")
        .upsert(upserts, { onConflict: "campaign_id,signal_id" });

      if (signalError) {
        console.error("Failed to enable signals:", signalError.message);
      }
    }
  }

  return Response.json({
    success: true,
    preset: preset.slug,
    signalsEnabled: signalSlugs.length,
  });
}
