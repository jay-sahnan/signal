"use client";

import { useState } from "react";
import type { prepaidStatus } from "@/lib/billing/prepaid-management";
import { Button } from "@/components/ui/button";

type Status = Awaited<ReturnType<typeof prepaidStatus>>;
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
  return (
    <section
      className="space-y-6"
      aria-label="Workspace billing"
      aria-busy={busy !== null}
    >
      <div className="rounded-xl border p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Workspace credits</h2>
          <span className="rounded-full bg-muted px-3 py-1 text-sm">
            Prepaid
          </span>
        </div>
        <dl className="grid grid-cols-3 gap-3 tabular-nums">
          {[
            ["Available credits", status.available],
            ["Reserved", status.reserved],
            ["Spent", status.spent],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold">
                {value.toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground text-sm">
          {status.packCredits === null
            ? "Top-ups are temporarily unavailable."
            : `New top-ups add ${status.packCredits.toLocaleString()} credits per pack.`}{" "}
          Purchased credits do not expire. Top-ups are manual; there is no
          automatic renewal.
        </p>
        {status.pendingPurchase && (
          <p className="text-sm">
            Your purchase of {status.pendingCredits?.toLocaleString()} credits
            is pending. Resume checkout or refresh to check confirmation.
          </p>
        )}
        {status.riskHold && (
          <p role="alert" className="text-sm text-destructive">
            Billing needs review. Contact your workspace owner or support.
          </p>
        )}
        {status.canManage ? (
          <div className="flex flex-wrap gap-2">
            {!status.riskHold && status.packCredits !== null && (
              <Button
                className="min-h-11"
                disabled={busy !== null}
                onClick={() => act("checkout")}
              >
                {busy === "checkout"
                  ? "Opening checkout…"
                  : status.pendingPurchase
                    ? "Resume checkout"
                    : "Buy credits"}
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
            Your workspace owner manages credit purchases.
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Stripe shows the price before you confirm payment. After paying, refresh
        status to check your balance. Credits are added only after payment is
        verified. Reserved credits are held for work in progress.
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
