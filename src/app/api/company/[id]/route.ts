import { getSupabaseAndUser } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase } = ctx;

  const { id: orgId } = await params;

  // Get organization
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single();

  if (orgError || !org) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  // Get campaign_organizations link for score/approach
  const { data: campOrgs } = await supabase
    .from("campaign_organizations")
    .select(
      "relevance_score, score_reason, suggested_approach, readiness_tag, campaign_id",
    )
    .eq("organization_id", orgId)
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .limit(1);

  const campOrg = campOrgs?.[0] as Record<string, unknown> | undefined;

  // Get signal results
  const { data: signalRows } = await supabase
    .from("signal_results")
    .select(
      "output, status, ran_at, signal:signals!inner(name, slug, category)",
    )
    .eq("organization_id", orgId)
    .eq("status", "success")
    .order("ran_at", { ascending: false })
    .limit(50);

  const signals = (signalRows ?? []).map((sr) => {
    const signal = sr.signal as unknown as { name: string; slug: string };
    const output = sr.output as Record<string, unknown>;
    return {
      signalName: signal.name,
      summary: (output.summary as string) ?? "",
      confidence: (output.confidence as string) ?? "low",
      found: (output.found as boolean) ?? false,
      evidence: Array.isArray(output.evidence)
        ? (output.evidence as Array<Record<string, unknown>>)
            .slice(0, 3)
            .map((e) => ({
              url: (e.url as string) ?? "",
              snippet: (e.snippet as string) ?? "",
            }))
        : [],
    };
  });

  // Get contacts (people linked via campaign_people for campaigns that include this org)
  let contacts: Array<Record<string, unknown>> = [];

  if (campOrg?.campaign_id) {
    const { data: personLinks } = await supabase
      .from("campaign_people")
      .select(
        `
        person_id,
        priority_score,
        person:people!inner(
          id,
          name,
          title,
          linkedin_url,
          work_email,
          organization_id,
          enrichment_status,
          enrichment_data
        )
      `,
      )
      .eq("campaign_id", campOrg.campaign_id as string)
      .order("priority_score", { ascending: false, nullsFirst: false })
      .limit(20);

    // Filter to only contacts at this organization
    contacts = ((personLinks ?? []) as Array<Record<string, unknown>>).filter(
      (link) => {
        const person = link.person as Record<string, unknown>;
        return person.organization_id === orgId;
      },
    );
  }

  // Also find people directly linked to this org even without campaign link
  if (contacts.length === 0) {
    const { data: directPeople } = await supabase
      .from("people")
      .select(
        "id, name, title, linkedin_url, work_email, enrichment_status, enrichment_data",
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(20);

    contacts = (directPeople ?? []).map((p) => ({
      person_id: p.id,
      priority_score: null,
      person: p,
    }));
  }

  // Build enrichment intel
  const enrichment = (org.enrichment_data ?? {}) as Record<string, unknown>;
  const apollo = (enrichment.apollo ?? {}) as Record<string, unknown>;
  const website = (enrichment.website ?? {}) as Record<string, unknown>;
  const searches = (enrichment.searches ?? []) as Array<
    Record<string, unknown>
  >;
  const newsSearch = searches.find((s) => s.category === "funding");
  const recentNews = newsSearch
    ? ((newsSearch.results ?? []) as Array<Record<string, unknown>>)
        .slice(0, 5)
        .map((r) => ({
          title: r.title as string,
          url: r.url as string,
          date: r.publishedDate as string,
        }))
    : [];

  return Response.json({
    orgId: org.id,
    name: org.name,
    domain: org.domain,
    industry: (apollo.industry as string) ?? org.industry,
    location: (apollo.location as string) ?? org.location,
    description: org.description,
    headcount: (apollo.headcount as number) ?? null,
    score: (campOrg?.relevance_score as number) ?? null,
    scoreReason: (campOrg?.score_reason as string) ?? null,
    suggestedApproach: (campOrg?.suggested_approach as string) ?? null,
    signals: signals.filter((s) => s.found),
    contacts: contacts.map((link) => {
      const person = link.person as Record<string, unknown>;
      return {
        personId: person.id,
        name: person.name,
        title: person.title,
        linkedinUrl: person.linkedin_url,
        email: person.work_email,
        priorityScore: link.priority_score,
        enrichmentStatus: person.enrichment_status,
        enrichmentData: person.enrichment_data ?? null,
      };
    }),
    websiteSummary: (website.summary as string) ?? null,
    techStack: (apollo.techStack as string[]) ?? [],
    fundingStage: (apollo.latestFundingRound as string) ?? null,
    recentNews,
  });
}
