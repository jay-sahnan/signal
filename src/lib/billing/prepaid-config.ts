/** Explicit operator configuration; no prices or credit quantities from requests. */
function required(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

export function stripeConnectionConfig() {
  const origin = required("SIGNAL_PUBLIC_URL");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin)
    throw new Error(
      "Invalid SIGNAL_PUBLIC_URL: use an HTTPS origin without a path",
    );
  return {
    origin,
    secretKey: required("STRIPE_SECRET_KEY"),
    webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
  };
}

export function prepaidConfig() {
  const priceId = required("STRIPE_CREDIT_PRICE_ID");
  if (!/^price_[a-zA-Z0-9]+$/.test(priceId))
    throw new Error("Invalid STRIPE_CREDIT_PRICE_ID");
  const raw = required("SIGNAL_CREDIT_PACK_SIZE");
  const credits = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(credits) ||
    credits < 1 ||
    credits > 1_000_000_000
  )
    throw new Error("Invalid SIGNAL_CREDIT_PACK_SIZE");
  const rateVersion = required("SIGNAL_CREDIT_RATE_VERSION");
  if (rateVersion.length > 100)
    throw new Error("Invalid SIGNAL_CREDIT_RATE_VERSION");
  return { priceId, credits, rateVersion };
}
