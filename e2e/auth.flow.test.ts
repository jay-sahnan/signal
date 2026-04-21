import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  supabase,
  createTestUser,
  authCookiesFor,
  cleanupTestUsers,
  TEST_PREFIX,
} from "./helpers";

// UI-level tests for the auth flow. Run in the `auth` Playwright project
// (configured in playwright.config.ts) so they get a browser context.

test.afterAll(async () => {
  await cleanupTestUsers();
});

test.describe("signup → lands in app", () => {
  test("unauthenticated / redirects to /login", async ({ page }) => {
    await page.goto("http://localhost:3000/");
    await page.waitForURL(/\/login$/);
    expect(page.url()).toMatch(/\/login$/);
  });

  test("signup form creates an account and routes to /", async ({ page }) => {
    const email = `${TEST_PREFIX}${Date.now()}@example.com`;
    const password = "signup-test-Aa1!";

    await page.goto("http://localhost:3000/signup");
    await page.getByLabel(/first name/i).fill("E2E");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByLabel(/confirm password/i).fill(password);
    await page.getByRole("button", { name: /sign up/i }).click();

    await page.waitForURL("http://localhost:3000/", { timeout: 10_000 });
    expect(page.url()).toBe("http://localhost:3000/");

    const cookies = await page.context().cookies();
    expect(
      cookies.some(
        (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"),
      ),
    ).toBe(true);

    // Confirm the trigger fired: a user_profile row was created.
    const { data: authUser } = await supabase.auth.admin.listUsers({
      perPage: 200,
    });
    const created = authUser.users.find((u) => u.email === email);
    expect(created).toBeTruthy();

    const { data: profile } = await supabase
      .from("user_profile")
      .select("id, label, email, user_id")
      .eq("user_id", created!.id)
      .maybeSingle();
    expect(profile).toBeTruthy();
    expect(profile!.label).toBe("Default");
    expect(profile!.email).toBe(email);
  });
});

test.describe("signup form validation", () => {
  test("rejects missing first name", async ({ page }) => {
    await page.goto("http://localhost:3000/signup");
    await page.getByLabel(/^email$/i).fill(`${TEST_PREFIX}${Date.now()}@x.com`);
    await page.getByLabel(/^password$/i).fill("password123");
    await page.getByLabel(/confirm password/i).fill("password123");
    await page.getByRole("button", { name: /sign up/i }).click();

    await expect(page.getByText(/first name is required/i)).toBeVisible({
      timeout: 5_000,
    });
    expect(page.url()).toContain("/signup");
  });

  test("rejects missing email", async ({ page }) => {
    await page.goto("http://localhost:3000/signup");
    await page.getByLabel(/first name/i).fill("E2E");
    await page.getByLabel(/^password$/i).fill("password123");
    await page.getByLabel(/confirm password/i).fill("password123");
    await page.getByRole("button", { name: /sign up/i }).click();

    await expect(
      page.getByText(/email and password are required/i),
    ).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain("/signup");
  });

  test("rejects short password", async ({ page }) => {
    await page.goto("http://localhost:3000/signup");
    await page.getByLabel(/first name/i).fill("E2E");
    await page.getByLabel(/^email$/i).fill(`${TEST_PREFIX}${Date.now()}@x.com`);
    await page.getByLabel(/^password$/i).fill("12345");
    await page.getByLabel(/confirm password/i).fill("12345");
    await page.getByRole("button", { name: /sign up/i }).click();

    await expect(page.getByText(/at least 6 characters/i)).toBeVisible({
      timeout: 5_000,
    });
    expect(page.url()).toContain("/signup");
  });

  test("rejects mismatched confirm password", async ({ page }) => {
    await page.goto("http://localhost:3000/signup");
    await page.getByLabel(/first name/i).fill("E2E");
    await page.getByLabel(/^email$/i).fill(`${TEST_PREFIX}${Date.now()}@x.com`);
    await page.getByLabel(/^password$/i).fill("password123");
    await page.getByLabel(/confirm password/i).fill("password999");
    await page.getByRole("button", { name: /sign up/i }).click();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible({
      timeout: 5_000,
    });
    expect(page.url()).toContain("/signup");
  });

  test("rejects duplicate email", async ({ page, browser }) => {
    const email = `${TEST_PREFIX}dup-${Date.now()}@example.com`;
    const password = "password123";

    // First signup via a dedicated context — don't pollute the page under test.
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await page1.goto("http://localhost:3000/signup");
    await page1.getByLabel(/first name/i).fill("First");
    await page1.getByLabel(/^email$/i).fill(email);
    await page1.getByLabel(/^password$/i).fill(password);
    await page1.getByLabel(/confirm password/i).fill(password);
    await page1.getByRole("button", { name: /sign up/i }).click();
    await page1.waitForURL("http://localhost:3000/", { timeout: 10_000 });
    await ctx1.close();

    // Attempt second signup with the same email.
    await page.goto("http://localhost:3000/signup");
    await page.getByLabel(/first name/i).fill("Second");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByLabel(/confirm password/i).fill(password);
    await page.getByRole("button", { name: /sign up/i }).click();

    // Supabase returns "User already registered" or similar — toast shows it,
    // URL stays on /signup.
    await expect(page).toHaveURL(/\/signup/, { timeout: 10_000 });

    // Confirm only one auth.users row for that email.
    const { data: users } = await supabase.auth.admin.listUsers({
      perPage: 200,
    });
    const matches = users.users.filter((u) => u.email === email);
    expect(matches).toHaveLength(1);
  });

  test("password must match confirm in real-time ordering (6+ chars checked first)", async ({
    page,
  }) => {
    // Short password + mismatch — the short-password check should fire first
    // because the handler validates length before comparing confirm.
    await page.goto("http://localhost:3000/signup");
    await page.getByLabel(/first name/i).fill("E2E");
    await page.getByLabel(/^email$/i).fill(`${TEST_PREFIX}${Date.now()}@x.com`);
    await page.getByLabel(/^password$/i).fill("abc");
    await page.getByLabel(/confirm password/i).fill("xyz");
    await page.getByRole("button", { name: /sign up/i }).click();

    await expect(page.getByText(/at least 6 characters/i)).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe("signup side-effects", () => {
  test("creates exactly one user_profile row (trigger is idempotent per insert)", async ({
    page,
  }) => {
    const email = `${TEST_PREFIX}profile-${Date.now()}@example.com`;

    await page.goto("http://localhost:3000/signup");
    await page.getByLabel(/first name/i).fill("Jay");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill("signup-test-Aa1!");
    await page.getByLabel(/confirm password/i).fill("signup-test-Aa1!");
    await page.getByRole("button", { name: /sign up/i }).click();
    await page.waitForURL("http://localhost:3000/", { timeout: 10_000 });

    const { data: users } = await supabase.auth.admin.listUsers({
      perPage: 200,
    });
    const created = users.users.find((u) => u.email === email);
    expect(created).toBeTruthy();

    const { data: profiles } = await supabase
      .from("user_profile")
      .select("id, label, name, email, user_id")
      .eq("user_id", created!.id);

    expect(profiles).toHaveLength(1);
    expect(profiles![0].label).toBe("Default");
    expect(profiles![0].name).toBe("Jay");
    expect(profiles![0].email).toBe(email);
    expect(profiles![0].user_id).toBe(created!.id);
  });

  test("session persists across reload", async ({ page }) => {
    const email = `${TEST_PREFIX}persist-${Date.now()}@example.com`;
    const password = "signup-test-Aa1!";

    await page.goto("http://localhost:3000/signup");
    await page.getByLabel(/first name/i).fill("Persist");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByLabel(/confirm password/i).fill(password);
    await page.getByRole("button", { name: /sign up/i }).click();
    await page.waitForURL("http://localhost:3000/", { timeout: 10_000 });

    await page.reload();
    await page.waitForLoadState("load");
    expect(page.url()).toBe("http://localhost:3000/");
  });

  test("signed-in user visiting /signup is redirected to /", async ({
    browser,
  }) => {
    const user = await createTestUser();
    const ctx = await browser.newContext();
    await ctx.addCookies(authCookiesFor(user));
    const page = await ctx.newPage();
    await page.goto("http://localhost:3000/signup");
    await page.waitForURL("http://localhost:3000/", { timeout: 10_000 });
    expect(page.url()).toBe("http://localhost:3000/");
    await ctx.close();
  });

  test("signed-in user visiting /login is redirected to /", async ({
    browser,
  }) => {
    const user = await createTestUser();
    const ctx = await browser.newContext();
    await ctx.addCookies(authCookiesFor(user));
    const page = await ctx.newPage();
    await page.goto("http://localhost:3000/login");
    await page.waitForURL("http://localhost:3000/", { timeout: 10_000 });
    expect(page.url()).toBe("http://localhost:3000/");
    await ctx.close();
  });

  test("new signup can immediately read their own empty campaigns list", async ({
    page,
  }) => {
    const email = `${TEST_PREFIX}empty-${Date.now()}@example.com`;
    const password = "signup-test-Aa1!";

    await page.goto("http://localhost:3000/signup");
    await page.getByLabel(/first name/i).fill("Empty");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByLabel(/confirm password/i).fill(password);
    await page.getByRole("button", { name: /sign up/i }).click();
    await page.waitForURL("http://localhost:3000/", { timeout: 10_000 });

    // Round-trip through PostgREST with the user's real access token — same
    // path the browser client uses. Expect an empty list, status 200.
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
      { auth: { persistSession: false } },
    );
    const { data: signin } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    expect(signin.session).toBeTruthy();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/campaigns?select=id`,
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
          Authorization: `Bearer ${signin.session!.access_token}`,
        },
      },
    );
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toEqual([]);
  });
});

test.describe("tenant isolation", () => {
  test("User B cannot see User A's campaign", async ({ browser }) => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    const { data: aCampaign, error } = await supabase
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

    const ctxB = await browser.newContext();
    await ctxB.addCookies(authCookiesFor(userB));
    const pageB = await ctxB.newPage();
    await pageB.goto(`http://localhost:3000/campaigns/${aCampaign!.id}`);

    // RLS filter returns no row for B → page's fetch hits the "Campaign not
    // found" branch. Skeleton → error message; loading state clears.
    await expect(pageB.getByText(/campaign not found/i)).toBeVisible({
      timeout: 10_000,
    });

    await ctxB.close();
  });

  test("signing out clears session and redirects to /login", async ({
    browser,
  }) => {
    const user = await createTestUser();
    const ctx = await browser.newContext();
    await ctx.addCookies(authCookiesFor(user));
    const page = await ctx.newPage();
    await page.goto("http://localhost:3000/");
    expect(page.url()).toBe("http://localhost:3000/");

    // Clear the Supabase auth cookies to simulate sign-out.
    await ctx.clearCookies();
    await page.goto("http://localhost:3000/");
    await page.waitForURL(/\/login$/);
    expect(page.url()).toMatch(/\/login$/);

    await ctx.close();
  });
});
