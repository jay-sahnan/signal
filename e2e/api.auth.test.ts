import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  supabase,
  createTestUser,
  cleanupTestUsers,
  TEST_PREFIX,
} from "./helpers";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

// Every RLS-protected table the browser talks to. An unauthenticated anon
// JWT must return `[]` for all of these — that's the whole point of the
// revert from permissive back to strict policies.
const PROTECTED_TABLES = [
  "campaigns",
  "chats",
  "user_profile",
  "api_usage",
  "campaign_organizations",
  "campaign_people",
  "campaign_signals",
  "tracking_configs",
  "outreach_events",
  "tracking_snapshots",
  "tracking_changes",
];

test.afterAll(async () => {
  await cleanupTestUsers();
});

test.describe("anon role cannot read protected tables", () => {
  for (const table of PROTECTED_TABLES) {
    test(`anon GET ${table} returns empty`, async () => {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?select=id&limit=5`,
        {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        },
      );
      expect(res.status).toBe(200);
      const rows = await res.json();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });
  }
});

test.describe("authenticated user sees only their rows", () => {
  test("User A's JWT returns A's campaigns; User B sees none of A's", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    const { error: insertErr } = await supabase.from("campaigns").insert({
      name: `${TEST_PREFIX} isolation-api-A`,
      status: "discovery",
      icp: {},
      offering: {},
      positioning: {},
      search_criteria: {},
      user_id: userA.id,
    });
    expect(insertErr).toBeNull();

    const aClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userA.accessToken}` } },
    });
    const { data: aRows } = await aClient
      .from("campaigns")
      .select("id, name, user_id");
    expect(aRows).toBeTruthy();
    expect(aRows!.length).toBeGreaterThanOrEqual(1);
    expect(aRows!.every((r) => r.user_id === userA.id)).toBe(true);

    const bClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userB.accessToken}` } },
    });
    const { data: bRows } = await bClient
      .from("campaigns")
      .select("id")
      .eq("name", `${TEST_PREFIX} isolation-api-A`);
    expect(bRows).toEqual([]);
  });
});

test.describe("service-role client crosses user boundaries", () => {
  test("admin client sees rows owned by any user", async () => {
    const userA = await createTestUser();
    const { data } = await supabase
      .from("campaigns")
      .insert({
        name: `${TEST_PREFIX} admin-visible-${Date.now()}`,
        status: "discovery",
        icp: {},
        offering: {},
        positioning: {},
        search_criteria: {},
        user_id: userA.id,
      })
      .select("id")
      .single();
    expect(data).toBeTruthy();

    const { data: refetched } = await supabase
      .from("campaigns")
      .select("id, user_id")
      .eq("id", data!.id)
      .single();
    expect(refetched).toBeTruthy();
    expect(refetched!.user_id).toBe(userA.id);
  });
});

test.describe("handle_new_user trigger", () => {
  test("creates a user_profile row on auth.users insert", async () => {
    const user = await createTestUser();

    const { data: profile } = await supabase
      .from("user_profile")
      .select("id, label, user_id, email")
      .eq("user_id", user.id)
      .maybeSingle();

    expect(profile).toBeTruthy();
    expect(profile!.label).toBe("Default");
    expect(profile!.user_id).toBe(user.id);
    expect(profile!.email).toBe(user.email);
  });
});
