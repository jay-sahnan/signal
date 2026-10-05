/** Operator-defined credit weights, separate from Stripe's pack price. */
export function quoteCredits(kind: string, units = 1) {
  const rateVersion = process.env.SIGNAL_CREDIT_RATE_VERSION?.trim();
  if (!rateVersion || rateVersion.length > 100)
    throw new Error("Credit rate version is not configured");
  let rates: unknown;
  try {
    rates = JSON.parse(process.env.SIGNAL_CREDIT_RATES ?? "");
  } catch {
    throw new Error("Credit rates are not configured");
  }
  if (
    !rates ||
    typeof rates !== "object" ||
    Array.isArray(rates) ||
    !Object.prototype.hasOwnProperty.call(rates, kind)
  )
    throw new Error("Credit rate is not configured for this action");
  const rate = (rates as Record<string, unknown>)[kind];
  if (
    typeof rate !== "number" ||
    !Number.isSafeInteger(rate) ||
    rate < 1 ||
    !Number.isSafeInteger(units) ||
    units < 1 ||
    units > 10_000
  )
    throw new Error("Invalid credit rate or usage quantity");
  const credits = rate * units;
  if (!Number.isSafeInteger(credits) || credits > 1_000_000)
    throw new Error("Credit quote exceeds the operation limit");
  return { credits, rateVersion };
}
