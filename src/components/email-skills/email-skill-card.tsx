"use client";

import { Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { EmailSkill } from "@/lib/types/email-skill";

interface EmailSkillCardProps {
  skill: EmailSkill;
  attached?: boolean;
  showToggle?: boolean;
  onToggle?: (skillId: string, attached: boolean) => void;
  onClick?: (skill: EmailSkill) => void;
}

export function EmailSkillCard({
  skill,
  attached,
  showToggle = false,
  onToggle,
  onClick,
}: EmailSkillCardProps) {
  const badgeLabel = skill.is_builtin ? "Built-in" : "Custom";
  const badgeClass = skill.is_builtin
    ? "bg-blue-500/10 text-blue-500"
    : "bg-emerald-500/10 text-emerald-500";

  return (
    <button
      type="button"
      onClick={() => onClick?.(skill)}
      className="border-border bg-card hover:bg-muted/50 flex flex-col gap-3 rounded-lg border p-4 text-left transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium">{skill.name}</h3>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badgeClass}`}
              >
                {badgeLabel}
              </span>
            </div>
          </div>
        </div>
        {showToggle && (
          <Switch
            checked={attached}
            onCheckedChange={(checked) => onToggle?.(skill.id, checked)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>

      {skill.description && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {skill.description}
        </p>
      )}
    </button>
  );
}
