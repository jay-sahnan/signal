import { beforeEach, expect, it, vi } from "vitest";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch: fetchMock }));
import { requestRegeneration } from "@/lib/billing/regeneration-request";
const draftId = "11111111-1111-4111-8111-111111111111";
const response = () => Response.json({ ok: true, draftId, subject: "Hello", bodyHtml: "<p>Hello</p>", bodyText: null, aiReasoning: null });
const call = () => requestRegeneration("owner", draftId);
const key = (i: number) => fetchMock.mock.calls[i][1].headers["Idempotency-Key"];
beforeEach(() => { sessionStorage.clear(); fetchMock.mockReset(); });
it("retains the same operation after a lost response", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValueOnce(response());
  await expect(call()).rejects.toThrow("Disconnected"); expect(await call()).toMatchObject({ subject: "Hello" });
  expect(key(0)).toBe(key(1)); expect(sessionStorage.length).toBe(0);
});
it("retains the key through an insufficient-balance response", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Top up" }, { status: 402 })).mockResolvedValueOnce(response());
  await expect(call()).rejects.toThrow("Top up"); await call(); expect(key(0)).toBe(key(1));
});
it("keeps unknown and malformed successes unresolved", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(response());
  await expect(call()).rejects.toThrow("Invalid regeneration response"); await call(); expect(key(0)).toBe(key(1));
});
it("does not accept another draft's response", async () => {
  fetchMock.mockResolvedValue(Response.json({ ...(await response().json()), draftId: "other" }));
  await expect(call()).rejects.toThrow("Invalid regeneration response"); expect(sessionStorage.length).toBe(1);
});
it("isolates user and draft identities", async () => {
  fetchMock.mockRejectedValue(new Error("Disconnected"));
  await expect(call()).rejects.toThrow(); await expect(requestRegeneration("other", draftId)).rejects.toThrow();
  await expect(requestRegeneration("owner", "22222222-2222-4222-8222-222222222222")).rejects.toThrow();
  expect(new Set([key(0), key(1), key(2)]).size).toBe(3);
});
it("refuses to send when persistent retry state is unavailable", async () => {
  const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
  try { await expect(call()).rejects.toThrow("Enable site storage"); expect(fetchMock).not.toHaveBeenCalled(); }
  finally { blocked.mockRestore(); }
});
it("does not replace corrupt retry state", async () => {
  sessionStorage.setItem(`signal:regenerate:${JSON.stringify(["owner", draftId])}`, "");
  await expect(call()).rejects.toThrow("Saved regeneration request"); expect(fetchMock).not.toHaveBeenCalled();
});
it("refuses an older response after another invocation advanced the saved key", async () => {
  let resolveOld!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error("Disconnected"));
  const old = call(); await call(); await expect(call()).rejects.toThrow("Disconnected");
  resolveOld(response()); await expect(old).rejects.toThrow("changed");
  expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(key(2));
});
it("requires authentication before storing or sending", async () => {
  await expect(requestRegeneration(null, draftId)).rejects.toThrow("Sign in"); expect(fetchMock).not.toHaveBeenCalled();
});
