import { beforeEach, expect, it, vi } from "vitest";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch: fetchMock }));
import { requestContactDiscovery } from "@/lib/billing/contact-discovery-request";
const call = (campaign = "campaign") =>
  requestContactDiscovery("owner", "contacts", "company", campaign);
const key = (i: number) =>
  fetchMock.mock.calls[i][1].headers["Idempotency-Key"];
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
});
it("reuses the saved key through network failure and clears parsed success", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Disconnected"));
  fetchMock.mockResolvedValueOnce(Response.json({ contacts: [] }));
  await expect(call()).rejects.toThrow("Disconnected");
  expect(await call()).toMatchObject({ contacts: [] });
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
    requestContactDiscovery(null, "contacts", "company", "campaign"),
  ).rejects.toThrow("Sign in");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps an unresolved key for a malformed successful response", async () => {
  fetchMock.mockResolvedValue(Response.json({ unexpected: true }));
  await expect(call()).rejects.toThrow("Invalid discovery response");
  expect(sessionStorage.length).toBe(1);
});
it("isolates broad discovery from targeted discovery and user identity", async () => {
  fetchMock.mockRejectedValue(new Error("Disconnected"));
  await expect(call()).rejects.toThrow();
  await expect(requestContactDiscovery("owner", "more", "company", "campaign")).rejects.toThrow();
  await expect(requestContactDiscovery("other", "contacts", "company", "campaign")).rejects.toThrow();
  expect(new Set([key(0), key(1), key(2)]).size).toBe(3);
});
it("clears a terminal zero-charge refusal", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: "No domain" }));
  expect(await call()).toMatchObject({ error: "No domain" });
  expect(sessionStorage.length).toBe(0);
});

it("does not send paid work when a durable retry key cannot be saved", async () => {
  const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
  try {
    await expect(call()).rejects.toThrow("Enable site storage");
    expect(fetchMock).not.toHaveBeenCalled();
  } finally { blocked.mockRestore(); }
});
