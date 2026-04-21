import { StatCard } from "@/components/ui/stat-card";
import type { CampaignCompany, CampaignContact } from "@/lib/types/campaign";

interface CampaignStatsProps {
  companies: CampaignCompany[];
  contacts: CampaignContact[];
}

function percent(num: number, denom: number) {
  if (denom === 0) return 0;
  return Math.round((num / denom) * 100);
}

export function CampaignStats({ companies, contacts }: CampaignStatsProps) {
  const enrichedCount = contacts.filter(
    (c) => c.enrichment_status === "enriched",
  ).length;
  const contactedCount = contacts.filter(
    (c) =>
      c.outreach_status === "sent" ||
      c.outreach_status === "opened" ||
      c.outreach_status === "replied",
  ).length;
  const repliedCount = contacts.filter(
    (c) => c.outreach_status === "replied",
  ).length;

  const replyRate = percent(repliedCount, contactedCount);
  const enrichedPct = percent(enrichedCount, contacts.length);
  const contactedPct = percent(contactedCount, contacts.length);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <div className="border-border col-span-2 rounded-lg border bg-gradient-to-br from-emerald-500/5 to-transparent px-4 py-3 md:col-span-2">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums">
            {replyRate}
            <span className="text-muted-foreground ml-0.5 text-2xl">%</span>
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-sm font-medium">Reply rate</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {repliedCount} of {contactedCount} contacted
          </span>
        </div>
      </div>

      <StatCard label="Companies" value={companies.length} size="sm" />
      <StatCard label="Leads" value={contacts.length} size="sm" />
      <StatCard
        label="Enriched"
        value={enrichedCount}
        sublabel={contacts.length > 0 ? `${enrichedPct}%` : undefined}
        size="sm"
      />
      <StatCard
        label="Contacted"
        value={contactedCount}
        sublabel={contacts.length > 0 ? `${contactedPct}%` : undefined}
        size="sm"
      />
    </div>
  );
}
