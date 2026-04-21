"use client";

import { useState } from "react";
import { Pencil, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { signalIconMap } from "@/lib/signal-icons";
import type { Signal } from "@/lib/types/signal";

const executionLabels: Record<string, string> = {
  browser_script: "Browser Script",
  exa_search: "Exa Search",
  tool_call: "Tool Call",
  agent_instructions: "Agent Prompt",
};

const executionDescriptions: Record<string, string> = {
  browser_script:
    "Headless browser via Stagehand/Browserbase. Navigates sites and extracts structured data automatically.",
  exa_search:
    "Semantic search via the Exa API. Finds relevant news, articles, and web content matching a query template.",
  tool_call:
    "Calls an existing enrichment tool to gather specific data about a company or contact.",
  agent_instructions:
    "Natural language instructions the agent interprets and fulfills using its available tools.",
};

interface SignalDetailDialogProps {
  signal: Signal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMakePublic?: (signal: Signal) => void;
  onEdit?: (signal: Signal) => void;
}

export function SignalDetailDialog({
  signal,
  open,
  onOpenChange,
  onMakePublic,
  onEdit,
}: SignalDetailDialogProps) {
  const [confirmPublish, setConfirmPublish] = useState(false);

  if (!signal) return null;

  const Icon = (signal.icon && signalIconMap[signal.icon]) || Zap;
  const canPublish = !signal.is_builtin && !signal.is_public && onMakePublic;
  const canEdit = !signal.is_builtin && onEdit;

  const badgeClass = signal.is_builtin
    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
    : signal.is_public
      ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";

  const badgeLabel = signal.is_builtin
    ? "Built-in"
    : signal.is_public
      ? "Community"
      : "Custom";

  const configBlock = getConfigBlock(signal);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setConfirmPublish(false);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[700px] p-0 gap-0 overflow-hidden">
        <DialogDescription className="sr-only">
          {signal.description}
        </DialogDescription>

        {/* Top bar */}
        <div className="flex items-center gap-3 border-b border-border px-5 pr-12 py-3.5">
          <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm font-semibold leading-tight">
              {signal.name}
            </DialogTitle>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={`inline-block rounded px-1 py-px text-[10px] font-medium leading-tight ${badgeClass}`}
              >
                {badgeLabel}
              </span>
              <span className="text-muted-foreground text-[10px] capitalize leading-tight">
                {signal.category}
              </span>
              <span className="text-border">|</span>
              <span className="text-muted-foreground text-[10px] leading-tight">
                {executionLabels[signal.execution_type]}
              </span>
            </div>
          </div>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-xs"
              onClick={() => onEdit?.(signal)}
            >
              <Pencil className="size-3" />
              Edit
            </Button>
          )}
        </div>

        {/* Two-column body */}
        <div className="grid sm:grid-cols-[1fr,1.1fr] min-h-0">
          {/* Left: about */}
          <div className="space-y-4 px-5 py-4 sm:border-r sm:border-border">
            <div>
              <Label>About</Label>
              <p className="text-[13px] leading-relaxed">
                {signal.description}
              </p>
            </div>

            {signal.long_description && (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {signal.long_description}
              </p>
            )}

            {canPublish && (
              <div className="border-border space-y-2.5 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium">Make public</p>
                    <p className="text-muted-foreground text-[11px]">
                      Share so anyone can enable it
                    </p>
                  </div>
                  <Switch
                    checked={confirmPublish}
                    onCheckedChange={setConfirmPublish}
                  />
                </div>
                {confirmPublish && (
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                      This signal and its config will be visible to all users.
                      They&apos;ll need to enable it for their own campaigns.
                    </p>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        onMakePublic?.(signal);
                        setConfirmPublish(false);
                      }}
                    >
                      Publish
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: technical */}
          <div className="bg-muted/40 px-5 py-4 space-y-4">
            <div>
              <Label>Execution</Label>
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-medium">
                  {executionLabels[signal.execution_type]}
                </span>
                {signal.tool_key && (
                  <code className="bg-background/60 ring-border rounded px-1.5 py-0.5 font-mono text-[11px] ring-1">
                    {signal.tool_key}
                  </code>
                )}
              </div>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {executionDescriptions[signal.execution_type]}
              </p>
            </div>

            {configBlock && (
              <div>
                <Label>{configBlock.label}</Label>
                <div className="bg-background/60 ring-border max-h-80 overflow-auto rounded-md p-3 ring-1">
                  {configBlock.content}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold uppercase tracking-widest">
      {children}
    </p>
  );
}

function getConfigBlock(signal: Signal) {
  if (
    signal.execution_type === "agent_instructions" &&
    signal.config &&
    "instructions" in signal.config
  ) {
    return {
      label: "Prompt",
      content: (
        <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
          {String(signal.config.instructions)}
        </p>
      ),
    };
  }

  if (
    signal.execution_type === "exa_search" &&
    signal.config &&
    "query" in signal.config
  ) {
    return {
      label: "Query template",
      content: (
        <div className="space-y-1">
          <code className="font-mono text-xs">
            {String(signal.config.query)}
          </code>
          {"category" in signal.config && signal.config.category ? (
            <p className="text-muted-foreground text-[11px]">
              Source: {String(signal.config.category)}
            </p>
          ) : null}
        </div>
      ),
    };
  }

  if (signal.config && Object.keys(signal.config).length > 0) {
    if (signal.execution_type === "browser_script") {
      const scriptKey = (["browserScript", "script", "code"] as const).find(
        (k) => typeof signal.config[k] === "string",
      );
      const script = scriptKey ? String(signal.config[scriptKey]) : null;
      const rest: Record<string, unknown> = { ...signal.config };
      if (scriptKey) delete rest[scriptKey];
      return {
        label: "Script",
        content: (
          <div className="space-y-3">
            {script && (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {script}
              </pre>
            )}
            {Object.keys(rest).length > 0 && (
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {JSON.stringify(rest, null, 2)}
              </pre>
            )}
          </div>
        ),
      };
    }
    return {
      label: "Tool config",
      content: (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
          {JSON.stringify(signal.config, null, 2)}
        </pre>
      ),
    };
  }

  return null;
}
