"use client";

import { useState } from "react";
import { ExternalLink, Mail, MapPin, Phone, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PriorityCallout } from "@/components/ui/priority-callout";
import { cn } from "@/lib/utils";
import type {
  CampaignCompany,
  CompanyEnrichmentData,
} from "@/lib/types/campaign";

const LINK_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded";

function phoneKey(phone: string) {
  return phone.replace(/\D/g, "");
}

function dedupePhones(phones: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const p of phones) {
    const key = phoneKey(p);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || p.length > existing.length) byKey.set(key, p);
  }
  return Array.from(byKey.values());
}

function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of emails) {
    const key = e.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e.trim());
  }
  return out;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface CompanyDetailProps {
  company: CampaignCompany;
  onRefresh?: (companyId: string) => void;
  isRefreshing?: boolean;
}

export function CompanyDetail({
  company,
  onRefresh,
  isRefreshing,
}: CompanyDetailProps) {
  const data = company.enrichment_data as CompanyEnrichmentData | undefined;
  const [showRaw, setShowRaw] = useState(false);
  const [showAllJobs, setShowAllJobs] = useState(false);

  if (!data || !("enrichedAt" in data)) {
    return (
      <div className="text-muted-foreground px-4 py-4 text-center text-sm">
        Not yet enriched. Click Enrich above or ask the agent to gather details.
      </div>
    );
  }

  const website = data.website;
  const searches = data.searches || [];
  const productSearch = searches.find((s) => s.category === "product");
  const fundingSearch = searches.find((s) => s.category === "funding");
  const teamSearch = searches.find(
    (s) => s.category === "team" || s.category === "executive",
  );
  const hiring = data.hiring;
  const jobsToShow = hiring
    ? showAllJobs
      ? hiring.jobs
      : hiring.jobs.slice(0, 10)
    : [];

  const emails = dedupeEmails(website?.emails ?? []);
  const phones = dedupePhones(website?.phones ?? []);
  const hasContactInfo =
    emails.length > 0 || phones.length > 0 || !!website?.address;

  const hasOverviewTitle = !!website?.title;
  const overviewBody = website?.summary || website?.description || "";
  const hasOverviewBody = overviewBody.trim().length > 0;

  const showOverview = hasOverviewTitle || hasOverviewBody || hasContactInfo;

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <PriorityCallout
          score={company.relevance_score}
          reason={company.score_reason}
          className="flex-1"
        />
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {data.enrichedAt && (
            <span className="text-muted-foreground text-xs tabular-nums">
              Enriched {formatDate(data.enrichedAt)}
            </span>
          )}
          {onRefresh && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onRefresh(company.id)}
              disabled={isRefreshing}
              aria-label="Re-enrich this company"
            >
              <RotateCw
                className={cn("h-3 w-3", isRefreshing && "animate-spin")}
              />
              {isRefreshing ? "Refreshing..." : "Re-enrich"}
            </Button>
          )}
        </div>
      </div>

      {showOverview && (
        <section className="space-y-3">
          <h4 className="text-sm font-semibold">Overview</h4>

          {hasOverviewTitle && (
            <p className="text-sm font-medium">{website!.title}</p>
          )}
          {hasOverviewBody && (
            <p className="text-muted-foreground text-sm">{overviewBody}</p>
          )}

          {hasContactInfo && (
            <div className="space-y-1.5">
              <h5 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Contact
              </h5>
              <ul className="space-y-1.5 text-sm">
                {emails.map((email) => (
                  <li key={email} className="flex items-center gap-2">
                    <Mail className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                    <a
                      href={`mailto:${email}`}
                      className={cn(
                        "text-foreground truncate hover:underline",
                        LINK_FOCUS,
                      )}
                    >
                      {email}
                    </a>
                  </li>
                ))}
                {phones.map((phone) => (
                  <li key={phone} className="flex items-center gap-2">
                    <Phone className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                    <a
                      href={`tel:${phone.replace(/\s/g, "")}`}
                      className={cn(
                        "text-foreground hover:underline tabular-nums",
                        LINK_FOCUS,
                      )}
                    >
                      {phone}
                    </a>
                  </li>
                ))}
                {website?.address && (
                  <li className="text-muted-foreground flex items-start gap-2 text-xs">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span>{website.address}</span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </section>
      )}

      {(productSearch || fundingSearch || teamSearch) && (
        <div className="grid gap-4 md:grid-cols-3">
          {productSearch && productSearch.results.length > 0 && (
            <SearchSection
              title="Product & Features"
              items={productSearch.results}
            />
          )}
          {fundingSearch && fundingSearch.results.length > 0 && (
            <SearchSection
              title="Funding & News"
              items={fundingSearch.results}
            />
          )}
          {teamSearch && teamSearch.results.length > 0 && (
            <SearchSection title="Team & Size" items={teamSearch.results} />
          )}
        </div>
      )}

      {hiring && hiring.jobs.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Open positions ({hiring.jobs.length})
            </h4>
            {hiring.careersUrl && (
              <a
                href={hiring.careersUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors",
                  LINK_FOCUS,
                )}
              >
                View careers page
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {jobsToShow.map((job, i) => (
              <div
                key={i}
                className="border-border rounded-md border px-2.5 py-2 text-xs"
              >
                <p className="font-medium">{job.title}</p>
                <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {job.department && <span>{job.department}</span>}
                  {job.department && job.location && (
                    <span className="text-muted-foreground/40">·</span>
                  )}
                  {job.location && <span>{job.location}</span>}
                </div>
              </div>
            ))}
          </div>
          {hiring.jobs.length > 10 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowAllJobs((v) => !v)}
            >
              {showAllJobs
                ? "Show fewer"
                : `Show ${hiring.jobs.length - 10} more`}
            </Button>
          )}
        </section>
      )}

      {data.errors && data.errors.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-xs font-medium uppercase tracking-wide text-red-600 dark:text-red-400">
            Enrichment errors
          </h4>
          <ul className="space-y-0.5 text-xs text-red-600 dark:text-red-400">
            {data.errors.map((e, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-0.5">•</span>
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setShowRaw((v) => !v)}
          aria-expanded={showRaw}
        >
          {showRaw ? "Hide raw data" : "View raw data"}
        </Button>
        {showRaw && (
          <pre className="bg-muted/40 mt-2 max-h-96 overflow-auto rounded-md p-3 text-xs">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function SearchSection({
  title,
  items,
}: {
  title: string;
  items: {
    title: string;
    url: string;
    publishedDate: string | null;
    text: string | null;
    summary?: string;
  }[];
}) {
  return (
    <div className="space-y-1">
      <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {title}
      </h4>
      <ul className="divide-border divide-y">
        {items.map((r, i) => {
          const body = r.summary ?? r.text ?? "";
          return (
            <li key={i} className="py-2 first:pt-1">
              <div className="flex items-start gap-1.5">
                <p className="line-clamp-1 flex-1 text-xs font-medium">
                  {r.title}
                </p>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${r.title}`}
                  className={cn(
                    "text-muted-foreground hover:text-foreground shrink-0 transition-colors",
                    LINK_FOCUS,
                  )}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {body && (
                <p className="text-muted-foreground mt-0.5 line-clamp-3 text-xs">
                  {body}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
