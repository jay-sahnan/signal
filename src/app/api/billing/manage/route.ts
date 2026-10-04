import { BillingRequestError } from "@/lib/billing/account";
import {
  openPrepaidPortal,
  refreshPrepaidBilling,
} from "@/lib/billing/prepaid-management";

export async function POST(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("action") === "refresh") {
      await refreshPrepaidBilling(request);
      return Response.json({ refreshed: true });
    }
    return Response.json({ url: await openPrepaidPortal(request) });
  } catch (error) {
    if (error instanceof BillingRequestError)
      return Response.json({ error: error.message }, { status: error.status });
    console.error(
      "Billing management failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      { error: "Billing unavailable; please retry" },
      { status: 503 },
    );
  }
}
