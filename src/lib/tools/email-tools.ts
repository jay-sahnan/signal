import { tool } from "ai";
import { z } from "zod";
import { createClient, getSupabaseAndUser } from "@/lib/supabase/server";
import { ExaService } from "@/lib/services/exa-service";
import { sendMessage } from "@/lib/services/agentmail-service";
import { trackUsage } from "@/lib/services/cost-tracker";
import { saveDraft } from "@/lib/email-composition/save";

// ── Shared findEmail logic ─────────────────────────────────────────────────

export async function findEmailForPerson(personId: string): Promise<{
  email: string | null;
  source?: string;
  reason?: string;
  personId: string;
}> {
  const supabase = await createClient();

  const { data: person, error: personErr } = await supabase
    .from("people")
    .select("id, name, title, work_email, personal_email, organization_id")
    .eq("id", personId)
    .single();

  if (personErr || !person) {
    return { email: null, reason: "Person not found.", personId };
  }

  if (person.work_email) {
    return { email: person.work_email, source: "existing", personId };
  }
  if (person.personal_email) {
    return { email: person.personal_email, source: "existing", personId };
  }

  let domain: string | null = null;
  if (person.organization_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("domain, name")
      .eq("id", person.organization_id)
      .single();
    domain = org?.domain ?? null;
  }

  const searchQuery = domain
    ? `"${person.name}" "${domain}" email`
    : `"${person.name}" email contact`;

  let foundEmail: string | null = null;

  try {
    const exa = new ExaService();
    const results = await exa.search(searchQuery, {
      numResults: 5,
      includeText: true,
    });

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    for (const result of results.results) {
      if (!result.text) continue;
      const emails = result.text.match(emailRegex) ?? [];
      for (const email of emails) {
        const lower = email.toLowerCase();
        if (
          lower.includes("noreply") ||
          lower.includes("info@") ||
          lower.includes("support@") ||
          lower.includes("hello@") ||
          lower.includes("contact@") ||
          lower.includes("example.com")
        ) {
          continue;
        }
        if (domain && lower.endsWith(`@${domain}`)) {
          foundEmail = lower;
          break;
        }
        if (!foundEmail) {
          foundEmail = lower;
        }
      }
      if (foundEmail && domain && foundEmail.endsWith(`@${domain}`)) break;
    }

    trackUsage({
      service: "exa",
      operation: "find-email",
      estimated_cost_usd: 0.007,
      metadata: { personId, query: searchQuery },
    });
  } catch {
    // Exa search failed, fall through to pattern guessing
  }

  if (!foundEmail && domain && person.name) {
    const nameParts = person.name.toLowerCase().split(/\s+/);
    if (nameParts.length >= 2) {
      const first = nameParts[0];
      const last = nameParts[nameParts.length - 1];
      foundEmail = `${first}.${last}@${domain}`;
    }
  }

  if (!foundEmail) {
    return {
      email: null,
      reason: "Could not find an email address.",
      personId,
    };
  }

  await supabase
    .from("people")
    .update({ work_email: foundEmail })
    .eq("id", personId);

  return { email: foundEmail, source: "exa_search_or_pattern", personId };
}

// ── findEmail ──────────────────────────────────────────────────────────────

export const findEmail = tool({
  description:
    "Discover the email address for a contact using Exa search and common email pattern guessing. Returns the email if already known. Use this before writeEmail if the contact has no email.",
  inputSchema: z.object({
    personId: z.string().uuid().describe("Person ID to find email for."),
  }),
  execute: async ({ personId }) => findEmailForPerson(personId),
});

// ── findEmails (batch) ─────────────────────────────────────────────────────

export const findEmails = tool({
  description:
    "Batch-discover email addresses for multiple contacts. Skips contacts that already have emails. Returns found and not-found lists.",
  inputSchema: z.object({
    personIds: z.array(z.string().uuid()).describe("Array of person IDs."),
  }),
  execute: async ({ personIds }) => {
    const found: Array<{ personId: string; email: string }> = [];
    const notFound: string[] = [];

    for (const personId of personIds) {
      try {
        const result = await findEmailForPerson(personId);
        if (result.email) {
          found.push({ personId, email: result.email });
        } else {
          notFound.push(personId);
        }
      } catch {
        notFound.push(personId);
      }
    }

    return {
      found,
      notFound,
      summary: `Found emails for ${found.length} of ${personIds.length} contacts. ${notFound.length} not found.`,
    };
  },
});

