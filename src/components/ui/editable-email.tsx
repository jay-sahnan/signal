"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EditableEmailProps {
  value: string | null;
  onSave: (next: string) => Promise<void>;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
}

export function EditableEmail({
  value,
  onSave,
  placeholder = "--",
  className,
  inputClassName,
  disabled,
  allowEmpty = false,
}: EditableEmailProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(value ?? "");
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, value]);

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) {
      setEditing(false);
      return;
    }
    if (!trimmed && !allowEmpty) {
      toast.error("Email cannot be empty");
      return;
    }
    if (trimmed && !EMAIL_RE.test(trimmed)) {
      toast.error("Invalid email format");
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Input
          ref={inputRef}
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={saving}
          className={cn("h-7 text-xs", inputClassName)}
          aria-label="Email address"
        />
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={commit}
          disabled={saving}
          aria-label="Save email"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={cancel}
          disabled={saving}
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      {value ? (
        <span className="truncate text-xs" title={value}>
          {value}
        </span>
      ) : (
        <span className="text-muted-foreground/50 text-xs">{placeholder}</span>
      )}
      {!disabled && (
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => setEditing(true)}
          aria-label="Edit email"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
