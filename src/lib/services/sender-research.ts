import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

import { apiSafeSchema } from "@/lib/ai/api-safe-schema";
import { MODELS } from "@/lib/ai/models";
import { salvageObject } from "@/lib/ai/salvage-object";
import {
  UNTRUSTED_NOTICE,
  stringify,
  wrapUntrusted,
} from "@/lib/prompt-safety";
import { FACT_CATEGORIES, type FactCategory } from "@/lib/sender-facts";
import {
  estimateClaudeCostFromUsage,
  trackUsage,
} from "@/lib/services/cost-tracker";
import { ExaService } from "@/lib/services/exa-service";
import type { UserProfile } from "@/lib/types/profile";
import { llmTimeout } from "@/lib/utils/timeout";

const MODEL_ID = MODELS.LIGHT;
const MODEL_LABEL = "haiku";

/** Per-source and total character budgets for the extraction prompt. */
const MAX_CHARS_PER_SOURCE = 6_000;
const MAX_CHARS_TOTAL = 20_000;
const MAX_FACT_LENGTH = 500;

// No count cap: the bank should be rich, and the drafter only ever picks one
// or two facts per email, so more candidates is strictly better. Per-fact
// length is enforced in factsFromModel, not here, so one runaway sentence
// drops that fact instead of failing the whole extraction.
export const ResearchedFactsSchema = z.object({
  facts: z.array(
    z.object({
      category: z.enum(FACT_CATEGORIES),
      fact: z.string(),
    }),
  ),
});

export interface ResearchedFact {
  category: FactCategory;
  fact: string;
}

export type ResearchSenderResult =
  | { ok: true; facts: ResearchedFact[] }
  | { ok: false; error: string };

/**
 * Filter the model's output down to facts we can store: known category,
 * non-empty, within length. Belt-and-braces on top of the schema — salvaged
 * payloads and future prompt drift both arrive through here.
 */
export function factsFromModel(
  raw: Array<{ category: string; fact: string }>,
): ResearchedFact[] {
  return raw.flatMap((f) => {
    const fact = f.fact?.trim();
    if (!fact) return [];
    if (fact.length > MAX_FACT_LENGTH) {
      console.warn(
        `[research-sender] dropping over-length fact (${fact.length} chars): ${fact.slice(0, 80)}...`,
      );
      return [];
    }
    if (!(FACT_CATEGORIES as readonly string[]).includes(f.category)) return [];
    return [{ category: f.category as FactCategory, fact }];
  });
}

/**
 * Same normalization as `normaliseInstructions` in swipe-prompts: lowercase,
 * collapse whitespace, strip trailing punctuation. Two facts that read the
 * same to a human must collide on this key.
 */
function factKey(fact: string): string {
  return fact
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.;,]+$/, "");
}

/**
 * Drop fresh facts already present in the existing bank, and duplicates
 * within the fresh batch itself. Comparison is on the normalized key only —
 * category differences do not make a repeated sentence a new fact.
 */