// ── writeEmail ─────────────────────────────────────────────────────────────

export const writeEmail = tool({
  description:
    "Compose an email draft and save it to the database. This does NOT send the email -- it creates a draft for the user to review. The user must confirm before you call sendEmail.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID."),
    personId: z.string().uuid().describe("Person ID (from campaign contacts)."),
    subject: z.string().describe("Email subject line."),
    bodyHtml: z.string().describe("Email body as HTML."),
    bodyText: z
      .string()
      .optional()
      .describe("Plain text version of the email body."),
    sequenceId: z
      .string()
      .uuid()
      .optional()
      .describe("Sequence ID if this draft is part of a sequence."),
    sequenceStepId: z
      .string()
      .uuid()
      .optional()
      .describe("Sequence step ID for this draft."),
    enrollmentId: z
      .string()
      .uuid()
      .optional()
      .describe("Sequence enrollment ID for the contact."),
    aiReasoning: z
      .string()
      .optional()
      .describe("Explanation of why the email was written this way."),
  }),
  execute: async (input) => {
    const ctx = await getSupabaseAndUser();
    if (!ctx) {
      return {
        error:
          "No authenticated session available in tool context. Ask the user to sign in.",
      };
    }
    const { supabase, user } = ctx;

    const { data: campaignRow } = await supabase
      .from("campaigns")
      .select("user_id")
      .eq("id", input.campaignId)
      .single();
    const userId: string = campaignRow?.user_id ?? user.id;

    const result = await saveDraft(supabase, { ...input, userId });

    if (!result.ok) {
      return { error: result.error };
    }

    return {
      draftId: result.draftId,
      to: result.to,
      subject: result.subject,
      status: "draft",
      message:
        "Draft saved. Show it to the user and wait for confirmation before calling sendEmail.",
    };
  },
});

// ── sendEmail ──────────────────────────────────────────────────────────────

export const sendEmail = tool({
  description:
    "Send a previously written email draft via AgentMail. Only call this after the user has reviewed and confirmed the draft.",
  inputSchema: z.object({
    draftId: z.string().uuid().describe("Draft ID to send."),
  }),
  execute: async ({ draftId }) => {
    const supabase = await createClient();

    const { data: draft, error: draftErr } = await supabase
      .from("email_drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (draftErr || !draft) {
      return { error: "Draft not found." };
    }

    if (draft.status !== "draft") {
      return {
        error: `This draft has already been ${draft.status}. Cannot send again.`,
      };
    }

    const { data: settings } = await supabase
      .from("user_settings")
      .select("agentmail_inbox_id, from_name, reply_to_email")
      .single();

    if (!settings?.agentmail_inbox_id) {
      return {
        error:
          "Email is not configured. Go to Settings > Email and select an AgentMail inbox first.",
      };
    }

    let messageId: string;
    let threadId: string | null = null;
    try {
      const result = await sendMessage(settings.agentmail_inbox_id, {
        to: draft.to_email,
        subject: draft.subject,
        html: draft.body_html,
        text: draft.body_text ?? undefined,
      });
      messageId = result.messageId ?? crypto.randomUUID();
      threadId = result.threadId ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { error: `Failed to send email: ${msg}` };
    }

    const now = new Date().toISOString();

    await supabase.from("sent_emails").insert({
      agentmail_message_id: messageId,
      agentmail_thread_id: threadId,
      draft_id: draftId,
      campaign_people_id: draft.campaign_people_id,
      campaign_id: draft.campaign_id,
      person_id: draft.person_id,
      user_id: draft.user_id,
      to_email: draft.to_email,
      from_email: settings.agentmail_inbox_id,
      subject: draft.subject,
      status: "sent",
      sent_at: now,
    });

    await supabase
      .from("email_drafts")
      .update({ status: "sent", sent_at: now, updated_at: now })
      .eq("id", draftId);

    await supabase
      .from("campaign_people")
      .update({ outreach_status: "sent" })
      .eq("id", draft.campaign_people_id);

    trackUsage({
      service: "agentmail",
      operation: "send-email",
      estimated_cost_usd: 0.0004,
      campaign_id: draft.campaign_id,
      metadata: {
        draftId,
        to: draft.to_email,
      },
    });

    return {
      emailId: messageId,
      to: draft.to_email,
      subject: draft.subject,
      status: "sent",
    };
  },
});

