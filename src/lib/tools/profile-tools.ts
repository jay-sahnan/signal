import { tool } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const updateUserProfile = tool({
  description:
    "Create or update a user profile. Include `profileId` to update a specific profile, or omit it to create a new one. Each campaign can have its own profile so the user can sell different things to different audiences.",
  inputSchema: z.object({
    profileId: z
      .string()
      .uuid()
      .optional()
      .describe("Profile ID to update. Omit to create a new profile."),
    label: z
      .string()
      .optional()
      .describe(
        "Short label to distinguish this profile, e.g. 'SaaS Sales' or 'Consulting'",
      ),
    name: z.string().optional().describe("User's full name"),
    email: z.string().email().optional().describe("User's email address"),
    role_title: z.string().optional().describe("User's job title / role"),
    company_name: z.string().optional().describe("User's company name"),
    company_url: z.string().url().optional().describe("Company website URL"),
    personal_url: z.string().url().optional().describe("Personal website URL"),
    linkedin_url: z.string().optional().describe("LinkedIn profile URL"),
    twitter_url: z.string().optional().describe("Twitter/X profile URL"),
    offering_summary: z
      .string()
      .optional()
      .describe(
        "What the user is selling -- product/service description, problem solved, target market",
      ),
    notes: z
      .string()
      .optional()
      .describe(
        "Additional context -- target market details, differentiators, constraints, tone preferences",
      ),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const { profileId, ...rest } = input;

    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) fields[key] = value;
    }

    if (Object.keys(fields).length === 0) {
      return { error: "No fields provided to update." };
    }

    if (profileId) {
      const { error } = await supabase
        .from("user_profile")
        .update(fields)
        .eq("id", profileId);
      if (error) throw new Error(`Failed to update profile: ${error.message}`);

      const { data: profile } = await supabase
        .from("user_profile")
        .select("*")
        .eq("id", profileId)
        .single();

      return { profile, action: "updated", updated: Object.keys(fields) };
    }

    // Create new profile
    const { data: profile, error } = await supabase
      .from("user_profile")
      .insert(fields)
      .select("*")
      .single();

    if (error) throw new Error(`Failed to create profile: ${error.message}`);
    return { profile, action: "created", updated: Object.keys(fields) };
  },
});

export const getUserProfile = tool({
  description:
    "Get a user profile. Pass a campaignId to get the profile linked to that campaign, or a profileId to get a specific profile. Omit both to get the most recent profile.",
  inputSchema: z.object({
    profileId: z
      .string()
      .uuid()
      .optional()
      .describe("Specific profile ID to fetch."),
    campaignId: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID -- returns the profile linked to this campaign."),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    // By specific profile ID
    if (input.profileId) {
      const { data, error } = await supabase
        .from("user_profile")
        .select("*")
        .eq("id", input.profileId)
        .single();

      if (error) throw new Error(`Failed to get profile: ${error.message}`);
      return { profile: data };
    }

    // By campaign's linked profile
    if (input.campaignId) {
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("profile_id")
        .eq("id", input.campaignId)
        .single();

      if (campaign?.profile_id) {
        const { data } = await supabase
          .from("user_profile")
          .select("*")
          .eq("id", campaign.profile_id)
          .single();

        if (data) return { profile: data };
      }

      return {
        profile: null,
        message:
          "No profile linked to this campaign. Use listProfiles to see available profiles, or create one with updateUserProfile.",
      };
    }

    // Fallback: most recent
    const { data, error } = await supabase
      .from("user_profile")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`Failed to get profile: ${error.message}`);

    if (!data) {
      return {
        profile: null,
        message:
          "No profile set up yet. Ask the user to fill in a profile so you can personalize outreach.",
      };
    }

    return { profile: data };
  },
});

export const listProfiles = tool({
  description:
    "List all user profiles. Each profile represents a different seller identity the user can link to campaigns.",
  inputSchema: z.object({}),
  execute: async () => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("user_profile")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to list profiles: ${error.message}`);

    return { profiles: data ?? [] };
  },
});
