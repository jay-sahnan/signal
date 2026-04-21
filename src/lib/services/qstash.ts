import { Client, Receiver } from "@upstash/qstash";

let _client: Client | null = null;

export function getQStashClient(): Client {
  if (!_client) {
    const token = process.env.QSTASH_TOKEN;
    if (!token) throw new Error("QSTASH_TOKEN is required");
    _client = new Client({ token });
  }
  return _client;
}

/**
 * Verify QStash signature on incoming requests.
 * Returns the parsed body if valid, throws if invalid.
 */
export async function verifyQStashSignature<T = unknown>(
  request: Request,
): Promise<T> {
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!currentKey || !nextKey) {
    throw new Error(
      "QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY are required",
    );
  }

  const receiver = new Receiver({
    currentSigningKey: currentKey,
    nextSigningKey: nextKey,
  });

  const body = await request.text();
  const signature = request.headers.get("upstash-signature");

  if (!signature) {
    throw new Error("Missing upstash-signature header");
  }

  const isValid = await receiver.verify({
    signature,
    body,
  });

  if (!isValid) {
    throw new Error("Invalid QStash signature");
  }

  return JSON.parse(body) as T;
}

/**
 * Get the base URL for QStash callbacks.
 * Uses VERCEL_URL in production, localhost in dev.
 */
export function getBaseUrl(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}
