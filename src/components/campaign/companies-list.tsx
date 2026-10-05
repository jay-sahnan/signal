"use client";

import { Fragment, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { requestBulkEmailLookup } from "@/lib/billing/bulk-email-request";
import { requestCompanyEnrichment } from "@/lib/billing/company-enrichment-request";
import { requestContactEnrichment } from "@/lib/billing/contact-enrichment-request";
import { requestEmailLookup } from "@/lib/billing/email-lookup-request";
import { AFFILIATION_SEND_THRESHOLD } from "@/lib/affiliation-threshold";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Mail,
  Sparkles,
  UserSearch,
} from "lucide-react";
import { toast } from "sonner";

import { CompanyDetail } from "@/components/campaign/company-detail";
import { ContactDetail } from "@/components/campaign/contact-detail";
import { EmbeddedOrgChart } from "@/components/company/embedded-org-chart";
import { EnrichAllButton } from "@/components/company/enrich-all-button";
import { TogglePill } from "@/components/ui/toggle-pill";
import { ReadinessBadge } from "@/components/tracking/readiness-badge";
import { AffiliationBadge } from "@/components/ui/provenance-badge";
import { Button } from "@/components/ui/button";
import { EditableEmail } from "@/components/ui/editable-email";
import { ScoreBadge } from "@/components/ui/score-badge";
import { useCampaign } from "@/lib/campaign-context";
import { createClient } from "@/lib/supabase/client";
import {
  enrichmentStatusStyles,
  outreachStatusStyles,
  type EnrichmentStatus,
  type OutreachStatus,
} from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import type { CampaignCompany, CampaignContact } from "@/lib/types/campaign";
import { apiFetch } from "@/lib/api-fetch";

const ROW_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface CompaniesListProps {
  campaignId: string;
  companies: CampaignCompany[];
  contacts: CampaignContact[];
  highlightedIds?: Set<string>;
  onContactEnriched: (contactId: string, data: CampaignContact) => void;
  onCompanyEnriched: (
    companyId: string,
    enrichmentData: Record<string, unknown>,
  ) => void;
  onDataChanged: () => void;
}

const AFFILIATION_THRESHOLD = AFFILIATION_SEND_THRESHOLD;

function linkedInUrl(raw: string) {
  return raw.startsWith("http")
    ? raw
    : `https://linkedin.com/in/${raw.replace(/^\//, "")}`;
}

function faviconUrl(url: string) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
  } catch {
    return null;
  }
}

