import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { auth } from "@clerk/nextjs/server";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/** Bearer OAuth token (issued by Clerk) to MCP AuthInfo, or undefined. */
export async function verifyMcpBearer(
  token: string,
): Promise<AuthInfo | undefined> {
  const clerkAuth = await auth({ acceptsToken: "oauth_token" });
  return verifyClerkToken(clerkAuth, token);
}
