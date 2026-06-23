"use client";

import { cn } from "@/lib/utils";

const tabs = [
  { slug: "qa", label: "QA" },
  { slug: "complaints", label: "Complaints" },
  { slug: "sales-compliance", label: "Sales Compliance" },
] as const;

interface ICPTabsProps {
  activeTab: string;
  onTabChange: (slug: string) => void;
}

export function ICPTabs({ activeTab, onTabChange }: ICPTabsProps) {
  return (
    <div className="border-border flex gap-1 rounded-lg border p-1">
      {tabs.map((tab) => (
        <button
          key={tab.slug}
          onClick={() => onTabChange(tab.slug)}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-medium transition-colors",
            activeTab === tab.slug
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
