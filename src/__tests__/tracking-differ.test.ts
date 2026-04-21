import { describe, expect, it, vi } from "vitest";

// Mock cost-tracker to avoid Supabase initialization at import time
vi.mock("@/lib/services/cost-tracker", () => ({
  trackUsage: vi.fn(),
  PRICING: { claude_haiku_input: 1.0, claude_haiku_output: 5.0 },
}));

import {
  normalizeHiringData,
  hashSnapshot,
  diffHiringSnapshots,
  describeHiringChanges,
} from "@/lib/services/tracking-differ";
import type { HiringSnapshot, HiringDiff } from "@/lib/types/tracking";

// ── normalizeHiringData ────────────────────────────────────────────────

describe("normalizeHiringData", () => {
  it("sorts jobs by title", () => {
    const result = normalizeHiringData(
      [{ title: "Zebra Role" }, { title: "Alpha Role" }, { title: "Mid Role" }],
      null,
    );
    expect(result.jobs.map((j) => j.title)).toEqual([
      "Alpha Role",
      "Mid Role",
      "Zebra Role",
    ]);
  });

  it("trims whitespace from title, department, location", () => {
    const result = normalizeHiringData(
      [{ title: "  Engineer  ", department: " Eng ", location: " NYC " }],
      "https://acme.com/careers",
    );
    expect(result.jobs[0]).toEqual({
      title: "Engineer",
      department: "Eng",
      location: "NYC",
    });
    expect(result.careers_url).toBe("https://acme.com/careers");
  });

  it("strips url field from jobs", () => {
    const result = normalizeHiringData(
      [{ title: "Dev", url: "https://acme.com/jobs/1" }],
      null,
    );
    expect(result.jobs[0]).toEqual({
      title: "Dev",
      department: undefined,
      location: undefined,
    });
  });

  it("counts jobs by department, defaulting to Unknown", () => {
    const result = normalizeHiringData(
      [
        { title: "A", department: "Eng" },
        { title: "B", department: "Eng" },
        { title: "C" },
      ],
      null,
    );
    expect(result.by_department).toEqual({ Eng: 2, Unknown: 1 });
    expect(result.job_count).toBe(3);
  });

  it("returns empty snapshot for no jobs", () => {
    const result = normalizeHiringData([], null);
    expect(result).toEqual({
      job_count: 0,
      jobs: [],
      by_department: {},
      careers_url: null,
    });
  });
});

// ── hashSnapshot ───────────────────────────────────────────────────────

describe("hashSnapshot", () => {
  it("produces a 64-char hex string", () => {
    const snap = normalizeHiringData([{ title: "Dev" }], null);
    const hash = hashSnapshot(snap);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same data", () => {
    const snap = normalizeHiringData(
      [{ title: "B" }, { title: "A" }],
      "https://x.com",
    );
    expect(hashSnapshot(snap)).toBe(hashSnapshot(snap));
  });

  it("differs when nested job data changes", () => {
    const snap1 = normalizeHiringData([{ title: "Frontend Engineer" }], null);
    const snap2 = normalizeHiringData([{ title: "Backend Engineer" }], null);
    // Both have job_count=1, but different titles must produce different hashes
    expect(hashSnapshot(snap1)).not.toBe(hashSnapshot(snap2));
  });

  it("differs when department changes even with same titles", () => {
    const snap1 = normalizeHiringData(
      [{ title: "Dev", department: "Eng" }],
      null,
    );
    const snap2 = normalizeHiringData(
      [{ title: "Dev", department: "Product" }],
      null,
    );
    expect(hashSnapshot(snap1)).not.toBe(hashSnapshot(snap2));
  });

  it("is stable regardless of object key insertion order", () => {
    const a: HiringSnapshot = {
      job_count: 1,
      jobs: [{ title: "Dev" }],
      by_department: { Eng: 1 },
      careers_url: null,
    };
    const b: HiringSnapshot = {
      careers_url: null,
      by_department: { Eng: 1 },
      jobs: [{ title: "Dev" }],
      job_count: 1,
    };
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
  });
});

// ── diffHiringSnapshots ────────────────────────────────────────────────

