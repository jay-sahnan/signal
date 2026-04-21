import { NextResponse } from "next/server";

import { sendApprovedDraft } from "@/lib/services/outreach-sender";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAndUser } from "@/lib/supabase/server";

export const maxDuration = 60;

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

  const { data: draft, error: draftError } = await supabase
    .from("email_drafts")
    .select(
      "id, user_id, review_status, status, enrollment_id, sequence_step_id",
    )
    .eq("id", body.draftId)
    .single();

  if (draftError || !draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (draft.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (draft.review_status !== "approved") {
    return NextResponse.json(
      {
        ok: false,
        blocker: "not_approved",
        error: "Draft must be approved before it can be sent",
      },
      { status: 409 },
    );
  }

  if (draft.status !== "draft") {
    return NextResponse.json(
      {
        ok: false,
        blocker: "already_sent",
        error: `Draft is already ${draft.status}`,
      },
      { status: 409 },
    );
  }

  if (!draft.enrollment_id) {
    return NextResponse.json(
      {
        ok: false,
        blocker: "no_enrollment",
        error: "Draft has no enrollment",
      },
      { status: 409 },
    );
  }

  const { data: enrollment } = await supabase
    .from("sequence_enrollments")
    .select("id, sequence_id, person_id, campaign_people_id, current_step")
    .eq("id", draft.enrollment_id)
    .single();

  if (!enrollment) {
    return NextResponse.json(
      { ok: false, blocker: "no_enrollment", error: "Enrollment not found" },
      { status: 404 },
    );
  }

  const result = await sendApprovedDraft(supabase, enrollment);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    draftId: result.draftId,
    messageId: result.messageId,
    sentAt: new Date().toISOString(),
  });
}
