"use client";

import { type NodeProps } from "reactflow";

export interface DepartmentGroupData {
  label: string;
  count: number;
  width: number;
  height: number;
}

export function DepartmentGroupNode({ data }: NodeProps<DepartmentGroupData>) {
  return (
    <div
      className="border-border/60 bg-muted/20 rounded-lg border-2 border-dashed"
      style={{ width: data.width, height: data.height }}
    >
      <div className="text-muted-foreground sticky top-0 px-3 pt-2 text-xs font-semibold tracking-wide uppercase">
        {data.label}
        <span className="text-muted-foreground/70 ml-1.5 font-normal">
          {data.count}
        </span>
      </div>
    </div>
  );
}
