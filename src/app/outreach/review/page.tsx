"use client";

import { useAuth } from "@clerk/nextjs";
import { requestRegeneration } from "@/lib/billing/regeneration-request";
import { requestContactEnrichment } from "@/lib/billing/contact-enrichment-request";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Clock, Loader2, RefreshCw, Send } from "lucide-react";
import posthog from "posthog-js";
import { toast } from "sonner";
import { ContactDetail } from "@/components/campaign/contact-detail";
import { Button } from "@/components/ui/button";
import { EditableEmail } from "@/components/ui/editable-email";
import {
  AffiliationBadge,
  EmailProvenanceBadge,
} from "@/components/ui/provenance-badge";
import { createClient } from "@/lib/supabase/client";
import type { CampaignContact, EnrichmentData } from "@/lib/types/campaign";
import { apiFetch } from "@/lib/api-fetch";
import { htmlToPlain, plainToHtml } from "@/lib/email/html-to-plain";

// Both halves of the editor round-trip live in src/lib/email/html-to-plain.ts.
// htmlToPlain is deliberately the LOSSY variant: this feeds a textarea that
// plainToHtml re-serialises on save, so a link-preserving version here would
// write "text (url)" back into the body as literal text.

interface DraftForReview {
  id: string;
  to_email: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  ai_reasoning: string | null;
  review_status: string;
  status: string;
  sequence_step_id: string | null;
  enrollment_id: string | null;
  enrollment_current_step: number | null;
  person_id: string;
  person_name: string;
  person_title: string | null;
  person_bio_summary: string | null;
  person_work_email: string | null;
  person_work_email_confidence: number | null;
  person_work_email_source: string | null;
  person_work_email_verification: string | null;
  person_affiliation_source: string | null;
  person_affiliation_confidence: number | null;
  person_affiliation_evidence: string | null;
  person_personal_email: string | null;
  person_linkedin_url: string | null;
  person_twitter_url: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_industry: string | null;
  priority_score: number | null;
  enrichment_status: "pending" | "in_progress" | "enriched" | "failed";
  last_enriched_at: string | null;
  enrichment_data: EnrichmentData;
  step_number: number;
  total_steps: number;
  delay_days: number | null;
  delay_hours: number | null;
}

