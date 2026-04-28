import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Daily signal briefing — called by Vercel cron every day at 8am ET.
 *
 * 1. Queries companies scored 5–10 across all active campaigns
 * 2. Stack-ranks them highest first
 * 3. Posts a summary to the Slack GTM channel
 * 4. On Mondays, includes a link to the live dashboard
 */
export async function POST(request: Request) {
  // Internal auth
  const authHeader = request.headers.get("authorization") ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "SLACK_WEBHOOK_URL not configured" },
      { status: 500 },
    );
  }

  // Get companies scored 5-10, grouped by campaign
  const { data: rows, error } = await supabase
    .from("campaign_organizations")
    .select(
      `
      relevance_score,
      score_reason,
      status,
      readiness_tag,
      organization:organizations(name, domain),
      campaign:campaigns(name, status)
    `,
    )
    .gte("relevance_score", 5)
    .order("relevance_score", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter to active campaigns only
  const scored = (rows ?? []).filter((r) => {
    const campaign = r.campaign as unknown as {
      name: string;
      status: string;
    } | null;
    return (
      campaign &&
      campaign.status !== "completed" &&
      campaign.status !== "paused"
    );
  });

  if (scored.length === 0) {
    return NextResponse.json({ message: "No scored companies found" });
  }

  // Build Slack message
  const today = new Date();
  const dayName = today.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = today.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const isMonday = today.getDay() === 1;

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://signal-rulebase.vercel.app";

  // Top 10 only, already sorted by relevance_score desc
  const top10 = scored.slice(0, 10);

  const formatCompany = (r: (typeof scored)[0], rank: number) => {
    const org = r.organization as unknown as {
      name: string;
      domain: string;
    } | null;
    const campaign = r.campaign as unknown as { name: string } | null;
    return `${rank}. *${org?.name ?? "Unknown"}* (${org?.domain ?? "—"}) — ${r.relevance_score}/10 | ${campaign?.name ?? ""}${r.score_reason ? `\n    _${r.score_reason.slice(0, 120)}_` : ""}`;
  };

  const blocks = [
    `*Signal Daily Briefing — ${dayName}, ${dateStr}*`,
    `Top 10 companies by signal strength (${scored.length} total scored 5+)\n`,
    top10.map((r, i) => formatCompany(r, i + 1)).join("\n"),
    `\n<${appUrl}|View all ${scored.length} companies in Signal →>`,
  ];

  const slackPayload = { text: blocks.join("\n") };

  // Post to Slack
  const slackRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slackPayload),
  });

  if (!slackRes.ok) {
    return NextResponse.json(
      { error: `Slack returned ${slackRes.status}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    message: "Briefing sent",
    companiesIncluded: top10.length,
    totalScored: scored.length,
  });
}
