import { getAdminClient } from "@/lib/supabase/admin";
import {
  discoverCompanies,
  runSignals,
  scoreCompany,
  classifyICP,
} from "@/lib/rulebase/pipeline";
import { generateAndPostBriefing } from "@/lib/rulebase/daily-briefing";

/**
 * POST /api/pipeline
 *
 * Runs the full daily enrichment pipeline:
 * 1. Discover companies via problem-first Exa searches
 * 2. Insert into DB
 * 3. Run signals against each
 * 4. Score and classify
 * 5. Generate outreach
 * 6. Post Slack briefing with CSV links
 *
 * Can be triggered by cron (vercel.json) or manually.
 */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Allow unauthenticated in dev
    if (process.env.NODE_ENV === "production") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = getAdminClient();
  const presets = ["complaints", "sales-compliance", "qa"];
  const results: Array<{
    preset: string;
    discovered: number;
    newInserted: number;
    signalsRun: number;
    scored: number;
  }> = [];

  for (const preset of presets) {
    // Get campaign ID for this preset
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("id")
      .eq("icp_preset_slug", preset)
      .limit(1);

    if (!campaigns || campaigns.length === 0) continue;
    const campaignId = campaigns[0].id as string;

    // Step 1: Discover companies via problem-first searches
    const discovered = await discoverCompanies(preset, 15);

    let newInserted = 0;
    let signalsRun = 0;
    let scored = 0;

    for (const company of discovered) {
      if (!company.domain) continue;

      // Skip aggregator/news/government/social sites — want company domains only
      const skipDomains = [
        "reuters.com",
        "bloomberg.com",
        "cnbc.com",
        "wsj.com",
        "nytimes.com",
        "consumerfinance.gov",
        "ftc.gov",
        "sec.gov",
        "occ.gov",
        "fdic.gov",
        "govping.com",
        "changeflow.com",
        "govinfo.gov",
        "federalregister.gov",
        "trustpilot.com",
        "reddit.com",
        "bbb.org",
        "g2.com",
        "glassdoor.com",
        "indeed.com",
        "linkedin.com",
        "twitter.com",
        "facebook.com",
        "youtube.com",
        "wikipedia.org",
        "investopedia.com",
        "forbes.com",
        "propublica.org",
        "pymnts.com",
        "finextra.com",
        "americanbanker.com",
        "housingwire.com",
        "nationalmortgagenews.com",
        "medium.com",
        "substack.com",
        "techcrunch.com",
        "crunchbase.com",
        "pitchbook.com",
        "github.com",
        "stackoverflow.com",
        "auto.com",
        "marketwatch.com",
        "seekingalpha.com",
        "yahoo.com",
        "google.com",
      ];
      if (skipDomains.some((d) => company.domain!.includes(d))) continue;
      if (company.domain!.endsWith(".gov") || company.domain!.endsWith(".edu"))
        continue;

      // Check if org already exists
      const { data: existing } = await supabase
        .from("organizations")
        .select("id")
        .eq("domain", company.domain)
        .maybeSingle();

      let orgId: string;

      if (existing) {
        orgId = existing.id as string;
      } else {
        // Insert new org
        const { data: newOrg, error } = await supabase
          .from("organizations")
          .insert({
            name: company.name,
            domain: company.domain,
            source: `pipeline:${company.source}`,
            enrichment_status: "pending",
          })
          .select("id")
          .single();

        if (error || !newOrg) continue;
        orgId = newOrg.id as string;
        newInserted++;
      }

      // Link to campaign (upsert)
      // Step 4: Run signals
      const signals = await runSignals(company.name, preset);
      signalsRun++;

      // Step 5: Score
      const { score, reason, confidence, tier } = scoreCompany(signals, preset);
      classifyICP(signals, preset);

      // Build suggested approach from top fired signals
      const firedSignals = signals
        .filter((s) => s.found)
        .sort((a, b) => b.scoreBoost - a.scoreBoost);
      const suggestedApproach =
        firedSignals.length > 0
          ? firedSignals
              .slice(0, 3)
              .map((s) => `${s.signalName}: ${s.summary.slice(0, 100)}`)
              .join(". ")
          : null;

      // Upsert campaign_organizations
      // Thresholds: 9+ ready to contact, 7-8 qualified/monitoring, 5-6 discovered, <5 not ready
      await supabase.from("campaign_organizations").upsert(
        {
          campaign_id: campaignId,
          organization_id: orgId,
          relevance_score: score,
          score_reason: `[${tier}/${confidence}] ${reason}`,
          status:
            score >= 7 ? "qualified" : score >= 5 ? "discovered" : "discovered",
          readiness_tag:
            score >= 9
              ? "ready_to_contact"
              : score >= 7
                ? "monitoring"
                : "not_ready",
          suggested_approach: suggestedApproach,
        },
        { onConflict: "campaign_id,organization_id" },
      );

      // Store signal results
      for (const signal of firedSignals) {
        // Get signal ID from DB
        const { data: signalRow } = await supabase
          .from("signals")
          .select("id")
          .ilike(
            "name",
            `%${signal.signalName.split("(")[0].trim().split("/")[0].trim()}%`,
          )
          .limit(1)
          .maybeSingle();

        if (signalRow) {
          await supabase.from("signal_results").insert({
            signal_id: signalRow.id,
            campaign_id: campaignId,
            organization_id: orgId,
            output: {
              found: signal.found,
              summary: signal.summary,
              evidence: signal.evidence,
              data: { tier: signal.tier, scoreBoost: signal.scoreBoost },
              confidence: signal.confidence,
            },
            status: "success",
          });
        }
      }

      scored++;
    }

    results.push({
      preset,
      discovered: discovered.length,
      newInserted,
      signalsRun,
      scored,
    });
  }

  // Step 7: Post Slack briefing
  let briefingResult = null;
  try {
    briefingResult = await generateAndPostBriefing();
  } catch (err) {
    console.error("[pipeline] Slack briefing failed:", err);
  }

  return Response.json({
    success: true,
    pipeline: results,
    briefing: briefingResult,
    totalDiscovered: results.reduce((s, r) => s + r.discovered, 0),
    totalNew: results.reduce((s, r) => s + r.newInserted, 0),
    totalScored: results.reduce((s, r) => s + r.scored, 0),
  });
}

export async function GET(request: Request) {
  return POST(request);
}
