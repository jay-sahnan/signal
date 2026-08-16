"use client";

import { TogglePill } from "@/components/ui/toggle-pill";

/**
 * One bucket per campaign, with the numbers that decide whether it is worth
 * clicking into: how many drafts are in flight, how many are ready to go,
 * and how many replies are sitting there.
 */
export interface CampaignBucket {
  id: string;
  name: string;
  drafts: number;
  ready: number;
  replied: number;
}

interface CampaignPickerProps {
  buckets: CampaignBucket[];
  /** null means every campaign. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Scopes the whole outreach page to one campaign. Lives above the tabs, not
 * inside one of them, so Inbox, Sent, Pipeline and Sequences all agree on
 * which campaign is on screen.
 */
export function CampaignPicker({
  buckets,
  selectedId,
  onSelect,
}: CampaignPickerProps) {
  const totalDrafts = buckets.reduce((n, b) => n + b.drafts, 0);
  const totalReplied = buckets.reduce((n, b) => n + b.replied, 0);

  return (
    <div
      role="group"
      aria-label="Campaign"
      className="flex flex-wrap items-center gap-1.5"
    >
      <TogglePill active={selectedId === null} onClick={() => onSelect(null)}>
        All campaigns
        <Counts drafts={totalDrafts} replied={totalReplied} />
      </TogglePill>
      {buckets.map((b) => (
        <TogglePill
          key={b.id}
          active={selectedId === b.id}
          onClick={() => onSelect(b.id)}
          className="max-w-[16rem] truncate"
          title={b.name}
        >
          {b.name}
          <Counts drafts={b.drafts} replied={b.replied} />
        </TogglePill>
      ))}
    </div>
  );
}

function Counts({ drafts, replied }: { drafts: number; replied: number }) {
  if (drafts === 0 && replied === 0) return null;
  return (
    <span className="ml-1.5 opacity-70 tabular-nums">
      {drafts > 0 && <span>{drafts}</span>}
      {drafts > 0 && replied > 0 && <span> · </span>}
      {replied > 0 && <span>{replied} replied</span>}
    </span>
  );
}
