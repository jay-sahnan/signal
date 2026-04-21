import { cn } from "@/lib/utils";
import { ScoreBadge, scoreTier } from "@/components/ui/score-badge";

interface PriorityCalloutProps {
  score: number | null | undefined;
  reason?: string | null;
  scoreMax?: number;
  className?: string;
}

export function PriorityCallout({
  score,
  reason,
  scoreMax = 10,
  className,
}: PriorityCalloutProps) {
  if (score == null || score <= 0) return null;

  const tier = scoreTier(score);
  const borderColor =
    tier === "high"
      ? "border-l-emerald-500/50"
      : tier === "mid"
        ? "border-l-blue-500/50"
        : "border-l-border";

  return (
    <div
      className={cn(
        "bg-muted/30 rounded-md border-l-2 px-3 py-2.5",
        borderColor,
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Priority</span>
        <ScoreBadge score={score} />
        <span className="text-muted-foreground text-xs tabular-nums">
          of {scoreMax}
        </span>
      </div>
      {reason && <p className="text-muted-foreground mt-1 text-sm">{reason}</p>}
    </div>
  );
}
