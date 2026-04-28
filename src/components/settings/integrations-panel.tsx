"use client";

import { Check, X, Loader2, ExternalLink } from "lucide-react";

import {
  CATEGORY_LABELS,
  INTEGRATIONS,
  type Integration,
  type IntegrationCategory,
  groupIntegrationsByCategory,
} from "@/lib/integrations";
import { useIntegrationsStatus } from "@/hooks/use-integrations-status";
import { cn } from "@/lib/utils";

/**
 * Read-only status grid for every integration in `INTEGRATIONS`. Lets the
 * user see at a glance which features are unlocked and which are gated by
 * a missing env var. Each row links to the signup page so they can fix
 * what's missing without leaving Signal.
 */
export function IntegrationsPanel() {
  const { statuses, loading, error } = useIntegrationsStatus();

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading integrations…
      </div>
    );
  }

  if (error || !statuses) {
    return (
      <p className="text-muted-foreground text-sm">
        Couldn&apos;t load integration status. Make sure you&apos;re signed in
        and refresh.
      </p>
    );
  }

  const configuredById = new Map(statuses.map((s) => [s.id, s.configured]));
  const grouped = groupIntegrationsByCategory();
  const totalCount = INTEGRATIONS.length;
  const configuredCount = INTEGRATIONS.filter((i) =>
    configuredById.get(i.id),
  ).length;

  return (
    <div className="space-y-6">
      <div className="text-muted-foreground text-sm">
        <span className="text-foreground font-medium">{configuredCount}</span>{" "}
        of {totalCount} integrations configured. Add missing env vars to{" "}
        <code className="bg-muted rounded px-1">.env.local</code> and restart
        the dev server to unlock more features.
      </div>

      {(Object.keys(grouped) as IntegrationCategory[]).map((category) => (
        <CategorySection
          key={category}
          category={category}
          integrations={grouped[category]}
          configuredById={configuredById}
        />
      ))}
    </div>
  );
}

function CategorySection({
  category,
  integrations,
  configuredById,
}: {
  category: IntegrationCategory;
  integrations: Integration[];
  configuredById: Map<string, boolean>;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-widest">
        {CATEGORY_LABELS[category]}
      </h3>
      <ul className="border-border divide-border divide-y rounded-lg border">
        {integrations.map((integration) => (
          <IntegrationRow
            key={integration.id}
            integration={integration}
            configured={configuredById.get(integration.id) ?? false}
          />
        ))}
      </ul>
    </div>
  );
}

function IntegrationRow({
  integration,
  configured,
}: {
  integration: Integration;
  configured: boolean;
}) {
  const isRequired = integration.severity === "required";
  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <StatusIcon configured={configured} required={isRequired} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{integration.name}</span>
            {isRequired && (
              <span className="text-muted-foreground rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                required
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {integration.feature}
          </p>
          {!configured && (
            <p className="text-muted-foreground mt-1 text-xs">
              {integration.consequence}
            </p>
          )}
        </div>
      </div>
      {!configured && integration.signupUrl && (
        <a
          href={integration.signupUrl}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs underline"
        >
          Get a key
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </li>
  );
}

function StatusIcon({
  configured,
  required,
}: {
  configured: boolean;
  required: boolean;
}) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
        configured
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : required
            ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
            : "bg-muted text-muted-foreground",
      )}
      aria-label={configured ? "Configured" : "Not configured"}
    >
      {configured ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
    </span>
  );
}
