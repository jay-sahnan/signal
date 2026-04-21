import { createHash } from "node:crypto";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  estimateClaudeCostFromUsage,
  trackUsage,
} from "@/lib/services/cost-tracker";
import {
  UNTRUSTED_NOTICE,
  stringify,
  wrapUntrusted,
} from "@/lib/prompt-safety";
import type { HiringSnapshot, HiringDiff } from "@/lib/types/tracking";

// ── Normalize ──────────────────────────────────────────────────────────

/**
 * Normalize raw hiring data (from scrapeJobListings output) into a
 * deterministic, diffable snapshot. Jobs are sorted by title for
 * consistent hashing.
 */
export function normalizeHiringData(
  jobs: Array<{
    title: string;
    department?: string;
    location?: string;
    url?: string;
  }>,
  careersUrl: string | null,
): HiringSnapshot {
  const normalized = jobs
    .map((j) => ({
      title: j.title.trim(),
      department: j.department?.trim(),
      location: j.location?.trim(),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  const byDepartment: Record<string, number> = {};
  for (const job of normalized) {
    const dept = job.department || "Unknown";
    byDepartment[dept] = (byDepartment[dept] || 0) + 1;
  }

  return {
    job_count: normalized.length,
    jobs: normalized,
    by_department: byDepartment,
    careers_url: careersUrl,
  };
}

// ── Hash ───────────────────────────────────────────────────────────────

/**
 * Deterministic SHA-256 hash of a snapshot. Keys are sorted so that
 * identical data always produces the same hash regardless of insertion
 * order.
 */
export function hashSnapshot(snapshot: HiringSnapshot): string {
  const canonical = JSON.stringify(snapshot, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((sorted, k) => {
          sorted[k] = (value as Record<string, unknown>)[k];
          return sorted;
        }, {});
    }
    return value;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ── Diff ───────────────────────────────────────────────────────────────

/**
 * Compute a structured diff between two hiring snapshots.
 * The `classified_added` field is left empty -- call `classifyNewRoles`
 * separately to populate it.
 */
export function diffHiringSnapshots(
  previous: HiringSnapshot,
  current: HiringSnapshot,
): HiringDiff {
  const prevTitles = new Set(previous.jobs.map((j) => j.title));
  const currTitles = new Set(current.jobs.map((j) => j.title));

  const addedJobs = current.jobs.filter((j) => !prevTitles.has(j.title));
  const removedJobs = previous.jobs.filter((j) => !currTitles.has(j.title));

  // Department-level deltas
  const departmentDeltas: Record<string, number> = {};
  const allDepts = new Set([
    ...Object.keys(previous.by_department),
    ...Object.keys(current.by_department),
  ]);
  for (const dept of allDepts) {
    const prev = previous.by_department[dept] || 0;
    const curr = current.by_department[dept] || 0;
    if (prev !== curr) {
      departmentDeltas[dept] = curr - prev;
    }
  }

  return {
    added_jobs: addedJobs,
    removed_jobs: removedJobs,
    job_count_delta: current.job_count - previous.job_count,
    department_deltas: departmentDeltas,
    classified_added: [],
  };
}

// ── Classify ───────────────────────────────────────────────────────────

/**
 * Use Claude Haiku to classify newly added job titles relative to the
 * campaign's ICP. Returns categories like "engineering", "sales",
 * "operations", "leadership", etc.
 */
export async function classifyNewRoles(
  jobs: Array<{ title: string; department?: string; location?: string }>,
  icpContext: string,
): Promise<Array<{ title: string; category: string }>> {
  if (jobs.length === 0) return [];

  const { object, usage } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: z.object({
      classifications: z.array(
        z.object({
          title: z.string(),
          category: z
            .string()
            .describe(
              "Role category relevant to the ICP: engineering, sales, marketing, operations, leadership, product, design, support, finance, hr, other",
            ),
        }),
      ),
    }),
    prompt: `Classify each job title into a category.

${UNTRUSTED_NOTICE}

Buyer's ICP context: ${stringify(icpContext)}

Job titles to classify (scraped from company career pages):
${wrapUntrusted(
  jobs
    .map((j) => `- ${j.title}${j.department ? ` (${j.department})` : ""}`)
    .join("\n"),
)}

Assign each title exactly one category from: engineering, sales, marketing, operations, leadership, product, design, support, finance, hr, other.`,
  });

  trackUsage({
    service: "claude",
    operation: "classify-roles",
    tokens_input: usage.inputTokens ?? 0,
    tokens_output: usage.outputTokens ?? 0,
    estimated_cost_usd: estimateClaudeCostFromUsage("haiku", usage),
    metadata: { jobCount: jobs.length },
  });

  return object.classifications;
}

// ── Change description helpers ─────────────────────────────────────────

/** Build a human-readable description of the hiring diff for tracking_changes. */
export function describeHiringChanges(diff: HiringDiff): string {
  const parts: string[] = [];

  if (diff.added_jobs.length > 0) {
    const titles = diff.added_jobs.map((j) => j.title).join(", ");
    parts.push(
      `+${diff.added_jobs.length} role${diff.added_jobs.length > 1 ? "s" : ""}: ${titles}`,
    );
  }

  if (diff.removed_jobs.length > 0) {
    const titles = diff.removed_jobs.map((j) => j.title).join(", ");
    parts.push(
      `-${diff.removed_jobs.length} role${diff.removed_jobs.length > 1 ? "s" : ""}: ${titles}`,
    );
  }

  if (parts.length === 0) {
    // Job titles might have shifted even if count is the same
    if (diff.job_count_delta !== 0) {
      parts.push(
        `Job count ${diff.job_count_delta > 0 ? "+" : ""}${diff.job_count_delta}`,
      );
    } else {
      parts.push("Job details changed");
    }
  }

  return parts.join("; ");
}
