import { getSupabaseAndUser } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase } = ctx;

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset"); // optional filter

  // Get all campaigns (optionally filtered by preset)
  let campaignQuery = supabase
    .from("campaigns")
    .select("id, name, icp_preset_slug");
  if (preset) campaignQuery = campaignQuery.eq("icp_preset_slug", preset);
  const { data: campaigns } = await campaignQuery;
  const campaignIds = (campaigns ?? []).map((c) => c.id as string);
  const campaignMap = new Map(
    (campaigns ?? []).map((c) => [
      c.id as string,
      { name: c.name as string, preset: c.icp_preset_slug as string },
    ]),
  );

  if (campaignIds.length === 0) {
    return Response.json({ companies: [] });
  }

  // Fetch all companies with enrichment
  const { data: companyRows } = await supabase
    .from("campaign_organizations")
    .select(
      `
      id,
      campaign_id,
      organization_id,
      relevance_score,
      score_reason,
      status,
      readiness_tag,
      suggested_approach,
      organization:organizations!inner(
        id, name, domain, industry, location, description,
        enrichment_data, enrichment_status
      )
    `,
    )
    .in("campaign_id", campaignIds)
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .limit(100);

  const companies = (companyRows ?? []) as unknown as Array<
    Record<string, unknown>
  >;

  // Fetch signal results for all orgs
  const orgIds = [
    ...new Set(
      companies.map((c) => {
        const org = c.organization as Record<string, unknown>;
        return org.id as string;
      }),
    ),
  ];

  let signalResults: Array<Record<string, unknown>> = [];
  if (orgIds.length > 0) {
    const { data } = await supabase
      .from("signal_results")
      .select(
        "organization_id, output, status, ran_at, signal:signals!inner(name, slug, category)",
      )
      .in("organization_id", orgIds)
      .eq("status", "success")
      .order("ran_at", { ascending: false })
      .limit(500);
    signalResults = (data ?? []) as unknown as Array<Record<string, unknown>>;
  }

  // Fetch contacts
  let contactRows: Array<Record<string, unknown>> = [];
  if (campaignIds.length > 0) {
    const { data } = await supabase
      .from("campaign_people")
      .select(
        `
        campaign_id,
        priority_score,
        score_reason,
        generated_email_subject,
        generated_email_body,
        person:people!inner(
          name, title, linkedin_url, work_email, organization_id
        )
      `,
      )
      .in("campaign_id", campaignIds)
      .order("priority_score", { ascending: false, nullsFirst: false })
      .limit(300);
    contactRows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  }

  // Build maps
  const signalMap = new Map<string, Array<Record<string, unknown>>>();
  for (const sr of signalResults) {
    const orgId = sr.organization_id as string;
    if (!signalMap.has(orgId)) signalMap.set(orgId, []);
    const output = sr.output as Record<string, unknown>;
    const signal = sr.signal as Record<string, unknown>;
    signalMap.get(orgId)!.push({
      signalName: signal.name,
      signalSlug: signal.slug,
      category: signal.category,
      found: output.found ?? false,
      summary: output.summary ?? "",
      confidence: output.confidence ?? "low",
      ranAt: sr.ran_at,
      evidence: Array.isArray(output.evidence)
        ? (output.evidence as Array<Record<string, unknown>>).slice(0, 5)
        : [],
    });
  }

  const contactMap = new Map<string, Array<Record<string, unknown>>>();
  for (const cr of contactRows) {
    const person = cr.person as Record<string, unknown>;
    const orgId = person.organization_id as string;
    if (!orgId) continue;
    if (!contactMap.has(orgId)) contactMap.set(orgId, []);
    contactMap.get(orgId)!.push({
      name: person.name,
      title: person.title,
      linkedinUrl: person.linkedin_url,
      email: person.work_email,
      priorityScore: cr.priority_score,
      emailSubject: cr.generated_email_subject,
      emailBody: cr.generated_email_body,
    });
  }

  // Deduplicate companies by org ID (same company may be in multiple campaigns)
  const seen = new Set<string>();
  const result = companies
    .filter((c) => {
      const org = c.organization as Record<string, unknown>;
      const orgId = org.id as string;
      if (seen.has(orgId)) return false;
      seen.add(orgId);
      return true;
    })
    .map((c) => {
      const org = c.organization as Record<string, unknown>;
      const orgId = org.id as string;
      const enrichment = (org.enrichment_data ?? {}) as Record<string, unknown>;
      const apollo = (enrichment.apollo ?? {}) as Record<string, unknown>;
      const campaign = campaignMap.get(c.campaign_id as string);
      const signals = (signalMap.get(orgId) ?? []).filter(
        (s) => s.found === true,
      );
      const contacts = contactMap.get(orgId) ?? [];

      const hiring = (enrichment.hiring ?? {}) as Record<string, unknown>;
      const jobs = (hiring.jobs ?? []) as Array<Record<string, unknown>>;
      const searches = (enrichment.searches ?? []) as Array<
        Record<string, unknown>
      >;
      const newsSearch = searches.find((s) => s.category === "funding");

      return {
        orgId,
        name: org.name,
        domain: org.domain,
        industry: (apollo.industry as string) ?? org.industry,
        location: (apollo.location as string) ?? org.location,
        headcount: apollo.headcount ?? null,
        revenue: apollo.estimatedRevenue ?? null,
        score: c.relevance_score,
        scoreReason: c.score_reason,
        status: c.status,
        readinessTag: c.readiness_tag,
        suggestedApproach: c.suggested_approach,
        icpPreset: campaign?.preset ?? null,
        icpName: campaign?.name ?? null,
        // Enrichment intel
        websiteSummary:
          ((enrichment.website as Record<string, unknown>)
            ?.summary as string) ?? null,
        techStack: (apollo.techStack as string[]) ?? [],
        fundingStage: (apollo.latestFundingRound as string) ?? null,
        fundingTotal: apollo.fundingTotal ?? null,
        phone: apollo.phone ?? null,
        linkedinUrl: apollo.linkedinUrl ?? null,
        hiring: {
          totalJobs: jobs.length,
          roles: jobs
            .slice(0, 8)
            .map((j) => j.title as string)
            .filter(Boolean),
        },
        recentNews: newsSearch
          ? ((newsSearch.results ?? []) as Array<Record<string, unknown>>)
              .slice(0, 3)
              .map((r) => ({
                title: r.title as string,
                url: r.url as string,
                date: r.publishedDate as string,
              }))
          : [],
        // Signals
        signals,
        signalCount: signals.length,
        // Contacts
        contacts,
        contactCount: contacts.length,
      };
    });

  return Response.json({ companies: result });
}
