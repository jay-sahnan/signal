import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

interface EmailInput {
  contactName: string;
  contactTitle: string | null;
  companyName: string;
  companyLocation: string | null;
  companyIndustry: string | null;
  companyHeadcount: number | null;
  signals: Array<{ name: string; summary: string }>;
  recentNews: Array<{ title: string }>;
  hiring: { totalJobs: number; relevantRoles: string[] };
  icpPresetName: string;
  icpValueProp: string;
  icpAngle: string;
  senderName?: string;
  senderTitle?: string;
}

const emailSchema = z.object({
  subject: z
    .string()
    .describe("Email subject line — short, specific, no clickbait"),
  body: z.string().describe("Email body — 3-5 sentences, plain text, no HTML"),
});

/**
 * Generate a personalized cold email for a specific contact at a target company.
 * Uses Claude Haiku for speed and cost efficiency.
 */
export async function generateEmail(
  input: EmailInput,
): Promise<{ subject: string; body: string }> {
  const signalBlock = input.signals
    .map((s) => `- ${s.name}: ${s.summary}`)
    .join("\n");

  const prompt = `You are writing a cold outreach email for Rulebase. Rulebase is an AI-powered platform for ${input.icpPresetName} monitoring of customer conversations.

VALUE PROP: ${input.icpValueProp}

TARGET:
- Contact: ${input.contactName}, ${input.contactTitle ?? "Unknown title"}
- Company: ${input.companyName}, ${input.companyLocation ?? "Unknown location"}
- Industry: ${input.companyIndustry ?? "Unknown"}
- Size: ${input.companyHeadcount ? `${input.companyHeadcount} employees` : "Unknown"}

SIGNALS DETECTED (reference at least one in the email):
${signalBlock || "No specific signals — use ICP fit"}

${input.recentNews.length > 0 ? `RECENT NEWS:\n${input.recentNews.map((n) => `- ${n.title}`).join("\n")}` : ""}
${input.hiring.totalJobs > 0 ? `HIRING: ${input.hiring.totalJobs} roles open (${input.hiring.relevantRoles.join(", ")})` : ""}

ANGLE: ${input.icpAngle}

Rules:
- 3-5 sentences max
- Open with something specific about THEIR company (signal, news, hiring) — never about Rulebase
- One clear value statement tied to their specific situation
- End with a soft CTA (e.g., "Worth a conversation?" or "Open to exploring this?")
- No jargon, no buzzwords, no "I hope this finds you well"
- Reference the specific signal that triggered this outreach
- Write as ${input.senderName ?? "the Rulebase team"}${input.senderTitle ? `, ${input.senderTitle}` : ""}
- Plain text only, no HTML, no formatting`;

  const { object } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: emailSchema,
    prompt,
    maxOutputTokens: 400,
  });

  return {
    subject: object.subject,
    body: object.body,
  };
}
