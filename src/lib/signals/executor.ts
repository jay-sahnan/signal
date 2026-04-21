import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { ExaService } from "@/lib/services/exa-service";
import { structuralDiff } from "./diff";
import { runRecipe } from "./runner";
import { getRecipe } from "./recipes";
import type { Signal } from "@/lib/types/signal";
import type { SignalOutput, RecipeContext } from "./types";

export interface ExecuteSignalContext {
  organizationId?: string;
  domain?: string;
  name?: string;
  campaignId?: string;
  /** Use admin client (for tracking runs without user session) */
  useAdmin?: boolean;
}

/**
 * Universal signal executor. Handles all execution types:
 * - exa_search: Exa semantic search + diff against previous results
 * - tool_call: invoke a tool from the allowlist
 * - browser_script: Stagehand scraping or recipe runner
 * - agent_instructions: not supported for automated execution
 */
export async function executeSignal(
  signal: Signal,
  ctx: ExecuteSignalContext,
): Promise<SignalOutput> {
  switch (signal.execution_type) {
    case "exa_search":
      return executeExaSearch(signal, ctx);
    case "tool_call":
      return executeToolCall(signal, ctx);
    case "browser_script":
      return executeBrowserScript(signal, ctx);
    case "agent_instructions":
      return {
        found: false,
        summary:
          "Agent-based signals require a full AI conversation and cannot run automatically in tracking.",
        evidence: [],
        data: {},
        confidence: "low",
      };
    default:
      return {
        found: false,
        summary: `Unknown execution type: ${signal.execution_type}`,
        evidence: [],
        data: {},
        confidence: "low",
      };
  }
}

// ── Exa Search Handler ─────────────────────────────────────────────────────

async function executeExaSearch(
  signal: Signal,
  ctx: ExecuteSignalContext,
): Promise<SignalOutput> {
  const config = signal.config ?? {};
  const queryTemplate = (config.query as string) ?? signal.name;

  // Render query with context -- supports both {company} and {{company}} syntax
  const companyName = ctx.name ?? "";
  const domain = ctx.domain ?? "";
  const query = queryTemplate
    .replace(/\{\{?company\}?\}/gi, companyName)
    .replace(/\{\{?domain\}?\}/gi, domain)
    .replace(/\{\{?name\}?\}/gi, companyName)
    .replace(/\{\{?title\}?\}/gi, ""); // {title} used in exec-changes, strip if no context

  // If template had no variables rendered, prepend company name
  const finalQuery =
    query === queryTemplate && companyName
      ? `"${companyName}" ${domain} ${query}`
      : query;

  const exa = new ExaService();
  const results = await exa.search(finalQuery, {
    numResults: (config.numResults as number) ?? 5,
    includeText: true,
    category: (config.category as "news") ?? undefined,
  });

  // Build evidence from results
  const evidence = results.results.slice(0, 5).map((r) => ({
    url: r.url,
    snippet: (r.text ?? r.title).slice(0, 280),
  }));

  // Diff against previous results
  const diff = await diffAgainstPrevious(
    signal.id,
    ctx.organizationId,
    results.results.map((r) => ({ title: r.title, url: r.url })),
    ctx.useAdmin,
  );

  const found = results.resultCount > 0;

  return {
    found,
    summary: found
      ? `Found ${results.resultCount} results for "${finalQuery.slice(0, 80)}"`
      : `No results found for "${finalQuery.slice(0, 80)}"`,
    evidence,
    data: {
      query: finalQuery,
      resultCount: results.resultCount,
      results: results.results.map((r) => ({
        title: r.title,
        url: r.url,
        publishedDate: r.publishedDate,
        text: r.text?.slice(0, 500) ?? null,
      })),
    },
    diff: diff ?? undefined,
    confidence: found ? "medium" : "low",
  };
}

// ── Tool Call Handler ──────────────────────────────────────────────────────

