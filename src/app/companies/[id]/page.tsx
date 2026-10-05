"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { toast } from "sonner";
import { requestContactEnrichment } from "@/lib/billing/contact-enrichment-request";
import { useParams } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { AddPersonDialog } from "@/components/company/add-person-dialog";
import { CampaignSelector } from "@/components/company/campaign-selector";
import { ClassifyButton } from "@/components/company/classify-button";
import { FindMoreButton } from "@/components/company/find-more-button";
import { OrgChart, type OrgChartPerson } from "@/components/company/org-chart";
import { PersonDrawer } from "@/components/company/person-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import type {
  CampaignContact,
  EnrichmentData,
  Seniority,
} from "@/lib/types/campaign";
import { apiFetch } from "@/lib/api-fetch";

interface OrgRow {
  id: string;
  name: string;
  domain: string | null;
  url: string | null;
  industry: string | null;
}

interface PersonRow {
  id: string;
  name: string;
  title: string | null;
  department: string | null;
  seniority: Seniority | null;
  role_summary: string | null;
  bio_summary: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  work_email: string | null;
  personal_email: string | null;
  work_email_verified_at: string | null;
  personal_email_verified_at: string | null;
  work_email_source: string | null;
  work_email_verification: string | null;
  work_email_confidence: number | null;
  affiliation_source: string | null;
  affiliation_confidence: number | null;
  affiliation_evidence: string | null;
  enrichment_status: CampaignContact["enrichment_status"];
  enrichment_data: EnrichmentData;
  source: string | null;
  created_at: string;
  updated_at: string;
}

interface CampaignRow {
  id: string;
  name: string;
}

interface CampaignPersonRow {
  person_id: string;
  outreach_status: string;
}

