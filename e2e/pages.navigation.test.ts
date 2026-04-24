import { test, expect } from "@playwright/test";
import {
  createTestCampaign,
  createTestOrganization,
  createTestPerson,
  linkOrgToCampaign,
  linkPersonToCampaign,
  cleanupTestData,
  cleanupTestUsers,
  createTestUser,
  setDefaultTestOwner,
  authCookiesFor,
  TEST_PREFIX,
  type TestUser,
} from "./helpers";

let testUser: TestUser;

test.beforeAll(async () => {
  testUser = await createTestUser();
  setDefaultTestOwner(testUser.id);
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(authCookiesFor(testUser));
});

test.afterAll(async () => {
  await cleanupTestData();
  await cleanupTestUsers();
  setDefaultTestOwner(null);
});

// ---------------------------------------------------------------------------
// Home page (Dashboard)
// ---------------------------------------------------------------------------

test.describe("Home page", () => {
  test("loads and renders dashboard content", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\//);

    // Wait for dashboard to load (either the heading or the loading state completes)
    await expect(page.locator("text=Overview").first()).toBeVisible({
      timeout: 15000,
    });

    // Stat cards should render after dashboard data loads
    await expect(page.locator("text=Total Leads").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=Campaigns").first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Chat page
// ---------------------------------------------------------------------------

test.describe("Chat page", () => {
  test("loads with message input and heading", async ({ page }) => {
    await page.goto("/chat");
    const input = page.locator("textarea, input[type='text']").first();
    await expect(input).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=How can I help").first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

test.describe("Settings page", () => {
  test("loads and shows all settings sections", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("h1", { hasText: "Settings" })).toBeVisible({
      timeout: 10000,
    });

    await expect(page.locator("text=Campaigns").first()).toBeVisible();
    await expect(page.locator("text=Cost Center").first()).toBeVisible();
    await expect(page.locator("text=Danger Zone").first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Profile page
// ---------------------------------------------------------------------------

test.describe("Profile page", () => {
  test("loads and shows profile form", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.locator("text=Profiles").first()).toBeVisible({
      timeout: 10000,
    });

    // Form sections should render
    await expect(page.locator("text=Personal Info").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator("text=Company").first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Signals page
// ---------------------------------------------------------------------------

test.describe("Signals page", () => {
  test("loads and shows signal cards with category filters", async ({
    page,
  }) => {
    await page.goto("/signals");
    await expect(page.locator("text=Hiring Activity")).toBeVisible({
      timeout: 10000,
    });

    const body = await page.textContent("body");
    expect(body).toContain("Signals");
    expect(body).toContain("Hiring Activity");
    expect(body).toContain("Funding & News");
    expect(body).toContain("Executive Changes");

    // Category filter buttons should be present
    await expect(
      page.locator("button", { hasText: "All" }).first(),
    ).toBeVisible();
    await expect(
      page.locator("button", { hasText: "Hiring" }).first(),
    ).toBeVisible();
    await expect(
      page.locator("button", { hasText: "Funding" }).first(),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Campaign detail page
// ---------------------------------------------------------------------------

test.describe("Campaign detail page", () => {
  let campaignId: string;

  test.beforeAll(async () => {
    campaignId = await createTestCampaign(`${TEST_PREFIX} Page Test Campaign`);

    // Add some data so the page has content to render
    const orgId = await createTestOrganization({
      name: `${TEST_PREFIX} Page Org`,
      domain: `page-test-${Date.now()}.test`,
      industry: "Testing",
    });
    await linkOrgToCampaign(orgId, campaignId);

    const personId = await createTestPerson(orgId, {
      name: `${TEST_PREFIX} Page Person`,
      title: "QA Lead",
    });
    await linkPersonToCampaign(personId, campaignId);
  });

  test("loads campaign detail page", async ({ page }) => {
    await page.goto(`/campaigns/${campaignId}`);
    // Wait for loading to finish
    await page.waitForSelector("text=Companies", { timeout: 10000 });
  });

  test("displays campaign name in header", async ({ page }) => {
    await page.goto(`/campaigns/${campaignId}`);
    await page.waitForSelector("text=Companies", { timeout: 10000 });
    const text = await page.textContent("body");
    expect(text).toContain("Page Test Campaign");
  });

  test("displays companies section", async ({ page }) => {
    await page.goto(`/campaigns/${campaignId}`);
    await page.waitForSelector("text=Companies", { timeout: 10000 });
    const text = await page.textContent("body");
    expect(text).toContain("Page Org");
  });

  test("displays stats section", async ({ page }) => {
    await page.goto(`/campaigns/${campaignId}`);
    await page.waitForSelector("text=Companies", { timeout: 10000 });
    const text = await page.textContent("body");
    // Stats should show at least 1 company and 1 lead
    expect(text).toContain("Leads");
  });

  test("shows 404-like message for invalid campaign", async ({ page }) => {
    await page.goto("/campaigns/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText(/not found/i).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("company row is expandable", async ({ page }) => {
    await page.goto(`/campaigns/${campaignId}`);
    await page.waitForSelector("text=Page Org", { timeout: 10000 });

    await page
      .getByRole("button", { name: /Expand .*Page Org/ })
      .first()
      .click();

    // After click, the button's aria-label flips to "Collapse ..."
    await expect(
      page.getByRole("button", { name: /Collapse .*Page Org/ }).first(),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Navigation between pages
// ---------------------------------------------------------------------------

test.describe("Navigation", () => {
  test("sidebar chat link works", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('a[href="/chat"]', { timeout: 10000 });

    const chatLink = page.locator('a[href="/chat"]').first();
    await chatLink.click();
    await expect(page).toHaveURL(/\/chat/);
  });

  test("sidebar settings link works", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('a[href="/settings"]', { timeout: 10000 });

    const settingsLink = page.locator('a[href="/settings"]').first();
    await settingsLink.click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test("sidebar signals link works", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('a[href="/signals"]', { timeout: 10000 });

    const signalsLink = page.locator('a[href="/signals"]').first();
    await signalsLink.click();
    await expect(page).toHaveURL(/\/signals/);
  });

  test("sidebar profile link works", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('a[href="/profile"]', { timeout: 10000 });

    const profileLink = page.locator('a[href="/profile"]').first();
    await profileLink.click();
    await expect(page).toHaveURL(/\/profile/);
  });
});
