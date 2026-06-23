"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Plus,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface PlaybookMeta {
  slug: string;
  name: string;
  description: string;
  filename: string;
}

const PLAYBOOKS: PlaybookMeta[] = [
  {
    slug: "qa",
    name: "QA",
    description:
      "Companies with manual QA processes that need AI-powered 100% conversation coverage.",
    filename: "config/targeting-qa.md",
  },
  {
    slug: "complaints",
    name: "Complaints",
    description:
      "Auto finance and consumer lending companies failing to detect and capture customer complaints.",
    filename: "config/targeting-complaints.md",
  },
  {
    slug: "sales-compliance",
    name: "Sales Compliance",
    description:
      "Auto finance and lending companies with unmonitored sales conversations violating UDAAP, TILA, ECOA.",
    filename: "config/targeting-sales-compliance.md",
  },
];

interface PlaybookState {
  content: string;
  draft: string;
  lastModified: string | null;
  loading: boolean;
  saving: boolean;
  expanded: boolean;
  dirty: boolean;
}

export default function TargetingPlaybooksPage() {
  const [states, setStates] = useState<Record<string, PlaybookState>>(() => {
    const init: Record<string, PlaybookState> = {};
    for (const pb of PLAYBOOKS) {
      init[pb.slug] = {
        content: "",
        draft: "",
        lastModified: null,
        loading: false,
        saving: false,
        expanded: false,
        dirty: false,
      };
    }
    return init;
  });

  const update = (slug: string, patch: Partial<PlaybookState>) => {
    setStates((prev) => ({
      ...prev,
      [slug]: { ...prev[slug], ...patch },
    }));
  };

  const fetchContent = async (slug: string) => {
    update(slug, { loading: true });
    try {
      const res = await fetch(`/api/targeting?slug=${slug}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      update(slug, {
        content: json.content,
        draft: json.content,
        lastModified: json.lastModified,
        loading: false,
        dirty: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to load ${slug}: ${message}`);
      update(slug, { loading: false });
    }
  };

  const handleToggle = (slug: string) => {
    const current = states[slug];
    if (!current.expanded && !current.content) {
      void fetchContent(slug);
    }
    update(slug, { expanded: !current.expanded });
  };

  const handleDraftChange = (slug: string, value: string) => {
    const current = states[slug];
    update(slug, { draft: value, dirty: value !== current.content });
  };

  const handleSave = async (slug: string) => {
    const current = states[slug];
    update(slug, { saving: true });
    try {
      const res = await fetch("/api/targeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, content: current.draft }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      update(slug, {
        content: current.draft,
        lastModified: json.lastModified,
        saving: false,
        dirty: false,
      });
      toast.success(`Saved ${slug} targeting file`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to save: ${message}`);
      update(slug, { saving: false });
    }
  };

  const handleDiscard = (slug: string) => {
    const current = states[slug];
    update(slug, { draft: current.content, dirty: false });
  };

  // Fetch last-modified dates on mount for all playbooks
  useEffect(() => {
    for (const pb of PLAYBOOKS) {
      fetch(`/api/targeting?slug=${pb.slug}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json) {
            update(pb.slug, {
              lastModified: json.lastModified,
              content: json.content,
              draft: json.content,
            });
          }
        })
        .catch(() => {
          /* ignore — we'll show the error when they expand */
        });
    }
  }, []);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Targeting Playbooks
          </h1>
          <p className="text-muted-foreground text-sm">
            Edit your ICP targeting criteria. These files drive signal
            selection, company scoring, and outreach messaging.
          </p>
        </div>

        {/* Playbook cards */}
        <div className="space-y-4">
          {PLAYBOOKS.map((pb) => {
            const s = states[pb.slug];
            return (
              <div key={pb.slug} className="border-border rounded-lg border">
                {/* Card header */}
                <div className="flex items-start justify-between gap-4 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="bg-muted text-muted-foreground mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold">{pb.name}</h2>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {pb.description}
                      </p>
                      <p className="text-muted-foreground/60 mt-1 font-mono text-[11px]">
                        {pb.filename}
                        {s.lastModified && (
                          <>
                            {" "}
                            &middot; last modified{" "}
                            {new Date(s.lastModified).toLocaleDateString(
                              undefined,
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggle(pb.slug)}
                  >
                    {s.expanded ? (
                      <>
                        Collapse
                        <ChevronUp className="ml-1.5 h-3.5 w-3.5" />
                      </>
                    ) : (
                      <>
                        View / Edit
                        <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
                      </>
                    )}
                  </Button>
                </div>

                {/* Expanded editor */}
                {s.expanded && (
                  <div className="border-border border-t px-4 pb-4 pt-3">
                    {s.loading && !s.content ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
                      </div>
                    ) : (
                      <>
                        <Textarea
                          value={s.draft}
                          onChange={(e) =>
                            handleDraftChange(pb.slug, e.target.value)
                          }
                          className="min-h-[320px] font-mono text-xs leading-relaxed"
                          placeholder="Markdown content..."
                        />
                        <div className="mt-3 flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleSave(pb.slug)}
                            disabled={!s.dirty || s.saving}
                          >
                            {s.saving ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Save className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            {s.saving ? "Saving..." : "Save"}
                          </Button>
                          {s.dirty && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDiscard(pb.slug)}
                            >
                              Discard changes
                            </Button>
                          )}
                          {s.dirty && (
                            <span className="text-muted-foreground text-xs">
                              Unsaved changes
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Create new playbook placeholder */}
        <div className="border-border rounded-lg border border-dashed p-6 text-center">
          <Button variant="outline" size="sm" disabled>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Create New Playbook
          </Button>
          <p className="text-muted-foreground mt-2 text-xs">
            Custom playbook creation coming soon.
          </p>
        </div>
      </div>
    </div>
  );
}
