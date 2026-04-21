import { cn } from "@/lib/utils";

interface RelativeTimeProps {
  iso: string;
  className?: string;
}

export function formatRelative(iso: string, now = Date.now()): string {
  const diffMs = new Date(iso).getTime() - now;
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return "now";
  const minutes = Math.floor(abs / 60_000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes - days * 60 * 24) / 60);
  const rem = minutes - days * 60 * 24 - hours * 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0 && rem > 0) parts.push(`${rem}m`);
  const body = parts.join(" ") || "<1m";
  return past ? `${body} ago` : `in ${body}`;
}

export function RelativeTime({ iso, className }: RelativeTimeProps) {
  return (
    <time
      dateTime={iso}
      className={cn("tabular-nums", className)}
      title={new Date(iso).toLocaleString()}
    >
      {formatRelative(iso)}
    </time>
  );
}