async function executeToolCall(
  signal: Signal,
  ctx: ExecuteSignalContext,
): Promise<SignalOutput> {
  const toolKey = signal.tool_key;
  if (!toolKey) {
    return {
      found: false,
      summary: "Signal has no tool_key configured.",
      evidence: [],
      data: {},
      confidence: "low",
    };
  }

  // Dynamic import to avoid circular deps
  const { getRecipeTool } = await import("./tool-registry");

  let tool;
  try {
    tool = getRecipeTool(toolKey);
  } catch {
    return {
      found: false,
      summary: `Tool "${toolKey}" is not in the allowed tool list.`,
      evidence: [],
      data: {},
      confidence: "low",
    };
  }

  if (!tool.execute) {
    return {
      found: false,
      summary: `Tool "${toolKey}" has no execute function.`,
      evidence: [],
      data: {},
      confidence: "low",
    };
  }

  // Build args from signal config + context
  const config = signal.config ?? {};
  const args: Record<string, unknown> = { ...config };

  // Map context to tool-specific arg names
  if (ctx.organizationId) args.organizationId = ctx.organizationId;
  if (ctx.domain) {
    args.domain = ctx.domain;
    // extractWebContent needs url, not domain
    if (toolKey === "extractWebContent" && !args.url) {
      args.url = `https://${ctx.domain}`;
    }
  }
  // enrichContact needs contactId -- signal can't run without a person context
  if (toolKey === "enrichContact" && !args.contactId) {
    return {
      found: false,
      summary:
        "Social engagement signal requires a specific contact (person). Use this signal with contact-level tracking, not company-level.",
      evidence: [],
      data: {},
      confidence: "low",
    };
  }

  try {
    const result = await tool.execute(args, {
      toolCallId: `signal-${signal.id}`,
      messages: [],
    });

    const data =
      typeof result === "object" && result !== null
        ? (result as Record<string, unknown>)
        : { result };

    return {
      found: true,
      summary: `Tool "${toolKey}" executed successfully.`,
      evidence: [],
      data,
      confidence: "medium",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return {
      found: false,
      summary: `Tool "${toolKey}" failed: ${msg}`,
      evidence: [],
      data: { error: msg },
      confidence: "low",
    };
  }
}

// ── Browser Script Handler ─────────────────────────────────────────────────

async function executeBrowserScript(
  signal: Signal,
  ctx: ExecuteSignalContext,
): Promise<SignalOutput> {
  // Check if there's a hardcoded recipe for this signal
  try {
    const recipe = getRecipe(signal.slug);
    // Has a recipe -- use the recipe runner
    const recipeContext: RecipeContext = {
      signalId: signal.id,
      organizationId: ctx.organizationId ?? "",
      campaignId: ctx.campaignId ?? "",
      company: {
        name: ctx.name ?? "",
        domain: ctx.domain ?? null,
        website: ctx.domain ? `https://${ctx.domain}` : null,
      },
    };

    const { output } = await runRecipe({ recipe, context: recipeContext });
    return output;
  } catch {
    // No hardcoded recipe -- fall through
  }

  // Check for hiring-activity special case
  if (signal.slug === "hiring-activity") {
    return executeHiringActivity(ctx);
  }

  // Generic browser_script: use Stagehand with config.instructions
  const config = signal.config ?? {};
  const instructions = config.instructions as string;
  const targetUrl = ctx.domain
    ? `https://${ctx.domain}`
    : (config.url as string);

  if (!targetUrl) {
    return {
      found: false,
      summary: "No domain or URL available for browser scraping.",
      evidence: [],
      data: {},
      confidence: "low",
    };
  }

  // Use extractWebContent as the browser fallback
  const { getRecipeTool } = await import("./tool-registry");
  const extractTool = getRecipeTool("extractWebContent");

  if (!extractTool.execute) {
    return {
      found: false,
      summary: "extractWebContent tool not available.",
      evidence: [],
      data: {},
      confidence: "low",
    };
  }

  try {
    const result = await extractTool.execute(
      { url: targetUrl, includeLinks: false },
      { toolCallId: `signal-${signal.id}`, messages: [] },
    );

    const data =
      typeof result === "object" && result !== null
        ? (result as Record<string, unknown>)
        : { result };

    return {
      found: true,
      summary: instructions
        ? `Extracted content from ${targetUrl}. Instructions: ${instructions.slice(0, 100)}`
        : `Extracted content from ${targetUrl}`,
      evidence: [
        { url: targetUrl, snippet: JSON.stringify(data).slice(0, 280) },
      ],
      data,
      confidence: "medium",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return {
      found: false,
      summary: `Browser extraction failed: ${msg}`,
      evidence: [],
      data: { error: msg },
      confidence: "low",
    };
  }
}

// ── Hiring Activity (special case) ─────────────────────────────────────────

async function executeHiringActivity(
  ctx: ExecuteSignalContext,
): Promise<SignalOutput> {
  if (!ctx.domain || !ctx.organizationId) {
    return {
      found: false,
      summary: "Hiring activity requires a company domain and organization ID.",
      evidence: [],
      data: {},
      confidence: "low",
    };
  }

  const { scrapeHiringData } = await import("@/lib/services/hiring-scraper");
  const result = await scrapeHiringData(ctx.organizationId, ctx.domain);

  const found = result.totalJobs > 0;

  return {
    found,
    summary: found
      ? `Found ${result.totalJobs} open positions at ${ctx.name ?? ctx.domain}`
      : `No open positions found at ${ctx.name ?? ctx.domain}`,
    evidence: result.careersUrl
      ? [
          {
            url: result.careersUrl,
            snippet: `${result.totalJobs} positions found`,
          },
        ]
      : [],
    data: {
      careersUrl: result.careersUrl,
      jobs: result.jobs,
      totalJobs: result.totalJobs,
    },
    confidence: found ? "high" : "medium",
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function diffAgainstPrevious(
  signalId: string,
  organizationId: string | undefined,
  currentData: unknown,
  useAdmin?: boolean,
): Promise<SignalOutput["diff"] | null> {
  if (!organizationId) return null;

  const supabase = useAdmin ? getAdminClient() : await createClient();

  const { data: prev } = await supabase
    .from("signal_results")
    .select("output")
    .eq("signal_id", signalId)
    .eq("organization_id", organizationId)
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!prev) return null;

  const previousData = (prev.output as Record<string, unknown>)?.data;
  if (!previousData) return null;

  const diff = structuralDiff(previousData, currentData);
  return {
    changed: diff.changed,
    from: diff.from,
    to: diff.to,
    description: diff.description,
  };
}
