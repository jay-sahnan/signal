import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
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

interface SearchResult {
  title: string;
  url: string;
  publishedDate: string | null;
  text: string | null;
}

/**
 * Uses an LLM to judge whether each search result is actually about
 * the target company, filtering out irrelevant results that happen
 * to share keywords (e.g. other dental practices, same-industry companies).
 */
export async function filterRelevantResults(
  companyName: string,
  companyDomain: string | null,
  results: SearchResult[],
): Promise<SearchResult[]> {
  if (results.length === 0) return [];

  // Results from the company's own domain are always relevant
  const fromOwnDomain: SearchResult[] = [];
  const toJudge: SearchResult[] = [];

  for (const r of results) {
    if (companyDomain && r.url.includes(companyDomain)) {
      fromOwnDomain.push(r);
    } else {
      toJudge.push(r);
    }
  }

  if (toJudge.length === 0) return fromOwnDomain;

  const summaries = toJudge.map(
    (r, i) =>
      `[${i}] "${r.title}" (${r.url})${r.text ? `\n${r.text.slice(0, 300)}` : ""}`,
  );

  try {
    const { object, usage } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      schema: z.object({
        relevant: z
          .array(z.number().int())
          .describe("Indices of results that are actually about this company"),
      }),
      prompt: `You are filtering search results for company enrichment.

${UNTRUSTED_NOTICE}

Target company name: ${stringify(companyName)}${companyDomain ? `\nTarget domain: ${stringify(companyDomain)}` : ""}

For each result below, decide if it is ACTUALLY about this target company specifically -- not a different company in the same industry, not a competitor, not a similarly-named business.

Return only the indices of results that are genuinely about this company.

Results:
${wrapUntrusted(summaries.join("\n\n"))}`,
    });

    trackUsage({
      service: "claude",
      operation: "relevance-filter",
      tokens_input: usage.inputTokens ?? 0,
      tokens_output: usage.outputTokens ?? 0,
      estimated_cost_usd: estimateClaudeCostFromUsage("haiku", usage),
      metadata: {
        model: "claude-haiku-4-5",
        companyName,
        resultCount: toJudge.length,
      },
    });

    const relevantSet = new Set(object.relevant);
    const judged = toJudge.filter((_, i) => relevantSet.has(i));
    return [...fromOwnDomain, ...judged];
  } catch (err) {
    console.error("[relevance-filter] LLM judge failed, passing all:", err);
    // Fallback: return everything rather than dropping results
    return results;
  }
}
