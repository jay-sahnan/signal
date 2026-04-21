import { cn } from "@/lib/utils";

function Box({ className }: { className?: string }) {
  return <div className={cn("bg-muted/40 animate-pulse rounded", className)} />;
}

export function PageHeaderSkeleton({ withActions }: { withActions?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2">
        <Box className="h-7 w-64" />
        <Box className="h-4 w-80 max-w-full" />
      </div>
      {withActions && (
        <div className="flex gap-2">
          <Box className="h-8 w-28 rounded-lg" />
          <Box className="h-8 w-28 rounded-lg" />
        </div>
      )}
    </div>
  );
}

export function StatsRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Box key={i} className="h-16 rounded-lg" />
      ))}
    </div>
  );
}

export function ListRowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Box key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

export function TableRowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <Box key={i} className="h-10 rounded" />
      ))}
    </div>
  );
}

export function PageSkeleton({
  statsCount,
  withActions,
}: {
  statsCount?: number;
  withActions?: boolean;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        <PageHeaderSkeleton withActions={withActions} />
        {statsCount && <StatsRowSkeleton count={statsCount} />}
        <ListRowsSkeleton />
      </div>
    </div>
  );
}
