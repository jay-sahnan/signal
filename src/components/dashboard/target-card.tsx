"use client";

import { useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  Mail,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SignalEvidence {
  url: string;
  snippet: string;
}

interface TargetSignal {
  signalName: string;
  signalSlug: string;
  summary: string;
  confidence: string;
  found: boolean;
  ranAt: string;
  evidence: SignalEvidence[];
}

interface TargetContact {
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  email: string | null;
  priorityScore: number | null;
  emailSubject?: string | null;
  emailBody?: string | null;
}

interface TargetIntel {
  websiteSummary: string | null;
  recentNews: Array<{ title: string; url: string; date: string }>;
  hiring: { totalJobs: number; relevantRoles: string[] };
  fundingStage: string | null;
  techStack: string[];
  estimatedRevenue: unknown;
}

export interface TargetCompany {
  companyId: string;
  orgId: string;
  campaignId: string;
  campaignName: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  headcount: number | null;
  score: number | null;
  scoreReason: string | null;
  readinessTag: string | null;
  suggestedApproach: string | null;
  signals: TargetSignal[];
  intel: TargetIntel;
  topContacts: TargetContact[];
}

interface TargetCardProps {
  company: TargetCompany;
}

function confidenceColor(confidence: string) {
  if (confidence === "high") return "text-green-600 dark:text-green-400";
  if (confidence === "medium") return "text-yellow-600 dark:text-yellow-400";
  return "text-muted-foreground";
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function TargetCard({ company }: TargetCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [generating, setGenerating] = useState(false);

  return (
    <div className="border-border rounded-lg border">
      {/* Header */}
      <div className="flex items-start justify-between p-4 pb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">{company.name}</h3>
            {company.domain && (
              <a
                href={`https://${company.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {company.score !== null && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold",
                  company.score >= 8
                    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                    : company.score >= 6
                      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {company.score}/10
              </span>
            )}
          </div>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            {company.industry && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {company.industry}
              </span>
            )}
            {company.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {company.location}
              </span>
            )}
            {company.headcount && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {company.headcount.toLocaleString()} employees
              </span>
            )}
            {company.domain && (
              <span className="text-muted-foreground/60">{company.domain}</span>
            )}
          </div>
        </div>
      </div>

      {/* Signals */}
      {company.signals.length > 0 && (
        <div className="border-border border-t px-4 py-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Signals
          </p>
          <div className="space-y-1">
            {company.signals.map((signal, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span
                  className={cn(
                    "mt-0.5 shrink-0",
                    confidenceColor(signal.confidence),
                  )}
                >
                  {signal.confidence === "high" ? "\u25B2" : "\u25CF"}
                </span>
                <div className="min-w-0">
                  <span className="font-medium">{signal.signalName}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    -- {signal.summary}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggested Approach */}
      {company.suggestedApproach && (
        <div className="border-border border-t px-4 py-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Suggested Approach
          </p>
          <p className="text-sm leading-relaxed">{company.suggestedApproach}</p>
        </div>
      )}

      {/* Top Contacts */}
      {company.topContacts.length > 0 && (
        <div className="border-border border-t px-4 py-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Top Contacts
          </p>
          <div className="space-y-1">
            {company.topContacts.map((contact, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="font-medium">{contact.name}</span>
                {contact.title && (
                  <span className="text-muted-foreground">{contact.title}</span>
                )}
                {contact.linkedinUrl && (
                  <a
                    href={contact.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {contact.email && (
                  <span className="text-muted-foreground flex items-center gap-0.5 text-xs">
                    <Mail className="h-3 w-3" />
                    {contact.email}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generate Message */}
      {company.topContacts.length > 0 && (
        <div className="border-border border-t px-4 py-2.5">
          <button
            onClick={() => setGenerating(!generating)}
            disabled={generating}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {generating ? "Generating..." : "Generate Outreach Messages"}
          </button>
        </div>
      )}

      {/* Intel & Details */}
      <div className="border-border border-t">
        <button
          onClick={() => setExpanded(!expanded)}
          className="hover:bg-muted/50 flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground transition-colors"
        >
          <span>Intel & Details</span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        {expanded && (
          <div className="space-y-2 px-4 pb-3 text-sm">
            {company.intel.websiteSummary && (
              <div>
                <span className="text-muted-foreground text-xs font-medium">
                  About:
                </span>
                <p className="text-muted-foreground text-xs">
                  {company.intel.websiteSummary}
                </p>
              </div>
            )}
            {company.intel.recentNews.length > 0 && (
              <div>
                <span className="text-muted-foreground text-xs font-medium">
                  Recent News:
                </span>
                {company.intel.recentNews.map((news, i) => (
                  <div key={i} className="text-xs">
                    <a
                      href={news.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {news.title}
                    </a>
                    {news.date && (
                      <span className="text-muted-foreground ml-1">
                        ({formatDate(news.date)})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {company.intel.hiring.totalJobs > 0 && (
              <div>
                <span className="text-muted-foreground text-xs font-medium">
                  Hiring:
                </span>
                <span className="text-xs">
                  {" "}
                  {company.intel.hiring.totalJobs} open roles
                  {company.intel.hiring.relevantRoles.length > 0 &&
                    ` (${company.intel.hiring.relevantRoles.join(", ")})`}
                </span>
              </div>
            )}
            {company.intel.techStack.length > 0 && (
              <div>
                <span className="text-muted-foreground text-xs font-medium">
                  Tech Stack:
                </span>
                <span className="text-xs">
                  {" "}
                  {company.intel.techStack.slice(0, 8).join(", ")}
                </span>
              </div>
            )}
            {company.intel.fundingStage && (
              <div>
                <span className="text-muted-foreground text-xs font-medium">
                  Funding:
                </span>
                <span className="text-xs"> {company.intel.fundingStage}</span>
              </div>
            )}
            {/* Signal evidence */}
            {company.signals.some((s) => s.evidence.length > 0) && (
              <div>
                <span className="text-muted-foreground text-xs font-medium">
                  Evidence:
                </span>
                {company.signals
                  .filter((s) => s.evidence.length > 0)
                  .map((s, si) =>
                    s.evidence.map((e, ei) => (
                      <div key={`${si}-${ei}`} className="text-xs">
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:underline"
                        >
                          {e.snippet.slice(0, 120)}...
                        </a>
                      </div>
                    )),
                  )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
