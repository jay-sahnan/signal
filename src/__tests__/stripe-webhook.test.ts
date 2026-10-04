// @vitest-environment node
import Stripe from "stripe";
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("@/lib/billing/events", () => ({ processBillingEvent: h.process }));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => true }));
vi.mock("@/lib/billing/prepaid-config", () => ({
  stripeConnectionConfig: () => ({
    secretKey: "sk_test_example",
    webhookSecret: "whsec_test",
  }),
}));
import { POST } from "@/app/api/webhooks/stripe/route";
const payload = JSON.stringify({
  id: "evt_test",
  type: "invoice.paid",
  data: { object: { customer: "cus_test" } },
});
const request = (signature: string, body = payload) =>
  new Request("https://signal.example/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body,
  });
const signed = () =>
  Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
beforeEach(() => {
  vi.clearAllMocks();
  h.process.mockResolvedValue(undefined);
});
it("verifies the original raw body before processing", async () => {
  expect((await POST(request(signed()))).status).toBe(200);
  expect(h.process).toHaveBeenCalledWith(
    expect.objectContaining({ id: "evt_test" }),
  );
});
it("rejects forged or altered event bodies before any billing mutation", async () => {
  expect((await POST(request("invalid"))).status).toBe(400);
  expect((await POST(request(signed(), payload + " "))).status).toBe(400);
  expect(h.process).not.toHaveBeenCalled();
});
it("returns retryable failure if durable processing fails", async () => {
  h.process.mockRejectedValue(new Error("Database unavailable"));
  expect((await POST(request(signed()))).status).toBe(500);
});
it("stops consuming an unsigned stream as soon as the size limit is crossed", async () => {
  let chunks = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunks++ === 128) controller.close();
      else controller.enqueue(new Uint8Array(64 * 1024));
    },
  });
  const req = new Request("https://signal.example/api/webhooks/stripe", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  expect((await POST(req)).status).toBe(413);
  expect(chunks).toBeLessThan(128);
  expect(h.process).not.toHaveBeenCalled();
});
