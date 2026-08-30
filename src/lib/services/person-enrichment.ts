import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeCompanyName } from "@/lib/services/affiliation";
import { withAction } from "@/lib/services/cost-tracker";
import { ExaService } from "@/lib/services/exa-service";
import { LinkedinService } from "@/lib/services/linkedin-service";
import { XService } from "@/lib/services/x-service";
import { mergeEnrichmentData } from "@/lib/services/knowledge-base";

/**
 * Enriching one person: LinkedIn profile, X profile, and three Exa searches.
 *
 * Lifted out of POST /api/enrich unchanged so the bulk route can reuse it
 * rather than carry a second copy of two hundred lines that would drift. The
 * route keeps what is route-shaped -- auth, resolving a campaign_people id to
 * a person, the recency short-circuit, HTTP status codes -- and this owns the
 * work.
 *
 * Returns a plain object rather than a Response for the same reason.
 */

export interface PersonEnrichmentResult {
  status: "enriched" | "failed";
  enrichmentData: Record<string, unknown>;
  errors?: string[];
}

/** The columns enrichment reads. Exported so callers can select exactly these. */
export const PERSON_ENRICH_COLUMNS =
  // !organization_id disambiguates: people carries a second FK to
  // organizations (affiliation_detached_from), so unhinted embeds error.
  "name, title, linkedin_url, twitter_url, organization_id, organization:organizations!organization_id(name)";

export interface PersonForEnrichment {
  name: string;
  title: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  organization_id?: string | null;
  organization: { name?: string } | null;
}

/** Lowercase alphanumerics only, so punctuation and spacing stop mattering. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Is this search result actually about THIS person?
 *
 * An Exa query carries the name and company, but Exa is semantic: the top
 * results routinely include namesake strangers whose pages never mention the
 * employer. Stored unchecked, a stranger's "15 years at Oracle" lands in the
 * contact's enrichment_data and the composer personalises outreach against
 * someone else's life. So a result must name the person AND their company to
 * be kept: a missing fact costs a blander email, a stranger's fact costs a
 * wrong one sent to a real prospect.
 *
 * Requiring the company is also why callers skip web search entirely for
 * people with no organization on file: with only a name there is nothing to
 * tie a result to this specific human.
 */
export function resultIsAboutPerson(
  result: { title: string | null; text: string | null },
  person: { name: string; companyName: string | null },
): boolean {
  const haystack = squash(`${result.title ?? ""} ${result.text ?? ""}`);
  if (!haystack) return false;

  const tokens = nameTokens(person.name);
  if (tokens.length === 0) return false;
  if (!tokens.every((t) => haystack.includes(t))) return false;

  if (person.companyName) {
    const companyTokens = normalizeCompanyName(person.companyName)
      .split(" ")
      .filter((t) => t.length >= 2);
    if (
      companyTokens.length > 0 &&
      !companyTokens.every((t) => haystack.includes(t))
    ) {
      return false;
    }
  }

  return true;
}

/** The note callers record when web search is skipped for lack of an anchor. */
export const NO_COMPANY_SEARCH_NOTE =
  "Web search skipped: no company on file, so results could not be tied to this specific person. LinkedIn and X profiles (if on file) were still used. Link the contact to their company and re-enrich to add news and articles.";

export async function enrichPerson(
  supabase: SupabaseClient,
  personId: string,
  person: PersonForEnrichment,
  // Attribution: without it every per-person enrichment spend lands with
  // user_id NULL, which the cost center's RLS can never show.
  userId?: string | null,
): Promise<PersonEnrichmentResult> {
  const contactName = person.name || "Unknown";
  const companyName = person.organization?.name || null;
  const actionLabel = companyName
    ? `Enrich person: ${contactName} (${companyName})`
    : `Enrich person: ${contactName}`;

  return withAction(
    actionLabel,
    async () => {
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
              console.error(`[enrich] LinkedIn scrape failed: ${msg}`);
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
              console.error(`[enrich] Twitter enrich failed: ${msg}`);
              errors.push(`Twitter: ${msg}`);
            }
          })(),
        );
      }

      if (contactName !== "Unknown" && !companyName) {
        // With only a name, nothing can tie a result to this specific human:
        // running the searches anyway is how namesake strangers' articles
        // ended up stored as facts about a contact.
        errors.push(NO_COMPANY_SEARCH_NOTE);
      }

      if (contactName !== "Unknown" && companyName) {
        const exa = new ExaService();

        const contactTitle = person.title || null;
        const queryParts = [`"${contactName}"`];
        if (companyName) queryParts.push(`"${companyName}"`);
        if (contactTitle) queryParts.push(contactTitle);
        const specificQuery = queryParts.join(" ");

        // URLs already on the company's card, so the same link doesn't appear
        // on both the company and the contact.
        //
        // Keyed by the organization id the row already carries, not the name:
        // same-named org rows are an expected state (dedup is domain-only),
        // and a name lookup errors on maybeSingle the moment a second "Acme"
        // exists, silently skipping dedup, or worse, reading a namesake org's
        // enrichment.
        const companyUrls = new Set<string>();
        if (person.organization_id) {
          const { data: orgRow, error: orgReadError } = await supabase
            .from("organizations")
            .select("enrichment_data")
            .eq("id", person.organization_id)
            .maybeSingle();
          if (orgReadError) {
            console.error(
              `[enrich] company-URL dedup read failed for org ${person.organization_id}: ${orgReadError.message}`,
            );
          }

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
        ) =>
          results
            .filter((r) => !companyUrls.has(r.url))
            // Identity gate: only results that name the person AND the
            // company survive. See resultIsAboutPerson.
            .filter((r) =>
              resultIsAboutPerson(r, { name: contactName, companyName }),
            );

        const search = (
          key: "news" | "articles" | "background",
          query: string,
          label: string,
          category?: "news",
        ) =>
          promises.push(
            (async () => {
              try {
                const result = await exa.search(query, {
                  numResults: 3,
                  includeText: true,
                  ...(category ? { category } : {}),
                });
                enrichmentData[key] = dedup(
                  result.results.map((r) => ({
                    title: r.title,
                    url: r.url,
                    publishedDate: r.publishedDate,
                    text: r.text || null,
                  })),
                );
              } catch (err) {
                const msg =
                  err instanceof Error ? err.message : "Unknown error";
                errors.push(`${label}: ${msg}`);
              }
            })(),
          );

        search("news", `${specificQuery} news announcement`, "News", "news");
        search(
          "articles",
          `${specificQuery} article talk interview podcast`,
          "Articles",
        );
        search(
          "background",
          `${specificQuery} background bio profile`,
          "Background",
        );
      }

      // Nobody to ask: no LinkedIn, no X, and no usable name for a web search.
      if (promises.length === 0) {
        await supabase
          .from("people")
          .update({ enrichment_status: "failed" })
          .eq("id", personId);
        return {
          status: "failed" as const,
          enrichmentData: {},
          errors: ["No enrichment sources available"],
        };
      }

      await Promise.all(promises);

      const status =
        Object.keys(enrichmentData).length > 0 ? "enriched" : "failed";

      await mergeEnrichmentData("people", personId, enrichmentData, status);

      return {
        status,
        enrichmentData,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
    userId ?? undefined,
  );
}
