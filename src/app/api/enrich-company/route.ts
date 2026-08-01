import type { SupabaseClient } from "@supabase/supabase-js";

import { withAction } from "@/lib/services/cost-tracker";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { enrichAndFindContacts } from "@/lib/services/company-enrichment";

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
    campaignId?: string;
  };
  if (!companyId) {
    return Response.json({ error: "companyId is required" }, { status: 400 });
  }

  // Defense-in-depth ownership check. If campaignId is supplied, verify
  // it belongs to the signed-in user directly. Otherwise we'll derive it
  // from the campaign_organizations row below.
  if (campaignId) {
    const { data: campaignRow, error: campaignError } = await supabase
      .from("campaigns")
      .select("user_id")
      .eq("id", campaignId)
      .single();
    if (campaignError || !campaignRow) {
      return Response.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (campaignRow.user_id !== user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // companyId is a campaign_organizations link ID -- resolve the organization.
  // Join through campaigns.user_id so we can also verify ownership when
  // campaignId wasn't explicitly supplied.
  const { data: link, error: linkError } = await supabase
    .from("campaign_organizations")
    .select(
      "organization_id, campaign_id, organization:organizations(*), campaign:campaigns(user_id)",
    )
    .eq("id", companyId)
    .single();

  if (linkError || !link) {
    // Try as a direct organization ID. Organizations are not user-scoped,
    // so the only ownership signal here is the campaignId check above (if
    // supplied). Without a campaign context, fall back to RLS + the
    // authenticated session.
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", companyId)
      .single();

    if (orgError || !org) {
      return Response.json({ error: "Company not found" }, { status: 404 });
    }

    return enrichOrganization(
      supabase,
      org as Record<string, unknown>,
      companyId,
      campaignId,
    );
  }

  // Ownership check via the link's parent campaign.
  const linkCampaign = link.campaign as unknown as { user_id: string } | null;
  if (!linkCampaign) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }
  if (linkCampaign.user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!link.organization) {
    return Response.json(
      { error: "Organization data missing" },
      { status: 404 },
    );
  }

  const org = link.organization as unknown as Record<string, unknown>;
  const orgId = link.organization_id;

  return enrichOrganization(supabase, org, orgId, campaignId);
}

/**
 * Delegates to the company-enrichment service and wraps its result in the
 * route's response shape. `withAction` lives here (not in the service) so
 * cost attribution stays with the caller — the QStash target-list processor
 * wraps the same service in its own action.
 */
async function enrichOrganization(
  supabase: SupabaseClient,
  org: Record<string, unknown>,
  orgId: string,
  campaignId?: string,
) {
  return withAction(`Enrich company: ${org.name}`, async () => {
    const result = await enrichAndFindContacts(
      supabase,
      orgId,
      campaignId ?? null,
    );

    if (!result.enriched) {
      return Response.json({
        companyId: orgId,
        enrichmentData: result.enrichmentData,
        skipped: true,
        contactsFound: result.contactsFound,
      });
    }

    return Response.json({
      companyId: orgId,
      enrichmentData: result.enrichmentData,
      contactsFound: result.contactsFound,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  }); // end withAction
}
