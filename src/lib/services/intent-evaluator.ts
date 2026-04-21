import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  estimateClaudeCostFromUsage,
  trackUsage,
} from "@/lib/services/cost-tracker";
import {
  UNTRUSTED_NOTICE,
  stringify,
  wrapUntrusted,
} from "@/lib/prompt-safety";

export interface EvaluateIntentInput {
  intent: string;
  signalName: string;
  signalCategory: string;
  snapshotSummary: string;
  rawDiff?: unknown;
  isFirstRun: boolean;
}

export interface IntentVerdict {
  fire: boolean;
  reason: string;
  confidence: "high" | "medium" | "low";
}

const verdictSchema = z.object({
  fire: z.boolean(),
  reason: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

export async function evaluateIntent(
  input: EvaluateIntentInput,
): Promise<IntentVerdict> {
  if (input.isFirstRun) {
    return {
      fire: false,
      reason: "Baseline snapshot -- nothing to compare against yet.",
      confidence: "high",
    };
  }
  if (!input.intent.trim()) {
    return {
      fire: false,
      reason: "No tracking intent configured.",
      confidence: "high",
    };
  }

  const { object, usage } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: verdictSchema,
    prompt: `You decide whether the observed change on a company warrants flagging them as "ready to contact" for outreach. You have the buyer's tracking intent (their own words) and a summary of what changed since the last snapshot.

${UNTRUSTED_NOTICE}

Signal: ${stringify(input.signalName)} (category: ${stringify(input.signalCategory)})

Buyer's intent (when to flag):
${wrapUntrusted(input.intent)}

What changed since last snapshot:
${wrapUntrusted(input.snapshotSummary || "(no textual summary)")}
${
  input.rawDiff !== undefined
    ? `\nStructured diff:\n${wrapUntrusted(JSON.stringify(input.rawDiff, null, 2))}\n`
    : ""
}
Return a JSON object with:
- fire: true only if the change clearly matches the buyer's intent. Err on the side of NOT firing; false positives waste outreach quota.
- reason: one sentence citing the specific change (e.g. "Added 3 senior backend roles, matching 'scaling engineering'."). If fire=false, say briefly why the change doesn't match.
- confidence: "high" when the match is unambiguous, "medium" when it plausibly matches, "low" when you're unsure.`,
  });

  trackUsage({
    service: "claude",
    operation: "evaluate-intent",
    tokens_input: usage.inputTokens ?? 0,
    tokens_output: usage.outputTokens ?? 0,
    estimated_cost_usd: estimateClaudeCostFromUsage("haiku", usage),
    metadata: {
      signalCategory: input.signalCategory,
      fire: object.fire,
      confidence: object.confidence,
    },
  });

  return object;
}