export function CompaniesList({
  campaignId,
  companies,
  contacts,
  highlightedIds,
  onCompanyEnriched,
  onDataChanged,
}: CompaniesListProps) {
  const { openAgentWith } = useCampaign();
  const { userId } = useAuth();
  const [expandedCompanyIds, setExpandedCompanyIds] = useState<Set<string>>(
    new Set(),
  );
  const [expandedContactIds, setExpandedContactIds] = useState<Set<string>>(
    new Set(),
  );
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [enrichingCompanyIds, setEnrichingCompanyIds] = useState<Set<string>>(
    new Set(),
  );
  const [findingContactsIds, setFindingContactsIds] = useState<Set<string>>(
    new Set(),
  );
  const [findingEmailIds, setFindingEmailIds] = useState<Set<string>>(
    new Set(),
  );
  const [findingEmailsCompanyIds, setFindingEmailsCompanyIds] = useState<
    Set<string>
  >(new Set());
  const [page, setPage] = useState(0);
  // Review-queue rows with a request in flight. The row holds its place and
  // both its buttons go disabled until the request resolves, because a confirm
  // is permanent and a row that moves on the click takes the buttons with it.
  const [reviewPendingIds, setReviewPendingIds] = useState<Set<string>>(
    new Set(),
  );
  // Rows the user has acted on successfully. Applied as soon as the response
  // lands, which is ahead of the refetch, so the table settles without a wait.
  const [confirmedContactIds, setConfirmedContactIds] = useState<Set<string>>(
    new Set(),
  );
  const [removedContactIds, setRemovedContactIds] = useState<Set<string>>(
    new Set(),
  );
  // Companies in this set use the org-chart view; everyone else defaults to
  // the flat list. Keeping this per-company so toggling one row doesn't reset
  // every other expanded row.
  const [chartModeCompanyIds, setChartModeCompanyIds] = useState<Set<string>>(
    new Set(),
  );
  const setCompanyView = (companyId: string, mode: "chart" | "table") => {
    setChartModeCompanyIds((prev) => {
      const next = new Set(prev);
      if (mode === "chart") next.add(companyId);
      else next.delete(companyId);
      return next;
    });
  };
  const pageSize = 10;

  const contactsByOrgId = new Map<string | null, CampaignContact[]>();
  for (const contact of contacts) {
    // "Not here" unlinks the person from the campaign, so drop the row once the
    // delete lands rather than leaving it sitting there until the refetch
    // returns.
    if (removedContactIds.has(contact.id)) continue;
    const key = contact.organization_id;
    if (!contactsByOrgId.has(key)) contactsByOrgId.set(key, []);
    contactsByOrgId.get(key)!.push(contact);
  }

  const unassignedContacts = contactsByOrgId.get(null) ?? [];

  const companiesWithLeads = companies.filter(
    (c) => (contactsByOrgId.get(c.organization_id)?.length ?? 0) > 0,
  );
  const companiesWithoutLeads = companies.filter(
    (c) => (contactsByOrgId.get(c.organization_id)?.length ?? 0) === 0,
  );

  const toggleCompany = (id: string) => {
    setExpandedCompanyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleContact = (id: string) => {
    setExpandedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enrichContact = async (
    contactId: string,
  ): Promise<void> => {
    setEnrichingIds((prev) => new Set(prev).add(contactId));
    try {
      const personId =
        contacts.find((c) => c.id === contactId)?.person_id ?? contactId;
      await requestContactEnrichment(userId, personId);
      // Deliberately does NOT expand the row. Enriching is something you do to
      // a list, often several in a row, and force-opening each one shoves
      // everything below it down the page mid-scan. The data updates in place;
      // the row opens when the user asks it to.
      onDataChanged();
    } catch (err) {
      console.error(`[enrich] Failed:`, err);
      toast.error(err instanceof Error ? err.message : "Enrichment failed", {
        description:
          "Use the enrichment button to retry the same request. Credits may remain reserved while its outcome is unresolved.",
      });
    } finally {
      setEnrichingIds((prev) => {
        const next = new Set(prev);
        next.delete(contactId);
        return next;
      });
    }
  };

  const enrichCompanyHandler = async (companyId: string) => {
    setEnrichingCompanyIds((prev) => new Set(prev).add(companyId));
    try {
      const data = await requestCompanyEnrichment(
        userId,
        companyId,
        campaignId,
      );
      if (data.enrichmentData) {
        onCompanyEnriched(companyId, data.enrichmentData);
        setExpandedCompanyIds((prev) => new Set(prev).add(companyId));
      }
      onDataChanged();
    } catch (err) {
      console.error(`[enrich-company] Failed:`, err);
      toast.error(
        err instanceof Error ? err.message : "Company research failed",
        {
          description:
            "Use the research button to retry the same request. Credits may remain reserved while its outcome is unresolved.",
        },
      );
    } finally {
      setEnrichingCompanyIds((prev) => {
        const next = new Set(prev);
        next.delete(companyId);
        return next;
      });
    }
  };

  const findContactsHandler = async (companyId: string) => {
    setFindingContactsIds((prev) => new Set(prev).add(companyId));
    try {
      const res = await apiFetch("/api/find-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, campaignId }),
      });
      // This used to await the call and ignore everything it returned. apiFetch
      // does not throw on a non-2xx, so the catch below never fired either: a
      // 403, a refusal and a successful run all looked identical from here,
      // which is to say they all looked like nothing happening.
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json().catch(() => null)) as {
        contacts?: unknown[];
        totalFound?: number;
        uncertainCount?: number;
        rejectedAsWrongCompany?: number;
        error?: string;
      } | null;

      onDataChanged();

      // A refusal (most often: the company has no domain on record, so
      // contacts cannot be told apart from another company of the same name)
      // comes back 200 with an explanation. It is the normal outcome for a
      // directory-sourced company, and swallowing it is what left the user
      // staring at an empty campaign with nothing to act on. Worded as the
      // "Find more people" button words it, deliberately: two buttons over one
      // service must not describe it two ways.
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const added = data?.contacts?.length ?? 0;
      if (added === 0) {
        toast.info("No new people found.");
        return;
      }
      const notes = [];
      if (data?.uncertainCount)
        notes.push(`${data.uncertainCount} unconfirmed, blocked from outreach`);
      if (data?.rejectedAsWrongCompany)
        notes.push(`${data.rejectedAsWrongCompany} work elsewhere`);
      toast.success(
        `Found ${added} ${added === 1 ? "person" : "people"}.` +
          (notes.length ? ` ${notes.join(", ")}.` : ""),
      );
    } catch (err) {
      console.error(`[find-contacts] Failed:`, err);
      toast.error(err instanceof Error ? err.message : "Failed to find leads.");
    } finally {
      setFindingContactsIds((prev) => {
        const next = new Set(prev);
        next.delete(companyId);
        return next;
      });
    }
  };

  const findEmailForContact = async (
    contact: CampaignContact,
  ) => {
    setFindingEmailIds((prev) => new Set(prev).add(contact.id));
    try {
      await requestEmailLookup(userId, contact.person_id);
      onDataChanged();
    } catch (err) {
      console.error(`[find-email] Failed:`, err);
      toast.error(err instanceof Error ? err.message : "Email lookup failed.", {
        description:
          "Use the email lookup button to retry the same request. Credits may remain reserved while its outcome is unresolved.",
      });
    } finally {
      setFindingEmailIds((prev) => {
        const next = new Set(prev);
        next.delete(contact.id);
        return next;
      });
    }
  };

  const findEmailsForCompany = async (
    organizationId: string | null,
  ) => {
    if (!organizationId) return;
    setFindingEmailsCompanyIds((prev) => new Set(prev).add(organizationId));
    try {
      const personIds = contacts
        .filter(
          (c) =>
            c.organization_id === organizationId &&
            !c.work_email &&
            (c.affiliation_confidence ?? 0) >= AFFILIATION_THRESHOLD,
        )
        .map((c) => c.person_id);
      const data = await requestBulkEmailLookup(
        userId,
        campaignId,
        organizationId,
        personIds,
      );
      const found = data?.found?.length ?? 0;
      const skipped = data?.skipped ?? 0;
      const remaining = data?.remaining ?? 0;
      toast.success(
        data?.summary ??
          `Found ${found} ${found === 1 ? "email" : "emails"}.` +
            (remaining > 0 ? ` ${remaining} more pending, click again.` : "") +
            (skipped > 0
              ? ` ${skipped} skipped, not confirmed at this company.`
              : ""),
      );
      onDataChanged();
    } catch (err) {
      console.error(`[find-email/bulk] Failed:`, err);
      toast.error(
        err instanceof Error ? err.message : "Failed to find emails",
        {
          description:
            "Use the batch button to retry the same batch. Credits may remain reserved while its outcome is unresolved.",
        },
      );
    } finally {
      setFindingEmailsCompanyIds((prev) => {
        const next = new Set(prev);
        next.delete(organizationId);
        return next;
      });
    }
  };

  const markPending = (contactId: string, pending: boolean) => {
    setReviewPendingIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(contactId);
      else next.delete(contactId);
      return next;
    });
  };

  /**
   * Record the user's own judgement that this person works here.
   *
   * Writes `user_entered` at confidence 1.0, which outranks every machine
   * source, so nothing we learn later can move them back out. That is the
   * point (it is the manual escape hatch when the evidence cannot settle it)
   * and also why the button says so.
   *
   * The row stays exactly where it is until the request resolves. Moving it on
   * the click looked like the responsive choice, but it took the buttons with
   * it and pulled the next person up under a stationary cursor, so the second
   * half of a double-click confirmed somebody else, permanently.
   */
  const confirmAffiliation = async (
    contact: CampaignContact,
    organizationId: string,
  ) => {
    if (reviewPendingIds.has(contact.id)) return;
    markPending(contact.id, true);
    try {
      const res = await apiFetch(
        `/api/people/${contact.person_id}/to-company`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId, campaignId }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      // Applied here rather than up front so the table only moves once we know
      // the write landed. There is nothing to roll back on failure.
      setConfirmedContactIds((prev) => new Set(prev).add(contact.id));
      toast.success(`Confirmed ${contact.name} works here.`);
      onDataChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      markPending(contact.id, false);
    }
  };

  /**
   * Record the user's judgement that this person does NOT work here, and drop
   * them from the campaign.
   *
   * Names the company the row was drawn under rather than letting the endpoint
   * read it off the person. The two can disagree: the tab may have been open a
   * while, and `people` is a shared pool, so someone else may have moved this
   * person since. A rejection aimed at a company they are no longer filed under
   * is refused rather than applied to whichever company they are at now.
   */
  const detachContact = async (
    contact: CampaignContact,
    organizationId: string,
  ) => {
    if (reviewPendingIds.has(contact.id)) return;
    markPending(contact.id, true);
    try {
      const res = await apiFetch(
        `/api/people/${contact.person_id}/from-company?campaignId=${encodeURIComponent(campaignId)}&organizationId=${encodeURIComponent(organizationId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      // Same as Confirm: drop the row once the delete is known to have landed,
      // not before, so a failed request never has to put it back and the row
      // under the cursor is still the one the user was looking at.
      setRemovedContactIds((prev) => new Set(prev).add(contact.id));
      toast.success(`Removed ${contact.name} from this company.`);
      onDataChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      markPending(contact.id, false);
    }
  };

  const isCompanyEnriched = (company: CampaignCompany) => {
    const data = company.enrichment_data;
    return data && "enrichedAt" in data;
  };

  const updateContactEmail = async (contact: CampaignContact, next: string) => {
    const supabase = createClient();
    const field: "work_email" | "personal_email" =
      contact.work_email || !contact.personal_email
        ? "work_email"
        : "personal_email";
    const oldEmail = contact[field];
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("people")
      .update({ [field]: next || null, updated_at: now })
      .eq("id", contact.person_id);
    if (error) throw new Error(error.message);

    if (oldEmail) {
      // Surfaced, not fire-and-forget: a silently failed retarget leaves
      // pending drafts addressed to the old email, and the send gate then
      // refuses them with "regenerate the draft" for an address the user
      // believes they already fixed.
      const { error: draftsError } = await supabase
        .from("email_drafts")
        .update({ to_email: next, updated_at: now })
        .eq("person_id", contact.person_id)
        .eq("status", "draft")
        .eq("to_email", oldEmail);
      if (draftsError)
        throw new Error(
          `Saved the contact, but pending drafts still use ${oldEmail}: ${draftsError.message}`,
        );
    }

    onDataChanged();
  };

  if (companies.length === 0 && unassignedContacts.length === 0) {
    return (
      <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
        <div className="space-y-1">
          <p className="text-sm font-medium">No companies in this campaign</p>
          <p className="text-muted-foreground text-xs">
            Ask the agent to find companies that match your ICP.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() =>
            openAgentWith(
              "Find companies that match this campaign's ICP. Add the best 20 to the campaign.",
            )
          }
        >
          Find companies with the agent
        </Button>
      </div>
    );
  }

  const totalPages = Math.ceil(companiesWithLeads.length / pageSize);
  // Clamped at render: when the list shrinks (a lead removed, a refetch),
  // the stored index can point past the last page, which rendered a phantom
  // empty page ("11-10 of 10 companies") recoverable only by noticing the
  // Previous arrow.
  const clampedPage = Math.min(page, Math.max(0, totalPages - 1));
  const paginatedCompanies = companiesWithLeads.slice(
    clampedPage * pageSize,
    (clampedPage + 1) * pageSize,
  );

  const hasOtherRegions =
    companiesWithoutLeads.length > 0 || unassignedContacts.length > 0;

  return (
    <div className="space-y-6">
      {companiesWithLeads.length > 0 && (
        <section className="space-y-3">
          {hasOtherRegions && (
            <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Companies with leads ({companiesWithLeads.length})
            </h3>
          )}
          <div className="space-y-3">
            {paginatedCompanies.map((company) => {
              const isExpanded = expandedCompanyIds.has(company.id);
              const companyContacts =
                contactsByOrgId.get(company.organization_id) ?? [];
              const refreshBefore = Date.now() - 7 * 24 * 60 * 60 * 1000;
              const pendingEnrichment = companyContacts.filter((contact) => {
                if (contact.enrichment_status !== "enriched") return true;
                const stamp = contact.enrichment_data?.enrichedAt ?? contact.last_enriched_at;
                const at = stamp ? new Date(stamp).getTime() : NaN;
                return !Number.isFinite(at) || at <= refreshBefore;
              });
              let enrichedCount = 0;
              let missingEmailCount = 0;
              let scoredCount = 0;
              let topScore: number | null = null;
              for (const c of companyContacts) {
                if (c.enrichment_status === "enriched") enrichedCount++;
                if (!c.work_email) missingEmailCount++;
                if (c.priority_score != null && c.priority_score > 0) {
                  scoredCount++;
                  if (topScore === null || c.priority_score > topScore) {
                    topScore = c.priority_score;
                  }
                }
              }
              const favicon = company.url ? faviconUrl(company.url) : null;
              const isHighlighted = highlightedIds?.has(company.id);

              return (
                <div
                  key={company.id}
                  className={cn(
                    "border-border overflow-hidden rounded-lg border",
                    isHighlighted && "ring-primary/40 ring-2",
                  )}
                >
                  <div className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => toggleCompany(company.id)}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${company.name}`}
                      className={cn(
                        "hover:bg-muted/30 flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors",
                        ROW_FOCUS,
                      )}
                    >
                      <ChevronRight
                        className={cn(
                          "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
                          isExpanded && "rotate-90",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {favicon && (
                            <Image
                              src={favicon}
                              alt=""
                              width={14}
                              height={14}
                              unoptimized
                              className="shrink-0 rounded-sm"
                            />
                          )}
                          <span className="truncate font-medium">
                            {company.name}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
                          {company.industry && <span>{company.industry}</span>}
                          {company.industry && company.location && (
                            <span className="text-muted-foreground/40">·</span>
                          )}
                          {company.location && <span>{company.location}</span>}
                          {(company.industry || company.location) &&
                            companyContacts.length > 0 && (
                              <span className="text-muted-foreground/40">
                                ·
                              </span>
                            )}
                          {companyContacts.length > 0 && (
                            <span>
                              {companyContacts.length}{" "}
                              {companyContacts.length === 1 ? "lead" : "leads"}
                              {enrichedCount > 0 &&
                                ` (${enrichedCount} enriched)`}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2 pr-4">
                      {topScore != null && (
                        <ScoreBadge
                          score={topScore}
                          variant="inline"
                          label="Top:"
                          className="text-xs"
                        />
                      )}
                      {company.readiness_tag && (
                        <ReadinessBadge tag={company.readiness_tag} />
                      )}
                      {company.url && (
                        <a
                          href={company.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Visit ${company.name} website`}
                          className={cn(
                            "text-muted-foreground hover:text-foreground rounded p-1 transition-colors",
                            ROW_FOCUS,
                          )}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {!isCompanyEnriched(company) &&
                        !enrichingCompanyIds.has(company.id) && (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => enrichCompanyHandler(company.id)}
                            title="Company research and new contact discovery use credits."
                          >
                            Enrich
                          </Button>
                        )}
                      {enrichingCompanyIds.has(company.id) && (
                        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Enriching
                        </span>
                      )}
                      {company.organization_id && (
                        <EnrichAllButton
                          personIds={pendingEnrichment.map((c) => c.person_id)}
                          campaignId={campaignId}
                          organizationId={company.organization_id}
                          // Only what is actually left to do, so the number on
                          // the button matches what the confirm will charge for.
                          unenrichedCount={pendingEnrichment.length}
                          onDone={onDataChanged}
                        />
                      )}
                      {missingEmailCount > 0 &&
                        company.organization_id &&
                        !findingEmailsCompanyIds.has(
                          company.organization_id,
                        ) && (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              findEmailsForCompany(company.organization_id)
                            }
                            title={`Find emails for ${missingEmailCount} contact${missingEmailCount === 1 ? "" : "s"}`}
                          >
                            <Mail className="h-3 w-3" />
                            Find emails ({missingEmailCount})
                          </Button>
                        )}
                      {company.organization_id &&
                        findingEmailsCompanyIds.has(
                          company.organization_id,
                        ) && (
                          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Finding
                          </span>
                        )}
                      <ScoreBadge score={company.relevance_score} />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-border border-t">
                      <CompanyDetail
                        company={company}
                        onRefresh={enrichCompanyHandler}
                        isRefreshing={enrichingCompanyIds.has(company.id)}
                      />

                      <>
                        {(() => {
                          // A company with no organization id has no chart to
                          // show, so it stays on the list whatever is stored.
                          const chartMode =
                            chartModeCompanyIds.has(company.id) &&
                            !!company.organization_id;
                          return (
                            <div className="border-border flex items-center justify-end gap-1.5 border-t px-4 py-2">
                              <span className="text-muted-foreground mr-1 text-xs">
                                View:
                              </span>
                              <TogglePill
                                active={chartMode}
                                onClick={() =>
                                  setCompanyView(company.id, "chart")
                                }
                                disabled={!company.organization_id}
                                title={
                                  company.organization_id
                                    ? "Org chart"
                                    : "Chart unavailable: company has no organization id"
                                }
                              >
                                Org chart
                              </TogglePill>
                              <TogglePill
                                active={!chartMode}
                                onClick={() =>
                                  setCompanyView(company.id, "table")
                                }
                              >
                                List
                              </TogglePill>
                            </div>
                          );
                        })()}

                        {chartModeCompanyIds.has(company.id) &&
                        company.organization_id ? (
                          <EmbeddedOrgChart
                            organizationId={company.organization_id}
                            campaignId={campaignId}
                            contacts={companyContacts}
                            onEnrich={enrichContact}
                            onDataChanged={onDataChanged}
                          />
                        ) : (
                          <ContactsTable
                            contacts={companyContacts}
                            expandedContactIds={expandedContactIds}
                            highlightedIds={highlightedIds}
                            enrichingIds={enrichingIds}
                            findingEmailIds={findingEmailIds}
                            onToggle={toggleContact}
                            onEnrich={enrichContact}
                            onFindEmail={findEmailForContact}
                            onEmailEdit={updateContactEmail}
                            columnSpan={7}
                            showOutreach
                            review={
                              company.organization_id
                                ? {
                                    organizationId: company.organization_id,
                                    pendingIds: reviewPendingIds,
                                    confirmedIds: confirmedContactIds,
                                    onConfirm: confirmAffiliation,
                                    onNotHere: detachContact,
                                  }
                                : undefined
                            }
                          />
                        )}
                      </>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-muted-foreground text-xs tabular-nums">
                {clampedPage * pageSize + 1}&ndash;
                {Math.min(
                  (clampedPage + 1) * pageSize,
                  companiesWithLeads.length,
                )}{" "}
                of {companiesWithLeads.length} companies
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Previous page"
                  onClick={() => setPage(Math.max(0, clampedPage - 1))}
                  disabled={clampedPage === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span
                  className="text-muted-foreground min-w-[4rem] text-center text-xs tabular-nums"
                  aria-current="page"
                  aria-label={`Page ${clampedPage + 1} of ${totalPages}`}
                >
                  {clampedPage + 1} / {totalPages}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Next page"
                  onClick={() =>
                    setPage(Math.min(totalPages - 1, clampedPage + 1))
                  }
                  disabled={clampedPage >= totalPages - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {companiesWithoutLeads.length > 0 && (
        <CompaniesWithoutLeads
          companies={companiesWithoutLeads}
          expandedCompanyIds={expandedCompanyIds}
          enrichingCompanyIds={enrichingCompanyIds}
          findingContactsIds={findingContactsIds}
          onToggle={toggleCompany}
          onEnrich={enrichCompanyHandler}
          onFindContacts={findContactsHandler}
          onDataChanged={onDataChanged}
          isCompanyEnriched={isCompanyEnriched}
        />
      )}

      {unassignedContacts.length > 0 && (
        <UnassignedContacts
          contacts={unassignedContacts}
          expandedCompanyIds={expandedCompanyIds}
          expandedContactIds={expandedContactIds}
          highlightedIds={highlightedIds}
          enrichingIds={enrichingIds}
          findingEmailIds={findingEmailIds}
          onToggleSection={toggleCompany}
          onToggleContact={toggleContact}
          onEnrich={enrichContact}
          onFindEmail={findEmailForContact}
          onEmailEdit={updateContactEmail}
        />
      )}
    </div>
  );
}

/**
 * Turns the table into a review queue: contacts we cannot place at the company
 * are grouped separately and get Confirm / Not here buttons. Left undefined for
 * the unassigned-leads table, where there is no company to confirm them at.
 */
interface ContactsReview {
  /** The company the Confirm button attaches them to. */
  organizationId: string;
  /** Rows with a request in flight. */
  pendingIds: Set<string>;
  /** Rows confirmed in this session, before the refetch lands. */
  confirmedIds: Set<string>;
  onConfirm: (contact: CampaignContact, organizationId: string) => void;
  onNotHere: (contact: CampaignContact, organizationId: string) => void;
}

interface ContactsTableProps {
  contacts: CampaignContact[];
  expandedContactIds: Set<string>;
  highlightedIds?: Set<string>;
  enrichingIds: Set<string>;
  findingEmailIds: Set<string>;
  onToggle: (id: string) => void;
  onEnrich: (id: string) => void;
  onFindEmail: (contact: CampaignContact) => void | Promise<void>;
  onEmailEdit: (contact: CampaignContact, next: string) => Promise<void>;
  columnSpan: number;
  showOutreach: boolean;
  review?: ContactsReview;
}

function ContactsTable({
  contacts,
  expandedContactIds,
  highlightedIds,
  enrichingIds,
  findingEmailIds,
  onToggle,
  onEnrich,
  onFindEmail,
  onEmailEdit,
  columnSpan,
  showOutreach,
  review,
}: ContactsTableProps) {
  // One table, two groups, not two tables. The columns, the expand row and the
  // email editor are all shared, and duplicating them is how the two contact
  // tables in this codebase drifted apart in the first place.
  const groups: Array<{
    key: string;
    label: string | null;
    rows: CampaignContact[];
    needsReview: boolean;
  }> = [];

  if (!review) {
    groups.push({
      key: "all",
      label: null,
      rows: contacts,
      needsReview: false,
    });
  } else {
    const confirmed: CampaignContact[] = [];
    const needsReview: CampaignContact[] = [];
    for (const contact of contacts) {
      const confidence = review.confirmedIds.has(contact.id)
        ? 1
        : (contact.affiliation_confidence ?? 0);
      if (confidence >= AFFILIATION_THRESHOLD) confirmed.push(contact);
      else needsReview.push(contact);
    }
    // An empty group gets no header. The needs-review tail is normally two or
    // three people, and often nobody at all.
    if (confirmed.length > 0) {
      groups.push({
        key: "confirmed",
        label: `Confirmed (${confirmed.length})`,
        rows: confirmed,
        needsReview: false,
      });
    }
    if (needsReview.length > 0) {
      groups.push({
        key: "needs-review",
        label: `Needs review (${needsReview.length})`,
        rows: needsReview,
        needsReview: true,
      });
    }
  }

  return (
    <table className="border-border w-full border-t text-sm">
      <thead>
        <tr className="bg-muted/30">
          <th className="w-8 px-3 py-2" />
          <th className="px-3 py-2 text-left text-xs font-medium">Name</th>
          <th className="hidden px-3 py-2 text-left text-xs font-medium sm:table-cell">
            Title
          </th>
          <th className="hidden px-3 py-2 text-left text-xs font-medium md:table-cell">
            Email
          </th>
          <th className="px-3 py-2 text-left text-xs font-medium">
            Enrichment
          </th>
          {showOutreach && (
            <>
              <th className="hidden px-3 py-2 text-center text-xs font-medium sm:table-cell">
                Priority
              </th>
              <th className="hidden px-3 py-2 text-left text-xs font-medium md:table-cell">
                Outreach
              </th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <Fragment key={group.key}>
            {group.label && (
              <tr className="bg-muted/30 border-border border-t">
                <td
                  colSpan={columnSpan}
                  className="text-muted-foreground px-3 py-1.5 text-xs font-medium uppercase tracking-wide"
                >
                  {group.label}
                </td>
              </tr>
            )}
            {group.rows.map((contact) => {
              const isContactExpanded = expandedContactIds.has(contact.id);
              const enrichment =
                enrichmentStatusStyles[
                  contact.enrichment_status as EnrichmentStatus
                ] ?? enrichmentStatusStyles.pending;
              const isContactHighlighted = highlightedIds?.has(contact.id);

              return (
                <Fragment key={contact.id}>
                  <tr
                    className={cn(
                      "border-border hover:bg-muted/30 border-t transition-colors",
                      isContactHighlighted && "bg-primary/5",
                    )}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onToggle(contact.id)}
                        aria-expanded={isContactExpanded}
                        aria-label={`${isContactExpanded ? "Collapse" : "Expand"} ${contact.name}`}
                        className={cn(
                          "hover:bg-muted/50 rounded p-0.5 transition-colors",
                          ROW_FOCUS,
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            "text-muted-foreground h-3.5 w-3.5 transition-transform",
                            isContactExpanded && "rotate-90",
                          )}
                        />
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{contact.name}</span>
                        {contact.linkedin_url && (
                          <a
                            href={linkedInUrl(contact.linkedin_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${contact.name} on LinkedIn`}
                            className={cn(
                              "text-muted-foreground hover:text-foreground rounded",
                              ROW_FOCUS,
                            )}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {/* Renders only below the threshold, so the confirmed
                            group stays quiet. Its tooltip carries the evidence
                            the review decision rests on. */}
                        <AffiliationBadge person={contact} />
                      </div>
                    </td>
                    <td className="text-muted-foreground hidden px-3 py-2 sm:table-cell">
                      {contact.title || "--"}
                    </td>
                    <td className="text-muted-foreground hidden px-3 py-2 md:table-cell">
                      <EditableEmail
                        value={contact.work_email || contact.personal_email}
                        onSave={(next) => onEmailEdit(contact, next)}
                        allowEmpty
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="inline-flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              enrichment.className,
                            )}
                          />
                          {enrichment.label}
                        </span>
                        {(contact.enrichment_status === "pending" ||
                          contact.enrichment_status === "failed") &&
                          !enrichingIds.has(contact.id) && (
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Enrich contact"
                              onClick={() => onEnrich(contact.id)}
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        {enrichingIds.has(contact.id) && (
                          <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
                        )}
                        {!contact.work_email &&
                          !findingEmailIds.has(contact.id) && (
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Find email for ${contact.name}`}
                              title="Find email"
                              onClick={() => onFindEmail(contact)}
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        {findingEmailIds.has(contact.id) && (
                          <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
                        )}
                        {review && group.needsReview && (
                          // Both buttons stay mounted and go disabled for the
                          // duration of the request. Swapping them for a
                          // spinner moved the rows below up under the cursor,
                          // and a confirm is permanent.
                          <>
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={review.pendingIds.has(contact.id)}
                              title={`Record that ${contact.name} works here. Your word outranks every later check, so this cannot be undone by new evidence.`}
                              onClick={() =>
                                review.onConfirm(contact, review.organizationId)
                              }
                            >
                              Confirm employer
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={review.pendingIds.has(contact.id)}
                              title={`Remove ${contact.name} from this company and this campaign. You can add them back later.`}
                              onClick={() =>
                                review.onNotHere(contact, review.organizationId)
                              }
                            >
                              Not here
                            </Button>
                            {review.pendingIds.has(contact.id) && (
                              <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    {showOutreach && (
                      <>
                        <td className="hidden px-3 py-2 text-center sm:table-cell">
                          <ScoreBadge score={contact.priority_score} />
                        </td>
                        <td className="hidden px-3 py-2 md:table-cell">
                          {contact.outreach_status &&
                            contact.outreach_status !== "not_contacted" &&
                            outreachStatusStyles[
                              contact.outreach_status as OutreachStatus
                            ] && (
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                                  outreachStatusStyles[
                                    contact.outreach_status as OutreachStatus
                                  ].className,
                                )}
                              >
                                {
                                  outreachStatusStyles[
                                    contact.outreach_status as OutreachStatus
                                  ].label
                                }
                              </span>
                            )}
                        </td>
                      </>
                    )}
                  </tr>
                  {isContactExpanded && (
                    <tr className="border-border border-t">
                      <td colSpan={columnSpan} className="bg-muted/30 px-4">
                        <ContactDetail contact={contact} onRetry={onEnrich} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The way out of a dead end: a company with no website cannot hold contacts,
 * and until the website route existed there was no way to give it one. The
 * domain is written when the company is created and never again, so a company
 * that arrived from a directory listing with no site was stuck there for good.
 */
function MissingWebsite({
  company,
  onSaved,
}: {
  company: CampaignCompany;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (payload: { url?: string; resolve?: boolean }) => {
    if (!company.organization_id) return;
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/companies/${company.organization_id}/website`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        domain?: string;
        merged?: boolean;
        message?: string;
        error?: string;
      } | null;
      if (!res.ok || data?.error) {
        // "No website could be found" comes back as a 200 with an error, since
        // having no site is an ordinary fact about a small business rather
        // than a failed request.
        toast.error(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      // A merge removes the row the user was looking at, so saying only
      // "saved" would leave them hunting for a company that is now filed under
      // its twin.
      toast.success(
        data?.merged
          ? (data.message ?? `Merged into the existing ${data.domain} record.`)
          : `Saved ${data?.domain}. You can find leads now.`,
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 space-y-1">
      <p className="text-muted-foreground text-xs">
        No website on record, so contacts cannot be attached to this company.
      </p>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) save({ url: value.trim() });
          }}
          placeholder="company.co.uk"
          aria-label={`Website for ${company.name}`}
          className={cn(
            "border-border bg-background h-6 w-40 rounded border px-1.5 text-xs",
            ROW_FOCUS,
          )}
        />
        <Button
          size="xs"
          variant="outline"
          disabled={busy || !value.trim()}
          aria-label={`Save website for ${company.name}`}
          onClick={() => save({ url: value.trim() })}
        >
          Save
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          aria-label={`Find website for ${company.name}`}
          onClick={() => save({ resolve: true })}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          Find it
        </Button>
      </div>
    </div>
  );
}

interface CompaniesWithoutLeadsProps {
  companies: CampaignCompany[];
  expandedCompanyIds: Set<string>;
  enrichingCompanyIds: Set<string>;
  findingContactsIds: Set<string>;
  onToggle: (id: string) => void;
  onEnrich: (id: string) => void;
  onFindContacts: (id: string) => void;
  onDataChanged: () => void;
  isCompanyEnriched: (company: CampaignCompany) => boolean | "" | undefined;
}

function CompaniesWithoutLeads({
  companies,
  expandedCompanyIds,
  enrichingCompanyIds,
  findingContactsIds,
  onToggle,
  onEnrich,
  onFindContacts,
  onDataChanged,
  isCompanyEnriched,
}: CompaniesWithoutLeadsProps) {
  const isOpen = expandedCompanyIds.has("__no_leads__");
  return (
    <section className="space-y-3">
      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        Companies without leads ({companies.length})
      </h3>
      <div className="border-border overflow-hidden rounded-lg border">
        <button
          type="button"
          onClick={() => onToggle("__no_leads__")}
          aria-expanded={isOpen}
          aria-label={
            isOpen
              ? "Collapse companies without leads"
              : "Expand companies without leads"
          }
          className={cn(
            "hover:bg-muted/30 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
            ROW_FOCUS,
          )}
        >
          <ChevronRight
            className={cn(
              "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
              isOpen && "rotate-90",
            )}
          />
          <span className="text-sm font-medium">
            {companies.length}{" "}
            {companies.length === 1 ? "company" : "companies"}
          </span>
        </button>
        {isOpen && (
          <div className="border-border border-t">
            {companies.map((company) => {
              const favicon = company.url ? faviconUrl(company.url) : null;
              return (
                <div
                  key={company.id}
                  className="border-border flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {favicon && (
                        <Image
                          src={favicon}
                          alt=""
                          width={14}
                          height={14}
                          unoptimized
                          className="shrink-0 rounded-sm"
                        />
                      )}
                      <span className="truncate text-sm font-medium">
                        {company.name}
                      </span>
                      {company.url && (
                        <a
                          href={company.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Visit ${company.name} website`}
                          className={cn(
                            "text-muted-foreground hover:text-foreground rounded p-0.5",
                            ROW_FOCUS,
                          )}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {company.industry && (
                      <span className="text-muted-foreground text-xs">
                        {company.industry}
                      </span>
                    )}
                    {!company.domain && (
                      <MissingWebsite
                        company={company}
                        onSaved={onDataChanged}
                      />
                    )}
                  </div>
                  {company.domain &&
                    (findingContactsIds.has(company.id) ? (
                      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Searching
                      </span>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        aria-label={`Find leads for ${company.name}`}
                        onClick={() => onFindContacts(company.id)}
                      >
                        <UserSearch className="h-3 w-3" />
                        Find leads
                      </Button>
                    ))}
                  {enrichingCompanyIds.has(company.id) ? (
                    <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Enriching
                    </span>
                  ) : !isCompanyEnriched(company) ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onEnrich(company.id)}
                      title="Company research and new contact discovery use credits."
                    >
                      Enrich
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

interface UnassignedContactsProps {
  contacts: CampaignContact[];
  expandedCompanyIds: Set<string>;
  expandedContactIds: Set<string>;
  highlightedIds?: Set<string>;
  enrichingIds: Set<string>;
  findingEmailIds: Set<string>;
  onToggleSection: (id: string) => void;
  onToggleContact: (id: string) => void;
  onEnrich: (id: string) => void;
  onFindEmail: (contact: CampaignContact) => void | Promise<void>;
  onEmailEdit: (contact: CampaignContact, next: string) => Promise<void>;
}

function UnassignedContacts({
  contacts,
  expandedCompanyIds,
  expandedContactIds,
  highlightedIds,
  enrichingIds,
  findingEmailIds,
  onToggleSection,
  onToggleContact,
  onEnrich,
  onFindEmail,
  onEmailEdit,
}: UnassignedContactsProps) {
  const isOpen = expandedCompanyIds.has("__unassigned__");
  return (
    <section className="space-y-3">
      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        Unassigned leads ({contacts.length})
      </h3>
      <div className="border-border overflow-hidden rounded-lg border">
        <button
          type="button"
          onClick={() => onToggleSection("__unassigned__")}
          aria-expanded={isOpen}
          aria-label={
            isOpen ? "Collapse unassigned leads" : "Expand unassigned leads"
          }
          className={cn(
            "hover:bg-muted/30 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
            ROW_FOCUS,
          )}
        >
          <ChevronRight
            className={cn(
              "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
              isOpen && "rotate-90",
            )}
          />
          <span className="text-sm font-medium">
            {contacts.length} {contacts.length === 1 ? "lead" : "leads"}
          </span>
        </button>
        {isOpen && (
          <div className="border-border border-t">
            <ContactsTable
              contacts={contacts}
              expandedContactIds={expandedContactIds}
              highlightedIds={highlightedIds}
              enrichingIds={enrichingIds}
              findingEmailIds={findingEmailIds}
              onToggle={onToggleContact}
              onEnrich={onEnrich}
              onFindEmail={onFindEmail}
              onEmailEdit={onEmailEdit}
              columnSpan={5}
              showOutreach={false}
            />
          </div>
        )}
      </div>
    </section>
  );
}
