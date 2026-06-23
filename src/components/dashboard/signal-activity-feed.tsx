interface Change {
  companyName: string;
  signalName: string;
  changeDescription: string;
  detectedAt: string;
}

interface SignalActivityFeedProps {
  changes: Change[];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export function SignalActivityFeed({ changes }: SignalActivityFeedProps) {
  if (changes.length === 0) {
    return (
      <div className="border-border rounded-lg border p-4">
        <h2 className="mb-2 text-sm font-semibold">Recent Signal Activity</h2>
        <p className="text-muted-foreground text-sm">
          No signal changes detected in the last 7 days. Set up tracking on
          qualified companies to monitor for buying signals.
        </p>
      </div>
    );
  }

  return (
    <div className="border-border rounded-lg border p-4">
      <h2 className="mb-3 text-sm font-semibold">Recent Signal Activity</h2>
      <div className="space-y-2">
        {changes.map((change, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="text-muted-foreground mt-0.5 shrink-0">
              {"\u00B7"}
            </span>
            <div className="min-w-0 flex-1">
              <span className="font-medium">{change.companyName}</span>
              <span className="text-muted-foreground">
                {" "}
                -- {change.signalName}: {change.changeDescription}
              </span>
            </div>
            <span className="text-muted-foreground shrink-0 text-xs">
              {timeAgo(change.detectedAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
