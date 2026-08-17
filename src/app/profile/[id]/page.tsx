"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ListRowsSkeleton,
  PageHeaderSkeleton,
} from "@/components/ui/skeleton-presets";
import { Textarea } from "@/components/ui/textarea";
import { FACT_CATEGORIES } from "@/lib/sender-facts";
import type { FactCategory, SenderFact } from "@/lib/sender-facts";
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
  booking_url: "",
  offering_summary: "",
  notes: "",
};

/**
 * Edits one profile, mirroring how /campaigns/[id] is the detail view for the
 * /campaigns table. "/profile/new" lands here too — ids are UUIDs, so the
 * literal segment "new" can only mean create mode.
 */
export default function ProfileDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = params.id === "new";

  const { user: clerkUser } = useUser();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<ProfileFormData>(emptyForm);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) return;

    const load = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("user_profile")
        .select("*")
        .eq("id", params.id)
        .maybeSingle();

      // A failed query is not a missing profile: rendering the terminal
      // "Profile not found" for a transient failure tells the user their
      // profile was deleted.
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      if (!data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const p = data as UserProfile;
      setProfile(p);
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
        booking_url: p.booking_url ?? "",
        offering_summary: p.offering_summary ?? "",
        notes: p.notes ?? "",
      });
      setLoading(false);
    };
    void load();
  }, [isNew, params.id]);

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
      if (profile) {
        const { error } = await supabase
          .from("user_profile")
          .update(payload)
          .eq("id", profile.id);
        if (error) throw error;

        setProfile((prev) =>
          prev ? ({ ...prev, ...payload } as UserProfile) : prev,
        );
        toast.success("Profile saved");
      } else {
        if (!clerkUser?.id) {
          toast.error("Still signing in, try again in a moment");
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
        setProfile(newProfile);
        toast.success("Profile created");
        // The URL still says /profile/new; point it at the row that now
        // exists so a reload edits instead of drafting a second copy.
        router.replace(`/profile/${newProfile.id}`);
      }
    } catch (err) {
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSaving(false);
    }
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

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p role="alert" className="text-destructive text-sm">
          Could not load this profile: {loadError}. It has not been deleted:
          reload to try again.
        </p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Profile not found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-8 p-4 md:p-6">
        <div>
          <h1 className="type-title">
            {profile ? profileDisplayName(profile) : "New Profile"}
          </h1>
          <p className="text-muted-foreground text-sm">
            A seller identity with its own company, offering, and links.
          </p>
          <Link
            href="/profile"
            className="text-muted-foreground hover:text-foreground mt-2 inline-block text-xs underline underline-offset-2"
          >
            All profiles
          </Link>
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
          <h2 className="type-header">Personal Info</h2>
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
          <h2 className="type-header">Company & Links</h2>
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
          <div className="space-y-2">
            <label
              htmlFor="booking_url"
              className="text-sm font-medium leading-none"
            >
              Meeting link
            </label>
            <Input
              id="booking_url"
              type="url"
              value={form.booking_url ?? ""}
              onChange={(e) => update("booking_url", e.target.value)}
              placeholder="https://cal.com/yourname/15min"
            />
            <p className="text-muted-foreground text-xs">
              Calendly, Cal.com, or any booking page. Whenever an email asks for
              a call, the agent includes this link as the way to book.
            </p>
          </div>
        </section>

        <Separator />

        {/* About Your Offering */}
        <section className="space-y-4">
          <h2 className="type-header">About Your Offering</h2>
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
            disabled={saving || !form.name?.trim() || !form.email?.trim()}
          >
            {saving ? "Saving..." : profile ? "Save Profile" : "Create Profile"}
          </Button>
        </div>

        {profile && (
          <>
            <Separator />
            <FactBankSection profileId={profile.id} userId={clerkUser?.id} />
          </>
        )}
      </div>
    </div>
  );
}

const CATEGORY_LABELS: Record<FactCategory, string> = {
  background: "Background",
  proof_point: "Proof point",
  story: "Story",
  pov: "Point of view",
  credibility: "Credibility",
  personal: "Personal",
};

/**
 * All facts for a profile, insertion order. RLS scopes to the current user.
 * Throws on a failed read: returning [] rendered a populated fact bank as
 * "No facts yet" (inviting duplicate re-entry), and a failed refetch right
 * after research replaced the visible list with the empty state, making
 * research look like it deleted the bank.
 */
async function fetchFacts(profileId: string): Promise<SenderFact[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sender_facts")
    .select("id, category, fact, source")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as SenderFact[]) ?? [];
}

/**
 * The sender fact bank for one profile: the pool of true facts the email
 * drafter picks at most 1-2 from per recipient. All reads and writes go
 * through the browser Supabase client like the rest of the page -- RLS
 * scopes every query to the signed-in user.
 */
