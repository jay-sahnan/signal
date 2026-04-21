import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  variant?: "default" | "danger";
  className?: string;
  children?: React.ReactNode;
}

/**
 * Single source of truth for a settings "section" on /settings and /profile.
 * One component → one header shape → one drift-free page. The `actions` slot
 * on the right carries badges, links, or buttons without each callsite
 * rebuilding the flex layout. Variant="danger" tints the whole block so
 * destructive zones read as different at a glance.
 */
export function SettingsSection({
  title,
  description,
  actions,
  variant = "default",
  className,
  children,
}: SettingsSectionProps) {
  const isDanger = variant === "danger";
  return (
    <section
      className={cn(
        "space-y-4",
        isDanger &&
          "border-destructive/30 bg-destructive/5 rounded-lg border p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2
            className={cn(
              "text-lg font-semibold",
              isDanger && "text-destructive",
            )}
          >
            {title}
          </h2>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Small uppercase eyebrow label shown above a cluster of SettingsSections.
 * Gives the page information-architecture without introducing a full left nav.
 */
export function SettingsGroupLabel({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest">
      {children}
    </p>
  );
}
