import { test, expect } from "@playwright/test";
import {
  supabase,
  TEST_PREFIX,
  authCookiesFor,
  createTestCampaign,
  cleanupTestData,
  cleanupTestUsers,
  createTestUser,
  setDefaultTestOwner,
  authedFetch,
  type TestUser,
} from "./helpers";

const BASE = "http://localhost:3000";

let testUser: TestUser;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a custom test signal and return its ID. */
async function createTestSignal(
  overrides?: Partial<{ name: string; slug: string; category: string }>,
): Promise<string> {
  const slug =
    overrides?.slug || `${TEST_PREFIX.replace(/_/g, "")}-signal-${Date.now()}`;
  const { data, error } = await supabase
    .from("signals")
    .insert({
      name: overrides?.name || `${TEST_PREFIX} Signal ${Date.now()}`,
      slug,
      description: "E2E test signal",
      category: overrides?.category || "custom",
      execution_type: "agent_instructions",
      config: { instructions: "Test instructions" },
      is_builtin: false,
      is_public: false,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create test signal: ${error.message}`);
  return data.id;
}

/** Cleanup: remove test signals and their join/result rows. */
async function cleanupSignalData(): Promise<void> {
  // Delete test signals (cascades to campaign_signals and signal_results)
  await supabase.from("signals").delete().like("name", `${TEST_PREFIX}%`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  testUser = await createTestUser();
  setDefaultTestOwner(testUser.id);
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(authCookiesFor(testUser));
});

test.afterAll(async () => {
  await cleanupSignalData();
  await cleanupTestData();
  await cleanupTestUsers();
  setDefaultTestOwner(null);
});

// ---------------------------------------------------------------------------
// Built-in signals (seeded)
// ---------------------------------------------------------------------------

test.describe("Built-in signals", () => {
  test("core built-in signals exist after migration", async () => {
    const { data, error } = await supabase
      .from("signals")
      .select("slug")
      .eq("is_builtin", true);

    expect(error).toBeNull();
    const slugs = new Set((data ?? []).map((s) => s.slug));

    // Lock the core set migrations must always seed; tolerant of additions
    // (tracking-driven signals like pricing-changes seed dynamically).
    const required = [
      "executive-changes",
      "funding-news",
      "hiring-activity",
      "product-launches",
      "social-engagement",
      "website-tech-stack",
    ];
    for (const slug of required) {
      expect(slugs.has(slug)).toBe(true);
    }
  });

  test("each built-in signal has correct category", async () => {
    const { data } = await supabase
      .from("signals")
      .select("slug, category")
      .eq("is_builtin", true);

    const bySlug = Object.fromEntries(data!.map((s) => [s.slug, s.category]));
    expect(bySlug["hiring-activity"]).toBe("hiring");
    expect(bySlug["funding-news"]).toBe("funding");
    expect(bySlug["executive-changes"]).toBe("executive");
    expect(bySlug["product-launches"]).toBe("product");
    expect(bySlug["social-engagement"]).toBe("engagement");
    expect(bySlug["website-tech-stack"]).toBe("product");
  });

  test("built-in signals have execution_type and config", async () => {
    const { data } = await supabase
      .from("signals")
      .select("slug, execution_type, config, tool_key")
      .eq("is_builtin", true);

    for (const signal of data!) {
      expect(signal.execution_type).toBeTruthy();
      expect(signal.config).toBeTruthy();

      // tool_call types must have a tool_key
      if (signal.execution_type === "tool_call") {
        expect(signal.tool_key).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Custom signal CRUD
// ---------------------------------------------------------------------------

test.describe("Custom signal CRUD", () => {
  let signalId: string;

  test("creates a custom signal", async () => {
    signalId = await createTestSignal({
      name: `${TEST_PREFIX} CRUD Signal`,
      slug: `${TEST_PREFIX.replace(/_/g, "")}-crud-${Date.now()}`,
    });
    expect(signalId).toBeTruthy();

    const { data } = await supabase
      .from("signals")
      .select("*")
      .eq("id", signalId)
      .single();
    expect(data).toBeTruthy();
    expect(data!.is_builtin).toBe(false);
    expect(data!.is_public).toBe(false);
    expect(data!.category).toBe("custom");
  });

  test("slug uniqueness is enforced", async () => {
    const slug = `${TEST_PREFIX.replace(/_/g, "")}-unique-slug-${Date.now()}`;
    await createTestSignal({ slug });

    const { error } = await supabase.from("signals").insert({
      name: `${TEST_PREFIX} Dup Slug`,
      slug,
      description: "Duplicate",
      execution_type: "agent_instructions",
    });
    expect(error).toBeTruthy();
    expect(error!.code).toBe("23505");
  });

  test("category check constraint is enforced", async () => {
    const { error } = await supabase.from("signals").insert({
      name: `${TEST_PREFIX} Bad Category`,
      slug: `bad-cat-${Date.now()}`,
      description: "Bad category",
      category: "nonexistent",
      execution_type: "agent_instructions",
    });
    expect(error).toBeTruthy();
  });

  test("execution_type check constraint is enforced", async () => {
    const { error } = await supabase.from("signals").insert({
      name: `${TEST_PREFIX} Bad Exec`,
      slug: `bad-exec-${Date.now()}`,
      description: "Bad exec type",
      execution_type: "invalid_type",
    });
    expect(error).toBeTruthy();
  });

  test("can make a custom signal public", async () => {
    const id = await createTestSignal();

    await supabase.from("signals").update({ is_public: true }).eq("id", id);

    const { data } = await supabase
      .from("signals")
      .select("is_public")
      .eq("id", id)
      .single();
    expect(data!.is_public).toBe(true);
  });

  test("can unpublish a custom signal", async () => {
    const id = await createTestSignal();
    await supabase.from("signals").update({ is_public: true }).eq("id", id);
    await supabase.from("signals").update({ is_public: false }).eq("id", id);

    const { data } = await supabase
      .from("signals")
      .select("is_public")
      .eq("id", id)
      .single();
    expect(data!.is_public).toBe(false);
  });

  test("updated_at trigger fires on signal update", async () => {
    const id = await createTestSignal();

    const { data: before } = await supabase
      .from("signals")
      .select("updated_at")
      .eq("id", id)
      .single();

    await new Promise((r) => setTimeout(r, 100));

    await supabase
      .from("signals")
      .update({ description: "Updated description" })
      .eq("id", id);

    const { data: after } = await supabase
      .from("signals")
      .select("updated_at")
      .eq("id", id)
      .single();

    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(
      new Date(before!.updated_at).getTime(),
    );
  });
});

// ---------------------------------------------------------------------------
// Campaign-signal linking
// ---------------------------------------------------------------------------

test.describe("Campaign-signal linking", () => {
  let campaignId: string;
  let signalId: string;

  test.beforeAll(async () => {
    campaignId = await createTestCampaign(
      `${TEST_PREFIX} Signal Link Campaign`,
    );
    signalId = await createTestSignal({
      name: `${TEST_PREFIX} Link Signal`,
    });
  });

  test("enables a signal for a campaign", async () => {
    const { data, error } = await supabase
      .from("campaign_signals")
      .insert({
        campaign_id: campaignId,
        signal_id: signalId,
        enabled: true,
      })
      .select("*")
      .single();

    expect(error).toBeNull();
    expect(data!.enabled).toBe(true);
  });

  test("prevents duplicate campaign-signal links", async () => {
    const { error } = await supabase.from("campaign_signals").insert({
      campaign_id: campaignId,
      signal_id: signalId,
      enabled: true,
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe("23505");
  });

  test("can toggle a signal off", async () => {
    await supabase
      .from("campaign_signals")
      .update({ enabled: false })
      .eq("campaign_id", campaignId)
      .eq("signal_id", signalId);

    const { data } = await supabase
      .from("campaign_signals")
      .select("enabled")
      .eq("campaign_id", campaignId)
      .eq("signal_id", signalId)
      .single();

    expect(data!.enabled).toBe(false);
  });

  test("can store config_override per campaign", async () => {
    const override = { maxJobs: 50, customQuery: "test override" };
    await supabase
      .from("campaign_signals")
      .update({ config_override: override })
      .eq("campaign_id", campaignId)
      .eq("signal_id", signalId);

    const { data } = await supabase
      .from("campaign_signals")
      .select("config_override")
      .eq("campaign_id", campaignId)
      .eq("signal_id", signalId)
      .single();

    expect(data!.config_override).toEqual(override);
  });

  test("same signal can be linked to multiple campaigns", async () => {
    const c2 = await createTestCampaign(`${TEST_PREFIX} Signal Link C2`);
    const { error } = await supabase.from("campaign_signals").insert({
      campaign_id: c2,
      signal_id: signalId,
      enabled: true,
    });
    expect(error).toBeNull();

    const { data } = await supabase
      .from("campaign_signals")
      .select("campaign_id")
      .eq("signal_id", signalId);
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });

  test("deleting campaign cascades to campaign_signals", async () => {
    const tempCampaign = await createTestCampaign(
      `${TEST_PREFIX} Signal Cascade Campaign`,
    );
    const tempSignal = await createTestSignal({
      name: `${TEST_PREFIX} Cascade Signal`,
    });

    await supabase.from("campaign_signals").insert({
      campaign_id: tempCampaign,
      signal_id: tempSignal,
      enabled: true,
    });

    // Delete campaign
    await supabase.from("campaigns").delete().eq("id", tempCampaign);

    // campaign_signals row should be gone
    const { data } = await supabase
      .from("campaign_signals")
      .select("id")
      .eq("campaign_id", tempCampaign);
    expect(data).toHaveLength(0);

    // Signal itself should survive
    const { data: signal } = await supabase
      .from("signals")
      .select("id")
      .eq("id", tempSignal)
      .single();
    expect(signal).toBeTruthy();
  });

  test("deleting signal cascades to campaign_signals", async () => {
    const tempSignal = await createTestSignal({
      name: `${TEST_PREFIX} Del Signal`,
    });

    await supabase.from("campaign_signals").insert({
      campaign_id: campaignId,
      signal_id: tempSignal,
      enabled: true,
    });

    // Delete signal
    await supabase.from("signals").delete().eq("id", tempSignal);

    // campaign_signals row should be gone
    const { data } = await supabase
      .from("campaign_signals")
      .select("id")
      .eq("signal_id", tempSignal);
    expect(data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Signal results
// ---------------------------------------------------------------------------

test.describe("Signal results", () => {
  let campaignId: string;
  let signalId: string;

  test.beforeAll(async () => {
    campaignId = await createTestCampaign(
      `${TEST_PREFIX} Signal Results Campaign`,
    );
    signalId = await createTestSignal({
      name: `${TEST_PREFIX} Results Signal`,
    });
  });

  test("stores a signal result", async () => {
    const output = { found: true, jobs: ["Engineer", "Designer"] };
    const { data, error } = await supabase
      .from("signal_results")
      .insert({
        signal_id: signalId,
        campaign_id: campaignId,
        output,
        status: "success",
      })
      .select("*")
      .single();

    expect(error).toBeNull();
    expect(data!.output).toEqual(output);
    expect(data!.status).toBe("success");
    expect(data!.ran_at).toBeTruthy();
  });

  test("status check constraint is enforced", async () => {
    const { error } = await supabase.from("signal_results").insert({
      signal_id: signalId,
      campaign_id: campaignId,
      output: {},
      status: "invalid_status",
    });
    expect(error).toBeTruthy();
  });

  test("supports partial status", async () => {
    const { data, error } = await supabase
      .from("signal_results")
      .insert({
        signal_id: signalId,
        campaign_id: campaignId,
        output: { partial: true, errors: ["timeout"] },
        status: "partial",
      })
      .select("status")
      .single();

    expect(error).toBeNull();
    expect(data!.status).toBe("partial");
  });

  test("supports failed status", async () => {
    const { data, error } = await supabase
      .from("signal_results")
      .insert({
        signal_id: signalId,
        campaign_id: campaignId,
        output: { error: "API timeout" },
        status: "failed",
      })
      .select("status")
      .single();

    expect(error).toBeNull();
    expect(data!.status).toBe("failed");
  });

  test("multiple results per signal+campaign (append-only)", async () => {
    // Insert 3 results
    for (let i = 0; i < 3; i++) {
      await supabase.from("signal_results").insert({
        signal_id: signalId,
        campaign_id: campaignId,
        output: { run: i },
        status: "success",
      });
    }

    const { data } = await supabase
      .from("signal_results")
      .select("id")
      .eq("signal_id", signalId)
      .eq("campaign_id", campaignId);

    // At least 3 (plus any from earlier tests)
    expect(data!.length).toBeGreaterThanOrEqual(3);
  });

  test("deleting signal cascades to signal_results", async () => {
    const tempSignal = await createTestSignal({
      name: `${TEST_PREFIX} Results Cascade`,
    });

    await supabase.from("signal_results").insert({
      signal_id: tempSignal,
      campaign_id: campaignId,
      output: { test: true },
      status: "success",
    });

    await supabase.from("signals").delete().eq("id", tempSignal);

    const { data } = await supabase
      .from("signal_results")
      .select("id")
      .eq("signal_id", tempSignal);
    expect(data).toHaveLength(0);
  });

  test("deleting campaign cascades to signal_results", async () => {
    const tempCampaign = await createTestCampaign(
      `${TEST_PREFIX} Results Campaign Cascade`,
    );

    await supabase.from("signal_results").insert({
      signal_id: signalId,
      campaign_id: tempCampaign,
      output: { test: true },
      status: "success",
    });

    await supabase.from("campaigns").delete().eq("id", tempCampaign);

    const { data } = await supabase
      .from("signal_results")
      .select("id")
      .eq("campaign_id", tempCampaign);
    expect(data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Signals page (browser)
// ---------------------------------------------------------------------------

test.describe("Signals page", () => {
  test("loads and displays built-in signals", async ({ page }) => {
    await page.goto("/signals");
    await page.waitForSelector("text=Hiring Activity", { timeout: 10000 });

    const text = await page.textContent("body");
    expect(text).toContain("Hiring Activity");
    expect(text).toContain("Funding & News");
    expect(text).toContain("Executive Changes");
  });

  test("category filter works", async ({ page }) => {
    await page.goto("/signals");
    await page.waitForSelector("text=Hiring Activity", { timeout: 10000 });

    // Click hiring category filter
    const hiringButton = page.locator("button", { hasText: "Hiring" }).first();
    if (await hiringButton.isVisible()) {
      await hiringButton.click();
      await expect(page.getByText("Hiring Activity").first()).toBeVisible();
    }
  });

  test("signal card shows built-in badge", async ({ page }) => {
    await page.goto("/signals");
    await page.waitForSelector("text=Hiring Activity", { timeout: 10000 });
    const text = await page.textContent("body");
    expect(text).toContain("Built-in");
  });
});
