import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  ComposedEmailSchema,
  buildComposeUserPrompt,
  buildEmailSystemPrompt,
  type ComposedEmail,
} from "./skill";
import type { EmailSkill } from "@/lib/types/email-skill";

type UserPromptInput = Parameters<typeof buildComposeUserPrompt>[0];

export type ComposeInput = UserPromptInput & {
  skills?: EmailSkill[];
};

export type ComposeResult =
  | { ok: true; email: ComposedEmail }
  | { ok: false; error: string };

/**
 * Single-email composition via generateObject. One focused Claude call per
 * contact × step. The system prompt is stable for a given (user, profile,
 * campaign, skills-set) so parallel fan-out hits prompt cache on all but the
 * first call.
 *
 * Model: Opus 4.6 — chosen for its ability to balance the base cold-email
 * rules against multiple user-authored skills that can layer or conflict.
 * Haiku 4.5 tends to drop rules when too many are stacked; Opus holds them.
 * Cost/latency are cushioned by the ephemeral prompt cache and bounded
 * concurrency in the fan-out.
 */
export async function composeEmail(
  input: ComposeInput,
): Promise<ComposeResult> {
  try {
    const { skills, ...userPromptInput } = input;
    const { object } = await generateObject({
      model: anthropic("claude-opus-4-6"),
      schema: ComposedEmailSchema,
      system: buildEmailSystemPrompt(skills ?? []),
      prompt: buildComposeUserPrompt(userPromptInput),
      providerOptions: {
        anthropic: {
          // Cache the stable system prompt across the fan-out batch.
          cacheControl: { type: "ephemeral" },
        },
      },
      maxOutputTokens: 1200,
    });
    return { ok: true, email: object };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown composition error",
    };
  }
}

/**
 * Run an async task-returning function against items with bounded concurrency.
 * Small local helper — avoids pulling in p-limit for one call site.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
