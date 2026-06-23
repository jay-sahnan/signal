"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  Copy,
  ExternalLink,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Signal {
  signalName: string;
  summary: string;
  confidence: string;
  found: boolean;
  evidence: Array<{ url: string; snippet: string }>;
}

interface Contact {
  personId: string;
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  email: string | null;
  priorityScore: number | null;
  enrichmentStatus: string;
  enrichmentData: {
    linkedin?: {
      profileInfo?: {
        username: string;
        name: string;
        headline: string;
      };
      posts?: Array<{
        text: string;
        url: string;
        created_at: string;
        likes: number;
        comments: number;
      }>;
    };
    twitter?: {
      user?: { name: string; username: string; description?: string };
      tweets?: Array<{ text: string; created_at: string }>;
    };
    news?: Array<{
      title: string;
      url: string;
      publishedDate: string | null;
      text: string | null;
    }>;
    articles?: Array<{
      title: string;
      url: string;
      publishedDate: string | null;
      text: string | null;
    }>;
    background?: Array<{
      title: string;
      url: string;
      publishedDate: string | null;
      text: string | null;
    }>;
  } | null;
}

interface CompanyData {
  orgId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  description: string | null;
  headcount: number | null;
  score: number | null;
  scoreReason: string | null;
  suggestedApproach: string | null;
  signals: Signal[];
  contacts: Contact[];
  websiteSummary: string | null;
  techStack: string[];
  fundingStage: string | null;
  recentNews: Array<{ title: string; url: string; date: string }>;
}

