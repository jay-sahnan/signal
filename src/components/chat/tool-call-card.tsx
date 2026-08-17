"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Github,
  Globe,
  List,
  Loader2,
  Mail,
  Mic,
  Search,
  Send,
  Star,
  Trash2,
  Users,
} from "lucide-react";

import { ContactCards } from "./contact-card";
import { buttonVariants } from "@/components/ui/button";
import { isNavigablePath } from "@/lib/navigation";

export interface ToolCallCardProps {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  liveViewUrl?: string;
}

// Every tool in src/lib/tools/index.ts gets a user-facing label; the raw
// camelCase name is only a fallback for tools added after this map.
const TOOL_CONFIG: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  // Campaigns
  saveCampaign: { label: "Saving campaign", icon: Bookmark },
  getCampaign: { label: "Loading campaign", icon: Bookmark },
  listCampaigns: { label: "Listing campaigns", icon: List },
  getCampaignSummary: { label: "Loading summary", icon: BarChart3 },
  // Company search & discovery
  searchCompanies: { label: "Searching companies", icon: Search },
  discoverCompanies: { label: "Discovering companies", icon: Search },
  searchYCCompanies: { label: "Searching YC companies", icon: Search },
  getCompanies: { label: "Loading companies", icon: Building2 },
  getCompanyDetail: { label: "Loading company detail", icon: Building2 },
  updateCompanyStatus: { label: "Updating company status", icon: Building2 },
  setCompanyWebsite: { label: "Setting company website", icon: Globe },
  deleteCompanies: { label: "Removing companies", icon: Trash2 },
  // Enrichment & scoring
  enrichCompany: { label: "Enriching company", icon: Building2 },
  enrichCompanies: { label: "Enriching companies", icon: Building2 },
  scoreCompany: { label: "Scoring company", icon: Star },
  scoreContact: { label: "Scoring contact", icon: Star },
  getDataQualityReport: { label: "Checking data quality", icon: BarChart3 },
  getGoogleReviews: { label: "Loading Google reviews", icon: Star },
  // People & contacts
  searchPeople: { label: "Searching people", icon: Users },
  findContacts: { label: "Finding contacts", icon: Users },
  getContacts: { label: "Loading contacts", icon: Users },
  getContactDetail: { label: "Loading contact detail", icon: Users },
  enrichContact: { label: "Enriching contact", icon: Users },
  enrichContacts: { label: "Enriching contacts", icon: Users },
  deleteContacts: { label: "Removing contacts", icon: Trash2 },
  // Web & scraping
  extractWebContent: { label: "Extracting web content", icon: Globe },
  fetchSitemap: { label: "Fetching sitemap", icon: Globe },
  scrapeJobListings: { label: "Scanning job listings", icon: Globe },
  scrapeJobListingsBatch: { label: "Scanning job listings", icon: Globe },
  // Profiles
  getUserProfile: { label: "Loading profile", icon: Users },
  updateUserProfile: { label: "Updating profile", icon: Users },
  listProfiles: { label: "Listing profiles", icon: List },
  // Signals
  getSignalAuthoringGuide: { label: "Loading signal guide", icon: FileText },
  testSignalRecipe: { label: "Testing signal recipe", icon: Activity },
  getSignals: { label: "Loading signals", icon: Activity },
  getSignalDetail: { label: "Loading signal detail", icon: Activity },
  getCampaignSignals: { label: "Loading campaign signals", icon: Activity },
  toggleCampaignSignal: { label: "Toggling campaign signal", icon: Activity },
  createSignal: { label: "Creating signal", icon: Activity },
  updateSignal: { label: "Updating signal", icon: Activity },
  makeSignalPublic: { label: "Publishing signal", icon: Activity },
  getSignalResults: { label: "Loading signal results", icon: Activity },
  // GitHub
  fetchGitHubStargazers: { label: "Fetching GitHub stargazers", icon: Github },
  enrichGitHubProfiles: { label: "Enriching GitHub profiles", icon: Github },
  searchGitHubRepos: { label: "Searching GitHub repos", icon: Github },
  // Tracking
  createTracking: { label: "Setting up tracking", icon: Activity },
  bulkCreateTracking: { label: "Setting up tracking", icon: Activity },
  getTrackingConfigs: { label: "Loading tracking", icon: Activity },
  getTrackingHistory: { label: "Loading tracking history", icon: Activity },
  updateTracking: { label: "Updating tracking", icon: Activity },
  // Email
  findEmail: { label: "Finding email address", icon: Mail },
  findEmails: { label: "Finding email addresses", icon: Mail },
  writeEmail: { label: "Drafting email", icon: Mail },
  sendEmail: { label: "Sending email", icon: Send },
  sendBulkEmails: { label: "Sending emails", icon: Send },
  listDrafts: { label: "Listing drafts", icon: Mail },
  discardDraft: { label: "Discarding draft", icon: Trash2 },
  // Sequences
  createSequence: { label: "Creating sequence", icon: List },
  draftSequenceEmails: { label: "Drafting sequence emails", icon: Mail },
  draftEmailsForSequence: { label: "Drafting sequence emails", icon: Mail },
  getSequenceStatus: { label: "Loading sequence status", icon: List },
  // Navigation
  openPage: { label: "Opening page", icon: ArrowUpRight },
  // Voice
  startVoiceRun: { label: "Starting voice drafting", icon: Mic },
  rewriteVoiceDrafts: { label: "Rewriting drafts", icon: Mic },
  saveVoiceProfile: { label: "Saving voice profile", icon: Mic },
  refineEmailVoice: { label: "Refining email voice", icon: Mic },
};

