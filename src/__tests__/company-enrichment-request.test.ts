import { beforeEach, expect, it, vi } from "vitest";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch: fetchMock }));
import { requestCompanyEnrichment } from "@/lib/billing/company-enrichment-request";
const call = (campaign = "campaign") =>
  requestCompanyEnrichment("owner", "company", campaign);
const key = (i: number) =>
  fetchMock.mock.calls[i][1].headers["Idempotency-Key"];
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
});
it("reuses the saved key through network failure and clears parsed success", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Disconnected"));
  fetchMock.mockResolvedValueOnce(Response.json({ contactsFound: 2 }));
  await expect(call()).rejects.toThrow("Disconnected");
  expect(await call()).toMatchObject({ contactsFound: 2 });
  expect(key(0)).toBe(key(1));
  expect(sessionStorage.length).toBe(0);
});
it("isolates campaign scope without replacing unresolved requests", async () => {
  fetchMock.mockImplementation(async () =>
    Response.json({ error: "Pending" }, { status: 409 }),
  );
  await expect(call()).rejects.toThrow("Pending");
  await expect(call()).rejects.toThrow("Pending");
  await expect(call("other")).rejects.toThrow("Pending");
  expect(key(0)).toBe(key(1));
  expect(key(0)).not.toBe(key(2));
});
it("retains keys when response parsing fails", async () => {
  fetchMock.mockResolvedValue(new Response("truncated"));
  await expect(call()).rejects.toThrow();
  expect(sessionStorage.length).toBe(1);
});
it("requires a signed-in user before sending", async () => {
  await expect(
    requestCompanyEnrichment(null, "company", "campaign"),
  ).rejects.toThrow("Sign in");
  expect(fetchMock).not.toHaveBeenCalled();
});
