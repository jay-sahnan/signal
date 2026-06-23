"use client";

import { useState } from "react";
import { ChevronDown, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CsvUpload } from "@/components/campaign/csv-upload";
import { ProfileSelector } from "@/components/campaign/profile-selector";
import { ICPPresetSelector } from "@/components/campaign/icp-preset-selector";
import { CampaignSignalsPopover } from "@/components/signals/campaign-signals-popover";
import { useCampaign } from "@/lib/campaign-context";
import { RULEBASE_CONFIG } from "@/lib/rulebase/config";
import { cn } from "@/lib/utils";
import type { Campaign } from "@/lib/types/campaign";

interface CampaignHeaderProps {
  campaign: Campaign;
  contactCount: number;
  companyCount: number;
  onDataChanged: () => void;
  onProfileChanged: (profileId: string | null) => void;
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item, i) => (
        <span
          key={i}
          className="bg-foreground/8 text-foreground inline-flex rounded-md px-2 py-0.5 text-xs"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function SetUpOutreachButton({ campaignName }: { campaignName: string }) {
  const { openAgentWith } = useCampaign();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        openAgentWith(
          `Set up a 3-step outreach sequence for my "${campaignName}" campaign. Use Hiring Activity as the trigger signal. Enroll all contacts.`,
        )
      }
    >
      <Mail className="mr-1.5 h-3.5 w-3.5" />
      Set Up Outreach
    </Button>
  );
}

export function CampaignHeader({
  campaign,
  contactCount,
  companyCount,
  onDataChanged,
  onProfileChanged,
}: CampaignHeaderProps) {
  const [expanded, setExpanded] = useState(false);
  const icp = campaign.icp ?? {};
  const offering = campaign.offering ?? {};
  const positioning = campaign.positioning ?? {};

  const hasIcp =
    icp.industry ||
    icp.companySize ||
    icp.geography ||
    (icp.targetTitles?.length ?? 0) > 0 ||
    (icp.painPoints?.length ?? 0) > 0;
  const hasOffering =
    offering.valueProposition ||
    offering.description ||
    (offering.differentiators?.length ?? 0) > 0;
  const hasPositioning =
    positioning.angle ||
    positioning.tone ||
    (positioning.keyMessages?.length ?? 0) > 0;
  const hasDetails = hasIcp || hasOffering || hasPositioning;

  const summaryChips: string[] = [];
  if (icp.industry) summaryChips.push(icp.industry);
  if (icp.companySize) summaryChips.push(icp.companySize);
  if (icp.geography) summaryChips.push(icp.geography);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {campaign.name}
          </h1>
          <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>
              {contactCount} {contactCount === 1 ? "contact" : "contacts"}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span>
              {companyCount} {companyCount === 1 ? "company" : "companies"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ICPPresetSelector
            campaignId={campaign.id}
            currentPreset={campaign.icp_preset_slug}
            onPresetApplied={onDataChanged}
          />
          <ProfileSelector
            campaignId={campaign.id}
            currentProfileId={campaign.profile_id}
            onProfileChanged={onProfileChanged}
          />
          {!RULEBASE_CONFIG.hideOutreach && (
            <SetUpOutreachButton campaignName={campaign.name} />
          )}
          <CampaignSignalsPopover campaignId={campaign.id} />
          <CsvUpload campaignId={campaign.id} onImported={onDataChanged} />
        </div>
      </div>

      {hasDetails && (
        <div className="border-border overflow-hidden rounded-lg border">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={
              expanded ? "Hide campaign brief" : "Show campaign brief"
            }
            className="hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
          >
            <span className="text-muted-foreground shrink-0 text-xs font-medium uppercase tracking-wide">
              Brief
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {summaryChips.map((chip, i) => (
                <span
                  key={i}
                  className="bg-foreground/8 text-foreground inline-flex rounded-md px-2 py-0.5 text-xs"
                >
                  {chip}
                </span>
              ))}
              {icp.targetTitles && icp.targetTitles.length > 0 && (
                <span className="text-muted-foreground text-xs">
                  {icp.targetTitles.length}{" "}
                  {icp.targetTitles.length === 1 ? "title" : "titles"}
                </span>
              )}
              {summaryChips.length === 0 &&
                (!icp.targetTitles || icp.targetTitles.length === 0) && (
                  <span className="text-muted-foreground text-xs">
                    ICP, offering, and positioning
                  </span>
                )}
            </div>
            <ChevronDown
              className={cn(
                "text-muted-foreground size-4 shrink-0 transition-transform",
                expanded && "rotate-180",
              )}
            />
          </button>

          {expanded && (
            <div className="border-border bg-muted/30 grid gap-6 border-t p-4 md:grid-cols-2 md:p-5 xl:grid-cols-3">
              {hasIcp && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">ICP</h3>
                  <div className="space-y-3">
                    {icp.industry && (
                      <Field label="Industry" value={icp.industry} />
                    )}
                    {icp.companySize && (
                      <Field label="Size" value={icp.companySize} />
                    )}
                    {icp.geography && (
                      <Field label="Geography" value={icp.geography} />
                    )}
                    {icp.targetTitles && icp.targetTitles.length > 0 && (
                      <Field
                        label="Target titles"
                        value={<Chips items={icp.targetTitles} />}
                      />
                    )}
                    {icp.painPoints && icp.painPoints.length > 0 && (
                      <Field
                        label="Pain points"
                        value={<Chips items={icp.painPoints} />}
                      />
                    )}
                  </div>
                </section>
              )}

              {hasOffering && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Offering</h3>
                  <div className="space-y-3">
                    {offering.valueProposition && (
                      <Field
                        label="Value proposition"
                        value={offering.valueProposition}
                      />
                    )}
                    {offering.description &&
                      offering.description !== offering.valueProposition && (
                        <Field
                          label="Description"
                          value={
                            <span className="text-muted-foreground">
                              {offering.description}
                            </span>
                          }
                        />
                      )}
                    {offering.differentiators &&
                      offering.differentiators.length > 0 && (
                        <Field
                          label="Differentiators"
                          value={<Chips items={offering.differentiators} />}
                        />
                      )}
                  </div>
                </section>
              )}

              {hasPositioning && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Positioning</h3>
                  <div className="space-y-3">
                    {positioning.angle && (
                      <Field label="Angle" value={positioning.angle} />
                    )}
                    {positioning.tone && (
                      <Field label="Tone" value={positioning.tone} />
                    )}
                    {positioning.keyMessages &&
                      positioning.keyMessages.length > 0 && (
                        <Field
                          label="Key messages"
                          value={<Chips items={positioning.keyMessages} />}
                        />
                      )}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
