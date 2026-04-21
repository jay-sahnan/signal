import { tool } from "ai";
import { z } from "zod";
import { createClient, getSupabaseAndUser } from "@/lib/supabase/server";

const scopeEnum = z.enum(["user", "profile", "campaign"]);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export const listEmailSkills = tool({
  description:
    "List email skills (catalog entries) available to the current user — both built-ins and their own custom skills. Optionally filter to those attached to a given scope (user default / a profile / a campaign).",
  inputSchema: z.object({
    scopeType: scopeEnum
      .optional()
      .describe("If provided with scopeId, returns which skills are attached."),
    scopeId: z
      .string()
      .uuid()
      .optional()
      .describe("Scope ID to check attachments against."),
  }),
  execute: async ({ scopeType, scopeId }) => {
    const supabase = await createClient();
    const { data: skills, error } = await supabase
      .from("email_skills")
      .select("id, name, slug, description, instructions, is_builtin, user_id")
      .order("is_builtin", { ascending: false })
      .order("name");
    if (error) throw new Error(`Failed to list skills: ${error.message}`);

    let attached: Set<string> = new Set();
    if (scopeType && scopeId) {
      const { data: attachments } = await supabase
        .from("email_skill_attachments")
        .select("skill_id, enabled")
        .eq("scope_type", scopeType)
        .eq("scope_id", scopeId)
        .eq("enabled", true);
      attached = new Set((attachments ?? []).map((a) => a.skill_id as string));
    }

    return {
      skills: (skills ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description,
        isBuiltin: s.is_builtin,
        attached: attached.has(s.id as string),
      })),
    };
  },
});

export const getEmailSkillDetail = tool({
  description:
    "Fetch full detail (including the instructions markdown) for a single email skill.",
  inputSchema: z.object({
    skillId: z.string().uuid().describe("email_skills.id"),
  }),
  execute: async ({ skillId }) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("email_skills")
      .select("*")
      .eq("id", skillId)
      .single();
    if (error || !data) {
      return { error: `Skill not found: ${error?.message ?? "no rows"}` };
    }
    return data;
  },
});

export const createEmailSkill = tool({
  description:
    "Create a custom email skill. Skills are markdown rule packs merged into the email composer's system prompt. Keep instructions tight — one or two short paragraphs of rules.",
  inputSchema: z.object({
    name: z
      .string()
      .min(2)
      .max(80)
      .describe("Display name, e.g. 'Founder voice'."),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional()
      .describe("URL-safe slug. Generated from name if omitted."),
    description: z
      .string()
      .max(200)
      .optional()
      .describe("One-line summary for the catalog UI."),
    instructions: z
      .string()
      .min(10)
      .describe(
        "Markdown body injected into the email composer's system prompt. Plain imperative rules work best.",
      ),
  }),
  execute: async (input) => {
    const ctx = await getSupabaseAndUser();
    if (!ctx) return { error: "Not authenticated." };
    const { supabase, user } = ctx;

    const { data, error } = await supabase
      .from("email_skills")
      .insert({
        user_id: user.id,
        name: input.name,
        slug: input.slug ?? slugify(input.name),
        description: input.description ?? null,
        instructions: input.instructions,
        is_builtin: false,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Failed to create skill: ${error.message}`);
    return { skill: data, message: `Created skill "${input.name}"` };
  },
});

export const updateEmailSkill = tool({
  description:
    "Update a custom email skill. Built-in skills cannot be edited — fork them by creating a new skill instead.",
  inputSchema: z.object({
    skillId: z.string().uuid(),
    name: z.string().optional(),
    description: z.string().optional(),
    instructions: z.string().optional(),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.instructions !== undefined)
      patch.instructions = input.instructions;

    if (Object.keys(patch).length === 0) {
      return { error: "No fields provided to update." };
    }

    const { data, error } = await supabase
      .from("email_skills")
      .update(patch)
      .eq("id", input.skillId)
      .eq("is_builtin", false)
      .select("*")
      .single();
    if (error) throw new Error(`Failed to update skill: ${error.message}`);
    if (!data) {
      return {
        error:
          "Skill not found or is built-in (built-in skills can't be edited — create a custom skill instead).",
      };
    }
    return { skill: data, message: `Updated skill "${data.name}"` };
  },
});

export const deleteEmailSkill = tool({
  description: "Delete a custom email skill. Does not work on built-ins.",
  inputSchema: z.object({
    skillId: z.string().uuid(),
  }),
  execute: async ({ skillId }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("email_skills")
      .delete()
      .eq("id", skillId)
      .eq("is_builtin", false);
    if (error) throw new Error(`Failed to delete skill: ${error.message}`);
    return { skillId, message: "Skill deleted." };
  },
});

export const toggleEmailSkill = tool({
  description:
    "Attach or detach an email skill at a given scope. scopeType='user' applies the skill to every draft the caller makes; 'profile' scopes it to a sender profile; 'campaign' scopes it to one campaign. Pass enabled=false (or call with a previously-attached skill) to detach.",
  inputSchema: z.object({
    skillId: z.string().uuid(),
    scopeType: scopeEnum,
    scopeId: z
      .string()
      .uuid()
      .describe(
        "Scope ID: the user's auth id for 'user', profile id for 'profile', campaign id for 'campaign'.",
      ),
    enabled: z.boolean().default(true),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("email_skill_attachments")
      .upsert(
        {
          skill_id: input.skillId,
          scope_type: input.scopeType,
          scope_id: input.scopeId,
          enabled: input.enabled,
        },
        { onConflict: "skill_id,scope_type,scope_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(`Failed to toggle skill: ${error.message}`);
    return {
      attachment: data,
      message: `Skill ${input.enabled ? "attached" : "detached"} at ${input.scopeType} scope.`,
    };
  },
});