// ── listDrafts ─────────────────────────────────────────────────────────────

export const listDrafts = tool({
  description: "List unsent email drafts, optionally filtered by campaign.",
  inputSchema: z.object({
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Filter drafts by campaign ID."),
  }),
  execute: async ({ campaignId }) => {
    const supabase = await createClient();

    let query = supabase
      .from("email_drafts")
      .select(
        "id, campaign_id, person_id, to_email, subject, status, created_at",
      )
      .eq("status", "draft")
      .order("created_at", { ascending: false });

    if (campaignId) {
      query = query.eq("campaign_id", campaignId);
    }

    const { data, error } = await query;
    if (error) return { error: error.message };

    return { drafts: data ?? [], count: data?.length ?? 0 };
  },
});

// ── discardDraft ───────────────────────────────────────────────────────────

export const discardDraft = tool({
  description: "Discard an email draft so it won't be sent.",
  inputSchema: z.object({
    draftId: z.string().uuid().describe("Draft ID to discard."),
  }),
  execute: async ({ draftId }) => {
    const supabase = await createClient();

    const { error } = await supabase
      .from("email_drafts")
      .update({
        status: "discarded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId)
      .eq("status", "draft");

    if (error) return { error: error.message };
    return { draftId, status: "discarded" };
  },
});

// ── sendBulkEmails ─────────────────────────────────────────────────────────

export const sendBulkEmails = tool({
  description:
    "Send multiple email drafts at once. If no draftIds provided, sends all unsent drafts for the campaign. Only call after user confirms sending all drafts.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID."),
    draftIds: z
      .array(z.string().uuid())
      .optional()
      .describe(
        "Specific draft IDs to send. If omitted, sends all drafts for the campaign.",
      ),
  }),
  execute: async ({ campaignId, draftIds }) => {
    const supabase = await createClient();

    let query = supabase
      .from("email_drafts")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("status", "draft");

    if (draftIds && draftIds.length > 0) {
      query = query.in("id", draftIds);
    }

    const { data: drafts, error } = await query;
    if (error) return { error: error.message };
    if (!drafts || drafts.length === 0) {
      return { error: "No drafts found to send." };
    }

    const { data: settings } = await supabase
      .from("user_settings")
      .select("agentmail_inbox_id")
      .single();

    if (!settings?.agentmail_inbox_id) {
      return {
        error: "Email not configured. Go to Settings > Email first.",
      };
    }

    const results: Array<{ draftId: string; status: string; error?: string }> =
      [];

    for (const draft of drafts) {
      try {
        const result = await sendMessage(settings.agentmail_inbox_id, {
          to: draft.to_email,
          subject: draft.subject,
          html: draft.body_html,
          text: draft.body_text ?? undefined,
        });

        const messageId = result.messageId ?? crypto.randomUUID();
        const threadId = result.threadId ?? null;
        const now = new Date().toISOString();

        await supabase.from("sent_emails").insert({
          agentmail_message_id: messageId,
          agentmail_thread_id: threadId,
          draft_id: draft.id,
          campaign_people_id: draft.campaign_people_id,
          campaign_id: draft.campaign_id,
          person_id: draft.person_id,
          user_id: draft.user_id,
          to_email: draft.to_email,
          from_email: settings.agentmail_inbox_id,
          subject: draft.subject,
          status: "sent",
          sent_at: now,
        });

        await supabase
          .from("email_drafts")
          .update({ status: "sent", sent_at: now, updated_at: now })
          .eq("id", draft.id);

        await supabase
          .from("campaign_people")
          .update({ outreach_status: "sent" })
          .eq("id", draft.campaign_people_id);

        trackUsage({
          service: "agentmail",
          operation: "send-email",
          estimated_cost_usd: 0.0004,
          campaign_id: campaignId,
          metadata: { draftId: draft.id, to: draft.to_email },
        });

        results.push({ draftId: draft.id, status: "sent" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push({ draftId: draft.id, status: "failed", error: msg });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return {
      sent,
      failed,
      total: drafts.length,
      results,
      summary: `Sent ${sent} of ${drafts.length} emails.${failed > 0 ? ` ${failed} failed.` : ""}`,
    };
  },
});
