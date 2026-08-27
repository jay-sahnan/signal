export function mcpConfigError(): string | null {
  if (!process.env.SUPABASE_JWT_SECRET) {
    return (
      "MCP is not configured: SUPABASE_JWT_SECRET is unset. Copy the JWT " +
      "secret from Supabase Dashboard: Settings: API, and redeploy."
    );
  }
  return null;
}
