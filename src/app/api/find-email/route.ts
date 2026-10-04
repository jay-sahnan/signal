import { isHostedMode } from "@/lib/auth/workspace";
import { runWithIdentity } from "@/lib/auth/identity";
import { CreditExecutionError } from "@/lib/billing/credit-execution";
import { NextResponse } from "next/server";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { findEmailForPerson } from "@/lib/tools/email-tools";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * User-triggered "Find email" for a single contact. Wraps the same
 * findEmailForPerson logic the agent uses, with an ownership check so users
 * can only resolve emails for people in their own campaigns.
 */
export async function POST(req: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  let body: { personId?: string; revalidate?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const personId = body?.personId;
  if (typeof personId !== "string" || !personId.trim()) {
    return NextResponse.json({ error: "personId required" }, { status: 400 });
  }

  // Ownership check: person must be linked to a campaign owned by this user.
  const { data: ownership } = await supabase
    .from("campaign_people")
    .select("campaign:campaigns!inner(user_id)")
    .eq("person_id", personId)
    .limit(1)
    .maybeSingle();

  const ownerId =
    (ownership?.campaign as unknown as { user_id?: string } | null)?.user_id ??
    null;

  if (!ownerId || ownerId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // `revalidate` re-checks an address that is stored but unverified. Without it
  // the send gate's own advice ("run findEmail") could not be followed from the
  // UI, because findEmailForPerson short-circuits on any stored address.
  try {
    const lookup = () =>
      findEmailForPerson(personId, {
        revalidate: body.revalidate === true,
        operationKey: req.headers.get("Idempotency-Key"),
      });
    const result = isHostedMode()
      ? await runWithIdentity({ userId: user.id, source: "web" }, lookup)
      : await lookup();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CreditExecutionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("[find-email] Lookup failed", error);
    return NextResponse.json(
      { error: "Email lookup failed. Retry the same request." },
      { status: 500 },
    );
  }
}
