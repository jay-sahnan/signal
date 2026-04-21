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

export interface Candidate {
  personId: string;
  name: string | null;
  title: string | null;
  workEmail: string | null;
  linkedinUrl: string | null;
  priorityScore: number | null;
  enrichmentSummary: string | null;
}

export interface Pick {
  personId: string;
  rationale: string;
  priority: 1 | 2 | 3;
}

export interface SelectContactsInput {
  reason: string;
  signalName: string;
  signalCategory: string;
  candidates: Candidate[];
  maxPicks?: number;
}

const pickSchema = z.object({
  personId: z.string(),
  rationale: z.string(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

const verdictSchema = z.object({
  picks: z.array(pickSchema),
});

export async function selectContactsForSignal(
  input: SelectContactsInput,
): Promise<{ picks: Pick[] }> {
  const maxPicks = input.maxPicks ?? 1;

  if (input.candidates.length === 0) {
    return { picks: [] };
  }

  if (input.candidates.length === 1) {
    const only = input.candidates[0];
    return {
      picks: [
        {
          personId: only.personId,
          rationale: "Only known contact at this organization.",
          priority: 1,
        },
      ],
    };
  }

  const candidateIds = new Set(input.candidates.map((c) => c.personId));

  const candidateBlock = input.candidates
    .map((c, i) => {
      const lines = [
        `#${i + 1} personId=${c.personId}`,
        `name=${stringify(c.name ?? "unknown")}`,
        `title=${stringify(c.title ?? "unknown")}`,
        `workEmail=${c.workEmail ? "(verified)" : "(missing)"}`,
        `linkedin=${c.linkedinUrl ? "(present)" : "(missing)"}`,
        `priorityScore=${c.priorityScore ?? "null"}`,
      ];
      if (c.enrichmentSummary) {
        lines.push(`enrichmentSummary=${stringify(c.enrichmentSummary)}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const { object, usage } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: verdictSchema,
    prompt: `You are picking the best contact(s) to email at a company after a buying-signal fired. You have the reason the signal fired (in the buyer's own words, via an upstream LLM) and a list of known contacts at the company.

${UNTRUSTED_NOTICE}

Signal: ${stringify(input.signalName)} (category: ${stringify(input.signalCategory)})

Why this company was flagged as ready to contact:
${wrapUntrusted(input.reason)}

Known contacts at the company:
${wrapUntrusted(candidateBlock)}

Pick up to ${maxPicks} contact(s). Rules:
- Prefer a title that aligns with the change described in the reason. New CRO → existing VP Sales. AI launch → CTO or VP Engineering. Hiring of eng roles → VP Engineering, Head of Platform, or CTO.
- Strongly prefer contacts with a verified workEmail.
- Use priorityScore only as a tie-breaker, not the primary factor.
- Err on the side of FEWER picks. If only one contact is a clear fit, return one pick even if maxPicks is higher.
- personId MUST be copied exactly from one of the candidates above. Do not invent IDs.
- rationale: one sentence citing the specific fit between the contact and the signal reason.
- priority: 1 = send first (best fit), 2 = send if top picks fail, 3 = fallback only.`,
  });

  const validPicks: Pick[] = [];
  for (const p of object.picks) {
    if (candidateIds.has(p.personId)) {
      validPicks.push(p);
    }
  }

  trackUsage({
    service: "claude",
    operation: "select-contacts",
    tokens_input: usage.inputTokens ?? 0,
    tokens_output: usage.outputTokens ?? 0,
    estimated_cost_usd: estimateClaudeCostFromUsage("haiku", usage),
    metadata: {
      candidateCount: input.candidates.length,
      picksRequested: maxPicks,
      picksReturned: validPicks.length,
    },
  });

  return { picks: validPicks };
}
