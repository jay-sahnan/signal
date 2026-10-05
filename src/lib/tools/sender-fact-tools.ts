import { tool } from "ai";
import { z } from "zod";
import { executePaidAction, hasPaidAction } from "@/lib/billing/paid-action";
import { getWebBillingTurn } from "@/lib/billing/web-billing-turn";
import { NoBillableWork, requestHash } from "@/lib/billing/credit-execution";
import { toolOperationKey } from "@/lib/billing/tool-operation-key";
import { getCurrentIdentity } from "@/lib/auth/identity";
import { isHostedMode } from "@/lib/auth/workspace";
import { actingUserId } from "@/lib/auth/acting-user";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FACT_CATEGORIES,
  loadAllSenderFacts,
  loadSenderFacts,
  type FactCategory,
} from "@/lib/sender-facts";
import {
  dedupeFacts,
  hostOf,
  researchSender,
} from "@/lib/services/sender-research";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/lib/types/profile";

/**
 * Group facts by category in canonical FACT_CATEGORIES order, dropping
 * empty categories. Pure so the ordering contract is unit-testable.
 */
export function groupFactsByCategory<
  T extends { category: string; fact: string },
>(facts: T[]): Array<{ category: FactCategory; facts: string[] }> {
  return FACT_CATEGORIES.flatMap((category) => {
    const matching = facts.filter((f) => f.category === category);
    return matching.length
      ? [{ category, facts: matching.map((f) => f.fact) }]
      : [];
  });
}

