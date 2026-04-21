import { test, expect } from "@playwright/test";
import {
  authCookiesFor,
  cleanupTestData,
  cleanupTestUsers,
  createTestCampaign,
  createTestSequence,
  createTestUser,
  setDefaultTestOwner,
  type TestUser,
} from "./helpers";

let testUser: TestUser;

test.beforeAll(async () => {
  testUser = await createTestUser();
  setDefaultTestOwner(testUser.id);

  // Seed a campaign + sequence so the outreach page renders the tabbed view
  // instead of the "no sequences yet" empty state.
  const campaignId = await createTestCampaign();
  await createTestSequence(campaignId);
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
// Outreach page (redesigned tabbed view)
// ---------------------------------------------------------------------------

test.describe("Outreach page", () => {
  test("renders heading, hero, and switches between tabs", async ({ page }) => {
    await page.goto("/outreach");

    await expect(page.locator("h1", { hasText: "Outreach" })).toBeVisible({
      timeout: 15000,
    });

    // Hero block: either populated ("ready to send" count) or empty ("All clear")
    await expect(
      page.locator("text=/ready to send|All clear/i").first(),
    ).toBeVisible({ timeout: 15000 });

    // All three tab triggers should be present
    await expect(page.getByRole("tab", { name: /Inbox/ })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("tab", { name: "Pipeline" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sequences" })).toBeVisible();

    // Switch to Pipeline — kanban content (column header or empty-state) appears
    await page.getByRole("tab", { name: "Pipeline" }).click();
    await expect(
      page.locator("text=/Sent|No active enrollments/").first(),
    ).toBeVisible({ timeout: 10000 });

    // Switch to Sequences — sequence table or empty-state appears
    await page.getByRole("tab", { name: "Sequences" }).click();
    await expect(
      page.locator("text=/Sequence|No outreach sequences yet/").first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
