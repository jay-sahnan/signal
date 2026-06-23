"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const presets = [
  { slug: "qa", label: "QA", description: "Quality Assurance" },
  {
    slug: "complaints",
    label: "Complaints",
    description: "Complaint Detection",
  },
  {
    slug: "sales-compliance",
    label: "Sales Compliance",
    description: "Sales Compliance Monitoring",
  },
] as const;

interface ICPPresetSelectorProps {
  campaignId: string;
  currentPreset: string | null;
  onPresetApplied?: () => void;
}

export function ICPPresetSelector({
  campaignId,
  currentPreset,
  onPresetApplied,
}: ICPPresetSelectorProps) {
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const activePreset = presets.find((p) => p.slug === currentPreset);

  const handleSelect = async (slug: string) => {
    setApplying(true);
    setOpen(false);

    try {
      const res = await fetch("/api/apply-preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, presetSlug: slug }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to apply preset");
      }

      toast.success(
        `Applied ${presets.find((p) => p.slug === slug)?.label} preset`,
      );
      onPresetApplied?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        disabled={applying}
      >
        {applying
          ? "Applying..."
          : activePreset
            ? `ICP: ${activePreset.label}`
            : "Select ICP"}
        <ChevronDown className="ml-1 h-3.5 w-3.5" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="border-border bg-background absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border p-1 shadow-lg">
            {presets.map((preset) => (
              <button
                key={preset.slug}
                onClick={() => handleSelect(preset.slug)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  "hover:bg-muted",
                  currentPreset === preset.slug && "bg-muted",
                )}
              >
                <div className="flex-1">
                  <div className="font-medium">{preset.label}</div>
                  <div className="text-muted-foreground text-xs">
                    {preset.description}
                  </div>
                </div>
                {currentPreset === preset.slug && (
                  <Check className="text-primary h-4 w-4 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
