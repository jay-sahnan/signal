"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { profileDisplayName } from "@/lib/types/profile";
import type { UserProfile } from "@/lib/types/profile";

interface ProfileSelectorProps {
  campaignId: string;
  currentProfileId: string | null;
  onProfileChanged: (profileId: string | null) => void;
}

export function ProfileSelector({
  campaignId,
  currentProfileId,
  onProfileChanged,
}: ProfileSelectorProps) {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("user_profile")
        .select("*")
        .order("created_at", { ascending: false });
      setProfiles((data as UserProfile[]) ?? []);
    };
    load();
  }, []);

  const handleChange = async (profileId: string) => {
    const value = profileId || null;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("campaigns")
      .update({ profile_id: value })
      .eq("id", campaignId);

    if (error) {
      toast.error("Failed to update profile");
    } else {
      onProfileChanged(value);
    }
    setSaving(false);
  };

  if (profiles.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <User className="text-muted-foreground h-3.5 w-3.5" />
      <select
        value={currentProfileId ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="border-input bg-background ring-offset-background focus:ring-ring h-7 rounded-md border px-2 text-xs focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
      >
        <option value="">No profile linked</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {profileDisplayName(p)}
          </option>
        ))}
      </select>
    </div>
  );
}
