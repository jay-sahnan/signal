import { auth } from "@clerk/nextjs/server";

import { getCurrentUserId } from "./identity";

/** The user a tool acts for: injected (MCP) first, Clerk cookie session otherwise. */
export async function actingUserId(): Promise<string | null> {
  return getCurrentUserId(async () => (await auth()).userId);
}
