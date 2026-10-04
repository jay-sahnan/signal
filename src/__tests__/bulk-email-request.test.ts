import { beforeEach, expect, it, vi } from "vitest";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch: fetchMock }));
import { requestBulkEmailLookup } from "@/lib/billing/bulk-email-request";
const request = (ids: string[], fresh = false) =>
  requestBulkEmailLookup("owner", "campaign", "org", ids, fresh);
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
});
it("retries the frozen batch even if the current contact list changes", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Disconnected"));
  fetchMock.mockResolvedValueOnce(Response.json({ found: [] }));
  await expect(request(["one", "two"])).rejects.toThrow();
  expect((await request(["two", "three"])).remaining).toBe(1);
  const first = fetchMock.mock.calls[0][1];
  const second = fetchMock.mock.calls[1][1];
  expect(second.body).toBe(first.body);
  expect(second.headers["Idempotency-Key"]).toBe(
    first.headers["Idempotency-Key"],
  );
  expect(sessionStorage.length).toBe(0);
});
it("keeps credit-denied batches until explicit new work is selected", async () => {
  fetchMock.mockImplementation(async () =>
    Response.json({ error: "Insufficient credits" }, { status: 402 }),
  );
  await expect(request(["one"])).rejects.toThrow("Insufficient credits");
  await expect(request(["two"], true)).rejects.toThrow("Insufficient credits");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).personIds).toEqual([
    "two",
  ]);
  expect(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]).not.toBe(
    fetchMock.mock.calls[0][1].headers["Idempotency-Key"],
  );
});
