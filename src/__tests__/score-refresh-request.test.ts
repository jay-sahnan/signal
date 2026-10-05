import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch: fetchMock }));
import { requestScoreRefresh } from "@/lib/billing/score-refresh-request";
const ids = Array.from({ length: 51 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`);
const sent = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body);
const key = (i: number) => fetchMock.mock.calls[i][1].headers["Idempotency-Key"];
const ok = (count: number) => Response.json({ scored: count });
beforeEach(() => { sessionStorage.clear(); fetchMock.mockReset(); });
afterEach(() => vi.restoreAllMocks());
it("freezes contacts and reuses the key after losing a response", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValueOnce(ok(1));
  await expect(requestScoreRefresh("user", "campaign", [ids[0]])).rejects.toThrow("Disconnected");
  expect(await requestScoreRefresh("user", "campaign", [ids[1]])).toMatchObject({ scored: 1 });
  expect(sent(1).campaignContactIds).toEqual([ids[0]]); expect(key(0)).toBe(key(1));
  expect(sessionStorage.length).toBe(0);
});
it("resumes the failed batch without repeating completed batches", async () => {
  fetchMock.mockResolvedValueOnce(ok(50)).mockResolvedValueOnce(Response.json({ error: "Insufficient credits" }, { status: 402 })).mockResolvedValueOnce(ok(1));
  await expect(requestScoreRefresh("user", "campaign", ids)).rejects.toThrow("Insufficient credits");
  expect(sent(0).campaignContactIds).toHaveLength(50); expect(sent(1).campaignContactIds).toHaveLength(1);
  expect(key(0)).not.toBe(key(1));
  expect(await requestScoreRefresh("user", "campaign", ids)).toMatchObject({ scored: 51 });
  expect(sent(2)).toEqual(sent(1)); expect(key(2)).toBe(key(1));
});
it("retains an unresolved batch after malformed successful JSON", async () => {
  fetchMock.mockResolvedValue(Response.json({ unexpected: true }));
  await expect(requestScoreRefresh("user", "campaign", [ids[0]])).rejects.toThrow("response");
  expect(sessionStorage.length).toBe(1);
});
it("refuses to send if retry state cannot be persisted", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
  await expect(requestScoreRefresh("user", "campaign", [ids[0]])).rejects.toThrow("storage");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("isolates users and campaigns", async () => {
  fetchMock.mockRejectedValue(new Error("Disconnected"));
  for (const [user, campaign] of [["one", "a"], ["two", "a"], ["one", "b"]])
    await expect(requestScoreRefresh(user, campaign, [ids[0]])).rejects.toThrow();
  expect(new Set([key(0), key(1), key(2)]).size).toBe(3);
});
it("replaces a terminal zero-charge key without losing completed batches", async () => {
  fetchMock.mockResolvedValueOnce(ok(50)).mockResolvedValueOnce(Response.json({ scored: 0, message: "Enrich contacts and start a new request" })).mockResolvedValueOnce(ok(1));
  await expect(requestScoreRefresh("user", "campaign", ids)).rejects.toThrow("Enrich contacts");
  expect(await requestScoreRefresh("user", "campaign", ids)).toEqual({ scored: 51 });
  expect(sent(2)).toEqual(sent(1)); expect(key(2)).not.toBe(key(1));
  expect(sessionStorage.length).toBe(0);
});
it("keeps corrupt saved work instead of replacing its retry identity", async () => {
  sessionStorage.setItem('signal:score-refresh:["user","campaign"]', "");
  await expect(requestScoreRefresh("user", "campaign", ids)).rejects.toThrow("Saved score refresh is invalid");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("does not let an older response clear a newer score refresh", async () => {
  const replies: Array<(response: Response) => void> = [];
  fetchMock.mockImplementation(() => new Promise<Response>(resolve => { replies.push(resolve); }));
  const first = requestScoreRefresh("user", "campaign", [ids[0]]);
  const second = requestScoreRefresh("user", "campaign", [ids[0]]);
  replies[0](ok(1)); await first;
  const third = requestScoreRefresh("user", "campaign", [ids[1]]);
  const stale = expect(second).rejects.toThrow("Another score refresh has advanced");
  replies[1](ok(1)); await stale;
  expect(key(0)).toBe(key(1)); expect(key(2)).not.toBe(key(0));
  expect(sessionStorage.length).toBe(1);
  replies[2](ok(1)); await third;
});
