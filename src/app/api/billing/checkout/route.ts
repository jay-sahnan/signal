import {
  BillingRequestError,
  requireBillingOwner,
} from "@/lib/billing/account";
import { beginPrepaidCheckout } from "@/lib/billing/prepaid-checkout";

export async function POST(request: Request) {
  try {
    const account = await requireBillingOwner(request);
    return Response.json({ url: await beginPrepaidCheckout(account) });
  } catch (error) {
    if (error instanceof BillingRequestError)
      return Response.json({ error: error.message }, { status: error.status });
    console.error(
      "Billing checkout failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      { error: "Checkout unavailable; please retry" },
      { status: 503 },
    );
  }
}