// Tools that show their results inline (not collapsible)
export const INLINE_TOOLS = new Set(["searchPeople"]);

/**
 * A short human-readable subject for a call — which company, query, or URL
 * it is about — pulled from well-known input fields. Batch enrichment only
 * carries UUIDs at input time, so completed calls fall back to the names in
 * the output.
 */
function toolSubject(
  toolName: string,
  input: unknown,
  output: unknown,
): string | null {
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const list = (v: unknown) =>
    Array.isArray(v) && v.length > 0
      ? v.filter((s): s is string => typeof s === "string").join(", ") || null
      : null;

  const d = (input ?? {}) as Record<string, unknown>;
  const fromInput =
    str(d.query) ??
    str(d.companyName) ??
    list(d.companyNames) ??
    str(d.name) ??
    str(d.url) ??
    str(d.domain) ??
    list(d.titles);
  if (fromInput) return fromInput;

  // enrichCompanies output names each company it touched
  if (toolName === "enrichCompanies" && output && typeof output === "object") {
    const results = (output as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      const names = results
        .map((r) => (r as Record<string, unknown>)?.companyName)
        .filter((n): n is string => typeof n === "string");
      if (names.length > 0) return names.join(", ");
    }
  }
  return null;
}

export function ToolCallCard({
  toolName,
  state,
  input,
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
  const subject = toolSubject(toolName, input, output);

  const isLoading = state === "input-streaming" || state === "input-available";
  const hasOutput = state === "output-available";
  const hasError = state === "output-error";
  const isInline = INLINE_TOOLS.has(toolName);

  // openPage already navigated the tab when it ran; what stays in the
  // transcript is a button back to the page, so the destination is one click
  // away after the turn ends or the chat is reloaded. Same-tab Next link:
  // the chat panel lives in the shell and survives client-side navigation.
  if (toolName === "openPage" && hasOutput && output != null) {
    const nav = output as { path?: unknown; label?: unknown; error?: unknown };
    if (typeof nav.path === "string" && isNavigablePath(nav.path)) {
      return (
        <div className="my-1">
          <Link
            href={nav.path}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            Open {typeof nav.label === "string" ? nav.label : "page"}
          </Link>
        </div>
      );
    }
  }

  // Inline tools render their results directly below the status bar
  if (isInline && hasOutput && output != null) {
    return (
      <div className="my-1">
        <div className="bg-muted/40 border-border flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <Icon className="text-muted-foreground h-4 w-4" />
          <span className="text-muted-foreground flex-1 truncate">
            {config.label}
            {subject && (
              <span className="text-muted-foreground/70"> · {subject}</span>
            )}
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
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
          <Icon className="text-muted-foreground h-4 w-4" />
          <span className="text-muted-foreground flex-1 truncate">
            {isLoading ? config.label + "..." : config.label}
            {subject && (
              <span className="text-muted-foreground/70"> · {subject}</span>
            )}
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
          <p className="text-xs text-destructive">{errorText}</p>
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
 * A run of consecutive calls to the same tool, collapsed to a single row
 * ("Scoring company ×10") that expands to the individual cards. Keeps batch
 * work from filling the transcript with near-identical rows.
 */
export function ToolCallGroup({
  calls,
}: {
  calls: Array<ToolCallCardProps & { toolCallId: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const toolName = calls[0].toolName;
  const config = TOOL_CONFIG[toolName] || { label: toolName, icon: Search };
  const Icon = config.icon;

  const anyLoading = calls.some(
    (c) => c.state === "input-streaming" || c.state === "input-available",
  );
  const anyError = calls.some((c) => c.state === "output-error");
  const doneCount = calls.filter((c) => c.state === "output-available").length;

  return (
    <div className="bg-muted/40 border-border my-1 overflow-hidden rounded-lg border text-sm">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {anyLoading ? (
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        ) : anyError ? (
          <AlertCircle className="h-4 w-4 text-destructive" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-success" />
        )}
        <Icon className="text-muted-foreground h-4 w-4" />
        <span className="text-muted-foreground flex-1 truncate">
          {config.label} ×{calls.length}
          {anyLoading && (
            <span className="text-muted-foreground/70">
              {" "}
              · {doneCount}/{calls.length} done
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronDown className="text-muted-foreground h-3 w-3" />
        ) : (
          <ChevronRight className="text-muted-foreground h-3 w-3" />
        )}
      </button>
      {expanded && (
        <div className="border-border border-t px-2 pb-1 pt-0.5">
          {calls.map(({ toolCallId, ...call }) => (
            <ToolCallCard key={toolCallId} {...call} />
          ))}
        </div>
      )}
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
                    {c.domain || "-"}
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
        <CheckCircle2 className="h-3 w-3 text-success" />
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
          <p className="mt-1 text-destructive">
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
