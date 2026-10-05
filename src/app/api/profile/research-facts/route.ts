import { NextResponse } from "next/server";

import { z } from "zod";
import { executePaidAction } from "@/lib/billing/paid-action";
import { CreditExecutionError } from "@/lib/billing/credit-execution";

import { loadAllSenderFacts } from "@/lib/sender-facts";
import {
  dedupeFacts,
  hostOf,
  researchSender,
} from "@/lib/services/sender-research";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import type { UserProfile } from "@/lib/types/profile";

// Exa searches across up to four profile URLs plus one extraction call can
// take tens of seconds; same budget as the other research-shaped routes.
export const maxDuration = 120;

const BodySchema = z.object({
  profileId: z.string().uuid(),
});

/**
 * Research the sender behind a profile and append the resulting facts to the
 * profile's fact bank. Runs server-side so the Exa key never reaches the
 * browser; the profile page's "Research my profile" button posts here.
 */
export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "profileId must be a UUID" },
      { status: 400 },
    );
  }

  // RLS-scoped read: someone else's profileId resolves to nothing, so a
  // foreign id gets the same 404 as a nonexistent one.
  const { data: profile } = await supabase
    .from("user_profile")
    .select("*")
    .eq("id", parsed.data.profileId)
    .maybeSingle();

  if (!profile || profile.user_id !== user.id) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const urls = [
    profile.linkedin_url,
    profile.personal_url,
    profile.company_url,
    profile.twitter_url,
  ];
  if (!urls.some((url) => typeof url === "string" && url.trim() && hostOf(url)))
    return NextResponse.json(
      { error: "Add a profile URL before researching." },
      { status: 400 },
    );

  try {
    const output = await executePaidAction(
      {
        identity: { userId: user.id, source: "web" },
        key: request.headers.get("Idempotency-Key"),
        kind: "profile.research",
        request: {
          profileId: profile.id,
          name: profile.name ?? null,
          companyName: profile.company_name ?? null,
          urls: urls.map((url) => url ?? null),
        },
      },
      async () => {
        const result = await researchSender(profile as UserProfile, user.id);
        if (!result.ok) throw new Error(result.error);
        const existingRes = await loadAllSenderFacts(supabase, profile.id);
        if (!existingRes.ok) throw new Error("Existing fact bank unavailable");
        const survivors = dedupeFacts(result.facts, existingRes.facts);
        const skippedAsDuplicates = result.facts.length - survivors.length;
        if (survivors.length === 0) return { added: 0, skippedAsDuplicates };
        const { data: inserted, error } = await supabase
          .from("sender_facts")
          .insert(
            survivors.map((f) => ({
              user_id: user.id,
              profile_id: profile.id,
              category: f.category,
              fact: f.fact,
              source: "research",
            })),
          )
          .select("id");
        if (error) throw new Error("Could not save researched facts");
        return {
          added: inserted?.length ?? survivors.length,
          skippedAsDuplicates,
        };
      },
    );
    return NextResponse.json(output);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof CreditExecutionError
            ? error.message
            : "Research could not be completed. Retry with the same request; contact support if it remains pending.",
      },
      { status: error instanceof CreditExecutionError ? error.status : 503 },
    );
  }
}
