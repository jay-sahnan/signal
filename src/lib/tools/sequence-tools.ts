import { tool } from "ai";
import { z } from "zod";
import { createClient, getSupabaseAndUser } from "@/lib/supabase/server";
import { composeEmail, mapConcurrent } from "@/lib/email-composition/compose";
import { loadVoiceProfile } from "@/lib/email-composition/load-voice";
import { saveDraft } from "@/lib/email-composition/save";
import { loadSenderFacts, renderFactBank } from "@/lib/sender-facts";
import {
  loadActiveLearnings,
  renderLearningsBlock,
} from "@/lib/email-learnings";

export const createSequence = tool({
  description:
    "Create an outreach sequence with steps. Step 1 is triggered by a signal (e.g. hiring activity). Follow-up steps are time-delayed with conditions. Enrolls contacts automatically.",
  inputSchema: z.object({
    name: z.string().describe("Sequence name, e.g. 'Cold Outreach v1'."),
    campaignId: z.string().uuid().describe("Campaign ID."),
    triggerSignalId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Signal ID that triggers the first email. Omit for immediate send after approval.",
      ),
    steps: z
      .array(
        z.object({
          delayDays: z
            .number()
            .int()
            .optional()
            .describe("Days to wait after previous step."),
          delayHours: z
            .number()
            .int()
            .optional()
            .describe("Hours to wait after previous step."),
          condition: z
            .enum(["no_reply", "no_open", "opened_no_reply", "always"])
            .default("no_reply")
            .describe("Condition for sending this step."),
        }),
      )
      .describe(
        "Sequence steps. First step has no delay (signal-triggered). Follow-ups have delays + conditions.",
      ),
    contactIds: z
      .array(z.string().uuid())
      .optional()
      .describe(
        "Specific campaign_people IDs to enroll. If omitted, enrolls all contacts in the campaign (emails are still reviewed before send).",
      ),
    sendWindowScope: z
      .enum(["sender", "recipient"])
      .optional()
      .describe(
        "Whose clock the send window reads for this sequence: 'recipient' sends in each contact's local timezone (best effort from their location, falling back to the sender's), 'sender' uses the user's timezone. Omit to inherit the user's global setting.",
      ),
  }),
  execute: async ({
    name,
    campaignId,
    triggerSignalId,
    steps,
    contactIds,
    sendWindowScope,
  }) => {
    const ctx = await getSupabaseAndUser();
    if (!ctx) {
      return {
        error:
          "No authenticated session available in tool context. Ask the user to sign in.",
      };
    }
    const { supabase, user } = ctx;

    // Resolve user_id. Prefer the campaign row (sequences inherit the
    // campaign's owner); fall back to the session user and backfill the
    // campaign so subsequent calls short-circuit.
    const { data: campaignRow } = await supabase
      .from("campaigns")
      .select("user_id")
      .eq("id", campaignId)
      .single();

    const userId: string = campaignRow?.user_id ?? user.id;
    if (!campaignRow?.user_id) {
      await supabase
        .from("campaigns")
        .update({ user_id: userId })
        .eq("id", campaignId);
    }

    // Create the sequence
    const { data: sequence, error: seqErr } = await supabase
      .from("sequences")
      .insert({
        name,
        campaign_id: campaignId,
        trigger_signal_id: triggerSignalId ?? null,
        status: "draft",
        user_id: userId,
        send_window_scope: sendWindowScope ?? null,
      })
      .select("id")
      .single();

    if (seqErr || !sequence) {
      return { error: `Failed to create sequence: ${seqErr?.message}` };
    }

    // Create steps
    const stepRows = steps.map((step, i) => ({
      sequence_id: sequence.id,
      step_number: i + 1,
      step_type: "email" as const,
      delay_days: i === 0 ? null : (step.delayDays ?? null),
      delay_hours: i === 0 ? null : (step.delayHours ?? null),
      condition: i === 0 ? "always" : step.condition,
    }));

    const { error: stepsErr } = await supabase
      .from("sequence_steps")
      .insert(stepRows);

    if (stepsErr) {
      return { error: `Failed to create steps: ${stepsErr.message}` };
    }

    // Enroll contacts
    let contacts;
    if (contactIds && contactIds.length > 0) {
      const { data } = await supabase
        .from("campaign_people")
        .select("id, person_id")
        .eq("campaign_id", campaignId)
        .in("id", contactIds);
      contacts = data;
    } else {
      // Enroll all contacts -- emails are still reviewed before send
      const { data } = await supabase
        .from("campaign_people")
        .select("id, person_id")
        .eq("campaign_id", campaignId);
      contacts = data;
    }

    if (!contacts || contacts.length === 0) {
      return {
        sequenceId: sequence.id,
        enrolled: 0,
        message:
          "Sequence created but no contacts to enroll -- the campaign has no contacts yet.",
      };
    }

    const enrollments = contacts.map((c) => ({
      sequence_id: sequence.id,
      campaign_people_id: c.id,
      person_id: c.person_id,
      current_step: 1,
      // Who consumes each status decides who gets it, and this was exactly
      // inverted. "queued" is consumed only by handleSignalTrigger, so it
      // belongs to signal-triggered sequences (they wait for the fire);
      // "waiting" is what the followups sweep rescues once a draft is
      // approved, so it belongs to plain sequences. The old mapping made
      // plain sequences dead (queued, nothing ever read it) and let signal
      // sequences send on mere approval, before their signal ever fired.
      status: triggerSignalId ? "queued" : "waiting",
      waiting_since: new Date().toISOString(),
    }));

    const { error: enrollErr } = await supabase
      .from("sequence_enrollments")
      .insert(enrollments);

    if (enrollErr) {
      return { error: `Failed to enroll contacts: ${enrollErr.message}` };
    }

    return {
      sequenceId: sequence.id,
      steps: steps.length,
      enrolled: contacts.length,
      status: "draft",
      message: `Sequence "${name}" created with ${steps.length} steps and ${contacts.length} contacts enrolled. Now call draftSequenceEmails to generate personalized emails, then send the user to /outreach/review?sequence=${sequence.id} to approve them.`,
    };
  },
});

