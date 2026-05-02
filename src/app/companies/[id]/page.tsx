"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { CampaignSelector } from "@/components/company/campaign-selector";
import { ClassifyButton } from "@/components/company/classify-button";
import { FindMoreButton } from "@/components/company/find-more-button";
import { OrgChart, type OrgChartPerson } from "@/components/company/org-chart";
import { PersonDrawer } from "@/components/company/person-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";

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
  seniority: string | null;
  role_summary: string | null;
  linkedin_url: string | null;
  work_email: string | null;
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
          "id, name, title, department, seniority, role_summary, linkedin_url, work_email",
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
    }));
  }, [people, statusByPerson]);

  const uncategorizedCount = useMemo(
    () => people.filter((p) => !p.department).length,
    [people],
  );

  const selectedPerson = useMemo(
    () => chartPeople.find((p) => p.id === selectedPersonId) ?? null,
    [chartPeople, selectedPersonId],
  );

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
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
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
          <ClassifyButton
            companyId={companyId}
            uncategorizedCount={uncategorizedCount}
            onComplete={fetchCore}
          />
          <FindMoreButton companyId={companyId} onComplete={fetchCore} />
        </div>
      </div>

      <OrgChart
        people={chartPeople}
        onPersonClick={(id) => setSelectedPersonId(id)}
      />

      <PersonDrawer
        person={selectedPerson}
        onClose={() => setSelectedPersonId(null)}
      />
    </div>
  );
}
