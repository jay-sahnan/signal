import { getSupabaseAndUser } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase } = ctx;

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset"); // qa | customer-intelligence | proactive-agents

  // Get campaigns filtered by preset
  let campaignQuery = supabase
    .from("campaigns")
    .select("id, name, icp_preset_slug, status");
  if (preset) {
    campaignQuery = campaignQuery.eq("icp_preset_slug", preset);
  }
  const { data: campaigns } = await campaignQuery;
  const campaignIds = (campaigns ?? []).map((c) => c.id as string);

  if (campaignIds.length === 0) {
    return Response.json({
      stats: {
        totalCompanies: 0,
        qualified: 0,
        readyToContact: 0,
        avgScore: 0,
      },
      targets: [],
      recentChanges: [],
    });
  }

  // Fetch only enriched/scored companies — skip pending ones
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
      approach_generated_at,
      organization:organizations!inner(
        id,
        name,
        domain,
        industry,
        location,
        description,
        enrichment_data,
        enrichment_status
      )
    `,
    )
    .in("campaign_id", campaignIds)
    .not("relevance_score", "is", null)
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .limit(200);

  // Supabase !inner joins return the relation as the object directly, but TS
  // types it as an array. Cast rows to unknown first.
  const companies = (companyRows ?? []) as unknown as Array<
    Record<string, unknown>
  >;

  // Compute stats
  const totalCompanies = companies.length;
  const qualified = companies.filter((c) => c.status === "qualified").length;
  const readyToContact = companies.filter(
    (c) => c.readiness_tag === "ready_to_contact",
  ).length;
  const scores = companies
    .map((c) => c.relevance_score as number | null)
    .filter((s): s is number => s !== null);
  const avgScore =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) /
        10
      : 0;

  // Get signal results for these companies
  const orgIds = companies.map((c) => {
    const org = c.organization as Record<string, unknown>;
    return org.id as string;
  });

  let signalResults: Array<Record<string, unknown>> = [];
  if (orgIds.length > 0) {
    const { data } = await supabase
      .from("signal_results")
      .select(
        "organization_id, output, status, ran_at, signal:signals!inner(name, slug, category)",
      )
      .in("organization_id", orgIds)
      .in("campaign_id", campaignIds)
      .eq("status", "success")
      .order("ran_at", { ascending: false })
      .limit(200);
    signalResults = (data ?? []) as Array<Record<string, unknown>>;
  }

  // Get contacts for these companies
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
          id,
          name,
          title,
          linkedin_url,
          work_email,
          organization_id
        )
      `,
      )
      .in("campaign_id", campaignIds)
      .order("priority_score", { ascending: false, nullsFirst: false })
      .limit(200);
    contactRows = (data ?? []) as Array<Record<string, unknown>>;
  }

  // Build signal map: orgId -> signals[]
  const signalMap = new Map<string, Array<Record<string, unknown>>>();
  for (const sr of signalResults) {
    const orgId = sr.organization_id as string;
    if (!signalMap.has(orgId)) signalMap.set(orgId, []);
    const output = sr.output as Record<string, unknown>;
    const signal = sr.signal as Record<string, unknown>;
    signalMap.get(orgId)!.push({
      signalName: signal.name,
      signalSlug: signal.slug,
      summary: output.summary ?? "",
      confidence: output.confidence ?? "low",
      found: output.found ?? false,
      ranAt: sr.ran_at,
      evidence: Array.isArray(output.evidence)
        ? (output.evidence as Array<Record<string, unknown>>).slice(0, 3)
        : [],
    });
  }

  // Build contact map: orgId -> contacts[]
  const contactMap = new Map<string, Array<Record<string, unknown>>>();
  for (const cr of contactRows) {
    const person = cr.person as Record<string, unknown>;
    const orgId = person.organization_id as string;
    if (!orgId) continue;
    if (!contactMap.has(orgId)) contactMap.set(orgId, []);
    const contacts = contactMap.get(orgId)!;
    if (contacts.length < 3) {
      contacts.push({
        personId: person.id,
        name: person.name,
        title: person.title,
        linkedinUrl: person.linkedin_url,
        email: person.work_email,
        priorityScore: cr.priority_score,
      });
    }
  }

  // Map campaign IDs to names
  const campaignNameMap = new Map((campaigns ?? []).map((c) => [c.id, c.name]));

  // Build target cards
  const targets = companies.map((c) => {
    const org = c.organization as Record<string, unknown>;
    const orgId = org.id as string;
    const enrichment = (org.enrichment_data ?? {}) as Record<string, unknown>;
    const apollo = (enrichment.apollo ?? {}) as Record<string, unknown>;
    const searches = (enrichment.searches ?? []) as Array<
      Record<string, unknown>
    >;

    // Extract intel from enrichment data
    const newsSearch = searches.find((s) => s.category === "funding");
    const recentNews = newsSearch
      ? ((newsSearch.results ?? []) as Array<Record<string, unknown>>)
          .slice(0, 3)
          .map((r) => ({
            title: r.title as string,
            url: r.url as string,
            date: r.publishedDate as string,
          }))
      : [];

    const hiring = (enrichment.hiring ?? {}) as Record<string, unknown>;
    const jobs = (hiring.jobs ?? []) as Array<Record<string, unknown>>;

    return {
      companyId: c.id,
      orgId,
      campaignId: c.campaign_id,
      campaignName: campaignNameMap.get(c.campaign_id as string) ?? "",
      icpPreset: preset,
      name: org.name,
      domain: org.domain,
      industry: (apollo.industry as string) ?? org.industry,
      location: (apollo.location as string) ?? org.location,
      headcount: apollo.headcount ?? null,
      score: c.relevance_score,
      scoreReason: c.score_reason,
      readinessTag: c.readiness_tag,
      suggestedApproach: c.suggested_approach,
      signals: (signalMap.get(orgId) ?? []).filter((s) => s.found === true),
      intel: {
        websiteSummary:
          ((enrichment.website as Record<string, unknown>)
            ?.summary as string) ?? null,
        recentNews,
        hiring: {
          totalJobs: jobs.length,
          relevantRoles: jobs
            .slice(0, 5)
            .map((j) => j.title as string)
            .filter(Boolean),
        },
        fundingStage: (apollo.latestFundingRound as string) ?? null,
        techStack: (apollo.techStack as string[]) ?? [],
        estimatedRevenue: apollo.estimatedRevenue ?? null,
      },
      topContacts: contactMap.get(orgId) ?? [],
    };
  });

  // Recent tracking changes
  let recentChanges: Array<Record<string, unknown>> = [];
  if (campaignIds.length > 0) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data } = await supabase
      .from("tracking_changes")
      .select(
        `
        description,
        detected_at,
        tracking_config:tracking_configs!inner(
          organization:organizations(name),
          signal:signals(name)
        )
      `,
      )
      .gte("detected_at", sevenDaysAgo)
      .order("detected_at", { ascending: false })
      .limit(20);

    recentChanges = (
      (data ?? []) as unknown as Array<Record<string, unknown>>
    ).map((ch) => {
      const config = ch.tracking_config as Record<string, unknown> | null;
      const org = config?.organization as Record<string, unknown> | null;
      const signal = config?.signal as Record<string, unknown> | null;
      return {
        companyName: (org?.name as string) ?? "Unknown",
        signalName: (signal?.name as string) ?? "Unknown",
        changeDescription: ch.description as string,
        detectedAt: ch.detected_at as string,
      };
    });
  }

  return Response.json({
    stats: {
      totalCompanies,
      qualified,
      readyToContact,
      avgScore,
    },
    targets,
    recentChanges,
  });
}