export const draftSequenceEmails = tool({
  description:
    "Draft personalized emails for all enrolled contacts in a sequence. Uses enrichment data, campaign context, and user profile to write each email. Returns a link to the review page. The AI should compose each email itself by calling writeEmail for each contact+step combination.",
  inputSchema: z.object({
    sequenceId: z.string().uuid().describe("Sequence ID to draft emails for."),
  }),
  execute: async ({ sequenceId }) => {
    const supabase = await createClient();

    // Load sequence with steps and enrollments
    const { data: sequence } = await supabase
      .from("sequences")
      .select("id, name, campaign_id")
      .eq("id", sequenceId)
      .single();

    if (!sequence) {
      return { error: "Sequence not found." };
    }

    const { data: steps } = await supabase
      .from("sequence_steps")
      .select("id, step_number, delay_days, condition")
      .eq("sequence_id", sequenceId)
      .order("step_number");

    const { data: enrollments } = await supabase
      .from("sequence_enrollments")
      .select("id, person_id, campaign_people_id")
      .eq("sequence_id", sequenceId);

    if (!steps || steps.length === 0) {
      return { error: "No steps found for this sequence." };
    }

    if (!enrollments || enrollments.length === 0) {
      return { error: "No contacts enrolled in this sequence." };
    }

    // Load thin contact context for drafting (no enrichment_data here —
    // the agent will fetch it per-contact via getContactDetail when composing).
    const personIds = enrollments.map((e) => e.person_id);
    const { data: people } = await supabase
      .from("people")
      .select("id, name, title, work_email, personal_email, organization_id")
      .in("id", personIds);

    const orgIds = [
      ...new Set((people ?? []).map((p) => p.organization_id).filter(Boolean)),
    ];
    const { data: orgs } =
      orgIds.length > 0
        ? await supabase
            .from("organizations")
            .select("id, name, domain")
            .in("id", orgIds)
        : { data: [] };

    const orgMap = new Map((orgs ?? []).map((o) => [o.id, o]));
    const personMap = new Map((people ?? []).map((p) => [p.id, p]));

    const contactsForDrafting = enrollments.map((enrollment) => {
      const person = personMap.get(enrollment.person_id);
      const org = person?.organization_id
        ? orgMap.get(person.organization_id)
        : null;
      return {
        enrollmentId: enrollment.id,
        personId: enrollment.person_id,
        campaignPeopleId: enrollment.campaign_people_id,
        name: person?.name ?? "Unknown",
        title: person?.title ?? null,
        email: person?.work_email ?? person?.personal_email ?? null,
        organizationId: person?.organization_id ?? null,
        company: org?.name ?? null,
        domain: org?.domain ?? null,
      };
    });

    return {
      sequenceId,
      sequenceName: sequence.name,
      campaignId: sequence.campaign_id,
      steps: steps.map((s) => ({
        stepId: s.id,
        stepNumber: s.step_number,
        delayDays: s.delay_days,
        condition: s.condition,
      })),
      contacts: contactsForDrafting,
      totalDraftsNeeded: contactsForDrafting.length * steps.length,
      instructions:
        "Process contacts ONE AT A TIME. For each contact × step: " +
        "(1) call getContactDetail(personId) to fetch that contact's enrichment; " +
        "(2) optionally call getCompanyDetail(organizationId) if you need deep company context; " +
        "(3) call writeEmail with the personalized content, passing sequenceId, sequenceStepId, enrollmentId, and ai_reasoning; " +
        "(4) then move on to the next contact. Do NOT preload enrichment for all contacts up front. " +
        (steps.length > 1
          ? "Step 1 is the initial cold email. Follow-ups reference the prior email and add urgency. The final step is a polite breakup. "
          : "This is a single-step sequence: its only email is first contact. Never frame it as a follow-up or breakup, and never imply prior emails. ") +
        `After all drafts are created, tell the user to review them at /outreach/review?sequence=${sequenceId}`,
    };
  },
});

