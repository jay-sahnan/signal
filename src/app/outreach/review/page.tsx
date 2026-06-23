"use client";

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
import { toast } from "sonner";
import { ContactDetail } from "@/components/campaign/contact-detail";
import { Button } from "@/components/ui/button";
import { EditableEmail } from "@/components/ui/editable-email";
import { createClient } from "@/lib/supabase/client";
import type { CampaignContact, EnrichmentData } from "@/lib/types/campaign";

function htmlToPlain(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function plainToHtml(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

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
  person_work_email: string | null;
  person_work_email_confidence: number | null;
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

function emailConfidenceLabel(
  confidence: number | null,
): { label: string; tone: "verified" | "ok" | "guessed" } | null {
  if (confidence == null) return null;
  if (confidence >= 0.9) return { label: "verified", tone: "verified" };
  if (confidence >= 0.5) return { label: "likely", tone: "ok" };
  return { label: "guessed", tone: "guessed" };
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const sequenceId = searchParams.get("sequence");

  const [drafts, setDrafts] = useState<DraftForReview[]>([]);
  const [currentPersonIndex, setCurrentPersonIndex] = useState(0);
  const [loading, setLoading] = useState(!!sequenceId);
  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [enrichingPersonIds, setEnrichingPersonIds] = useState<Set<string>>(
    new Set(),
  );
  const [sendingDraftIds, setSendingDraftIds] = useState<Set<string>>(
    new Set(),
  );
  const [regeneratingDraftIds, setRegeneratingDraftIds] = useState<Set<string>>(
    new Set(),
  );

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!sequenceId) return;

    const load = async () => {
      const supabase = createClient();
      const [draftsRes, stepsRes] = await Promise.all([
        supabase
          .from("email_drafts")
          .select(
            `
          id, to_email, subject, body_html, body_text, ai_reasoning,
          review_status, status, sequence_step_id, enrollment_id, person_id,
          people(
            name, title, organization_id, enrichment_data,
            enrichment_status, last_enriched_at,
            work_email, work_email_confidence,
            personal_email, linkedin_url, twitter_url,
            organizations(name, domain, industry)
          ),
          campaign_people(priority_score),
          sequence_enrollments(current_step),
          sequence_steps(step_number, delay_days, delay_hours)
        `,
          )
          .eq("sequence_id", sequenceId)
          .eq("review_status", "pending")
          .order("person_id")
          .order("sequence_step_id"),
        supabase
          .from("sequence_steps")
          .select("id")
          .eq("sequence_id", sequenceId),
      ]);

      if (!mountedRef.current) return;

      const rawDrafts = draftsRes.data;
      const steps = stepsRes.data;
      const totalSteps = steps?.length ?? 1;

      const mapped: DraftForReview[] = (rawDrafts ?? []).map((d) => {
        const person = d.people as unknown as {
          name: string;
          title: string | null;
          organization_id: string | null;
          enrichment_data: EnrichmentData;
          enrichment_status: "pending" | "in_progress" | "enriched" | "failed";
          last_enriched_at: string | null;
          work_email: string | null;
          work_email_confidence: number | null;
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
          person_work_email: person?.work_email ?? null,
          person_work_email_confidence: person?.work_email_confidence ?? null,
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

      // Save edits for drafts whose subject or body changed
      const editPromises = currentDrafts.map(async (d) => {
        const edit = edits[d.id];
        if (!edit) return;
        const baseBody = d.body_text ?? htmlToPlain(d.body_html);
        const subjectChanged = edit.subject !== d.subject;
        const bodyChanged = edit.bodyText !== baseBody;
        if (!subjectChanged && !bodyChanged) return;
        await supabase
          .from("email_drafts")
          .update({
            subject: edit.subject,
            body_html: plainToHtml(edit.bodyText),
            body_text: edit.bodyText,
            updated_at: now,
          })
          .eq("id", d.id);
      });
      await Promise.all(editPromises);

      // Mark all pending drafts for this contact
      const pendingIds = currentDrafts
        .filter((d) => d.review_status === "pending")
        .map((d) => d.id);

      if (pendingIds.length > 0) {
        await supabase
          .from("email_drafts")
          .update({ review_status: action, updated_at: now })
          .in("id", pendingIds);
      }

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

      setSaving(false);
    },
    [
      currentContact,
      currentDrafts,
      currentPersonIndex,
      edits,
      personGroups,
      personIds,
      saving,
    ],
  );

  const handleEnrich = useCallback(
    async (contactId: string) => {
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
        const res = await fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId: personId }),
        });
        const result = await res.json();
        if (!res.ok) {
          toast.error(result.error ?? "Enrichment failed");
          setDrafts((prev) =>
            prev.map((d) =>
              d.person_id === personId
                ? { ...d, enrichment_status: "failed" }
                : d,
            ),
          );
          return;
        }

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
        toast.error(err instanceof Error ? err.message : "Enrichment failed");
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
    [enrichingPersonIds],
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
            const { error: editErr } = await supabase
              .from("email_drafts")
              .update({
                subject: edit.subject,
                body_html: plainToHtml(edit.bodyText),
                body_text: edit.bodyText,
                updated_at: now,
              })
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

        const res = await fetch("/api/outreach/send-now", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          toast.error(data.error ?? "Failed to send");
          setDrafts((prev) =>
            prev.map((d) =>
              d.id === draftId ? { ...d, review_status: "approved" } : d,
            ),
          );
          return;
        }

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
    [drafts, edits, sendingDraftIds],
  );

  const handleRegenerate = useCallback(
    async (draftId: string) => {
      if (regeneratingDraftIds.has(draftId)) return;
      const draft = drafts.find((d) => d.id === draftId);
      if (!draft) return;
      if (draft.review_status !== "pending" || draft.status !== "draft") {
        return;
      }

      setRegeneratingDraftIds((prev) => new Set(prev).add(draftId));

      try {
        const res = await fetch("/api/outreach/regenerate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          toast.error(data.error ?? "Failed to regenerate email");
          return;
        }

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

        toast.success("Email regenerated");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to regenerate",
        );
      } finally {
        setRegeneratingDraftIds((prev) => {
          const next = new Set(prev);
          next.delete(draftId);
          return next;
        });
      }
    },
    [drafts, regeneratingDraftIds],
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
      const { error: personErr } = await supabase
        .from("people")
        .update({ work_email: next, updated_at: now })
        .eq("id", personId);
      if (personErr) throw new Error(personErr.message);

      // Promote to user_entered source + recompute the org pattern. Fire-and-
      // forget so a slow recompute doesn't block the UI; the prior person
      // update already persisted the email.
      void fetch("/api/email/record-verified", {
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

  if (!sequenceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">No sequence specified.</p>
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
        <h2 className="text-xl font-bold">Review complete</h2>
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
    work_email: currentContact.person_work_email ?? currentContact.to_email,
    personal_email: currentContact.person_personal_email,
    work_email_verified_at: null,
    personal_email_verified_at: null,
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
    generated_email_subject: null,
    generated_email_body: null,
    email_generated_at: null,
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
              <h2 className="text-lg font-semibold">
                {currentContact.person_name}
              </h2>
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <span className="shrink-0">Email:</span>
                <EditableEmail
                  value={currentContact.to_email}
                  onSave={handleContactEmailEdit}
                />
                {(() => {
                  const chip = emailConfidenceLabel(
                    currentContact.person_work_email_confidence,
                  );
                  if (!chip) return null;
                  const toneClass =
                    chip.tone === "verified"
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : chip.tone === "ok"
                        ? "bg-muted text-muted-foreground"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
                  return (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${toneClass}`}
                      title={`Confidence: ${(currentContact.person_work_email_confidence! * 100).toFixed(0)}%`}
                    >
                      {chip.label}
                    </span>
                  );
                })()}
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
  const canSendNow =
    !alreadyReviewed &&
    !isSent &&
    draft.enrollment_current_step != null &&
    draft.step_number === draft.enrollment_current_step;
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
        <div className="flex items-center gap-2">
          <span className="bg-primary/10 text-primary inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
            {draft.step_number}
          </span>
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Step {draft.step_number} of {draft.total_steps}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isSent ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
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
