"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmailSettings } from "@/components/settings/email-settings";
import { IntegrationsPanel } from "@/components/settings/integrations-panel";
import { SettingsSection } from "@/components/settings/settings-section";

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
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
        <div>
          <h1 className="type-title">Settings</h1>
          <p className="text-muted-foreground text-sm">
            Manage your account and preferences.
          </p>
        </div>

        <Link
          href="/settings/billing"
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          Billing and subscription
        </Link>

        <Tabs defaultValue="email" className="space-y-6">
          <TabsList>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="space-y-8">
            <EmailSettings />
          </TabsContent>

          <TabsContent value="integrations">
            <SettingsSection
              title="Integrations"
              description="Status of every external service Signal can talk to. Add missing keys to .env.local and restart the dev server to unlock more features."
            >
              <IntegrationsPanel />
            </SettingsSection>
          </TabsContent>

          <TabsContent value="preferences">
            <SettingsSection title="Appearance">
              <DarkModeToggle />
            </SettingsSection>
          </TabsContent>

          {/* Usage/cost reporting is intentionally not user-facing: the
              CostCenter component and /api/settings/costs stay in the tree
              for a future admin-only view. */}
        </Tabs>
      </div>
    </div>
  );
}
