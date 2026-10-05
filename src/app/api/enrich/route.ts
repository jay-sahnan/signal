import { isHostedMode } from "@/lib/auth/workspace";
import { executePaidAction } from "@/lib/billing/paid-action";
import { CreditExecutionError } from "@/lib/billing/credit-execution";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { isRecentlyEnriched } from "@/lib/services/knowledge-base";
import {
  enrichPerson,
  PERSON_ENRICH_COLUMNS,
  type PersonForEnrichment,
} from "@/lib/services/person-enrichment";

export const maxDuration = 120;

/** The RLS-scoped client the route handler is given. */
type ScopedClient = NonNullable<
  Awaited<ReturnType<typeof getSupabaseAndUser>>
>["supabase"];

/** The user_id on a `campaigns` row reached through an !inner join, if any. */
function campaignOwner(row: { campaign?: unknown } | null): string | null {
  return (
    (row?.campaign as unknown as { user_id?: string } | null)?.user_id ?? null
  );
}

/**
 * Whether the caller has any claim on a bare people.id.
 *
 * `people` is a shared pool with no owner column, so the claim has to come
 * from something that is scoped. Two things are: the contact sitting in one
 * of the caller's campaigns, and the company they are filed under sitting in
 * one of the caller's campaigns.
 *
 * The second is not decoration. The standalone company page enriches by bare
 * person id, and "Find more people" on that page stores contacts with no
 * campaign link at all, so a contact-only test would refuse the people it had
 * just created. It is also the same gate that route, classify-departments and
 * to-company already use to authorise themselves, rather than a new one.
 */
async function callerHoldsPerson(
  supabase: ScopedClient,
  userId: string,
  personId: string,
): Promise<boolean> {
  const { data: personLink } = await supabase
    .from("campaign_people")
    .select("campaign:campaigns!inner(user_id)")
    .eq("person_id", personId)
    .limit(1)
    .maybeSingle();
  if (campaignOwner(personLink) === userId) return true;

  const { data: person } = await supabase
    .from("people")
    .select("organization_id")
    .eq("id", personId)
    .maybeSingle();
  const organizationId = (person?.organization_id as string | null) ?? null;
  if (!organizationId) return false;

  const { data: orgLink } = await supabase
    .from("campaign_organizations")
    .select("campaign:campaigns!inner(user_id)")
    .eq("organization_id", organizationId)
    .limit(1)
    .maybeSingle();
  return campaignOwner(orgLink) === userId;
}

export async function POST(request: Request) {
  try {
    return await enrichRequest(request);
  } catch (error) {
    if (error instanceof CreditExecutionError)
      return Response.json({ error: error.message }, { status: error.status });
    console.error("[enrich] Request failed", error);
    return Response.json(
      { error: "Enrichment failed. Retry the same request." },
      { status: 500 },
    );
  }
}

async function enrichRequest(request: Request) {
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

  const contactId = body?.contactId;
  if (typeof contactId !== "string" || !contactId.trim()) {
    return Response.json({ error: "contactId is required" }, { status: 400 });
  }

  // contactId may be a campaign_people link ID -- resolve to person.
  // The link is our ownership hook: campaign_people -> campaigns.user_id
  // (defense in depth on top of RLS, which already scopes campaign_people
  // through its parent campaign).
  let personId: string;

  const { data: link } = await supabase
    .from("campaign_people")
    .select("person_id, campaign:campaigns(user_id)")
    .eq("id", contactId)
    .maybeSingle();

  if (link) {
    const campaign = link.campaign as unknown as { user_id: string } | null;
    if (!campaign) {
      return Response.json({ error: "Contact not found" }, { status: 404 });
    }
    if (campaign.user_id !== user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    personId = link.person_id;
  } else {
    // Bare person ID path. This used to proceed on the assumption that the
    // select below was user-scoped. It is not -- `people` is shared across
    // campaigns by design and carries no owner -- so the id had to be checked
    // here or not at all, and the route would return the stored dossier for
    // any id it was handed.
    personId = contactId;
    if (!(await callerHoldsPerson(supabase, user.id, personId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { data: personData, error: fetchError } = await supabase
    .from("people")
    .select(PERSON_ENRICH_COLUMNS)
    .eq("id", personId)
    .single();

  if (fetchError || !personData) {
    return Response.json({ error: "Contact not found" }, { status: 404 });
  }

  const person = personData as unknown as PersonForEnrichment;

  // Check recency
  const recent = await isRecentlyEnriched(
    "people",
    personId,
    7,
    isHostedMode(),
  );
  if (recent) {
    const { data: p, error: cachedError } = await supabase
      .from("people")
      .select("enrichment_data")
      .eq("id", personId)
      .single();
    if (cachedError) throw new Error("Could not read cached enrichment");
    return Response.json({
      contactId: personId,
      status: "enriched",
      enrichmentData: p?.enrichment_data || {},
      skipped: true,
    });
  }

  const hosted = isHostedMode();
  if (
    hosted &&
    (!person.name || person.name === "Unknown") &&
    !person.linkedin_url &&
    !person.twitter_url
  )
    throw new CreditExecutionError("No enrichment sources available", 400);
  const work = async () => {
    const result = await enrichPerson(supabase, personId, person, user.id);
    if (hosted && result.status === "failed")
      throw new Error("All enrichment sources failed");
    return result;
  };
  const result = hosted
    ? await executePaidAction(
        {
          identity: { userId: user.id, source: "web" },
          key: request.headers.get("Idempotency-Key"),
          kind: "contact.enrich.web",
          request: { personId },
        },
        work,
      )
    : await work();

  return Response.json({
    contactId: personId,
    status: result.status,
    enrichmentData: result.enrichmentData,
    errors: result.errors,
  });
}
