import { NextResponse } from "next/server";

import { composeEmail } from "@/lib/email-composition/compose";
import { loadVoiceProfile } from "@/lib/email-composition/load-voice";
import { loadSenderFacts, renderFactBank } from "@/lib/sender-facts";
import {
  loadActiveLearnings,
  renderLearningsBlock,
} from "@/lib/email-learnings";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAndUser } from "@/lib/supabase/server";

export const maxDuration = 120;

interface Body {
  draftId?: string;
}

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user } = ctx;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.draftId) {
    return NextResponse.json({ error: "draftId is required" }, { status: 400 });
  }

  const supabase = getAdminClient();

  const { data: draft, error: draftErr } = await supabase
    .from("email_drafts")
    .select(
      "id, user_id, campaign_id, person_id, sequence_id, sequence_step_id, enrollment_id, ai_reasoning, review_status, status",
    )
    .eq("id", body.draftId)
    .single();

  if (draftErr || !draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (draft.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (draft.status !== "draft") {
    return NextResponse.json(
      { error: `Cannot regenerate a ${draft.status} email` },
      { status: 409 },
    );
  }

  if (draft.review_status !== "pending") {
    return NextResponse.json(
      { error: `Cannot regenerate a ${draft.review_status} email` },
      { status: 409 },
    );
  }

  const { data: person } = await supabase
    .from("people")
    .select(
      "id, name, title, work_email, personal_email, organization_id, enrichment_data",
    )
    .eq("id", draft.person_id)
    .single();

  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("name, icp, offering, positioning, profile_id")
    .eq("id", draft.campaign_id)
    .single();

  let senderProfile: Record<string, unknown> | null = null;
  if (campaign?.profile_id) {
    const { data: profile } = await supabase
      .from("user_profile")
      .select(
        "id, name, role_title, company_name, offering_summary, notes, booking_url",
      )
      .eq("id", campaign.profile_id)
      .single();
    senderProfile = (profile as Record<string, unknown>) ?? null;
  }

  // Sender fact bank for this profile (single draft, single load).
  const factBank = renderFactBank(
    await loadSenderFacts(supabase, campaign?.profile_id ?? null),
  );

  type OrgRow = {
    name: string | null;
    domain: string | null;
    industry: string | null;
    enrichment_data: Record<string, unknown> | null;
  };
  let org: OrgRow | null = null;
  if (person.organization_id) {
    const { data } = await supabase
      .from("organizations")
      .select("name, domain, industry, enrichment_data")
      .eq("id", person.organization_id)
      .single();
    org = (data as OrgRow | null) ?? null;
  }

  let stepNumber = 1;
  let totalSteps = 1;
  let condition = "always";
  // Ad-hoc drafts (no sequence) are first contact. The old default of true
  // regenerated them as breakup emails for threads that never existed.
  let isFinal = false;
  let previousSubject: string | null = null;

  if (draft.sequence_step_id && draft.sequence_id) {
    const { data: stepRow } = await supabase
      .from("sequence_steps")
      .select("step_number, condition")
      .eq("id", draft.sequence_step_id)
      .single();
    if (stepRow) {
      stepNumber = (stepRow.step_number as number) ?? 1;
      condition = (stepRow.condition as string) ?? "always";
    }

    const { count } = await supabase
      .from("sequence_steps")
      .select("*", { count: "exact", head: true })
      .eq("sequence_id", draft.sequence_id);
    totalSteps = count ?? 1;
    // Only a step with real predecessors is a breakup; the sole step of a
    // 1-step sequence is first contact.
    isFinal = totalSteps > 1 && stepNumber === totalSteps;

    // A follow-up regenerates with the subject it actually follows up on.
    if (stepNumber > 1 && draft.enrollment_id) {
      const { data: priorStep } = await supabase
        .from("sequence_steps")
        .select("id")
        .eq("sequence_id", draft.sequence_id)
        .eq("step_number", stepNumber - 1)
        .maybeSingle();
      if (priorStep) {
        const { data: priorDraft } = await supabase
          .from("email_drafts")
          .select("subject")
          .eq("enrollment_id", draft.enrollment_id)
          .eq("sequence_step_id", priorStep.id)
          .maybeSingle();
        previousSubject = (priorDraft?.subject as string | undefined) ?? null;
      }
    }
  }

  const voice = await loadVoiceProfile(supabase, user.id, draft.campaign_id);

  const learnings = renderLearningsBlock(
    await loadActiveLearnings(supabase, user.id, draft.campaign_id),
  );

  const composed = await composeEmail({
    voice,
    contact: {
      name: (person.name as string) ?? null,
      title: (person.title as string) ?? null,
      email:
        (person.work_email as string) ??
        (person.personal_email as string) ??
        "", // no address on file: never render a fabricated one into the prompt
      enrichmentData:
        (person.enrichment_data as Record<string, unknown>) ?? null,
    },
    company: org
      ? {
          name: org.name,
          domain: org.domain,
          industry: org.industry,
          enrichmentData: org.enrichment_data,
        }
      : null,
    step: {
      stepNumber,
      totalSteps,
      condition,
      isFinal,
    },
    campaign: {
      name: (campaign?.name as string) ?? "Campaign",
      icp: (campaign?.icp as Record<string, unknown>) ?? null,
      offering: (campaign?.offering as Record<string, unknown>) ?? null,
      positioning: (campaign?.positioning as Record<string, unknown>) ?? null,
    },
    senderProfile: {
      name: (senderProfile?.name as string) ?? null,
      title: (senderProfile?.role_title as string) ?? null,
      company: (senderProfile?.company_name as string) ?? null,
      offeringSummary: (senderProfile?.offering_summary as string) ?? null,
      notes: (senderProfile?.notes as string) ?? null,
      bookingUrl: (senderProfile?.booking_url as string) ?? null,
    },
    factBank,
    learnings,
    previousSubject,
    triggerReason: (draft.ai_reasoning as string) ?? null,
  });

  if (!composed.ok) {
    return NextResponse.json(
      { error: composed.error || "Failed to regenerate email" },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("email_drafts")
    .update({
      subject: composed.email.subject,
      body_html: composed.email.bodyHtml,
      body_text: composed.email.bodyText ?? null,
      ai_reasoning: composed.email.aiReasoning ?? draft.ai_reasoning,
      updated_at: now,
    })
    .eq("id", draft.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    draftId: draft.id,
    subject: composed.email.subject,
    bodyHtml: composed.email.bodyHtml,
    bodyText: composed.email.bodyText ?? null,
    aiReasoning: composed.email.aiReasoning ?? null,
  });
}
