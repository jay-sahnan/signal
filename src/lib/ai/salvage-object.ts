import { NoObjectGeneratedError } from "ai";
import type { z } from "zod";

/**
 * Recovers a valid object from a `generateObject` schema rejection.
 *
 * Anthropic intermittently returns a correct payload wrapped in a single
 * `value` key — `{"value": {subject, bodyHtml, ...}}` instead of the object
 * itself. Measured live at roughly 20-40% of calls on claude-opus-5, on every
 * `structuredOutputs` mode and with thinking both on and off, so it is not
 * something the request can be configured out of. The AI SDK validates the
 * outer object, finds every field missing, and throws — discarding a response
 * that was complete and correct.
 *
 * The raw text rides along on the error, so unwrapping costs nothing. Retrying
 * the call instead would pay a second time for output we already have.
 *
 * Returns null when the error isn't this case, so callers keep their existing
 * failure path for genuine problems (truncation, refusal, a real mismatch).
 */
export function salvageObject<T>(err: unknown, schema: z.ZodType<T>): T | null {
  if (!NoObjectGeneratedError.isInstance(err) || !err.text) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(err.text);
  } catch {
    return null;
  }

  // Try the payload as-is first, then unwrapped. Order matters: a schema that
  // legitimately has its own `value` field must not be unwrapped.
  const direct = schema.safeParse(raw);
  if (direct.success) return direct.data;

  if (!raw || typeof raw !== "object") return null;

  // Two wrapper shapes observed live: `{value: {...}}` (the object nested) and
  // `{response: "{...}"}` (the object as a JSON *string*). Neither is
  // requestable away, so both are unwrapped here.
  for (const key of ["value", "response", "result", "output"] as const) {
    if (!(key in raw)) continue;
    let inner = (raw as Record<string, unknown>)[key];
    if (typeof inner === "string") {
      try {
        inner = JSON.parse(inner);
      } catch {
        // The model sometimes emits malformed JSON inside the string. Nothing
        // to recover — the caller's retry handles it.
        continue;
      }
    }
    const unwrapped = schema.safeParse(inner);
    if (unwrapped.success) return unwrapped.data;
  }

  return null;
}

/**
 * "No object generated: response did not match schema." names no field, so a
 * deterministic mismatch (a bound the wire schema could not carry, an enum
 * the prompt contradicts) is indistinguishable from a flake until someone
 * reproduces it by hand. Re-derives the Zod issues from the raw text rather
 * than digging through the SDK's cause chain, whose shape is not stable.
 *
 * Returns e.g. "persona.signals: too_big", or null when there is nothing to
 * say (not a schema rejection, or the text is not JSON).
 */
export function schemaIssueSummary<T>(
  err: unknown,
  schema: z.ZodType<T>,
): string | null {
  if (!NoObjectGeneratedError.isInstance(err) || !err.text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(err.text);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return null;
  const issues = parsed.error.issues.slice(0, 5).map((i) => {
    const path = i.path.map(String).join(".") || "(root)";
    return `${path}: ${i.code}`;
  });
  return issues.join("; ");
}

/** Matches the three names the AI SDK treats as an abort rather than a failure. */
function isAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "TimeoutError" ||
    err.name === "AbortError" ||
    err.name === "ResponseAborted"
  );
}

/**
 * Runs an object generation up to `attempts` times, salvaging a wrapped payload
 * where possible and otherwise retrying.
 *
 * claude-opus-5 conforms to a structured-output schema only ~65-80% of the time
 * on these prompts (measured live across every `structuredOutputs` mode, with
 * thinking on and off). Salvage recovers the well-formed wrapper cases for free;
 * retries cover the rest, including responses whose inner JSON is malformed.
 * Without both, a fifth or more of every draft fan-out is silently lost.
 */
export async function generateWithRetry<T>(
  run: () => Promise<T>,
  schema: z.ZodType<T>,
  attempts = 4,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let lastError = "Unknown generation error";

  for (let i = 0; i < attempts; i++) {
    try {
      return { ok: true, value: await run() };
    } catch (err) {
      const salvaged = salvageObject(err, schema);
      if (salvaged) return { ok: true, value: salvaged };
      if (err instanceof Error) {
        const issues = schemaIssueSummary(err, schema);
        lastError = issues ? `${err.message} (${issues})` : err.message;
      }
      // An aborted call is a deadline, not a flake — retrying burns the budget
      // the timeout exists to protect, and four 90s attempts overrun every
      // route's maxDuration.
      //
      // All three names matter. `AbortSignal.timeout()` rejects with a
      // DOMException named "TimeoutError" (verified on Node 23), NOT
      // "AbortError" — checking only the latter made this break dead code. The
      // AI SDK treats all three as aborts and rethrows them unwrapped.
      if (isAbort(err)) break;
    }
  }

  return { ok: false, error: lastError };
}
