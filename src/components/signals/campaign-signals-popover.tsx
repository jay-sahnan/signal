"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SafeLink } from "@/components/safe-link";
import { Switch } from "@/components/ui/switch";
import { signalIconMap } from "@/lib/signal-icons";
import { createClient } from "@/lib/supabase/client";
import type { Signal } from "@/lib/types/signal";

interface CampaignSignalsPopoverProps {
  campaignId: string;
}

interface SignalsData {
  signals: Signal[];
  enabled: Record<string, boolean>;
}

async function fetchSignalsData(campaignId: string): Promise<SignalsData> {
  const supabase = createClient();
  const [signalsRes, togglesRes] = await Promise.all([
    supabase
      .from("signals")
      .select("*")
      .order("is_builtin", { ascending: false })
      .order("name"),
    supabase
      .from("campaign_signals")
      .select("signal_id, enabled")
      .eq("campaign_id", campaignId),
  ]);

  const enabled: Record<string, boolean> = {};
  for (const row of togglesRes.data ?? []) {
    enabled[(row as Record<string, unknown>).signal_id as string] = (
      row as Record<string, unknown>
    ).enabled as boolean;
  }

  return {
    signals: (signalsRes.data as Signal[]) ?? [],
    enabled,
  };
}

export function CampaignSignalsPopover({
  campaignId,
}: CampaignSignalsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SignalsData | null>(null);

  const load = useCallback(async () => {
    const result = await fetchSignalsData(campaignId);
    setData(result);
  }, [campaignId]);

  useEffect(() => {
    let cancelled = false;
    fetchSignalsData(campaignId).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const signals = data?.signals ?? [];
  const enabledMap = data?.enabled ?? {};
  const enabledCount = signals.filter((s) => enabledMap[s.id]).length;

  const handleToggle = async (signalId: string, enabled: boolean) => {
    setData((prev) =>
      prev
        ? { ...prev, enabled: { ...prev.enabled, [signalId]: enabled } }
        : prev,
    );
    const supabase = createClient();
    const { error } = await supabase.from("campaign_signals").upsert(
      {
        campaign_id: campaignId,
        signal_id: signalId,
        enabled,
      },
      { onConflict: "campaign_id,signal_id" },
    );
    if (error) {
      toast.error("Failed to toggle signal");
      setData((prev) =>
        prev
          ? {
              ...prev,
              enabled: { ...prev.enabled, [signalId]: !enabled },
            }
          : prev,
      );
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Manage signals">
            <Zap className="mr-1.5 h-4 w-4" />
            Signals
            {data && (
              <span className="text-muted-foreground ml-1.5 tabular-nums">
                {enabledCount}/{signals.length}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-border flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-semibold">Signals</div>
          <SafeLink
            href={`/signals?campaign=${campaignId}`}
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
          >
            Manage
          </SafeLink>
        </div>
        {!data ? (
          <div className="text-muted-foreground px-3 py-6 text-center text-sm">
            Loading...
          </div>
        ) : signals.length === 0 ? (
          <div className="text-muted-foreground px-3 py-6 text-center text-sm">
            No signals defined.
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto p-1">
            {signals.map((signal) => {
              const Icon = (signal.icon && signalIconMap[signal.icon]) || Zap;
              return (
                <div
                  key={signal.id}
                  className="hover:bg-muted/40 flex items-center justify-between rounded-md px-2 py-1.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate text-sm">{signal.name}</span>
                  </div>
                  <Switch
                    checked={enabledMap[signal.id] ?? false}
                    onCheckedChange={(checked) =>
                      handleToggle(signal.id, checked)
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