export function dedupeFacts(
  fresh: Array<{ category: string; fact: string }>,
  existing: Array<{ fact: string }>,
): Array<{ category: string; fact: string }> {
  const seen = new Set(existing.map((e) => factKey(e.fact)));
  const out: Array<{ category: string; fact: string }> = [];
  for (const f of fresh) {
    const key = factKey(f.fact);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Hostname of a profile URL, tolerating a missing protocol. Null if unparseable. */
export function hostOf(url: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Hosts where a domain restriction is not an identity restriction: everyone's
 * profile lives on the same domain, so only the exact page the user gave us
 * can be treated as theirs.
 */
const SHARED_PROFILE_HOSTS = new Set([
  "linkedin.com",
  "x.com",
  "twitter.com",
  "github.com",
  "medium.com",
]);

export function isSharedProfileHost(host: string): boolean {
  return SHARED_PROFILE_HOSTS.has(host.toLowerCase().replace(/^www\./, ""));
}

/** Same page, tolerating protocol/www/trailing-slash/query differences. */
export function sameResource(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const parsed = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
      return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}`.toLowerCase();
    } catch {
      return u.toLowerCase();
    }
  };
  return norm(a) === norm(b);
}

const EXTRACTION_SYSTEM = `Extract facts about THIS person/company for use in their own outreach emails. Only include what the sources state: never infer, embellish, or fill gaps.

Categories:
- background: career history (roles, companies, education)
- proof_point: numbers and wins (revenue, customers, growth, outcomes)
- story: anecdotes (founding stories, turning points, specific moments)
- pov: opinions they hold (takes, beliefs, contrarian positions)
- credibility: press, talks, awards, notable customer logos
- personal: interests outside work (hobbies, causes, quirks)

One sentence each, written in third person. Skip anything the sources do not clearly state about this specific person or their company. Be generous: extract every distinct fact the sources support, since a richer bank gives the email drafter more to choose from.`;

/**
 * Research the sender behind a profile: search each URL on the profile via
 * Exa (anchored to that exact URL's domain — never a bare name search, which
 * pulls namesake strangers), then extract categorized facts with one light
 * model call. No database writes here; the caller dedupes against the bank
 * and inserts.
 */
export async function researchSender(
  profile: UserProfile,
  // Attribution: neither caller runs inside a withAction context, so
  // without this the research spend lands with user_id NULL and the cost
  // center (RLS-scoped) can never show it.
  userId?: string | null,
): Promise<ResearchSenderResult> {
  const urls = [
    profile.linkedin_url,
    profile.personal_url,
    profile.company_url,
    profile.twitter_url,
  ].filter((u): u is string => Boolean(u?.trim()));

  if (urls.length === 0) {
    return {
      ok: false,
      error:
        "This profile has no URLs to research. Add a LinkedIn, website, company, or Twitter URL to the profile first.",
    };
  }

  const exa = new ExaService();
  const sources: string[] = [];
  const failures: string[] = [];

  // The URLs are independent, so they fetch concurrently; ExaService's own
  // semaphore bounds the actual parallelism. Results keep URL order so the
  // extraction prompt is stable for identical profiles.
  const fetched = await Promise.all(
    urls.map(async (url) => {
      const host = hostOf(url);
      if (!host) return { url, error: "not a valid URL" };
      try {
        // Anchor the query to the exact URL and restrict results to its
        // domain. A bare name search pulls strangers who share the name — the
        // namesake lesson from prospect enrichment.
        const result = await exa.search(url, {
          includeText: true,
          numResults: 3,
          includeDomains: [host],
        });
        // On a shared platform (linkedin.com, x.com, ...) the domain filter
        // is no identity filter at all: results 2-3 are the best OTHER
        // matches on the platform, which for a common name are namesakes.
        // The prompt then asserts all sources are "their own profile URLs",
        // so stranger facts land in the sender's bank and get woven into
        // their outreach as claims about themselves. Only the requested page
        // itself is the sender's own on these hosts; a company's own domain
        // keeps all pages.
        const own = isSharedProfileHost(host)
          ? result.results.filter((r) => sameResource(r.url, url))
          : result.results;
        const text = own
          .map((r) => `${r.title}\n${r.text ?? ""}`.trim())
          .filter(Boolean)
          .join("\n---\n")
          .slice(0, MAX_CHARS_PER_SOURCE);
        return { url, text };
      } catch (err) {
        return {
          url,
          error: err instanceof Error ? err.message : "search failed",
        };
      }
    }),
  );
  for (const f of fetched) {
    if ("text" in f && f.text) sources.push(`Source (${f.url}):\n${f.text}`);
    else if ("error" in f) failures.push(`${f.url}: ${f.error}`);
  }

  if (sources.length === 0) {
    return {
      ok: false,
      error: `Could not fetch any of the profile's URLs. ${failures.join("; ")}`,
    };
  }

  const body = sources.join("\n\n").slice(0, MAX_CHARS_TOTAL);

  const prompt = `${UNTRUSTED_NOTICE}

Person: ${stringify(profile.name)}
Company: ${stringify(profile.company_name)}

Source material scraped from their own profile URLs:
${wrapUntrusted(body)}`;

  let facts: ResearchedFact[];
  try {
    const { object, usage } = await generateObject({
      abortSignal: llmTimeout(),
      model: anthropic(MODEL_ID),
      schema: apiSafeSchema(ResearchedFactsSchema),
      system: EXTRACTION_SYSTEM,
      prompt,
      // Salvage below owns recovery; the SDK default of 2 retries would pay
      // twice for output we may already have.
      maxRetries: 0,
    });

    trackUsage({
      service: "claude",
      operation: "research-sender",
      tokens_input: usage.inputTokens ?? 0,
      tokens_output: usage.outputTokens ?? 0,
      estimated_cost_usd: estimateClaudeCostFromUsage(MODEL_LABEL, usage),
      user_id: userId ?? undefined,
      metadata: { model: MODEL_LABEL, profileId: profile.id },
    });

    facts = factsFromModel(object.facts);
  } catch (err) {
    const salvaged = salvageObject(err, ResearchedFactsSchema);
    if (!salvaged) {
      console.error("[research-sender] extraction failed:", err);
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Could not extract facts from the sources",
      };
    }
    facts = factsFromModel(salvaged.facts);
  }

  // Fresh output can repeat itself across sources; collapse before returning.
  return { ok: true, facts: dedupeFacts(facts, []) as ResearchedFact[] };
}
