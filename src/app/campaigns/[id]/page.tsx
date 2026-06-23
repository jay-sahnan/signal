"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { RotateCw, Sparkles } from "lucide-react";

import { CampaignHeader } from "@/components/campaign/campaign-header";
import { CampaignStats } from "@/components/campaign/campaign-stats";
import { CompaniesList } from "@/components/campaign/companies-list";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useCampaign } from "@/lib/campaign-context";
import { useStreaming } from "@/lib/streaming-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type {
  Campaign,
  CampaignCompany,
  CampaignContact,
} from "@/lib/types/campaign";

interface ActivityCounts {
  added: number;
  enriched: number;
  contacted: number;
}

const EMPTY_ACTIVITY: ActivityCounts = {
  added: 0,
  enriched: 0,
  contacted: 0,
};

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const { setActiveCampaignId, setAgentOpen } = useCampaign();
  const { isStreaming } = useStreaming();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [companies, setCompanies] = useState<CampaignCompany[]>([]);
  const [contacts, setContacts] = useState<CampaignContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [refreshingScores, setRefreshingScores] = useState(false);
  const [activity, setActivity] = useState<ActivityCounts>(EMPTY_ACTIVITY);
  const [headerVisible, setHeaderVisible] = useState(true);

  const headerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const prevCompanyIds = useRef<Set<string>>(new Set());
  const prevContactIds = useRef<Set<string>>(new Set());
  const prevCompanyStatuses = useRef<Map<string, string>>(new Map());
  const prevEnrichmentStatuses = useRef<Map<string, string>>(new Map());
  const prevOutreachStatuses = useRef<Map<string, string>>(new Map());
  const isInitialLoad = useRef(true);
  const wasStreamingRef = useRef(false);

  useEffect(() => {
    setActiveCampaignId(campaignId);
    return () => {
      setActiveCampaignId(null);
      setAgentOpen(false);
    };
  }, [campaignId, setActiveCampaignId, setAgentOpen]);

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      const t = setTimeout(() => setActivity(EMPTY_ACTIVITY), 4000);
      return () => clearTimeout(t);
    }
    if (!wasStreamingRef.current && isStreaming) {
      setActivity(EMPTY_ACTIVITY);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    const [campaignRes, companiesRes, contactsRes] = await Promise.all([
      supabase.from("campaigns").select("*").eq("id", campaignId).single(),
      supabase
        .from("campaign_organizations")
        .select("*, organization:organizations(*)")
        .eq("campaign_id", campaignId)
        .order("relevance_score", { ascending: false }),
      supabase
        .from("campaign_people")
        .select(
          "*, person:people(*, organization:organizations(name, domain, industry))",
        )
        .eq("campaign_id", campaignId)
        .order("priority_score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
    ]);

    if (!mountedRef.current) return;

    if (campaignRes.error) {
      setError("Campaign not found");
      setLoading(false);
      return;
    }

    const newCompanies: CampaignCompany[] = (companiesRes.data || [])
      .filter((row: Record<string, unknown>) => row.organization != null)
      .map((row: Record<string, unknown>) => {
        const org = row.organization as Record<string, unknown>;
        return {
          id: row.id as string,
          organization_id: row.organization_id as string,
          campaign_id: row.campaign_id as string,
          name: org.name as string,
          domain: org.domain as string | null,
          url: org.url as string | null,
          industry: org.industry as string | null,
          location: org.location as string | null,
          description: org.description as string | null,
          relevance_score: row.relevance_score as number | null,
          score_reason: row.score_reason as string | null,
          status: row.status as CampaignCompany["status"],
          readiness_tag:
            (row.readiness_tag as CampaignCompany["readiness_tag"]) || null,
          enrichment_data: (org.enrichment_data ||
            {}) as CampaignCompany["enrichment_data"],
          suggested_approach: (row.suggested_approach as string) ?? null,
          approach_generated_at: (row.approach_generated_at as string) ?? null,
          source: org.source as string | null,
          created_at: row.created_at as string,
          updated_at: row.updated_at as string,
        };
      });

    const newContacts: CampaignContact[] = (contactsRes.data || [])
      .filter((row: Record<string, unknown>) => row.person != null)
      .map((row: Record<string, unknown>) => {
        const person = row.person as Record<string, unknown>;
        const org = person?.organization as unknown as {
          name: string;
          domain: string | null;
          industry: string | null;
        } | null;
        return {
          id: row.id as string,
          person_id: row.person_id as string,
          campaign_id: row.campaign_id as string,
          organization_id: (person?.organization_id as string) || null,
          name: person.name as string,
          title: person.title as string | null,
          work_email: person.work_email as string | null,
          personal_email: person.personal_email as string | null,
          work_email_verified_at: person.work_email_verified_at as
            | string
            | null,
          personal_email_verified_at: person.personal_email_verified_at as
            | string
            | null,
          linkedin_url: person.linkedin_url as string | null,
          twitter_url: person.twitter_url as string | null,
          enrichment_status:
            person.enrichment_status as CampaignContact["enrichment_status"],
          enrichment_data: (person.enrichment_data ||
            {}) as CampaignContact["enrichment_data"],
          outreach_status:
            row.outreach_status as CampaignContact["outreach_status"],
          priority_score: row.priority_score as number | null,
          score_reason: row.score_reason as string | null,
          readiness_tag:
            (row.readiness_tag as CampaignContact["readiness_tag"]) || null,
          generated_email_subject:
            (row.generated_email_subject as string) ?? null,
          generated_email_body: (row.generated_email_body as string) ?? null,
          email_generated_at: (row.email_generated_at as string) ?? null,
          source: person.source as string | null,
          created_at: row.created_at as string,
          updated_at: row.updated_at as string,
          company: org
            ? { name: org.name, domain: org.domain, industry: org.industry }
            : null,
        };
      });

    if (!isInitialLoad.current) {
      const changed = new Set<string>();
      let addedDelta = 0;
      let enrichedDelta = 0;
      let contactedDelta = 0;

      for (const c of newCompanies) {
        if (!prevCompanyIds.current.has(c.id)) {
          changed.add(c.id);
          addedDelta += 1;
        } else {
          const prevStatus = prevCompanyStatuses.current.get(c.id);
          if (prevStatus && prevStatus !== c.status) changed.add(c.id);
        }
      }

      for (const c of newContacts) {
        if (!prevContactIds.current.has(c.id)) {
          changed.add(c.id);
          addedDelta += 1;
        }
        const prevEnrichment = prevEnrichmentStatuses.current.get(c.id);
        if (
          prevEnrichment &&
          prevEnrichment !== "enriched" &&
          c.enrichment_status === "enriched"
        ) {
          enrichedDelta += 1;
        }
        const prevOutreach = prevOutreachStatuses.current.get(c.id);
        const isContacted =
          c.outreach_status === "sent" ||
          c.outreach_status === "opened" ||
          c.outreach_status === "replied";
        const wasContacted =
          prevOutreach === "sent" ||
          prevOutreach === "opened" ||
          prevOutreach === "replied";
        if (!wasContacted && isContacted) contactedDelta += 1;
      }

      if (changed.size > 0) {
        setHighlightedIds(changed);
        setTimeout(() => setHighlightedIds(new Set()), 3000);
      }

      if (addedDelta > 0 || enrichedDelta > 0 || contactedDelta > 0) {
        setActivity((prev) => ({
          added: prev.added + addedDelta,
          enriched: prev.enriched + enrichedDelta,
          contacted: prev.contacted + contactedDelta,
        }));
      }
    }
    isInitialLoad.current = false;

    prevCompanyIds.current = new Set(newCompanies.map((c) => c.id));
    prevContactIds.current = new Set(newContacts.map((c) => c.id));
    prevCompanyStatuses.current = new Map(
      newCompanies.map((c) => [c.id, c.status]),
    );
    prevEnrichmentStatuses.current = new Map(
      newContacts.map((c) => [c.id, c.enrichment_status ?? ""]),
    );
    prevOutreachStatuses.current = new Map(
      newContacts.map((c) => [c.id, c.outreach_status ?? ""]),
    );

    setCampaign(campaignRes.data as Campaign);
    setCompanies(newCompanies);
    setContacts(newContacts);
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, isStreaming ? 3000 : 30000);
    return () => clearInterval(interval);
  }, [fetchData, isStreaming]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setHeaderVisible(entry.isIntersecting),
      { threshold: 0, rootMargin: "-56px 0px 0px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading]);

  const handleContactEnriched = (
    contactId: string,
    updated: CampaignContact,
  ) => {
    setContacts((prev) => prev.map((c) => (c.id === contactId ? updated : c)));
  };

  const handleCompanyEnriched = (
    companyId: string,
    enrichmentData: Record<string, unknown>,
  ) => {
    setCompanies((prev) =>
      prev.map((c) =>
        c.id === companyId
          ? {
              ...c,
              enrichment_data:
                enrichmentData as CampaignCompany["enrichment_data"],
            }
          : c,
      ),
    );
  };

  const replyRate = useMemo(() => {
    const contacted = contacts.filter(
      (c) =>
        c.outreach_status === "sent" ||
        c.outreach_status === "opened" ||
        c.outreach_status === "replied",
    ).length;
    const replied = contacts.filter(
      (c) => c.outreach_status === "replied",
    ).length;
    return contacted > 0 ? Math.round((replied / contacted) * 100) : 0;
  }, [contacts]);

  if (loading) {
    return <CampaignSkeleton />;
  }

  const refreshScores = async () => {
    setRefreshingScores(true);
    try {
      await fetch("/api/refresh-scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      await fetchData();
    } catch (err) {
      console.error("[refresh-scores] Failed:", err);
    } finally {
      setRefreshingScores(false);
    }
  };

  if (error || !campaign) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">
          {error || "Campaign not found"}
        </p>
      </div>
    );
  }

  const hasScoringCapable = contacts.some(
    (c) => c.enrichment_status === "enriched",
  );

  const activityTotal = activity.added + activity.enriched + activity.contacted;

  return (
    <div className="flex-1 overflow-y-auto">
      <StickyCampaignBar
        name={campaign.name}
        replyRate={replyRate}
        visible={!headerVisible}
      />

      <div className="space-y-6 p-4 md:p-6">
        <div ref={headerRef}>
          <CampaignHeader
            campaign={campaign}
            contactCount={contacts.length}
            companyCount={companies.length}
            onDataChanged={fetchData}
            onProfileChanged={(profileId) =>
              setCampaign((prev) =>
                prev ? { ...prev, profile_id: profileId } : prev,
              )
            }
          />
        </div>

        <CampaignStats companies={companies} contacts={contacts} />

        <Separator />

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pipeline</h2>
            {hasScoringCapable && (
              <Button
                variant="ghost"
                size="sm"
                onClick={refreshScores}
                disabled={refreshingScores}
              >
                <RotateCw
                  className={cn(
                    "h-3.5 w-3.5",
                    refreshingScores && "animate-spin",
                  )}
                />
                {refreshingScores ? "Scoring..." : "Refresh scores"}
              </Button>
            )}
          </div>
          <CompaniesList
            campaignId={campaignId}
            companies={companies}
            contacts={contacts}
            highlightedIds={highlightedIds}
            onContactEnriched={handleContactEnriched}
            onCompanyEnriched={handleCompanyEnriched}
            onDataChanged={fetchData}
          />
        </div>
      </div>

      {(isStreaming || activityTotal > 0) && (
        <ActivityChip activity={activity} streaming={isStreaming} />
      )}
    </div>
  );
}

