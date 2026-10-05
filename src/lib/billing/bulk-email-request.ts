"use client";
import { apiFetch } from "@/lib/api-fetch";

/** Freeze the work list before sending, so retries cannot expand the paid batch. */
export async function requestBulkEmailLookup(
  userId: string | null | undefined,
  campaignId: string,
  organizationId: string,
  personIds: string[],
  newAttempt = false,
) {
  if (!userId) throw new Error("Sign in before looking up emails.");
  const storageKey = `signal:email-batch:${userId}:${campaignId}:${organizationId}`;
  const saved = newAttempt ? null : sessionStorage.getItem(storageKey);
  const batch: { key: string; personIds: string[] } = saved
    ? JSON.parse(saved)
    : {
        key: crypto.randomUUID(),
        personIds: [...new Set(personIds)].slice(0, 50),
      };
  if (!batch.personIds.length)
    throw new Error("No eligible contacts are waiting for email lookup.");
  sessionStorage.setItem(storageKey, JSON.stringify(batch));
  const res = await apiFetch("/api/find-email/bulk", {
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
  if (!res.ok) throw new Error(body?.error ?? "Email batch failed.");
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
