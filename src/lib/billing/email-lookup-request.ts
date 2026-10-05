"use client";
import { apiFetch } from "@/lib/api-fetch";

/** Persist before sending; ambiguous failures must retain their original key. */
export async function requestEmailLookup(
  userId: string | null | undefined,
  personId: string,
) {
  if (!userId) throw new Error("Sign in before looking up an email.");
  const storageKey = `signal:email-lookup:${userId}:${personId}`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
  }
  const res = await apiFetch("/api/find-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ personId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "Could not look up an address.");
  if (sessionStorage.getItem(storageKey) === key)
    sessionStorage.removeItem(storageKey);
  return body;
}