function StickyCampaignBar({
  name,
  replyRate,
  visible,
}: {
  name: string;
  replyRate: number;
  visible: boolean;
}) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "bg-background/80 sticky top-0 z-10 backdrop-blur transition-opacity",
        "border-border border-b",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div className="mx-auto flex items-center justify-between gap-3 px-4 py-2 md:px-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="truncate text-sm font-semibold">{name}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {replyRate}% reply rate
          </span>
        </div>
      </div>
    </div>
  );
}

function ActivityChip({
  activity,
  streaming,
}: {
  activity: ActivityCounts;
  streaming: boolean;
}) {
  const parts: string[] = [];
  if (activity.added > 0) parts.push(`${activity.added} added`);
  if (activity.enriched > 0) parts.push(`${activity.enriched} enriched`);
  if (activity.contacted > 0) parts.push(`${activity.contacted} contacted`);

  const label =
    parts.length > 0
      ? `Agent: ${parts.join(" · ")}`
      : streaming
        ? "Agent working..."
        : "";

  if (!label) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2"
    >
      <div className="bg-background/90 border-border flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-sm backdrop-blur">
        <Sparkles className={cn("h-3.5 w-3.5", streaming && "animate-pulse")} />
        <span className="tabular-nums">{label}</span>
      </div>
    </div>
  );
}

function CampaignSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="bg-muted/60 h-7 w-64 animate-pulse rounded" />
              <div className="bg-muted/40 h-4 w-40 animate-pulse rounded" />
            </div>
            <div className="flex gap-2">
              <div className="bg-muted/40 h-8 w-28 animate-pulse rounded-lg" />
              <div className="bg-muted/40 h-8 w-32 animate-pulse rounded-lg" />
              <div className="bg-muted/40 h-8 w-24 animate-pulse rounded-lg" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <div className="bg-muted/40 col-span-2 h-24 animate-pulse rounded-lg md:col-span-2" />
          <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />
          <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />
          <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />
          <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="bg-muted/40 h-6 w-24 animate-pulse rounded" />
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-muted/30 h-14 animate-pulse rounded-lg"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
