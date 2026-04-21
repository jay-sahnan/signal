import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  size?: "default" | "sm";
  className?: string;
}

export function StatCard({
  label,
  value,
  sublabel,
  size = "default",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn("border-border rounded-lg border px-3 py-2.5", className)}
    >
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-semibold tabular-nums",
            size === "sm" ? "text-xl" : "text-2xl",
          )}
        >
          {value}
        </span>
        {sublabel && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {sublabel}
          </span>
        )}
      </div>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}
