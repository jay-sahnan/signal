import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignSignal } from "@/lib/types/signal";

export async function setCampaignSignal(db: SupabaseClient, campaignId: string, signalId: string, enabled: boolean) {
  const result = await db.rpc("set_campaign_signal", { p_campaign: campaignId, p_signal: signalId, p_enabled: enabled });
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