interface GeneratedMessage {
  subject: string;
  body: string;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.id as string;

  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<GeneratedMessage | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/company/${orgId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setCompany)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Unknown error"),
      )
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleGenerateMessage = async (contact: Contact) => {
    setGenerating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/generate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: contact.personId,
          organizationId: orgId,
        }),
      });
      if (!res.ok) throw new Error("Failed to generate");
      const data = await res.json();
      setMessage({ subject: data.subject, body: data.body });
    } catch {
      setMessage({ subject: "Error", body: "Failed to generate message." });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!message) return;
    navigator.clipboard.writeText(
      `Subject: ${message.subject}\n\n${message.body}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground text-sm">
          {error || "Company not found"}
        </p>
        <Button variant="outline" size="sm" onClick={() => router.push("/")}>
          Back to Feed
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main company content */}
      <div
        className={cn(
          "flex-1 overflow-y-auto",
          selectedContact && "hidden md:block",
        )}
      >
        <div className="space-y-5 p-4 md:p-6">
          {/* Back button + header */}
          <div>
            <button
              onClick={() => router.push("/")}
              className="text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1 text-xs"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to Feed
            </button>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold tracking-tight">
                    {company.name}
                  </h1>
                  {company.score !== null && (
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-bold",
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
                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  {company.industry && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" />
                      {company.industry}
                    </span>
                  )}
                  {company.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {company.location}
                    </span>
                  )}
                  {company.headcount && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {company.headcount.toLocaleString()} employees
                    </span>
                  )}
                  {company.domain && (
                    <a
                      href={`https://${company.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-foreground flex items-center gap-1"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {company.domain}
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* About */}
          {company.websiteSummary && (
            <section>
              <h2 className="mb-1.5 text-sm font-semibold">About</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {company.websiteSummary}
              </p>
            </section>
          )}

          {/* Signals */}
          {company.signals.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Active Signals</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {company.signals.map((signal, i) => (
                  <div key={i} className="border-border rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <Zap
                        className={cn(
                          "h-3.5 w-3.5",
                          signal.confidence === "high"
                            ? "text-green-500"
                            : "text-yellow-500",
                        )}
                      />
                      <span className="text-sm font-medium">
                        {signal.signalName}
                      </span>
                      <span
                        className={cn(
                          "ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium",
                          signal.confidence === "high"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                            : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
                        )}
                      >
                        {signal.confidence}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                      {signal.summary.slice(0, 150)}
                    </p>
                    {signal.evidence.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {signal.evidence.slice(0, 3).map((ev, j) => (
                          <a
                            key={j}
                            href={ev.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400"
                          >
                            <ExternalLink className="h-2 w-2" />
                            Source
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Suggested Approach */}
          {company.suggestedApproach && (
            <section className="bg-muted/30 rounded-lg border p-4">
              <h2 className="mb-1 text-sm font-semibold">Suggested Approach</h2>
              <p className="text-sm leading-relaxed">
                {company.suggestedApproach}
              </p>
            </section>
          )}

          {/* Contacts — people to reach out to */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">
              People to Contact ({company.contacts.length})
            </h2>
            {company.contacts.length > 0 ? (
              <div className="divide-border divide-y rounded-lg border">
                {company.contacts.map((contact) => (
                  <button
                    key={contact.personId}
                    onClick={() => {
                      setSelectedContact(contact);
                      setMessage(null);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                      selectedContact?.personId === contact.personId &&
                        "bg-muted/50",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {contact.name}
                        </span>
                        <a
                          href={
                            contact.linkedinUrl
                              ? contact.linkedinUrl
                              : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(contact.name + " " + (company?.name ?? ""))}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Linkedin className="h-3 w-3" />
                          LinkedIn
                        </a>
                      </div>
                      {contact.title && (
                        <p className="text-muted-foreground truncate text-xs">
                          {contact.title}
                        </p>
                      )}
                      {contact.email && (
                        <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                          <Mail className="h-2.5 w-2.5" />
                          {contact.email}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No contacts found yet. Run enrichment to discover people.
              </p>
            )}
          </section>

          {/* Intel */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Intel</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {company.recentNews.length > 0 && (
                <div>
                  <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
                    Recent News
                  </h3>
                  <div className="space-y-1">
                    {company.recentNews.map((news, i) => (
                      <a
                        key={i}
                        href={news.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs hover:underline"
                      >
                        {news.title}
                        {news.date && (
                          <span className="text-muted-foreground ml-1">
                            ({formatDate(news.date)})
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {company.techStack.length > 0 && (
                <div>
                  <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
                    Tech Stack
                  </h3>
                  <p className="text-xs">
                    {company.techStack.slice(0, 8).join(", ")}
                  </p>
                </div>
              )}
              {company.fundingStage && (
                <div>
                  <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
                    Funding
                  </h3>
                  <p className="text-xs">{company.fundingStage}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Contact detail panel */}
      {selectedContact && (
        <div className="border-border flex w-full flex-col border-l md:w-[420px] md:shrink-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSelectedContact(null);
                  setMessage(null);
                }}
                className="text-muted-foreground hover:text-foreground md:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <h3 className="text-sm font-semibold">{selectedContact.name}</h3>
            </div>
            <button
              onClick={() => {
                setSelectedContact(null);
                setMessage(null);
              }}
              className="text-muted-foreground hover:text-foreground hidden md:block"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              {/* Contact header */}
              <div>
                {selectedContact.title && (
                  <p className="text-muted-foreground text-sm">
                    {selectedContact.title}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <a
                    href={
                      selectedContact.linkedinUrl
                        ? selectedContact.linkedinUrl
                        : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(selectedContact.name + " " + (company?.name ?? ""))}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    <Linkedin className="h-3.5 w-3.5 text-blue-600" />
                    {selectedContact.linkedinUrl
                      ? "LinkedIn Profile"
                      : "Find on LinkedIn"}
                  </a>
                  {selectedContact.email && (
                    <a
                      href={`mailto:${selectedContact.email}`}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {selectedContact.email}
                    </a>
                  )}
                </div>
              </div>

              {/* LinkedIn info */}
              {selectedContact.enrichmentData?.linkedin && (
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    LinkedIn
                  </h4>
                  {selectedContact.enrichmentData.linkedin.profileInfo && (
                    <div className="mb-2">
                      <p className="text-sm font-medium">
                        {
                          selectedContact.enrichmentData.linkedin.profileInfo
                            .name
                        }
                      </p>
                      {selectedContact.enrichmentData.linkedin.profileInfo
                        .headline && (
                        <p className="text-muted-foreground text-xs">
                          {
                            selectedContact.enrichmentData.linkedin.profileInfo
                              .headline
                          }
                        </p>
                      )}
                    </div>
                  )}
                  {selectedContact.enrichmentData.linkedin.posts &&
                    selectedContact.enrichmentData.linkedin.posts.length >
                      0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Recent Posts</p>
                        {selectedContact.enrichmentData.linkedin.posts
                          .slice(0, 4)
                          .map((post, i) => (
                            <div
                              key={i}
                              className="border-border rounded-md border p-2"
                            >
                              <p className="line-clamp-3 text-xs leading-relaxed">
                                {post.text}
                              </p>
                              <div className="text-muted-foreground mt-1 flex items-center gap-2 text-[10px]">
                                {post.likes > 0 && (
                                  <span>{post.likes} likes</span>
                                )}
                                {post.comments > 0 && (
                                  <span>{post.comments} comments</span>
                                )}
                                {post.created_at && (
                                  <span>{formatDate(post.created_at)}</span>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                </section>
              )}

              {/* News & Background */}
              {selectedContact.enrichmentData?.news &&
                selectedContact.enrichmentData.news.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      News & Mentions
                    </h4>
                    <div className="space-y-1.5">
                      {selectedContact.enrichmentData.news
                        .slice(0, 4)
                        .map((item, i) => (
                          <a
                            key={i}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded-md border p-2 text-xs transition-colors hover:bg-muted/50"
                          >
                            <p className="line-clamp-1 font-medium">
                              {item.title}
                            </p>
                            {item.text && (
                              <p className="text-muted-foreground mt-0.5 line-clamp-2">
                                {item.text}
                              </p>
                            )}
                          </a>
                        ))}
                    </div>
                  </section>
                )}

              {selectedContact.enrichmentData?.background &&
                selectedContact.enrichmentData.background.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Background
                    </h4>
                    <div className="space-y-1.5">
                      {selectedContact.enrichmentData.background
                        .slice(0, 3)
                        .map((item, i) => (
                          <a
                            key={i}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded-md border p-2 text-xs transition-colors hover:bg-muted/50"
                          >
                            <p className="line-clamp-1 font-medium">
                              {item.title}
                            </p>
                          </a>
                        ))}
                    </div>
                  </section>
                )}

              {/* Generate Message */}
              <section className="border-t pt-4">
                <Button
                  onClick={() => handleGenerateMessage(selectedContact)}
                  disabled={generating}
                  className="w-full"
                >
                  {generating ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-4 w-4" />
                  )}
                  {generating
                    ? "Generating..."
                    : "Generate Personalised Message"}
                </Button>

                {message && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">Generated Message</p>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={handleCopy}
                      >
                        <Copy className="h-3 w-3" />
                        {copied && (
                          <span className="ml-1 text-[10px]">Copied!</span>
                        )}
                      </Button>
                    </div>
                    <div className="bg-muted/30 rounded-lg border p-3">
                      <p className="mb-1 text-xs font-medium">
                        Subject: {message.subject}
                      </p>
                      <p className="whitespace-pre-line text-xs leading-relaxed">
                        {message.body}
                      </p>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
