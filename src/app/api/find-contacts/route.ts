import { paidContactDiscovery } from "@/lib/billing/contact-discovery";
import { CreditExecutionError } from "@/lib/billing/credit-execution";
import { withAction } from "@/lib/services/cost-tracker";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { findContactsForOrganization } from "@/lib/services/contact-discovery";

export const maxDuration = 120;

export async function POST(request: Request) {
  try { return await discover(request); }
  catch (error) {
    return Response.json({ error: error instanceof CreditExecutionError ? error.message : "Contact discovery failed. Retry the same request." },
      { status: error instanceof CreditExecutionError ? error.status : 500 });
  }
}
async function discover(request: Request) {
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
      "organization_id, campaign_id, organization:organizations(name, domain, industry, location, description)",
    )
    .eq("id", companyId)
    .single();

  if (linkError || !link) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  // The link has to belong to the campaign the caller named. Both ownership
  // checks can pass individually for a caller who owns two campaigns, and a
  // mismatched pair then writes campaign_people rows into a campaign with no
  // campaign_organizations row for that org: contacts found inside a campaign
  // and invisible in its UI, the exact dead-end find-more-people closed.
  if (link.campaign_id !== campaignId) {
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

  return withAction(
    `Find contacts: ${org.name}`,
    async () => {
      // All discovery goes through the one shared path — this route used to hold
      // its own near-identical copy of it, as did the findContacts tool and the
      // enrich-company route, so any fix landed in one and stayed broken in two.
      const result = await paidContactDiscovery({
        identity: { userId: user.id, source: "web" }, key: request.headers.get("Idempotency-Key"),
        request: { organizationId: orgId, campaignId, titles: null, numResults: 3, linkTeamPage: "matching" },
      }, async () => ({ ...await findContactsForOrganization(supabase, {
        organizationId: orgId,
        campaignId,
        titles: boundedTitles,
        numResults: 3,
      }), targetTitles: boundedTitles }));

      return Response.json({
        contacts: result.contacts,
        totalFound: result.totalFound,
        targetTitles: result.targetTitles,
        verifiedCount: result.verifiedCount,
        uncertainCount: result.uncertainCount,
        rejectedAsWrongCompany: result.rejectedAsWrongCompany,
        error: result.error,
      });
    },
    user.id,
  ); // end withAction
}
