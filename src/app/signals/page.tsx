"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TogglePill } from "@/components/ui/toggle-pill";
import { SignalCard } from "@/components/signals/signal-card";
import { SignalDetailDialog } from "@/components/signals/signal-detail-dialog";
import { useCampaign } from "@/lib/campaign-context";
import { createClient } from "@/lib/supabase/client";
import type { Signal, SignalCategory } from "@/lib/types/signal";
import type { Campaign } from "@/lib/types/campaign";

const CATEGORIES: {
  label: string;
  value: SignalCategory | "all" | "community";
}[] = [
  { label: "All", value: "all" },
  { label: "Hiring", value: "hiring" },
  { label: "Funding", value: "funding" },
  { label: "Executive", value: "executive" },
  { label: "Product", value: "product" },
  { label: "Engagement", value: "engagement" },
  { label: "Custom", value: "custom" },
  { label: "Community", value: "community" },
];

export default function SignalsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-4 md:p-6">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          <span className="text-muted-foreground text-sm">Loading...</span>
        </div>
      }
    >
      <SignalsPageContent />
    </Suspense>
  );
}

function SignalsPageContent() {
  const searchParams = useSearchParams();
  const initialCampaignId = searchParams.get("campaign");
  const { openAgentWith, agentOpen } = useCampaign();

  const [signals, setSignals] = useState<Signal[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(
    initialCampaignId ?? "",
  );
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [detailSignal, setDetailSignal] = useState<Signal | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const [signalsRes, campaignsRes] = await Promise.all([
      supabase
        .from("signals")
        .select("*")
        .order("is_builtin", { ascending: false })
        .order("name"),
      supabase
        .from("campaigns")
        .select("id, name, status")
        .order("updated_at", { ascending: false }),
    ]);
    if (!mountedRef.current) return;
    setSignals((signalsRes.data as Signal[]) ?? []);
    setCampaigns((campaignsRes.data as Campaign[]) ?? []);
    setLoading(false);
  }, []);

  const fetchToggles = useCallback(async (campaignId: string) => {
    if (!campaignId) {
      setEnabledMap({});
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("campaign_signals")
      .select("signal_id, enabled")
      .eq("campaign_id", campaignId);
    if (!mountedRef.current) return;
    const map: Record<string, boolean> = {};
    for (const row of data ?? []) {
      map[(row as Record<string, unknown>).signal_id as string] = (
        row as Record<string, unknown>
      ).enabled as boolean;
    }
    setEnabledMap(map);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedCampaignId) fetchToggles(selectedCampaignId);
    else setEnabledMap({});
  }, [selectedCampaignId, fetchToggles]);

  const handleToggle = async (signalId: string, enabled: boolean) => {
    if (!selectedCampaignId) return;
    setEnabledMap((prev) => ({ ...prev, [signalId]: enabled }));
    const supabase = createClient();
    const { error } = await supabase.from("campaign_signals").upsert(
      {
        campaign_id: selectedCampaignId,
        signal_id: signalId,
        enabled,
      },
      { onConflict: "campaign_id,signal_id" },
    );
    if (error) {
      toast.error("Failed to toggle signal");
      setEnabledMap((prev) => ({ ...prev, [signalId]: !enabled }));
    }
  };

  const handleEdit = (signal: Signal) => {
    setDetailSignal(null);
    openAgentWith(
      `I want to edit the "${signal.name}" signal (id: ${signal.id}). Ask me what I'd like to change, then call updateSignal with the changes. Current config:\n\n\`\`\`json\n${JSON.stringify(
        {
          name: signal.name,
          description: signal.description,
          long_description: signal.long_description,
          category: signal.category,
          icon: signal.icon,
          execution_type: signal.execution_type,
          tool_key: signal.tool_key,
          config: signal.config,
        },
        null,
        2,
      )}\n\`\`\``,
    );
  };

  const handleMakePublic = async (signal: Signal) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("signals")
      .update({ is_public: true })
      .eq("id", signal.id);
    if (error) {
      toast.error("Failed to publish signal");
    } else {
      toast.success("Signal published to community");
      setSignals((prev) =>
        prev.map((s) => (s.id === signal.id ? { ...s, is_public: true } : s)),
      );
      setDetailSignal((prev) =>
        prev?.id === signal.id ? { ...prev, is_public: true } : prev,
      );
    }
  };

  const filtered = signals.filter((s) => {
    if (activeCategory === "all") return true;
    if (activeCategory === "community") return s.is_public && !s.is_builtin;
    return s.category === activeCategory;
  });

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-4 md:p-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Signals</h1>
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Signals</h1>
            <p className="text-muted-foreground text-sm">
              Browse and manage buying signals. Signals guide the agent on what
              to research for each prospect.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              openAgentWith(
                "I want to create a new signal. Help me design it -- ask what I want to track, what the threshold should be, and then create it.",
              )
            }
          >
            <Plus className="size-3.5" />
            New Signal
          </Button>
        </div>

        {/* Campaign selector */}
        <div className="max-w-xs">
          <label
            htmlFor="campaign-select"
            className="text-muted-foreground mb-1 block text-xs font-medium"
          >
            Campaign
          </label>
          <Select
            id="campaign-select"
            value={selectedCampaignId}
            onValueChange={setSelectedCampaignId}
            items={[
              { value: "", label: "No campaign (browse only)" },
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>

        <Separator />

        {/* Category filter */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <TogglePill
              key={cat.value}
              active={activeCategory === cat.value}
              onClick={() => setActiveCategory(cat.value)}
            >
              {cat.label}
            </TogglePill>
          ))}
        </div>

        {/* Signal cards grid / list */}
        <div
          key={agentOpen ? "narrow" : "wide"}
          className={
            agentOpen
              ? "animate-in fade-in-0 duration-200 grid gap-4 grid-cols-1"
              : "animate-in fade-in-0 duration-200 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          }
        >
          {filtered.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              variant="card"
              enabled={enabledMap[signal.id] ?? false}
              showToggle={!!selectedCampaignId}
              onToggle={handleToggle}
              onClick={setDetailSignal}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-muted-foreground col-span-full py-8 text-center text-sm">
              No signals in this category.
            </p>
          )}
        </div>
      </div>

      <SignalDetailDialog
        signal={detailSignal}
        open={!!detailSignal}
        onOpenChange={(open) => {
          if (!open) setDetailSignal(null);
        }}
        onMakePublic={handleMakePublic}
        onEdit={handleEdit}
      />
    </div>
  );
}
