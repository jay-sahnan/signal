import { getSupabaseAndUser } from "@/lib/supabase/server";
import {
  findOrCreateOrganization,
  linkOrganizationToCampaign,
  normalizeDomain,
} from "@/lib/services/knowledge-base";

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

  const { campaignId, companies } = body as {
    campaignId: string;
    companies: Array<{
      name: string;
      domain?: string | null;
      url?: string | null;
      industry?: string | null;
      location?: string | null;
      description?: string | null;
    }>;
  };

  if (!campaignId) {
    return Response.json({ error: "campaignId is required" }, { status: 400 });
  }
  if (!companies || !Array.isArray(companies) || companies.length === 0) {
    return Response.json(
      { error: "companies array is required and must not be empty" },
      { status: 400 },
    );
  }

  // Verify campaign exists and belongs to the signed-in user (defense in
  // depth on top of RLS).
  const { data: campaignRow, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, user_id")
    .eq("id", campaignId)
    .single();

  if (campaignError || !campaignRow) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaignRow.user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch existing domains already linked to this campaign
  const { data: existingLinks } = await supabase
    .from("campaign_organizations")
    .select("organization:organizations(domain)")
    .eq("campaign_id", campaignId);

  const existingDomains = new Set(
    (existingLinks || [])
      .map(
        (l) =>
          (l.organization as unknown as { domain: string | null } | null)
            ?.domain,
      )
      .filter(Boolean) as string[],
  );

  const seenDomains = new Set<string>();
  const importedLinks: Array<{ linkId: string; orgId: string; name: string }> =
    [];
  let imported = 0;
  let skipped = 0;

  for (const company of companies) {
    if (!company.name?.trim()) {
      skipped++;
      continue;
    }

    let domain: string | null = company.domain?.trim() || null;

    // Extract domain from URL if no domain provided
    if (!domain && company.url) {
      try {
        domain = new URL(
          company.url.startsWith("http")
            ? company.url
            : `https://${company.url}`,
        ).hostname;
      } catch {
        // skip
      }
    }

    // Normalize domain
    if (domain) {
      domain = normalizeDomain(domain);
    }

    // Dedup by domain within campaign
    if (domain && (existingDomains.has(domain) || seenDomains.has(domain))) {
      skipped++;
      continue;
    }
    if (domain) seenDomains.add(domain);

    const org = await findOrCreateOrganization({
      name: company.name.trim(),
      domain,
      url: company.url?.trim() || (domain ? `https://${domain}` : null),
      industry: company.industry?.trim() || null,
      location: company.location?.trim() || null,
      description: company.description?.trim() || null,
      source: "csv",
    });

    const link = await linkOrganizationToCampaign(org.id, campaignId);
    importedLinks.push({
      linkId: link.id,
      orgId: org.id,
      name: company.name.trim(),
    });
    imported++;
  }

  return Response.json({ imported, skipped, importedLinks });
}
