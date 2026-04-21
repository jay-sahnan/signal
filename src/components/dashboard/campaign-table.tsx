"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { campaignStatusStyles, type CampaignStatus } from "@/lib/status-styles";

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  leads: number;
  sent: number;
  opened: number;
  openRate: number;
  replied: number;
  replyRate: number;
}

interface CampaignTableProps {
  campaigns: CampaignRow[];
}

const PAGE_SIZE = 20;

export function CampaignTable({ campaigns }: CampaignTableProps) {
  const [page, setPage] = useState(0);

  if (campaigns.length === 0) {
    return (
      <div className="border-border rounded-lg border p-6 text-center">
        <p className="text-muted-foreground text-sm">No campaigns yet</p>
      </div>
    );
  }

  const totalPages = Math.ceil(campaigns.length / PAGE_SIZE);
  const visible = campaigns.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-2">
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="px-4 py-2.5 text-left font-medium">Campaign</th>
              <th className="px-4 py-2.5 text-right font-medium">Leads</th>
              <th className="px-4 py-2.5 text-right font-medium">Sent</th>
              <th className="px-4 py-2.5 text-right font-medium">Opened</th>
              <th className="px-4 py-2.5 text-right font-medium">Open Rate</th>
              <th className="px-4 py-2.5 text-right font-medium">Replied</th>
              <th className="px-4 py-2.5 text-right font-medium">Reply Rate</th>
              <th className="px-4 py-2.5 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr
                key={c.id}
                className="border-border hover:bg-muted/30 border-b last:border-0 transition-colors"
              >
                <td className="px-4 py-2.5">
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="focus-visible:ring-ring rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {c.leads}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {c.sent}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {c.opened}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {c.openRate}%
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {c.replied}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {c.replyRate}%
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      campaignStatusStyles[c.status as CampaignStatus]
                        ?.className ?? campaignStatusStyles.paused.className
                    }`}
                  >
                    {c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 pt-1">
          <span className="text-muted-foreground text-xs tabular-nums">
            {page * PAGE_SIZE + 1}&ndash;
            {Math.min((page + 1) * PAGE_SIZE, campaigns.length)} of{" "}
            {campaigns.length} campaigns
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Previous page"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span
              className="text-muted-foreground min-w-[4rem] text-center text-xs tabular-nums"
              aria-label={`Page ${page + 1} of ${totalPages}`}
            >
              {page + 1} / {totalPages}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Next page"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
