import { beforeEach, expect, it, vi } from "vitest";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch: fetchMock }));
import { requestContactEnrichment } from "@/lib/billing/contact-enrichment-request";
const call = (user = "owner") =>
  requestContactEnrichment(user, "person");
const key = (i: number) =>
  fetchMock.mock.calls[i][1].headers["Idempotency-Key"];
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
});
it("keeps the same durable key across failed attempts, clearing only parsed success", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Disconnected"));
  fetchMock.mockResolvedValueOnce(
    Response.json({ status: "enriched", enrichmentData: {} }),
  );
  await expect(call()).rejects.toThrow("Disconnected");
  expect(await call()).toMatchObject({ status: "enriched" });
  expect(key(0)).toBe(key(1));
  expect(sessionStorage.length).toBe(0);
});
it("isolates users and retains unresolved billing requests", async () => {
  fetchMock.mockImplementation(async () =>
    Response.json({ error: "Pending operation" }, { status: 409 }),
  );
  for (const user of ["owner", "owner", "other", "owner"])
    await expect(call(user)).rejects.toThrow("Pending operation");
  expect(key(0)).toBe(key(1));
  expect(key(0)).toBe(key(3));
  expect(key(0)).not.toBe(key(2));
});
it("retains keys if a successful response is truncated", async () => {
  fetchMock.mockResolvedValue(new Response("truncated"));
  await expect(call()).rejects.toThrow();
  expect(sessionStorage.length).toBe(1);
});
it("fails before sending when identity or durable storage is unavailable", async () => {
  await expect(requestContactEnrichment(null, "person")).rejects.toThrow(
    "Sign in",
  );
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  await expect(call()).rejects.toThrow("Storage blocked");
  expect(fetchMock).not.toHaveBeenCalled();
  spy.mockRestore();
});
