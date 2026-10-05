"use client";
import { apiFetch } from "@/lib/api-fetch";

/** Persist before sending and retain the key until a parsed terminal result. */
export async function requestContactDiscovery(
  userId: string | null | undefined,
  mode: "contacts" | "more",
  companyId: string,
  campaignId?: string | null,
) {
  if (!userId) throw new Error("Sign in before discovering contacts.");
  const storageKey = `signal:contact-discovery:${userId}:${mode}:${campaignId ?? ""}:${companyId}`;
  let key: string;
  try {
    const saved = sessionStorage.getItem(storageKey);
    key = saved ?? crypto.randomUUID();
    if (!saved) sessionStorage.setItem(storageKey, key);
  } catch {
    throw new Error("Enable site storage before starting contact discovery. No request was sent.");
  }
  const res = await apiFetch(mode === "contacts" ? "/api/find-contacts" : `/api/companies/${companyId}/find-more-people`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(mode === "contacts" ? { companyId, campaignId } : { campaignId: campaignId ?? null }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "Contact discovery failed. Retry the same request.");
  if (!body || typeof body !== "object" || !(typeof body.error === "string" ||
      (mode === "contacts" ? Array.isArray(body.contacts) : typeof body.added === "number" && typeof body.found === "number")))
    throw new Error("Invalid discovery response. Retry the same request.");
  if (sessionStorage.getItem(storageKey) === key) sessionStorage.removeItem(storageKey);
  return body;
}