describe("diffHiringSnapshots", () => {
  const base = normalizeHiringData(
    [
      { title: "Frontend Engineer", department: "Eng" },
      { title: "Account Exec", department: "Sales" },
      { title: "SDR", department: "Sales" },
    ],
    "https://acme.com/careers",
  );

  it("detects no changes for identical snapshots", () => {
    const diff = diffHiringSnapshots(base, base);
    expect(diff.added_jobs).toEqual([]);
    expect(diff.removed_jobs).toEqual([]);
    expect(diff.job_count_delta).toBe(0);
    expect(diff.department_deltas).toEqual({});
  });

  it("detects added jobs", () => {
    const updated = normalizeHiringData(
      [
        { title: "Frontend Engineer", department: "Eng" },
        { title: "Account Exec", department: "Sales" },
        { title: "SDR", department: "Sales" },
        { title: "DevOps Engineer", department: "Eng" },
        { title: "SRE", department: "Eng" },
      ],
      "https://acme.com/careers",
    );
    const diff = diffHiringSnapshots(base, updated);
    expect(diff.added_jobs.map((j) => j.title)).toEqual([
      "DevOps Engineer",
      "SRE",
    ]);
    expect(diff.removed_jobs).toEqual([]);
    expect(diff.job_count_delta).toBe(2);
    expect(diff.department_deltas).toEqual({ Eng: 2 });
  });

  it("detects removed jobs", () => {
    const updated = normalizeHiringData(
      [{ title: "Frontend Engineer", department: "Eng" }],
      "https://acme.com/careers",
    );
    const diff = diffHiringSnapshots(base, updated);
    expect(diff.removed_jobs.map((j) => j.title)).toEqual([
      "Account Exec",
      "SDR",
    ]);
    expect(diff.added_jobs).toEqual([]);
    expect(diff.job_count_delta).toBe(-2);
    expect(diff.department_deltas).toEqual({ Sales: -2 });
  });

  it("detects both added and removed jobs", () => {
    const updated = normalizeHiringData(
      [
        { title: "Frontend Engineer", department: "Eng" },
        { title: "Backend Engineer", department: "Eng" },
      ],
      "https://acme.com/careers",
    );
    const diff = diffHiringSnapshots(base, updated);
    expect(diff.added_jobs.map((j) => j.title)).toEqual(["Backend Engineer"]);
    expect(diff.removed_jobs.map((j) => j.title)).toEqual([
      "Account Exec",
      "SDR",
    ]);
    expect(diff.job_count_delta).toBe(-1);
    expect(diff.department_deltas).toEqual({ Eng: 1, Sales: -2 });
  });

  it("leaves classified_added empty", () => {
    const diff = diffHiringSnapshots(base, base);
    expect(diff.classified_added).toEqual([]);
  });
});

// ── describeHiringChanges ──────────────────────────────────────────────

describe("describeHiringChanges", () => {
  it("describes added roles", () => {
    const diff: HiringDiff = {
      added_jobs: [{ title: "DevOps" }, { title: "SRE" }],
      removed_jobs: [],
      job_count_delta: 2,
      department_deltas: {},
      classified_added: [],
    };
    expect(describeHiringChanges(diff)).toBe("+2 roles: DevOps, SRE");
  });

  it("describes a single added role without plural", () => {
    const diff: HiringDiff = {
      added_jobs: [{ title: "CTO" }],
      removed_jobs: [],
      job_count_delta: 1,
      department_deltas: {},
      classified_added: [],
    };
    expect(describeHiringChanges(diff)).toBe("+1 role: CTO");
  });

  it("describes removed roles", () => {
    const diff: HiringDiff = {
      added_jobs: [],
      removed_jobs: [{ title: "Intern" }, { title: "Temp" }],
      job_count_delta: -2,
      department_deltas: {},
      classified_added: [],
    };
    expect(describeHiringChanges(diff)).toBe("-2 roles: Intern, Temp");
  });

  it("describes both added and removed", () => {
    const diff: HiringDiff = {
      added_jobs: [{ title: "SRE" }],
      removed_jobs: [{ title: "Intern" }],
      job_count_delta: 0,
      department_deltas: {},
      classified_added: [],
    };
    expect(describeHiringChanges(diff)).toBe("+1 role: SRE; -1 role: Intern");
  });

  it("falls back to job count delta when no added/removed", () => {
    const diff: HiringDiff = {
      added_jobs: [],
      removed_jobs: [],
      job_count_delta: 3,
      department_deltas: {},
      classified_added: [],
    };
    expect(describeHiringChanges(diff)).toBe("Job count +3");
  });

  it("falls back to 'Job details changed' when no delta", () => {
    const diff: HiringDiff = {
      added_jobs: [],
      removed_jobs: [],
      job_count_delta: 0,
      department_deltas: {},
      classified_added: [],
    };
    expect(describeHiringChanges(diff)).toBe("Job details changed");
  });
});
