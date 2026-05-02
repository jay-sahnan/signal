"use client";

import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type NodeTypes,
} from "reactflow";
import "reactflow/dist/style.css";

import { PersonNode, type PersonNodeData } from "./person-node";
import {
  DepartmentGroupNode,
  type DepartmentGroupData,
} from "./department-group-node";

const SENIORITY_ORDER = ["founder", "head", "lead", "ic", "intern"] as const;
const COLUMN_WIDTH = 264;
const COLUMN_GAP = 32;
const CARD_HEIGHT = 110;
const CARD_GAP = 12;
const HEADER_HEIGHT = 36;
const PADDING_TOP = 40;
const PADDING_BOTTOM = 16;

export interface OrgChartPerson {
  id: string;
  name: string;
  title: string | null;
  department: string | null;
  seniority: string | null;
  linkedin_url: string | null;
  work_email: string | null;
  outreach_status: string | null;
  role_summary: string | null;
}

const NODE_TYPES: NodeTypes = {
  person: PersonNode,
  department: DepartmentGroupNode,
};

function senioritySortKey(seniority: string | null): number {
  if (!seniority) return SENIORITY_ORDER.length;
  const idx = SENIORITY_ORDER.indexOf(
    seniority as (typeof SENIORITY_ORDER)[number],
  );
  return idx === -1 ? SENIORITY_ORDER.length : idx;
}

function buildLayout(people: OrgChartPerson[]): Node[] {
  const byDept = new Map<string, OrgChartPerson[]>();
  for (const p of people) {
    const key = p.department ?? "Unclassified";
    if (!byDept.has(key)) byDept.set(key, []);
    byDept.get(key)!.push(p);
  }

  const ordered = [...byDept.entries()].sort((a, b) => {
    if (a[0] === "Unclassified") return 1;
    if (b[0] === "Unclassified") return -1;
    return b[1].length - a[1].length;
  });

  const nodes: Node[] = [];
  let xCursor = 0;

  for (const [dept, members] of ordered) {
    members.sort((a, b) => {
      const sa = senioritySortKey(a.seniority);
      const sb = senioritySortKey(b.seniority);
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });

    const groupHeight =
      PADDING_TOP +
      members.length * CARD_HEIGHT +
      Math.max(0, members.length - 1) * CARD_GAP +
      PADDING_BOTTOM;

    nodes.push({
      id: `dept-${dept}`,
      type: "department",
      position: { x: xCursor, y: 0 },
      data: {
        label: dept,
        count: members.length,
        width: COLUMN_WIDTH,
        height: groupHeight,
      } satisfies DepartmentGroupData,
      draggable: false,
      selectable: false,
      style: { width: COLUMN_WIDTH, height: groupHeight, zIndex: -1 },
    });

    members.forEach((p, i) => {
      const y = PADDING_TOP + HEADER_HEIGHT + i * (CARD_HEIGHT + CARD_GAP);
      const x = xCursor + (COLUMN_WIDTH - 240) / 2;
      nodes.push({
        id: p.id,
        type: "person",
        position: { x, y },
        data: {
          personId: p.id,
          name: p.name,
          title: p.title,
          department: p.department,
          seniority: p.seniority,
          linkedin_url: p.linkedin_url,
          work_email: p.work_email,
          outreach_status: p.outreach_status,
          role_summary: p.role_summary,
        } satisfies PersonNodeData,
      });
    });

    xCursor += COLUMN_WIDTH + COLUMN_GAP;
  }

  return nodes;
}

interface OrgChartProps {
  people: OrgChartPerson[];
  onPersonClick?: (personId: string) => void;
}

export function OrgChart({ people, onPersonClick }: OrgChartProps) {
  const nodes = useMemo(() => buildLayout(people), [people]);

  if (people.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[60vh] items-center justify-center text-sm">
        No people yet. Try &ldquo;Find more people&rdquo; to populate the chart.
      </div>
    );
  }

  return (
    <div className="border-border h-[70vh] w-full overflow-hidden rounded-lg border">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_, node) => {
          if (node.type === "person" && onPersonClick) {
            onPersonClick(node.id);
          }
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-muted/50" />
      </ReactFlow>
    </div>
  );
}
