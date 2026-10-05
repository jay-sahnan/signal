"use client";
import { apiFetch } from "@/lib/api-fetch";

/** Freeze the work list before sending, so retries cannot expand the paid batch. */
export async function requestBulkEnrichment(
  userId: string | null | undefined,
  campaignId: string,
  organizationId: string,
  personIds: string[],
) {
  if (!userId) throw new Error("Sign in before enriching contacts.");
  const storageKey = `signal:enrichment-batch:${userId}:${campaignId}:${organizationId}`;
  const saved = sessionStorage.getItem(storageKey);
  const batch: { key: string; personIds: string[] } = saved
    ? JSON.parse(saved)
    : {
        key: crypto.randomUUID(),
        personIds: [...new Set(personIds)].slice(0, 10),
      };
  if (!batch.personIds.length)
    throw new Error("No contacts are waiting for enrichment.");
  sessionStorage.setItem(storageKey, JSON.stringify(batch));
  const res = await apiFetch("/api/enrich/bulk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": batch.key,
    },
    body: JSON.stringify({
      campaignId,
      organizationId,
      personIds: batch.personIds,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    const completed =
      typeof body?.enriched === "number" && body.enriched > 0
        ? ` ${body.enriched} contacts completed before the batch stopped.`
        : "";
    throw new Error((body?.error ?? "Enrichment batch failed.") + completed);
  }
  if (sessionStorage.getItem(storageKey) === JSON.stringify(batch))
    sessionStorage.removeItem(storageKey);
  // The server reads only frozen IDs; the UI knows which visible contacts remain.
  const remaining = new Set(
    personIds.filter((id) => !batch.personIds.includes(id)),
  ).size;
  if (remaining > (body.remaining ?? 0)) {
    body.remaining = remaining;
    if (body.summary)
      body.summary += ` ${remaining} more pending, click again.`;
  }
  return body;
}
