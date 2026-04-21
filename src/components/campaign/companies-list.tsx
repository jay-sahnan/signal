"use client";

import { Fragment, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Sparkles,
  UserSearch,
} from "lucide-react";

import { CompanyDetail } from "@/components/campaign/company-detail";
import { ContactDetail } from "@/components/campaign/contact-detail";
import { ReadinessBadge } from "@/components/tracking/readiness-badge";
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
  const [page, setPage] = useState(0);
  const pageSize = 10;

  const contactsByOrgId = new Map<string | null, CampaignContact[]>();
  for (const contact of contacts) {
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

  const enrichContact = async (contactId: string) => {
    setEnrichingIds((prev) => new Set(prev).add(contactId));
    try {
      await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      onDataChanged();
      setExpandedContactIds((prev) => new Set(prev).add(contactId));
    } catch (err) {
      console.error(`[enrich] Failed:`, err);
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
      const res = await fetch("/api/enrich-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, campaignId }),
      });
      const data = await res.json();
      if (data.enrichmentData) {
        onCompanyEnriched(companyId, data.enrichmentData);
        setExpandedCompanyIds((prev) => new Set(prev).add(companyId));
      }
      onDataChanged();
    } catch (err) {
      console.error(`[enrich-company] Failed:`, err);
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
      await fetch("/api/find-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, campaignId }),
      });
      onDataChanged();
    } catch (err) {
      console.error(`[find-contacts] Failed:`, err);
    } finally {
      setFindingContactsIds((prev) => {
        const next = new Set(prev);
        next.delete(companyId);
        return next;
      });
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
      await supabase
        .from("email_drafts")
        .update({ to_email: next, updated_at: now })
        .eq("person_id", contact.person_id)
        .eq("status", "draft")
        .eq("to_email", oldEmail);
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
  const paginatedCompanies = companiesWithLeads.slice(
    page * pageSize,
    (page + 1) * pageSize,
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
              const enrichedCount = companyContacts.filter(
                (c) => c.enrichment_status === "enriched",
              ).length;
              const scoredContacts = companyContacts.filter(
                (c) => c.priority_score != null && c.priority_score > 0,
              );
              const topScore =
                scoredContacts.length > 0
                  ? Math.max(...scoredContacts.map((c) => c.priority_score!))
                  : null;
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

                      {companyContacts.length === 0 ? (
                        <div className="border-border border-t px-4 py-6 text-center">
                          <p className="text-muted-foreground text-sm">
                            No leads found for this company yet.
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-2"
                            aria-label={`Find contacts for ${company.name}`}
                            onClick={() => findContactsHandler(company.id)}
                            disabled={findingContactsIds.has(company.id)}
                          >
                            {findingContactsIds.has(company.id) ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <UserSearch className="h-3.5 w-3.5" />
                            )}
                            {findingContactsIds.has(company.id)
                              ? "Searching..."
                              : "Find leads"}
                          </Button>
                        </div>
                      ) : (
                        <ContactsTable
                          contacts={companyContacts}
                          expandedContactIds={expandedContactIds}
                          highlightedIds={highlightedIds}
                          enrichingIds={enrichingIds}
                          onToggle={toggleContact}
                          onEnrich={enrichContact}
                          onEmailEdit={updateContactEmail}
                          columnSpan={6}
                          showOutreach
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-muted-foreground text-xs tabular-nums">
                {page * pageSize + 1}&ndash;
                {Math.min(
                  (page + 1) * pageSize,
                  companiesWithLeads.length,
                )} of {companiesWithLeads.length} companies
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Previous page"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span
                  className="text-muted-foreground min-w-[4rem] text-center text-xs tabular-nums"
                  aria-current="page"
                  aria-label={`Page ${page + 1} of ${totalPages}`}
                >
                  {page + 1} / {totalPages}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Next page"
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                  disabled={page >= totalPages - 1}
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
          onToggle={toggleCompany}
          onEnrich={enrichCompanyHandler}
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
          onToggleSection={toggleCompany}
          onToggleContact={toggleContact}
          onEnrich={enrichContact}
          onEmailEdit={updateContactEmail}
        />
      )}
    </div>
  );
}

interface ContactsTableProps {
  contacts: CampaignContact[];
  expandedContactIds: Set<string>;
  highlightedIds?: Set<string>;
  enrichingIds: Set<string>;
  onToggle: (id: string) => void;
  onEnrich: (id: string) => void;
  onEmailEdit: (contact: CampaignContact, next: string) => Promise<void>;
  columnSpan: number;
  showOutreach: boolean;
}

function ContactsTable({
  contacts,
  expandedContactIds,
  highlightedIds,
  enrichingIds,
  onToggle,
  onEnrich,
  onEmailEdit,
  columnSpan,
  showOutreach,
}: ContactsTableProps) {
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
        {contacts.map((contact) => {
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
      </tbody>
    </table>
  );
}

interface CompaniesWithoutLeadsProps {
  companies: CampaignCompany[];
  expandedCompanyIds: Set<string>;
  enrichingCompanyIds: Set<string>;
  onToggle: (id: string) => void;
  onEnrich: (id: string) => void;
  isCompanyEnriched: (company: CampaignCompany) => boolean | "" | undefined;
}

function CompaniesWithoutLeads({
  companies,
  expandedCompanyIds,
  enrichingCompanyIds,
  onToggle,
  onEnrich,
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
                  </div>
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
  onToggleSection: (id: string) => void;
  onToggleContact: (id: string) => void;
  onEnrich: (id: string) => void;
  onEmailEdit: (contact: CampaignContact, next: string) => Promise<void>;
}

function UnassignedContacts({
  contacts,
  expandedCompanyIds,
  expandedContactIds,
  highlightedIds,
  enrichingIds,
  onToggleSection,
  onToggleContact,
  onEnrich,
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
              onToggle={onToggleContact}
              onEnrich={onEnrich}
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
