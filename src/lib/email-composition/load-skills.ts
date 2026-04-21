import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailSkill } from "@/lib/types/email-skill";

export interface LoadSkillsInput {
  userId: string;
  profileId?: string | null;
  campaignId?: string | null;
}

/**
 * Load all enabled email skills attached to the caller's user, the campaign's
 * sender profile, and the campaign itself. Returns a de-duped list (same skill
 * attached at multiple scopes only shows up once). Order: campaign → profile →
 * user, so the most specific attachment wins in the de-dupe.
 */
export async function loadActiveEmailSkills(
  supabase: SupabaseClient,
  { userId, profileId, campaignId }: LoadSkillsInput,
): Promise<EmailSkill[]> {
  const conditions: string[] = [
    `and(scope_type.eq.user,scope_id.eq.${userId})`,
  ];
  if (profileId) {
    conditions.push(`and(scope_type.eq.profile,scope_id.eq.${profileId})`);
  }
  if (campaignId) {
    conditions.push(`and(scope_type.eq.campaign,scope_id.eq.${campaignId})`);
  }

  const { data, error } = await supabase
    .from("email_skill_attachments")
    .select("scope_type, skill:email_skills(*)")
    .eq("enabled", true)
    .or(conditions.join(","));

  if (error || !data) return [];

  const byId = new Map<string, EmailSkill>();
  const priority: Record<string, number> = { campaign: 0, profile: 1, user: 2 };
  const rows = (
    data as unknown as Array<{
      scope_type: string;
      skill: EmailSkill | EmailSkill[] | null;
    }>
  )
    .map((r) => ({
      scope_type: r.scope_type,
      skill: Array.isArray(r.skill) ? (r.skill[0] ?? null) : r.skill,
    }))
    .filter(
      (r): r is { scope_type: string; skill: EmailSkill } => r.skill !== null,
    )
    .sort(
      (a, b) => (priority[a.scope_type] ?? 99) - (priority[b.scope_type] ?? 99),
    );

  for (const row of rows) {
    if (!byId.has(row.skill.id)) {
      byId.set(row.skill.id, row.skill);
    }
  }

  return Array.from(byId.values());
}
