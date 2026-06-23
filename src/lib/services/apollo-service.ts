/**
 * Apollo.io enrichment service.
 *
 * This module wraps Apollo MCP tool calls into functions callable from
 * Signal's enrichment pipeline. Apollo is the primary source for:
 * - Company firmographics (industry, revenue, headcount, location, tech stack)
 * - People discovery (names, titles, seniority)
 * - Email enrichment (verified work emails)
 *
 * The MCP tools are invoked at the AI orchestration layer (system prompt / chat).
 * This file provides typed interfaces and helper functions for the API routes
 * that bridge between Signal's enrichment pipeline and Apollo MCP calls.
 */

export interface ApolloCompanyData {
  name: string;
  domain: string;
  industry: string | null;
  subIndustry: string | null;
  headcount: number | null;
  estimatedRevenue: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  techStack: string[];
  fundingTotal: number | null;
  latestFundingRound: string | null;
  latestFundingDate: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  apolloOrgId: string | null;
}

export interface ApolloPersonData {
  name: string;
  firstName: string;
  lastName: string;
  title: string | null;
  seniority: string | null;
  linkedinUrl: string | null;
  email: string | null;
  emailStatus: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  organizationName: string | null;
  apolloPersonId: string | null;
}

/**
 * Parse Apollo organization enrichment response into typed data.
 * Call this after receiving MCP tool results from apollo_organizations_enrich.
 */
export function parseApolloOrgEnrichment(
  raw: Record<string, unknown>,
): ApolloCompanyData {
  const org = (raw.organization ?? raw) as Record<string, unknown>;
  return {
    name: (org.name as string) ?? "",
    domain: (org.primary_domain as string) ?? (org.domain as string) ?? "",
    industry: (org.industry as string) ?? null,
    subIndustry: (org.subindustry as string) ?? null,
    headcount: (org.estimated_num_employees as number) ?? null,
    estimatedRevenue: (org.annual_revenue_printed as string) ?? null,
    location: formatLocation(org),
    city: (org.city as string) ?? null,
    state: (org.state as string) ?? null,
    country: (org.country as string) ?? null,
    techStack: Array.isArray(org.current_technologies)
      ? (org.current_technologies as Array<Record<string, unknown>>).map(
          (t) => (t.name as string) ?? "",
        )
      : [],
    fundingTotal: (org.total_funding as number) ?? null,
    latestFundingRound: (org.latest_funding_round_type as string) ?? null,
    latestFundingDate: (org.latest_funding_round_date as string) ?? null,
    linkedinUrl: (org.linkedin_url as string) ?? null,
    phone: (org.phone as string) ?? null,
    apolloOrgId: (org.id as string) ?? null,
  };
}

/**
 * Parse Apollo people search response into typed data.
 * Call this after receiving MCP tool results from apollo_mixed_people_api_search.
 */
export function parseApolloPeopleSearch(
  raw: Record<string, unknown>,
): ApolloPersonData[] {
  const people = (raw.people ?? []) as Array<Record<string, unknown>>;
  return people.map((p) => ({
    name: (p.name as string) ?? "",
    firstName: (p.first_name as string) ?? "",
    lastName: (p.last_name as string) ?? "",
    title: (p.title as string) ?? null,
    seniority: (p.seniority as string) ?? null,
    linkedinUrl: (p.linkedin_url as string) ?? null,
    email: (p.email as string) ?? null,
    emailStatus: (p.email_status as string) ?? null,
    location: (p.city as string)
      ? `${p.city}${p.state ? `, ${p.state}` : ""}`
      : null,
    city: (p.city as string) ?? null,
    state: (p.state as string) ?? null,
    organizationName:
      ((p.organization as Record<string, unknown>)?.name as string) ?? null,
    apolloPersonId: (p.id as string) ?? null,
  }));
}

/**
 * Parse Apollo people enrichment (match) response.
 * Call this after receiving MCP tool results from apollo_people_match.
 */
export function parseApolloPersonEnrichment(
  raw: Record<string, unknown>,
): ApolloPersonData {
  const person = (raw.person ?? raw) as Record<string, unknown>;
  return {
    name: (person.name as string) ?? "",
    firstName: (person.first_name as string) ?? "",
    lastName: (person.last_name as string) ?? "",
    title: (person.title as string) ?? null,
    seniority: (person.seniority as string) ?? null,
    linkedinUrl: (person.linkedin_url as string) ?? null,
    email: (person.email as string) ?? null,
    emailStatus: (person.email_status as string) ?? null,
    location: (person.city as string)
      ? `${person.city}${person.state ? `, ${person.state}` : ""}`
      : null,
    city: (person.city as string) ?? null,
    state: (person.state as string) ?? null,
    organizationName:
      ((person.organization as Record<string, unknown>)?.name as string) ??
      null,
    apolloPersonId: (person.id as string) ?? null,
  };
}

function formatLocation(org: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (org.city) parts.push(org.city as string);
  if (org.state) parts.push(org.state as string);
  if (parts.length === 0 && org.country) parts.push(org.country as string);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Merge Apollo enrichment data into Signal's CompanyEnrichmentData format.
 * This bridges Apollo's structured data into Signal's existing enrichment schema.
 */
export function mergeApolloIntoEnrichment(
  existing: Record<string, unknown>,
  apollo: ApolloCompanyData,
): Record<string, unknown> {
  return {
    ...existing,
    apollo: {
      industry: apollo.industry,
      subIndustry: apollo.subIndustry,
      headcount: apollo.headcount,
      estimatedRevenue: apollo.estimatedRevenue,
      location: apollo.location,
      city: apollo.city,
      state: apollo.state,
      country: apollo.country,
      techStack: apollo.techStack,
      fundingTotal: apollo.fundingTotal,
      latestFundingRound: apollo.latestFundingRound,
      latestFundingDate: apollo.latestFundingDate,
      linkedinUrl: apollo.linkedinUrl,
      phone: apollo.phone,
      apolloOrgId: apollo.apolloOrgId,
      enrichedAt: new Date().toISOString(),
    },
  };
}
