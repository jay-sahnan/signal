import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * header-mapper is the LLM fallback for CSV headers COLUMN_MAP doesn't
 * recognize. The invariants: known aliases never cost an LLM call, the model
 * only ever sees the unknowns (wrapped as untrusted), hallucinated headers are
 * dropped, and any failure degrades to "ignore" — never a thrown error.
 */

const generateObjectMock = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: (model: string) => model }));
// llmTimeout() returns AbortSignal.timeout(...), whose pending timer outlives
// the test; the timeout is not under test here.
vi.mock("@/lib/utils/timeout", () => ({ llmTimeout: () => undefined }));

const trackUsageMock = vi.fn();
vi.mock("@/lib/services/cost-tracker", () => ({
  trackUsage: (...args: unknown[]) => trackUsageMock(...args),
  estimateClaudeCostFromUsage: () => 0.0001,
}));

import { mapUnknownHeaders } from "@/lib/csv/header-mapper";
import { MODELS } from "@/lib/ai/models";

function reply(mappings: Array<{ header: string; field: string }>) {
  generateObjectMock.mockResolvedValue({
    object: { mappings },
    usage: { inputTokens: 10, outputTokens: 5 },
  });
}

beforeEach(() => {
  generateObjectMock.mockReset();
  trackUsageMock.mockReset();
});

describe("mapUnknownHeaders", () => {
  it("returns {} for empty input without calling the model", async () => {
    const out = await mapUnknownHeaders([]);
    expect(out).toEqual({});
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("passes known COLUMN_MAP aliases through without an LLM call", async () => {
    const out = await mapUnknownHeaders([
      { header: "Website", samples: ["acme.com"] },
      { header: "HQ", samples: ["Berlin"] },
    ]);
    expect(out).toEqual({ Website: "domain", HQ: "location" });
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("sends only the unknown headers to the model, wrapped as untrusted", async () => {
    reply([{ header: "Web Address", field: "domain" }]);

    const out = await mapUnknownHeaders([
      { header: "Website", samples: ["acme.com"] },
      { header: "Web Address", samples: ["beta.io", "gamma.dev"] },
    ]);

    expect(out).toEqual({ Website: "domain", "Web Address": "domain" });
    expect(generateObjectMock).toHaveBeenCalledTimes(1);

    const call = generateObjectMock.mock.calls[0][0] as {
      model: string;
      prompt: string;
    };
    expect(call.model).toBe(MODELS.LIGHT);
    expect(call.prompt).toContain("<untrusted>");
    expect(call.prompt).toContain("Web Address");
    expect(call.prompt).toContain("beta.io");
    // the already-known header is not sent to the model
    const untrusted = call.prompt.slice(call.prompt.indexOf("<untrusted>"));
    expect(untrusted).not.toContain("Website");
  });

  it("drops hallucinated headers and defaults omitted ones to ignore", async () => {
    reply([
      { header: "Ghost Column", field: "name" },
      { header: "Web Address", field: "domain" },
    ]);

    const out = await mapUnknownHeaders([
      { header: "Web Address", samples: ["beta.io"] },
      { header: "Mystery", samples: ["???"] },
    ]);

    expect(out).toEqual({ "Web Address": "domain", Mystery: "ignore" });
    expect(out["Ghost Column"]).toBeUndefined();
  });

  it("drops mappings whose field is not a canonical value", async () => {
    reply([{ header: "Web Address", field: "person_email" }]);

    const out = await mapUnknownHeaders([
      { header: "Web Address", samples: ["beta.io"] },
    ]);

    expect(out).toEqual({ "Web Address": "ignore" });
  });

  it("falls back to ignore for every unknown header when the model fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    // Malformed response exercises the same catch as a thrown error without
    // vitest attributing a mock-thrown error to the test itself.
    generateObjectMock.mockResolvedValue({ object: null, usage: {} });

    const out = await mapUnknownHeaders([
      { header: "Website", samples: ["acme.com"] },
      { header: "Mystery", samples: ["???"] },
    ]);

    expect(out).toEqual({ Website: "domain", Mystery: "ignore" });
    quiet.mockRestore();
  });

  it("tracks usage per call with the csv-header-mapper operation", async () => {
    reply([{ header: "Web Address", field: "domain" }]);

    await mapUnknownHeaders([{ header: "Web Address", samples: ["beta.io"] }], {
      userId: "user_1",
    });

    expect(trackUsageMock).toHaveBeenCalledTimes(1);
    expect(trackUsageMock.mock.calls[0][0]).toMatchObject({
      service: "claude",
      operation: "csv-header-mapper",
      user_id: "user_1",
    });
  });
});
