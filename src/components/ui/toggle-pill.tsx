import { cn } from "@/lib/utils";

interface TogglePillProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  active: boolean;
  children: React.ReactNode;
}

export function TogglePill({
  active,
  className,
  children,
  ...props
}: TogglePillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "focus-visible:ring-ring rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2",
        active
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:bg-muted/80",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
