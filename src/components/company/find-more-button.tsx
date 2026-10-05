"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@clerk/nextjs";
import { requestContactDiscovery } from "@/lib/billing/contact-discovery-request";

interface FindMoreButtonProps {
  companyId: string;
  /**
   * The campaign this page is scoped to, when it is scoped to one. People are
   * linked to it, so they appear on the campaign as well as on this page. With
   * no campaign they are attached to the company alone, which is a legitimate
   * way to work and the reason this is optional rather than required.
   */
  campaignId?: string;
  onComplete?: () => void;
}

export function FindMoreButton({
  companyId,
  campaignId,
  onComplete,
}: FindMoreButtonProps) {
  const { userId } = useAuth();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const {
        added,
        found,
        uncertainCount,
        rejectedAsWrongCompany,
        error,
        campaignId: linkedTo,
      } = (await requestContactDiscovery(userId, "more", companyId, campaignId)) as {
        added: number;
        found: number;
        uncertainCount?: number;
        rejectedAsWrongCompany?: number;
        error?: string;
        campaignId?: string | null;
      };

      // A refusal (e.g. the company has no domain on record, so contacts cannot
      // be told apart from another company of the same name) comes back 200
      // with an explanation. Dropping it left the user staring at "no new
      // people found" with no idea why or what would fix it.
      if (error) {
        toast.error(error);
      } else if (added === 0) {
        toast.info(`Searched ${found} results, no new people found.`);
      } else {
        const notes = [];
        if (uncertainCount)
          notes.push(`${uncertainCount} unconfirmed, blocked from outreach`);
        if (rejectedAsWrongCompany)
          notes.push(`${rejectedAsWrongCompany} work elsewhere`);
        // Where they landed, not just how many. An unscoped run attaches them
        // to the company and nothing else, so the campaign page will not show
        // them: saying "added 3 people" and stopping there is how the user came
        // to believe a campaign had been filled that was still empty.
        const where = linkedTo
          ? " Added to this campaign."
          : " They are attached to this company only, not to a campaign yet.";
        toast.success(
          `Found ${added} new ${added === 1 ? "person" : "people"}.` +
            where +
            (notes.length ? ` ${notes.join(", ")}.` : ""),
        );
      }
      onComplete?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to find more people",
        { description: "Retry with this button. Credits may remain reserved until the original request is resolved." },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={run} disabled={busy} variant="outline" size="sm">
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Search className="h-3.5 w-3.5" />
      )}
      Find more people
    </Button>
  );
}
