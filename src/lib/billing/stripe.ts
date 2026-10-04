import Stripe from "stripe";
import { billingConfig } from "./config";

/** Lazy initialization keeps self-hosted installs independent of Stripe. */
export function getStripe(): Stripe {
  return new Stripe(billingConfig().secretKey, {
    apiVersion: "2026-09-30.endive",
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
}
