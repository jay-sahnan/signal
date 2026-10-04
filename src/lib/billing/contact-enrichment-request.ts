"use client";
import { apiFetch } from "@/lib/api-fetch";

/** Persist before sending; ambiguous failures must retain their original key. */
export async function requestContactEnrichment(
  userId: string | null | undefined,
  contactId: string,
) {
  if (!userId) throw new Error("Sign in before enriching a contact.");
  const storageKey = `signal:contact-enrichment:${userId}:${contactId}`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
  }
  const res = await apiFetch("/api/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ contactId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "Could not enrich this contact.");
  if (sessionStorage.getItem(storageKey) === key)
    sessionStorage.removeItem(storageKey);
  return body;
}
