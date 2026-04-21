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

const MODEL_ID = "claude-haiku-4-5-20251001";
const MODEL_LABEL = "haiku";

interface SearchResultLike {
  title: string;
  url: string;
  text: string | null;
}

/**
 * Takes raw website fields (often noisy: duplicated nav copy, browser-compat
 * warnings, SEO boilerplate) and returns a clean 2-3 sentence summary.
 * Returns null on failure so callers can fall back to raw fields.
 */
export async function summarizeWebsite(input: {
  companyName: string;
  title?: string;
  description?: string;
  content?: string;
}): Promise<string | null> {
  const bodyText = [input.title, input.description, input.content]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 6000);

  if (!bodyText.trim()) return null;

  try {
    const { object, usage } = await generateObject({
      model: anthropic(MODEL_ID),
      schema: z.object({
        summary: z
          .string()
          .describe(
            "2-3 sentence overview of what the company does, plain prose.",
          ),
      }),
      prompt: `Summarize this company's website for a sales researcher. Target: 2-3 sentences, plain prose, no markdown, no bullet lists. Focus on what the company does and who they serve. Ignore navigation menus, browser-compatibility warnings, cookie banners, property listings, and repeated marketing copy.

${UNTRUSTED_NOTICE}

Company name: ${stringify(input.companyName)}

Raw scraped website text:
${wrapUntrusted(bodyText)}`,
    });

    trackUsage({
      service: "claude",
      operation: "summarize-website",
      tokens_input: usage.inputTokens ?? 0,
      tokens_output: usage.outputTokens ?? 0,
      estimated_cost_usd: estimateClaudeCostFromUsage(MODEL_LABEL, usage),
      metadata: { model: MODEL_LABEL, companyName: input.companyName },
    });

    return object.summary.trim() || null;
  } catch (err) {
    console.error("[summarize-website] failed:", err);
    return null;
  }
}

/**
 * Batch-summarize search result texts. Returns the same array shape with a
 * `summary` field added. Failures leave the original result unchanged.
 */
export async function summarizeSearchResults<T extends SearchResultLike>(
  companyName: string,
  category: string,
  results: T[],
): Promise<Array<T & { summary?: string }>> {
  if (results.length === 0) return results;

  const payload = results
    .map((r, i) => {
      const text = r.text ? r.text.slice(0, 1500) : "";
      return `[${i}] ${r.title}\n${text}`;
    })
    .join("\n\n---\n\n");

  try {
    const { object, usage } = await generateObject({
      model: anthropic(MODEL_ID),
      schema: z.object({
        summaries: z.array(
          z.object({
            index: z.number().int(),
            summary: z
              .string()
              .describe("1-2 sentences, plain prose, no markdown."),
          }),
        ),
      }),
      prompt: `Summarize each search result below as 1-2 plain-prose sentences. No markdown, no headers, no bullet lists. Focus on what the result tells a sales researcher about the target company specifically.

${UNTRUSTED_NOTICE}

Target company: ${stringify(companyName)}
Category: ${stringify(category)}

Scraped search results:
${wrapUntrusted(payload)}`,
    });

    trackUsage({
      service: "claude",
      operation: "summarize-search-results",
      tokens_input: usage.inputTokens ?? 0,
      tokens_output: usage.outputTokens ?? 0,
      estimated_cost_usd: estimateClaudeCostFromUsage(MODEL_LABEL, usage),
      metadata: {
        model: MODEL_LABEL,
        companyName,
        category,
        count: results.length,
      },
    });

    const byIndex = new Map<number, string>();
    for (const s of object.summaries) {
      if (s.summary?.trim()) byIndex.set(s.index, s.summary.trim());
    }

    return results.map((r, i) => {
      const summary = byIndex.get(i);
      return summary ? { ...r, summary } : r;
    });
  } catch (err) {
    console.error("[summarize-search-results] failed:", err);
    return results;
  }
}
