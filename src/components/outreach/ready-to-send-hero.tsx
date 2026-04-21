"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { DraftRow } from "@/components/outreach/outreach-drafts-panel";

interface ReadyToSendHeroProps {
  drafts: DraftRow[];
  onRefresh: () => void;
}

export function ReadyToSendHero({ drafts, onRefresh }: ReadyToSendHeroProps) {
  const [sendingAll, setSendingAll] = useState(false);

  if (drafts.length === 0) {
    return (
      <section className="border-border bg-muted/20 rounded-lg border border-dashed px-6 py-8 text-center">
        <p className="text-sm font-medium">All clear</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Nothing is waiting on you right now.
        </p>
      </section>
    );
  }

  const sendAll = async () => {
    setSendingAll(true);
    try {
      const results = await Promise.allSettled(
        drafts.map((d) =>
          fetch("/api/outreach/send-now", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draftId: d.id }),
          }),
        ),
      );
      const failed = results.filter(
        (r) =>
          r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
      ).length;
      if (failed === 0)
        toast.success(
          `Sent ${drafts.length} email${drafts.length === 1 ? "" : "s"}`,
        );
      else toast.error(`${failed} failed to send`);
      onRefresh();
    } finally {
      setSendingAll(false);
    }
  };

  return (
    <section className="border-primary/20 bg-primary/5 rounded-lg border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            {drafts.length} email{drafts.length === 1 ? "" : "s"} ready to send
          </h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Approved and past the scheduled delay.
          </p>
        </div>
        <Button onClick={sendAll} disabled={sendingAll}>
          {sendingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Send all
        </Button>
      </div>
    </section>
  );
}
