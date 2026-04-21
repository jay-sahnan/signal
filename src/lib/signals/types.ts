import type { JSONSchema7 } from "json-schema";

export interface SignalEvidence {
  url: string;
  snippet: string;
}

export interface SignalDiff {
  changed: boolean;
  from: unknown;
  to: unknown;
  description: string;
}

export interface SignalOutput {
  found: boolean;
  summary: string;
  evidence: SignalEvidence[];
  data: Record<string, unknown>;
  diff?: SignalDiff;
  confidence: "high" | "medium" | "low";
}

export interface RecipeContext {
  signalId: string;
  organizationId: string;
  campaignId: string;
  company: {
    name: string;
    domain: string | null;
    website: string | null;
  };
}

export type RecipeStep =
  | ToolStep
  | StagehandStep
  | HistoryStep
  | DiffStep
  | ExtractJsonStep;

export interface StagehandStep {
  id: string;
  kind: "stagehand";
  url: string;
  actions?: Array<
    { op: "act"; instruction: string } | { op: "waitMs"; ms: number }
  >;
  extract: {
    instruction: string;
    schema: JSONSchema7;
  };
  model?: string;
}

export interface ToolStep {
  id: string;
  kind: "tool";
  tool: string;
  args: Record<string, unknown>;
  onError?: "fail" | "skip";
}

export interface HistoryStep {
  id: string;
  kind: "history";
  maxAgeDays?: number;
  path?: string;
}

export interface DiffStep {
  id: string;
  kind: "diff";
  current: string;
  baseline: string;
  keyBy?: string;
}

export interface ExtractJsonStep {
  id: string;
  kind: "extract_json";
  from: string;
  schema: JSONSchema7;
  prompt: string;
  model?: string;
}

export interface RecipeOutputSpec {
  foundPath: string;
  summaryTemplate: string;
  evidence: Array<{ urlPath: string; snippetPath: string }>;
  dataPath?: string;
  diffPath?: string;
  confidence?: "high" | "medium" | "low";
}

export interface SignalRecipe {
  version: 1;
  slug: string;
  steps: RecipeStep[];
  output: RecipeOutputSpec;
}

export type StepResults = Record<string, unknown>;
