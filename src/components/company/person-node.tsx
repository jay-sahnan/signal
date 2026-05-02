"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import { Linkedin, Mail } from "lucide-react";

import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<
  string,
  { bg: string; ring: string; label: string }
> = {
  not_contacted: {
    bg: "bg-muted text-muted-foreground",
    ring: "ring-border",
    label: "Not contacted",
  },
  queued: {
    bg: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    ring: "ring-blue-500/30",
    label: "Queued",
  },
  sent: {
    bg: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    ring: "ring-blue-500/30",
    label: "Sent",
  },
  delivered: {
    bg: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    ring: "ring-blue-500/30",
    label: "Delivered",
  },
  opened: {
    bg: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    ring: "ring-amber-500/30",
    label: "Opened",
  },
  clicked: {
    bg: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    ring: "ring-amber-500/30",
    label: "Clicked",
  },
  replied: {
    bg: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    ring: "ring-emerald-500/40",
    label: "Replied",
  },
  bounced: {
    bg: "bg-red-500/10 text-red-700 dark:text-red-400",
    ring: "ring-red-500/30",
    label: "Bounced",
  },
  complained: {
    bg: "bg-red-500/10 text-red-700 dark:text-red-400",
    ring: "ring-red-500/30",
    label: "Complained",
  },
};

export interface PersonNodeData {
  personId: string;
  name: string;
  title: string | null;
  department: string | null;
  seniority: string | null;
  linkedin_url: string | null;
  work_email: string | null;
  outreach_status: string | null;
  role_summary: string | null;
}

export function PersonNode({ data, selected }: NodeProps<PersonNodeData>) {
  const status = data.outreach_status ?? "not_contacted";
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.not_contacted;

  return (
    <div
      className={cn(
        "border-border bg-card w-[240px] cursor-pointer rounded-md border p-2.5 shadow-sm ring-1 transition-all hover:shadow-md",
        style.ring,
        selected && "ring-2 ring-primary",
      )}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{data.name}</div>
          {data.title && (
            <div className="text-muted-foreground truncate text-xs">
              {data.title}
            </div>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
            style.bg,
          )}
        >
          {style.label}
        </span>
      </div>

      {data.role_summary && (
        <div className="text-muted-foreground mt-1.5 line-clamp-2 text-[11px]">
          {data.role_summary}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        {data.linkedin_url && (
          <a
            href={data.linkedin_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground"
            aria-label="LinkedIn"
          >
            <Linkedin className="h-3.5 w-3.5" />
          </a>
        )}
        {data.work_email && (
          <a
            href={`mailto:${data.work_email}`}
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Email"
          >
            <Mail className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}
