"use client";
import { apiFetch } from "@/lib/api-fetch";

/** Persist before sending; ambiguous failures must retain their original key. */
export async function requestCompanyEnrichment(
  userId: string | null | undefined,
  companyId: string,
  campaignId: string,
) {
  if (!userId) throw new Error("Sign in before researching a company.");
  const storageKey = `signal:company-enrichment:${userId}:${campaignId}:${companyId}`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
  }
  const res = await apiFetch("/api/enrich-company", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ companyId, campaignId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "Could not enrich this company.");
  if (sessionStorage.getItem(storageKey) === key)
    sessionStorage.removeItem(storageKey);
  return body;
}
