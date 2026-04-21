import { test, expect } from "@playwright/test";
import {
  supabase,
  TEST_PREFIX,
  createTestCampaign,
  createTestOrganization,
  createTestPerson,
  createTestChat,
  linkOrgToCampaign,
  linkPersonToCampaign,
  cleanupTestData,
  cleanupTestUsers,
  createTestUser,
  authedFetch,
  setDefaultTestOwner,
  type TestUser,
} from "./helpers";

let testUser: TestUser;

function post(path: string, body: unknown) {
  return authedFetch(path, testUser, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function get(path: string) {
  return authedFetch(path, testUser);
}

// ---------------------------------------------------------------------------
// Setup + cleanup
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  testUser = await createTestUser();
  setDefaultTestOwner(testUser.id);
});

test.afterAll(async () => {
  await cleanupTestData();
  await cleanupTestUsers();
  setDefaultTestOwner(null);
});

// ---------------------------------------------------------------------------
// GET /api/dashboard
// ---------------------------------------------------------------------------

test.describe("GET /api/dashboard", () => {
  test("returns dashboard data with default range", async () => {
    const res = await get("/api/dashboard");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("totals");
    expect(data).toHaveProperty("timeSeries");
    expect(data).toHaveProperty("campaigns");
    expect(data.totals).toHaveProperty("leads");
    expect(data.totals).toHaveProperty("sent");
    expect(data.totals).toHaveProperty("replied");
  });

  test("accepts 7d range parameter", async () => {
    const res = await get("/api/dashboard?range=7d");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.timeSeries)).toBe(true);
  });

  test("accepts 30d range parameter", async () => {
    const res = await get("/api/dashboard?range=30d");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/import-csv
// ---------------------------------------------------------------------------

test.describe("POST /api/import-csv", () => {
  let campaignId: string;

  test.beforeAll(async () => {
    campaignId = await createTestCampaign(`${TEST_PREFIX} CSV Import Campaign`);
  });

  test("rejects missing campaignId", async () => {
    const res = await post("/api/import-csv", {
      companies: [{ name: "Test Co" }],
    });
    expect(res.status).toBe(400);
  });

  test("rejects empty companies array", async () => {
    const res = await post("/api/import-csv", {
      campaignId,
      companies: [],
    });
    expect(res.status).toBe(400);
  });

  test("imports valid companies", async () => {
    const res = await post("/api/import-csv", {
      campaignId,
      companies: [
        {
          name: `${TEST_PREFIX} Import Co 1`,
          domain: `${TEST_PREFIX.replace(/_/g, "")}-import1-${Date.now()}.test`,
          industry: "SaaS",
        },
        {
          name: `${TEST_PREFIX} Import Co 2`,
          domain: `${TEST_PREFIX.replace(/_/g, "")}-import2-${Date.now()}.test`,
          industry: "Fintech",
        },
      ],
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(2);
    expect(data.skipped).toBe(0);
  });

  test("deduplicates by domain on re-import", async () => {
    const domain = `${TEST_PREFIX.replace(/_/g, "")}-dedup-${Date.now()}.test`;

    // First import
    await post("/api/import-csv", {
      campaignId,
      companies: [{ name: `${TEST_PREFIX} Dedup Co`, domain }],
    });

    // Second import with same domain
    const res = await post("/api/import-csv", {
      campaignId,
      companies: [{ name: `${TEST_PREFIX} Dedup Co Again`, domain }],
    });
    const data = await res.json();
    expect(data.imported).toBe(0);
    expect(data.skipped).toBe(1);
  });

  test("skips companies with empty names", async () => {
    const res = await post("/api/import-csv", {
      campaignId,
      companies: [
        { name: "", domain: "empty.test" },
        { name: "   ", domain: "whitespace.test" },
      ],
    });
    const data = await res.json();
    expect(data.skipped).toBe(2);
  });

  test("rejects invalid campaignId", async () => {
    const res = await post("/api/import-csv", {
      campaignId: "00000000-0000-0000-0000-000000000000",
      companies: [{ name: "Test" }],
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/enrich-company
// ---------------------------------------------------------------------------

test.describe("POST /api/enrich-company", () => {
  test("rejects missing companyId", async () => {
    const res = await post("/api/enrich-company", {});
    expect(res.status).toBe(400);
  });

  test("rejects invalid companyId", async () => {
    const res = await post("/api/enrich-company", {
      companyId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/enrich
// ---------------------------------------------------------------------------

test.describe("POST /api/enrich", () => {
  test("rejects missing contactId", async () => {
    const res = await post("/api/enrich", {});
    expect(res.status).toBe(400);
  });

  test("rejects invalid contactId", async () => {
    const res = await post("/api/enrich", {
      contactId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/find-contacts
// ---------------------------------------------------------------------------

test.describe("POST /api/find-contacts", () => {
  test("rejects missing companyId", async () => {
    const res = await post("/api/find-contacts", {
      campaignId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(400);
  });

  test("rejects missing campaignId", async () => {
    const res = await post("/api/find-contacts", {
      companyId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/refresh-scores
// ---------------------------------------------------------------------------

test.describe("POST /api/refresh-scores", () => {
  test("rejects missing campaignId", async () => {
    const res = await post("/api/refresh-scores", {});
    expect(res.status).toBe(400);
  });

  test("returns 0 scored when no enriched contacts", async () => {
    const campaignId = await createTestCampaign(
      `${TEST_PREFIX} Empty Score Campaign`,
    );
    const res = await post("/api/refresh-scores", { campaignId });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scored).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Campaign CRUD via Supabase (verifying schema works end-to-end)
// ---------------------------------------------------------------------------

test.describe("Campaign CRUD flow", () => {
  let campaignId: string;

  test("creates a campaign", async () => {
    campaignId = await createTestCampaign(`${TEST_PREFIX} CRUD Campaign`);
    expect(campaignId).toBeTruthy();

    const { data } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();
    expect(data).toBeTruthy();
    expect(data!.name).toContain(TEST_PREFIX);
    expect(data!.status).toBe("discovery");
  });

  test("updates campaign ICP", async () => {
    const newIcp = {
      industry: "SaaS",
      geography: "US",
      targetTitles: ["CTO", "VP Engineering"],
    };
    const { error } = await supabase
      .from("campaigns")
      .update({ icp: newIcp, status: "researching" })
      .eq("id", campaignId);
    expect(error).toBeNull();

    const { data } = await supabase
      .from("campaigns")
      .select("icp, status")
      .eq("id", campaignId)
      .single();
    expect(data!.status).toBe("researching");
    expect((data!.icp as Record<string, unknown>).industry).toBe("SaaS");
  });

  test("adds organizations to campaign", async () => {
    const orgId = await createTestOrganization({
      name: `${TEST_PREFIX} CRUD Org`,
      domain: `crud-${Date.now()}.test`,
    });
    const linkId = await linkOrgToCampaign(orgId, campaignId);
    expect(linkId).toBeTruthy();

    // Verify the link
    const { data } = await supabase
      .from("campaign_organizations")
      .select("*, organization:organizations(name)")
      .eq("id", linkId)
      .single();
    expect(data).toBeTruthy();
    expect((data!.organization as unknown as { name: string }).name).toContain(
      "CRUD Org",
    );
  });

  test("adds people to campaign", async () => {
    const orgId = await createTestOrganization();
    const personId = await createTestPerson(orgId, {
      name: `${TEST_PREFIX} CRUD Person`,
    });
    const linkId = await linkPersonToCampaign(personId, campaignId);
    expect(linkId).toBeTruthy();

    // Verify the link
    const { data } = await supabase
      .from("campaign_people")
      .select("*, person:people(name)")
      .eq("id", linkId)
      .single();
    expect(data).toBeTruthy();
    expect((data!.person as unknown as { name: string }).name).toContain(
      "CRUD Person",
    );
  });

  test("deleting campaign cascades to junction tables", async () => {
    const tempCampaignId = await createTestCampaign(
      `${TEST_PREFIX} Cascade Test`,
    );
    const orgId = await createTestOrganization();
    const personId = await createTestPerson(orgId);
    await linkOrgToCampaign(orgId, tempCampaignId);
    await linkPersonToCampaign(personId, tempCampaignId);

    // Delete campaign
    await supabase.from("campaigns").delete().eq("id", tempCampaignId);

    // Junction rows should be gone
    const { data: orgLinks } = await supabase
      .from("campaign_organizations")
      .select("id")
      .eq("campaign_id", tempCampaignId);
    expect(orgLinks).toHaveLength(0);

    const { data: peopleLinks } = await supabase
      .from("campaign_people")
      .select("id")
      .eq("campaign_id", tempCampaignId);
    expect(peopleLinks).toHaveLength(0);

    // Shared data should survive
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", orgId)
      .single();
    expect(org).toBeTruthy();

    const { data: person } = await supabase
      .from("people")
      .select("id")
      .eq("id", personId)
      .single();
    expect(person).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat/summarize
// ---------------------------------------------------------------------------

test.describe("POST /api/chat/summarize", () => {
  test("rejects missing chatId", async () => {
    const res = await post("/api/chat/summarize", {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("chatId");
  });

  test("returns 404 for non-existent chat", async () => {
    const res = await post("/api/chat/summarize", {
      chatId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(404);
  });

  test("returns title for existing chat with no messages", async () => {
    const chatId = await createTestChat({
      title: `${TEST_PREFIX} Empty Chat`,
      messages: [],
    });

    const res = await post("/api/chat/summarize", { chatId });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Defense-in-depth ownership checks
//
// RLS already blocks cross-user access at the database layer, so a user
// client selecting another user's row typically sees "no row" and the route
// returns 404. Each route *also* performs an explicit `row.user_id !==
// user.id` check so the expensive work (Claude/Exa/Browserbase) never starts
// if RLS ever regresses. These tests assert that cross-user access is
// blocked -- either via the RLS layer (404) or via the explicit check (403).
// Both are acceptable; what matters is that the expensive work never runs.
// ---------------------------------------------------------------------------

test.describe("Cross-user access is blocked", () => {
  let otherUser: TestUser;
  let otherCampaignId: string;
  let otherOrgLinkId: string;
  let otherPersonLinkId: string;
  let otherChatId: string;

  test.beforeAll(async () => {
    otherUser = await createTestUser();
    otherCampaignId = await createTestCampaign(
      `${TEST_PREFIX} Other User Campaign`,
      otherUser.id,
    );
    const orgId = await createTestOrganization({
      name: `${TEST_PREFIX} Other Org`,
      domain: `other-${Date.now()}.test`,
    });
    otherOrgLinkId = await linkOrgToCampaign(orgId, otherCampaignId);

    const personId = await createTestPerson(orgId, {
      name: `${TEST_PREFIX} Other Person`,
    });
    otherPersonLinkId = await linkPersonToCampaign(personId, otherCampaignId);

    // Chat owned by the other user.
    const { data, error } = await supabase
      .from("chats")
      .insert({
        title: `${TEST_PREFIX} Other User Chat`,
        user_id: otherUser.id,
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        ],
      })
      .select("id")
      .single();
    if (error)
      throw new Error(`Failed to create other-user chat: ${error.message}`);
    otherChatId = data.id;
  });

  test("refresh-scores blocks other user's campaign", async () => {
    const res = await post("/api/refresh-scores", {
      campaignId: otherCampaignId,
    });
    expect([403, 404]).toContain(res.status);
  });

  test("find-contacts blocks other user's campaign", async () => {
    const res = await post("/api/find-contacts", {
      campaignId: otherCampaignId,
      companyId: otherOrgLinkId,
    });
    expect([403, 404]).toContain(res.status);
  });

  test("import-csv blocks other user's campaign", async () => {
    const res = await post("/api/import-csv", {
      campaignId: otherCampaignId,
      companies: [{ name: "Should not be imported" }],
    });
    expect([403, 404]).toContain(res.status);
  });

  test("enrich-company blocks when campaignId belongs to other user", async () => {
    const res = await post("/api/enrich-company", {
      companyId: otherOrgLinkId,
      campaignId: otherCampaignId,
    });
    expect([403, 404]).toContain(res.status);
  });

  test("enrich-company blocks when link belongs to other user", async () => {
    const res = await post("/api/enrich-company", {
      companyId: otherOrgLinkId,
    });
    expect([403, 404]).toContain(res.status);
  });

  test("enrich blocks other user's campaign_people link", async () => {
    const res = await post("/api/enrich", {
      contactId: otherPersonLinkId,
    });
    expect([403, 404]).toContain(res.status);
  });

  test("chat/summarize blocks other user's chat", async () => {
    const res = await post("/api/chat/summarize", {
      chatId: otherChatId,
    });
    expect([403, 404]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// GET /api/settings/costs
// ---------------------------------------------------------------------------

test.describe("GET /api/settings/costs", () => {
  test("returns cost data with expected structure", async () => {
    const res = await get("/api/settings/costs");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("totalCost");
    expect(data).toHaveProperty("byService");
    expect(data).toHaveProperty("byOperation");
    expect(data).toHaveProperty("daily");
    expect(data).toHaveProperty("recent");
    expect(data).toHaveProperty("recentPagination");
    expect(typeof data.totalCost).toBe("number");
    expect(Array.isArray(data.byService)).toBe(true);
    expect(Array.isArray(data.recent)).toBe(true);
  });

  test("accepts period parameter", async () => {
    const res = await get("/api/settings/costs?period=7d");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("totalCost");
    expect(data.period).toBe("7d");
  });

  test("accepts pagination parameters", async () => {
    const res = await get("/api/settings/costs?page=1&pageSize=5");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recentPagination.page).toBe(1);
    expect(data.recentPagination.pageSize).toBe(5);
  });
});
