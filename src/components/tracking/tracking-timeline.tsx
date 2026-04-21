import type { TrackingChange } from "@/lib/types/tracking";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function TrackingTimeline({ changes }: { changes: TrackingChange[] }) {
  if (changes.length === 0) {
    return (
      <p className="text-muted-foreground py-2 text-xs">
        No changes recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-1 py-2">
      {changes.map((change) => (
        <div key={change.id} className="flex items-start gap-3 text-sm">
          <span className="text-muted-foreground w-14 shrink-0 text-xs">
            {formatDate(change.detected_at)}
          </span>
          <div className="flex-1">
            <span
              className={
                change.change_type === "threshold_crossed"
                  ? "font-medium text-emerald-600 dark:text-emerald-400"
                  : change.change_type === "added"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : change.change_type === "removed"
                      ? "text-red-500 dark:text-red-400"
                      : "text-foreground"
              }
            >
              {change.description}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
