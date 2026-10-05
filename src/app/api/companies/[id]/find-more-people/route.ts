import { paidContactDiscovery } from "@/lib/billing/contact-discovery";
import { CreditExecutionError } from "@/lib/billing/credit-execution";
import { withAction } from "@/lib/services/cost-tracker";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { findContactsForOrganization } from "@/lib/services/contact-discovery";

export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return await discover(request, context); }
  catch (error) {
    return Response.json({ error: error instanceof CreditExecutionError ? error.message : "Contact discovery failed. Retry the same request." },
      { status: error instanceof CreditExecutionError ? error.status : 500 });
  }
}
async function discover(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: companyId } = await params;

  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  // The campaign the company page is scoped to, when it is scoped to one. A
  // bodyless POST is the unscoped case and stays supported: the standalone
  // company page can be viewed with no campaign selected, and people found
  // that way belong to the company alone. What is not supported any more is
  // finding people inside a campaign and quietly leaving them out of it.
  let campaignId: string | null = null;
  const body = (await request.json().catch(() => null)) as {
    campaignId?: unknown;
  } | null;
  if (body?.campaignId != null) {
    if (typeof body.campaignId !== "string") {
      return Response.json(
        { error: "campaignId must be a string" },
        { status: 400 },
      );
    }
    campaignId = body.campaignId;
  }

  // Ownership: the target org must belong to one of the user's campaigns
  // (same gate as classify-departments and /api/people/[id]/to-company).
  //
  // With a campaignId the same query answers a second question by narrowing to
  // that campaign: is this company actually in it. Owning the campaign and
  // owning the company are separate facts, and neither one puts the company in
  // the campaign. Checking only ownership would let a link be written from a
  // campaign that never asked about this company.
  let ownershipQuery = supabase
    .from("campaign_organizations")
    .select("campaign:campaigns!inner(user_id)")
    .eq("organization_id", companyId);
  if (campaignId) {
    ownershipQuery = ownershipQuery.eq("campaign_id", campaignId);
  }
  const { data: orgOwnership } = await ownershipQuery.limit(1).maybeSingle();

  const orgOwnerId =
    (orgOwnership?.campaign as unknown as { user_id?: string } | null)
      ?.user_id ?? null;
  if (!orgOwnerId || orgOwnerId !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, domain")
    .eq("id", companyId)
    .maybeSingle();

  if (!org) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  // Broad net across the common functions, then judged like any other
  // discovery. This route previously ran four bare `${org.name}
  // site:linkedin.com/in` searches — the company name unquoted, so it matched
  // any of the words in it — took ten results each, and wrote every hit
  // straight to organization_id with no verification whatsoever. For a company
  // called "Signal", "Atlas" or "Ramp" that filled the org chart with
  // employees of entirely unrelated businesses.
  // Exactly MAX_TITLES entries — the shared service slices to 5, and listing
  // six meant the last one was silently never searched.
  const titles = ["leadership", "engineer", "designer", "sales", "marketing"];

  return withAction(
    `Find more people: ${org.name}`,
    async () => {
      const result = await paidContactDiscovery({
        identity: { userId: user.id, source: "web" }, key: request.headers.get("Idempotency-Key"),
        request: { organizationId: companyId, campaignId, titles, numResults: 10, linkTeamPage: "matching" },
      }, () => findContactsForOrganization(supabase, {
        organizationId: companyId,
        campaignId,
        titles,
        numResults: 10,
      }));

      return Response.json({
        found: result.totalFound + result.rejectedAsWrongCompany,
        added: result.totalFound,
        // Which of the two runs this was. The caller says "added to this
        // campaign" or "added to the company, not in a campaign yet" off this,
        // because the difference decides whether the campaign page will show
        // them and the user has no other way to know.
        campaignId,
        verifiedCount: result.verifiedCount,
        uncertainCount: result.uncertainCount,
        rejectedAsWrongCompany: result.rejectedAsWrongCompany,
        error: result.error,
      });
    },
    user.id,
  );
}
