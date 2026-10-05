import { beforeEach, expect, it, vi } from "vitest";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch: fetchMock }));
import { requestBulkEnrichment } from "@/lib/billing/bulk-enrichment-request";
const call = (ids: string[], fresh = false) =>
  requestBulkEnrichment("owner", "campaign", "org", ids, fresh);
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
});
it("retains the original bounded selection and key through partial failure", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json(
      { error: "Insufficient credits", enriched: 2 },
      { status: 402 },
    ),
  );
  fetchMock.mockResolvedValueOnce(Response.json({ enriched: 8 }));
  await expect(
    call(Array.from({ length: 12 }, (_, i) => String(i))),
  ).rejects.toThrow("Insufficient credits");
  await call(["new-contact"]);
  const first = fetchMock.mock.calls[0][1],
    second = fetchMock.mock.calls[1][1];
  expect(JSON.parse(first.body).personIds).toHaveLength(10);
  expect(second.body).toBe(first.body);
  expect(second.headers["Idempotency-Key"]).toBe(
    first.headers["Idempotency-Key"],
  );
  expect(sessionStorage.length).toBe(0);
});
it("only explicit new work replaces the saved batch", async () => {
  fetchMock.mockImplementation(async () =>
    Response.json({ error: "Pending" }, { status: 409 }),
  );
  await expect(call(["old"])).rejects.toThrow();
  await expect(call(["new"], true)).rejects.toThrow();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).personIds).toEqual([
    "new",
  ]);
  expect(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]).not.toBe(
    fetchMock.mock.calls[0][1].headers["Idempotency-Key"],
  );
});
it("keeps the saved batch on unreadable responses", async () => {
  fetchMock.mockResolvedValue(new Response("truncated"));
  await expect(call(["one"])).rejects.toThrow();
  expect(sessionStorage.length).toBe(1);
});
it("refuses to send without a signed-in user", async () => {
  await expect(
    requestBulkEnrichment(null, "campaign", "org", ["one"]),
  ).rejects.toThrow("Sign in");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reports completed contacts when a batch stops partway through", async () => {
  fetchMock.mockResolvedValue(
    Response.json(
      { error: "Insufficient credits", enriched: 2 },
      { status: 402 },
    ),
  );
  await expect(call(["one", "two", "three"])).rejects.toThrow(
    "2 contacts completed before the batch stopped",
  );
});
