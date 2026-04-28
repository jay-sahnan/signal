import { NextResponse } from "next/server";
import { INTEGRATIONS } from "@/lib/integrations";
import { getSupabaseAndUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StatusEntry {
  id: string;
  configured: boolean;
  missingEnvVars: string[];
}

/**
 * GET /api/integrations/status
 * Reports which integrations are fully configured. Returns booleans + the
 * names of any unset env vars — never the values themselves. Authenticated
 * users only, so this can't be probed by an unauthenticated client.
 *
 * Special case for the Supabase entry: the Supabase env vars must be set
 * for `getSupabaseAndUser()` to succeed, which means by the time we reach
 * this code, Supabase is configured. We still report it so the settings
 * panel can show the green check.
 */
export async function GET() {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statuses: StatusEntry[] = INTEGRATIONS.map((integration) => {
    const missingEnvVars = integration.envVars.filter(
      (name) => !process.env[name],
    );
    return {
      id: integration.id,
      configured: missingEnvVars.length === 0,
      missingEnvVars,
    };
  });

  return NextResponse.json({ statuses });
}
