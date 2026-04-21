import type { SupabaseClient } from "@supabase/supabase-js";

export type SaveDraftInput = {
  userId: string;
  campaignId: string;
  personId: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  sequenceId?: string | null;
  sequenceStepId?: string | null;
  enrollmentId?: string | null;
  aiReasoning?: string | null;
};

export type SaveDraftResult =
  | {
      ok: true;
      draftId: string;
      to: string;
      subject: string;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Inserts an email_drafts row. Shared by writeEmail (ad-hoc) and
 * draftEmailsForSequence (fan-out). Returns a discriminated union so
 * callers decide how to surface errors.
 */
export async function saveDraft(
  supabase: SupabaseClient,
  input: SaveDraftInput,
): Promise<SaveDraftResult> {
  const { data: person } = await supabase
    .from("people")
    .select("id, name, work_email, personal_email")
    .eq("id", input.personId)
    .single();

  if (!person) {
    return { ok: false, error: "Person not found." };
  }

  const toEmail = person.work_email ?? person.personal_email;
  if (!toEmail) {
    return {
      ok: false,
      error:
        "No email address on this contact. Use findEmail to discover one first.",
    };
  }

  const { data: cp } = await supabase
    .from("campaign_people")
    .select("id")
    .eq("campaign_id", input.campaignId)
    .eq("person_id", input.personId)
    .single();

  if (!cp) {
    return {
      ok: false,
      error: "Person is not linked to the specified campaign.",
    };
  }

  const { data: draft, error } = await supabase
    .from("email_drafts")
    .insert({
      user_id: input.userId,
      campaign_id: input.campaignId,
      person_id: input.personId,
      campaign_people_id: cp.id,
      to_email: toEmail,
      subject: input.subject,
      body_html: input.bodyHtml,
      body_text: input.bodyText ?? null,
      status: "draft",
      sequence_id: input.sequenceId ?? null,
      sequence_step_id: input.sequenceStepId ?? null,
      enrollment_id: input.enrollmentId ?? null,
      ai_reasoning: input.aiReasoning ?? null,
      review_status: input.sequenceId ? "pending" : "approved",
    })
    .select("id, to_email, subject")
    .single();

  if (error || !draft) {
    return {
      ok: false,
      error: `Failed to save draft: ${error?.message ?? "unknown error"}`,
    };
  }

  return {
    ok: true,
    draftId: draft.id,
    to: draft.to_email,
    subject: draft.subject,
  };
}
