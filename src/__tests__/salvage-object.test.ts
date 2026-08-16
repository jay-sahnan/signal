import { describe, expect, it, vi } from "vitest";
import { NoObjectGeneratedError } from "ai";
import { z } from "zod";

import { generateWithRetry, salvageObject } from "@/lib/ai/salvage-object";

const Draft = z.object({ subject: z.string(), body: z.string() });
type Draft = z.infer<typeof Draft>;

const VALID: Draft = { subject: "quick q", body: "saw the revops req" };

/**
 * `NoObjectGeneratedError` is what the AI SDK throws when the response fails
 * schema validation, and the raw text rides along on `.text`. Salvage reads
 * exactly that field, so the fake only needs to set it.
 */
function schemaError(text: string | undefined): unknown {
  // Only `message` and `text` are read by salvage; the rest of the constructor
  // payload is response metadata the real SDK fills in.
  return new NoObjectGeneratedError({
    message: "No object generated",
    text,
  } as ConstructorParameters<typeof NoObjectGeneratedError>[0]);
}

function abortError(name: "TimeoutError" | "AbortError" | "ResponseAborted") {
  const err = new Error("aborted");
  err.name = name;
  return err;
}

describe("salvageObject", () => {
  it("returns an unwrapped payload for each observed wrapper key", () => {
    for (const key of ["value", "response", "result", "output"]) {
      const err = schemaError(JSON.stringify({ [key]: VALID }));
      expect(salvageObject(err, Draft)).toEqual(VALID);
    }
  });

  it("parses a wrapper whose payload is a JSON string, not an object", () => {
    // The `{"response": "{...}"}` shape seen live — double-encoded.
    const err = schemaError(
      JSON.stringify({ response: JSON.stringify(VALID) }),
    );
    expect(salvageObject(err, Draft)).toEqual(VALID);
  });

  it("prefers the payload as-is over unwrapping a legitimate `value` field", () => {
    const Outer = z.object({ value: z.string() });
    const err = schemaError(JSON.stringify({ value: "kept" }));
    // Unwrapping first would hand back the bare string and fail; direct-first
    // keeps a schema that genuinely owns a `value` key intact.
    expect(salvageObject(err, Outer)).toEqual({ value: "kept" });
  });

  it("gives up on malformed JSON, inside the wrapper or out", () => {
    expect(salvageObject(schemaError("not json at all"), Draft)).toBeNull();
    expect(
      salvageObject(schemaError('{"value": "{broken"}'), Draft),
    ).toBeNull();
  });

  it("keeps scanning later keys when an earlier one does not match", () => {
    const err = schemaError(JSON.stringify({ value: 42, output: VALID }));
    expect(salvageObject(err, Draft)).toEqual(VALID);
  });

  it("returns null for anything that is not a schema rejection", () => {
    expect(salvageObject(new Error("network down"), Draft)).toBeNull();
    expect(salvageObject(schemaError(undefined), Draft)).toBeNull();
    expect(salvageObject(undefined, Draft)).toBeNull();
  });

  it("returns null when the salvaged payload still does not fit", () => {
    const err = schemaError(JSON.stringify({ value: { subject: "no body" } }));
    expect(salvageObject(err, Draft)).toBeNull();
  });
});

describe("generateWithRetry", () => {
  it("passes a first-attempt success straight through", async () => {
    const run = vi.fn().mockResolvedValue(VALID);
    await expect(generateWithRetry(run, Draft)).resolves.toEqual({
      ok: true,
      value: VALID,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("salvages instead of paying for a second call", async () => {
    const run = vi
      .fn()
      .mockRejectedValue(schemaError(JSON.stringify({ value: VALID })));
    const result = await generateWithRetry(run, Draft);
    expect(result).toEqual({ ok: true, value: VALID });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries an unsalvageable failure and returns the later success", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(schemaError('{"value": "{broken'))
      .mockRejectedValueOnce(new Error("overloaded"))
      .mockResolvedValue(VALID);
    const result = await generateWithRetry(run, Draft);
    expect(result).toEqual({ ok: true, value: VALID });
    expect(run).toHaveBeenCalledTimes(3);
  });

  // The voice deck failed three attempts in a row with the bare "response did
  // not match schema" and nobody could tell which field. Bounds never reach the
  // model (apiSafeSchema strips them), so a deterministic mismatch has to be
  // named in the error or it reads as a flake forever.
  it("names the failing schema path in the reported error", async () => {
    const Bounded = z.object({ tags: z.array(z.string()).max(2) });
    const run = vi
      .fn()
      .mockRejectedValue(
        schemaError(JSON.stringify({ tags: ["a", "b", "c"] })),
      );
    const result = await generateWithRetry(run, Bounded, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("tags: too_big");
  });

  it("stops at `attempts` and reports the last error", async () => {
    const run = vi.fn().mockRejectedValue(new Error("overloaded"));
    const result = await generateWithRetry(run, Draft, 3);
    expect(result).toEqual({ ok: false, error: "overloaded" });
    expect(run).toHaveBeenCalledTimes(3);
  });

  // The regression that shipped: only "AbortError" was matched, so a deadline
  // from AbortSignal.timeout() (name "TimeoutError") fell through to the retry
  // path and burned four full attempts past the timeout it was meant to honour.
  it.each(["TimeoutError", "AbortError", "ResponseAborted"] as const)(
    "stops immediately on %s rather than retrying past the deadline",
    async (name) => {
      const run = vi.fn().mockRejectedValue(abortError(name));
      const result = await generateWithRetry(run, Draft, 4);
      expect(result).toEqual({ ok: false, error: "aborted" });
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it("still salvages a wrapped payload from an aborted attempt", async () => {
    // Order matters: salvage must run before the abort check, or a complete
    // response that arrived just as the deadline fired is thrown away.
    const err = schemaError(JSON.stringify({ value: VALID }));
    (err as Error).name = "TimeoutError";
    const run = vi.fn().mockRejectedValue(err);
    await expect(generateWithRetry(run, Draft)).resolves.toEqual({
      ok: true,
      value: VALID,
    });
  });
});
