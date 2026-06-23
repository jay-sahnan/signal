import { generateAndPostPostHogDigest } from "@/lib/rulebase/posthog-digest";

/**
 * POST /api/posthog-digest
 *
 * Queries yesterday's PostHog events, summarizes usage/friction/errors
 * with Claude, and posts the digest to the dev Slack channel.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await generateAndPostPostHogDigest();
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[posthog-digest] Failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
