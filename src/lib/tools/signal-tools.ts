import { readFile } from "node:fs/promises";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { getRecipe, hasRecipe, listRecipeSlugs } from "@/lib/signals/recipes";
import { executeSignal } from "@/lib/signals/executor";
import { runRecipe } from "@/lib/signals/runner";
import { createClient } from "@/lib/supabase/server";
import type { Signal } from "@/lib/types/signal";

export const getSignalAuthoringGuide = tool({
  description:
    "Return the Signal Authoring Guide. Call this BEFORE drafting, editing, or saving any signal. Covers the output contract, when to use each execution service, the toolbox, recipe patterns (including fetch→Browserbase-session fallback and diff-over-time), the required test-before-save flow, and five worked exemplars.",
  inputSchema: z.object({}),
  execute: async () => {
    const guidePath = path.join(process.cwd(), "docs", "signal-authoring.md");
    const content = await readFile(guidePath, "utf8");
    return { guide: content };
  },
});

export const testSignalRecipe = tool({
  description:
    "Test any signal -- built-in, custom, or recipe -- against a company. Returns the full SignalOutput (found, summary, evidence, data, diff, confidence). Works with hardcoded recipes (by slug), DB signals (by signalId or slug), and all execution types (exa_search, tool_call, browser_script). Does not write to signal_results.",
  inputSchema: z.object({
    recipeSlug: z
      .string()
      .optional()
      .describe(
        "Slug of a signal or recipe to test. Use '__list__' to see registered recipes.",
      ),
    signalId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Signal ID from the database. Use this for custom or DB signals.",
      ),
    organizationId: z
      .string()
      .uuid()
      .optional()
      .describe("Organization to run against (looks up name/domain from DB)."),
    domain: z
      .string()
      .optional()
      .describe("Plain domain like 'stripe.com' for ad-hoc testing."),
    name: z
      .string()
      .optional()
      .describe("Company name (used with domain). Defaults to the domain."),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID for context; optional."),
  }),
  execute: async (input) => {
    if (input.recipeSlug === "__list__") {
      return { recipes: listRecipeSlugs() };
    }
    if (!input.organizationId && !input.domain) {
      throw new Error("Provide either organizationId or domain");
    }

    const supabase = await createClient();

    // Resolve company context
    let companyName: string;
    let companyDomain: string | null;
    let companyWebsite: string | null;
    let organizationId: string;

    if (input.organizationId) {
      const { data: org, error } = await supabase
        .from("organizations")
        .select("id, name, domain, url")
        .eq("id", input.organizationId)
        .maybeSingle();
      if (error) throw new Error(`DB error: ${error.message}`);
      if (!org)
        throw new Error(`Organization not found: ${input.organizationId}`);
      organizationId = org.id as string;
      companyName = org.name as string;
      companyDomain = (org.domain as string | null) ?? null;
      companyWebsite = (org.url as string | null) ?? null;
    } else {
      const domain = input
        .domain!.replace(/^https?:\/\//, "")
        .replace(/\/$/, "");
      organizationId = "00000000-0000-0000-0000-000000000000";
      companyName = input.name ?? domain;
      companyDomain = domain;
      companyWebsite = `https://${domain}`;
    }

    // Route 1: Hardcoded recipe (by slug)
    if (input.recipeSlug && hasRecipe(input.recipeSlug)) {
      const recipe = getRecipe(input.recipeSlug);
      const stepPreviews: Array<{ id: string; kind: string; preview: string }> =
        [];
      const { output } = await runRecipe({
        recipe,
        context: {
          signalId: `dryrun-${recipe.slug}`,
          organizationId,
          campaignId:
            input.campaignId ?? "00000000-0000-0000-0000-000000000000",
          company: {
            name: companyName,
            domain: companyDomain,
            website: companyWebsite,
          },
        },
        supabaseClient: supabase,
        onStep: (step, result) => {
          const preview =
            typeof result === "string"
              ? result.slice(0, 300)
              : JSON.stringify(result).slice(0, 300);
          stepPreviews.push({ id: step.id, kind: step.kind, preview });
        },
      });
      return { output, steps: stepPreviews };
    }

    // Route 2: DB signal (by signalId or slug)
    let signal: Signal | null = null;

    if (input.signalId) {
      const { data } = await supabase
        .from("signals")
        .select("*")
        .eq("id", input.signalId)
        .single();
      signal = data as Signal | null;
    } else if (input.recipeSlug) {
      const { data } = await supabase
        .from("signals")
        .select("*")
        .eq("slug", input.recipeSlug)
        .single();
      signal = data as Signal | null;
    }

    if (!signal) {
      throw new Error(
        `No signal found. Tried: ${input.signalId ? `id=${input.signalId}` : `slug=${input.recipeSlug}`}. Use recipeSlug='__list__' to see hardcoded recipes, or provide a valid signalId.`,
      );
    }

    // Execute via universal executor
    const output = await executeSignal(signal, {
      organizationId: input.organizationId,
      domain: companyDomain ?? undefined,
      name: companyName,
      campaignId: input.campaignId,
    });

    return {
      output,
      signal: {
        id: signal.id,
        name: signal.name,
        slug: signal.slug,
        execution_type: signal.execution_type,
      },
    };
  },
});

