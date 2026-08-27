import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { runWithIdentity } from "@/lib/auth/identity";
import { verifyMcpBearer } from "@/lib/mcp/auth";
import { mcpToolList, toMcpResult } from "@/lib/mcp/registry";

// Same ceiling as /api/chat: enrichment batches run for minutes.
export const maxDuration = 800;

const handler = createMcpHandler(
  (server) => {
    for (const t of mcpToolList()) {
      server.tool(
        t.name,
        t.description,
        t.inputSchema.shape,
        async (input, { authInfo }) => {
          const userId = authInfo?.extra?.userId as string | undefined;
          if (!userId) {
            return { isError: true, ...toMcpResult({ error: "Unauthorized" }) };
          }
          try {
            const result = await runWithIdentity(
              { userId, source: "mcp" },
              () => t.execute(input, {}),
            );
            return toMcpResult(result);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { isError: true, ...toMcpResult({ error: message }) };
          }
        },
      );
    }
  },
  {},
  { basePath: "/api/mcp", maxDuration, verboseLogs: false },
);

const authed = withMcpAuth(
  handler,
  async (_req, token) => verifyMcpBearer(token ?? ""),
  {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
  },
);

export { authed as GET, authed as POST, authed as DELETE };
