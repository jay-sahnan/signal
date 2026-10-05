"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { setCampaignSignal, preferPrivateSignalCopies } from "@/lib/signals/community-copies";
import { createClient } from "@/lib/supabase/client";
import type { Signal } from "@/lib/types/signal";

interface CampaignSignalsPopoverProps {
  campaignId: string;
}

interface SignalsData {
  signals: Signal[];
  enabled: Record<string, boolean>;
  error?: string;
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

  // A failed query must render as an error, not as "No signals defined."
  // or as every toggle switched off: both misstate what is armed.
  const firstError = signalsRes.error ?? togglesRes.error;
  if (firstError) {
    return { signals: [], enabled: {}, error: firstError.message };
  }

  const enabled: Record<string, boolean> = {};
  for (const row of togglesRes.data ?? []) {
    enabled[(row as Record<string, unknown>).signal_id as string] = (
      row as Record<string, unknown>
    ).enabled as boolean;
  }

  return {
    signals: preferPrivateSignalCopies((signalsRes.data as Signal[]) ?? []),
    enabled,
  };
}

export function CampaignSignalsPopover({
  campaignId,
}: CampaignSignalsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SignalsData | null>(null);
  const [toggling, setToggling] = useState(false);
  const togglePending = useRef(false);
  const readRevision = useRef(0);
  const currentCampaign = useRef(campaignId);

  const load = useCallback(async (savedLink?: { signal_id: string; enabled: boolean }) => {
    if (togglePending.current && !savedLink) return;
    const revision = ++readRevision.current;
    const result = await fetchSignalsData(campaignId);
    if (currentCampaign.current === campaignId && revision === readRevision.current) setData(prev => savedLink && prev
      ? { ...result, enabled: { ...prev.enabled, [savedLink.signal_id]: savedLink.enabled } }
      : result);
  }, [campaignId]);

  useEffect(() => {
    currentCampaign.current = campaignId;
    const revision = ++readRevision.current;
    let cancelled = false;
    fetchSignalsData(campaignId).then((result) => {
      if (!cancelled && revision === readRevision.current) setData(result);
    });
    return () => {
      cancelled = true;
      readRevision.current++;
    };
  }, [campaignId]);

  const signals = data?.signals ?? [];
  const enabledMap = data?.enabled ?? {};
  const enabledCount = signals.filter((s) => enabledMap[s.id]).length;

  const handleToggle = async (signalId: string, enabled: boolean) => {
    if (togglePending.current) return;
    togglePending.current = true;
    readRevision.current++;
    setToggling(true);
    try {
      setData((prev) =>
        prev
          ? { ...prev, enabled: { ...prev.enabled, [signalId]: enabled } }
          : prev,
      );
      const supabase = createClient();
      const { data: link, error } = await setCampaignSignal(supabase, campaignId, signalId, enabled);
      if (currentCampaign.current !== campaignId) return;
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
      } else if (link && link.signal_id !== signalId) {
        await load(link);
        if (currentCampaign.current === campaignId)
          toast.success("Community signal copied to your workspace");
      }
    } finally {
      togglePending.current = false;
      setToggling(false);
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
            {data && !data.error && (
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
        ) : data.error ? (
          <div
            role="alert"
            className="text-destructive px-3 py-6 text-center text-sm"
          >
            Could not load signals: {data.error}
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
                    disabled={toggling}
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
