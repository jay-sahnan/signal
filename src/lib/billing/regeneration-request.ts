"use client";
import { z } from "zod";
import { apiFetch } from "@/lib/api-fetch";

const responseSchema = z.object({
  ok: z.literal(true), draftId: z.string().uuid(), subject: z.string(),
  bodyHtml: z.string(), bodyText: z.string().nullable(), aiReasoning: z.string().nullable(),
});

/** Unknown outcomes retain their key until the exact saved result is recovered. */
export async function requestRegeneration(userId: string | null | undefined, draftId: string) {
  if (!userId) throw new Error("Sign in before regenerating an email.");
  const storageKey = `signal:regenerate:${JSON.stringify([userId, draftId])}`;
  let key: string;
  try {
    const saved = sessionStorage.getItem(storageKey);
    key = saved ?? crypto.randomUUID();
    if (saved === null) sessionStorage.setItem(storageKey, key);
  } catch {
    throw new Error("Enable site storage before regenerating an email. No request was sent.");
  }
  if (!z.string().uuid().safeParse(key).success)
    throw new Error("Saved regeneration request is invalid. Contact support before retrying.");
  const res = await apiFetch("/api/outreach/regenerate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ draftId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "Regeneration failed. Retry the same request.");
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success || parsed.data.draftId !== draftId)
    throw new Error("Invalid regeneration response. Retry the same request.");
  if (sessionStorage.getItem(storageKey) !== key)
    throw new Error("Regeneration request changed. Refresh the draft to see its latest content.");
  sessionStorage.removeItem(storageKey);
  return parsed.data;
}
