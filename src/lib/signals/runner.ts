import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, jsonSchema } from "ai";
import { createClient } from "@/lib/supabase/server";
import { withTimeout } from "@/lib/utils/timeout";
import { structuralDiff } from "./diff";
import { jsonSchemaToZod } from "./json-schema-to-zod";
import { resolveArgs, resolvePath, renderTemplate } from "./paths";
import { getRecipeTool } from "./tool-registry";

const STAGEHAND_INIT_TIMEOUT_MS = 60_000;
import type {
  RecipeContext,
  RecipeStep,
  SignalEvidence,
  SignalOutput,
  SignalRecipe,
  StepResults,
} from "./types";

export interface RunRecipeOptions {
  recipe: SignalRecipe;
  context: RecipeContext;
  supabaseClient?: Awaited<ReturnType<typeof createClient>>;
  onStep?: (step: RecipeStep, result: unknown) => void;
}

export async function runRecipe(
  options: RunRecipeOptions,
): Promise<{ output: SignalOutput; steps: StepResults }> {
  const { recipe, context, onStep } = options;
  const supabase = options.supabaseClient ?? (await createClient());
  const steps: StepResults = {};
  const scope = buildScope(context, steps);

  for (const step of recipe.steps) {
    const result = await executeStep(step, scope, {
      signalId: context.signalId,
      organizationId: context.organizationId,
      supabase,
    });
    steps[step.id] = result;
    onStep?.(step, result);
  }

  const output = buildOutput(recipe, scope);
  return { output, steps };
}

function buildScope(
  context: RecipeContext,
  steps: StepResults,
): Record<string, unknown> {
  return { context, ...steps };
}

async function executeStep(
  step: RecipeStep,
  scope: Record<string, unknown>,
  env: {
    signalId: string;
    organizationId: string;
    supabase: Awaited<ReturnType<typeof createClient>>;
  },
): Promise<unknown> {
  switch (step.kind) {
    case "tool": {
      const tool = getRecipeTool(step.tool);
      const args = resolveArgs(step.args, scope);
      if (!tool.execute) {
        throw new Error(`Tool "${step.tool}" has no execute function`);
      }
      try {
        const result = await tool.execute(args, {
          toolCallId: `recipe-${step.id}`,
          messages: [],
        });
        return result;
      } catch (err) {
        if (step.onError === "skip") {
          return { error: String(err) };
        }
        throw err;
      }
    }
    case "stagehand": {
      const url = resolveArgs({ url: step.url }, scope).url as string;
      const apiKey = process.env.BROWSERBASE_API_KEY;
      const projectId = process.env.BROWSERBASE_PROJECT_ID;
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey || !projectId || !anthropicKey) {
        const missing = [
          !apiKey && "BROWSERBASE_API_KEY",
          !projectId && "BROWSERBASE_PROJECT_ID",
          !anthropicKey && "ANTHROPIC_API_KEY",
        ]
          .filter(Boolean)
          .join(", ");
        throw new Error(`Stagehand step missing required env vars: ${missing}`);
      }
      const { Stagehand } = await import("@browserbasehq/stagehand");
      const stagehand = new Stagehand({
        env: "BROWSERBASE",
        apiKey,
        projectId,
        model: {
          modelName: step.model ?? "anthropic/claude-sonnet-4-6",
          apiKey: anthropicKey,
        },
        disablePino: true,
      });
      try {
        await withTimeout(
          stagehand.init(),
          STAGEHAND_INIT_TIMEOUT_MS,
          "stagehand.init (signals-runner)",
        );
        const page = stagehand.context.pages()[0];
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeoutMs: 30000,
        });
        for (const action of step.actions ?? []) {
          if (action.op === "act") {
            const instruction = renderTemplate(action.instruction, scope);
            await stagehand.act(instruction);
          } else if (action.op === "waitMs") {
            await page.waitForTimeout(action.ms);
          }
        }
        const zodSchema = jsonSchemaToZod(step.extract.schema);
        const extracted = await stagehand.extract(
          renderTemplate(step.extract.instruction, scope),
          zodSchema,
        );
        return { url: page.url(), extracted };
      } finally {
        try {
          await stagehand.close();
        } catch {
          // ignore
        }
      }
    }
    case "history": {
      if (!isUuid(env.signalId) || !isUuid(env.organizationId)) {
        return { present: false, value: null, reason: "dryrun" };
      }
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (step.maxAgeDays ?? 90));
      const { data } = await env.supabase
        .from("signal_results")
        .select("output, ran_at")
        .eq("signal_id", env.signalId)
        .eq("organization_id", env.organizationId)
        .gte("ran_at", cutoff.toISOString())
        .order("ran_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return { present: false, value: null };
      const output = data.output as Record<string, unknown>;
      const value = step.path ? resolvePath(output, step.path) : output;
      return { present: true, value, ran_at: data.ran_at };
    }
    case "diff": {
      const baseline = resolvePath(scope, step.baseline);
      const current = resolvePath(scope, step.current);
      return structuralDiff(baseline, current, step.keyBy);
    }
    case "extract_json": {
      const source = resolvePath(scope, step.from);
      if (typeof source !== "string" || !source.trim()) {
        return null;
      }
      const { object } = await generateObject({
        model: anthropic(step.model ?? "claude-haiku-4-5-20251001"),
        schema: jsonSchema(step.schema),
        prompt: `${step.prompt}\n\n---\n\n${source.slice(0, 30_000)}`,
      });
      return object;
    }
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function buildOutput(
  recipe: SignalRecipe,
  scope: Record<string, unknown>,
): SignalOutput {
  const spec = recipe.output;
  const foundRaw = resolvePath(scope, spec.foundPath);
  const found = !!foundRaw;
  const summary = renderTemplate(spec.summaryTemplate, scope).trim();
  const evidence: SignalEvidence[] = [];
  for (const ev of spec.evidence) {
    const url = resolvePath(scope, ev.urlPath);
    const snippet = resolvePath(scope, ev.snippetPath);
    if (typeof url === "string" && url) {
      evidence.push({
        url,
        snippet:
          typeof snippet === "string"
            ? snippet.slice(0, 280)
            : snippet == null
              ? ""
              : JSON.stringify(snippet).slice(0, 280),
      });
    }
  }
  const data = spec.dataPath
    ? ((resolvePath(scope, spec.dataPath) as
        | Record<string, unknown>
        | undefined) ?? {})
    : {};
  const diff = spec.diffPath
    ? (resolvePath(scope, spec.diffPath) as SignalOutput["diff"])
    : undefined;
  return {
    found,
    summary: summary || (found ? "Signal fired." : "No match."),
    evidence,
    data,
    diff,
    confidence: spec.confidence ?? "medium",
  };
}
