export type OutreachTone = "primary" | "warn" | "muted" | "success" | "neutral";

export interface OutreachStatusDef {
  label: string;
  description: string;
  tone: OutreachTone;
}

export const OUTREACH_STATUS = {
  needs_review: {
    label: "Needs review",
    description: "Waiting for you to approve or reject",
    tone: "warn",
  },
  ready: {
    label: "Ready to send",
    description: "Approved and past the scheduled delay",
    tone: "primary",
  },
  waiting: {
    label: "Waiting",
    description: "Approved, scheduled to send later",
    tone: "muted",
  },
  sent: {
    label: "Sent",
    description: "Delivered, awaiting reply",
    tone: "neutral",
  },
  replied: {
    label: "Replied",
    description: "The contact responded",
    tone: "success",
  },
  blocked: {
    label: "Blocked",
    description: "Ready to send but something needs fixing",
    tone: "warn",
  },
  rejected: {
    label: "Rejected",
    description: "Won't send; here for reference",
    tone: "neutral",
  },
} as const satisfies Record<string, OutreachStatusDef>;

export type OutreachStatus = keyof typeof OUTREACH_STATUS;

export function resolveDbEnrollmentStatus(
  dbStatus: string,
): OutreachStatus | null {
  switch (dbStatus) {
    case "waiting":
    case "queued":
      return "waiting";
    case "active":
      return "sent";
    case "replied":
      return "replied";
    default:
      return null;
  }
}
