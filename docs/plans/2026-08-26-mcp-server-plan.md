# Remote MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose Signal's agent tools over a Clerk-OAuth-protected remote MCP endpoint so any user of the instance can drive it from Claude Code or Codex as themselves.

**Architecture:** `/api/mcp` verifies a Clerk OAuth token, then runs each tool call inside an `AsyncLocalStorage` identity scope. `getSupabaseAndUser()` reads that scope before falling back to Clerk's cookie `auth()`, and for MCP callers signs a short-lived Supabase JWT (`sub` = Clerk user id, `role: authenticated`) so existing RLS applies unchanged. Design: `docs/plans/2026-08-26-mcp-server.md`.

**Tech Stack:** Next.js 16 app router, `mcp-handler`, `@clerk/mcp-tools`, `@modelcontextprotocol/sdk`, `jose` (HS256), vitest, Supabase RLS.

**Conventions to respect:**

- No em dashes in string literals (ESLint errors). Use colons.
- Tests: `src/__tests__/<name>.test.ts`, vitest, mock `@clerk/nextjs/server` via `vi.hoisted` + `vi.mock` (see `src/__tests__/supabase-server-token.test.ts`).
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint` before each commit.
- Work on branch `feat/mcp-server` (branched from `design/mcp-server`). Open a fresh PR; never push follow-ups to an open PR.

---

### Task 1: Identity store

**Files:**

- Create: `src/lib/auth/identity.ts`
- Test: `src/__tests__/identity-store.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import {
  getCurrentIdentity,
  getCurrentUserId,
  runWithIdentity,
} from "@/lib/auth/identity";

