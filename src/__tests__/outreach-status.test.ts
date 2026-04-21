import { describe, expect, it } from "vitest";
import {
  OUTREACH_STATUS,
  type OutreachStatus,
  resolveDbEnrollmentStatus,
} from "@/lib/outreach/status";

describe("outreach status registry", () => {
  it("exposes a single canonical status for every lifecycle stage", () => {
    const keys = Object.keys(OUTREACH_STATUS) as OutreachStatus[];
    expect(keys).toEqual([
      "needs_review",
      "ready",
      "waiting",
      "sent",
      "replied",
      "blocked",
      "rejected",
    ]);
  });

  it("maps DB enrollment status to canonical status", () => {
    expect(resolveDbEnrollmentStatus("waiting")).toBe("waiting");
    expect(resolveDbEnrollmentStatus("queued")).toBe("waiting");
    expect(resolveDbEnrollmentStatus("active")).toBe("sent");
    expect(resolveDbEnrollmentStatus("replied")).toBe("replied");
  });

  it("each status defines label, description and tone", () => {
    for (const def of Object.values(OUTREACH_STATUS)) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(["primary", "warn", "muted", "success", "neutral"]).toContain(
        def.tone,
      );
    }
  });
});
