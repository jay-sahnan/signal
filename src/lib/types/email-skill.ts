export type EmailSkillScopeType = "user" | "profile" | "campaign";

export interface EmailSkill {
  id: string;
  user_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  instructions: string;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailSkillAttachment {
  id: string;
  skill_id: string;
  scope_type: EmailSkillScopeType;
  scope_id: string;
  enabled: boolean;
  created_at: string;
}

export type EmailSkillFormData = Pick<
  EmailSkill,
  "name" | "slug" | "description" | "instructions"
>;
