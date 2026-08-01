import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { llmTimeout } from "@/lib/utils/timeout";
import { z } from "zod";
import { MODELS } from "@/lib/ai/models";
import {
  estimateClaudeCostFromUsage,
  trackUsage,
} from "@/lib/services/cost-tracker";
import { UNTRUSTED_NOTICE, wrapUntrusted } from "@/lib/prompt-safety";
import {
  CANONICAL_FIELDS,
  COLUMN_MAP,
  type CanonicalField,
} from "@/lib/csv/company-csv";

/**
 * LLM fallback for CSV headers COLUMN_MAP didn't recognize: given each header
 * plus a few sample values, ask Haiku to map it to a canonical company field
 * or "ignore". Known aliases are resolved from COLUMN_MAP first and never
 * cost an LLM call. Falls back to "ignore" for every unknown header on any
 * error (permissive-fallback convention from relevance-filter.ts).
 */

export interface HeaderSample {
  header: string;
  /** Up to ~3 sample values from the column, for disambiguation. */
  samples: string[];
}

export type HeaderMapping = CanonicalField | "ignore";

const VALID_FIELDS = new Set<string>([...CANONICAL_FIELDS, "ignore"]);

const ResponseSchema = z.object({
  mappings: z.array(
    z.object({
      header: z.string(),
      field: z.enum([...CANONICAL_FIELDS, "ignore"] as [string, ...string[]]),
    }),
  ),
});

export async function mapUnknownHeaders(
  headers: HeaderSample[],
  context?: { campaignId?: string; userId?: string },
): Promise<Record<string, HeaderMapping>> {
  const result: Record<string, HeaderMapping> = {};
  if (headers.length === 0) return result;

  // COLUMN_MAP first: known aliases pass through without an LLM call.
  const unknown: HeaderSample[] = [];
  for (const h of headers) {
    const known = COLUMN_MAP[h.header.toLowerCase().trim()];
    if (known) {
      result[h.header] = known;
    } else {
      unknown.push(h);
    }
  }
  if (unknown.length === 0) return result;

  // Default every unknown to "ignore"; the model upgrades what it recognizes.
  for (const h of unknown) result[h.header] = "ignore";

  const lines = unknown.map(
    (h) =>
      `header: ${h.header}\nsamples: ${h.samples.slice(0, 3).join(" | ") || "(none)"}`,
  );

  try {
    const { object, usage } = await generateObject({
      abortSignal: llmTimeout(),
      model: anthropic(MODELS.LIGHT),
      schema: ResponseSchema,
      prompt: `You are mapping CSV column headers from a user-uploaded company list to canonical fields.

${UNTRUSTED_NOTICE}

Map each header below to exactly one of: ${CANONICAL_FIELDS.join(", ")}, ignore.
- "name" is the company name, "domain" a bare domain like acme.com, "url" a full link.
- Use the sample values to disambiguate (e.g. a column of city names is "location").
- Use "ignore" for anything that is not clearly one of the canonical company fields (ids, dates, scores, personal names, emails, free-form notes).

Return a mapping for every header, using the header text exactly as given.

Headers:
${wrapUntrusted(lines.join("\n\n"))}`,
    });

    trackUsage({
      service: "claude",
      operation: "csv-header-mapper",
      tokens_input: usage.inputTokens ?? 0,
      tokens_output: usage.outputTokens ?? 0,
      estimated_cost_usd: estimateClaudeCostFromUsage("haiku", usage),
      campaign_id: context?.campaignId,
      user_id: context?.userId,
      metadata: {
        model: MODELS.LIGHT,
        headerCount: unknown.length,
      },
    });

    const inputHeaders = new Set(unknown.map((h) => h.header));
    for (const m of object.mappings) {
      // Drop hallucinated headers and out-of-enum fields.
      if (!inputHeaders.has(m.header)) continue;
      if (!VALID_FIELDS.has(m.field)) continue;
      result[m.header] = m.field as HeaderMapping;
    }
  } catch (err) {
    console.error(
      "[header-mapper] LLM mapping failed, ignoring unknown headers:",
      err,
    );
    // result already holds "ignore" for every unknown header.
  }

  return result;
}