export default function CompanyPage() {
  const { userId } = useAuth();
  const params = useParams<{ id: string }>();
  const companyId = params.id;

  const [org, setOrg] = useState<OrgRow | null>(null);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [statusByPerson, setStatusByPerson] = useState<Map<string, string>>(
    new Map(),
  );
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCore = useCallback(async () => {
    const supabase = createClient();

    const [orgRes, peopleRes, campaignsRes] = await Promise.all([
      supabase
        .from("organizations")
        .select("id, name, domain, url, industry")
        .eq("id", companyId)
        .maybeSingle(),
      supabase
        .from("people")
        .select(
          "id, name, title, department, seniority, role_summary, bio_summary, linkedin_url, twitter_url, work_email, personal_email, work_email_verified_at, personal_email_verified_at, work_email_source, work_email_verification, work_email_confidence, affiliation_source, affiliation_confidence, affiliation_evidence, enrichment_status, enrichment_data, source, created_at, updated_at",
        )
        .eq("organization_id", companyId)
        .order("name", { ascending: true }),
      supabase
        .from("campaign_organizations")
        .select("campaign:campaigns(id, name)")
        .eq("organization_id", companyId),
    ]);

    if (orgRes.error || !orgRes.data) {
      setError("Company not found");
      setLoading(false);
      return;
    }

    // A failed people or campaigns sub-query must not render the company as
    // "0 people" with an empty org chart: that reads as a data state, not an
    // outage.
    const subError = peopleRes.error || campaignsRes.error;
    if (subError) {
      setError(`Failed to load company data: ${subError.message}`);
      setLoading(false);
      return;
    }

    setOrg(orgRes.data as OrgRow);
    setPeople((peopleRes.data ?? []) as PersonRow[]);

    const camps: CampaignRow[] = (
      (campaignsRes.data ?? []) as Array<{
        campaign: CampaignRow | CampaignRow[] | null;
      }>
    )
      .map((row) =>
        Array.isArray(row.campaign) ? row.campaign[0] : row.campaign,
      )
      .filter((c): c is CampaignRow => c != null);
    setCampaigns(camps);

    if (campaignId === null && camps.length > 0) {
      setCampaignId(camps[0].id);
    }

    setLoading(false);
  }, [companyId, campaignId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCore();
  }, [fetchCore]);

  useEffect(() => {
    if (!campaignId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatusByPerson(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("campaign_people")
        .select("person_id, outreach_status")
        .eq("campaign_id", campaignId);
      if (cancelled) return;
      const map = new Map<string, string>();
      for (const row of (data ?? []) as CampaignPersonRow[]) {
        map.set(row.person_id, row.outreach_status);
      }
      setStatusByPerson(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const chartPeople: OrgChartPerson[] = useMemo(() => {
    return people.map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      department: p.department,
      seniority: p.seniority,
      role_summary: p.role_summary,
      linkedin_url: p.linkedin_url,
      work_email: p.work_email,
      outreach_status: statusByPerson.get(p.id) ?? null,
      enrichment_status: p.enrichment_status,
    }));
  }, [people, statusByPerson]);

  const uncategorizedCount = useMemo(
    () => people.filter((p) => !p.department).length,
    [people],
  );

  const enrichContact = useCallback(
    async function retryEnrichment(
      personId: string,
      newAttempt = false,
    ): Promise<void> {
      try {
        await requestContactEnrichment(userId, personId, newAttempt);
        await fetchCore();
      } catch (err) {
        console.error("[enrich] Failed:", err);
        toast.error(err instanceof Error ? err.message : "Enrichment failed", {
          description:
            "Retry keeps the same request. New enrichment can use additional credits; previous work may still be reserved.",
          action: {
            label: "New enrichment",
            onClick: () => void retryEnrichment(personId, true),
          },
        });
      }
    },
    [fetchCore, userId],
  );

  const selectedContact: CampaignContact | null = useMemo(() => {
    if (!selectedPersonId) return null;
    const p = people.find((row) => row.id === selectedPersonId);
    if (!p) return null;
    return {
      id: p.id,
      person_id: p.id,
      campaign_id: campaignId ?? "",
      organization_id: companyId,
      name: p.name,
      title: p.title,
      department: p.department,
      seniority: p.seniority,
      role_summary: p.role_summary,
      bio_summary: p.bio_summary,
      work_email: p.work_email,
      personal_email: p.personal_email,
      work_email_verified_at: p.work_email_verified_at,
      personal_email_verified_at: p.personal_email_verified_at,
      work_email_source: p.work_email_source,
      work_email_verification: p.work_email_verification,
      work_email_confidence: p.work_email_confidence,
      affiliation_source: p.affiliation_source,
      affiliation_confidence: p.affiliation_confidence,
      affiliation_evidence: p.affiliation_evidence,
      linkedin_url: p.linkedin_url,
      twitter_url: p.twitter_url,
      enrichment_status: p.enrichment_status,
      enrichment_data: p.enrichment_data,
      outreach_status:
        (statusByPerson.get(p.id) as CampaignContact["outreach_status"]) ??
        "not_contacted",
      priority_score: null,
      score_reason: null,
      readiness_tag: null,
      source: p.source,
      created_at: p.created_at,
      updated_at: p.updated_at,
      company: org
        ? { name: org.name, domain: org.domain, industry: org.industry }
        : null,
    };
  }, [selectedPersonId, people, statusByPerson, campaignId, companyId, org]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-[70vh] w-full" />
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="mx-auto max-w-7xl p-6">
        <p className="text-muted-foreground text-sm">
          {error ?? "Company not found"}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="type-title">{org.name}</h1>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
            {org.domain && (
              <a
                href={org.url ?? `https://${org.domain}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground inline-flex items-center gap-1"
              >
                {org.domain}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {org.industry && <span>· {org.industry}</span>}
            <span>· {people.length} people</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CampaignSelector
          campaigns={campaigns}
          value={campaignId}
          onChange={setCampaignId}
        />
        <div className="flex items-center gap-2">
          <AddPersonDialog
            organizationId={companyId}
            campaignId={campaignId ?? undefined}
            onAdded={fetchCore}
          />
          <ClassifyButton
            companyId={companyId}
            uncategorizedCount={uncategorizedCount}
            onComplete={fetchCore}
          />
          <FindMoreButton
            companyId={companyId}
            campaignId={campaignId ?? undefined}
            onComplete={fetchCore}
          />
        </div>
      </div>

      <OrgChart
        people={chartPeople}
        onPersonClick={(id) => setSelectedPersonId(id)}
        onPersonReclassify={async (personId, next) => {
          try {
            const res = await apiFetch(`/api/people/${personId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                department: next.department,
                seniority: next.seniority,
              }),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error ?? `HTTP ${res.status}`);
            }
            await fetchCore();
          } catch (err) {
            console.error("[reclassify] Failed:", err);
            await fetchCore();
          }
        }}
        onPersonRemove={async (personId) => {
          try {
            const res = await apiFetch(
              `/api/people/${personId}/from-company?organizationId=${companyId}`,
              { method: "DELETE" },
            );
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error ?? `HTTP ${res.status}`);
            }
            await fetchCore();
          } catch (err) {
            console.error("[remove-from-company] Failed:", err);
            await fetchCore();
          }
        }}
      />

      <PersonDrawer
        contact={selectedContact}
        onClose={() => setSelectedPersonId(null)}
        onEnrich={enrichContact}
        onRemove={async (personId) => {
          try {
            const res = await apiFetch(
              `/api/people/${personId}/from-company?organizationId=${companyId}`,
              { method: "DELETE" },
            );
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error ?? `HTTP ${res.status}`);
            }
            await fetchCore();
          } catch (err) {
            console.error("[remove-from-company] Failed:", err);
            await fetchCore();
          }
        }}
      />
    </div>
  );
}
