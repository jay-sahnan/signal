import { cn } from "@/lib/utils";

interface SequenceProgressBarProps {
  enrolled: number;
  waiting: number;
  sent: number;
  replied: number;
  className?: string;
}

export function SequenceProgressBar({
  enrolled,
  waiting,
  sent,
  replied,
  className,
}: SequenceProgressBarProps) {
  const total = Math.max(enrolled, 1);
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <div className={cn("flex flex-col gap-1.5 min-w-[180px]", className)}>
      <div className="bg-muted flex h-1.5 overflow-hidden rounded-full">
        <span className="bg-emerald-500" style={{ width: pct(replied) }} />
        <span className="bg-orange-500" style={{ width: pct(sent) }} />
        <span className="bg-amber-400" style={{ width: pct(waiting) }} />
      </div>
      <div className="text-muted-foreground flex gap-3 text-xs tabular-nums">
        <span>{replied} replied</span>
        <span>{sent} sent</span>
        <span>{waiting} waiting</span>
        <span className="ml-auto">{enrolled} total</span>
      </div>
    </div>
  );
}
