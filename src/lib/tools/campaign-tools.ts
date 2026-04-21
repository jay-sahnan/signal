import { tool } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const saveCampaign = tool({
  description:
    "Save or update a campaign with ICP definition, offering, positioning, and search criteria. Use this to persist the user's outbound campaign configuration.",
  inputSchema: z.object({
    id: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID to update. Omit to create a new campaign."),
    name: z.string().min(1).describe("Campaign name"),
    status: z
      .enum(["discovery", "researching", "active", "paused", "completed"])
      .optional()
      .describe("Campaign status"),
    icp: z
      .object({
        industry: z.string().optional(),
        companySize: z.string().optional(),
        geography: z.string().optional(),
        targetTitles: z.array(z.string()).optional(),
        painPoints: z.array(z.string()).optional(),
        keywords: z.array(z.string()).optional(),
      })
      .optional()
      .describe("Ideal Customer Profile definition"),
    offering: z
      .object({
        description: z.string().optional(),
        valueProposition: z.string().optional(),
        differentiators: z.array(z.string()).optional(),
      })
      .optional()
      .describe("What the user is selling/offering"),
    positioning: z
      .object({
        angle: z.string().optional(),
        tone: z.string().optional(),
        keyMessages: z.array(z.string()).optional(),
      })
      .optional()
      .describe("How to position the outreach"),
    searchCriteria: z
      .object({
        queries: z.array(z.string()).optional(),
        categories: z.array(z.string()).optional(),
        excludeDomains: z.array(z.string()).optional(),
      })
      .optional()
      .describe("Search criteria for finding companies"),
    notes: z.string().optional().describe("Free-form notes about the campaign"),
    profileId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "User profile ID to link to this campaign. Each campaign can have its own seller profile.",
      ),
  }),
  execute: async (input) => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (input.id) {
      const updateData: Record<string, unknown> = { name: input.name };
      if (input.status) updateData.status = input.status;
      if (input.icp) updateData.icp = input.icp;
      if (input.offering) updateData.offering = input.offering;
      if (input.positioning) updateData.positioning = input.positioning;
      if (input.searchCriteria)
        updateData.search_criteria = input.searchCriteria;
      if (input.notes !== undefined) updateData.notes = input.notes;
      if (input.profileId !== undefined)
        updateData.profile_id = input.profileId;

      const { data, error } = await supabase
        .from("campaigns")
        .update(updateData)
        .eq("id", input.id)
        .select()
        .single();

      if (error) throw new Error(`Failed to update campaign: ${error.message}`);
      return { campaign: data, action: "updated" };
    }

    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        name: input.name,
        status: input.status || "discovery",
        icp: input.icp || {},
        offering: input.offering || {},
        positioning: input.positioning || {},
        search_criteria: input.searchCriteria || {},
        notes: input.notes,
        profile_id: input.profileId || null,
        user_id: user?.id,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create campaign: ${error.message}`);
    return { campaign: data, action: "created" };
  },
});

export const getCampaign = tool({
  description:
    "Retrieve a campaign by ID, or get the most recently updated campaign if no ID is provided.",
  inputSchema: z.object({
    id: z
      .string()
      .uuid()
      .optional()
      .describe("Campaign ID. Omit to get the most recent campaign."),
  }),
  execute: async (input) => {
    const supabase = await createClient();

    if (input.id) {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", input.id)
        .single();

      if (error) throw new Error(`Failed to get campaign: ${error.message}`);
      return { campaign: data };
    }

    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (error) throw new Error(`No campaigns found: ${error.message}`);
    return { campaign: data };
  },
});

export const listCampaigns = tool({
  description: "List all campaigns with summary stats.",
  inputSchema: z.object({}),
  execute: async () => {
    const supabase = await createClient();

    const { data: campaigns, error } = await supabase
      .from("campaigns")
      .select(
        "id, name, status, profile_id, created_at, updated_at, campaign_organizations(count), campaign_people(count)",
      )
      .order("updated_at", { ascending: false });

    if (error) throw new Error(`Failed to list campaigns: ${error.message}`);

    const campaignsWithStats = (campaigns || []).map((campaign) => {
      const { campaign_organizations, campaign_people, ...rest } =
        campaign as Record<string, unknown>;
      const orgs = campaign_organizations as { count: number }[] | undefined;
      const ppl = campaign_people as { count: number }[] | undefined;
      return {
        ...rest,
        companyCount: orgs?.[0]?.count ?? 0,
        contactCount: ppl?.[0]?.count ?? 0,
      };
    });

    return { campaigns: campaignsWithStats };
  },
});
