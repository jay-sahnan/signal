import { cn } from "@/lib/utils";

type Variant = "pill" | "inline";

const TIER_STYLES = {
  high: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  mid: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  low: "bg-muted text-muted-foreground",
} as const;

function tierFor(score: number): keyof typeof TIER_STYLES {
  if (score >= 7) return "high";
  if (score >= 4) return "mid";
  return "low";
}

interface ScoreBadgeProps {
  score: number | null | undefined;
  variant?: Variant;
  className?: string;
  label?: string;
}

export function ScoreBadge({
  score,
  variant = "pill",
  className,
  label,
}: ScoreBadgeProps) {
  if (score == null || score <= 0) return null;
  const tier = TIER_STYLES[tierFor(score)];

  if (variant === "inline") {
    return (
      <span
        className={cn(
          "tabular-nums",
          tier.split(" ").slice(1).join(" "),
          className,
        )}
      >
        {label ? `${label} ${score}` : score}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        tier,
        className,
      )}
    >
      {score}
    </span>
  );
}

export function scoreTier(score: number) {
  return tierFor(score);
}