/** Resolve a profile by id, else the most recent one. Null if none exists. */
async function resolveProfile(
  supabase: SupabaseClient,
  profileId?: string,
): Promise<UserProfile | null> {
  if (profileId) {
    const { data, error } = await supabase
      .from("user_profile")
      .select("*")
      .eq("id", profileId)
      .single();
    if (error) throw new Error(`Failed to get profile: ${error.message}`);
    return data as UserProfile;
  }

  const { data, error } = await supabase
    .from("user_profile")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to get profile: ${error.message}`);
  return (data as UserProfile) ?? null;
}

const NO_PROFILE_ERROR =
  "No profile found. Create one with updateUserProfile first.";

export const researchSenderProfile = tool({
  description:
    "Research the user's own profile URLs (LinkedIn, website, company, Twitter) and extract true facts about them into their sender fact bank -- career background, proof points, stories, opinions, credibility markers, personal interests. The fact bank is what the email drafter draws on: it picks at most 1-2 facts per recipient to make outreach personal and credible. Requires the profile to have at least one URL saved; if it has none, ask the user to add their LinkedIn or website first. Offer this after a profile is set up.",
  inputSchema: z.object({
    operationId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Hosted MCP: supply a new UUID for new paid research; reuse it exactly when retrying. A new UUID represents a new billable request.",
      ),
    profileId: z
      .string()
      .uuid()
      .optional()
      .describe("Profile to research. Omit to use the most recent profile."),
  }),
  execute: async (input, opts) => {
    const userId = await actingUserId();
    if (!userId) return { error: "Not authenticated." };

    const supabase = await createClient();
    const profile = await resolveProfile(supabase, input.profileId);
    if (!profile) return { error: NO_PROFILE_ERROR };

    const identity = getCurrentIdentity() ?? { userId, source: "web" as const };
    const paidInput = {
      identity,
      key: toolOperationKey(identity.source, input.operationId, opts.toolCallId),
      kind: "profile.research",
      // Source fields are server state, not a new caller request on retry.
      request: { profileId: profile.id },
    };
    const urls = [
      profile.linkedin_url,
      profile.personal_url,
      profile.company_url,
      profile.twitter_url,
    ];
    const hasSources = urls.some((url) => url?.trim() && hostOf(url));
    if (isHostedMode()) {
      if ((profile as UserProfile & { user_id?: string }).user_id !== userId)
        return { error: NO_PROFILE_ERROR };
      if (!hasSources && !(await hasPaidAction(paidInput)))
        return { error: "Add a usable profile URL before researching." };
    }
    const sourceRevision = requestHash({ urls: urls.map(url => url ?? null), name: profile.name ?? null });
    const outcome = await executePaidAction<
      ({ error: string } | {
        ok: boolean; added: number; skippedAsDuplicates: number;
        facts: ReturnType<typeof groupFactsByCategory>; message?: string;
      }) & { sourceRevision?: string }
    >(
      paidInput,
      async () => {
        if (isHostedMode() && !hasSources) return new NoBillableWork({
          error: "Add a usable profile URL before researching. No credits were charged.",
          sourceRevision,
        });
        const result = await researchSender(profile, userId);
        if (!result.ok) {
          if (isHostedMode()) throw new Error(result.error);
          return { error: result.error };
        }

        // Full-bank baseline, refused on error: an empty or truncated baseline
        // re-inserts facts that already exist.
        const existingRes = await loadAllSenderFacts(supabase, profile.id);
        if (!existingRes.ok) {
          if (isHostedMode()) throw new Error("Existing fact bank unavailable");
          return {
            error: `Could not load the existing fact bank (${existingRes.error}), so nothing was saved: inserting without it would duplicate facts. Retry.`,
          };
        }
        const survivors = dedupeFacts(result.facts, existingRes.facts);
        const skippedAsDuplicates = result.facts.length - survivors.length;

        if (survivors.length === 0) {
          return {
            sourceRevision,
            ok: true,
            added: 0,
            skippedAsDuplicates,
            facts: [],
            message: "Every researched fact was already in the bank.",
          };
        }

        const { data: inserted, error } = await supabase
          .from("sender_facts")
          .insert(
            survivors.map((f) => ({
              user_id: userId,
              profile_id: profile.id,
              category: f.category,
              fact: f.fact,
              source: "research",
            })),
          )
          .select("category, fact");

        if (error) throw new Error(`Failed to save facts: ${error.message}`);

        return {
          sourceRevision,
          ok: true,
          added: inserted?.length ?? survivors.length,
          skippedAsDuplicates,
          facts: groupFactsByCategory(inserted ?? survivors),
        };
      },
    );
    if (identity.source === "web" && getWebBillingTurn() && outcome.sourceRevision
      && outcome.sourceRevision !== sourceRevision) return {
      error: "Profile sources changed after this turn's research. Send a new message to research the updated profile. No additional credits were charged.",
    };
    const response = { ...outcome };
    delete response.sourceRevision;
    return response;
  },
});

export const addSenderFacts = tool({
  description:
    "Save facts about the user (the sender) to their sender fact bank -- the pool the email drafter picks at most 1-2 facts from per recipient to personalize outreach. Use this whenever the user shares something about themselves worth using in outreach: an accomplishment, a number, a story, an opinion ('we just crossed 200 customers', 'I used to run ops at Stripe'). One plain sentence per fact, written in third person. Duplicates already in the bank are skipped automatically.",
  inputSchema: z.object({
    profileId: z
      .string()
      .uuid()
      .optional()
      .describe("Profile to attach facts to. Omit for the most recent."),
    facts: z
      .array(
        z.object({
          category: z
            .enum(FACT_CATEGORIES)
            .describe(
              "background (career history) | proof_point (numbers, wins) | story (anecdotes) | pov (opinions) | credibility (press, awards, logos) | personal (interests outside work)",
            ),
          fact: z
            .string()
            .min(1)
            .max(500)
            .describe("One plain sentence, third person."),
        }),
      )
      .min(1)
      .max(10),
  }),
  execute: async (input) => {
    const userId = await actingUserId();
    if (!userId) return { error: "Not authenticated." };

    const supabase = await createClient();
    const profile = await resolveProfile(supabase, input.profileId);
    if (!profile) return { error: NO_PROFILE_ERROR };

    const existingRes = await loadAllSenderFacts(supabase, profile.id);
    if (!existingRes.ok) {
      return {
        error: `Could not load the existing fact bank (${existingRes.error}), so nothing was saved: inserting without it would duplicate facts. Retry.`,
      };
    }
    const survivors = dedupeFacts(input.facts, existingRes.facts);
    const skippedAsDuplicates = input.facts.length - survivors.length;

    if (survivors.length === 0) {
      return { ok: true, added: 0, skippedAsDuplicates };
    }

    const { data: inserted, error } = await supabase
      .from("sender_facts")
      .insert(
        survivors.map((f) => ({
          user_id: userId,
          profile_id: profile.id,
          category: f.category,
          fact: f.fact,
          source: "agent",
        })),
      )
      .select("id");

    if (error) throw new Error(`Failed to save facts: ${error.message}`);

    return {
      ok: true,
      added: inserted?.length ?? survivors.length,
      skippedAsDuplicates,
    };
  },
});

export const listSenderFacts = tool({
  description:
    "List the user's sender fact bank for a profile, grouped by category. The bank is the pool of true facts about the sender that the email drafter picks at most 1-2 from per recipient. Use this to show the user what's saved, or to check coverage before suggesting researchSenderProfile or addSenderFacts.",
  inputSchema: z.object({
    profileId: z
      .string()
      .uuid()
      .optional()
      .describe("Profile whose facts to list. Omit for the most recent."),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const profile = await resolveProfile(supabase, input.profileId);
    if (!profile) return { error: NO_PROFILE_ERROR };

    const facts = await loadSenderFacts(supabase, profile.id);
    return {
      profileId: profile.id,
      facts: groupFactsByCategory(facts),
    };
  },
});
