"use client";

import type { SequenceRow } from "@/app/outreach/page";
import { ReviewButton } from "@/components/outreach/review-button";
import { SequenceProgressBar } from "@/components/outreach/sequence-progress-bar";
import { StatusPill } from "@/components/ui/status-pill";
import type { OutreachStatus } from "@/lib/outreach/status";

interface SequenceListProps {
  sequences: SequenceRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function mapSequenceStatus(status: string): OutreachStatus {
  switch (status) {
    case "draft":
      return "blocked";
    case "active":
      return "ready";
    case "paused":
      return "waiting";
    case "completed":
      return "replied";
    default:
      return "blocked";
  }
}

export function SequenceList({
  sequences,
  selectedId,
  onSelect,
}: SequenceListProps) {
  if (sequences.length === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Sequences</h2>
        <p className="text-muted-foreground text-sm">
          No sequences yet. Ask the AI to set up outreach for a campaign.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Sequences</h2>
      <div className="border-border overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border bg-muted/50 border-b">
              <th className="px-4 py-2.5 text-left font-medium">Sequence</th>
              <th className="px-4 py-2.5 text-left font-medium">Campaign</th>
              <th className="px-4 py-2.5 text-left font-medium">Progress</th>
              <th className="px-4 py-2.5 text-left font-medium">Status</th>
              <th className="w-24 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sequences.map((seq) => (
              <tr
                key={seq.id}
                className={`border-border cursor-pointer border-b last:border-b-0 transition-colors ${
                  selectedId === seq.id ? "bg-muted/30" : "hover:bg-muted/20"
                }`}
                onClick={() => onSelect(seq.id)}
              >
                <td className="px-4 py-2.5 font-medium">{seq.name}</td>
                <td className="text-muted-foreground px-4 py-2.5">
                  {seq.campaign_name}
                </td>
                <td className="px-4 py-2.5">
                  <SequenceProgressBar
                    enrolled={seq.enrolled}
                    waiting={seq.waiting}
                    sent={seq.sent}
                    replied={seq.replied}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <StatusPill status={mapSequenceStatus(seq.status)}>
                    {seq.status}
                  </StatusPill>
                </td>
                <td className="px-4 py-2.5">
                  {seq.status === "draft" && (
                    <ReviewButton sequenceId={seq.id} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
