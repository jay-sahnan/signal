import { test, expect } from "@playwright/test";
import {
  supabase,
  TEST_PREFIX,
  createTestCampaign,
  createTestOrganization,
  createTestPerson,
  linkOrgToCampaign,
  linkPersonToCampaign,
  cleanupTestData,
  cleanupTestUsers,
  createTestUser,
  setDefaultTestOwner,
  authedFetch,
  type TestUser,
} from "./helpers";

let testUser: TestUser;

function post(path: string, body: unknown) {
  return authedFetch(path, testUser, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

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
// Organization deduplication
// ---------------------------------------------------------------------------

test.describe("Organization dedup", () => {
  test("same domain yields one organization row", async () => {
    const domain = `${TEST_PREFIX.replace(/_/g, "")}-dedup-org-${Date.now()}.test`;

    // Create two campaigns
    const campaign1 = await createTestCampaign(`${TEST_PREFIX} Dedup Org C1`);
    const campaign2 = await createTestCampaign(`${TEST_PREFIX} Dedup Org C2`);

    // Import same domain into both campaigns
    await post("/api/import-csv", {
      campaignId: campaign1,
      companies: [{ name: `${TEST_PREFIX} Dedup Corp`, domain }],
    });
    await post("/api/import-csv", {
      campaignId: campaign2,
      companies: [{ name: `${TEST_PREFIX} Dedup Corp V2`, domain }],
    });

    // Should be exactly ONE organization with this domain
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id")
      .eq("domain", domain);
    expect(orgs).toHaveLength(1);

    // But TWO campaign_organizations links (one per campaign)
    const orgId = orgs![0].id;
    const { data: links } = await supabase
      .from("campaign_organizations")
      .select("campaign_id")
      .eq("organization_id", orgId);
    expect(links).toHaveLength(2);

    const linkedCampaignIds = links!.map((l) => l.campaign_id);
    expect(linkedCampaignIds).toContain(campaign1);
    expect(linkedCampaignIds).toContain(campaign2);
  });

  test("organizations without domains are not deduped by domain", async () => {
    const campaign = await createTestCampaign(
      `${TEST_PREFIX} No Domain Campaign`,
    );

    await post("/api/import-csv", {
      campaignId: campaign,
      companies: [
        { name: `${TEST_PREFIX} NoDomain A` },
        { name: `${TEST_PREFIX} NoDomain B` },
      ],
    });

    // Two distinct organizations should exist
    const { data } = await supabase
      .from("campaign_organizations")
      .select("organization:organizations(name)")
      .eq("campaign_id", campaign);
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// People deduplication
// ---------------------------------------------------------------------------

test.describe("People dedup", () => {
  test("same linkedin_url yields one person row across campaigns", async () => {
    const linkedinUrl = `https://linkedin.com/in/${TEST_PREFIX.replace(/_/g, "")}-dedup-person-${Date.now()}`;

    // Create the person
    const { data: person } = await supabase
      .from("people")
      .insert({
        name: `${TEST_PREFIX} Dedup Person`,
        linkedin_url: linkedinUrl,
        source: "e2e_test",
      })
      .select("id")
      .single();

    const personId = person!.id;

    // Link to two campaigns
    const c1 = await createTestCampaign(`${TEST_PREFIX} Person Dedup C1`);
    const c2 = await createTestCampaign(`${TEST_PREFIX} Person Dedup C2`);
    await linkPersonToCampaign(personId, c1);
    await linkPersonToCampaign(personId, c2);

    // Verify: one person, two links
    const { data: people } = await supabase
      .from("people")
      .select("id")
      .eq("linkedin_url", linkedinUrl);
    expect(people).toHaveLength(1);

    const { data: links } = await supabase
      .from("campaign_people")
      .select("campaign_id")
      .eq("person_id", personId);
    expect(links).toHaveLength(2);
  });

  test("duplicate campaign_people link is prevented by unique constraint", async () => {
    const campaign = await createTestCampaign(
      `${TEST_PREFIX} Dup Link Campaign`,
    );
    const personId = await createTestPerson();

    await linkPersonToCampaign(personId, campaign);

    // Second link should fail or be ignored (upsert behavior depends on the caller)
    const { error } = await supabase
      .from("campaign_people")
      .insert({ campaign_id: campaign, person_id: personId });

    // Unique constraint violation
    expect(error).toBeTruthy();
    expect(error!.code).toBe("23505");
  });
});

// ---------------------------------------------------------------------------
// Cross-campaign score independence
// ---------------------------------------------------------------------------

test.describe("Campaign-specific scores", () => {
  test("same person can have different scores in different campaigns", async () => {
    const orgId = await createTestOrganization();
    const personId = await createTestPerson(orgId, {
      name: `${TEST_PREFIX} Score Person`,
    });

    const c1 = await createTestCampaign(`${TEST_PREFIX} Score C1`);
    const c2 = await createTestCampaign(`${TEST_PREFIX} Score C2`);

    const link1 = await linkPersonToCampaign(personId, c1);
    const link2 = await linkPersonToCampaign(personId, c2);

    // Set different scores per campaign
    await supabase
      .from("campaign_people")
      .update({ priority_score: 9, score_reason: "High priority in C1" })
      .eq("id", link1);
    await supabase
      .from("campaign_people")
      .update({ priority_score: 3, score_reason: "Low priority in C2" })
      .eq("id", link2);

    // Verify independent scores
    const { data: l1 } = await supabase
      .from("campaign_people")
      .select("priority_score, score_reason")
      .eq("id", link1)
      .single();
    expect(l1!.priority_score).toBe(9);

    const { data: l2 } = await supabase
      .from("campaign_people")
      .select("priority_score, score_reason")
      .eq("id", link2)
      .single();
    expect(l2!.priority_score).toBe(3);
  });

  test("same org can have different statuses in different campaigns", async () => {
    const orgId = await createTestOrganization({
      domain: `status-test-${Date.now()}.test`,
    });

    const c1 = await createTestCampaign(`${TEST_PREFIX} Status C1`);
    const c2 = await createTestCampaign(`${TEST_PREFIX} Status C2`);

    const link1 = await linkOrgToCampaign(orgId, c1);
    const link2 = await linkOrgToCampaign(orgId, c2);

    await supabase
      .from("campaign_organizations")
      .update({ status: "qualified" })
      .eq("id", link1);
    await supabase
      .from("campaign_organizations")
      .update({ status: "disqualified" })
      .eq("id", link2);

    const { data: l1 } = await supabase
      .from("campaign_organizations")
      .select("status")
      .eq("id", link1)
      .single();
    expect(l1!.status).toBe("qualified");

    const { data: l2 } = await supabase
      .from("campaign_organizations")
      .select("status")
      .eq("id", link2)
      .single();
    expect(l2!.status).toBe("disqualified");
  });
});

// ---------------------------------------------------------------------------
// Enrichment data sharing and recency
// ---------------------------------------------------------------------------

test.describe("Enrichment data", () => {
  test("enrichment_data is shared across campaigns", async () => {
    const orgId = await createTestOrganization({
      domain: `enrich-share-${Date.now()}.test`,
    });

    // Simulate enrichment by writing directly
    const enrichmentData = {
      enrichedAt: new Date().toISOString(),
      website: {
        title: "Test Site",
        description: "Test",
        content: "Test content",
      },
    };
    await supabase
      .from("organizations")
      .update({
        enrichment_data: enrichmentData,
        enrichment_status: "enriched",
        last_enriched_at: new Date().toISOString(),
      })
      .eq("id", orgId);

    // Link to two campaigns
    const c1 = await createTestCampaign(`${TEST_PREFIX} Enrich Share C1`);
    const c2 = await createTestCampaign(`${TEST_PREFIX} Enrich Share C2`);
    await linkOrgToCampaign(orgId, c1);
    await linkOrgToCampaign(orgId, c2);

    // Both campaigns see the same enrichment data
    const { data: fromC1 } = await supabase
      .from("campaign_organizations")
      .select("organization:organizations(enrichment_data)")
      .eq("campaign_id", c1)
      .eq("organization_id", orgId)
      .single();

    const { data: fromC2 } = await supabase
      .from("campaign_organizations")
      .select("organization:organizations(enrichment_data)")
      .eq("campaign_id", c2)
      .eq("organization_id", orgId)
      .single();

    const ed1 = (
      fromC1!.organization as unknown as {
        enrichment_data: Record<string, unknown>;
      }
    ).enrichment_data;
    const ed2 = (
      fromC2!.organization as unknown as {
        enrichment_data: Record<string, unknown>;
      }
    ).enrichment_data;
    expect(ed1).toEqual(ed2);
    expect(ed1.enrichedAt).toBeTruthy();
  });

  test("enrichment is additive (new keys merge, existing preserved)", async () => {
    const orgId = await createTestOrganization({
      domain: `enrich-merge-${Date.now()}.test`,
    });

    // First enrichment: website data
    await supabase
      .from("organizations")
      .update({
        enrichment_data: {
          website: { title: "Original Title" },
        },
      })
      .eq("id", orgId);

    // Second enrichment: add searches (simulate merge)
    const { data: existing } = await supabase
      .from("organizations")
      .select("enrichment_data")
      .eq("id", orgId)
      .single();

    const merged = {
      ...(existing!.enrichment_data as Record<string, unknown>),
      searches: [{ category: "product", results: [] }],
    };
    await supabase
      .from("organizations")
      .update({ enrichment_data: merged })
      .eq("id", orgId);

    // Verify both website and searches exist
    const { data: final } = await supabase
      .from("organizations")
      .select("enrichment_data")
      .eq("id", orgId)
      .single();

    const ed = final!.enrichment_data as Record<string, unknown>;
    expect(ed.website).toBeTruthy();
    expect(ed.searches).toBeTruthy();
  });

  test("last_enriched_at tracks recency", async () => {
    const orgId = await createTestOrganization();

    // Initially null
    const { data: before } = await supabase
      .from("organizations")
      .select("last_enriched_at, enrichment_status")
      .eq("id", orgId)
      .single();
    expect(before!.last_enriched_at).toBeNull();
    expect(before!.enrichment_status).toBe("pending");

    // After enrichment
    const now = new Date().toISOString();
    await supabase
      .from("organizations")
      .update({
        enrichment_status: "enriched",
        last_enriched_at: now,
      })
      .eq("id", orgId);

    const { data: after } = await supabase
      .from("organizations")
      .select("last_enriched_at, enrichment_status")
      .eq("id", orgId)
      .single();
    expect(after!.enrichment_status).toBe("enriched");
    expect(after!.last_enriched_at).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Unlink vs delete (shared data preservation)
// ---------------------------------------------------------------------------

test.describe("Unlink preserves shared data", () => {
  test("removing org from campaign preserves the organization", async () => {
    const orgId = await createTestOrganization({
      domain: `unlink-test-${Date.now()}.test`,
    });
    const campaign = await createTestCampaign(
      `${TEST_PREFIX} Unlink Org Campaign`,
    );
    const linkId = await linkOrgToCampaign(orgId, campaign);

    // Unlink
    await supabase.from("campaign_organizations").delete().eq("id", linkId);

    // Organization still exists
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", orgId)
      .single();
    expect(org).toBeTruthy();

    // But link is gone
    const { data: link } = await supabase
      .from("campaign_organizations")
      .select("id")
      .eq("id", linkId);
    expect(link).toHaveLength(0);
  });

  test("removing person from campaign preserves the person", async () => {
    const personId = await createTestPerson(undefined, {
      name: `${TEST_PREFIX} Unlink Person`,
    });
    const campaign = await createTestCampaign(
      `${TEST_PREFIX} Unlink Person Campaign`,
    );
    const linkId = await linkPersonToCampaign(personId, campaign);

    // Unlink
    await supabase.from("campaign_people").delete().eq("id", linkId);

    // Person still exists
    const { data: person } = await supabase
      .from("people")
      .select("id")
      .eq("id", personId)
      .single();
    expect(person).toBeTruthy();
  });

  test("deleting organization cascades to campaign_organizations but not campaign_people", async () => {
    const orgId = await createTestOrganization({
      domain: `cascade-org-${Date.now()}.test`,
    });
    const personId = await createTestPerson(orgId);
    const campaign = await createTestCampaign(
      `${TEST_PREFIX} Cascade Org Campaign`,
    );
    await linkOrgToCampaign(orgId, campaign);
    const personLinkId = await linkPersonToCampaign(personId, campaign);

    // Delete the organization
    await supabase.from("organizations").delete().eq("id", orgId);

    // campaign_organizations link should be gone (CASCADE)
    const { data: orgLinks } = await supabase
      .from("campaign_organizations")
      .select("id")
      .eq("organization_id", orgId);
    expect(orgLinks).toHaveLength(0);

    // Person should still exist (ON DELETE SET NULL on organization_id)
    const { data: person } = await supabase
      .from("people")
      .select("id, organization_id")
      .eq("id", personId)
      .single();
    expect(person).toBeTruthy();
    expect(person!.organization_id).toBeNull();

    // campaign_people link should still exist
    const { data: personLink } = await supabase
      .from("campaign_people")
      .select("id")
      .eq("id", personLinkId)
      .single();
    expect(personLink).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Unique constraints and schema validation
// ---------------------------------------------------------------------------

test.describe("Schema constraints", () => {
  test("organization domain uniqueness is enforced", async () => {
    const domain = `unique-domain-${Date.now()}.test`;

    await supabase.from("organizations").insert({
      name: `${TEST_PREFIX} Unique 1`,
      domain,
      source: "e2e_test",
    });

    const { error } = await supabase.from("organizations").insert({
      name: `${TEST_PREFIX} Unique 2`,
      domain,
      source: "e2e_test",
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe("23505");
  });

  test("people linkedin_url uniqueness is enforced", async () => {
    const url = `https://linkedin.com/in/unique-person-${Date.now()}`;

    await supabase.from("people").insert({
      name: `${TEST_PREFIX} Unique P1`,
      linkedin_url: url,
      source: "e2e_test",
    });

    const { error } = await supabase.from("people").insert({
      name: `${TEST_PREFIX} Unique P2`,
      linkedin_url: url,
      source: "e2e_test",
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe("23505");
  });

  test("campaign_organizations unique constraint prevents duplicate links", async () => {
    const orgId = await createTestOrganization();
    const campaign = await createTestCampaign(`${TEST_PREFIX} Dup Org Link`);
    await linkOrgToCampaign(orgId, campaign);

    const { error } = await supabase
      .from("campaign_organizations")
      .insert({ campaign_id: campaign, organization_id: orgId });

    expect(error).toBeTruthy();
    expect(error!.code).toBe("23505");
  });

  test("enrichment_status check constraint is enforced", async () => {
    const orgId = await createTestOrganization();
    const { error } = await supabase
      .from("organizations")
      .update({ enrichment_status: "invalid_status" })
      .eq("id", orgId);

    expect(error).toBeTruthy();
  });

  test("campaign_organizations status check constraint is enforced", async () => {
    const orgId = await createTestOrganization();
    const campaign = await createTestCampaign(`${TEST_PREFIX} Status Check`);
    const linkId = await linkOrgToCampaign(orgId, campaign);

    const { error } = await supabase
      .from("campaign_organizations")
      .update({ status: "invalid" })
      .eq("id", linkId);

    expect(error).toBeTruthy();
  });

  test("updated_at trigger fires on organization update", async () => {
    const orgId = await createTestOrganization();

    const { data: before } = await supabase
      .from("organizations")
      .select("updated_at")
      .eq("id", orgId)
      .single();

    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 100));

    await supabase
      .from("organizations")
      .update({ description: "Updated description" })
      .eq("id", orgId);

    const { data: after } = await supabase
      .from("organizations")
      .select("updated_at")
      .eq("id", orgId)
      .single();

    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(
      new Date(before!.updated_at).getTime(),
    );
  });
});
