import { isHostedMode } from "@/lib/auth/workspace";
import { getAdminClient } from "@/lib/supabase/admin";
import { isJobRequestAuthorized } from "@/lib/services/jobs";
import { findCheckoutSession } from "@/lib/billing/checkout-history";
import { fulfillCreditSession } from "@/lib/billing/prepaid-fulfillment";
import type { CreditOrder } from "@/lib/billing/prepaid-fulfillment";

export const maxDuration = 300;
export async function GET(request: Request) {
  if (!isJobRequestAuthorized(request))
    return new Response(null, { status: 401 });
  if (!isHostedMode()) return new Response(null, { status: 404 });
  const db = getAdminClient();
  const released = await db.rpc("release_expired_credit_reservations", {
    p_limit: 100,
  });
  if (released.error)
    return Response.json(
      { error: "Reservation recovery failed" },
      { status: 503 },
    );
  const claimed = await db.rpc("claim_credit_reconciliation", { p_limit: 2 });
  if (claimed.error)
    return Response.json(
      { error: "Purchase recovery unavailable" },
      { status: 503 },
    );
  let checked = 0,
    failed = 0;
  // Small batch and durable DB-clock retry scheduling prevent one stuck account
  // monopolizing recovery. This never initiates payments or reruns research.
  for (const order of (claimed.data ?? []) as CreditOrder[]) {
    try {
      const sessionId =
        order.session_id ??
        (await findCheckoutSession(order.customer_id, order.id))?.id;
      if (sessionId) await fulfillCreditSession(sessionId, order.workspace_id);
      checked++;
    } catch {
      failed++;
      console.error("Credit purchase reconciliation failed", {
        orderId: order.id,
      });
    }
  }
  return Response.json(
    { checked, failed, released: released.data },
    { status: failed ? 503 : 200 },
  );
}
export const POST = GET;
