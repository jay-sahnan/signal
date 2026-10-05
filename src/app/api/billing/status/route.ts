import { BillingRequestError } from "@/lib/billing/account";
import { prepaidStatus } from "@/lib/billing/prepaid-management";

export async function GET() {
  try {
    return Response.json(await prepaidStatus(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const status = error instanceof BillingRequestError ? error.status : 503;
    return Response.json(
      {
        error:
          status === 503 ? "Billing unavailable" : (error as Error).message,
      },
      { status },
    );
  }
}
