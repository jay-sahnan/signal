import { getAdminClient } from "@/lib/supabase/admin";

function esc(value: string | null | undefined): string {
  if (!value) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export contacts in Apollo-compatible CSV format.
 * Apollo import columns: first_name, last_name, email, title,
 * company, company_domain, linkedin_url, tags
 */
export async function GET(request: Request) {
  const supabase = getAdminClient();
  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset");

  let campaignIds: string[] = [];
  if (preset) {
    const { data } = await supabase
      .from("campaigns")
      .select("id")
      .eq("icp_preset_slug", preset);
    campaignIds = (data ?? []).map((c) => c.id as string);
  } else {
    const { data } = await supabase.from("campaigns").select("id");
    campaignIds = (data ?? []).map((c) => c.id as string);
  }

  if (campaignIds.length === 0) {
    return new Response("No campaigns found", { status: 404 });
  }

  // Fetch contacts with company info
  const { data: contactRows } = await supabase
    .from("campaign_people")
    .select(
      `
      priority_score,
      person:people!inner(
        name, work_email, personal_email, title, linkedin_url,
        organization:organizations(name, domain, industry, location)
      )
    `,
    )
    .in("campaign_id", campaignIds)
    .order("priority_score", { ascending: false, nullsFirst: false })
    .limit(500);

  // Get org IDs from contacts for signal lookup
  const orgSignals = new Map<string, string[]>();
  const orgIds = new Set<string>();
  for (const row of (contactRows ?? []) as unknown as Array<
    Record<string, unknown>
  >) {
    const person = row.person as Record<string, unknown>;
    const org = person?.organization as Record<string, unknown> | null;
    if (org?.name) {
      orgIds.add((org as Record<string, unknown> & { name: string }).name);
    }
  }

  // Fetch signal results for tag generation
  if (orgIds.size > 0) {
    // Get org IDs by name
    const orgNames = Array.from(orgIds);
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name")
      .in("name", orgNames);

    const orgIdMap = new Map<string, string>();
    for (const o of (orgs ?? []) as Array<Record<string, unknown>>) {
      orgIdMap.set(o.name as string, o.id as string);
    }

    const realOrgIds = Array.from(orgIdMap.values());
    if (realOrgIds.length > 0) {
      const { data: signalRows } = await supabase
        .from("signal_results")
        .select("organization_id, signal:signals!inner(name), output")
        .in("organization_id", realOrgIds)
        .eq("status", "success")
        .limit(500);

      for (const sr of (signalRows ?? []) as unknown as Array<
        Record<string, unknown>
      >) {
        const orgId = sr.organization_id as string;
        const output = sr.output as Record<string, unknown>;
        const signal = sr.signal as Record<string, unknown>;
        if (!output?.found) continue;
        if (!orgSignals.has(orgId)) orgSignals.set(orgId, []);
        const list = orgSignals.get(orgId)!;
        const name = signal.name as string;
        if (!list.includes(name)) list.push(name);
      }
    }
  }

  const header =
    "first_name,last_name,email,title,company,company_domain,linkedin_url,tags";

  const csvRows: string[] = [];
  const seen = new Set<string>();

  for (const row of (contactRows ?? []) as unknown as Array<
    Record<string, unknown>
  >) {
    const person = row.person as Record<string, unknown>;
    const org = person?.organization as Record<string, unknown> | null;

    const fullName = (person.name as string) ?? "";
    const email =
      (person.work_email as string) ?? (person.personal_email as string) ?? "";

    // Dedupe by email
    if (email && seen.has(email.toLowerCase())) continue;
    if (email) seen.add(email.toLowerCase());

    const nameParts = fullName.split(" ");
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ");

    const companyName = (org?.name as string) ?? "";
    const domain = (org?.domain as string) ?? "";

    // Build tags from signals + preset
    const tags: string[] = [];
    if (preset) tags.push(`rulebase:${preset}`);
    // Find signals for this org
    // We need to match by company name to orgId
    for (const [, signalNames] of orgSignals) {
      // Simplified: add all signal names as tags
      for (const s of signalNames) {
        const tag = s
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        if (!tags.includes(`signal:${tag}`)) tags.push(`signal:${tag}`);
      }
    }

    csvRows.push(
      [
        esc(firstName),
        esc(lastName),
        esc(email),
        esc((person.title as string) ?? ""),
        esc(companyName),
        esc(domain),
        esc((person.linkedin_url as string) ?? ""),
        esc(tags.join("; ")),
      ].join(","),
    );
  }

  const csv = [header, ...csvRows].join("\n");
  const filename = preset
    ? `apollo-${preset}-${new Date().toISOString().slice(0, 10)}.csv`
    : `apollo-export-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
