"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { TogglePill } from "@/components/ui/toggle-pill";
import { EmailSkillCard } from "@/components/email-skills/email-skill-card";
import { EmailSkillDetailDialog } from "@/components/email-skills/email-skill-detail-dialog";
import { createClient } from "@/lib/supabase/client";
import type { EmailSkill, EmailSkillScopeType } from "@/lib/types/email-skill";
import type { Campaign } from "@/lib/types/campaign";
import type { UserProfile } from "@/lib/types/profile";
import { profileDisplayName } from "@/lib/types/profile";

type ScopeFilter = "global" | "profile" | "campaign";

const SCOPE_OPTIONS: { label: string; value: ScopeFilter }[] = [
  { label: "Global default", value: "global" },
  { label: "Per profile", value: "profile" },
  { label: "Per campaign", value: "campaign" },
];

const SOURCE_FILTERS = [
  { label: "All", value: "all" },
  { label: "Built-in", value: "builtin" },
  { label: "Custom", value: "custom" },
] as const;

type SourceFilter = (typeof SOURCE_FILTERS)[number]["value"];

export default function EmailSkillsPage() {
  const [skills, setSkills] = useState<EmailSkill[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const [scope, setScope] = useState<ScopeFilter>("global");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());

  const [source, setSource] = useState<SourceFilter>("all");
  const [detailSkill, setDetailSkill] = useState<EmailSkill | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const [skillsRes, campaignsRes, profilesRes] = await Promise.all([
      supabase
        .from("email_skills")
        .select("*")
        .order("is_builtin", { ascending: false })
        .order("name"),
      supabase
        .from("campaigns")
        .select("id, name, status")
        .order("updated_at", { ascending: false }),
      supabase
        .from("user_profile")
        .select("*")
        .order("created_at", { ascending: false }),
    ]);

    if (!mountedRef.current) return;
    setUserId(user?.id ?? null);
    setSkills((skillsRes.data as EmailSkill[]) ?? []);
    setCampaigns((campaignsRes.data as Campaign[]) ?? []);
    setProfiles((profilesRes.data as UserProfile[]) ?? []);
    setLoading(false);
  }, []);

  const currentScopeId = (() => {
    if (scope === "global") return userId;
    if (scope === "profile") return selectedProfileId || null;
    return selectedCampaignId || null;
  })();

  const currentScopeType: EmailSkillScopeType = (
    scope === "global" ? "user" : scope
  ) as EmailSkillScopeType;

  const fetchAttachments = useCallback(
    async (scopeType: EmailSkillScopeType, scopeId: string | null) => {
      if (!scopeId) {
        setAttachedIds(new Set());
        return;
      }
      const supabase = createClient();
      const { data } = await supabase
        .from("email_skill_attachments")
        .select("skill_id, enabled")
        .eq("scope_type", scopeType)
        .eq("scope_id", scopeId)
        .eq("enabled", true);
      if (!mountedRef.current) return;
      setAttachedIds(new Set((data ?? []).map((r) => r.skill_id as string)));
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;

    fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAttachments(currentScopeType, currentScopeId);
  }, [currentScopeType, currentScopeId, fetchAttachments]);

  const handleToggle = async (skillId: string, attached: boolean) => {
    if (!currentScopeId) {
      toast.error(
        scope === "profile"
          ? "Select a profile first."
          : "Select a campaign first.",
      );
      return;
    }
    setAttachedIds((prev) => {
      const next = new Set(prev);
      if (attached) next.add(skillId);
      else next.delete(skillId);
      return next;
    });
    const supabase = createClient();
    if (attached) {
      const { error } = await supabase.from("email_skill_attachments").upsert(
        {
          skill_id: skillId,
          scope_type: currentScopeType,
          scope_id: currentScopeId,
          enabled: true,
        },
        { onConflict: "skill_id,scope_type,scope_id" },
      );
      if (error) {
        toast.error("Failed to attach skill");
        setAttachedIds((prev) => {
          const next = new Set(prev);
          next.delete(skillId);
          return next;
        });
      }
    } else {
      const { error } = await supabase
        .from("email_skill_attachments")
        .delete()
        .eq("skill_id", skillId)
        .eq("scope_type", currentScopeType)
        .eq("scope_id", currentScopeId);
      if (error) {
        toast.error("Failed to detach skill");
        setAttachedIds((prev) => new Set(prev).add(skillId));
      }
    }
  };

  const handleSkillSaved = (updated: EmailSkill) => {
    setSkills((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setDetailSkill(updated);
  };

  const handleSkillDeleted = (skillId: string) => {
    setSkills((prev) => prev.filter((s) => s.id !== skillId));
    setDetailSkill(null);
  };

  const filtered = skills.filter((s) => {
    if (source === "builtin") return s.is_builtin;
    if (source === "custom") return !s.is_builtin;
    return true;
  });

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-4 md:p-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Email Skills</h1>
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const showToggle = currentScopeId !== null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Email Skills</h1>
            <p className="text-muted-foreground text-sm">
              Reusable rule packs that shape how the agent writes emails. Attach
              at the global, profile, or campaign scope.
            </p>
          </div>
          <CreateSkillButton
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreated={(skill) => {
              setSkills((prev) => [skill, ...prev]);
              setDetailSkill(skill);
            }}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              Attach to
            </label>
            <Select
              value={scope}
              onValueChange={(v) => setScope(v as ScopeFilter)}
              items={SCOPE_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
            />
          </div>
          {scope === "profile" && (
            <div className="w-64">
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Profile
              </label>
              <Select
                value={selectedProfileId}
                onValueChange={setSelectedProfileId}
                items={[
                  { value: "", label: "Select a profile…" },
                  ...profiles.map((p) => ({
                    value: p.id,
                    label: profileDisplayName(p),
                  })),
                ]}
              />
            </div>
          )}
          {scope === "campaign" && (
            <div className="w-64">
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Campaign
              </label>
              <Select
                value={selectedCampaignId}
                onValueChange={setSelectedCampaignId}
                items={[
                  { value: "", label: "Select a campaign…" },
                  ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>
          )}
        </div>

        <Separator />

        <div className="flex flex-wrap gap-1.5">
          {SOURCE_FILTERS.map((f) => (
            <TogglePill
              key={f.value}
              active={source === f.value}
              onClick={() => setSource(f.value)}
            >
              {f.label}
            </TogglePill>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((skill) => (
            <EmailSkillCard
              key={skill.id}
              skill={skill}
              attached={attachedIds.has(skill.id)}
              showToggle={showToggle}
              onToggle={handleToggle}
              onClick={setDetailSkill}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-muted-foreground col-span-full py-8 text-center text-sm">
              No skills match this filter.
            </p>
          )}
        </div>
      </div>

      <EmailSkillDetailDialog
        skill={detailSkill}
        open={!!detailSkill}
        onOpenChange={(open) => {
          if (!open) setDetailSkill(null);
        }}
        onSaved={handleSkillSaved}
        onDeleted={handleSkillDeleted}
      />
    </div>
  );
}

function CreateSkillButton({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (skill: EmailSkill) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);

  const reset = () => {
    setName("");
    setDescription("");
    setInstructions("");
  };

  const handleCreate = async () => {
    if (!name || !instructions) return;
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Not signed in");
      setSaving(false);
      return;
    }
    const { data, error } = await supabase
      .from("email_skills")
      .insert({
        user_id: user.id,
        name,
        slug: slugify(name) || `skill-${Date.now()}`,
        description: description || null,
        instructions,
        is_builtin: false,
      })
      .select("*")
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(error?.message ?? "Failed to create");
      return;
    }
    toast.success("Skill created");
    onCreated(data as EmailSkill);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <Plus className="size-3.5" />
            New Skill
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[560px]">
        <DialogTitle>Create email skill</DialogTitle>
        <div className="space-y-3">
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Short & direct"
              disabled={saving}
            />
          </div>
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One-line summary (optional)"
              disabled={saving}
            />
          </div>
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              Instructions
            </label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={10}
              placeholder="Write imperative rules. Example: 'Never exceed 3 sentences. Open with the specific trigger signal.'"
              className="font-mono text-xs"
              disabled={saving}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={saving} />}>
            Cancel
          </DialogClose>
          <Button
            onClick={handleCreate}
            disabled={saving || !name || !instructions}
          >
            {saving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
