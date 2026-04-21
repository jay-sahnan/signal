"use client";

import { useState } from "react";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Search,
  Users,
  BarChart3,
  Globe,
  Bookmark,
  List,
  AlertCircle,
} from "lucide-react";

import { ContactCards } from "./contact-card";

export interface ToolCallCardProps {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  liveViewUrl?: string;
}

const TOOL_CONFIG: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  saveCampaign: { label: "Saving campaign", icon: Bookmark },
  getCampaign: { label: "Loading campaign", icon: Bookmark },
  listCampaigns: { label: "Listing campaigns", icon: List },
  searchCompanies: { label: "Searching companies", icon: Search },
  getCompanies: { label: "Loading companies", icon: Building2 },
  getCampaignSummary: { label: "Loading summary", icon: BarChart3 },
  searchPeople: { label: "Searching people", icon: Users },
  enrichContact: { label: "Enriching contact", icon: Users },
  extractWebContent: { label: "Extracting web content", icon: Globe },
  getContacts: { label: "Loading contacts", icon: Users },
};

// Tools that show their results inline (not collapsible)
const INLINE_TOOLS = new Set(["searchPeople"]);

export function ToolCallCard({
  toolName,
  state,
  output,
  errorText,
  liveViewUrl,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = TOOL_CONFIG[toolName] || {
    label: toolName,
    icon: Search,
  };
  const Icon = config.icon;

  const isLoading = state === "input-streaming" || state === "input-available";
  const hasOutput = state === "output-available";
  const hasError = state === "output-error";
  const isInline = INLINE_TOOLS.has(toolName);

  // Inline tools render their results directly below the status bar
  if (isInline && hasOutput && output != null) {
    return (
      <div className="my-1">
        <div className="bg-muted/40 border-border flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <Icon className="text-muted-foreground h-4 w-4" />
          <span className="text-muted-foreground flex-1 truncate">
            {config.label}
          </span>
        </div>
        <InlineToolResult toolName={toolName} result={output} />
      </div>
    );
  }

  const showLiveView = isLoading && liveViewUrl;

  return (
    <div className="bg-muted/40 border-border my-1 overflow-hidden rounded-lg border text-sm">
      <div className="flex w-full items-center gap-2 px-3 py-2">
        <button
          className="flex flex-1 items-center gap-2 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          {isLoading ? (
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          ) : hasError ? (
            <AlertCircle className="h-4 w-4 text-red-500" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
          <Icon className="text-muted-foreground h-4 w-4" />
          <span className="text-muted-foreground flex-1 truncate">
            {isLoading ? config.label + "..." : config.label}
          </span>
        </button>
        {showLiveView && (
          <a
            href={liveViewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs"
          >
            <ExternalLink className="h-3 w-3" />
            View live
          </a>
        )}
        {(hasOutput || hasError) &&
          (expanded ? (
            <ChevronDown className="text-muted-foreground h-3 w-3" />
          ) : (
            <ChevronRight className="text-muted-foreground h-3 w-3" />
          ))}
      </div>

      {expanded && hasError && errorText && (
        <div className="border-border border-t px-3 py-2">
          <p className="text-xs text-red-500">{errorText}</p>
        </div>
      )}

      {expanded && hasOutput && output != null ? (
        <div className="border-border border-t px-3 py-2">
          <CollapsibleToolResult toolName={toolName} result={output} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Results rendered inline (not inside a collapsible card).
 * Used for searchPeople — shows interactive contact cards.
 */
function InlineToolResult({
  toolName,
  result,
}: {
  toolName: string;
  result: unknown;
}) {
  const data = result as Record<string, unknown>;

  if (toolName === "searchPeople" && data?.contacts) {
    const contacts = data.contacts as Array<{
      id: string;
      name: string;
      title: string | null;
      linkedinUrl: string | null;
    }>;

    if (contacts.length === 0) {
      return (
        <p className="text-muted-foreground px-1 py-2 text-xs">
          No contacts found
        </p>
      );
    }

    return <ContactCards contacts={contacts} />;
  }

  return null;
}

/**
 * Results rendered inside the collapsible card body.
 * Used for most tools (companies table, campaign confirmations, etc.)
 */
function CollapsibleToolResult({
  toolName,
  result,
}: {
  toolName: string;
  result: unknown;
}) {
  const data = result as Record<string, unknown>;

  if (toolName === "searchCompanies" && data?.companies) {
    const companies = data.companies as Array<{
      name: string;
      domain: string | null;
      url: string | null;
      description: string | null;
    }>;
    return (
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">
          Found {data.totalFound as number} results for &quot;
          {data.query as string}&quot;
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="py-1 pr-3 text-left font-medium">Company</th>
                <th className="py-1 pr-3 text-left font-medium">Domain</th>
              </tr>
            </thead>
            <tbody>
              {companies.slice(0, 10).map((c, i) => (
                <tr key={i} className="border-border/50 border-b last:border-0">
                  <td className="py-1 pr-3">{c.name}</td>
                  <td className="text-muted-foreground py-1 pr-3">
                    {c.domain || "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (toolName === "saveCampaign" && data?.campaign) {
    const campaign = data.campaign as { name: string; status: string };
    return (
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-3 w-3 text-green-500" />
        <span className="text-xs">
          Campaign &quot;{campaign.name}&quot; {data.action as string} (
          {campaign.status})
        </span>
      </div>
    );
  }

  if (toolName === "getCampaignSummary" && data?.stats) {
    const stats = data.stats as {
      totalCompanies: number;
      totalContacts: number;
    };
    return (
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">Companies:</span>{" "}
          {stats.totalCompanies}
        </div>
        <div>
          <span className="text-muted-foreground">Contacts:</span>{" "}
          {stats.totalContacts}
        </div>
      </div>
    );
  }

  if (toolName === "enrichContact" && data?.enrichmentData) {
    const enrichment = data.enrichmentData as Record<string, unknown>;
    const sources = Object.keys(enrichment);
    return (
      <div className="text-xs">
        <span className="text-muted-foreground">Enriched from:</span>{" "}
        {sources.join(", ") || "no sources"}
        {data.errors ? (
          <p className="mt-1 text-red-500">
            Errors: {(data.errors as string[]).join(", ")}
          </p>
        ) : null}
      </div>
    );
  }

  // Fallback: show raw JSON
  return (
    <pre className="text-muted-foreground max-h-40 overflow-auto text-xs">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}
