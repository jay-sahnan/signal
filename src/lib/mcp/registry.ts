import type { z } from "zod";

import { allTools } from "@/lib/tools";

/**
 * Tools that only make sense with the web chat's streaming UI attached.
 * Empty today: openPage degrades to returning the path as data. Add names
 * here when a tool has no meaning without a `writer`.
 */
const MCP_EXCLUDE = new Set<string>([]);

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
