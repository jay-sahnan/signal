import Link from "next/link";
import { redirect } from "next/navigation";
import { isHostedMode } from "@/lib/auth/workspace";
import { prepaidStatus } from "@/lib/billing/prepaid-management";
import { BillingRequestError } from "@/lib/billing/account";
import { BillingSettings } from "@/components/settings/billing-settings";

export default async function BillingPage() {
  let status;
  if (isHostedMode()) {
    try {
      status = await prepaidStatus();
    } catch (error) {
      if (error instanceof BillingRequestError && error.status === 401)
        redirect("/login?redirect_url=%2Fsettings%2Fbilling");
    }
  }
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 overflow-y-auto p-4 md:p-6">
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center text-sm underline"
      >
        Back to settings
      </Link>
      <div>
        <h1 className="type-title">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Manage your workspace credits and payment history.
        </p>
      </div>
      {!isHostedMode() ? (
        <p>
          This deployment is self-hosted. Billing is managed by its operator.
        </p>
      ) : status ? (
        <BillingSettings initial={status} />
      ) : (
        <p role="alert">
          Billing is temporarily unavailable. Reload this page to retry.
        </p>
      )}
    </div>
  );
}
