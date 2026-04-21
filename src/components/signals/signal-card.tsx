"use client";

import { Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { signalIconMap } from "@/lib/signal-icons";
import type { Signal, SignalExecutionType } from "@/lib/types/signal";

const serviceLabels: Record<SignalExecutionType, string> = {
  browser_script: "Browser",
  exa_search: "Exa",
  tool_call: "Tool",
  agent_instructions: "Agent",
};

interface SignalCardProps {
  signal: Signal;
  enabled?: boolean;
  showToggle?: boolean;
  variant?: "card" | "row";
  onToggle?: (signalId: string, enabled: boolean) => void;
  onClick?: (signal: Signal) => void;
}

export function SignalCard({
  signal,
  enabled,
  showToggle = false,
  variant = "card",
  onToggle,
  onClick,
}: SignalCardProps) {
  const Icon = (signal.icon && signalIconMap[signal.icon]) || Zap;

  const badge = signal.is_builtin
    ? "Built-in"
    : signal.is_public
      ? "Community"
      : "Custom";

  const badgeClass = signal.is_builtin
    ? "bg-blue-500/10 text-blue-500"
    : signal.is_public
      ? "bg-purple-500/10 text-purple-500"
      : "bg-emerald-500/10 text-emerald-500";

  const serviceLabel =
    signal.execution_type === "tool_call" && signal.tool_key
      ? signal.tool_key
      : serviceLabels[signal.execution_type];

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={() => onClick?.(signal)}
        className="border-border bg-card hover:bg-muted/50 flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors"
      >
        <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium">{signal.name}</h3>
            <span
              className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeClass}`}
            >
              {badge}
            </span>
            <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px]">
              {serviceLabel}
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {signal.description}
          </p>
        </div>
        {showToggle && (
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => onToggle?.(signal.id, checked)}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0"
          />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onClick?.(signal)}
      className="border-border bg-card hover:bg-muted/50 flex flex-col gap-3 rounded-lg border p-4 text-left transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-muted flex size-8 items-center justify-center rounded-md">
            <Icon className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-medium">{signal.name}</h3>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeClass}`}
              >
                {badge}
              </span>
              <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-mono text-[10px]">
                {serviceLabel}
              </span>
            </div>
          </div>
        </div>
        {showToggle && (
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => onToggle?.(signal.id, checked)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        {signal.description}
      </p>
    </button>
  );
}
