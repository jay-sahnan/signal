import { isHostedMode } from "@/lib/auth/workspace";
import { executePaidAction } from "@/lib/billing/paid-action";
import { CreditExecutionError, NoBillableWork } from "@/lib/billing/credit-execution";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

import { apiSafeSchema } from "@/lib/ai/api-safe-schema";
import { MODELS } from "@/lib/ai/models";
import { getProfileForPrompt } from "@/lib/profile";
import {
  estimateClaudeCostFromUsage,
  trackUsage,
  withAction,
} from "@/lib/services/cost-tracker";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import {
  UNTRUSTED_NOTICE,
  stringify,
  wrapUntrusted,
} from "@/lib/prompt-safety";

export const maxDuration = 120;

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { campaignId } = body as { campaignId: string };
  if (!campaignId) {
    return Response.json({ error: "campaignId is required" }, { status: 400 });
  }

  const hosted = isHostedMode();
  const boundedSelection = hosted || body.campaignContactIds !== undefined;
  let selectedIds: string[] = [];
  const key = request.headers.get("Idempotency-Key");
  if (boundedSelection) {
    const selection = z.array(z.string().uuid()).min(1).max(50).safeParse(body.campaignContactIds);
    if (!selection.success || (hosted && !z.string().uuid().safeParse(key).success))
      return Response.json({ error: "Select 1–50 campaign contacts and provide a stable operation UUID" }, { status: 400 });
    selectedIds = selection.data.map(id => id.toLowerCase()).sort();
    if (new Set(selectedIds).size !== selectedIds.length)
      return Response.json({ error: "Duplicate campaign contacts" }, { status: 400 });
  }

  // Fetch campaign ICP (also serves as ownership check -- defense in depth
  // layered on top of RLS)
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("name, icp, offering, positioning, user_id")
    .eq("id", campaignId)
    .single();

  if (campaignError || !campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch campaign_people linked to enriched people
  let selectionQuery = supabase
    .from("campaign_people")
    .select(
      "id, person_id, person:people(id, name, title, linkedin_url, twitter_url, enrichment_data, enrichment_status, organization:organizations!organization_id(name, domain, industry, enrichment_data))",
    )
    .eq("campaign_id", campaignId);
  if (boundedSelection) selectionQuery = selectionQuery.in("id", selectedIds);
  const { data: links, error: linksError } = await selectionQuery;

  if (linksError) {
    return Response.json(
      { error: `Failed to fetch contacts: ${linksError.message}` },
      { status: 500 },
    );
  }

  if (boundedSelection && (links?.length !== selectedIds.length || links.some(link => !selectedIds.includes(link.id))))
    return Response.json({ error: "Selected campaign contacts not found" }, { status: 404 });

  // Filter to only enriched people
  const enrichedLinks = (links || []).filter((l) => {
    const person = l.person as unknown as {
      enrichment_status: string;
    } | null;
    return person?.enrichment_status === "enriched";
  });

  let enteredWork = false;
  const work = () => withAction(
    `Score contacts: ${campaign.name}`,
    async () => {
      enteredWork = true;
      if (hosted && enrichedLinks.length !== selectedIds.length)
        return new NoBillableWork({ scored: 0, message: "All selected contacts must be enriched. No credits were charged. Start a new request after enriching them." });
      if (enrichedLinks.length === 0) {
        return {
          scored: 0,
          message: "No enriched contacts to score",
        };
      }

      const profile = await getProfileForPrompt(campaignId);

      // Build a compact summary of each contact for scoring
      const contactSummaries = enrichedLinks.map((l) => {
        const person = l.person as unknown as Record<string, unknown>;
        const enrichment = person.enrichment_data as Record<
          string,
          unknown
        > | null;
        const org = person.organization as {
          name?: string;
          domain?: string;
          industry?: string;
        } | null;

        const summary: Record<string, unknown> = {
          id: l.id, // campaign_people link ID
          name: person.name,
          title: person.title,
          company: org?.name || "Unknown",
          industry: org?.industry || null,
        };

        // Include LinkedIn headline and recent post topics
        const linkedin = enrichment?.linkedin as {
          profileInfo?: { headline?: string };
          posts?: Array<{ text: string }>;
        } | null;
        if (linkedin?.profileInfo?.headline) {
          summary.headline = linkedin.profileInfo.headline;
        }
        if (linkedin?.posts && linkedin.posts.length > 0) {
          summary.recentPostTopics = linkedin.posts
            .slice(0, 3)
            .map((p) => p.text.slice(0, 150));
        }

        // Include Twitter bio
        const twitter = enrichment?.twitter as {
          user?: { description?: string; followers_count?: number };
        } | null;
        if (twitter?.user?.description) {
          summary.twitterBio = twitter.user.description;
        }

        return summary;
      });

      // Build the scoring prompt
      const profileContext = profile
        ? `User Profile:\n- Name: ${profile.name || "N/A"}\n- Role: ${profile.role_title || "N/A"}\n- Company: ${profile.company_name || "N/A"}\n- Offering: ${profile.offering_summary || "N/A"}\n- Notes: ${profile.notes || "N/A"}`
        : "No user profile available.";

      const result = await generateObject({
        model: anthropic(MODELS.STRUCTURED),
        schema: apiSafeSchema(
          z.object({
            scores: z.array(
              z.object({
                id: z.string().describe("Campaign-people link ID"),
                score: z
                  .number()
                  .min(1)
                  .max(10)
                  .describe("Priority score 1-10"),
                reason: z
                  .string()
                  .describe(
                    "2-3 sentence reason explaining why to reach out to this person, referencing specific signals",
                  ),
              }),
            ),
          }),
        ),
        // Cache the schema + tool bindings generated from `schema`. Cross-call
        // cache hits only kick in when a rescore lands within ~5 min of the
        // previous one, but when batches land together this saves 90% on the
        // scoring-schema overhead.
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
        prompt: `Score each contact's outreach priority from 1-10 based on these dimensions:

- **Personal Connection** -- Shared industry/background with the user, mutual topics in posts, geographic proximity
- **Timing Signals** -- Recent job change, relevant recent posts, company news
- **Role Fit** -- Title matches ICP target titles, decision-making authority
- **Reachability** -- Active on social, publishes content

8-10: Strong personal connection angle + recent timing signal. Contact first.
5-7: Good role fit, some personalization hooks but no urgent signal.
1-4: Poor fit or unreachable.

The reason must answer "why reach out to this person NOW" with specific data points.

${UNTRUSTED_NOTICE}

User profile context:
${wrapUntrusted(profileContext)}

Campaign: ${stringify(campaign.name)}
ICP: ${wrapUntrusted(JSON.stringify(campaign.icp))}
Offering: ${wrapUntrusted(JSON.stringify(campaign.offering))}

Contacts to score (enrichment data scraped from LinkedIn, Twitter, news):
${wrapUntrusted(JSON.stringify(contactSummaries, null, 2))}`,
      });

      trackUsage({
        service: "claude",
        operation: "score-contacts",
        tokens_input: result.usage.inputTokens ?? 0,
        tokens_output: result.usage.outputTokens ?? 0,
        estimated_cost_usd: estimateClaudeCostFromUsage("sonnet", result.usage),
        metadata: {
          model: "claude-sonnet-4",
          contactsScored: result.object.scores.length,
          cache_creation_tokens:
            result.usage.inputTokenDetails?.cacheWriteTokens,
          cache_read_tokens: result.usage.inputTokenDetails?.cacheReadTokens,
        },
        campaign_id: campaignId,
        user_id: user.id,
      });

      const allowed = new Set(enrichedLinks.map(link => link.id));
      const returned = result.object.scores.map(score => score.id);
      if (boundedSelection && (returned.length !== allowed.size || new Set(returned).size !== returned.length || returned.some(id => !allowed.has(id))))
        throw new Error("Scoring returned an invalid contact selection");

      // Batch update scores on campaign_people junction table. Each write's
      // outcome is read: query builders never reject, so a bare Promise.all
      // reported every row scored while failed writes and LLM-hallucinated
      // link ids (a 0-row match returns no error) silently persisted nothing.
      const outcomes = await Promise.all(
        result.object.scores.map(async (s) => {
          const { data: updated, error } = await supabase
            .from("campaign_people")
            .update({ priority_score: s.score, score_reason: s.reason })
            .eq("id", s.id)
            .eq("campaign_id", campaignId)
            .select("id");
          if (error || !updated || updated.length === 0) {
            console.error(
              `[refresh-scores] score write matched nothing for ${s.id}:`,
              error?.message ?? "0 rows",
            );
            return { id: s.id, stored: false };
          }
          return { id: s.id, stored: true };
        }),
      );

      const stored = outcomes.filter((o) => o.stored).length;
      const failedIds = outcomes.filter((o) => !o.stored).map((o) => o.id);

      if (hosted && failedIds.length > 0)
        throw new Error("Score persistence failed; credits remain reserved for reconciliation");
      return {
        scored: stored,
        ...(failedIds.length > 0 ? { failedIds } : {}),
        scores: result.object.scores,
      };
    },
    user.id,
  ); // end withAction
  try {
    const result = hosted ? await executePaidAction({ identity: { userId: user.id, source: "web" }, key,
      kind: "contact.score", units: selectedIds.length, request: { campaignId, campaignContactIds: selectedIds } }, work) : await work();
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof CreditExecutionError ? error.message : hosted && enteredWork
      ? "Score refresh outcome is uncertain. Credits remain reserved; contact support to reconcile this request."
      : "Score refresh failed. Retry the same request." },
      { status: error instanceof CreditExecutionError ? error.status : 500 });
  }
}
