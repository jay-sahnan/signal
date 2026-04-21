"use client";

import { useEffect, useState } from "react";
import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import type { EmailSkill } from "@/lib/types/email-skill";

interface EmailSkillDetailDialogProps {
  skill: EmailSkill | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (skill: EmailSkill) => void;
  onDeleted?: (skillId: string) => void;
}

export function EmailSkillDetailDialog({
  skill,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: EmailSkillDetailDialogProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!skill) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(false);
    setName(skill.name);
    setDescription(skill.description ?? "");
    setInstructions(skill.instructions);
  }, [skill]);

  if (!skill) return null;

  const canEdit = !skill.is_builtin;
  const badgeClass = skill.is_builtin
    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  const badgeLabel = skill.is_builtin ? "Built-in" : "Custom";

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("email_skills")
      .update({
        name,
        description: description || null,
        instructions,
      })
      .eq("id", skill.id)
      .select("*")
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(error?.message ?? "Failed to save");
      return;
    }
    toast.success("Saved");
    setEditing(false);
    onSaved?.(data as EmailSkill);
  };

  const handleDelete = async () => {
    if (!canEdit) return;
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("email_skills")
      .delete()
      .eq("id", skill.id);
    setDeleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Skill deleted");
    onDeleted?.(skill.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] p-0 gap-0 overflow-hidden">
        <DialogDescription className="sr-only">
          {skill.description ?? skill.name}
        </DialogDescription>

        <div className="flex items-center gap-3 border-b border-border px-5 pr-12 py-3.5">
          <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm font-semibold leading-tight">
              {editing ? "Edit skill" : skill.name}
            </DialogTitle>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={`inline-block rounded px-1 py-px text-[10px] font-medium leading-tight ${badgeClass}`}
              >
                {badgeLabel}
              </span>
            </div>
          </div>
          {canEdit && !editing && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-xs"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3" />
              Edit
            </Button>
          )}
        </div>

        <div className="space-y-4 px-5 py-4">
          {editing ? (
            <>
              <div>
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="One-line summary"
                  disabled={saving}
                />
              </div>
              <div>
                <Label>Instructions</Label>
                <Textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={12}
                  className="font-mono text-xs"
                  disabled={saving}
                />
                <p className="text-muted-foreground mt-1 text-[11px]">
                  Markdown rules injected into the email composer&apos;s system
                  prompt. Imperative statements work best.
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
                  onClick={handleDelete}
                  disabled={saving || deleting}
                >
                  <Trash2 className="size-3" />
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={handleSave}
                    disabled={saving || !name || !instructions}
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              {skill.description && (
                <div>
                  <Label>About</Label>
                  <p className="text-[13px] leading-relaxed">
                    {skill.description}
                  </p>
                </div>
              )}
              <div>
                <Label>Instructions</Label>
                <pre className="bg-muted/40 ring-border whitespace-pre-wrap break-words rounded-md p-3 font-mono text-xs leading-relaxed ring-1">
                  {skill.instructions}
                </pre>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold uppercase tracking-widest">
      {children}
    </p>
  );
}
