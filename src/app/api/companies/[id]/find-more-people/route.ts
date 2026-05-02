import { withAction } from "@/lib/services/cost-tracker";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { ExaService } from "@/lib/services/exa-service";
import {
  findOrCreatePerson,
  normalizeLinkedInUrl,
} from "@/lib/services/knowledge-base";
import { parseLinkedInTitle } from "@/lib/utils";

export const maxDuration = 120;

interface ExaPeopleResult {
  url: string;
  title: string;
  text: string | null;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: companyId } = await params;

  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase } = ctx;

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, domain")
    .eq("id", companyId)
    .maybeSingle();

  if (!org) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("people")
    .select("linkedin_url")
    .eq("organization_id", companyId);

  const existingUrls = new Set(
    (existing ?? [])
      .map((p) => p.linkedin_url)
      .filter((u): u is string => Boolean(u))
      .map((u) => normalizeLinkedInUrl(u)),
  );

  const exa = new ExaService();
  const queries = [
    `${org.name} site:linkedin.com/in`,
    `engineer at ${org.name} site:linkedin.com/in`,
    `designer at ${org.name} site:linkedin.com/in`,
    `sales OR marketing at ${org.name} site:linkedin.com/in`,
  ];

  const found: ExaPeopleResult[] = await withAction(
    `Find more people: ${org.name}`,
    async () => {
      const all: ExaPeopleResult[] = [];
      for (const q of queries) {
        const res = await exa.search(q, {
          numResults: 10,
          category: "people",
          includeText: true,
        });
        for (const r of res.results) {
          all.push({ url: r.url, title: r.title, text: r.text });
        }
      }
      return all;
    },
  );

  let added = 0;
  const seenInBatch = new Set<string>();

  for (const r of found) {
    if (!r.url.includes("linkedin.com/in/")) continue;
    const norm = normalizeLinkedInUrl(r.url);
    if (existingUrls.has(norm) || seenInBatch.has(norm)) continue;
    seenInBatch.add(norm);

    const parsed = parseLinkedInTitle(r.title);
    if (!parsed.name || parsed.name === "Unknown") continue;

    try {
      await findOrCreatePerson({
        name: parsed.name,
        linkedin_url: norm,
        title: parsed.title,
        organization_id: companyId,
        source: "find-more-people",
      });
      added += 1;
    } catch (err) {
      console.error("[find-more-people] failed to create:", err);
    }
  }

  return Response.json({ found: found.length, added });
}
