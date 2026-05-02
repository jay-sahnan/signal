"use client";

import { Select } from "@/components/ui/select";

export interface CampaignOption {
  id: string;
  name: string;
}

interface CampaignSelectorProps {
  campaigns: CampaignOption[];
  value: string | null;
  onChange: (campaignId: string | null) => void;
}

const NONE_VALUE = "__none";

export function CampaignSelector({
  campaigns,
  value,
  onChange,
}: CampaignSelectorProps) {
  const items = [
    { value: NONE_VALUE, label: "No campaign (no status colors)" },
    ...campaigns.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs font-medium">
        Status from:
      </span>
      <Select
        value={value ?? NONE_VALUE}
        onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
        items={items}
        aria-label="Campaign for outreach status"
        triggerClassName="min-w-[220px]"
      />
    </div>
  );
}
