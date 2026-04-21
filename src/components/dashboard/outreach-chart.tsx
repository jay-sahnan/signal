"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface TimeSeriesPoint {
  date: string;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
}

interface OutreachChartProps {
  timeSeries: TimeSeriesPoint[];
  range: string;
  onRangeChange: (range: string) => void;
}

const ranges = ["7d", "30d", "All"];

export function OutreachChart({
  timeSeries,
  range,
  onRangeChange,
}: OutreachChartProps) {
  return (
    <div className="border-border rounded-lg border p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Outreach Activity</h2>
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r === "All" ? "all" : r)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                range === (r === "All" ? "all" : r)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {timeSeries.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center">
          <p className="text-muted-foreground text-sm">
            No outreach activity yet
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={timeSeries}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(d: string) => {
                const date = new Date(d + "T00:00:00");
                return date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                });
              }}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              allowDecimals={false}
              className="text-muted-foreground"
            />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                fontSize: "12px",
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-background)",
              }}
            />
            <Area
              type="monotone"
              dataKey="sent"
              name="Sent"
              stroke="oklch(0.623 0.214 259.815)"
              fill="oklch(0.623 0.214 259.815)"
              fillOpacity={0.1}
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="opened"
              name="Opened"
              stroke="oklch(0.769 0.188 70.08)"
              fill="oklch(0.769 0.188 70.08)"
              fillOpacity={0.1}
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="replied"
              name="Replied"
              stroke="oklch(0.723 0.219 149.579)"
              fill="oklch(0.723 0.219 149.579)"
              fillOpacity={0.1}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
