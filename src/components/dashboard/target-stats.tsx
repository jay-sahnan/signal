import { StatCard } from "@/components/ui/stat-card";

interface TargetStatsProps {
  stats: {
    totalCompanies: number;
    qualified: number;
    readyToContact: number;
    avgScore: number;
  };
}

export function TargetStats({ stats }: TargetStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Companies" value={stats.totalCompanies} />
      <StatCard label="Qualified" value={stats.qualified} />
      <StatCard label="Ready to Contact" value={stats.readyToContact} />
      <StatCard label="Avg Score" value={stats.avgScore} sublabel="out of 10" />
    </div>
  );
}
