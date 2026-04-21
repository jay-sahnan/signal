import { z } from "zod";

import type { EmailSkill } from "@/lib/types/email-skill";

/**
 * Shared "write email" skill. Used by:
 *   - writeEmail tool (ad-hoc drafts in chat)
 *   - draftEmailsForSequence tool (server-side fan-out for sequences)
 *
 * Keep this minimal. When we want richer guidance (A/B hooks, industry
 * playbooks, etc.), extend this module rather than duplicating rules in
 * each caller.
 */

export const ComposedEmailSchema = z.object({
  subject: z.string().min(4).max(120).describe("Email subject line."),
  bodyHtml: z.string().describe("Email body as HTML."),
  bodyText: z.string().describe("Plain text version of the email body."),
  aiReasoning: z
    .string()
    .describe(
      "One or two sentences explaining which enrichment signal drove this angle.",
    ),
});

export type ComposedEmail = z.infer<typeof ComposedEmailSchema>;

export const EMAIL_SKILL_SYSTEM_PROMPT = `You are a cold-email copywriter drafting ONE personalized email at a time.

Rules:
- Keep it short: 3-5 sentences for the initial step, even shorter for follow-ups and breakups.
- Open with something SPECIFIC to this person — a recent post, a hiring signal, a company news item, an angle from their bio. If no specific hook exists, pick the strongest relevant detail from their title/company and anchor there; do NOT invent facts.
- Frame the offering in terms of the prospect's context, not generic features.
- Exactly one clear call-to-action. Low friction: a short reply, a question, a calendar link ask.
- No jargon, no buzzwords, no "synergy", no "circle back", no em-dashes in excess, no ChatGPT-flavored fluff.
- Sign off with the sender's name only (the user profile supplies it).

Step-specific guidance:
- Step 1 (initial cold): lead with the signal, connect it to the offering, end with a light ask.
- Step 2-N (follow-up, condition=no_reply or opened_no_reply): briefly reference the prior email, add one NEW angle or proof point, shorter than step 1.
- Final step (breakup): polite, one sentence acknowledging no reply, leave the door open, shortest of all.

Output format:
- \`subject\`: concrete, specific, under ~60 chars. Avoid clickbait and generic phrases like "Quick question".
- \`bodyHtml\`: use simple HTML (<p>, <br>, <a>). No inline styles, no images, no tables.
- \`bodyText\`: plain-text equivalent, preserving line breaks.
- \`aiReasoning\`: 1-2 sentences on which enrichment signal you used and why this angle.

Never invent data. If a signal isn't present in the context you were given, don't reference it.`;

/**
 * Compose the final system prompt from the base rules plus any user-authored
 * email skills attached at the user / profile / campaign scope. Stable for a
 * given (user, profile, campaign) triple so it cooperates with the ephemeral
 * prompt cache during a fan-out batch.
 */
export function buildEmailSystemPrompt(skills: EmailSkill[]): string {
  if (skills.length === 0) return EMAIL_SKILL_SYSTEM_PROMPT;
  const block = skills
    .map((s) => `## ${s.name}\n${s.instructions.trim()}`)
    .join("\n\n");
  return `${EMAIL_SKILL_SYSTEM_PROMPT}\n\n---\nCUSTOM SKILLS (user-authored rules — follow these in addition to the base rules above; when rules conflict, the custom skill wins):\n\n${block}`;
}

/**
 * Builds the per-contact user-message prompt. The system prompt above stays
 * stable across every sub-call (good for prompt caching); this varies per
 * contact.
 */
export function buildComposeUserPrompt(input: {
  contact: {
    name: string | null;
    title: string | null;
    email: string;
    enrichmentData: Record<string, unknown> | null;
  };
  company: {
    name: string | null;
    domain: string | null;
    industry: string | null;
    enrichmentData: Record<string, unknown> | null;
  } | null;
  step: {
    stepNumber: number;
    totalSteps: number;
    condition: string;
    isFinal: boolean;
  };
  campaign: {
    name: string;
    icp: Record<string, unknown> | null;
    offering: Record<string, unknown> | null;
    positioning: Record<string, unknown> | null;
  };
  senderProfile: {
    name: string | null;
    title: string | null;
    company: string | null;
    signature: string | null;
  };
  previousSubject?: string | null;
  triggerReason?: string | null;
}): string {
  const sections: string[] = [];

  sections.push(
    `STEP ${input.step.stepNumber} of ${input.step.totalSteps}${
      input.step.isFinal ? " (FINAL — breakup email)" : ""
    }, condition: ${input.step.condition}`,
  );

  if (input.previousSubject) {
    sections.push(`PREVIOUS EMAIL SUBJECT: "${input.previousSubject}"`);
  }

  if (input.triggerReason) {
    sections.push(
      `TRIGGER (why this prospect was flagged as ready to contact — use this to frame the email's opening line):\n${input.triggerReason}`,
    );
  }

  sections.push(
    `SENDER:\n- Name: ${input.senderProfile.name ?? "(not set)"}\n- Title: ${input.senderProfile.title ?? "(not set)"}\n- Company: ${input.senderProfile.company ?? "(not set)"}`,
  );

  sections.push(
    `CAMPAIGN: ${input.campaign.name}\nICP: ${JSON.stringify(input.campaign.icp ?? {})}\nOffering: ${JSON.stringify(input.campaign.offering ?? {})}\nPositioning: ${JSON.stringify(input.campaign.positioning ?? {})}`,
  );

  sections.push(
    `RECIPIENT:\n- Name: ${input.contact.name ?? "(unknown)"}\n- Title: ${input.contact.title ?? "(unknown)"}\n- Email: ${input.contact.email}`,
  );

  if (input.company) {
    sections.push(
      `RECIPIENT COMPANY:\n- Name: ${input.company.name ?? "(unknown)"}\n- Domain: ${input.company.domain ?? "(unknown)"}\n- Industry: ${input.company.industry ?? "(unknown)"}`,
    );
  }

  if (input.contact.enrichmentData) {
    sections.push(
      `RECIPIENT ENRICHMENT (LinkedIn, Twitter, news, background):\n${JSON.stringify(input.contact.enrichmentData).slice(0, 8000)}`,
    );
  }

  if (input.company?.enrichmentData) {
    sections.push(
      `COMPANY ENRICHMENT (website, news, team):\n${JSON.stringify(input.company.enrichmentData).slice(0, 6000)}`,
    );
  }

  sections.push(
    `Write the email now. Return valid JSON matching the ComposedEmail schema (subject, bodyHtml, bodyText, aiReasoning). Do NOT include any text outside the JSON.`,
  );

  return sections.join("\n\n");
}
