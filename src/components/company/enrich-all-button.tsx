"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { requestBulkEnrichment } from "@/lib/billing/bulk-enrichment-request";

/**
 * "Enrich all" for one company's contacts.
 *
 * Confirms first, and the dialog leads with the count. Enrichment spends real
 * money per contact, so a mis-click on a large company is not something to
 * find out about afterwards.
 *
 * Deliberately no cost figure. Each enrichment fans out to LinkedIn, X and
 * three Exa searches and only one of those has a documented per-call price, so
 * any number here would be invented -- and an invented number in a spend
 * confirmation is worse than none, because it is the thing you would rely on.
 */
export function EnrichAllButton({
  campaignId,
  organizationId,
  unenrichedCount,
  personIds,
  onDone,
}: {
  campaignId: string;
  organizationId: string;
  unenrichedCount: number;
  personIds: string[];
  onDone: () => void;
}) {
  const { userId } = useAuth();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);

  if (unenrichedCount <= 0) return null;

  const run = async () => {
    setRunning(true);
    try {
      const data = await requestBulkEnrichment(
        userId,
        campaignId,
        organizationId,
        personIds,
      );

      // The route caps each batch and skips anyone already enriched, so its
      // own summary is the accurate sentence; the fallback only covers a
      // response that predates it.
      const summary = data?.summary ?? `Enriched ${data?.enriched ?? 0} contacts.`;
      if (data?.failed > 0) toast.error(summary);
      else toast.success(summary);
      setOpen(false);
      onDone();
    } catch (err) {
      console.error("[enrich/bulk] Failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to enrich", {
        description:
          "Use the batch button to retry the same batch. Credits may remain reserved while its outcome is unresolved.",
      });
    } finally {
      setRunning(false);
    }
  };

  const noun = unenrichedCount === 1 ? "contact" : "contacts";

  return (
    <>
      <Button
        size="xs"
        variant="outline"
        onClick={() => setOpen(true)}
        title={`Enrich ${unenrichedCount} ${noun} at this company`}
      >
        <Sparkles className="h-3 w-3" />
        Enrich all ({unenrichedCount})
      </Button>

      <Dialog open={open} onOpenChange={(v) => !running && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Enrich {unenrichedCount} {noun}?
            </DialogTitle>
            <DialogDescription>
              This spends enrichment credits, one charge per contact, and can
              take a couple of minutes. Contacts enriched in the last week are
              skipped. Each request processes up to ten contacts.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={running}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void run()} disabled={running}>
              {running ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Enriching
                </>
              ) : (
                `Enrich ${unenrichedCount}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
