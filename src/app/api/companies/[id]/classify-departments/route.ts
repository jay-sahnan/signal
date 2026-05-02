import { withAction } from "@/lib/services/cost-tracker";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { classifyPeople } from "@/lib/services/department-classifier";

export const maxDuration = 120;

interface PersonRow {
  id: string;
  name: string;
  title: string | null;
  enrichment_data: Record<string, unknown> | null;
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
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle();

  if (!org) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const { data: rows, error } = await supabase
    .from("people")
    .select("id, name, title, enrichment_data")
    .eq("organization_id", companyId)
    .is("department", null)
    .limit(100);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const people = (rows ?? []) as PersonRow[];
  if (people.length === 0) {
    return Response.json({ classified: 0 });
  }

  const inputs = people.map((p) => {
    const enrich = (p.enrichment_data ?? {}) as {
      linkedin?: { profileInfo?: { headline?: string } };
    };
    return {
      id: p.id,
      name: p.name,
      title: p.title,
      headline: enrich.linkedin?.profileInfo?.headline ?? null,
    };
  });

  const classifications = await withAction(
    `Classify departments: ${org.name}`,
    () => classifyPeople(org.name, inputs),
  );

  for (const c of classifications) {
    await supabase
      .from("people")
      .update({
        department: c.department,
        seniority: c.seniority,
        role_summary: c.role_summary,
      })
      .eq("id", c.id);
  }

  return Response.json({ classified: classifications.length });
}
