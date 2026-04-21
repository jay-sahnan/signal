import { getAdminClient } from "@/lib/supabase/admin";
import {
  verifyQStashSignature,
  getQStashClient,
  getBaseUrl,
} from "@/lib/services/qstash";
import { SCHEDULE_INTERVALS } from "@/lib/types/tracking";
import type { Schedule } from "@/lib/types/tracking";

export const maxDuration = 120;

export async function POST(request: Request) {
  // Verify QStash signature
  try {
    await verifyQStashSignature(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid signature";
    return Response.json({ error: msg }, { status: 401 });
  }

  // Find all active tracking configs that are due
  const { data: configs, error } = await getAdminClient()
    .from("tracking_configs")
    .select("id, schedule")
    .eq("status", "active")
    .lte("next_run_at", new Date().toISOString());

  if (error) {
    return Response.json(
      { error: `Failed to query tracking configs: ${error.message}` },
      { status: 500 },
    );
  }

  if (!configs || configs.length === 0) {
    return Response.json({ dispatched: 0 });
  }

  const qstash = getQStashClient();
  const baseUrl = getBaseUrl();
  let dispatched = 0;

  // Process in parallel batches to stay within 120s timeout
  const BATCH_SIZE = 20;
  for (let i = 0; i < configs.length; i += BATCH_SIZE) {
    const batch = configs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (config) => {
        await qstash.publishJSON({
          url: `${baseUrl}/api/tracking/run`,
          body: { trackingConfigId: config.id },
          retries: 2,
        });

        // Advance next_run_at
        const interval =
          SCHEDULE_INTERVALS[config.schedule as Schedule] ??
          SCHEDULE_INTERVALS.weekly;
        const nextRun = new Date(Date.now() + interval).toISOString();

        await getAdminClient()
          .from("tracking_configs")
          .update({ next_run_at: nextRun })
          .eq("id", config.id);
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") dispatched++;
      else console.error("[tracking/dispatch] Failed:", result.reason);
    }
  }

  return Response.json({ dispatched, total: configs.length });
}
