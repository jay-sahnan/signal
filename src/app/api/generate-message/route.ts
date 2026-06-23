import { getSupabaseAndUser } from "@/lib/supabase/server";
import { generateEmail } from "@/lib/rulebase/generate-email";

export const maxDuration = 60;

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase } = ctx;

  const body = await request.json();
  const { personId, organizationId } = body as {
    personId: string;
    organizationId: string;
  };

  if (!personId || !organizationId) {
    return Response.json(
      { error: "personId and organizationId are required" },
      { status: 400 },
    );
  }

  // Get person data
  const { data: person } = await supabase
    .from("people")
    .select("name, title, linkedin_url, enrichment_data")
    .eq("id", personId)
    .single();

  if (!person) {
    return Response.json({ error: "Person not found" }, { status: 404 });
  }

  // Get organization data
  const { data: org } = await supabase
    .from("organizations")
    .select("name, domain, industry, location, enrichment_data")
    .eq("id", organizationId)
    .single();

  if (!org) {
    return Response.json({ error: "Organization not found" }, { status: 404 });
  }

  // Get signals for this org
  const { data: signalResults } = await supabase
    .from("signal_results")
    .select("output, signal:signals!inner(name, slug)")
    .eq("organization_id", organizationId)
    .eq("status", "success")
    .order("ran_at", { ascending: false })
    .limit(10);

  const signals = (signalResults ?? []).map((sr) => {
    const signal = sr.signal as unknown as { name: string; slug: string };
    const output = sr.output as Record<string, unknown>;
    return {
      name: signal.name,
      summary: (output.summary as string) ?? "",
    };
  });

  // Get campaign info for ICP context
  const { data: campaignLinks } = await supabase
    .from("campaign_organizations")
    .select("campaign:campaigns(icp_preset_slug, offering, positioning)")
    .eq("organization_id", organizationId)
    .limit(1);

  const campaign = campaignLinks?.[0]?.campaign as unknown as {
    icp_preset_slug: string;
    offering: Record<string, unknown>;
    positioning: Record<string, unknown>;
  } | null;

  const enrichment = (org.enrichment_data ?? {}) as Record<string, unknown>;
  const apollo = (enrichment.apollo ?? {}) as Record<string, unknown>;
  const hiring = (enrichment.hiring ?? {}) as Record<string, unknown>;
  const jobs = (hiring.jobs ?? []) as Array<Record<string, unknown>>;

  const searches = (enrichment.searches ?? []) as Array<
    Record<string, unknown>
  >;
  const newsSearch = searches.find((s) => s.category === "funding");
  const recentNews = newsSearch
    ? ((newsSearch.results ?? []) as Array<Record<string, unknown>>)
        .slice(0, 3)
        .map((r) => ({ title: r.title as string }))
    : [];

  const presetName =
    campaign?.icp_preset_slug === "customer-intelligence"
      ? "Customer Intelligence"
      : campaign?.icp_preset_slug === "proactive-agents"
        ? "Proactive Agents"
        : "QA";

  const email = await generateEmail({
    contactName: person.name as string,
    contactTitle: person.title as string | null,
    companyName: org.name as string,
    companyLocation: (org.location as string) ?? null,
    companyIndustry: (org.industry as string) ?? null,
    companyHeadcount: (apollo.headcount as number) ?? null,
    signals,
    recentNews,
    hiring: {
      totalJobs: jobs.length,
      relevantRoles: jobs
        .slice(0, 5)
        .map((j) => j.title as string)
        .filter(Boolean),
    },
    icpPresetName: presetName,
    icpValueProp:
      (campaign?.offering?.valueProposition as string) ??
      "AI-powered conversation monitoring",
    icpAngle:
      (campaign?.positioning?.angle as string) ?? "Compliance coverage gap",
  });

  return Response.json({
    personId,
    organizationId,
    subject: email.subject,
    body: email.body,
  });
}
