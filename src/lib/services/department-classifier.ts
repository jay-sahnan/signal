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

const SENIORITIES = ["founder", "head", "lead", "ic", "intern"] as const;
type Seniority = (typeof SENIORITIES)[number];

interface PersonInput {
  id: string;
  name: string;
  title: string | null;
  headline?: string | null;
  bio?: string | null;
}

export interface DepartmentClassification {
  id: string;
  department: string;
  seniority: Seniority;
  role_summary: string;
}

const CHUNK_SIZE = 10;
const MAX_PER_CALL = 100;

const ResponseSchema = z.object({
  classifications: z.array(
    z.object({
      id: z.string(),
      department: z
        .string()
        .describe(
          "One of: Engineering, Design, Product, GTM, Operations, Other",
        ),
      seniority: z.enum(SENIORITIES),
      role_summary: z
        .string()
        .max(140)
        .describe(
          "One-line plain-English description of what this person does",
        ),
    }),
  ),
});

export async function classifyPeople(
  companyName: string,
  people: PersonInput[],
): Promise<DepartmentClassification[]> {
  if (people.length === 0) return [];

  const trimmed = people.slice(0, MAX_PER_CALL);
  const chunks: PersonInput[][] = [];
  for (let i = 0; i < trimmed.length; i += CHUNK_SIZE) {
    chunks.push(trimmed.slice(i, i + CHUNK_SIZE));
  }

  const results: DepartmentClassification[] = [];

  for (const chunk of chunks) {
    const lines = chunk.map((p) =>
      [
        `id: ${p.id}`,
        `name: ${stringify(p.name)}`,
        `title: ${stringify(p.title ?? "(unknown)")}`,
        p.headline ? `linkedin_headline: ${stringify(p.headline)}` : null,
        p.bio ? `bio: ${stringify(p.bio.slice(0, 240))}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    const { object, usage } = await generateObject({
      model: anthropic("claude-sonnet-4-6"),
      schema: ResponseSchema,
      prompt: `You are categorising employees of ${stringify(companyName)} into departments and seniority levels for an org chart.

${UNTRUSTED_NOTICE}

For each person below, decide:
- department: one of "Engineering", "Design", "Product", "GTM", "Operations", "Other".
  - "GTM" covers sales, marketing, growth, customer success, dev rel, business development.
  - "Operations" covers HR/People, recruiting, finance, legal, biz ops, executive.
  - Use "Other" only when the title genuinely doesn't fit any of the above.
- seniority: one of "founder", "head", "lead", "ic", "intern".
  - "founder" = founder/cofounder/CEO/CTO at a small startup.
  - "head" = Head of X, VP of X, Director of X.
  - "lead" = Tech Lead, Engineering Lead, Senior Lead, Manager of a small team.
  - "ic" = individual contributor (the default for engineers, designers, AEs without "lead" in title).
  - "intern" = explicitly intern, fellow, or "prev intern".
- role_summary: one short sentence (under 140 chars) describing what they do, no marketing fluff.

Return a classification for every person.

People:
${wrapUntrusted(lines.join("\n\n"))}`,
    });

    trackUsage({
      service: "claude",
      operation: "department-classifier",
      tokens_input: usage.inputTokens ?? 0,
      tokens_output: usage.outputTokens ?? 0,
      estimated_cost_usd: estimateClaudeCostFromUsage("sonnet", usage),
      metadata: {
        model: "claude-sonnet-4-6",
        companyName,
        chunkSize: chunk.length,
      },
    });

    const byId = new Map(chunk.map((p) => [p.id, p]));
    for (const c of object.classifications) {
      if (byId.has(c.id)) results.push(c);
    }
  }

  return results;
}
