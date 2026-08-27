import type { z } from "zod";

import { allTools } from "@/lib/tools";

/**
 * Tools that only make sense with the web chat's UI attached. The voice tools
 * read the active swipe run from experimental_context.voiceRun, which only the
 * chat route supplies; over MCP they could only ever answer "no active run".
 * openPage is fine: without a writer it degrades to returning the path.
 */
const MCP_EXCLUDE = new Set<string>([
  "startVoiceRun",
  "rewriteVoiceDrafts",
  "saveVoiceProfile",
]);

export type McpTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  execute: (input: unknown, opts: unknown) => Promise<unknown>;
};

export function mcpToolList(): McpTool[] {
  return Object.entries(allTools)
    .filter(([name]) => !MCP_EXCLUDE.has(name))
    .map(([name, t]) => {
      const tool = t as {
        description?: string;
        inputSchema: z.ZodObject<z.ZodRawShape>;
        execute?: (input: unknown, opts: unknown) => unknown;
      };
      return {
        name,
        description: tool.description ?? name,
        inputSchema: tool.inputSchema,
        execute: async (input, opts) => tool.execute?.(input, opts),
      };
    });
}

export function toMcpResult(result: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  const text =
    typeof result === "string"
      ? result
      : JSON.stringify(result ?? null, null, 2);
  return { content: [{ type: "text", text }] };
}
