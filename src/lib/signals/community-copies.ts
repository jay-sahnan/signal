import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignSignal } from "@/lib/types/signal";

export async function setCampaignSignal(db: SupabaseClient, campaignId: string, signalId: string, enabled: boolean) {
  let result = await db.rpc("set_campaign_signal", { p_campaign: campaignId, p_signal: signalId, p_enabled: enabled });
  // Older self-hosted installations have not installed the owned-copy RPC.
  // Only its explicit absence permits the original RLS-protected toggle write.
  if (result.error?.code === "PGRST202") {
    result = await db.from("campaign_signals").upsert(
      { campaign_id: campaignId, signal_id: signalId, enabled },
      { onConflict: "campaign_id,signal_id" },
    ).select("*").single();
  }
  const data = (Array.isArray(result.data) ? result.data[0] : result.data) as CampaignSignal | null;
  return { ...result, data, error: result.error ?? (data ? null : { message: "Signal activation returned no result" }) };
}

/** Private rows are caller-owned under signal RLS; public copy markers cannot
 * hide somebody else's definition or a built-in from the gallery. */
export function preferPrivateSignalCopies<T extends {
  id: string; is_public?: boolean; is_builtin?: boolean; source_signal_id?: string | null;
}>(signals: T[]): T[] {
  const copied = new Set(signals.filter(signal => signal.is_public === false && !signal.is_builtin)
    .map(signal => signal.source_signal_id).filter(Boolean));
  return signals.filter(signal => signal.is_builtin || !copied.has(signal.id));
}
