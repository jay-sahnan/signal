import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { apiSafeSchema } from "@/lib/ai/api-safe-schema";
import { MODELS } from "@/lib/ai/models";
import { generateWithRetry } from "@/lib/ai/salvage-object";
import {
  BatchSchema,
  MAX_INSTRUCTIONS_IN_PROMPT,
  MAX_JUDGED_IN_PROMPT,
  MAX_SAMPLES_IN_PROMPT,
  SkillSchema,
  buildBatchPrompt,
  buildBatchSystem,
  buildRefinementTranscript,
  buildSkillPrompt,
  buildSkillSystem,
  normaliseInstructions,
  personaLabel,
  type Draft,
  type SavedVoice,
  type SwipeCampaign,
  type SwipeSenderContext,
  type SwipeTranscript,
} from "@/lib/email-skills/swipe-prompts";
import {
  loadRecipientCandidates,
  pickRecipient,
  recipientLabel,
} from "@/lib/email-skills/swipe-recipient";
import { getProfileForPrompt } from "@/lib/profile";
import { loadSenderFacts, renderFactBank } from "@/lib/sender-facts";
import { llmTimeout } from "@/lib/utils/timeout";

/**
 * The server side of voice-by-swiping: generate the next batch of drafts, and
 * write the finished (or refined) rule-set into email_voice_profiles.
 *
 * Called from the voice agent tools, which run inside the chat route. The
 * instructions the user types are never parsed here. They ride in the
 * transcript and are honoured by the model on the next generation, which is
 * the only way an instruction like "make it warmer" can be satisfied at all.
 */

// Every string is bounded. The client controls the transcript and it is
// stringified straight into an Opus prompt, so unbounded fields would let one
// authenticated request push megabytes of attacker-chosen text through a
// 1M-token context window on the operator's key.
const AxesSchema = z.object({
  opener: z.string().max(20),
  tone: z.string().max(20),
  close: z.string().max(20),
  greeting: z.string().max(20),
  signoff: z.string().max(20),
});

const JudgedSchema = z.object({
  subject: z.string().max(300),
  body: z.string().max(4_000),
  axes: AxesSchema,
  kept: z.boolean(),
  // Which invented persona the draft addressed. Without this the wire schema
  // strips the label the deck stamped on, the transcript loses its "(to ...)"
  // attribution, and the batch prompt's never-reuse-a-persona rule has nothing
  // to check against. Bounded like every other client-controlled string here.
  personaLabel: z.string().max(200).optional(),
  notes: z
    .array(
      z.object({ phrase: z.string().max(400), note: z.string().max(1_000) }),
    )
    .max(20)
    .optional(),
});

/**
 * One pasted email. Matches the paste step's textarea cap, which is the number
 * the user is actually held to on the way in.
 */
const MAX_SAMPLE_PASTE_CHARS = 20_000;

export const TranscriptSchema = z.object({
  judged: z.array(JudgedSchema).max(MAX_JUDGED_IN_PROMPT + 10),
  instructions: z
    .array(z.string().max(2_000))
    .max(MAX_INSTRUCTIONS_IN_PROMPT + 10),
  // Emails the user pasted before the first batch. Bounded like everything
  // else: this is the one field the user fills by pasting, so it is where an
  // accidental megabyte would arrive.
  samples: z
    .array(z.string().max(MAX_SAMPLE_PASTE_CHARS))
    .max(MAX_SAMPLES_IN_PROMPT)
    .optional(),
  // `prior` is deliberately absent. It is built server-side from the saved row
  // on a refinement; accepting it here would let a request assert that any
  // rules it liked had already been accepted.
});

/** The chat body's voice-run envelope, validated before it reaches any tool. */
export const VoiceRunBodySchema = z.object({
  campaignId: z.string().uuid().nullish(),
  transcript: TranscriptSchema,
  // How many drafts are still waiting on the deck, so a rewrite can replace
  // exactly that many. A count, deliberately not the drafts themselves.
  queued: z.number().int().min(0).max(24).optional(),
});

export type VoiceRunBody = z.infer<typeof VoiceRunBodySchema>;

/**
 * `prior` on a refinement carries a whole rule-set, so the instruction itself
 * only ever needs to be a sentence.
 */
export const MAX_REFINE_INSTRUCTION_CHARS = 2_000;

/** Ceiling on the serialised transcript, which is what actually reaches the model. */
export const MAX_TRANSCRIPT_CHARS = 120_000;

