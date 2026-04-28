import { getAdminClient } from "@/lib/supabase/admin";
import { verifyQStashSignature, getBaseUrl } from "@/lib/services/qstash";
import { withAction } from "@/lib/services/cost-tracker";
import { executeSignal } from "@/lib/signals/executor";
import type { Signal } from "@/lib/types/signal";
import {
  normalizeHiringData,
  hashSnapshot,
  diffHiringSnapshots,
  classifyNewRoles,
  describeHiringChanges,
} from "@/lib/services/tracking-differ";
import { evaluateIntent } from "@/lib/services/intent-evaluator";
import type { HiringSnapshot, TrackingConfig } from "@/lib/types/tracking";

export const maxDuration = 120;

interface RunPayload {
  trackingConfigId: string;
}

export async function POST(request: Request) {
  // Verify QStash signature
  let payload: RunPayload;
  try {
    payload = await verifyQStashSignature<RunPayload>(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid signature";
    return Response.json({ error: msg }, { status: 401 });
  }

  const { trackingConfigId } = payload;

  // Load tracking config with joins
  const { data: config, error: configErr } = await getAdminClient()
    .from("tracking_configs")
    .select(
      "*, organization:organizations(*), signal:signals(*), campaign:campaigns(icp, offering)",
    )
    .eq("id", trackingConfigId)
    .single();

  if (configErr || !config) {
    return Response.json(
      { error: `Tracking config not found: ${configErr?.message}` },
      { status: 404 },
    );
  }

  const typedConfig = config as TrackingConfig & {
    organization: Record<string, unknown> | null;
    signal: Record<string, unknown>;
    campaign: {
      icp: Record<string, unknown>;
      offering: Record<string, unknown>;
    };
  };

  const orgName =
    (typedConfig.organization?.name as string) || "Unknown Company";
  const orgDomain = typedConfig.organization?.domain as string | undefined;

  // Wrap in withAction for cost tracking
  return withAction(`Tracking run: ${orgName}`, async () => {
    // ── Execute signal via universal executor ────────────────────────
    const signalRecord = typedConfig.signal as unknown as Signal;
    let rawOutput: Record<string, unknown>;

    try {
      const signalOutput = await executeSignal(signalRecord, {
        organizationId: config.organization_id,
        domain: orgDomain,
        name: orgName,
        campaignId: config.campaign_id,
        useAdmin: true,
      });

      rawOutput = signalOutput.data;

      // If the signal executor didn't find anything meaningful, still store the result
      if (!signalOutput.found && !rawOutput) {
        rawOutput = { found: false, summary: signalOutput.summary };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return Response.json(
        { trackingConfigId, error: `Signal execution failed: ${msg}` },
        { status: 500 },
      );
    }

    // ── Normalize into snapshot ────────────────────────────────────────
    const jobs =
      (rawOutput.jobs as Array<{
        title: string;
        department?: string;
        location?: string;
        url?: string;
      }>) || [];
    const careersUrl = (rawOutput.careersUrl as string) || null;
    const snapshot = normalizeHiringData(jobs, careersUrl);
    const hash = hashSnapshot(snapshot);

    // ── Compare to previous snapshot ───────────────────────────────────
    const { data: prevSnapshots } = await getAdminClient()
      .from("tracking_snapshots")
      .select("snapshot_data, snapshot_hash")
      .eq("tracking_config_id", trackingConfigId)
      .order("captured_at", { ascending: false })
      .limit(1);

    const prevSnapshot = prevSnapshots?.[0] ?? null;
    const hasChanged = !prevSnapshot || prevSnapshot.snapshot_hash !== hash;

    // ── Store new snapshot (always, for the timeline) ──────────────────
    await getAdminClient().from("tracking_snapshots").insert({
      tracking_config_id: trackingConfigId,
      snapshot_data: snapshot,
      snapshot_hash: hash,
    });

    // ── Store signal_result with tracking_config_id ────────────────────
    await getAdminClient().from("signal_results").insert({
      signal_id: config.signal_id,
      campaign_id: config.campaign_id,
      organization_id: config.organization_id,
      person_id: config.person_id,
      tracking_config_id: trackingConfigId,
      output: rawOutput,
      status: "success",
    });

    // ── Update last_run_at ─────────────────────────────────────────────
    await getAdminClient()
      .from("tracking_configs")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", trackingConfigId);

    if (!hasChanged) {
      return Response.json({
        trackingConfigId,
        changed: false,
        jobCount: snapshot.job_count,
      });
    }

    // ── Compute diff ───────────────────────────────────────────────────
    const prevData = prevSnapshot
      ? (prevSnapshot.snapshot_data as HiringSnapshot)
      : null;

    // If no previous data (first run after baseline), store as baseline
    if (!prevData) {
      return Response.json({
        trackingConfigId,
        changed: false,
        baseline: true,
        jobCount: snapshot.job_count,
      });
    }

    const diff = diffHiringSnapshots(prevData, snapshot);

    // ── Classify new roles via Haiku ───────────────────────────────────
    if (diff.added_jobs.length > 0) {
      const icp = typedConfig.campaign.icp || {};
      const offering = typedConfig.campaign.offering || {};
      const icpContext = [
        icp.industry && `Industry: ${icp.industry}`,
        icp.targetTitles &&
          `Target titles: ${(icp.targetTitles as string[]).join(", ")}`,
        icp.painPoints &&
          `Pain points: ${(icp.painPoints as string[]).join(", ")}`,
        offering.description && `Offering: ${offering.description}`,
      ]
        .filter(Boolean)
        .join(". ");

      const classified = await classifyNewRoles(diff.added_jobs, icpContext);
      diff.classified_added = classified;
    }

    // ── Store tracking changes ───────────────────────────────────��─────
    const changeDescription = describeHiringChanges(diff);

    const changesToInsert: Array<Record<string, unknown>> = [];

    if (diff.added_jobs.length > 0) {
      changesToInsert.push({
        tracking_config_id: trackingConfigId,
        change_type: "added",
        field_path: "jobs",
        previous_value: null,
        current_value: diff.added_jobs,
        description: `+${diff.added_jobs.length} role${diff.added_jobs.length > 1 ? "s" : ""}: ${diff.added_jobs.map((j) => j.title).join(", ")}`,
      });
    }

    if (diff.removed_jobs.length > 0) {
      changesToInsert.push({
        tracking_config_id: trackingConfigId,
        change_type: "removed",
        field_path: "jobs",
        previous_value: diff.removed_jobs,
        current_value: null,
        description: `-${diff.removed_jobs.length} role${diff.removed_jobs.length > 1 ? "s" : ""}: ${diff.removed_jobs.map((j) => j.title).join(", ")}`,
      });
    }

    if (diff.job_count_delta !== 0 && changesToInsert.length === 0) {
      changesToInsert.push({
        tracking_config_id: trackingConfigId,
        change_type: "count_change",
        field_path: "job_count",
        previous_value: prevData.job_count,
        current_value: snapshot.job_count,
        description: changeDescription,
      });
    }

    if (changesToInsert.length > 0) {
      await getAdminClient().from("tracking_changes").insert(changesToInsert);
    }

    // ── Evaluate intent via LLM ────────────────────────────────────────
    const signal = typedConfig.signal as {
      name?: string;
      category?: string;
    } | null;
    const verdict = await evaluateIntent({
      intent: (typedConfig.intent as string) ?? "",
      signalName: signal?.name ?? "Unknown signal",
      signalCategory: signal?.category ?? "custom",
      snapshotSummary: changeDescription,
      rawDiff: diff,
      isFirstRun: false,
    });

    if (verdict.fire) {
      await getAdminClient()
        .from("tracking_changes")
        .insert({
          tracking_config_id: trackingConfigId,
          change_type: "threshold_crossed",
          field_path: null,
          previous_value: null,
          current_value: { confidence: verdict.confidence },
          description: verdict.reason,
        });

      const junctionTable = config.organization_id
        ? "campaign_organizations"
        : "campaign_people";
      const entityField = config.organization_id
        ? "organization_id"
        : "person_id";
      const entityId = config.organization_id || config.person_id;

      await getAdminClient()
        .from(junctionTable)
        .update({ readiness_tag: "ready_to_contact" })
        .eq("campaign_id", config.campaign_id)
        .eq(entityField, entityId);

      const outreachBaseUrl = getBaseUrl();
      void fetch(`${outreachBaseUrl}/api/outreach/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          type: "signal",
          signalId: config.signal_id,
          campaignId: config.campaign_id,
          organizationId: config.organization_id ?? undefined,
          reason: verdict.reason,
          confidence: verdict.confidence,
        }),
      }).catch(() => {
        // Fire-and-forget -- don't block tracking response
      });
    }

    return Response.json({
      trackingConfigId,
      changed: true,
      diff: {
        addedCount: diff.added_jobs.length,
        removedCount: diff.removed_jobs.length,
        jobCountDelta: diff.job_count_delta,
        description: changeDescription,
      },
      intentFired: verdict.fire,
      reason: verdict.reason,
      confidence: verdict.confidence,
    });
  });
}
