"use client";
import { z } from "zod";
import { apiFetch } from "@/lib/api-fetch";

const idsSchema = z.array(z.string().uuid()).min(1).max(10_000);
const batchSchema = z.object({ key: z.string().uuid(), remaining: idsSchema, scored: z.number().int().nonnegative() });

/** Persist the fixed queue and each batch key before sending any paid work. */
export async function requestScoreRefresh(userId: string | null | undefined, campaignId: string, ids: string[]) {
  if (!userId) throw new Error("Sign in before refreshing scores.");
  const storageKey = `signal:score-refresh:${JSON.stringify([userId, campaignId])}`;
  const storage = <T>(work: () => T): T => {
    try { return work(); } catch { throw new Error("Enable site storage to refresh scores safely, then retry."); }
  };
  let raw = storage(() => sessionStorage.getItem(storageKey));
  let batch: z.infer<typeof batchSchema>;
  if (raw !== null) {
    try { batch = batchSchema.parse(JSON.parse(raw)); }
    catch { throw new Error("Saved score refresh is invalid. Contact support before starting another request."); }
  } else {
    const selection = idsSchema.safeParse([...new Set(ids.map(id => id.toLowerCase()))].sort());
    if (!selection.success) throw new Error("Choose 1–10,000 enriched contacts to score.");
    batch = { key: crypto.randomUUID(), remaining: selection.data, scored: 0 };
  }
  for (;;) {
    if (storage(() => sessionStorage.getItem(storageKey)) !== raw)
      throw new Error("Another score refresh has advanced. Retry to resume it.");
    raw = JSON.stringify(batch);
    storage(() => sessionStorage.setItem(storageKey, raw!));
    const selection = batch.remaining.slice(0, 50);
    const response = await apiFetch("/api/refresh-scores", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": batch.key },
      body: JSON.stringify({ campaignId, campaignContactIds: selection }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Score refresh failed. Retry the same request.");
    if (!Number.isSafeInteger(body?.scored) || body.scored < 0 || body.scored > selection.length ||
        (body.scored === 0 && typeof body.message !== "string"))
      throw new Error("Invalid score response. Retry the same request.");
    if (Array.isArray(body.failedIds) && body.failedIds.length)
      throw new Error("Some scores could not be saved. Retry the same request.");
    if (storage(() => sessionStorage.getItem(storageKey)) !== raw)
      throw new Error("Another score refresh has advanced. Retry to resume it.");
    const remaining = batch.remaining.slice(50);
    if (body.scored === 0) {
      // This batch is terminal, but earlier completed batches must stay skipped.
      storage(() => sessionStorage.setItem(storageKey, JSON.stringify({ ...batch, key: crypto.randomUUID() })));
      throw new Error(`${batch.scored} contacts already scored. Current batch: ${body.message}`);
    }
    if (!remaining.length) {
      storage(() => sessionStorage.removeItem(storageKey));
      return { scored: batch.scored + body.scored };
    }
    batch = { key: crypto.randomUUID(), remaining, scored: batch.scored + body.scored };
  }
}
