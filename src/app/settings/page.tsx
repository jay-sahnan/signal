"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@clerk/nextjs";

import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CostCenter } from "@/components/settings/cost-center";
import { EmailSettings } from "@/components/settings/email-settings";
import { SettingsSection } from "@/components/settings/settings-section";
import { EmailSkillsAttacher } from "@/components/email-skills/email-skills-attacher";

const noop = () => () => {};
const getTrue = () => true;
const getFalse = () => false;

function DarkModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, getTrue, getFalse);
  const isDark = mounted && resolvedTheme === "dark";
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">Dark mode</p>
        <p className="text-muted-foreground text-sm">
          Toggle between light and dark themes.
        </p>
      </div>
      <Switch
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        disabled={!mounted}
        aria-label="Toggle dark mode"
      />
    </div>
  );
}

export default function SettingsPage() {
  const { userId } = useAuth();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground text-sm">
            Manage your account and preferences.
          </p>
        </div>

        <Tabs defaultValue="email" className="space-y-6">
          <TabsList>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="space-y-8">
            <EmailSettings />
            <EmailSkillsAttacher
              scopeType="user"
              scopeId={userId ?? null}
              title="Default email skills"
              description="Markdown rule packs applied to every email you draft, across all campaigns."
              unscopedMessage="Signing in…"
            />
          </TabsContent>

          <TabsContent value="preferences">
            <SettingsSection title="Appearance">
              <DarkModeToggle />
            </SettingsSection>
          </TabsContent>

          <TabsContent value="usage">
            <CostCenter />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
