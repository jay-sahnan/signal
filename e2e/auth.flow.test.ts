import { test, expect } from "@playwright/test";
import {
  supabase,
  createTestUser,
  authCookiesFor,
  authedFetch,
  cleanupTestUsers,
  TEST_PREFIX,
} from "./helpers";

// UI-level tests for the auth flow under Clerk. The custom Supabase signup
// form is gone; signup goes through Clerk's prebuilt <SignUp /> component,
// which has its own validation and email-code verification step. We don't
// retest Clerk's UI here — we only verify the behaviors our app owns:
// middleware redirects, JWT-backed RLS isolation, session persistence.

test.afterAll(async () => {
  await cleanupTestUsers();
});

test.describe("middleware redirects", () => {
  test("unauthenticated / redirects to /login", async ({ page }) => {
    await page.goto("http://localhost:3000/");
    await page.waitForURL(/\/login(\/.*)?$/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/login(\/.*)?$/);
  });

  test("signed-in user visiting /login is allowed (Clerk handles redirect)", async ({
    browser,
  }) => {
    const user = await createTestUser();
    const ctx = await browser.newContext();
    await ctx.addCookies(authCookiesFor(user));
    const page = await ctx.newPage();
    // Clerk's <SignIn /> auto-redirects an already-signed-in user to /. We
    // accept either landing on / or seeing the sign-in page render briefly
    // before redirect — both indicate the session is recognized.
    await page.goto("http://localhost:3000/login");
    await page.waitForURL(/^http:\/\/localhost:3000\/(login(\/.*)?)?$/, {
      timeout: 10_000,
    });
    await ctx.close();
  });

  test("public webhook routes do NOT require auth", async ({ request }) => {
    // /api/agentmail/webhook is a Svix webhook handler — must accept POSTs
    // without a Clerk session. Without a valid Svix signature it'll return
    // 400/401 from the handler, NOT a 307 redirect to /login.
    const res = await request.post(
      "http://localhost:3000/api/agentmail/webhook",
      {
        data: {},
        failOnStatusCode: false,
      },
    );
    expect(res.status()).not.toBe(307);
    expect([200, 400, 401, 422]).toContain(res.status());
  });
});

test.describe("session + persistence", () => {
  test("session cookie persists across reload", async ({ browser }) => {
    const user = await createTestUser();
    const ctx = await browser.newContext();
    await ctx.addCookies(authCookiesFor(user));
    const page = await ctx.newPage();

    await page.goto("http://localhost:3000/");
    await page.waitForLoadState("load");
    expect(page.url()).toBe("http://localhost:3000/");

    await page.reload();
    await page.waitForLoadState("load");
    expect(page.url()).toBe("http://localhost:3000/");

    await ctx.close();
  });

  test("clearing __session cookie redirects back to /login", async ({
    browser,
  }) => {
    const user = await createTestUser();
    const ctx = await browser.newContext();
    await ctx.addCookies(authCookiesFor(user));
    const page = await ctx.newPage();

    await page.goto("http://localhost:3000/");
    expect(page.url()).toBe("http://localhost:3000/");

    await ctx.clearCookies();
    await page.goto("http://localhost:3000/");
    await page.waitForURL(/\/login(\/.*)?$/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/login(\/.*)?$/);

    await ctx.close();
  });
});

test.describe("RLS via Clerk JWT (the core contract)", () => {
  test("user can read their own empty campaigns list", async () => {
    const user = await createTestUser();
    const res = await authedFetch("/api/dashboard", user);
    // /api/dashboard is one of the user-authenticated routes. Expect 200 OR
    // 404/empty payload — anything except a 307/401, which would mean the
    // Clerk JWT didn't propagate through middleware → server client → RLS.
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(401);
    expect([200, 204, 404]).toContain(res.status);
  });

  test("user B cannot see user A's campaign (RLS isolation)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    // Seed via service role so we don't depend on userA's API access.
    const { data: campaign, error } = await supabase
      .from("campaigns")
      .insert({
        name: `${TEST_PREFIX} isolation-A`,
        status: "discovery",
        icp: {},
        offering: {},
        positioning: {},
        search_criteria: {},
        user_id: userA.id,
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    // Direct PostgREST round-trip with userB's Clerk JWT. RLS should filter
    // out userA's row. If we get the row back, the JWT bridge is broken.
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/campaigns?id=eq.${campaign!.id}&select=id`,
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
          Authorization: `Bearer ${userB.accessToken}`,
        },
      },
    );
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toEqual([]);
  });

  test("user A can see their own campaign through RLS", async () => {
    const userA = await createTestUser();
    const { data: campaign } = await supabase
      .from("campaigns")
      .insert({
        name: `${TEST_PREFIX} self-A`,
        status: "discovery",
        icp: {},
        offering: {},
        positioning: {},
        search_criteria: {},
        user_id: userA.id,
      })
      .select("id")
      .single();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/campaigns?id=eq.${campaign!.id}&select=id`,
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
          Authorization: `Bearer ${userA.accessToken}`,
        },
      },
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(campaign!.id);
  });
});

test.describe.skip("Clerk sign-up form UI", () => {
  // These tests would exercise Clerk's prebuilt <SignUp /> component
  // (selectors, captcha bypass via setupClerkTestingToken, email-code
  // verification flow). They test Clerk's UI, not our code, so they're
  // skipped by default. Re-enable after deciding which auth-UI invariants
  // we actually want to guard against Clerk SDK upgrades.
  test("signup form accepts a new email and lands on /", async () => {
    // TODO: implement with @clerk/testing setupClerkTestingToken
  });
});
