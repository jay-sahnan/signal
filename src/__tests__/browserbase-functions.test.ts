import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  invokeFunction,
  getInvocation,
  isTerminalStatus,
} from "@/lib/services/browserbase-functions";

const ORIGINAL_KEY = process.env.BROWSERBASE_API_KEY;

beforeEach(() => {
  process.env.BROWSERBASE_API_KEY = "test-bb-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.BROWSERBASE_API_KEY = ORIGINAL_KEY;
});

describe("invokeFunction", () => {
  it("POSTs to /v1/functions/:id/invoke with params wrapper and returns Invocation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        id: "00000000-0000-0000-0000-000000000001",
        functionId: "fn_abc",
        sessionId: "sess_1",
        status: "PENDING",
        params: { company: { name: "Stripe", domain: "stripe.com" } },
        createdAt: "2026-04-18T00:00:00Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeFunction("fn_abc", {
      company: {
        name: "Stripe",
        domain: "stripe.com",
        website: "https://stripe.com",
      },
    });

    expect(result.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(result.status).toBe("PENDING");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.browserbase.com/v1/functions/fn_abc/invoke");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-bb-api-key"]).toBe("test-bb-key");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      params: {
        company: {
          name: "Stripe",
          domain: "stripe.com",
          website: "https://stripe.com",
        },
      },
    });
  });

  it("throws a descriptive error when API returns non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "function not found",
      }),
    );

    await expect(invokeFunction("fn_missing", { company: {} })).rejects.toThrow(
      /404.*function not found/,
    );
  });

  it("throws when BROWSERBASE_API_KEY is missing", async () => {
    delete process.env.BROWSERBASE_API_KEY;
    await expect(invokeFunction("fn_x", {})).rejects.toThrow(
      /BROWSERBASE_API_KEY/,
    );
  });
});

describe("getInvocation", () => {
  it("GETs /v1/functions/invocations/:id and returns the parsed body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "inv_1",
        functionId: "fn_abc",
        sessionId: "sess_1",
        status: "COMPLETED",
        params: { company: { name: "Stripe" } },
        results: { success: true, data: { tiers: [] } },
        createdAt: "2026-04-18T00:00:00Z",
        endedAt: "2026-04-18T00:01:00Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getInvocation("inv_1");

    expect(result.status).toBe("COMPLETED");
    expect(result.results).toEqual({ success: true, data: { tiers: [] } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.browserbase.com/v1/functions/invocations/inv_1",
    );
    expect(init.method ?? "GET").toBe("GET");
    expect((init.headers as Record<string, string>)["x-bb-api-key"]).toBe(
      "test-bb-key",
    );
  });
});

describe("isTerminalStatus", () => {
  it("treats COMPLETED and FAILED as terminal", () => {
    expect(isTerminalStatus("COMPLETED")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
  });

  it("treats PENDING/RUNNING as non-terminal", () => {
    expect(isTerminalStatus("PENDING")).toBe(false);
    expect(isTerminalStatus("RUNNING")).toBe(false);
  });
});