export const getSignals = tool({
  description:
    "List available signals with thin metadata (id, name, category, short description). For full recipe/config of one signal, call getSignalDetail(signalId).",
  inputSchema: z.object({
    category: z
      .enum([
        "hiring",
        "funding",
        "executive",
        "product",
        "engagement",
        "custom",
      ])
      .optional()
      .describe("Filter by category. Omit to get all signals."),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    let query = supabase
      .from("signals")
      .select("id, name, category, description, is_builtin")
      .order("is_builtin", { ascending: false })
      .order("name");

    if (input.category) {
      query = query.eq("category", input.category);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list signals: ${error.message}`);
    const signals = (data ?? []).map((s: Record<string, unknown>) => {
      const desc = (s.description as string | null) ?? null;
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        description:
          desc && desc.length > 200 ? desc.slice(0, 200) + "…" : desc,
        is_builtin: s.is_builtin,
      };
    });
    return { signals };
  },
});

export const getSignalDetail = tool({
  description:
    "Fetch full detail for ONE signal (recipe, config, full description). Use when editing a signal or explaining its recipe to the user.",
  inputSchema: z.object({
    signalId: z.string().uuid().describe("signals.id"),
  }),
  execute: async ({ signalId }) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("signals")
      .select("*")
      .eq("id", signalId)
      .single();
    if (error || !data) {
      return { error: `Signal not found: ${error?.message ?? "no rows"}` };
    }
    return data;
  },
});

export const getCampaignSignals = tool({
  description:
    "Get the thin list of signals for a campaign with enabled/disabled state. Returns id, name, category, short description, and enabled flag only. For full recipe/config, call getSignals and filter to the signal id.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    // Get all signals
    const { data: allSignals, error: sigErr } = await supabase
      .from("signals")
      .select("*")
      .order("is_builtin", { ascending: false })
      .order("name");
    if (sigErr) throw new Error(`Failed to list signals: ${sigErr.message}`);

    // Get campaign toggles
    const { data: toggles, error: togErr } = await supabase
      .from("campaign_signals")
      .select("*")
      .eq("campaign_id", input.campaignId);
    if (togErr)
      throw new Error(`Failed to get campaign signals: ${togErr.message}`);

    const toggleMap = new Map(
      (toggles ?? []).map((t: Record<string, unknown>) => [
        t.signal_id as string,
        t,
      ]),
    );

    const result = (allSignals ?? []).map((s: Record<string, unknown>) => {
      const toggle = toggleMap.get(s.id as string) as
        | Record<string, unknown>
        | undefined;
      const desc = (s.description as string | null) ?? null;
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        description:
          desc && desc.length > 200 ? desc.slice(0, 200) + "…" : desc,
        is_builtin: s.is_builtin,
        enabled: toggle ? (toggle.enabled as boolean) : false,
      };
    });

    return { signals: result };
  },
});

export const toggleCampaignSignal = tool({
  description:
    "Enable or disable a signal for a campaign. Creates the link if it doesn't exist, updates if it does.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
    signalId: z.string().uuid().describe("Signal ID"),
    enabled: z
      .boolean()
      .describe("Whether to enable (true) or disable (false) the signal"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("campaign_signals")
      .upsert(
        {
          campaign_id: input.campaignId,
          signal_id: input.signalId,
          enabled: input.enabled,
        },
        { onConflict: "campaign_id,signal_id" },
      )
      .select("*")
      .single();

    if (error) throw new Error(`Failed to toggle signal: ${error.message}`);
    return {
      campaignSignal: data,
      message: `Signal ${input.enabled ? "enabled" : "disabled"} for campaign`,
    };
  },
});

export const createSignal = tool({
  description:
    "Create a new custom signal. Use this after brainstorming with the user about what they want to track. Fill in execution_type based on what the signal does.",
  inputSchema: z.object({
    name: z.string().describe("Display name for the signal"),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .describe("URL-safe slug, lowercase with hyphens"),
    description: z.string().describe("One-line description shown on card"),
    longDescription: z
      .string()
      .optional()
      .describe("Detailed explanation for Learn More dialog"),
    category: z
      .enum([
        "hiring",
        "funding",
        "executive",
        "product",
        "engagement",
        "custom",
      ])
      .default("custom")
      .describe("Signal category"),
    icon: z
      .string()
      .optional()
      .describe("Lucide icon name (e.g. Shield, Search, Zap)"),
    executionType: z
      .enum(["browser_script", "exa_search", "tool_call", "agent_instructions"])
      .default("agent_instructions")
      .describe("How this signal executes"),
    toolKey: z
      .string()
      .optional()
      .describe("Tool name from allTools (for tool_call type)"),
    config: z
      .record(z.unknown())
      .default({})
      .describe(
        "Execution config: search queries, script params, or instructions",
      ),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("signals")
      .insert({
        name: input.name,
        slug: input.slug,
        description: input.description,
        long_description: input.longDescription ?? null,
        category: input.category,
        icon: input.icon ?? null,
        execution_type: input.executionType,
        tool_key: input.toolKey ?? null,
        config: input.config,
        is_builtin: false,
        is_public: false,
      })
      .select("*")
      .single();

    if (error) throw new Error(`Failed to create signal: ${error.message}`);
    return { signal: data, message: `Created signal "${input.name}"` };
  },
});

export const updateSignal = tool({
  description:
    "Update an existing custom signal. Only works on non-builtin signals. Pass only the fields you want to change.",
  inputSchema: z.object({
    signalId: z.string().uuid().describe("Signal ID to update"),
    name: z.string().optional().describe("New display name"),
    description: z.string().optional().describe("New one-line description"),
    longDescription: z
      .string()
      .optional()
      .describe("New detailed explanation for Learn More dialog"),
    category: z
      .enum([
        "hiring",
        "funding",
        "executive",
        "product",
        "engagement",
        "custom",
      ])
      .optional()
      .describe("New category"),
    icon: z.string().optional().describe("New Lucide icon name"),
    executionType: z
      .enum(["browser_script", "exa_search", "tool_call", "agent_instructions"])
      .optional()
      .describe("New execution type"),
    toolKey: z
      .string()
      .optional()
      .describe("New tool name (for tool_call type)"),
    config: z
      .record(z.unknown())
      .optional()
      .describe("Replacement execution config (full object, not a merge)"),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.longDescription !== undefined)
      patch.long_description = input.longDescription;
    if (input.category !== undefined) patch.category = input.category;
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.executionType !== undefined)
      patch.execution_type = input.executionType;
    if (input.toolKey !== undefined) patch.tool_key = input.toolKey;
    if (input.config !== undefined) patch.config = input.config;

    if (Object.keys(patch).length === 0) {
      throw new Error("No fields provided to update");
    }

    const { data, error } = await supabase
      .from("signals")
      .update(patch)
      .eq("id", input.signalId)
      .eq("is_builtin", false)
      .select("*")
      .single();

    if (error) throw new Error(`Failed to update signal: ${error.message}`);
    if (!data)
      throw new Error(
        "Signal not found or is built-in (built-in signals cannot be edited)",
      );
    return { signal: data, message: `Updated signal "${data.name}"` };
  },
});

export const makeSignalPublic = tool({
  description:
    "Make a custom signal public so other users can see and enable it. Only works on non-builtin signals.",
  inputSchema: z.object({
    signalId: z.string().uuid().describe("Signal ID to make public"),
    isPublic: z.boolean().describe("true to publish, false to unpublish"),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("signals")
      .update({ is_public: input.isPublic })
      .eq("id", input.signalId)
      .eq("is_builtin", false)
      .select("*")
      .single();

    if (error) throw new Error(`Failed to update signal: ${error.message}`);
    return {
      signal: data,
      message: `Signal ${input.isPublic ? "published" : "unpublished"}`,
    };
  },
});

export const getSignalResults = tool({
  description:
    "Read stored signal results for a company or contact. Check this before re-running a signal to avoid duplicate work. Requires a campaignId since results are stored per-campaign.",
  inputSchema: z.object({
    signalId: z.string().uuid().describe("Signal ID"),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Campaign ID. Required to read persisted signal results. Without a campaign, returns empty.",
      ),
    organizationId: z
      .string()
      .uuid()
      .optional()
      .describe("Organization ID to filter results"),
    personId: z
      .string()
      .uuid()
      .optional()
      .describe("Person ID to filter results"),
    maxAgeDays: z
      .number()
      .int()
      .default(7)
      .describe("Only return results newer than this many days"),
  }),
  execute: async (input) => {
    if (!input.campaignId) {
      return {
        results: [],
        message:
          "Signal results are only stored for campaigns. Run the signal's enrichment tools directly for ad-hoc testing.",
      };
    }

    const supabase = await createClient();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - input.maxAgeDays);

    let query = supabase
      .from("signal_results")
      .select("*")
      .eq("signal_id", input.signalId)
      .eq("campaign_id", input.campaignId)
      .gte("ran_at", cutoff.toISOString())
      .order("ran_at", { ascending: false });

    if (input.organizationId)
      query = query.eq("organization_id", input.organizationId);
    if (input.personId) query = query.eq("person_id", input.personId);

    const { data, error } = await query;
    if (error)
      throw new Error(`Failed to get signal results: ${error.message}`);
    return { results: data ?? [] };
  },
});
