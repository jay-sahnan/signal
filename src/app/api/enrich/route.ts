import { withAction } from "@/lib/services/cost-tracker";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { ExaService } from "@/lib/services/exa-service";
import { LinkedinService } from "@/lib/services/linkedin-service";
import { XService } from "@/lib/services/x-service";
import {
  mergeEnrichmentData,
  isRecentlyEnriched,
} from "@/lib/services/knowledge-base";

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

  const { contactId } = body as { contactId: string };
  if (!contactId) {
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
    // Bare person ID path -- people rows aren't user-scoped; RLS on the
    // subsequent select is the only layer we have here.
    personId = contactId;
  }

  const { data: personData, error: fetchError } = await supabase
    .from("people")
    .select(
      "name, title, linkedin_url, twitter_url, organization:organizations(name)",
    )
    .eq("id", personId)
    .single();

  if (fetchError || !personData) {
    return Response.json({ error: "Contact not found" }, { status: 404 });
  }

  const person = personData as {
    name: string;
    title: string | null;
    linkedin_url: string | null;
    twitter_url: string | null;
    organization: { name?: string } | null;
  };

  // Check recency
  const recent = await isRecentlyEnriched("people", personId);
  if (recent) {
    const { data: p } = await supabase
      .from("people")
      .select("enrichment_data")
      .eq("id", personId)
      .single();
    return Response.json({
      contactId: personId,
      status: "enriched",
      enrichmentData: p?.enrichment_data || {},
      skipped: true,
    });
  }

  const contactName = person.name || "Unknown";
  const companyName = person.organization?.name || null;
  const actionLabel = companyName
    ? `Enrich person: ${contactName} (${companyName})`
    : `Enrich person: ${contactName}`;

  return withAction(actionLabel, async () => {
    // Mark as in_progress
    await supabase
      .from("people")
      .update({ enrichment_status: "in_progress" })
      .eq("id", personId);

    const enrichmentData: Record<string, unknown> = {};
    const errors: string[] = [];
    const promises: Promise<void>[] = [];

    if (person.linkedin_url) {
      promises.push(
        (async () => {
          try {
            const linkedin = new LinkedinService();
            const scrapeResult = await linkedin.scrapeProfile(
              person.linkedin_url!,
            );
            enrichmentData.linkedin = {
              profileInfo: scrapeResult.profile || null,
              posts: scrapeResult.posts.slice(0, 10),
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            console.error(`[enrich API] LinkedIn scrape failed: ${msg}`);
            errors.push(`LinkedIn: ${msg}`);
          }
        })(),
      );
    }

    if (person.twitter_url) {
      promises.push(
        (async () => {
          try {
            const x = new XService();
            const result = await x.enrichTwitterProfile(person.twitter_url!);
            enrichmentData.twitter = {
              user: result.user,
              tweets: result.tweets.slice(0, 10),
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            console.error(`[enrich API] Twitter enrich failed: ${msg}`);
            errors.push(`Twitter: ${msg}`);
          }
        })(),
      );
    }

    // Exa web searches for the person
    if (contactName !== "Unknown") {
      const exa = new ExaService();

      const contactTitle = person.title || null;
      const queryParts = [`"${contactName}"`];
      if (companyName) queryParts.push(`"${companyName}"`);
      if (contactTitle) queryParts.push(contactTitle);
      const specificQuery = queryParts.join(" ");

      // Collect URLs already in the company's enrichment data so we don't
      // show the same links on both the company and contact cards.
      const companyUrls = new Set<string>();
      if (person.organization) {
        const { data: orgRow } = await supabase
          .from("organizations")
          .select("enrichment_data")
          .eq("name", (person.organization as { name?: string }).name ?? "")
          .maybeSingle();

        const orgEnrichment = orgRow?.enrichment_data as Record<
          string,
          unknown
        > | null;
        if (orgEnrichment) {
          const searches = orgEnrichment.searches as
            | Array<{ results: Array<{ url: string }> }>
            | undefined;
          if (searches) {
            for (const s of searches) {
              for (const r of s.results) {
                if (r.url) companyUrls.add(r.url);
              }
            }
          }
        }
      }

      const dedup = (
        results: Array<{
          title: string;
          url: string;
          publishedDate: string | null;
          text: string | null;
        }>,
      ) => results.filter((r) => !companyUrls.has(r.url));

      promises.push(
        (async () => {
          try {
            const result = await exa.search(
              `${specificQuery} news announcement`,
              { numResults: 3, includeText: true, category: "news" },
            );
            enrichmentData.news = dedup(
              result.results.map((r) => ({
                title: r.title,
                url: r.url,
                publishedDate: r.publishedDate,
                text: r.text || null,
              })),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            errors.push(`News: ${msg}`);
          }
        })(),
      );

      promises.push(
        (async () => {
          try {
            const result = await exa.search(
              `${specificQuery} article talk interview podcast`,
              { numResults: 3, includeText: true },
            );
            enrichmentData.articles = dedup(
              result.results.map((r) => ({
                title: r.title,
                url: r.url,
                publishedDate: r.publishedDate,
                text: r.text || null,
              })),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            errors.push(`Articles: ${msg}`);
          }
        })(),
      );

      promises.push(
        (async () => {
          try {
            const result = await exa.search(
              `${specificQuery} background bio profile`,
              { numResults: 3, includeText: true },
            );
            enrichmentData.background = dedup(
              result.results.map((r) => ({
                title: r.title,
                url: r.url,
                publishedDate: r.publishedDate,
                text: r.text || null,
              })),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            errors.push(`Background: ${msg}`);
          }
        })(),
      );
    }

    if (promises.length === 0) {
      await supabase
        .from("people")
        .update({ enrichment_status: "failed" })
        .eq("id", personId);

      return Response.json({
        contactId: personId,
        status: "failed",
        errors: ["No enrichment sources available"],
      });
    }

    await Promise.all(promises);

    const status =
      Object.keys(enrichmentData).length > 0 ? "enriched" : "failed";

    await mergeEnrichmentData(
      "people",
      personId,
      enrichmentData,
      status as "enriched" | "failed",
    );

    return Response.json({
      contactId: personId,
      status,
      enrichmentData,
      errors: errors.length > 0 ? errors : undefined,
    });
  }); // end withAction
}
