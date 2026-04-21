import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/lib/types/profile";

/**
 * Load the profile for the system prompt.
 * If a campaignId is provided and the campaign has a linked profile, use that.
 * Otherwise fall back to the most recently created profile.
 */
export async function getProfileForPrompt(
  campaignId?: string | null,
): Promise<UserProfile | null> {
  const supabase = await createClient();

  // If campaign has a linked profile, use it
  if (campaignId) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("profile_id")
      .eq("id", campaignId)
      .single();

    if (campaign?.profile_id) {
      const { data } = await supabase
        .from("user_profile")
        .select("*")
        .eq("id", campaign.profile_id)
        .single();

      if (data) return data as UserProfile;
    }
  }

  // Fallback: most recent profile
  const { data, error } = await supabase
    .from("user_profile")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as UserProfile;
}
