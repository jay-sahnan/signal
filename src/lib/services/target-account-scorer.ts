import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { llmTimeout } from "@/lib/utils/timeout";
import { MODELS } from "@/lib/ai/models";
import {
  estimateClaudeCostFromUsage,
  trackUsage,
} from "@/lib/services/cost-tracker";
import {
  UNTRUSTED_NOTICE,
  stringify,
  wrapUntrusted,
} from "@/lib/prompt-safety";
import type { ICP } from "@/lib/types/campaign";

/**
 * Chunked ICP-fit scorer for target-account lists (structural clone of
 * department-classifier.ts). Scores CSV-imported companies against the
 * campaign ICP/offering from base data only — no enrichment has happened
 * yet, so the rubric explicitly forbids inventing facts.
 */

const CHUNK_SIZE = 25;

/** Cap the raw-CSV context per account so one wide row can't blow the prompt. */
const MAX_RAW_CHARS = 400;

export interface TargetAccountToScore {
  organizationId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  /** Original CSV row, verbatim — may carry extra columns worth scoring on. */
  raw: Record<string, string>;
}

export interface TargetAccountScore {
  organizationId: string;
  score: number;
  reason: string;
}

const ResponseSchema = z.object({
  scores: z.array(
    z.object({
      organizationId: z.string(),
      score: z.number().min(1).max(10).describe("ICP fit score 1-10"),
      reason: z
        .string()
        .describe(
          "One short sentence (under 140 characters) grounded ONLY in the data provided",
        ),
    }),
  ),
});

function buildRubric(campaign: {
  name: string;
  icp: ICP;
  offering: unknown;
}): string {
  return `You are triaging a user-uploaded target account list against a sales campaign's Ideal Customer Profile. Score each company's ICP fit from 1-10.

Campaign: ${stringify(campaign.name)}
ICP: ${JSON.stringify(campaign.icp)}
Offering: ${JSON.stringify(campaign.offering)}

Score bands:
- 8-10: strong ICP fit — industry, size/stage, geography, and likely pain all line up. Prioritize.
- 6-7: plausible fit — matches on some dimensions, worth enriching to confirm.
- 5 or below: weak fit or insufficient signal in the data given.

Rules:
- Score ONLY from the base data given below. These companies are not enriched yet — do not invent facts, funding rounds, headcounts, or news.
- Sparse data is not disqualifying by itself, but do not score above 7 without at least one concrete matching dimension.
- reason: one sentence, under 140 characters, citing the specific fields that drove the score.
- Return a score for every company, keyed by its organizationId exactly as given.

${UNTRUSTED_NOTICE}`;
}

function accountLines(chunk: TargetAccountToScore[]): string {
  return chunk
    .map((a) => {
      const extra = JSON.stringify(a.raw ?? {});
      return [
        `organizationId: ${a.organizationId}`,
        `name: ${stringify(a.name)}`,
        `domain: ${stringify(a.domain ?? "(unknown)")}`,
        a.industry ? `industry: ${stringify(a.industry)}` : null,
        a.location ? `location: ${stringify(a.location)}` : null,
        extra !== "{}" ? `csv_row: ${extra.slice(0, MAX_RAW_CHARS)}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export async function scoreTargetAccounts(input: {
  campaign: { id: string; name: string; icp: ICP; offering: unknown };
  accounts: TargetAccountToScore[];
  userId: string;
}): Promise<TargetAccountScore[]> {
  const { campaign, accounts, userId } = input;
  if (accounts.length === 0) return [];

  const chunks: TargetAccountToScore[][] = [];
  for (let i = 0; i < accounts.length; i += CHUNK_SIZE) {
    chunks.push(accounts.slice(i, i + CHUNK_SIZE));
  }

  const rubric = buildRubric(campaign);
  const results: TargetAccountScore[] = [];

  for (const chunk of chunks) {
    const { object, usage } = await generateObject({
      abortSignal: llmTimeout(),
      model: anthropic(MODELS.STRUCTURED),
      schema: ResponseSchema,
      messages: [
        {
          role: "system",
          content: rubric,
          // The rubric + ICP block is identical across chunks (and across
          // re-runs within ~5 min) — cache it.
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
        {
          role: "user",
          content: `Companies to score:\n${wrapUntrusted(accountLines(chunk))}`,
        },
      ],
    });

    trackUsage({
      service: "claude",
      operation: "prioritize-target-accounts",
      tokens_input: usage.inputTokens ?? 0,
      tokens_output: usage.outputTokens ?? 0,
      estimated_cost_usd: estimateClaudeCostFromUsage("sonnet", usage),
      metadata: {
        model: MODELS.STRUCTURED,
        chunkSize: chunk.length,
        cache_creation_tokens: usage.inputTokenDetails?.cacheWriteTokens,
        cache_read_tokens: usage.inputTokenDetails?.cacheReadTokens,
      },
      campaign_id: campaign.id,
      user_id: userId,
    });

    // Drop hallucinated organizationIds — only ids we sent may come back.
    const sent = new Set(chunk.map((a) => a.organizationId));
    for (const s of object.scores) {
      if (sent.has(s.organizationId)) {
        results.push({
          organizationId: s.organizationId,
          score: s.score,
          reason: s.reason,
        });
      }
    }
  }

  return results;
}
