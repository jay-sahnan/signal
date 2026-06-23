import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

interface ApproachInput {
  companyName: string;
  location: string | null;
  industry: string | null;
  headcount: number | null;
  signals: Array<{ name: string; summary: string }>;
  recentNews: Array<{ title: string; date: string }>;
  hiring: { totalJobs: number; relevantRoles: string[] };
  icpPresetName: string;
  icpAngle: string;
}

/**
 * Generate a 3-4 sentence targeting recommendation using Claude Haiku.
 * Be precise — reference specific people, locations, dates, blog posts.
 */
export async function generateApproach(input: ApproachInput): Promise<string> {
  const signalBlock = input.signals
    .map((s) => `- ${s.name}: ${s.summary}`)
    .join("\n");

  const newsBlock =
    input.recentNews.length > 0
      ? input.recentNews.map((n) => `- ${n.title} (${n.date})`).join("\n")
      : "None found";

  const hiringBlock =
    input.hiring.totalJobs > 0
      ? `${input.hiring.totalJobs} open roles: ${input.hiring.relevantRoles.join(", ")}`
      : "No hiring data";

  const prompt = `You are writing a targeting recommendation for Rulebase's sales team. Rulebase sells AI-powered ${input.icpPresetName} monitoring for customer conversations.

Company: ${input.companyName}
Location: ${input.location ?? "Unknown"}
Industry: ${input.industry ?? "Unknown"}
Headcount: ${input.headcount ?? "Unknown"}

Signals detected:
${signalBlock || "None yet"}

Recent news:
${newsBlock}

Hiring: ${hiringBlock}

Targeting angle: ${input.icpAngle}

Write a 3-4 sentence targeting recommendation. Be PRECISE:
- Reference the specific signal(s) that make this company a target right now
- Mention their location, specific roles hired, or specific news items by name
- State the exact angle to lead with (e.g., "Lead with complaint detection across 100% of calls")
- If there's a specific person to target (from hiring signals), name the role

Do NOT be generic. Every sentence should contain a specific fact about this company.`;

  const { text } = await generateText({
    model: anthropic("claude-haiku-4-5-20251001"),
    prompt,
    maxOutputTokens: 300,
  });

  return text.trim();
}