function formatDelay(days: number | null, hours: number | null): string {
  const d = days ?? 0;
  const h = hours ?? 0;
  if (d === 0 && h === 0) return "Immediately";
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} ${d === 1 ? "day" : "days"}`);
  if (h > 0) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  return `Wait ${parts.join(" ")}`;
}

interface EditState {
  subject: string;
  bodyText: string;
}

function initialEdit(draft: DraftForReview): EditState {
  return {
    subject: draft.subject,
    bodyText: draft.body_text ?? htmlToPlain(draft.body_html),
  };
}

export default function ReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading drafts...</p>
        </div>
      }
    >
      <ReviewPageInner />
    </Suspense>
  );
}

function ReviewPageInner() {
  const { userId } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const sequenceId = searchParams.get("sequence");

  const [drafts, setDrafts] = useState<DraftForReview[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentPersonIndex, setCurrentPersonIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [enrichingPersonIds, setEnrichingPersonIds] = useState<Set<string>>(
    new Set(),
  );
  const [sendingDraftIds, setSendingDraftIds] = useState<Set<string>>(
    new Set(),
  );
  const regenerationInFlight = useRef(new Set<string>());
  const [regeneratingDraftIds, setRegeneratingDraftIds] = useState<Set<string>>(
    new Set(),
  );

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const load = async () => {
      const supabase = createClient();
      const baseQuery = supabase
        .from("email_drafts")
        .select(
          `
          id, to_email, subject, body_html, body_text, ai_reasoning,
          review_status, status, sequence_step_id, enrollment_id, person_id,
          people(
            name, title, bio_summary, organization_id, enrichment_data,
            enrichment_status, last_enriched_at,
            work_email, work_email_confidence, work_email_source,
            work_email_verification, affiliation_source,
            affiliation_confidence, affiliation_evidence,
            personal_email, linkedin_url, twitter_url,
            organizations!organization_id(name, domain, industry)
          ),
          campaign_people(priority_score),
          sequence_enrollments(current_step),
          sequence_steps(step_number, delay_days, delay_hours)
        `,
        )
        .eq("review_status", "pending")
        .order("person_id")
        .order("sequence_step_id");
      const [draftsRes, stepsRes] = await Promise.all([
        // Without a sequence param this is the ad-hoc queue: drafts the
        // agent wrote outside any sequence. They are born pending like
        // everything else, so they need a review surface too.
        sequenceId
          ? baseQuery.eq("sequence_id", sequenceId)
          : baseQuery.is("sequence_id", null),
        sequenceId
          ? supabase
              .from("sequence_steps")
              .select("id")
              .eq("sequence_id", sequenceId)
          : null,
      ]);

      if (!mountedRef.current) return;

      // A failed query must never render as an empty queue: that is how a
      // broken embed hid eight pending drafts behind "No drafts to review".
      if (draftsRes.error) {
        console.error("[outreach/review] drafts load failed:", draftsRes.error);
        setLoadError(draftsRes.error.message);
        setLoading(false);
        return;
      }

      const rawDrafts = draftsRes.data;
      // Ad-hoc drafts have no steps; stepsRes is null and every card is 1/1.
      const totalSteps = stepsRes ? (stepsRes.data?.length ?? 1) : 1;

      const mapped: DraftForReview[] = (rawDrafts ?? []).map((d) => {
        const person = d.people as unknown as {
          name: string;
          title: string | null;
          bio_summary: string | null;
          organization_id: string | null;
          enrichment_data: EnrichmentData;
          enrichment_status: "pending" | "in_progress" | "enriched" | "failed";
          last_enriched_at: string | null;
          work_email: string | null;
          work_email_confidence: number | null;
          work_email_source: string | null;
          work_email_verification: string | null;
          affiliation_source: string | null;
          affiliation_confidence: number | null;
          affiliation_evidence: string | null;
          personal_email: string | null;
          linkedin_url: string | null;
          twitter_url: string | null;
          organizations: {
            name: string;
            domain: string | null;
            industry: string | null;
          } | null;
        } | null;
        const cp = d.campaign_people as unknown as {
          priority_score: number | null;
        } | null;
        const enrollment = d.sequence_enrollments as unknown as {
          current_step: number | null;
        } | null;
        const stepData = d.sequence_steps as unknown as {
          step_number: number;
          delay_days: number | null;
          delay_hours: number | null;
        } | null;

        return {
          id: d.id,
          to_email: d.to_email,
          subject: d.subject,
          body_html: d.body_html,
          body_text: d.body_text,
          ai_reasoning: d.ai_reasoning,
          review_status: d.review_status ?? "pending",
          status: d.status ?? "draft",
          sequence_step_id: d.sequence_step_id,
          enrollment_id: d.enrollment_id,
          enrollment_current_step: enrollment?.current_step ?? null,
          person_id: d.person_id,
          person_name: person?.name ?? "Unknown",
          person_title: person?.title ?? null,
          person_bio_summary: person?.bio_summary ?? null,
          person_work_email: person?.work_email ?? null,
          person_work_email_confidence: person?.work_email_confidence ?? null,
          person_work_email_source: person?.work_email_source ?? null,
          person_work_email_verification:
            person?.work_email_verification ?? null,
          person_affiliation_source: person?.affiliation_source ?? null,
          person_affiliation_confidence: person?.affiliation_confidence ?? null,
          person_affiliation_evidence: person?.affiliation_evidence ?? null,
          person_personal_email: person?.personal_email ?? null,
          person_linkedin_url: person?.linkedin_url ?? null,
          person_twitter_url: person?.twitter_url ?? null,
          company_name: person?.organizations?.name ?? null,
          company_domain: person?.organizations?.domain ?? null,
          company_industry: person?.organizations?.industry ?? null,
          priority_score: cp?.priority_score ?? null,
          enrichment_status: person?.enrichment_status ?? "pending",
          last_enriched_at: person?.last_enriched_at ?? null,
          enrichment_data: person?.enrichment_data ?? ({} as EnrichmentData),
          step_number: stepData?.step_number ?? 1,
          total_steps: totalSteps,
          delay_days: stepData?.delay_days ?? null,
          delay_hours: stepData?.delay_hours ?? null,
        };
      });

      setDrafts(mapped);

      const init: Record<string, EditState> = {};
      for (const d of mapped) init[d.id] = initialEdit(d);
      setEdits(init);

      setLoading(false);
    };

    load();
    return () => {
      mountedRef.current = false;
    };
  }, [sequenceId]);

  const personGroups = useMemo(() => {
    const groups = new Map<string, DraftForReview[]>();
    for (const d of drafts) {
      if (!groups.has(d.person_id)) groups.set(d.person_id, []);
      groups.get(d.person_id)!.push(d);
    }
    for (const arr of groups.values()) {
      arr.sort((a, b) => a.step_number - b.step_number);
    }
    return groups;
  }, [drafts]);

  const personIds = useMemo(
    () => Array.from(personGroups.keys()),
    [personGroups],
  );
  const currentPersonId = personIds[currentPersonIndex] ?? null;
  const currentDrafts = useMemo(
    () => (currentPersonId ? (personGroups.get(currentPersonId) ?? []) : []),
    [currentPersonId, personGroups],
  );
  const currentContact = currentDrafts[0] ?? null;

  const totalContacts = personIds.length;
  const reviewedContacts = useMemo(() => {
    let count = 0;
    for (const group of personGroups.values()) {
      if (group.every((d) => d.review_status !== "pending")) count += 1;
    }
    return count;
  }, [personGroups]);

  const updateEdit = useCallback(
    (draftId: string, patch: Partial<EditState>) => {
      setEdits((prev) => ({
        ...prev,
        [draftId]: { ...prev[draftId], ...patch },
      }));
    },
    [],
  );

  const isDirty = useMemo(() => {
    for (const d of currentDrafts) {
      const edit = edits[d.id];
      if (!edit) continue;
      const baseBody = d.body_text ?? htmlToPlain(d.body_html);
      if (edit.subject !== d.subject || edit.bodyText !== baseBody) return true;
    }
    return false;
  }, [currentDrafts, edits]);

  // Warn before unload if there are unsaved edits
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleContactAction = useCallback(
    async (action: "approved" | "rejected") => {
      if (!currentContact || saving) return;
      setSaving(true);

      const supabase = createClient();
      const now = new Date().toISOString();

      try {
        // Save edits for drafts whose subject or body changed
        const editPromises = currentDrafts.map(async (d) => {
          const edit = edits[d.id];
          if (!edit) return;
          const baseBody = d.body_text ?? htmlToPlain(d.body_html);
          const subjectChanged = edit.subject !== d.subject;
          const bodyChanged = edit.bodyText !== baseBody;
          if (!subjectChanged && !bodyChanged) return;
          // Only what actually changed is written. The payload used to
          // include the body unconditionally, so a subject-only tweak
          // pushed the untouched body through the lossy htmlToPlain ->
          // plainToHtml round-trip and silently stripped every link the
          // composer had written.
          const patch: Record<string, string> = { updated_at: now };
          if (subjectChanged) patch.subject = edit.subject;
          if (bodyChanged) {
            patch.body_html = plainToHtml(edit.bodyText);
            patch.body_text = edit.bodyText;
          }
          const { error } = await supabase
            .from("email_drafts")
            .update(patch)
            .eq("id", d.id);
          if (error)
            throw new Error(`Could not save your edit: ${error.message}`);
        });
        await Promise.all(editPromises);

        // Mark all pending drafts for this contact
        const pendingIds = currentDrafts
          .filter((d) => d.review_status === "pending")
          .map((d) => d.id);

        if (pendingIds.length > 0) {
          // Checked, and checked by row count.
          //
          // None of the writes on this page read their error. Combined with the
          // known Clerk footgun -- a session token without the `role:
          // authenticated` claim maps to anon, so RLS silently matches zero
          // rows -- a whole review session could approve nothing at all while
          // showing a green toast for every contact, and the user would only
          // find out when nothing ever sent.
          const { data: updated, error } = await supabase
            .from("email_drafts")
            .update({ review_status: action, updated_at: now })
            .in("id", pendingIds)
            .select("id");

          if (error) {
            throw new Error(`Could not save your review: ${error.message}`);
          }
          if ((updated?.length ?? 0) !== pendingIds.length) {
            throw new Error(
              `Only ${updated?.length ?? 0} of ${pendingIds.length} drafts were updated. Reload and try again.`,
            );
          }
        }

        posthog.capture(
          action === "approved" ? "draft_approved" : "draft_rejected",
          {
            sequence_id: sequenceId,
            draft_count: pendingIds.length,
            company_name: currentContact.company_name ?? undefined,
          },
        );

        setDrafts((prev) =>
          prev.map((d) =>
            pendingIds.includes(d.id) ? { ...d, review_status: action } : d,
          ),
        );

        toast.success(
          action === "approved"
            ? `Approved ${pendingIds.length} email${pendingIds.length === 1 ? "" : "s"}`
            : `Rejected ${pendingIds.length} email${pendingIds.length === 1 ? "" : "s"}`,
        );

        // Advance to next contact with pending drafts
        const nextIndex = personIds.findIndex((pid, i) => {
          if (i <= currentPersonIndex) return false;
          const group = personGroups.get(pid);
          return group?.some((d) => d.review_status === "pending") ?? false;
        });

        if (nextIndex >= 0) setCurrentPersonIndex(nextIndex);
        else toast.success("All contacts reviewed");
      } catch (err) {
        // Without this the row stays "saving" forever: every button on the
        // card is disabled, the keyboard shortcuts are dead, and nothing says
        // why. A refused write has to leave the contact reviewable.
        toast.error(
          err instanceof Error ? err.message : "Could not save your review.",
        );
      } finally {
        setSaving(false);
      }
    },
    [
      currentContact,
      currentDrafts,
      currentPersonIndex,
      edits,
      personGroups,
      personIds,
      saving,
      sequenceId,
    ],
  );

  const handleEnrich = useCallback(
    async function retryEnrichment(
      contactId: string,
    ): Promise<void> {
      const personId = contactId;
      if (enrichingPersonIds.has(personId)) return;

      setEnrichingPersonIds((prev) => new Set(prev).add(personId));
      setDrafts((prev) =>
        prev.map((d) =>
          d.person_id === personId
            ? { ...d, enrichment_status: "in_progress" }
            : d,
        ),
      );

      try {
        const result = await requestContactEnrichment(
          userId,
          personId,
        );

        const enrichmentData = (result.enrichmentData ?? {}) as EnrichmentData;
        const status = (result.status ?? "enriched") as "enriched" | "failed";
        setDrafts((prev) =>
          prev.map((d) =>
            d.person_id === personId
              ? {
                  ...d,
                  enrichment_status: status,
                  enrichment_data: enrichmentData,
                  last_enriched_at: new Date().toISOString(),
                }
              : d,
          ),
        );
        if (status === "failed") {
          toast.error("Enrichment returned no data");
        } else if (result.skipped) {
          toast.success("Loaded existing enrichment");
        } else {
          toast.success("Contact enriched");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Enrichment failed", {
          description:
            "Use the enrichment button to retry the same request. Credits may remain reserved while its outcome is unresolved.",
        });
        setDrafts((prev) =>
          prev.map((d) =>
            d.person_id === personId
              ? { ...d, enrichment_status: "failed" }
              : d,
          ),
        );
      } finally {
        setEnrichingPersonIds((prev) => {
          const next = new Set(prev);
          next.delete(personId);
          return next;
        });
      }
    },
    [enrichingPersonIds, userId],
  );

  const handleSendNow = useCallback(
    async (draftId: string) => {
      if (sendingDraftIds.has(draftId)) return;
      const draft = drafts.find((d) => d.id === draftId);
      if (!draft) return;

      setSendingDraftIds((prev) => new Set(prev).add(draftId));
      const supabase = createClient();
      const now = new Date().toISOString();

      try {
        const edit = edits[draftId];
        if (edit) {
          const baseBody = draft.body_text ?? htmlToPlain(draft.body_html);
          const subjectChanged = edit.subject !== draft.subject;
          const bodyChanged = edit.bodyText !== baseBody;
          if (subjectChanged || bodyChanged) {
            // Same partial-payload rule as the approve path: an untouched
            // body must never round-trip through the lossy serialiser.
            const patch: Record<string, string> = { updated_at: now };
            if (subjectChanged) patch.subject = edit.subject;
            if (bodyChanged) {
              patch.body_html = plainToHtml(edit.bodyText);
              patch.body_text = edit.bodyText;
            }
            const { error: editErr } = await supabase
              .from("email_drafts")
              .update(patch)
              .eq("id", draftId);
            if (editErr) {
              toast.error(editErr.message);
              return;
            }
          }
        }

        const { error: approveErr } = await supabase
          .from("email_drafts")
          .update({ review_status: "approved", updated_at: now })
          .eq("id", draftId);
        if (approveErr) {
          toast.error(approveErr.message);
          return;
        }

        const res = await apiFetch("/api/outreach/send-now", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          toast.error(data.error ?? "Failed to send");
          // Put the draft back to pending.
          //
          // It was approved a few lines above so the send could proceed. When
          // the send then failed, leaving it approved handed it to the cron:
          // the user saw "Failed to send", and the email went out unattended
          // later anyway. The user's belief and the system's state have to
          // agree, and their belief is that nothing was sent.
          const { error: revertErr } = await supabase
            .from("email_drafts")
            .update({ review_status: "pending", updated_at: now })
            .eq("id", draftId)
            .eq("status", "draft");
          if (revertErr) {
            toast.error(
              "This draft is still marked approved and may send later. Reject it if you do not want it to.",
            );
          }
          setDrafts((prev) =>
            prev.map((d) =>
              d.id === draftId ? { ...d, review_status: "pending" } : d,
            ),
          );
          return;
        }

        posthog.capture("email_sent_now", {
          draft_id: draftId,
          sequence_id: sequenceId,
          step_number: draft.step_number,
          company_name: draft.company_name ?? undefined,
        });
        toast.success("Email sent");
        setDrafts((prev) =>
          prev.map((d) => {
            if (d.id === draftId) {
              return { ...d, review_status: "approved", status: "sent" };
            }
            if (
              d.enrollment_id === draft.enrollment_id &&
              d.enrollment_id !== null
            ) {
              return {
                ...d,
                enrollment_current_step: (d.enrollment_current_step ?? 1) + 1,
              };
            }
            return d;
          }),
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to send");
      } finally {
        setSendingDraftIds((prev) => {
          const next = new Set(prev);
          next.delete(draftId);
          return next;
        });
      }
    },
    [drafts, edits, sendingDraftIds, sequenceId],
  );

  const handleRegenerate = useCallback(
    async (draftId: string) => {
      if (regenerationInFlight.current.has(draftId)) return;
      const draft = drafts.find((d) => d.id === draftId);
      if (!draft) return;
      if (draft.review_status !== "pending" || draft.status !== "draft") {
        return;
      }

      regenerationInFlight.current.add(draftId);
      setRegeneratingDraftIds((prev) => new Set(prev).add(draftId));

      try {
        const data = await requestRegeneration(userId, draftId);

        const newSubject = data.subject as string;
        const newBodyHtml = data.bodyHtml as string;
        const newBodyText = (data.bodyText as string | null) ?? null;
        const newReasoning = (data.aiReasoning as string | null) ?? null;

        setDrafts((prev) =>
          prev.map((d) =>
            d.id === draftId
              ? {
                  ...d,
                  subject: newSubject,
                  body_html: newBodyHtml,
                  body_text: newBodyText,
                  ai_reasoning: newReasoning ?? d.ai_reasoning,
                }
              : d,
          ),
        );
        setEdits((prev) => ({
          ...prev,
          [draftId]: {
            subject: newSubject,
            bodyText: newBodyText ?? htmlToPlain(newBodyHtml),
          },
        }));

        posthog.capture("email_regenerated", {
          draft_id: draftId,
          sequence_id: sequenceId,
          step_number: draft.step_number,
        });
        toast.success("Email regenerated");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to regenerate",
        );
      } finally {
        regenerationInFlight.current.delete(draftId);
        setRegeneratingDraftIds((prev) => {
          const next = new Set(prev);
          next.delete(draftId);
          return next;
        });
      }
    },
    [drafts, userId, sequenceId],
  );

  const handleContactEmailEdit = useCallback(
    async (next: string) => {
      if (!currentContact) return;
      const personId = currentContact.person_id;
      const draftIds = drafts
        .filter((d) => d.person_id === personId)
        .map((d) => d.id);
      if (draftIds.length === 0) return;
      const supabase = createClient();
      const now = new Date().toISOString();

      const { error: draftErr } = await supabase
        .from("email_drafts")
        .update({ to_email: next, updated_at: now })
        .in("id", draftIds);
      if (draftErr) throw new Error(draftErr.message);

      // Also persist on the person so future drafts/sequences use the
      // corrected address. Update work_email since saveDraft reads it first.
      //
      // The verification columns are cleared ONLY when the address actually
      // changed. A verdict describes one address: leaving a stale `risky` or
      // `undeliverable` behind for a REPLACED address turned a manual fix into
      // a permanent block — but wiping it when the user re-saves the SAME
      // address would erase real bounce history about that very string, which
      // recordVerifiedEmail deliberately preserves. The clear happens here
      // rather than in record-verified below because this write lands first,
      // so that endpoint sees the new address already stored and keeps the
      // verdict.
      const prevEmail = (
        currentContact.person_work_email ??
        currentContact.to_email ??
        ""
      ).toLowerCase();
      const addressChanged = next.toLowerCase() !== prevEmail;

      const { error: personErr } = await supabase
        .from("people")
        .update({
          work_email: next,
          updated_at: now,
          ...(addressChanged
            ? { work_email_verification: null, work_email_verified_by: null }
            : {}),
        })
        .eq("id", personId);
      if (personErr) throw new Error(personErr.message);

      // Promote to user_entered source + recompute the org pattern. Fire-and-
      // forget so a slow recompute doesn't block the UI; the prior person
      // update already persisted the email.
      void apiFetch("/api/email/record-verified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, email: next }),
      });

      setDrafts((prev) =>
        prev.map((d) =>
          d.person_id === personId
            ? { ...d, to_email: next, person_work_email: next }
            : d,
        ),
      );
    },
    [currentContact, drafts],
  );

  // Keyboard shortcuts — only fire outside text inputs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }
      // Approving authorises a real send, and there is no undo in this flow.
      //
      // Key auto-repeat fired this handler once per repeat, and the in-flight
      // guard is state-based so it clears on every round trip -- holding the
      // key walked the whole queue, approving contact after contact. And on
      // macOS Cmd+Left is Back, so reaching for it rejected the contact and
      // swallowed the navigation.
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleContactAction("rejected");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleContactAction("approved");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleContactAction]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading drafts...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-destructive text-sm" role="alert">
          Could not load drafts: {loadError}
        </p>
      </div>
    );
  }

  if (totalContacts === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">No drafts to review.</p>
      </div>
    );
  }

  const allDone = reviewedContacts >= totalContacts;
  if (allDone || !currentContact) {
    const approvedCount = drafts.filter(
      (d) => d.review_status === "approved",
    ).length;
    const rejectedCount = drafts.filter(
      (d) => d.review_status === "rejected",
    ).length;

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <h2 className="type-header">Review complete</h2>
        <p className="text-muted-foreground text-sm">
          {approvedCount} approved, {rejectedCount} rejected across{" "}
          {totalContacts} contacts.
        </p>
        <Button onClick={() => router.push("/outreach")}>
          Back to Outreach
        </Button>
      </div>
    );
  }

  const progressPct =
    totalContacts > 0 ? ((reviewedContacts + 1) / totalContacts) * 100 : 0;

  const isEnriching = enrichingPersonIds.has(currentContact.person_id);
  const sidebarContact: CampaignContact = {
    id: currentContact.person_id,
    person_id: currentContact.person_id,
    campaign_id: "",
    organization_id: null,
    name: currentContact.person_name,
    title: currentContact.person_title,
    department: null,
    seniority: null,
    role_summary: null,
    bio_summary: currentContact.person_bio_summary,
    work_email: currentContact.person_work_email ?? currentContact.to_email,
    personal_email: currentContact.person_personal_email,
    work_email_verified_at: null,
    personal_email_verified_at: null,
    work_email_source: currentContact.person_work_email_source,
    work_email_verification: currentContact.person_work_email_verification,
    work_email_confidence: currentContact.person_work_email_confidence,
    affiliation_source: currentContact.person_affiliation_source,
    affiliation_confidence: currentContact.person_affiliation_confidence,
    affiliation_evidence: currentContact.person_affiliation_evidence,
    linkedin_url: currentContact.person_linkedin_url,
    twitter_url: currentContact.person_twitter_url,
    enrichment_status: isEnriching
      ? "in_progress"
      : currentContact.enrichment_status,
    enrichment_data: currentContact.enrichment_data,
    outreach_status: "not_contacted",
    priority_score: currentContact.priority_score,
    score_reason: currentContact.ai_reasoning,
    readiness_tag: null,
    source: null,
    created_at: "",
    updated_at: "",
    company: currentContact.company_name
      ? {
          name: currentContact.company_name,
          domain: currentContact.company_domain,
          industry: currentContact.company_industry,
        }
      : null,
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Progress header */}
      <div className="border-border border-b px-6 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground tabular-nums">
            Contact {reviewedContacts + 1} / {totalContacts}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/outreach")}
          >
            Exit review
          </Button>
        </div>
        <div className="bg-muted mt-2 h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Split layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: stacked emails for this contact */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <div className="space-y-1">
              <h2 className="type-header">{currentContact.person_name}</h2>
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <span className="shrink-0">Email:</span>
                <EditableEmail
                  value={currentContact.to_email}
                  onSave={handleContactEmailEdit}
                />
                <EmailProvenanceBadge
                  person={{
                    work_email:
                      currentContact.person_work_email ??
                      currentContact.to_email,
                    work_email_source: currentContact.person_work_email_source,
                    work_email_verification:
                      currentContact.person_work_email_verification,
                    work_email_confidence:
                      currentContact.person_work_email_confidence,
                  }}
                />
                <AffiliationBadge
                  person={{
                    affiliation_source:
                      currentContact.person_affiliation_source,
                    affiliation_confidence:
                      currentContact.person_affiliation_confidence,
                    affiliation_evidence:
                      currentContact.person_affiliation_evidence,
                  }}
                />
              </div>
            </div>

            {currentDrafts.map((draft, idx) => {
              const edit = edits[draft.id] ?? initialEdit(draft);
              const showDelay =
                idx > 0 &&
                ((draft.delay_days ?? 0) > 0 || (draft.delay_hours ?? 0) > 0);
              return (
                <div key={draft.id} className="space-y-3">
                  {showDelay && (
                    <DelayConnector
                      label={formatDelay(draft.delay_days, draft.delay_hours)}
                    />
                  )}
                  <EmailCard
                    draft={draft}
                    edit={edit}
                    onSubjectChange={(subject) =>
                      updateEdit(draft.id, { subject })
                    }
                    onBodyChange={(bodyText) =>
                      updateEdit(draft.id, { bodyText })
                    }
                    onSendNow={() => handleSendNow(draft.id)}
                    onRegenerate={() => handleRegenerate(draft.id)}
                    sending={sendingDraftIds.has(draft.id)}
                    regenerating={regeneratingDraftIds.has(draft.id)}
                    disableSend={saving}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: contact context — full enrichment, narrow variant */}
        <aside className="border-border bg-muted/10 hidden w-96 shrink-0 overflow-y-auto border-l md:block">
          <div className="border-border space-y-1 border-b px-4 py-4">
            <h3 className="text-sm font-semibold">
              {currentContact.person_name}
            </h3>
            {currentContact.person_title && (
              <p className="text-muted-foreground text-xs">
                {currentContact.person_title}
              </p>
            )}
            {currentContact.company_name && (
              <p className="text-muted-foreground text-xs">
                @ {currentContact.company_name}
              </p>
            )}
          </div>

          {currentContact.ai_reasoning && (
            <div className="border-border space-y-1.5 border-b px-4 py-4">
              <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                AI summary
              </h4>
              <p className="text-muted-foreground whitespace-pre-wrap text-xs leading-relaxed">
                {currentContact.ai_reasoning}
              </p>
            </div>
          )}

          <ContactDetail
            contact={sidebarContact}
            variant="sidebar"
            onRetry={handleEnrich}
          />
        </aside>
      </div>

      {/* Action bar */}
      <div className="border-border flex items-center justify-center gap-6 border-t px-6 py-4">
        <Button
          variant="outline"
          size="lg"
          onClick={() => handleContactAction("rejected")}
          disabled={saving}
          className="min-w-[140px]"
        >
          Reject all
        </Button>
        <span className="text-muted-foreground hidden items-center gap-1 text-xs md:inline-flex">
          <kbd className="bg-muted rounded px-1.5 py-0.5 font-mono text-[10px]">
            ←
          </kbd>
          reject
          <span className="mx-1">·</span>
          <kbd className="bg-muted rounded px-1.5 py-0.5 font-mono text-[10px]">
            →
          </kbd>
          approve
        </span>
        <Button
          size="lg"
          onClick={() => handleContactAction("approved")}
          disabled={saving}
          className="min-w-[140px]"
        >
          Approve all
        </Button>
      </div>
    </div>
  );
}

function DelayConnector({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pl-6">
      <div className="bg-border h-6 w-px" />
      <div className="text-muted-foreground bg-muted/40 border-border inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs tabular-nums">
        <Clock className="h-3 w-3" />
        {label}
      </div>
      <div className="bg-border h-6 w-px" />
    </div>
  );
}

function EmailCard({
  draft,
  edit,
  onSubjectChange,
  onBodyChange,
  onSendNow,
  onRegenerate,
  sending,
  regenerating,
  disableSend,
}: {
  draft: DraftForReview;
  edit: EditState;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onSendNow: () => void;
  onRegenerate: () => void;
  sending: boolean;
  regenerating: boolean;
  disableSend: boolean;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const alreadyReviewed = draft.review_status !== "pending";
  const isSent = draft.status === "sent";
  // Ad-hoc drafts (no enrollment) are sendable directly: send-now handles
  // them. Sequence drafts still only offer Send now on their current step.
  const canSendNow =
    !alreadyReviewed &&
    !isSent &&
    (draft.enrollment_current_step == null ||
      draft.step_number === draft.enrollment_current_step);
  const canRegenerate = !alreadyReviewed && !isSent;

  // Autosize textarea to content — no scrollbar, full email visible
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [edit.bodyText]);

  return (
    <div className="border-border bg-background rounded-lg border p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        {draft.sequence_step_id !== null ? (
          <div className="flex items-center gap-2">
            <span className="bg-primary/10 text-primary inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
              {draft.step_number}
            </span>
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Step {draft.step_number} of {draft.total_steps}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            One-off email
          </span>
        )}
        <div className="flex items-center gap-2">
          {isSent ? (
            <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
              Sent
            </span>
          ) : alreadyReviewed ? (
            <span className="text-muted-foreground rounded-full bg-muted px-2 py-0.5 text-xs capitalize">
              {draft.review_status}
            </span>
          ) : null}
          {canRegenerate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRegenerate}
              disabled={regenerating || sending || disableSend}
              aria-label="Regenerate email"
              title="Regenerate from agent"
            >
              {regenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Regenerate
            </Button>
          )}
          {canSendNow && (
            <Button
              size="sm"
              variant="outline"
              onClick={onSendNow}
              disabled={sending || regenerating || disableSend}
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Send now
            </Button>
          )}
        </div>
      </div>
      <input
        type="text"
        value={edit.subject}
        onChange={(e) => onSubjectChange(e.target.value)}
        placeholder="Subject..."
        disabled={alreadyReviewed || regenerating}
        className="border-input bg-background focus-visible:ring-ring/50 mb-3 w-full rounded-md border px-3 py-2 text-base font-medium transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 disabled:opacity-60 md:text-sm"
      />
      <textarea
        ref={bodyRef}
        value={edit.bodyText}
        onChange={(e) => onBodyChange(e.target.value)}
        placeholder="Email body..."
        disabled={alreadyReviewed || regenerating}
        rows={4}
        className="border-input bg-background focus-visible:ring-ring/50 w-full resize-none overflow-hidden rounded-md border px-3 py-2 text-base leading-relaxed transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 disabled:opacity-60 md:text-sm"
      />
    </div>
  );
}
