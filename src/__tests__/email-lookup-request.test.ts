import { beforeEach, expect, it, vi } from "vitest";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch: fetchMock }));
import { requestEmailLookup } from "@/lib/billing/email-lookup-request";
const keys = () =>
  fetchMock.mock.calls.map(([, init]) => init.headers["Idempotency-Key"]);
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
});
it("reuses the persisted key after a network failure", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Disconnected"));
  fetchMock.mockResolvedValueOnce(Response.json({ email: null }));
  await expect(requestEmailLookup("owner", "person")).rejects.toThrow(
    "Disconnected",
  );
  await requestEmailLookup("owner", "person");
  expect(keys()[0]).toBe(keys()[1]);
  expect(sessionStorage.length).toBe(0);
});
it("preserves the key on credit rejection, and isolates users and people", async () => {
  fetchMock.mockImplementation(async () =>
    Response.json({ error: "Insufficient credits" }, { status: 402 }),
  );
  for (const [user, person] of [
    ["a", "p"],
    ["a", "p"],
    ["b", "p"],
    ["a", "q"],
  ]) {
    await expect(requestEmailLookup(user, person)).rejects.toThrow(
      "Insufficient credits",
    );
  }
  expect(keys()[0]).toBe(keys()[1]);
  expect(new Set(keys()).size).toBe(3);
});
it("retains the request when its outcome is uncertain", async () => {
  fetchMock.mockImplementation(async () =>
    Response.json({ error: "Outcome uncertain" }, { status: 409 }),
  );
  await expect(requestEmailLookup("owner", "person")).rejects.toThrow();
  await expect(requestEmailLookup("owner", "person")).rejects.toThrow();
  expect(keys()[0]).toBe(keys()[1]);
});
it("retains the key when the successful response body is unreadable", async () => {
  fetchMock.mockResolvedValue(new Response("truncated", { status: 200 }));
  await expect(requestEmailLookup("owner", "person")).rejects.toThrow();
  expect(sessionStorage.length).toBe(1);
});
it("does not start work if signed out or durable storage is unavailable", async () => {
  await expect(requestEmailLookup(null, "person")).rejects.toThrow("Sign in");
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  await expect(requestEmailLookup("owner", "person")).rejects.toThrow(
    "Storage blocked",
  );
  expect(fetchMock).not.toHaveBeenCalled();
  spy.mockRestore();
});
