"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface ClassifyButtonProps {
  companyId: string;
  uncategorizedCount: number;
  onComplete?: () => void;
}

export function ClassifyButton({
  companyId,
  uncategorizedCount,
  onComplete,
}: ClassifyButtonProps) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/companies/${companyId}/classify-departments`,
        { method: "POST" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { classified } = (await res.json()) as { classified: number };
      if (classified === 0) {
        toast.info("Everyone is already classified.");
      } else {
        toast.success(
          `Classified ${classified} ${classified === 1 ? "person" : "people"}.`,
        );
      }
      onComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Classification failed");
    } finally {
      setBusy(false);
    }
  }

  if (uncategorizedCount === 0) return null;

  return (
    <Button onClick={run} disabled={busy} variant="outline" size="sm">
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      Classify {uncategorizedCount}{" "}
      {uncategorizedCount === 1 ? "person" : "people"}
    </Button>
  );
}
