import { tool } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getQStashClient, getBaseUrl } from "@/lib/services/qstash";
import { SCHEDULE_INTERVALS } from "@/lib/types/tracking";
import type { Schedule } from "@/lib/types/tracking";

/** Publish a QStash message to run a tracking config immediately (baseline). */
async function dispatchImmediateRun(trackingConfigId: string): Promise<void> {
  try {
    const qstash = getQStashClient();
    const baseUrl = getBaseUrl();
    await qstash.publishJSON({
      url: `${baseUrl}/api/tracking/run`,
      body: { trackingConfigId },
      retries: 2,
    });
  } catch (err) {
    console.error("[tracking] Failed to dispatch baseline run:", err);
  }
}

export const createTracking = tool({
  description:
    "Start tracking a company or person with a specific signal on a recurring schedule. Runs the signal once immediately as a baseline snapshot, then schedules future runs. Use after discussing with the user what changes should flag them as ready to contact -- capture that as a plain-English intent string.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
    organizationId: z
      .string()
      .uuid()
      .optional()
      .describe("Organization ID to track (provide this OR personId)"),
    personId: z
      .string()
      .uuid()
      .optional()
      .describe("Person ID to track (provide this OR organizationId)"),
    signalId: z.string().uuid().describe("Signal ID to run on schedule"),
    schedule: z
      .enum(["daily", "weekly", "biweekly", "monthly"])
      .default("weekly")
      .describe("How often to re-run the signal"),
    intent: z
      .string()
      .describe(
        "Plain-English description of what changes should flag the company/person as ready to contact. Each run, an LLM compares fresh diffs against this intent to decide whether to fire outreach. Example: 'Flag as ready when they post 2+ senior engineering or DevOps roles, or announce a Series B or later.'",
      ),
  }),
  execute: async (input) => {
    if (!input.organizationId && !input.personId) {
      throw new Error("Either organizationId or personId is required");
    }

    const supabase = await createClient();
    const interval =
      SCHEDULE_INTERVALS[input.schedule as Schedule] ??
      SCHEDULE_INTERVALS.weekly;

    const { data: config, error } = await supabase
      .from("tracking_configs")
      .insert({
        campaign_id: input.campaignId,
        organization_id: input.organizationId ?? null,
        person_id: input.personId ?? null,
        signal_id: input.signalId,
        schedule: input.schedule,
        intent: input.intent,
        status: "active",
        next_run_at: new Date(Date.now() + interval).toISOString(),
      })
      .select("*")
      .single();

    if (error)
      throw new Error(`Failed to create tracking config: ${error.message}`);

    // Set readiness_tag to 'monitoring' on the junction table
    if (input.organizationId) {
      await supabase
        .from("campaign_organizations")
        .update({ readiness_tag: "monitoring" })
        .eq("campaign_id", input.campaignId)
        .eq("organization_id", input.organizationId);
    } else if (input.personId) {
      await supabase
        .from("campaign_people")
        .update({ readiness_tag: "monitoring" })
        .eq("campaign_id", input.campaignId)
        .eq("person_id", input.personId);
    }

    // Dispatch immediate baseline run via QStash
    await dispatchImmediateRun(config.id);

    return {
      trackingConfig: config,
      message: `Tracking created with baseline run dispatched. Signal will then run ${input.schedule}. Next check: ${config.next_run_at}.`,
    };
  },
});

export const bulkCreateTracking = tool({
  description:
    "Enable tracking for all qualified organizations in a campaign with a shared signal and intent. Creates one tracking config per organization.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
    signalId: z.string().uuid().describe("Signal ID to track"),
    schedule: z
      .enum(["daily", "weekly", "biweekly", "monthly"])
      .default("weekly"),
    intent: z
      .string()
      .describe(
        "Plain-English description of what changes should flag a company as ready to contact. Applied to every tracked organization.",
      ),
    status: z
      .enum(["qualified", "discovered", "all"])
      .default("qualified")
      .describe(
        "Only track organizations with this status (default: qualified)",
      ),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    // Get organizations in this campaign
    let query = supabase
      .from("campaign_organizations")
      .select("organization_id")
      .eq("campaign_id", input.campaignId);

    if (input.status !== "all") {
      query = query.eq("status", input.status);
    }

    const { data: orgs, error: orgErr } = await query;
    if (orgErr)
      throw new Error(`Failed to list organizations: ${orgErr.message}`);
    if (!orgs || orgs.length === 0) {
      return { created: 0, message: "No matching organizations found" };
    }

    // Check for existing tracking configs to avoid duplicates
    const { data: existing } = await supabase
      .from("tracking_configs")
      .select("organization_id")
      .eq("campaign_id", input.campaignId)
      .eq("signal_id", input.signalId);

    const existingOrgIds = new Set(
      (existing || []).map((e: Record<string, unknown>) => e.organization_id),
    );

    const interval =
      SCHEDULE_INTERVALS[input.schedule as Schedule] ??
      SCHEDULE_INTERVALS.weekly;
    const nextRun = new Date(Date.now() + interval).toISOString();

    const toCreate = orgs
      .filter(
        (o: Record<string, unknown>) =>
          !existingOrgIds.has(o.organization_id as string),
      )
      .map((o: Record<string, unknown>) => ({
        campaign_id: input.campaignId,
        organization_id: o.organization_id,
        person_id: null,
        signal_id: input.signalId,
        schedule: input.schedule,
        intent: input.intent,
        status: "active",
        next_run_at: nextRun,
      }));

    if (toCreate.length === 0) {
      return {
        created: 0,
        skipped: orgs.length,
        message:
          "All organizations already have tracking configs for this signal",
      };
    }

    const { data: created, error } = await supabase
      .from("tracking_configs")
      .insert(toCreate)
      .select("id, organization_id");

    if (error)
      throw new Error(`Failed to bulk create tracking: ${error.message}`);

    // Set readiness_tag to 'monitoring' for all tracked orgs
    const orgIds = toCreate.map(
      (c: Record<string, unknown>) => c.organization_id,
    );
    await supabase
      .from("campaign_organizations")
      .update({ readiness_tag: "monitoring" })
      .eq("campaign_id", input.campaignId)
      .in("organization_id", orgIds);

    // Dispatch baseline runs (max 5 concurrent to avoid overwhelming)
    const configIds = (created ?? []).map(
      (c: Record<string, unknown>) => c.id as string,
    );
    const batchSize = 5;
    for (let i = 0; i < configIds.length; i += batchSize) {
      const batch = configIds.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(dispatchImmediateRun));
    }

    return {
      created: toCreate.length,
      skipped: orgs.length - toCreate.length,
      message: `Created ${toCreate.length} tracking configs with baseline runs dispatched. Scheduled runs start ${input.schedule}.`,
    };
  },
});

