import { withAction } from "@/lib/services/cost-tracker";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { ExaService } from "@/lib/services/exa-service";
import {
  findOrCreatePerson,
  linkPersonToCampaign,
} from "@/lib/services/knowledge-base";
import {
  findPeopleOnDomain,
  filterContactsByCompany,
  type CandidateContact,
} from "@/lib/services/contact-filter";
import { parseLinkedInTitle } from "@/lib/utils";

export const maxDuration = 120;

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { companyId, campaignId } = body as {
    companyId: string;
    campaignId: string;
  };
  if (!companyId || !campaignId) {
    return Response.json(
      { error: "companyId and campaignId are required" },
      { status: 400 },
    );
  }

  // Get campaign ICP for target titles (also ownership check -- defense in
  // depth on top of RLS)
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("icp, user_id")
    .eq("id", campaignId)
    .single();

  if (campaignError || !campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const icp = campaign.icp as Record<string, unknown> | null;
  const targetTitles = (icp?.targetTitles as string[] | undefined) || [];
  // Bound to avoid per-user Exa spend blowouts.
  const boundedTitles = targetTitles.slice(0, 5);

  // companyId is a campaign_organizations link ID -- resolve the organization
  const { data: link, error: linkError } = await supabase
    .from("campaign_organizations")
    .select(
      "organization_id, organization:organizations(name, domain, industry, location, description)",
    )
    .eq("id", companyId)
    .single();

  if (linkError || !link) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const orgId = link.organization_id;
  const org = link.organization as unknown as {
    name: string;
    domain: string | null;
    industry: string | null;
    location: string | null;
    description: string | null;
  };

  return withAction(`Find contacts: ${org.name}`, async () => {
    let totalFound = 0;

    // Dedup against existing people linked to this campaign (by LinkedIn URL)
    const { data: existingLinks } = await supabase
      .from("campaign_people")
      .select("person:people(linkedin_url)")
      .eq("campaign_id", campaignId);

    const existingUrls = new Set(
      (existingLinks || [])
        .map(
          (l) =>
            (l.person as unknown as { linkedin_url: string | null } | null)
              ?.linkedin_url,
        )
        .filter(Boolean) as string[],
    );

    // ── Phase 1: Search the company's own website for team/staff ───────
    if (org.domain) {
      try {
        const domainPeople = await findPeopleOnDomain(org.domain, org.name);
        for (const dp of domainPeople) {
          if (dp.linkedinUrl && existingUrls.has(dp.linkedinUrl)) continue;

          const person = await findOrCreatePerson({
            name: dp.name,
            title: dp.title,
            linkedin_url: dp.linkedinUrl,
            work_email: dp.email,
            organization_id: orgId,
            source: "website",
          });

          await linkPersonToCampaign(person.id, campaignId);
          if (dp.linkedinUrl) existingUrls.add(dp.linkedinUrl);
          totalFound++;
        }
      } catch (err) {
        console.error("[find-contacts] Domain scrape failed:", err);
      }
    }

    // ── Phase 2: LinkedIn search with LLM filtering ────────────────────
    if (boundedTitles.length > 0) {
      const exa = new ExaService();
      const searchResults = await Promise.all(
        boundedTitles.map(async (title: string) => {
          const query = `"${org.name}" ${title} site:linkedin.com`;
          try {
            const result = await exa.search(query, {
              numResults: 3,
              category: "people" as const,
              includeText: true,
            });
            return { title, results: result.results };
          } catch {
            return { title, results: [] };
          }
        }),
      );

      // Collect deduplicated candidates for LLM filtering
      const seenUrls = new Set<string>();
      const candidates: Array<
        CandidateContact & { searchTitle: string; linkedinUrl: string | null }
      > = [];

      for (const search of searchResults) {
        for (const result of search.results) {
          if (seenUrls.has(result.url)) continue;
          seenUrls.add(result.url);

          const linkedinUrl = result.url.includes("linkedin.com")
            ? result.url
            : null;
          if (linkedinUrl && existingUrls.has(linkedinUrl)) continue;

          const parsed = parseLinkedInTitle(result.title);

          candidates.push({
            name: parsed.name,
            title: parsed.title || search.title,
            linkedinUrl,
            rawHeadline: result.title,
            searchTitle: search.title,
          });
        }
      }

      if (candidates.length > 0) {
        const company = {
          name: org.name,
          domain: org.domain,
          industry: org.industry,
          location: org.location,
          description: org.description,
        };
        const verified = await filterContactsByCompany(company, candidates);

        for (const v of verified) {
          const candidate = candidates[v.index];
          if (!candidate) continue;

          const person = await findOrCreatePerson({
            name: v.name,
            title: v.title,
            linkedin_url: candidate.linkedinUrl,
            organization_id: orgId,
            source: "exa",
          });

          await linkPersonToCampaign(person.id, campaignId);
          totalFound++;
        }
      }
    }

    return Response.json({
      companyId,
      companyName: org.name,
      totalFound,
      targetTitles,
    });
  }); // end withAction
}