export type VoiceServiceResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/**
 * Campaign context and sender context for the prompts. Each part is optional
 * and independently absent-able: a user with no profile or no campaign still
 * gets drafts, because being unable to write anything is a worse failure than
 * writing something generic. The recipient is picked separately in
 * generateVoiceBatch: a real campaign contact when one exists, otherwise the
 * batch model invents a fictional persona from the campaign ICP.
 *
 * RLS scopes campaigns to the signed-in user, so an id belonging to someone
 * else resolves to nothing rather than to their data.
 */
async function loadPromptContext(
  supabase: SupabaseClient,
  campaignId: string | null,
) {
  const [campaignRes, profile] = await Promise.all([
    campaignId
      ? supabase
          .from("campaigns")
          .select("name, icp, offering, positioning")
          .eq("id", campaignId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Same resolution the chat route uses, so a campaign with its own linked
    // profile writes as that sender rather than as the most recent one.
    getProfileForPrompt(campaignId ?? undefined),
  ]);

  // Facts are truth-bound sender context: the persona is invented, and the
  // fact bank is what the drafts are allowed to claim about who is writing.
  const factBank = renderFactBank(
    await loadSenderFacts(supabase, profile?.id ?? null),
  );

  const campaign = (campaignRes.data as SwipeCampaign | null) ?? null;
  const senderContext: SwipeSenderContext = {
    sender: profile
      ? {
          name: profile.name,
          roleTitle: profile.role_title,
          companyName: profile.company_name,
          offeringSummary: profile.offering_summary,
          notes: profile.notes,
          bookingUrl: profile.booking_url,
          factBank,
        }
      : null,
  };

  return { campaign, senderContext };
}

export async function generateVoiceBatch(
  supabase: SupabaseClient,
  input: {
    campaignId: string | null;
    transcript: SwipeTranscript;
    count: number;
  },
): Promise<
  VoiceServiceResult<{
    drafts: Draft[];
    /** Who this batch is written to, as a card label: a real campaign
     * contact, or the invented persona as a fallback. */
    persona: { label: string; real: boolean } | null;
  }>
> {
  if (JSON.stringify(input.transcript).length > MAX_TRANSCRIPT_CHARS) {
    return { ok: false, error: "Transcript too large" };
  }

  const { campaign, senderContext } = await loadPromptContext(
    supabase,
    input.campaignId,
  );

  // Real recipient when the campaign has contacts; invented persona
  // otherwise. Any load failure returns [] and falls through to invented.
  const candidates = input.campaignId
    ? await loadRecipientCandidates(supabase, input.campaignId)
    : [];
  const recipient = pickRecipient(
    candidates,
    input.transcript.judged
      .map((j) => j.personaLabel)
      .filter((l): l is string => Boolean(l)),
  );

  // The wrapped-payload flake hits these prompts like every other Opus 5
  // structured call, so single-shot + salvage was not enough: a malformed
  // wrapper surfaced straight to the deck as a failed batch. generateWithRetry
  // salvages what it can and retries the rest.
  const result = await generateWithRetry(
    async () => {
      const { object } = await generateObject({
        abortSignal: llmTimeout(),
        model: anthropic(MODELS.EMAIL),
        schema: apiSafeSchema(BatchSchema),
        system: buildBatchSystem(campaign, senderContext, recipient),
        prompt: buildBatchPrompt(input.transcript, input.count),
        providerOptions: {
          anthropic: {
            // Only the transcript changes between batches, so the rules and
            // campaign context read from cache after the first call.
            cacheControl: { type: "ephemeral" },
            effort: "medium",
          },
        },
        // generateWithRetry owns retrying; leaving the SDK default of 2 would
        // stack upstream requests under a 429 storm.
        maxRetries: 0,
        // Opus 5 thinks by default and maxOutputTokens caps thinking plus
        // visible output together, so a budget sized for the text alone
        // truncates and fails generateObject outright.
        // Sized for 8 drafts plus the invented persona object, with thinking
        // headroom on top (Opus 5 thinks by default and this cap covers both).
        maxOutputTokens: 10_000,
      });
      return object;
    },
    BatchSchema,
    3,
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  // Real recipient: the server stamps the label so the model cannot misname
  // anyone. Invented: the label comes from the returned persona as before.
  // The schema keeps persona optional for the real-recipient path, so the
  // invented path has to enforce it here: a batch without its persona
  // renders unlabeled cards whose judgements can't be rotated against.
  if (!recipient && !result.value.persona) {
    return {
      ok: false,
      error:
        "The model returned drafts without the invented persona; try another batch.",
    };
  }
  const label = recipient
    ? recipientLabel(recipient)
    : result.value.persona
      ? personaLabel(result.value.persona)
      : null;
  return {
    ok: true,
    drafts: result.value.drafts,
    persona: label ? { label, real: recipient !== null } : null,
  };
}

/**
 * Turns a transcript into the saved rule-set. Shared by "finish the run" and
 * "refine the saved voice": both write the same row from the same prompt, and
 * differ only in where the transcript comes from.
 */
async function writeSkill(
  supabase: SupabaseClient,
  input: {
    userId: string;
    campaignId: string | null;
    transcript: SwipeTranscript;
  },
): Promise<VoiceServiceResult<{ instructions: string; summary: string }>> {
  const { campaign, senderContext } = await loadPromptContext(
    supabase,
    input.campaignId,
  );

  const skillResult = await generateWithRetry(
    async () => {
      const { object } = await generateObject({
        abortSignal: llmTimeout(),
        model: anthropic(MODELS.EMAIL),
        schema: apiSafeSchema(SkillSchema),
        system: buildSkillSystem(
          campaign,
          senderContext,
          input.transcript.judged.some((d) => d.personaReal === true),
        ),
        prompt: buildSkillPrompt(input.transcript),
        providerOptions: { anthropic: { effort: "medium" } },
        maxRetries: 0,
        maxOutputTokens: 5_000,
      });
      return object;
    },
    SkillSchema,
    3,
  );
  if (!skillResult.ok) {
    return { ok: false, error: skillResult.error };
  }
  const skill = skillResult.value;

  const instructions = normaliseInstructions(skill.instructions);
  if (!instructions) {
    // Saving an empty rule-set would overwrite a good profile with nothing and
    // leave the composer reporting a voice that does not exist.
    return {
      ok: false,
      error: "No usable rules came back. Nothing was saved. Try again.",
    };
  }

  // Same conflict target the interview used: campaign_key is a generated
  // column collapsing a NULL campaign onto a sentinel uuid, so one unique
  // constraint covers both scopes and rebuilding overwrites rather than adding.
  const { error } = await supabase.from("email_voice_profiles").upsert(
    {
      user_id: input.userId,
      campaign_id: input.campaignId,
      instructions,
      summary: skill.summary,
      source_transcript: input.transcript,
    },
    { onConflict: "user_id,campaign_key" },
  );
  if (error) {
    // The caller treats a returned skill as saved; returning one after a
    // failed write would claim a profile exists when it does not.
    return { ok: false, error: error.message };
  }

  return { ok: true, instructions, summary: skill.summary };
}

export async function completeVoiceRun(
  supabase: SupabaseClient,
  input: {
    userId: string;
    campaignId: string | null;
    transcript: SwipeTranscript;
  },
): Promise<VoiceServiceResult<{ instructions: string; summary: string }>> {
  if (JSON.stringify(input.transcript).length > MAX_TRANSCRIPT_CHARS) {
    return { ok: false, error: "Transcript too large" };
  }
  return writeSkill(supabase, input);
}

/**
 * "What should be different?" for a voice that already exists, without swiping
 * again. The saved rules and the run behind them are replayed server-side, so
 * a sentence narrows the voice rather than replacing it with whatever one
 * sentence implies. The client never supplies `prior`, or a request could
 * claim any rules it liked had already been accepted.
 */
export async function refineVoiceProfile(
  supabase: SupabaseClient,
  input: { userId: string; campaignId: string | null; instruction: string },
): Promise<VoiceServiceResult<{ instructions: string; summary: string }>> {
  const saved = supabase
    .from("email_voice_profiles")
    .select("instructions, summary, source_transcript");
  // RLS scopes the table to the signed-in user, so scope is the only filter
  // needed. `.is` rather than `.eq`, because the default voice's campaign_id
  // is NULL and `eq(null)` matches nothing.
  const { data, error: savedError } = await (
    input.campaignId
      ? saved.eq("campaign_id", input.campaignId)
      : saved.is("campaign_id", null)
  ).maybeSingle();

  // A failed read is not "no saved voice": that false claim sent the agent
  // off to rebuild a voice the user already has.
  if (savedError) {
    return {
      ok: false,
      error: `Could not load the saved voice: ${savedError.message}. Try again.`,
    };
  }

  const existing = data as SavedVoice | null;
  if (!existing?.instructions?.trim()) {
    return {
      ok: false,
      error: "There is no saved voice in this scope to refine.",
    };
  }

  let transcript = buildRefinementTranscript(
    existing,
    input.instruction.slice(0, MAX_REFINE_INSTRUCTION_CHARS),
  );
  if (JSON.stringify(transcript).length > MAX_TRANSCRIPT_CHARS) {
    // The replayed drafts are history and the change request is the point, so
    // an over-long run drops its drafts rather than refusing a refinement the
    // user has no way to make smaller.
    transcript = { ...transcript, judged: [] };
  }

  return writeSkill(supabase, {
    userId: input.userId,
    campaignId: input.campaignId,
    transcript,
  });
}