export const getTrackingConfigs = tool({
  description:
    "List tracking configs for a campaign with their latest change summary and readiness status.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
    status: z
      .enum(["active", "paused", "completed"])
      .optional()
      .describe("Filter by tracking status"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    let query = supabase
      .from("tracking_configs")
      .select(
        "*, organization:organizations(name, domain), person:people(name, linkedin_url), signal:signals(name, slug, category)",
      )
      .eq("campaign_id", input.campaignId)
      .order("created_at", { ascending: false });

    if (input.status) {
      query = query.eq("status", input.status);
    }

    const { data: configs, error } = await query;
    if (error)
      throw new Error(`Failed to list tracking configs: ${error.message}`);

    // Fetch latest change for each config
    const configIds = (configs || []).map((c: Record<string, unknown>) => c.id);
    const { data: latestChanges } = await supabase
      .from("tracking_changes")
      .select("tracking_config_id, description, change_type, detected_at")
      .in("tracking_config_id", configIds)
      .order("detected_at", { ascending: false });

    // Group to get latest per config
    const changeMap = new Map<string, Record<string, unknown>>();
    for (const change of latestChanges || []) {
      const cid = change.tracking_config_id as string;
      if (!changeMap.has(cid)) {
        changeMap.set(cid, change);
      }
    }

    const result = (configs || []).map((c: Record<string, unknown>) => ({
      ...c,
      latestChange: changeMap.get(c.id as string) || null,
    }));

    return { configs: result };
  },
});

export const getTrackingHistory = tool({
  description:
    "Get the change history and snapshots for a tracking config. Use this to narrate trends over time.",
  inputSchema: z.object({
    trackingConfigId: z.string().uuid().describe("Tracking config ID"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe("Max number of changes to return"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    const [changesResult, snapshotsResult] = await Promise.all([
      supabase
        .from("tracking_changes")
        .select("*")
        .eq("tracking_config_id", input.trackingConfigId)
        .order("detected_at", { ascending: false })
        .limit(input.limit),
      supabase
        .from("tracking_snapshots")
        .select("snapshot_data, captured_at")
        .eq("tracking_config_id", input.trackingConfigId)
        .order("captured_at", { ascending: false })
        .limit(input.limit),
    ]);

    if (changesResult.error)
      throw new Error(`Failed to get changes: ${changesResult.error.message}`);
    if (snapshotsResult.error)
      throw new Error(
        `Failed to get snapshots: ${snapshotsResult.error.message}`,
      );

    return {
      changes: changesResult.data || [],
      snapshots: snapshotsResult.data || [],
    };
  },
});

export const updateTracking = tool({
  description:
    "Update a tracking config: change schedule, rewrite the intent, or pause/resume tracking.",
  inputSchema: z.object({
    trackingConfigId: z.string().uuid().describe("Tracking config ID"),
    schedule: z
      .enum(["daily", "weekly", "biweekly", "monthly"])
      .optional()
      .describe("New schedule"),
    intent: z
      .string()
      .optional()
      .describe(
        "New plain-English intent describing what changes should fire outreach",
      ),
    status: z
      .enum(["active", "paused", "completed"])
      .optional()
      .describe("New status"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    const updates: Record<string, unknown> = {};
    if (input.schedule) {
      updates.schedule = input.schedule;
      // Recalculate next_run_at
      const interval =
        SCHEDULE_INTERVALS[input.schedule as Schedule] ??
        SCHEDULE_INTERVALS.weekly;
      updates.next_run_at = new Date(Date.now() + interval).toISOString();
    }
    if (input.intent !== undefined) {
      updates.intent = input.intent;
    }
    if (input.status) {
      updates.status = input.status;
    }

    if (Object.keys(updates).length === 0) {
      return { message: "Nothing to update" };
    }

    const { data, error } = await supabase
      .from("tracking_configs")
      .update(updates)
      .eq("id", input.trackingConfigId)
      .select("*")
      .single();

    if (error) throw new Error(`Failed to update tracking: ${error.message}`);

    return {
      trackingConfig: data,
      message: `Tracking config updated.${input.status === "paused" ? " Tracking paused." : ""}${input.status === "active" ? " Tracking resumed." : ""}`,
    };
  },
});