function FactBankSection({
  profileId,
  userId,
}: {
  profileId: string;
  userId: string | undefined;
}) {
  const [facts, setFacts] = useState<SenderFact[]>([]);
  const [factsLoading, setFactsLoading] = useState(true);
  const [factsError, setFactsError] = useState<string | null>(null);

  const [newCategory, setNewCategory] = useState<FactCategory>("background");
  const [newFact, setNewFact] = useState("");
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const [researching, setResearching] = useState(false);
  const [researchNote, setResearchNote] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setFacts(await fetchFacts(profileId));
        setFactsError(null);
      } catch (err) {
        setFactsError(err instanceof Error ? err.message : "load failed");
      } finally {
        setFactsLoading(false);
      }
    };
    void load();
  }, [profileId]);

  const handleAdd = async () => {
    const fact = newFact.trim();
    if (!fact) return;
    if (!userId) {
      toast.error("Still signing in, try again in a moment");
      return;
    }
    setAdding(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("sender_facts")
      .insert({
        user_id: userId,
        profile_id: profileId,
        category: newCategory,
        fact,
        source: "user",
      })
      .select("id, category, fact, source")
      .single();

    if (error) {
      toast.error(`Failed to add fact: ${error.message}`);
    } else {
      setFacts((prev) => [...prev, data as SenderFact]);
      setNewFact("");
    }
    setAdding(false);
  };

  const startEdit = (f: SenderFact) => {
    setEditingId(f.id);
    setEditingText(f.fact);
  };

  const saveEdit = async (id: string) => {
    const text = editingText.trim();
    setEditingId(null);
    const current = facts.find((f) => f.id === id);
    if (!current || !text || text === current.fact) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("sender_facts")
      .update({ fact: text })
      .eq("id", id);

    if (error) {
      toast.error(`Failed to update fact: ${error.message}`);
    } else {
      setFacts((prev) =>
        prev.map((f) => (f.id === id ? { ...f, fact: text } : f)),
      );
    }
  };

  const handleDelete = async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase.from("sender_facts").delete().eq("id", id);
    if (error) {
      toast.error(`Failed to delete fact: ${error.message}`);
    } else {
      setFacts((prev) => prev.filter((f) => f.id !== id));
    }
  };

  const handleResearch = async () => {
    setResearching(true);
    setResearchNote(null);
    setResearchError(null);
    try {
      const res = await apiFetch("/api/profile/research-facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const json = (await res.json()) as { added?: number; error?: string };
      if (!res.ok) {
        setResearchError(json.error ?? "Research failed");
      } else {
        // A failed refetch keeps the current list on screen: wiping it right
        // after "+N facts added" makes research look like it deleted the bank.
        try {
          setFacts(await fetchFacts(profileId));
        } catch {
          toast.error(
            "Facts were saved, but the list could not be refreshed. Reload to see them.",
          );
        }
        setResearchNote(
          json.added
            ? `+${json.added} fact${json.added === 1 ? "" : "s"} added`
            : "No new facts found -- everything was already in the bank",
        );
      }
    } catch {
      setResearchError("Research failed. Try again in a moment.");
    } finally {
      setResearching(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="type-header">Fact Bank</h2>
          <p className="text-muted-foreground text-sm">
            True facts about you that email drafts can draw on -- at most one or
            two per recipient.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleResearch}
          disabled={researching}
        >
          {researching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {researching ? "Researching..." : "Research my profile"}
        </Button>
      </div>

      {researchError && (
        <p className="text-destructive text-sm">{researchError}</p>
      )}
      {researchNote && (
        <p className="text-muted-foreground text-sm">{researchNote}</p>
      )}

      {factsLoading ? (
        <ListRowsSkeleton count={3} />
      ) : factsError ? (
        <p role="alert" className="text-destructive text-sm">
          Could not load the fact bank: {factsError}. Your facts are likely
          still saved: reload rather than re-adding them.
        </p>
      ) : facts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No facts yet. Add one below, or research your profile to fill the bank
          from your links.
        </p>
      ) : (
        FACT_CATEGORIES.map((category) => {
          const group = facts.filter((f) => f.category === category);
          if (group.length === 0) return null;
          return (
            <div key={category} className="space-y-2">
              <h3 className="text-sm font-medium leading-none">
                {CATEGORY_LABELS[category]}
              </h3>
              <ul className="space-y-1">
                {group.map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    {editingId === f.id ? (
                      <Input
                        autoFocus
                        maxLength={500}
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onBlur={() => void saveEdit(f.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEdit(f.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="flex-1"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(f)}
                        title="Click to edit"
                        className="hover:bg-muted flex-1 rounded-md px-2 py-1 text-left text-sm"
                      >
                        {f.fact}
                      </button>
                    )}
                    <span className="border-border text-muted-foreground rounded border px-1.5 py-0.5 text-[10px]">
                      {f.source}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void handleDelete(f.id)}
                      aria-label="Delete fact"
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value as FactCategory)}
          className="border-input bg-background ring-offset-background focus:ring-ring h-9 rounded-md border px-2 text-sm focus:ring-2 focus:ring-offset-2 focus:outline-none"
          aria-label="Fact category"
        >
          {FACT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <Input
          maxLength={500}
          value={newFact}
          onChange={(e) => setNewFact(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
          placeholder="e.g. Grew Acme from 0 to 200 customers in 18 months"
          className="flex-1"
        />
        <Button onClick={handleAdd} disabled={adding || !newFact.trim()}>
          {adding ? "Adding..." : "Add"}
        </Button>
      </div>
    </section>
  );
}