describe("identity store", () => {
  it("is empty outside a scope", () => {
    expect(getCurrentIdentity()).toBeUndefined();
  });

  it("exposes the identity inside runWithIdentity, including across awaits", async () => {
    const seen = await runWithIdentity(
      { userId: "user_a", source: "mcp" },
      async () => {
        await Promise.resolve();
        return getCurrentIdentity();
      },
    );
    expect(seen).toEqual({ userId: "user_a", source: "mcp" });
    expect(getCurrentIdentity()).toBeUndefined();
  });

  it("getCurrentUserId falls back to the provided resolver when no scope is set", async () => {
    const id = await getCurrentUserId(async () => "user_from_clerk");
    expect(id).toBe("user_from_clerk");
    const scoped = await runWithIdentity(
      { userId: "user_b", source: "mcp" },
      () => getCurrentUserId(async () => "user_from_clerk"),
    );
    expect(scoped).toBe("user_b");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/identity-store.test.ts`
Expected: FAIL, cannot resolve `@/lib/auth/identity`.

**Step 3: Write minimal implementation**

```ts
// src/lib/auth/identity.ts
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who the current request acts as, when it did not arrive through Clerk's
 * cookie session. The MCP route sets this around each tool call; everything
 * that reads user identity (getSupabaseAndUser, the tools that call Clerk's
 * auth() for a userId) checks here first and falls back to Clerk otherwise.
 */
export type Identity = {
  userId: string;
  /** Where the request came from, for cost and telemetry attribution. */
  source: "mcp";
};

const store = new AsyncLocalStorage<Identity>();

export function runWithIdentity<T>(identity: Identity, fn: () => T): T {
  return store.run(identity, fn);
}

export function getCurrentIdentity(): Identity | undefined {
  return store.getStore();
}

/**
 * The acting user id: the injected identity if present, else whatever the
 * caller's resolver (normally Clerk's auth()) says.
 */
export async function getCurrentUserId(
  fallback: () => Promise<string | null | undefined>,
): Promise<string | null> {
  const injected = store.getStore();
  if (injected) return injected.userId;
  return (await fallback()) ?? null;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/__tests__/identity-store.test.ts`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/lib/auth/identity.ts src/__tests__/identity-store.test.ts
git commit -m "feat(auth): AsyncLocalStorage identity scope for non-cookie callers"
```

---

### Task 2: App-signed Supabase JWT

**Files:**

- Modify: `package.json` (add `jose` as a direct dependency)
- Create: `src/lib/auth/supabase-jwt.ts`
- Test: `src/__tests__/supabase-jwt.test.ts`

**Step 1: Install dependency**

Run: `pnpm add jose`
Expected: `jose` appears under `dependencies` (already present transitively at 6.x).

**Step 2: Write the failing test**

```ts
import { jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-secret-at-least-32-characters-long!!";

describe("signSupabaseJwt", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_JWT_SECRET", SECRET);
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("signs sub and role: authenticated with a 10 minute expiry", async () => {
    const { signSupabaseJwt } = await import("@/lib/auth/supabase-jwt");
    const token = await signSupabaseJwt("user_abc");
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(SECRET),
    );
    expect(payload.sub).toBe("user_abc");
    expect(payload.role).toBe("authenticated");
    expect(payload.exp! - payload.iat!).toBe(600);
  });

  it("reuses a cached token for the same user while it has life left", async () => {
    const { signSupabaseJwt } = await import("@/lib/auth/supabase-jwt");
    const a = await signSupabaseJwt("user_abc");
    const b = await signSupabaseJwt("user_abc");
    expect(b).toBe(a);
    const c = await signSupabaseJwt("user_other");
    expect(c).not.toBe(a);
  });

  it("throws a clear error when the secret is unset", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    const { signSupabaseJwt } = await import("@/lib/auth/supabase-jwt");
    await expect(signSupabaseJwt("user_abc")).rejects.toThrow(
      /SUPABASE_JWT_SECRET/,
    );
  });
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/supabase-jwt.test.ts`
Expected: FAIL, module not found.

**Step 4: Write minimal implementation**

```ts
// src/lib/auth/supabase-jwt.ts
import { SignJWT } from "jose";

/**
 * Supabase-accepted JWT for a caller that has no Clerk session (MCP OAuth).
 *
 * RLS keys every policy on requesting_user_id() = auth.jwt() ->> 'sub', which
 * for browser sessions is the Clerk user id. Signing the same sub with the
 * project's JWT secret lands the caller in exactly the same scope. `role`
 * must be `authenticated` or PostgREST maps the request to anon and every
 * policy returns zero rows (same trap as the Clerk role claim).
 */
export const SUPABASE_JWT_TTL_SECONDS = 600;
const REFRESH_SKEW_MS = 30_000;

type Cached = { token: string; expMs: number };
const cache = new Map<string, Cached>();

function secret(): Uint8Array {
  const s = process.env.SUPABASE_JWT_SECRET;
  if (!s) {
    throw new Error(
      "SUPABASE_JWT_SECRET is unset: cannot sign a Supabase token for MCP callers. " +
        "Copy it from Supabase Dashboard: Settings: API: JWT Secret.",
    );
  }
  return new TextEncoder().encode(s);
}

export async function signSupabaseJwt(userId: string): Promise<string> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expMs - now > REFRESH_SKEW_MS) return hit.token;

  const iat = Math.floor(now / 1000);
  const exp = iat + SUPABASE_JWT_TTL_SECONDS;
  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secret());

  for (const [k, v] of cache) if (v.expMs <= now) cache.delete(k);
  cache.set(userId, { token, expMs: exp * 1000 });
  return token;
}

/** Test hook. */
export function clearSupabaseJwtCache() {
  cache.clear();
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/__tests__/supabase-jwt.test.ts`
Expected: PASS (3 tests).

**Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/auth/supabase-jwt.ts src/__tests__/supabase-jwt.test.ts
git commit -m "feat(auth): sign short-lived Supabase JWTs for session-less callers"
```

---

### Task 3: getSupabaseAndUser honours the identity scope

**Files:**

- Modify: `src/lib/supabase/server.ts:229-274` (`createClient`, `getSupabaseAndUser`)
- Test: `src/__tests__/supabase-server-identity.test.ts`

**Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  fetches: [] as FetchImpl[],
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _u: string,
    _k: string,
    o: { global: { fetch: FetchImpl } },
  ) => {
    h.fetches.push(o.global.fetch);
    return {};
  },
}));
vi.mock("@/lib/auth/supabase-jwt", () => ({
  signSupabaseJwt: vi.fn(async (id: string) => `signed-for-${id}`),
}));

import { runWithIdentity } from "@/lib/auth/identity";
import { getSupabaseAndUser } from "@/lib/supabase/server";

async function tokenSent(fetchImpl: FetchImpl) {
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}"));
  await fetchImpl("https://db/rest/v1/x", { method: "GET" });
  const init = spy.mock.calls[0][1] as RequestInit;
  spy.mockRestore();
  return new Headers(init.headers).get("authorization");
}

describe("getSupabaseAndUser with an injected identity", () => {
  beforeEach(() => {
    h.fetches.length = 0;
    h.auth.mockReset();
  });

  it("uses the injected user and a signed token, never touching Clerk", async () => {
    const ctx = await runWithIdentity(
      { userId: "user_mcp", source: "mcp" },
      () => getSupabaseAndUser(),
    );
    expect(ctx?.user).toEqual({ id: "user_mcp", email: "" });
    expect(h.auth).not.toHaveBeenCalled();
    expect(await tokenSent(h.fetches[0])).toBe("Bearer signed-for-user_mcp");
  });

  it("falls back to Clerk when no identity is injected", async () => {
    h.auth.mockResolvedValue({
      isAuthenticated: true,
      userId: "user_cookie",
      sessionId: "sess_1",
      sessionClaims: { email: "a@b.c" },
      getToken: async () => null,
    });
    const ctx = await getSupabaseAndUser();
    expect(ctx?.user).toEqual({ id: "user_cookie", email: "a@b.c" });
    expect(h.auth).toHaveBeenCalledTimes(1);
  });
});
```

Note: the signed token has no readable `exp` in this mock, so `hasLifeLeft` returns false and the provider calls the resolver again; that is fine because `signSupabaseJwt` is cached. If the assertion on the Authorization header fails because of that path, make the mock return a token with a real base64url payload carrying `exp` (copy the `jwt()` helper from `supabase-server-token.test.ts`).

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/supabase-server-identity.test.ts`
Expected: first test FAILS (auth called, token not `signed-for-user_mcp`).

**Step 3: Implement**

In `src/lib/supabase/server.ts`, add imports at the top:

```ts
import { getCurrentIdentity } from "@/lib/auth/identity";
import { signSupabaseJwt } from "@/lib/auth/supabase-jwt";
```

Replace the start of `createClient`:

```ts
export const createClient = async () => {
  warnIfKeyless();
  const injected = getCurrentIdentity();
  const freshToken = injected
    ? // Session-less caller: the app signs its own token. The provider still
      // handles expiry so a long MCP tool call re-signs mid-flight.
      createTokenProvider(() => signSupabaseJwt(injected.userId), null)
    : await (async () => {
        const { getToken, sessionId } = await auth();
        return createTokenProvider(getToken, sessionId);
      })();

  return createServerClient(supabaseUrl!, supabaseKey!, {
```

`createTokenProvider` with `sessionId = null` calls the getter on every request; `signSupabaseJwt` caches per user so that is cheap. Keep the rest of `createClient` unchanged.

Replace `getSupabaseAndUser`:

```ts
export async function getSupabaseAndUser(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email: string };
} | null> {
  const injected = getCurrentIdentity();
  if (injected) {
    const supabase = await createClient();
    return { supabase, user: { id: injected.userId, email: "" } };
  }
  const { isAuthenticated, userId, sessionClaims } = await auth();
  if (!isAuthenticated || !userId) return null;
  const supabase = await createClient();
  const email =
    (sessionClaims as { email?: string } | null | undefined)?.email ?? "";
  return { supabase, user: { id: userId, email } };
}
```

**Step 4: Run tests**

Run: `pnpm vitest run src/__tests__/supabase-server-identity.test.ts src/__tests__/supabase-server-token.test.ts`
Expected: PASS, existing token tests unaffected.

**Step 5: Commit**

```bash
git add src/lib/supabase/server.ts src/__tests__/supabase-server-identity.test.ts
git commit -m "feat(supabase): scoped client honours injected identity before Clerk"
```

---

### Task 4: Tools stop calling Clerk `auth()` directly

**Files:**

- Modify: `src/lib/tools/campaign-tools.ts:3,66`
- Modify: `src/lib/tools/learning-tools.ts:3,66,121,157`
- Modify: `src/lib/tools/profile-tools.ts:3,83`
- Modify: `src/lib/tools/sender-fact-tools.ts:3,70,153`
- Modify: `src/lib/tools/signal-tools.ts:8,377`
- Create: `src/lib/auth/acting-user.ts`
- Test: `src/__tests__/acting-user.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));

import { runWithIdentity } from "@/lib/auth/identity";
import { actingUserId } from "@/lib/auth/acting-user";

describe("actingUserId", () => {
  it("prefers the injected identity", async () => {
    const id = await runWithIdentity(
      { userId: "user_mcp", source: "mcp" },
      () => actingUserId(),
    );
    expect(id).toBe("user_mcp");
    expect(h.auth).not.toHaveBeenCalled();
  });
  it("falls back to Clerk", async () => {
    h.auth.mockResolvedValue({ userId: "user_cookie" });
    expect(await actingUserId()).toBe("user_cookie");
  });
});
```

**Step 2: Run to verify it fails**

Run: `pnpm vitest run src/__tests__/acting-user.test.ts`
Expected: FAIL, module not found.

**Step 3: Implement**

```ts
// src/lib/auth/acting-user.ts
import { auth } from "@clerk/nextjs/server";

import { getCurrentUserId } from "./identity";

/** The user a tool acts for: injected (MCP) first, Clerk cookie session otherwise. */
export async function actingUserId(): Promise<string | null> {
  return getCurrentUserId(async () => (await auth()).userId);
}
```

Then in each of the five tool files: replace `import { auth } from "@clerk/nextjs/server";` with `import { actingUserId } from "@/lib/auth/acting-user";` and every `const { userId } = await auth();` with `const userId = await actingUserId();`. Eight call sites total; use the Edit tool per site, and assert afterwards:

Run: `grep -rn '@clerk/nextjs/server' src/lib/tools/`
Expected: no output.

**Step 4: Run the whole suite**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. Tests that mock `@clerk/nextjs/server` for these tools (e.g. `learning-tools-errors.test.ts`) keep working because `actingUserId` calls the same import.

**Step 5: Commit**

```bash
git add src/lib/auth/acting-user.ts src/__tests__/acting-user.test.ts src/lib/tools/
git commit -m "refactor(tools): resolve acting user through identity scope"
```

---

### Task 5: Cost and telemetry attribution carries `source`

**Files:**

- Modify: `src/lib/tools/index.ts:176-215` (`withTelemetry`)
- Modify: `src/lib/services/cost-tracker.ts:218-240` (`trackUsage` insert)
- Test: extend `src/__tests__/cost-attribution.test.ts`

**Step 1: Write the failing test** (append to `cost-attribution.test.ts`; read the file first and reuse its admin-client mock and flush helper)

```ts
it("stamps metadata.source = mcp when running under an MCP identity", async () => {
  await runWithIdentity({ userId: "user_mcp", source: "mcp" }, async () => {
    trackUsage({
      service: "exa",
      operation: "search",
      estimated_cost_usd: 0.01,
    });
    await flush();
  });
  expect(lastInsert().metadata).toMatchObject({ source: "mcp" });
});
```

**Step 2: Run to verify it fails**

Run: `pnpm vitest run src/__tests__/cost-attribution.test.ts`
Expected: FAIL, `metadata.source` undefined.

**Step 3: Implement**

In `cost-tracker.ts` `trackUsage`, when building the insert:

```ts
import { getCurrentIdentity } from "@/lib/auth/identity";
// ...
metadata: {
  ...(entry.metadata ?? {}),
  source: getCurrentIdentity()?.source ?? "web",
},
```

In `tools/index.ts` `withTelemetry`, add to the PostHog properties:

```ts
source: getCurrentIdentity()?.source ?? "web",
```

and change `distinctId` to `ctx?.userId ?? getCurrentIdentity()?.userId ?? "anonymous"` (MCP calls pass no `experimental_context`).

**Step 4: Run tests**

Run: `pnpm vitest run src/__tests__/cost-attribution.test.ts && pnpm typecheck`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/tools/index.ts src/lib/services/cost-tracker.ts src/__tests__/cost-attribution.test.ts
git commit -m "feat(telemetry): attribute spend and tool calls to their source"
```

---

### Task 6: MCP tool registry

**Files:**

- Create: `src/lib/mcp/registry.ts`
- Test: `src/__tests__/mcp-registry.test.ts`

Background: every entry in `allTools` (`src/lib/tools/index.ts`) is an AI SDK `tool()` with `description`, `inputSchema` (Zod object) and `execute(input, opts)`. The chat route passes `experimental_context` in `opts`; MCP passes `{}` so anything reading `writer`/`voiceRun` must degrade. `openPage` (`src/lib/tools/navigation-tools.ts`) only writes to `writer` when present and returns `{ path, label }` regardless, so it needs no change.

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { mcpToolList, toMcpResult } from "@/lib/mcp/registry";

describe("mcp registry", () => {
  it("exposes every agent tool except the UI-only exclusions", () => {
    const names = mcpToolList().map((t) => t.name);
    expect(names).toContain("searchCompanies");
    expect(names).toContain("deleteCompanies");
    expect(names).toContain("openPage");
    for (const t of mcpToolList()) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toBeInstanceOf(z.ZodObject);
      expect(typeof t.execute).toBe("function");
    }
  });

  it("serialises results as a single JSON text block", () => {
    expect(toMcpResult({ ok: 1 })).toEqual({
      content: [{ type: "text", text: JSON.stringify({ ok: 1 }, null, 2) }],
    });
    expect(toMcpResult("plain")).toEqual({
      content: [{ type: "text", text: "plain" }],
    });
  });
});
```

Also assert the send tool is present: find its exported name with `grep -n "Send\|send" src/lib/tools/index.ts | head` and add `expect(names).toContain("<thatName>")`.

**Step 2: Run to verify it fails**

Run: `pnpm vitest run src/__tests__/mcp-registry.test.ts`
Expected: FAIL, module not found.

**Step 3: Implement**

```ts
// src/lib/mcp/registry.ts
import type { z } from "zod";

import { allTools } from "@/lib/tools";

/**
 * Tools that only make sense with the web chat's streaming UI attached.
 * Empty today: openPage degrades to returning the path as data. Add names
 * here when a tool has no meaning without a `writer`.
 */
const MCP_EXCLUDE = new Set<string>([]);

export type McpTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  execute: (input: unknown, opts: unknown) => Promise<unknown>;
};

export function mcpToolList(): McpTool[] {
  return Object.entries(allTools)
    .filter(([name]) => !MCP_EXCLUDE.has(name))
    .map(([name, t]) => {
      const tool = t as {
        description?: string;
        inputSchema: z.ZodObject<z.ZodRawShape>;
        execute?: (input: unknown, opts: unknown) => unknown;
      };
      return {
        name,
        description: tool.description ?? name,
        inputSchema: tool.inputSchema,
        execute: async (input, opts) => tool.execute?.(input, opts),
      };
    });
}

export function toMcpResult(result: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  const text =
    typeof result === "string"
      ? result
      : JSON.stringify(result ?? null, null, 2);
  return { content: [{ type: "text", text }] };
}
```

If the `instanceof ZodObject` assertion fails for some tool (a `.strict()` or `.refine()` wrapper), widen `inputSchema` to `z.ZodTypeAny`, and in Task 7 register `{}` as the shape for those tools and `parse` inside the handler.

**Step 4: Run tests**

Run: `pnpm vitest run src/__tests__/mcp-registry.test.ts && pnpm typecheck`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/mcp/registry.ts src/__tests__/mcp-registry.test.ts
git commit -m "feat(mcp): registry adapting agent tools to MCP shape"
```

---

### Task 7: The `/api/mcp` route with Clerk OAuth

**Files:**

- Modify: `package.json` (add `mcp-handler`, `@clerk/mcp-tools`, `@modelcontextprotocol/sdk`)
- Create: `src/lib/mcp/auth.ts`
- Create: `src/app/api/mcp/[transport]/route.ts`
- Create: `src/app/.well-known/oauth-protected-resource/mcp/route.ts`
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`
- Modify: `src/proxy.ts:3-9` (public routes)
- Test: `src/__tests__/mcp-route-auth.test.ts`

**Step 1: Install**

Run: `pnpm add mcp-handler @clerk/mcp-tools @modelcontextprotocol/sdk`
Expected: three new entries in `dependencies`. Read `node_modules/@clerk/mcp-tools/next/README.md` once to confirm the export names used below still match.

**Step 2: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auth: vi.fn(), verify: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));
vi.mock("@clerk/mcp-tools/next", () => ({ verifyClerkToken: h.verify }));

import { verifyMcpBearer } from "@/lib/mcp/auth";

describe("verifyMcpBearer", () => {
  it("returns auth info with the Clerk user id for a valid OAuth token", async () => {
    h.auth.mockResolvedValue({ userId: "user_1" });
    h.verify.mockResolvedValue({
      token: "t",
      clientId: "c",
      scopes: [],
      extra: { userId: "user_1" },
    });
    const info = await verifyMcpBearer("t");
    expect(h.auth).toHaveBeenCalledWith({ acceptsToken: "oauth_token" });
    expect(info?.extra?.userId).toBe("user_1");
  });
  it("returns undefined when Clerk rejects the token", async () => {
    h.auth.mockResolvedValue({ userId: null });
    h.verify.mockResolvedValue(undefined);
    expect(await verifyMcpBearer("bad")).toBeUndefined();
  });
});
```

**Step 3: Run to verify it fails**

Run: `pnpm vitest run src/__tests__/mcp-route-auth.test.ts`
Expected: FAIL, `@/lib/mcp/auth` not found.

**Step 4: Implement**

```ts
// src/lib/mcp/auth.ts
import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { auth } from "@clerk/nextjs/server";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/** Bearer OAuth token (issued by Clerk) to MCP AuthInfo, or undefined. */
export async function verifyMcpBearer(
  token: string,
): Promise<AuthInfo | undefined> {
  const clerkAuth = await auth({ acceptsToken: "oauth_token" });
  return verifyClerkToken(clerkAuth, token);
}
```

```ts
// src/app/api/mcp/[transport]/route.ts
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { runWithIdentity } from "@/lib/auth/identity";
import { verifyMcpBearer } from "@/lib/mcp/auth";
import { mcpToolList, toMcpResult } from "@/lib/mcp/registry";

// Same ceiling as /api/chat: enrichment batches run for minutes.
export const maxDuration = 800;

const handler = createMcpHandler(
  (server) => {
    for (const t of mcpToolList()) {
      server.tool(
        t.name,
        t.description,
        t.inputSchema.shape,
        async (input, { authInfo }) => {
          const userId = authInfo?.extra?.userId as string | undefined;
          if (!userId) {
            return { isError: true, ...toMcpResult({ error: "Unauthorized" }) };
          }
          try {
            const result = await runWithIdentity(
              { userId, source: "mcp" },
              () => t.execute(input, {}),
            );
            return toMcpResult(result);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { isError: true, ...toMcpResult({ error: message }) };
          }
        },
      );
    }
  },
  {},
  { basePath: "/api/mcp", maxDuration, verboseLogs: false },
);

const authed = withMcpAuth(
  handler,
  async (_req, token) => verifyMcpBearer(token),
  {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
  },
);

export { authed as GET, authed as POST, authed as DELETE };
```

```ts
// src/app/.well-known/oauth-protected-resource/mcp/route.ts
import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/next";

const handler = protectedResourceHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();
export { handler as GET, corsHandler as OPTIONS };
```

```ts
// src/app/.well-known/oauth-authorization-server/route.ts
import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next";

const handler = authServerMetadataHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();
export { handler as GET, corsHandler as OPTIONS };
```

`src/proxy.ts`: add to `isPublicRoute`:

```ts
  // MCP does its own bearer verification; a cookie redirect to /login would
  // break the OAuth discovery handshake for Claude Code / Codex.
  "/api/mcp(.*)",
  "/.well-known/(.*)",
```

**Step 5: Run tests, typecheck, build**

Run: `pnpm vitest run src/__tests__/mcp-route-auth.test.ts && pnpm typecheck && pnpm build`
Expected: PASS; build lists `/api/mcp/[transport]` and both `.well-known` routes.

**Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/mcp/auth.ts src/app/api/mcp src/app/.well-known src/proxy.ts src/__tests__/mcp-route-auth.test.ts
git commit -m "feat(mcp): remote MCP endpoint protected by Clerk OAuth"
```

---

### Task 8: Missing secret fails loudly

**Files:**

- Create: `src/lib/mcp/config.ts`
- Modify: `src/app/api/mcp/[transport]/route.ts`
- Test: `src/__tests__/mcp-route-config.test.ts`

**Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { mcpConfigError } from "@/lib/mcp/config";

describe("mcpConfigError", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("names the missing secret", () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    expect(mcpConfigError()).toMatch(/SUPABASE_JWT_SECRET/);
  });
  it("is null when configured", () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "x".repeat(40));
    expect(mcpConfigError()).toBeNull();
  });
});
```

**Step 2: Run to verify it fails**

Run: `pnpm vitest run src/__tests__/mcp-route-config.test.ts`
Expected: FAIL, module not found.

**Step 3: Implement**

```ts
// src/lib/mcp/config.ts
export function mcpConfigError(): string | null {
  if (!process.env.SUPABASE_JWT_SECRET) {
    return (
      "MCP is not configured: SUPABASE_JWT_SECRET is unset. Copy the JWT " +
      "secret from Supabase Dashboard: Settings: API, and redeploy."
    );
  }
  return null;
}
```

In the route, replace the final export line with:

```ts
import { mcpConfigError } from "@/lib/mcp/config";

let warned = false;
function guarded(h: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const problem = mcpConfigError();
    if (problem) {
      if (!warned) {
        warned = true;
        console.error(`FATAL: ${problem}`);
      }
      return Response.json({ error: problem }, { status: 503 });
    }
    return h(req);
  };
}
export const GET = guarded(authed);
export const POST = guarded(authed);
export const DELETE = guarded(authed);
```

**Step 4: Run tests**

Run: `pnpm vitest run src/__tests__/mcp-route-config.test.ts && pnpm typecheck`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/mcp/config.ts src/app/api/mcp src/__tests__/mcp-route-config.test.ts
git commit -m "feat(mcp): 503 with a clear message when SUPABASE_JWT_SECRET is unset"
```

---

### Task 9: RLS isolation integration test (local Supabase)

**Files:**

- Test: `src/__tests__/mcp-rls-isolation.integration.test.ts`

Runs only when `SUPABASE_JWT_SECRET` and a Supabase URL are present, so CI without Supabase stays green. Get the local secret from `supabase status -o env` (`JWT_SECRET`).

**Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";

import { runWithIdentity } from "@/lib/auth/identity";
import { getSupabaseAndUser } from "@/lib/supabase/server";

const enabled =
  !!process.env.SUPABASE_JWT_SECRET && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.runIf(enabled)("MCP identity is RLS-scoped", () => {
  it("user A sees only A's campaigns; user B sees none of them", async () => {
    const asA = await runWithIdentity(
      { userId: "user_mcp_a", source: "mcp" },
      () => getSupabaseAndUser(),
    );
    const asB = await runWithIdentity(
      { userId: "user_mcp_b", source: "mcp" },
      () => getSupabaseAndUser(),
    );
    const { error: insErr } = await asA!.supabase
      .from("campaigns")
      .insert({ user_id: "user_mcp_a", name: "mcp isolation probe" });
    expect(insErr).toBeNull();

    const a = await asA!.supabase.from("campaigns").select("id,user_id");
    const b = await asB!.supabase.from("campaigns").select("id,user_id");
    expect(a.data!.length).toBeGreaterThan(0);
    expect(a.data!.every((r) => r.user_id === "user_mcp_a")).toBe(true);
    expect(b.data).toEqual([]);

    await asA!.supabase
      .from("campaigns")
      .delete()
      .eq("name", "mcp isolation probe");
  });
});
```

Adjust the insert to the NOT NULL columns `campaigns` actually requires (check the initial migration under `supabase/migrations/`).

**Step 2: Run with local Supabase**

Run: `supabase start && SUPABASE_JWT_SECRET=$(supabase status -o env | grep JWT_SECRET | cut -d= -f2 | tr -d '"') pnpm vitest run src/__tests__/mcp-rls-isolation.integration.test.ts`
Expected: PASS. Without the env the suite reports skipped.

**Step 3: Commit**

```bash
git add src/__tests__/mcp-rls-isolation.integration.test.ts
git commit -m "test(mcp): RLS isolation for app-signed identities"
```

---

### Task 10: Setup docs and env

**Files:**

- Modify: `.env.example` (after line 26, `SUPABASE_SERVICE_ROLE_KEY=`)
- Modify: `docs/setup.md` (after the Clerk section, around line 95)
- Modify: `scripts/setup.mjs` (where `SUPABASE_SERVICE_ROLE_KEY` is written)
- Modify: `README.md` (one link line)
- Create: `docs/mcp.md`

**Step 1: `.env.example`**

```
# JWT secret from Supabase Dashboard: Settings: API. Only needed for the MCP
# endpoint (Claude Code / Codex): signs per-user tokens for OAuth callers.
SUPABASE_JWT_SECRET=
```

**Step 2: `scripts/setup.mjs`**: next to `SUPABASE_SERVICE_ROLE_KEY`, also write `SUPABASE_JWT_SECRET` (local: parse `JWT_SECRET` from `supabase status -o env`; remote: prompt with the dashboard hint). Assert the hunk landed: `grep -n SUPABASE_JWT_SECRET scripts/setup.mjs` prints at least two lines.

**Step 3: `docs/mcp.md`**

```markdown
# Driving Signal from Claude Code or Codex

Signal exposes its agent tools over MCP at `https://<your-app>/api/mcp`.
Sign in once in the browser; from then on your coding agent calls the same
tools the web chat uses, scoped to your account.

## Connect

    claude mcp add --transport http signal https://<your-app>/api/mcp
    codex mcp add signal --url https://<your-app>/api/mcp

Your client opens Clerk's sign-in page. Approve, and you are done.

## Operator setup (once per instance)

1. Supabase Dashboard: Settings: API: copy **JWT Secret** into `SUPABASE_JWT_SECRET`.
2. Clerk Dashboard: OAuth Applications: enable **Dynamic client registration**.
3. Deploy. No migration.

## Revoking access

Clerk Dashboard: Users: pick the user: OAuth authorizations.

## What is exposed

Every tool in the web chat, including sending and deleting. The daily send
cap, kill switch and ownership checks apply exactly as in the browser.
```

Link it from `docs/setup.md` and `README.md` (one line each).

**Step 4: Lint + commit**

Run: `pnpm lint`
Expected: 0 errors.

```bash
git add .env.example docs/setup.md docs/mcp.md README.md scripts/setup.mjs
git commit -m "docs: MCP setup for operators and users"
```

---

### Task 11: Manual end-to-end against a preview deploy

No code. Do this before opening the PR.

1. Push the branch; Vercel builds a preview. Set `SUPABASE_JWT_SECRET` on the preview environment (use the staging Supabase's secret if the preview points at staging; never prod's on a preview).
2. In Clerk (dev instance), enable Dynamic client registration.
3. `claude mcp add --transport http signal https://<preview>/api/mcp`, then in Claude Code `/mcp` shows `signal: connected`.
4. Ask Claude Code: "list my campaigns" (expect your rows), "search companies for fintech in London in campaign X", "enrich the first one", "draft outreach to one contact". Stop before send unless a test recipient exists.
5. Confirm in Settings: Costs that new spend rows carry `metadata.source = mcp`.
6. Sign in as a second test user, repeat step 3, confirm "list my campaigns" is empty for them.

Record the results in the PR description, then open the PR:

```bash
gh pr create --title "feat(mcp): drive Signal from Claude Code and Codex via Clerk OAuth" --body "Design: docs/plans/2026-08-26-mcp-server.md

Deploy order: set SUPABASE_JWT_SECRET in Vercel and enable Dynamic client registration in Clerk BEFORE merging; the route answers 503 until then.

Manual E2E: <paste step results>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
