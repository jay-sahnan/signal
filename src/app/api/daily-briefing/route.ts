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
  const scored = (rows ?? []).filter(
    (r) =>
      r.campaign &&
      (r.campaign as { status: string }).status !== "completed" &&
      (r.campaign as { status: string }).status !== "paused",
  );

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

  // Group by score tier
  const tier1 = scored.filter((r) => r.relevance_score >= 8); // 8-10
  const tier2 = scored.filter(
    (r) => r.relevance_score >= 5 && r.relevance_score < 8,
  ); // 5-7

  const formatCompany = (r: (typeof scored)[0]) => {
    const org = r.organization as { name: string; domain: string } | null;
    const campaign = r.campaign as { name: string } | null;
    return `• *${org?.name ?? "Unknown"}* (${org?.domain ?? "—"}) — Score: ${r.relevance_score}/10 | ${campaign?.name ?? ""}${r.score_reason ? `\n  _${r.score_reason.slice(0, 120)}_` : ""}`;
  };

  const blocks = [
    `*Signal Daily Briefing — ${dayName}, ${dateStr}*`,
    `${scored.length} companies scored 5+ across all active campaigns.\n`,
  ];

  if (tier1.length > 0) {
    blocks.push(`*:fire: Priority Targets (8-10)*`);
    blocks.push(tier1.map(formatCompany).join("\n"));
  }

  if (tier2.length > 0) {
    blocks.push(`\n*:eyes: Monitoring (5-7)*`);
    blocks.push(tier2.map(formatCompany).join("\n"));
  }

  if (isMonday) {
    blocks.push(
      `\n:link: *Weekly dashboard:* <${appUrl}|Open Signal Dashboard>`,
    );
  }

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
    companiesIncluded: scored.length,
    isMonday,
  });
}
