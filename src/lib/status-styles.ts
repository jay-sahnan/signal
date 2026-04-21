/**
 * Centralized status-style maps used across the UI for rendering
 * colored labels/pills/badges. Each entry pairs a human-readable `label`
 * with a Tailwind `className` (bg + text utilities combined).
 *
 * Keep keys in sync with the underlying DB enum values (campaigns.status,
 * campaign_people.outreach_status, campaign_organizations.readiness_tag).
 */

import type { ReadinessTag } from "@/lib/types/tracking";

export type StatusStyle = {
  label: string;
  className: string;
};

/**
 * Campaign lifecycle status. Keys match `campaigns.status` values.
 * Labels preserve the prior behavior of rendering the raw DB value
 * (lowercase) inside the pill.
 */
export type CampaignStatus =
  | "discovery"
  | "researching"
  | "active"
  | "paused"
  | "completed";

export const campaignStatusStyles: Record<CampaignStatus, StatusStyle> = {
  discovery: {
    label: "discovery",
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  },
  researching: {
    label: "researching",
    className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  },
  active: {
    label: "active",
    className: "bg-green-500/15 text-green-700 dark:text-green-400",
  },
  paused: {
    label: "paused",
    className: "bg-gray-500/15 text-gray-600 dark:text-gray-400",
  },
  completed: {
    label: "completed",
    className: "bg-gray-500/15 text-gray-600 dark:text-gray-400",
  },
};

// Solid bg color used for the small dot indicator in the sidebar nav (no text).
export const campaignStatusDotStyles: Record<CampaignStatus, string> = {
  discovery: "bg-blue-500",
  researching: "bg-yellow-500",
  active: "bg-green-500",
  paused: "bg-gray-400",
  completed: "bg-gray-300",
};

/**
 * Outreach status for a contact in a campaign. Keys match
 * `campaign_people.outreach_status` values (minus `not_contacted`, which
 * renders nothing in the UI).
 */
export type OutreachStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "replied"
  | "bounced"
  | "complained";

export const outreachStatusStyles: Record<OutreachStatus, StatusStyle> = {
  queued: {
    label: "Queued",
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  sent: {
    label: "Sent",
    className: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  },
  opened: {
    label: "Opened",
    className: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  },
  replied: {
    label: "Replied",
    className: "bg-green-500/10 text-green-700 dark:text-green-400",
  },
  delivered: {
    label: "Delivered",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  clicked: {
    label: "Clicked",
    className: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  },
  bounced: {
    label: "Bounced",
    className: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
  complained: {
    label: "Spam",
    className: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
};

/**
 * Enrichment status for a contact or company. Keys match the
 * `enrichment_status` values on people/organizations. The dot indicator
 * in the UI uses the solid bg color from `className`; the accompanying
 * label renders as plain text.
 */
export type EnrichmentStatus =
  | "pending"
  | "in_progress"
  | "enriched"
  | "failed";

export const enrichmentStatusStyles: Record<EnrichmentStatus, StatusStyle> = {
  pending: { label: "Pending", className: "bg-gray-400" },
  in_progress: { label: "In Progress", className: "bg-yellow-500" },
  enriched: { label: "Enriched", className: "bg-green-500" },
  failed: { label: "Failed", className: "bg-red-500" },
};

/**
 * Readiness tag shown next to companies being tracked. Keys match
 * `ReadinessTag` from `@/lib/types/tracking`.
 */
export const trackingReadinessStyles: Record<ReadinessTag, StatusStyle> = {
  ready_to_contact: {
    label: "Ready",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  monitoring: {
    label: "Monitoring",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  not_ready: {
    label: "Not Ready",
    className: "bg-muted text-muted-foreground",
  },
};
