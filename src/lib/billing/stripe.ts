import Stripe from "stripe";
import { stripeConnectionConfig } from "./prepaid-config";

/** Lazy initialization keeps self-hosted installs independent of Stripe. */
export function getStripe(): Stripe {
  return new Stripe(stripeConnectionConfig().secretKey, {
    apiVersion: "2026-09-30.endive",
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
}
