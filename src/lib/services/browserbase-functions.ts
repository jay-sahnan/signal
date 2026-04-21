import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const BASE_URL = "https://api.browserbase.com/v1/functions";

export type InvocationStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | (string & {});

export interface Invocation {
  id: string;
  functionId: string;
  sessionId: string | null;
  status: InvocationStatus;
  params: Record<string, unknown>;
  results?: unknown;
  createdAt: string;
  endedAt?: string | null;
}

function getApiKey(): string {
  const key = process.env.BROWSERBASE_API_KEY;
  if (!key) {
    throw new Error("BROWSERBASE_API_KEY is not set");
  }
  return key;
}

export async function invokeFunction(
  functionId: string,
  params: Record<string, unknown>,
): Promise<Invocation> {
  const res = await fetchWithTimeout(
    `${BASE_URL}/${functionId}/invoke`,
    {
      method: "POST",
      headers: {
        "x-bb-api-key": getApiKey(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ params }),
    },
    60_000,
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Browserbase invoke failed: ${res.status} ${body}`);
  }

  return (await res.json()) as Invocation;
}

export async function getInvocation(invocationId: string): Promise<Invocation> {
  const res = await fetchWithTimeout(
    `${BASE_URL}/invocations/${invocationId}`,
    {
      method: "GET",
      headers: {
        "x-bb-api-key": getApiKey(),
      },
    },
    15_000,
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Browserbase getInvocation failed: ${res.status} ${body}`);
  }

  return (await res.json()) as Invocation;
}

export function isTerminalStatus(status: InvocationStatus): boolean {
  return status === "COMPLETED" || status === "FAILED";
}
