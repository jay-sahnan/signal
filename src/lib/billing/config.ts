/** Server configuration only. No prices, limits, or return URLs come from requests. */
export function billingConfig() {
  const required = (key: string) => {
    const value = process.env[key]?.trim();
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };
  const positiveInteger = (key: string) => {
    const value = required(key);
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) <= 0
    ) {
      throw new Error(`Invalid ${key}`);
    }
    return Number(value);
  };
  const origin = required("SIGNAL_PUBLIC_URL");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin) {
    throw new Error(
      "Invalid SIGNAL_PUBLIC_URL: use an HTTPS origin without a path",
    );
  }
  const priceId = required("STRIPE_PRICE_ID");
  if (!/^price_[a-zA-Z0-9]+$/.test(priceId))
    throw new Error("Invalid STRIPE_PRICE_ID");
  const monitorLimit = positiveInteger("SIGNAL_MONITOR_LIMIT");
  if (monitorLimit > 2_147_483_647)
    throw new Error("Invalid SIGNAL_MONITOR_LIMIT");
  return {
    secretKey: required("STRIPE_SECRET_KEY"),
    webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
    priceId,
    origin,
    planVersion: required("SIGNAL_PLAN_VERSION"),
    monthlyUnits: positiveInteger("SIGNAL_MONTHLY_UNITS"),
    monitorLimit,
  };
}
