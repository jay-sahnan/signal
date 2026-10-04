"use client";

import { useState } from "react";
import type { billingStatus } from "@/lib/billing/management";
import { Button } from "@/components/ui/button";

type Status = Awaited<ReturnType<typeof billingStatus>>;
const labels: Record<string, string> = {
  none: "No confirmed subscription",
  active: "Active",
  canceled: "Canceled",
  past_due: "Payment overdue",
  unpaid: "Payment required",
  paused: "Paused",
  incomplete: "Payment pending",
  incomplete_expired: "Checkout expired",
  trialing: "Trial",
};

export function BillingSettings({ initial }: { initial: Status }) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function act(action: "checkout" | "portal" | "refresh") {
    if (busy) return;
    setBusy(action);
    setError("");
    try {
      const path =
        action === "checkout"
          ? "/api/billing/checkout"
          : `/api/billing/manage${action === "refresh" ? "?action=refresh" : ""}`;
      const response = await fetch(path, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Billing unavailable");
      if (action === "refresh") {
        const result = await fetch("/api/billing/status", {
          cache: "no-store",
        });
        if (!result.ok) throw new Error("Could not refresh billing status");
        setStatus(await result.json());
      } else {
        if (typeof data.url !== "string")
          throw new Error("Billing URL unavailable");
        window.location.assign(data.url);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Billing unavailable");
    } finally {
      setBusy(null);
    }
  }
  const canSubscribe =
    !status.riskHold &&
    ["none", "canceled", "incomplete_expired"].includes(status.status);
  return (
    <section
      className="space-y-6"
      aria-label="Workspace billing"
      aria-busy={busy !== null}
    >
      <div className="rounded-xl border p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Signal monthly plan</h2>
          <span className="rounded-full bg-muted px-3 py-1 text-sm">
            {labels[status.status] ?? "Awaiting confirmation"}
          </span>
        </div>
        <p className="text-muted-foreground text-sm tabular-nums">
          {status.plan.monthlyUnits.toLocaleString()} research units and up to{" "}
          {status.plan.monitorLimit.toLocaleString()} monitored companies per
          month. Shared across Signal and ChatGPT.
        </p>
        {status.periodEnd && (
          <p className="text-sm">
            {status.cancelAtPeriodEnd
              ? "Scheduled to end"
              : "Current period ends"}{" "}
            {new Date(status.periodEnd).toLocaleDateString("en-US", {
              timeZone: "UTC",
              dateStyle: "medium",
            })}
            .
          </p>
        )}
        {status.riskHold && (
          <p role="alert" className="text-sm text-destructive">
            Billing needs review. Contact your workspace owner or support.
          </p>
        )}
        {status.canManage ? (
          <div className="flex flex-wrap gap-2">
            {canSubscribe && (
              <Button
                className="min-h-11"
                disabled={busy !== null}
                onClick={() => act("checkout")}
              >
                {busy === "checkout"
                  ? "Opening checkout…"
                  : "View pricing and subscribe"}
              </Button>
            )}
            {status.hasCustomer && (
              <>
                <Button
                  className="min-h-11"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => act("portal")}
                >
                  {busy === "portal" ? "Opening billing…" : "Manage billing"}
                </Button>
                <Button
                  className="min-h-11"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => act("refresh")}
                >
                  {busy === "refresh" ? "Refreshing…" : "Refresh status"}
                </Button>
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your workspace owner manages the subscription.
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Stripe shows the price before you confirm payment. After paying or
        changing your subscription, refresh status to check confirmation.
        Returning from checkout alone does not activate access.
      </p>
      <div className="min-h-6" aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
