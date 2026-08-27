import type { z } from "zod";

import { allTools } from "@/lib/tools";

/**
 * Tools that only make sense with the web chat's UI attached. The voice tools
 * read the active swipe run from experimental_context.voiceRun, which only the
 * chat route supplies; over MCP they could only ever answer "no active run".
 */
const MCP_EXCLUDE = new Set<string>([
  "startVoiceRun",
  "rewriteVoiceDrafts",
  "saveVoiceProfile",
  // Promises to navigate the user's browser tab; over MCP there is none.
  "openPage",
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

/**
 * Largest result handed back to an MCP client, in characters. Past this the
 * client would have to spill the payload to disk anyway; the note tells the
 * model to page or narrow instead of retrying the same call.
 */
export const MCP_RESULT_MAX_CHARS = 100_000;

export function toMcpResult(result: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  // Compact JSON: indentation was a quarter of every payload for nothing.
  let text =
    typeof result === "string" ? result : JSON.stringify(result ?? null);
  if (text.length > MCP_RESULT_MAX_CHARS) {
    const full = text.length;
    text =
      text.slice(0, MCP_RESULT_MAX_CHARS) +
      `\n\n[Result truncated: ${MCP_RESULT_MAX_CHARS} of ${full} characters shown. ` +
      "Use limit/offset or a narrower filter and call again.]";
  }
  return { content: [{ type: "text", text }] };
}
