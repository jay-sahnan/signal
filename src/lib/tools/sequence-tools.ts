import { tool } from "ai";
import { z } from "zod";
import { createClient, getSupabaseAndUser } from "@/lib/supabase/server";
import { composeEmail, mapConcurrent } from "@/lib/email-composition/compose";
import { loadActiveEmailSkills } from "@/lib/email-composition/load-skills";
import { saveDraft } from "@/lib/email-composition/save";

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
  }),
  execute: async ({ name, campaignId, triggerSignalId, steps, contactIds }) => {
    // Use getSupabaseAndUser — it respects BYPASS_AUTH=true (dev) and
    // returns the DEV_USER stub instead of calling auth.getUser() which
    // returns null under bypass.
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
      status: triggerSignalId ? "waiting" : "queued",
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
        "(4) then move on to the next contact — do NOT preload enrichment for all contacts up front. " +
        "Step 1 is the initial cold email. Follow-ups reference the prior email and add urgency. The final step is a polite breakup. " +
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
    "preferred way to draft sequence emails — the main agent does not need " +
    "to loop through contacts or call writeEmail itself. Use writeEmail only " +
    "for ad-hoc single-draft flows outside a sequence.",
  inputSchema: z.object({
    sequenceId: z.string().uuid().describe("Sequence ID to draft emails for."),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(6)
      .describe("How many sub-agents to run in parallel. Default 6."),
  }),
  execute: async ({ sequenceId, concurrency }) => {
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
          .select("name, role_title, company_name, notes")
          .eq("id", campaign.profile_id)
          .single()
      : { data: null };

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

    const activeSkills = await loadActiveEmailSkills(supabase, {
      userId,
      profileId: campaign.profile_id as string | null,
      campaignId: campaign.id as string,
    });

    // Build the (contact × step) task list. Skip contacts with no email.
    type Task = {
      enrollmentId: string;
      personId: string;
      stepId: string;
      stepNumber: number;
      isFinal: boolean;
      condition: string;
      skipReason?: string;
    };
    const totalSteps = steps.length;
    const tasks: Task[] = [];
    for (const enrollment of enrollments) {
      const person = personMap.get(enrollment.person_id);
      const hasEmail = person?.work_email || person?.personal_email;
      for (const step of steps) {
        tasks.push({
          enrollmentId: enrollment.id,
          personId: enrollment.person_id,
          stepId: step.id,
          stepNumber: step.step_number,
          isFinal: step.step_number === totalSteps,
          condition: step.condition,
          skipReason: hasEmail ? undefined : "no email on contact",
        });
      }
    }

    // Fan out composition.
    const results = await mapConcurrent(tasks, concurrency, async (task) => {
      if (task.skipReason) {
        return {
          personId: task.personId,
          stepNumber: task.stepNumber,
          skipped: true as const,
          reason: task.skipReason,
        };
      }

      const person = personMap.get(task.personId)!;
      const org = person.organization_id
        ? orgMap.get(person.organization_id)
        : null;

      const composed = await composeEmail({
        skills: activeSkills,
        contact: {
          name: person.name ?? null,
          title: person.title ?? null,
          email: person.work_email ?? person.personal_email ?? "",
          enrichmentData:
            (person.enrichment_data as Record<string, unknown> | null) ?? null,
        },
        company: org
          ? {
              name: org.name ?? null,
              domain: org.domain ?? null,
              industry: org.industry ?? null,
              enrichmentData:
                (org.enrichment_data as Record<string, unknown> | null) ?? null,
            }
          : null,
        step: {
          stepNumber: task.stepNumber,
          totalSteps,
          condition: task.condition,
          isFinal: task.isFinal,
        },
        campaign: {
          name: campaign.name,
          icp: (campaign.icp as Record<string, unknown> | null) ?? null,
          offering:
            (campaign.offering as Record<string, unknown> | null) ?? null,
          positioning:
            (campaign.positioning as Record<string, unknown> | null) ?? null,
        },
        senderProfile: {
          name: profile?.name ?? null,
          title: profile?.role_title ?? null,
          company: profile?.company_name ?? null,
          signature: profile?.notes ?? null,
        },
      });

      if (!composed.ok) {
        return {
          personId: task.personId,
          stepNumber: task.stepNumber,
          skipped: false as const,
          error: composed.error,
        };
      }

      const saved = await saveDraft(supabase, {
        userId,
        campaignId: campaign.id,
        personId: task.personId,
        subject: composed.email.subject,
        bodyHtml: composed.email.bodyHtml,
        bodyText: composed.email.bodyText,
        sequenceId,
        sequenceStepId: task.stepId,
        enrollmentId: task.enrollmentId,
        aiReasoning: composed.email.aiReasoning,
      });

      if (!saved.ok) {
        return {
          personId: task.personId,
          stepNumber: task.stepNumber,
          skipped: false as const,
          error: saved.error,
        };
      }

      return {
        personId: task.personId,
        stepNumber: task.stepNumber,
        skipped: false as const,
        draftId: saved.draftId,
        subject: saved.subject,
      };
    });

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
      message: `Drafted ${drafted} of ${results.length} emails (${skipped} skipped, ${failed.length} failed). Tell the user to review at /outreach/review?sequence=${sequenceId}.`,
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
