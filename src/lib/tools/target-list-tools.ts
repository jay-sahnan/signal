import { tool } from "ai";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getQStashClient, getBaseUrl } from "@/lib/services/qstash";
import {
  scoreTargetAccounts,
  type TargetAccountToScore,
} from "@/lib/services/target-account-scorer";
import type { ICP, Offering } from "@/lib/types/campaign";

/**
 * Agent tools for target account lists (user-uploaded CSVs resolved to the
 * shared organizations pool). Lists are a lens over that pool: scores and
 * qualification live on campaign_organizations, so linking a list to a
 * campaign is what makes it scoreable.
 */

/** Supabase caps reads at 1000 rows — page through big lists. */
const PAGE_SIZE = 1000;
/** Bulk writes go in chunks so one giant list can't blow a single request. */
const UPSERT_CHUNK = 500;
/** Rough all-in enrichment cost per account (Exa + scraping + Claude). */
const ENRICH_COST_PER_ACCOUNT_USD = 0.08;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface ListAccountRow {
  organization_id: string;
  raw: Record<string, string>;
  organization: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    location: string | null;
  } | null;
}

/** Load every account row for a list, paged past the 1000-row read cap. */
async function loadAllListAccounts(
  supabase: SupabaseClient,
  listId: string,
): Promise<ListAccountRow[]> {
  const rows: ListAccountRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("target_accounts")
      .select(
        "organization_id, raw, organization:organizations(id, name, domain, industry, location)",
      )
      .eq("list_id", listId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error)
      throw new Error(`Failed to load list accounts: ${error.message}`);
    const page = (data ?? []) as unknown as ListAccountRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadListOrFail(supabase: SupabaseClient, listId: string) {
  const { data, error } = await supabase
    .from("target_account_lists")
    .select("id, name, original_filename, row_count, created_at, updated_at")
    .eq("id", listId)
    .single();
  if (error || !data) {
    throw new Error(
      `Target list not found (or not yours): ${error?.message ?? listId}`,
    );
  }
  return data;
}

export const getTargetLists = tool({
  description:
    "List the user's uploaded target account lists, newest first, with row counts. " +
    "Use this when the user mentions an uploaded list and you need its ID.",
  inputSchema: z.object({}),
  execute: async () => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("target_account_lists")
      .select("id, name, original_filename, row_count, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Failed to list target lists: ${error.message}`);
    return { lists: data ?? [] };
  },
});

export const getTargetList = tool({
  description:
    "Get one target account list: metadata, the first 25 accounts (org name, domain, " +
    "enrichment status), and counts (total, enriched, queued for enrichment). " +
    "Quote enrichment progress from these counts — do not poll in a loop.",
  inputSchema: z.object({
    listId: z.string().uuid().describe("Target account list ID"),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const list = await loadListOrFail(supabase, input.listId);

    const { data: accountRows, error: accountsError } = await supabase
      .from("target_accounts")
      .select(
        "organization_id, enrich_requested_at, organization:organizations(name, domain, enrichment_status)",
      )
      .eq("list_id", input.listId)
      .order("created_at", { ascending: true })
      .limit(25);
    if (accountsError)
      throw new Error(`Failed to load accounts: ${accountsError.message}`);

    const { count: total } = await supabase
      .from("target_accounts")
      .select("id", { count: "exact", head: true })
      .eq("list_id", input.listId);

    const { count: enriched } = await supabase
      .from("target_accounts")
      .select("id, organizations!inner(enrichment_status)", {
        count: "exact",
        head: true,
      })
      .eq("list_id", input.listId)
      .eq("organizations.enrichment_status", "enriched");

    // Same join + filters as the processor's picker (pickEnrichBatch): only
    // stamped rows whose org is still pending are real in-flight work —
    // already-enriched orgs drain instantly and must not count as queued.
    const { count: enrichQueued } = await supabase
      .from("target_accounts")
      .select("id, organizations!inner(enrichment_status)", {
        count: "exact",
        head: true,
      })
      .eq("list_id", input.listId)
      .not("enrich_requested_at", "is", null)
      .eq("organizations.enrichment_status", "pending");

    const accounts = (accountRows ?? []).map((row) => {
      const org = row.organization as unknown as {
        name: string;
        domain: string | null;
        enrichment_status: string;
      } | null;
      return {
        organizationId: row.organization_id,
        name: org?.name ?? "(unknown)",
        domain: org?.domain ?? null,
        enrichmentStatus: org?.enrichment_status ?? "pending",
        enrichQueued: row.enrich_requested_at != null,
      };
    });

    return {
      list,
      accounts,
      counts: {
        total: total ?? 0,
        enriched: enriched ?? 0,
        enrichQueued: enrichQueued ?? 0,
      },
    };
  },
});

export const linkTargetListToCampaign = tool({
  description:
    "Link every account in a target list to a campaign (bulk, idempotent). Creates " +
    "campaign_organizations memberships so the list can be prioritized and worked, and " +
    "also links any contacts imported with the list (campaign_people, status pending). " +
    "Run this before prioritizeTargetAccounts.",
  inputSchema: z.object({
    listId: z.string().uuid().describe("Target account list ID"),
    campaignId: z.string().uuid().describe("Campaign to link the list into"),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    await loadListOrFail(supabase, input.listId);

    const accounts = await loadAllListAccounts(supabase, input.listId);
    const orgIds = [...new Set(accounts.map((a) => a.organization_id))];
    if (orgIds.length === 0) {
      return { linked: 0, alreadyLinked: 0, peopleLinked: 0 };
    }

    // Bulk upsert memberships. ignoreDuplicates means the returned rows are
    // exactly the ones newly inserted — that's our `linked` count.
    let linked = 0;
    for (const ids of chunk(orgIds, UPSERT_CHUNK)) {
      const { data, error } = await supabase
        .from("campaign_organizations")
        .upsert(
          ids.map((organizationId) => ({
            campaign_id: input.campaignId,
            organization_id: organizationId,
          })),
          { onConflict: "campaign_id,organization_id", ignoreDuplicates: true },
        )
        .select("organization_id");
      if (error)
        throw new Error(`Failed to link organizations: ${error.message}`);
      linked += data?.length ?? 0;
    }

    // Contacts imported with the list (contact-per-row files) ride along:
    // link people at these orgs so outreach machinery can see them. Only
    // list-imported contacts — the orgs live in a shared pool, and people
    // discovered by other campaigns/users must not be swept into this one.
    const personIds: string[] = [];
    for (const ids of chunk(orgIds, UPSERT_CHUNK)) {
      const { data, error } = await supabase
        .from("people")
        .select("id")
        .in("organization_id", ids)
        .eq("source", "target_list");
      if (error)
        throw new Error(`Failed to load imported contacts: ${error.message}`);
      personIds.push(...(data ?? []).map((p: { id: string }) => p.id));
    }

    let peopleLinked = 0;
    for (const ids of chunk(personIds, UPSERT_CHUNK)) {
      const { data, error } = await supabase
        .from("campaign_people")
        .upsert(
          ids.map((personId) => ({
            campaign_id: input.campaignId,
            person_id: personId,
            status: "pending",
          })),
          { onConflict: "campaign_id,person_id", ignoreDuplicates: true },
        )
        .select("person_id");
      if (error) throw new Error(`Failed to link contacts: ${error.message}`);
      peopleLinked += data?.length ?? 0;
    }

    return { linked, alreadyLinked: orgIds.length - linked, peopleLinked };
  },
});

export const prioritizeTargetAccounts = tool({
  description:
    "Triage a linked target list against the campaign ICP: scores unscored accounts 1-10 " +
    "(qualified >= 6), then returns the top slice with the estimated enrichment cost. " +
    "Requires the campaign to have an ICP with target titles — if it doesn't, interview " +
    "the user and saveCampaign first. Present the top slice and the quoted cost to the " +
    "user; NEVER call enrichTargetAccounts without the user approving the quoted cost. " +
    "Accounts with importedContacts > 0 may not need contact finding (skipContactFinding).",
  inputSchema: z.object({
    listId: z.string().uuid().describe("Target account list ID"),
    campaignId: z
      .string()
      .uuid()
      .describe("Campaign whose ICP to score against"),
    topFraction: z
      .number()
      .min(0.01)
      .max(1)
      .default(0.1)
      .describe(
        "Fraction of the list to surface as the enrichment candidate slice (default 0.1)",
      ),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const { userId } = await auth();

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, name, icp, offering")
      .eq("id", input.campaignId)
      .single();
    if (campaignError || !campaign) {
      throw new Error(
        `Campaign not found: ${campaignError?.message ?? input.campaignId}`,
      );
    }

    // Hard gate: never spend LLM tokens scoring against an empty ICP.
    const icp = (campaign.icp ?? {}) as ICP;
    if (!icp.targetTitles?.length) {
      return {
        error:
          "This campaign has no ICP yet. Interview the user (who do they want to reach? " +
          "what are they selling?) and call saveCampaign with targetTitles before prioritizing.",
      };
    }

    const accounts = await loadAllListAccounts(supabase, input.listId);
    if (accounts.length === 0) {
      return {
        error:
          "This list has no accounts (or it isn't yours). Check the list ID with getTargetLists.",
      };
    }

    // The list must be linked — scores live on campaign_organizations.
    const orgIds = [...new Set(accounts.map((a) => a.organization_id))];
    const memberships: Array<{
      organization_id: string;
      relevance_score: number | null;
      score_reason: string | null;
    }> = [];
    for (const ids of chunk(orgIds, UPSERT_CHUNK)) {
      const { data, error } = await supabase
        .from("campaign_organizations")
        .select("organization_id, relevance_score, score_reason")
        .eq("campaign_id", input.campaignId)
        .in("organization_id", ids);
      if (error)
        throw new Error(`Failed to load memberships: ${error.message}`);
      memberships.push(...(data ?? []));
    }
    if (memberships.length === 0) {
      return {
        error:
          "This list isn't linked to the campaign yet. Call linkTargetListToCampaign first.",
      };
    }

    // Score only unscored rows (score 0/null) so re-runs are cheap.
    const accountByOrg = new Map(accounts.map((a) => [a.organization_id, a]));
    const toScore: TargetAccountToScore[] = memberships
      .filter((m) => !m.relevance_score)
      .map((m) => {
        const a = accountByOrg.get(m.organization_id);
        return {
          organizationId: m.organization_id,
          name: a?.organization?.name ?? "(unknown)",
          domain: a?.organization?.domain ?? null,
          industry: a?.organization?.industry ?? null,
          location: a?.organization?.location ?? null,
          raw: a?.raw ?? {},
        };
      });

    const results = toScore.length
      ? await scoreTargetAccounts({
          campaign: {
            id: campaign.id,
            name: campaign.name,
            icp,
            offering: (campaign.offering ?? {}) as Offering,
          },
          accounts: toScore,
          userId: userId ?? "",
        })
      : [];

    // Persist: existing scoring rubric — qualified at >= 6. Sequential
    // chunks of 20 so a big list can't fire hundreds of parallel updates.
    for (const batch of chunk(results, 20)) {
      await Promise.all(
        batch.map((r) =>
          supabase
            .from("campaign_organizations")
            .update({
              relevance_score: r.score,
              score_reason: r.reason,
              status: r.score >= 6 ? "qualified" : "disqualified",
            })
            .eq("campaign_id", input.campaignId)
            .eq("organization_id", r.organizationId),
        ),
      );
    }

    // Top slice across everything now scored (fresh + previously scored).
    const scoreByOrg = new Map<string, { score: number; reason: string }>();
    for (const m of memberships) {
      if (m.relevance_score) {
        scoreByOrg.set(m.organization_id, {
          score: Number(m.relevance_score),
          reason: m.score_reason ?? "",
        });
      }
    }
    for (const r of results) {
      scoreByOrg.set(r.organizationId, { score: r.score, reason: r.reason });
    }

    const topFraction = input.topFraction ?? 0.1;
    const sliceSize = Math.ceil(memberships.length * topFraction);
    const ranked = [...scoreByOrg.entries()].sort(
      (a, b) => b[1].score - a[1].score,
    );
    const sliceOrgIds = ranked.slice(0, sliceSize).map(([orgId]) => orgId);

    // Contact coverage per slice account: imported contacts may already
    // satisfy the ICP, letting the agent propose skipContactFinding.
    const contactCounts = new Map<string, number>();
    if (sliceOrgIds.length > 0) {
      const { data: people, error: peopleError } = await supabase
        .from("people")
        .select("organization_id")
        .in("organization_id", sliceOrgIds);
      if (peopleError)
        throw new Error(`Failed to count contacts: ${peopleError.message}`);
      for (const p of people ?? []) {
        contactCounts.set(
          p.organization_id,
          (contactCounts.get(p.organization_id) ?? 0) + 1,
        );
      }
    }

    const topSlice = sliceOrgIds.map((orgId) => ({
      organizationId: orgId,
      name: accountByOrg.get(orgId)?.organization?.name ?? "(unknown)",
      score: scoreByOrg.get(orgId)!.score,
      reason: scoreByOrg.get(orgId)!.reason,
      importedContacts: contactCounts.get(orgId) ?? 0,
    }));

    return {
      scored: results.length,
      topSlice,
      estimatedEnrichCostUsd:
        Math.round(topSlice.length * ENRICH_COST_PER_ACCOUNT_USD * 100) / 100,
      note:
        "Present the top slice and the estimated cost to the user and get explicit approval " +
        "before enriching. Accounts whose importedContacts already match the ICP titles can " +
        "be enriched with skipContactFinding to save spend.",
    };
  },
});

export const enrichTargetAccounts = tool({
  description:
    "Queue background enrichment (and contact finding) for approved target accounts. " +
    "ONLY call this after the user has approved the cost quoted by prioritizeTargetAccounts. " +
    "Runs as a background chain (~1 min/company) — check progress with getTargetList, " +
    "don't poll in a loop. Set skipContactFinding for accounts whose imported contacts " +
    "already match the ICP; split accounts across two calls if only some qualify.",
  inputSchema: z.object({
    listId: z.string().uuid().describe("Target account list ID"),
    campaignId: z
      .string()
      .uuid()
      .describe("Campaign providing signal config and ICP titles"),
    organizationIds: z
      .array(z.string().uuid())
      .min(1)
      .describe("Organizations from the list to enrich (the approved slice)"),
    skipContactFinding: z
      .boolean()
      .default(false)
      .describe(
        "Skip contact discovery and only enrich the companies — use when " +
          "imported contacts already cover the ICP titles",
      ),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const { userId } = await auth();

    // RLS proves the list is mine…
    await loadListOrFail(supabase, input.listId);

    // …and that the campaign is too (same RLS pattern as
    // prioritizeTargetAccounts): the campaignId goes into a QStash payload
    // processed under the admin client, so ownership must be proven here.
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", input.campaignId)
      .single();
    if (campaignError || !campaign) {
      return {
        error:
          `Campaign not found (or not yours): ${campaignError?.message ?? input.campaignId}. ` +
          "Check the campaign ID with getCampaigns.",
      };
    }

    // Then prove the orgs are actually on the list, and grab each org's
    // enrichment status so non-pending ones are reported, not stamped.
    const orgIds = [...new Set(input.organizationIds)];
    const statusByOrg = new Map<string, string>();
    for (const ids of chunk(orgIds, UPSERT_CHUNK)) {
      const { data, error } = await supabase
        .from("target_accounts")
        .select(
          "organization_id, organization:organizations(enrichment_status)",
        )
        .eq("list_id", input.listId)
        .in("organization_id", ids);
      if (error) throw new Error(`Failed to verify accounts: ${error.message}`);
      for (const row of data ?? []) {
        const org = row.organization as unknown as {
          enrichment_status: string;
        } | null;
        statusByOrg.set(
          row.organization_id,
          org?.enrichment_status ?? "pending",
        );
      }
    }
    const missing = orgIds.filter((id) => !statusByOrg.has(id));
    if (missing.length > 0) {
      return {
        error:
          `${missing.length} organization(s) are not in this list: ` +
          `${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}. ` +
          "Check the IDs against getTargetList.",
      };
    }

    // Only pending orgs get stamped: failed/in_progress/enriched ones would
    // never be picked by the processor (it filters on pending), so stamping
    // them just inflates the queue count and misleads the agent.
    const pendingIds = orgIds.filter((id) => statusByOrg.get(id) === "pending");
    const skippedNotPending = orgIds
      .filter((id) => statusByOrg.get(id) !== "pending")
      .map((organizationId) => ({
        organizationId,
        status: statusByOrg.get(organizationId)!,
      }));
    if (pendingIds.length === 0) {
      return {
        queued: 0,
        skippedNotPending,
        note:
          "None of these accounts are pending enrichment — nothing was queued. " +
          "Check their status with getTargetList.",
      };
    }

    // Fail on missing QStash config BEFORE stamping rows — never fall back
    // to inline enrichment, and never leave a stamped queue nothing drains.
    let qstash;
    try {
      qstash = getQStashClient();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        error:
          "The QStash integration isn't configured, so background enrichment can't run " +
          `(${msg}). Set QSTASH_TOKEN (and the signing keys) in the environment, then retry.`,
      };
    }

    // The skip flag is stamped PER ROW, not carried in the chain payload:
    // two concurrent calls with opposite flags each mark their own rows, and
    // the processor honors whatever each row says.
    const stampedAt = new Date().toISOString();
    for (const ids of chunk(pendingIds, UPSERT_CHUNK)) {
      const { error } = await supabase
        .from("target_accounts")
        .update({
          enrich_requested_at: stampedAt,
          skip_contact_finding: input.skipContactFinding ?? false,
        })
        .eq("list_id", input.listId)
        .in("organization_id", ids);
      if (error) throw new Error(`Failed to queue accounts: ${error.message}`);
    }

    // ONE message starts the chain; the process route re-publishes itself
    // until the stamped work drains.
    await qstash.publishJSON({
      url: getBaseUrl() + "/api/target-lists/process",
      body: {
        listId: input.listId,
        campaignId: input.campaignId,
        userId: userId ?? "",
      },
    });

    return {
      queued: pendingIds.length,
      skippedNotPending,
      note: "Enrichment runs in the background (~1 min/company). Ask me for progress.",
    };
  },
});
