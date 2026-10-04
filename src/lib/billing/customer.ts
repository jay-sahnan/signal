import { getAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "./stripe";

/** Call only after verifying the active workspace owner. */
export async function ensureBillingCustomer(
  workspaceId: string,
): Promise<string> {
  const db = getAdminClient();
  const { error: insertError } = await db
    .from("workspace_billing")
    .upsert(
      { workspace_id: workspaceId },
      { onConflict: "workspace_id", ignoreDuplicates: true },
    );
  if (insertError) throw new Error("Billing account unavailable");
  const read = async () => {
    const { data, error } = await db
      .from("workspace_billing")
      .select("stripe_customer_id")
      .eq("workspace_id", workspaceId)
      .single();
    if (error || !data) throw new Error("Billing account unavailable");
    return data.stripe_customer_id as string | null;
  };
  const existing = await read();
  if (existing) return existing;
  const customer = await getStripe().customers.create(
    { metadata: { workspace_id: workspaceId } },
    { idempotencyKey: `signal-customer:${workspaceId}` },
  );
  const { error } = await db
    .from("workspace_billing")
    .update({ stripe_customer_id: customer.id })
    .eq("workspace_id", workspaceId)
    .is("stripe_customer_id", null);
  if (error) throw new Error("Cannot save billing customer");
  const saved = await read();
  if (!saved) throw new Error("Billing customer unavailable");
  return saved;
}
