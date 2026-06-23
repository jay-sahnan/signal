import { generateAndPostBriefing } from "@/lib/rulebase/daily-briefing";

/**
 * POST /api/daily-briefing
 *
 * Runs LIVE Exa signal searches against top companies and posts results to Slack.
 * Every call fetches fresh data — Trustpilot reviews, regulatory actions, news, hiring.
 * Nothing stale.
 */
export async function POST(request: Request) {
  // Verify authorization
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await generateAndPostBriefing();
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[daily-briefing] Failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
