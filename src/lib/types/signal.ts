export type SignalCategory =
  | "hiring"
  | "funding"
  | "executive"
  | "product"
  | "engagement"
  | "custom";

export type SignalExecutionType =
  | "browser_script"
  | "exa_search"
  | "tool_call"
  | "agent_instructions";

export interface Signal {
  id: string;
  name: string;
  slug: string;
  description: string;
  long_description: string | null;
  category: SignalCategory;
  icon: string | null;
  execution_type: SignalExecutionType;
  tool_key: string | null;
  config: Record<string, unknown>;
  is_builtin: boolean;
  is_public: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignSignal {
  id: string;
  campaign_id: string;
  signal_id: string;
  enabled: boolean;
  config_override: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  signal?: Signal;
}

export interface SignalResult {
  id: string;
  signal_id: string;
  campaign_id: string;
  organization_id: string | null;
  person_id: string | null;
  tracking_config_id: string | null;
  output: Record<string, unknown>;
  status: "success" | "failed" | "partial";
  ran_at: string;
}
