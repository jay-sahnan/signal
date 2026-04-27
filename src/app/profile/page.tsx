"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  ListRowsSkeleton,
  PageHeaderSkeleton,
} from "@/components/ui/skeleton-presets";
import { Textarea } from "@/components/ui/textarea";
import { EmailSkillsAttacher } from "@/components/email-skills/email-skills-attacher";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@clerk/nextjs";
import { profileDisplayName } from "@/lib/types/profile";
import type { UserProfile, ProfileFormData } from "@/lib/types/profile";

const emptyForm: ProfileFormData = {
  label: "",
  name: "",
  email: "",
  role_title: "",
  company_name: "",
  company_url: "",
  personal_url: "",
  linkedin_url: "",
  twitter_url: "",
  offering_summary: "",
  notes: "",
};

export default function ProfilePage() {
  const { user: clerkUser } = useUser();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormData>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadFormFromProfile = (p: UserProfile) => {
    setForm({
      label: p.label ?? "",
      name: p.name ?? "",
      email: p.email ?? "",
      role_title: p.role_title ?? "",
      company_name: p.company_name ?? "",
      company_url: p.company_url ?? "",
      personal_url: p.personal_url ?? "",
      linkedin_url: p.linkedin_url ?? "",
      twitter_url: p.twitter_url ?? "",
      offering_summary: p.offering_summary ?? "",
      notes: p.notes ?? "",
    });
  };

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("user_profile")
        .select("*")
        .order("created_at", { ascending: false });

      const list: UserProfile[] = Array.isArray(data) ? data : [];
      setProfiles(list);

      if (list.length > 0) {
        setSelectedId(list[0].id);
        loadFormFromProfile(list[0]);
      }
      setLoading(false);
    };
    void load();
  }, []);

  const selectProfile = (id: string) => {
    const p = profiles.find((pr) => pr.id === id);
    if (!p) return;
    setSelectedId(id);
    loadFormFromProfile(p);
  };

  const startNewProfile = () => {
    setSelectedId(null);
    setForm(emptyForm);
  };

  const update = (field: keyof ProfileFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();

    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]),
    );

    try {
      if (selectedId) {
        const { error } = await supabase
          .from("user_profile")
          .update(payload)
          .eq("id", selectedId);
        if (error) throw error;

        setProfiles((prev) =>
          prev.map((p) =>
            p.id === selectedId ? ({ ...p, ...payload } as UserProfile) : p,
          ),
        );
        toast.success("Profile saved");
      } else {
        if (!clerkUser?.id) {
          toast.error("Still signing in — try again in a moment");
          setSaving(false);
          return;
        }
        const { data, error } = await supabase
          .from("user_profile")
          .insert({ ...payload, user_id: clerkUser.id })
          .select("*")
          .single();
        if (error) throw error;

        const newProfile = data as UserProfile;
        setProfiles((prev) => [newProfile, ...prev]);
        setSelectedId(newProfile.id);
        toast.success("Profile created");
      }
    } catch (err) {
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (profiles.length <= 1) {
      toast.error("You need at least one profile");
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("user_profile")
      .delete()
      .eq("id", selectedId);

    if (error) {
      toast.error(`Failed to delete: ${error.message}`);
      return;
    }

    const remaining = profiles.filter((p) => p.id !== selectedId);
    setProfiles(remaining);
    if (remaining.length > 0) {
      setSelectedId(remaining[0].id);
      loadFormFromProfile(remaining[0]);
    } else {
      setSelectedId(null);
      setForm(emptyForm);
    }
    toast.success("Profile deleted");
  };

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-8 p-4 md:p-6">
          <PageHeaderSkeleton />
          <ListRowsSkeleton count={4} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-8 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profiles</h1>
          <p className="text-muted-foreground text-sm">
            Create different profiles for different campaigns. Each profile is a
            seller identity with its own company, offering, and links.
          </p>
        </div>

        {/* Profile selector */}
        <div className="flex items-center gap-3">
          <div className="min-w-[12rem]">
            <Select
              value={selectedId ?? ""}
              onValueChange={(next) => {
                if (next) selectProfile(next);
              }}
              placeholder="New profile..."
              aria-label="Select profile"
              items={profiles.map((p) => ({
                value: p.id,
                label: profileDisplayName(p),
              }))}
            />
          </div>
          <Button variant="outline" size="sm" onClick={startNewProfile}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Profile
          </Button>
          {selectedId && profiles.length > 1 && (
            <Button variant="ghost" size="sm" onClick={handleDelete}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete
            </Button>
          )}
        </div>

        <Separator />

        {/* Profile Label */}
        <section className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="label" className="text-sm font-medium leading-none">
              Profile Label
            </label>
            <Input
              id="label"
              value={form.label ?? ""}
              onChange={(e) => update("label", e.target.value)}
              placeholder="e.g. SaaS Sales, Consulting, Agency Work"
            />
            <p className="text-muted-foreground text-xs">
              A short name to identify this profile when linking it to
              campaigns.
            </p>
          </div>
        </section>

        <Separator />

        {/* Personal Info */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Personal Info</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="name"
                className="text-sm font-medium leading-none"
              >
                Name
              </label>
              <Input
                id="name"
                value={form.name ?? ""}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Your full name"
                required
                aria-required="true"
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium leading-none"
              >
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={form.email ?? ""}
                onChange={(e) => update("email", e.target.value)}
                placeholder="you@company.com"
                required
                aria-required="true"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label
              htmlFor="role_title"
              className="text-sm font-medium leading-none"
            >
              Role / Title
            </label>
            <Input
              id="role_title"
              value={form.role_title ?? ""}
              onChange={(e) => update("role_title", e.target.value)}
              placeholder="e.g. Founder & CEO"
            />
          </div>
        </section>

        <Separator />

        {/* Company & Links */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Company & Links</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="company_name"
                className="text-sm font-medium leading-none"
              >
                Company Name
              </label>
              <Input
                id="company_name"
                value={form.company_name ?? ""}
                onChange={(e) => update("company_name", e.target.value)}
                placeholder="Your company"
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="company_url"
                className="text-sm font-medium leading-none"
              >
                Company Website
              </label>
              <Input
                id="company_url"
                type="url"
                value={form.company_url ?? ""}
                onChange={(e) => update("company_url", e.target.value)}
                placeholder="https://yourcompany.com"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label
              htmlFor="personal_url"
              className="text-sm font-medium leading-none"
            >
              Personal Website
            </label>
            <Input
              id="personal_url"
              type="url"
              value={form.personal_url ?? ""}
              onChange={(e) => update("personal_url", e.target.value)}
              placeholder="https://yoursite.com"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="linkedin_url"
                className="text-sm font-medium leading-none"
              >
                LinkedIn
              </label>
              <Input
                id="linkedin_url"
                type="url"
                value={form.linkedin_url ?? ""}
                onChange={(e) => update("linkedin_url", e.target.value)}
                placeholder="https://linkedin.com/in/yourname"
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="twitter_url"
                className="text-sm font-medium leading-none"
              >
                X / Twitter
              </label>
              <Input
                id="twitter_url"
                type="url"
                value={form.twitter_url ?? ""}
                onChange={(e) => update("twitter_url", e.target.value)}
                placeholder="https://x.com/yourhandle"
              />
            </div>
          </div>
        </section>

        <Separator />

        {/* About Your Offering */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">About Your Offering</h2>
          <div className="space-y-2">
            <label
              htmlFor="offering_summary"
              className="text-sm font-medium leading-none"
            >
              What are you selling?
            </label>
            <Textarea
              id="offering_summary"
              value={form.offering_summary ?? ""}
              onChange={(e) => update("offering_summary", e.target.value)}
              placeholder="Describe your product or service in a few sentences. What problem does it solve? Who is it for?"
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="notes" className="text-sm font-medium leading-none">
              Additional Notes
            </label>
            <Textarea
              id="notes"
              value={form.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Anything else Signal should know -- target market, differentiators, constraints, tone preferences, etc."
              rows={4}
            />
          </div>
        </section>

        <div className="flex justify-end pb-2">
          <Button
            onClick={handleSave}
            disabled={
              saving || loading || !form.name?.trim() || !form.email?.trim()
            }
          >
            {saving
              ? "Saving..."
              : selectedId
                ? "Save Profile"
                : "Create Profile"}
          </Button>
        </div>

        <Separator />

        <EmailSkillsAttacher
          scopeType="profile"
          scopeId={selectedId}
          title="Email skills for this profile"
          description="Applied whenever a campaign uses this sender identity."
        />
      </div>
    </div>
  );
}
