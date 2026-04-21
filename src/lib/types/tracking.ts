export type Schedule = "daily" | "weekly" | "biweekly" | "monthly";

export type TrackingStatus = "active" | "paused" | "completed";

export type ReadinessTag = "ready_to_contact" | "monitoring" | "not_ready";

export interface TrackingConfig {
  id: string;
  campaign_id: string;
  organization_id: string | null;
  person_id: string | null;
  signal_id: string;
  schedule: Schedule;
  intent: string;
  status: TrackingStatus;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackingSnapshot {
  id: string;
  tracking_config_id: string;
  snapshot_data: Record<string, unknown>;
  snapshot_hash: string;
  captured_at: string;
}

export type ChangeType =
  | "added"
  | "removed"
  | "count_change"
  | "threshold_crossed";

export interface TrackingChange {
  id: string;
  tracking_config_id: string;
  change_type: ChangeType;
  field_path: string | null;
  previous_value: unknown;
  current_value: unknown;
  description: string;
  detected_at: string;
}

/** Hiring-specific snapshot shape stored in tracking_snapshots.snapshot_data */
export interface HiringSnapshot {
  job_count: number;
  jobs: Array<{ title: string; department?: string; location?: string }>;
  by_department: Record<string, number>;
  careers_url: string | null;
}

export interface HiringDiff {
  added_jobs: Array<{ title: string; department?: string; location?: string }>;
  removed_jobs: Array<{
    title: string;
    department?: string;
    location?: string;
  }>;
  job_count_delta: number;
  department_deltas: Record<string, number>;
  classified_added: Array<{ title: string; category: string }>;
}

/** Schedule interval in milliseconds */
export const SCHEDULE_INTERVALS: Record<Schedule, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  biweekly: 14 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};
