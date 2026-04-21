"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SettingsSection } from "@/components/settings/settings-section";

interface Inbox {
  inbox_id: string;
  display_name: string | null;
}

export function EmailSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [isConfigured, setIsConfigured] = useState(false);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newInboxName, setNewInboxName] = useState("");

  const [inboxId, setInboxId] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const load = async () => {
      try {
        const res = await fetch("/api/settings/email");
        if (!res.ok) return;
        const data = await res.json();
        if (!mountedRef.current) return;

        setInboxes(data.inboxes ?? []);
        setIsConfigured(data.is_configured);
        setInboxId(data.settings.agentmail_inbox_id ?? "");
        setFromName(data.settings.from_name ?? "");
        setReplyTo(data.settings.reply_to_email ?? "");
      } catch {
        // silently fail
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    load();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentmail_inbox_id: inboxId || null,
          from_name: fromName || null,
          reply_to_email: replyTo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to save settings");
        return;
      }
      setIsConfigured(!!inboxId);
      toast.success("Email settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateInbox = async () => {
    if (!newInboxName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/settings/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_inbox",
          display_name: newInboxName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to create inbox");
        return;
      }

      const newInbox: Inbox = {
        inbox_id: data.inbox?.inboxId ?? data.inbox?.inbox_id ?? "",
        display_name: newInboxName.trim(),
      };
      setInboxes((prev) => [...prev, newInbox]);
      setInboxId(newInbox.inbox_id);
      setNewInboxName("");
      setShowCreateInput(false);
      toast.success(`Inbox created: ${newInbox.inbox_id}`);
    } catch {
      toast.error("Failed to create inbox");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <SettingsSection
        title="Email"
        description="Configure your AgentMail inbox for sending outreach emails."
      >
        <p className="text-muted-foreground text-sm">
          Loading email settings...
        </p>
      </SettingsSection>
    );
  }

  const statusBadge = isConfigured ? (
    <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full px-2.5 py-0.5 text-xs font-medium">
      Connected
    </span>
  ) : (
    <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
      Not connected
    </span>
  );

  return (
    <SettingsSection
      title="Email"
      description="Configure your AgentMail inbox for sending outreach emails."
      actions={statusBadge}
    >
      <div className="space-y-4">
        {/* Inbox selector */}
        <div className="space-y-1.5">
          <label htmlFor="inbox-select" className="text-sm font-medium">
            Inbox
          </label>
          {inboxes.length > 0 ? (
            <Select
              id="inbox-select"
              value={inboxId}
              onValueChange={setInboxId}
              placeholder="Select an inbox..."
              items={[
                { value: "", label: "Select an inbox..." },
                ...inboxes.map((inbox) => ({
                  value: inbox.inbox_id,
                  label: inbox.display_name
                    ? `${inbox.inbox_id} (${inbox.display_name})`
                    : inbox.inbox_id,
                })),
              ]}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              No inboxes found. Create one to get started.
            </p>
          )}

          {!showCreateInput ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCreateInput(true)}
            >
              Create new inbox
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder="Inbox display name..."
                value={newInboxName}
                onChange={(e) => setNewInboxName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateInbox()}
              />
              <Button
                size="sm"
                onClick={handleCreateInbox}
                disabled={creating || !newInboxName.trim()}
              >
                {creating ? "Creating..." : "Create"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowCreateInput(false);
                  setNewInboxName("");
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>

        {/* From Name */}
        <div className="space-y-1.5">
          <label htmlFor="from-name" className="text-sm font-medium">
            From Name
          </label>
          <Input
            id="from-name"
            type="text"
            placeholder="e.g. Alex from Signal"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Display name shown in the recipient&apos;s inbox.
          </p>
        </div>

        {/* Reply-To */}
        <div className="space-y-1.5">
          <label htmlFor="reply-to" className="text-sm font-medium">
            Reply-To Email (optional)
          </label>
          <Input
            id="reply-to"
            type="email"
            placeholder="e.g. alex@yourcompany.com"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Where replies go. Defaults to the inbox address if empty.
          </p>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Email Settings"}
        </Button>
      </div>
    </SettingsSection>
  );
}
