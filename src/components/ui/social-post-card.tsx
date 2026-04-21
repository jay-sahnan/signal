import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";

export interface PostMetric {
  label: string;
  value: number | string | null | undefined;
}

interface SocialPostCardProps {
  text: string;
  metrics?: PostMetric[];
  date?: string | null;
  url?: string | null;
  formatDate?: (iso: string) => string;
}

const LINK_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded";

function formatMetricValue(value: PostMetric["value"]) {
  if (value == null) return null;
  if (typeof value === "number") return value.toLocaleString();
  return value;
}

export function SocialPostCard({
  text,
  metrics,
  date,
  url,
  formatDate,
}: SocialPostCardProps) {
  const visible = (metrics ?? []).filter((m) => m.value != null);

  return (
    <div className="border-border bg-background rounded-md border p-2.5 text-sm">
      <p className="line-clamp-3 leading-relaxed">{text}</p>
      <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {visible.map((m, i) => (
          <span key={i} className="tabular-nums">
            {formatMetricValue(m.value)} {m.label}
          </span>
        ))}
        {date && (
          <span className="tabular-nums">
            {formatDate ? formatDate(date) : date}
          </span>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open post in new tab"
            className={cn(
              "hover:text-foreground ml-auto transition-colors",
              LINK_FOCUS,
            )}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
