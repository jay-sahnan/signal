"use client";

/**
 * Sticky banner shown when Clerk is running in Keyless mode (no
 * NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY set). Sign-in works in Keyless, but
 * Supabase RLS rejects Clerk-issued JWTs until CLERK_FRONTEND_API_DOMAIN
 * is configured server-side — so the dashboard appears empty.
 *
 * Reads the publishable key client-side via the inlined NEXT_PUBLIC_* env.
 */
export function KeylessBanner() {
  const isKeyless = !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!isKeyless) return null;
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm">
      <strong>Keyless mode active.</strong> You&apos;re signed in with a Clerk
      ephemeral app, but the dashboard will be empty because Supabase RLS
      can&apos;t validate Clerk-issued JWTs yet. Run{" "}
      <code className="rounded bg-amber-500/20 px-1">pnpm setup</code> and pick
      option [2], or fill in{" "}
      <code className="rounded bg-amber-500/20 px-1">
        CLERK_FRONTEND_API_DOMAIN
      </code>{" "}
      in your <code className="rounded bg-amber-500/20 px-1">.env.local</code>{" "}
      and restart the dev server.{" "}
      <a
        href="https://clerk.com/setup/supabase"
        target="_blank"
        rel="noreferrer"
        className="ml-1 underline"
      >
        Set up Clerk →
      </a>
    </div>
  );
}
