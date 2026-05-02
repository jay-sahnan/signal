"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface FindMoreButtonProps {
  companyId: string;
  onComplete?: () => void;
}

export function FindMoreButton({ companyId, onComplete }: FindMoreButtonProps) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/find-more-people`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { added, found } = (await res.json()) as {
        added: number;
        found: number;
      };
      if (added === 0) {
        toast.info(`Searched ${found} results, no new people found.`);
      } else {
        toast.success(
          `Added ${added} new ${added === 1 ? "person" : "people"}.`,
        );
      }
      onComplete?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to find more people",
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