// ── draftEmailsForSequence ────────────────────────────────────────────────
// Server-side fan-out: drafts ALL emails in a sequence via parallel Claude
// sub-calls, then saves drafts to the DB. The chat agent calls this once and
// receives a summary; it never loads per-contact enrichment into its own
// context. Replaces the old "getContactDetail → writeEmail loop" pattern.
export const draftEmailsForSequence = tool({
  description:
    "Draft ALL personalized emails for a sequence in parallel, server-side. " +
    "Loads each contact's enrichment, composes emails via a focused sub-agent " +
    "per contact × step, and saves drafts to the database. This is the " +
    "preferred way to draft sequence emails; the main agent does not need " +
    "to loop through contacts or call writeEmail itself. Use writeEmail only " +
    "for ad-hoc single-draft flows outside a sequence. " +
    "If the campaign has no email voice yet this returns needsVoice instead of " +
    "drafting; offer the user the swipe run or an explicit skip, then call " +
    "again with voiceChoice.",
  inputSchema: z.object({
    sequenceId: z.string().uuid().describe("Sequence ID to draft emails for."),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(6)
      .describe("How many sub-agents to run in parallel. Default 6."),
    voiceChoice: z
      .enum(["interviewed", "skip"])
      .optional()
      .describe(
        "The user's decision about this campaign's email voice. Omit on the " +
          "first call: if the campaign has no voice you get needsVoice back and " +
          "should ask the user. Pass 'skip' once they have chosen to go ahead " +
          "without one, or 'interviewed' after they have built it.",
      ),
  }),
  execute: async ({ sequenceId, concurrency, voiceChoice }) => {
    const ctx = await getSupabaseAndUser();
    if (!ctx) {
      return {
        error:
          "No authenticated session available in tool context. Ask the user to sign in.",
      };
    }
    const { supabase, user } = ctx;

    const { data: sequence } = await supabase
      .from("sequences")
      .select("id, name, campaign_id")
      .eq("id", sequenceId)
      .single();
    if (!sequence) return { error: "Sequence not found." };

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, name, icp, offering, positioning, profile_id, user_id")
      .eq("id", sequence.campaign_id)
      .single();
    if (!campaign) return { error: "Campaign not found." };

    const userId: string = campaign.user_id ?? user.id;

    const { data: profile } = campaign.profile_id
      ? await supabase
          .from("user_profile")
          .select(
            "id, name, role_title, company_name, offering_summary, notes, booking_url",
          )
          .eq("id", campaign.profile_id)
          .single()
      : { data: null };

    // Sender fact bank, loaded once for the whole fan-out (never per contact).
    const factBank = renderFactBank(
      await loadSenderFacts(supabase, campaign.profile_id ?? null),
    );

    const { data: steps } = await supabase
      .from("sequence_steps")
      .select("id, step_number, condition")
      .eq("sequence_id", sequenceId)
      .order("step_number");
    if (!steps || steps.length === 0) {
      return { error: "No steps found for this sequence." };
    }

    const { data: enrollments } = await supabase
      .from("sequence_enrollments")
      .select("id, person_id, campaign_people_id")
      .eq("sequence_id", sequenceId);
    if (!enrollments || enrollments.length === 0) {
      return { error: "No contacts enrolled in this sequence." };
    }

    const personIds = enrollments.map((e) => e.person_id);
    const { data: people } = await supabase
      .from("people")
      .select(
        "id, name, title, work_email, personal_email, organization_id, enrichment_data",
      )
      .in("id", personIds);
    const personMap = new Map((people ?? []).map((p) => [p.id, p]));

    const orgIds = [
      ...new Set((people ?? []).map((p) => p.organization_id).filter(Boolean)),
    ];
    const { data: orgs } =
      orgIds.length > 0
        ? await supabase
            .from("organizations")
            .select("id, name, domain, industry, enrichment_data")
            .in("id", orgIds)
        : { data: [] };
    const orgMap = new Map((orgs ?? []).map((o) => [o.id, o]));

    // Scoped to the campaign so the voice matches this audience, falling back
    // to the user's default when the campaign has none.
    const voice = await loadVoiceProfile(
      supabase,
      userId,
      sequence.campaign_id,
    );

    // Gate the first drafting run on a decision about this campaign's voice.
    // A voice built against this campaign's ICP writes about the right
    // signals in the user's own register; the alternative is copy that reads
    // as generic, which is the failure mode the base rules spend most of their
    // length trying to avoid. The user can still decline — but explicitly,
    // before a batch of drafts exists, rather than discovering it afterwards.
    const hasCampaignVoice = voice?.campaign_id === sequence.campaign_id;
    if (!hasCampaignVoice && !voiceChoice) {
      return {
        needsVoice: true,
        campaignId: sequence.campaign_id,
        campaignName: campaign.name,
        usingFallbackVoice: Boolean(voice),
        message:
          `"${campaign.name}" has no email voice yet. Ask the user whether to build one before drafting, and tell them why it matters: ` +
          `the swipe run learns how they write and which signals to open on for this specific audience, so the drafts read as written by them rather than as generic outreach. ` +
          (voice
            ? "If they skip, drafting will use their default voice, which was built for a different campaign and may reference the wrong kind of signal. "
            : "If they skip, drafting will use the base rules only, with no personal voice at all. ") +
          `They can build it at /email-skills?campaign=${sequence.campaign_id} (they judge a handful of drafts; a couple of minutes). ` +
          `Once they have decided, call this tool again with voiceChoice: "interviewed" or "skip".`,
      };
    }

    // Outcome learnings, loaded once for the whole batch like the fact bank.
    const learnings = renderLearningsBlock(
      await loadActiveLearnings(supabase, userId, sequence.campaign_id),
    );

    // Fan out per CONTACT, steps sequential inside. Contact-level concurrency
    // (not contact × step) so step N+1 composes with step N's actual subject
    // as previousSubject; a follow-up written blind to what it follows up on
    // was the old failure mode.
    const totalSteps = steps.length;
    type StepResult = {
      personId: string;
      stepNumber: number;
      skipped: boolean;
      reason?: string;
      error?: string;
      draftId?: string;
      subject?: string;
    };

    const perContact = await mapConcurrent(
      enrollments,
      concurrency,
      async (enrollment): Promise<StepResult[]> => {
        const person = personMap.get(enrollment.person_id);
        const hasEmail = person?.work_email || person?.personal_email;
        if (!person || !hasEmail) {
          return steps.map((step) => ({
            personId: enrollment.person_id,
            stepNumber: step.step_number,
            skipped: true,
            reason: "no email on contact",
          }));
        }

        const org = person.organization_id
          ? orgMap.get(person.organization_id)
          : null;

        const stepResults: StepResult[] = [];
        let previousSubject: string | null = null;

        for (const step of steps) {
          // Re-run guard, matching pickAndDraft: without it a retried call
          // inserted a second pending draft per (enrollment, step), and two
          // approved rows then broke sendApprovedDraft's .single() so the
          // whole sequence could never send. Skipping before composing also
          // spends nothing on the LLM for work that already exists.
          const { data: existingDraft, error: existingErr } = await supabase
            .from("email_drafts")
            .select("id, subject")
            .eq("enrollment_id", enrollment.id)
            .eq("sequence_step_id", step.id)
            .maybeSingle();
          if (existingErr) {
            stepResults.push({
              personId: enrollment.person_id,
              stepNumber: step.step_number,
              skipped: false,
              error: `could not check for an existing draft: ${existingErr.message}`,
            });
            continue;
          }
          if (existingDraft) {
            // Threading still works for freshly-drafted later steps.
            previousSubject =
              (existingDraft.subject as string) ?? previousSubject;
            stepResults.push({
              personId: enrollment.person_id,
              stepNumber: step.step_number,
              skipped: true,
              reason: "draft already exists for this step",
            });
            continue;
          }

          const composed = await composeEmail({
            voice,
            contact: {
              name: person.name ?? null,
              title: person.title ?? null,
              email: person.work_email ?? person.personal_email ?? "",
              enrichmentData:
                (person.enrichment_data as Record<string, unknown> | null) ??
                null,
            },
            company: org
              ? {
                  name: org.name ?? null,
                  domain: org.domain ?? null,
                  industry: org.industry ?? null,
                  enrichmentData:
                    (org.enrichment_data as Record<string, unknown> | null) ??
                    null,
                }
              : null,
            step: {
              stepNumber: step.step_number,
              totalSteps,
              condition: step.condition,
              // Last of SEVERAL steps. In a 1-step sequence the only email
              // is first contact, and flagging it final made the composer
              // write a breakup for a thread that never existed.
              isFinal: totalSteps > 1 && step.step_number === totalSteps,
            },
            campaign: {
              name: campaign.name,
              icp: (campaign.icp as Record<string, unknown> | null) ?? null,
              offering:
                (campaign.offering as Record<string, unknown> | null) ?? null,
              positioning:
                (campaign.positioning as Record<string, unknown> | null) ??
                null,
            },
            senderProfile: {
              name: profile?.name ?? null,
              title: profile?.role_title ?? null,
              company: profile?.company_name ?? null,
              offeringSummary: profile?.offering_summary ?? null,
              notes: profile?.notes ?? null,
              bookingUrl: profile?.booking_url ?? null,
            },
            factBank,
            learnings,
            previousSubject,
          });

          if (!composed.ok) {
            // Later steps still compose: previousSubject just stays at the
            // last step that succeeded.
            stepResults.push({
              personId: enrollment.person_id,
              stepNumber: step.step_number,
              skipped: false,
              error: composed.error,
            });
            continue;
          }

          const saved = await saveDraft(supabase, {
            userId,
            campaignId: campaign.id,
            personId: enrollment.person_id,
            subject: composed.email.subject,
            bodyHtml: composed.email.bodyHtml,
            bodyText: composed.email.bodyText,
            sequenceId,
            sequenceStepId: step.id,
            enrollmentId: enrollment.id,
            aiReasoning: composed.email.aiReasoning,
          });

          if (!saved.ok) {
            stepResults.push({
              personId: enrollment.person_id,
              stepNumber: step.step_number,
              skipped: false,
              error: saved.error,
            });
            continue;
          }

          previousSubject = composed.email.subject;
          stepResults.push({
            personId: enrollment.person_id,
            stepNumber: step.step_number,
            skipped: false,
            draftId: saved.draftId,
            subject: saved.subject,
          });
        }

        return stepResults;
      },
    );
    const results = perContact.flat();

    const drafted = results.filter((r) => !r.skipped && "draftId" in r).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.skipped && "error" in r);

    return {
      sequenceId,
      drafted,
      skipped,
      failed: failed.length,
      total: results.length,
      reviewUrl: `/outreach/review?sequence=${sequenceId}`,
      failures: failed.length > 0 ? failed : undefined,
      // Surfaced so the agent can tell the user which voice actually wrote
      // these, rather than leaving them to infer it from the copy.
      voiceScope: hasCampaignVoice
        ? "campaign"
        : voice
          ? "user-default"
          : "base-rules",
      voiceSkipped: voiceChoice === "skip" || undefined,
      message:
        `Drafted ${drafted} of ${results.length} emails (${skipped} skipped, ${failed.length} failed). ` +
        (hasCampaignVoice
          ? ""
          : voice
            ? "Written in the user's default voice, not one built for this campaign. "
            : "Written from the base rules only, no personal voice. ") +
        `Tell the user to review at /outreach/review?sequence=${sequenceId}.`,
    };
  },
});

export const getSequenceStatus = tool({
  description:
    "Get the current status of a sequence including enrollment counts by status.",
  inputSchema: z.object({
    sequenceId: z.string().uuid().describe("Sequence ID."),
  }),
  execute: async ({ sequenceId }) => {
    const supabase = await createClient();

    const { data: sequence } = await supabase
      .from("sequences")
      .select("id, name, status, campaign_id, trigger_signal_id, created_at")
      .eq("id", sequenceId)
      .single();

    if (!sequence) {
      return { error: "Sequence not found." };
    }

    const { data: enrollments } = await supabase
      .from("sequence_enrollments")
      .select("status")
      .eq("sequence_id", sequenceId);

    const counts: Record<string, number> = {};
    for (const e of enrollments ?? []) {
      counts[e.status] = (counts[e.status] ?? 0) + 1;
    }

    const { data: drafts } = await supabase
      .from("email_drafts")
      .select("review_status")
      .eq("sequence_id", sequenceId);

    const draftCounts: Record<string, number> = {};
    for (const d of drafts ?? []) {
      const status = d.review_status ?? "pending";
      draftCounts[status] = (draftCounts[status] ?? 0) + 1;
    }

    return {
      sequence,
      enrollments: counts,
      totalEnrolled: enrollments?.length ?? 0,
      drafts: draftCounts,
      totalDrafts: drafts?.length ?? 0,
    };
  },
});
