import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClerkClient } from "@clerk/backend";
import { randomUUID } from "node:crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error(
    "E2E tests require NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, " +
      "and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local. " +
      "Grab them from `supabase status -o env`.",
  );
}

if (!clerkSecretKey || !clerkPublishableKey) {
  throw new Error(
    "E2E tests require CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY " +
      "in .env.local from a Clerk *test* instance (https://dashboard.clerk.com).",
  );
}

// Per Clerk's testing best practices: tests must run against a *test* instance
// (pk_test_… / sk_test_…), not production keys. Catches the easy footgun of
// pointing tests at a real Clerk app and creating real users.
if (!clerkPublishableKey.startsWith("pk_test_")) {
  throw new Error(
    `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must start with pk_test_ for e2e tests ` +
      `(got prefix "${clerkPublishableKey.slice(0, 10)}…"). Create a separate ` +
      `Clerk dev instance for testing — never run e2e against production keys.`,
  );
}
if (!clerkSecretKey.startsWith("sk_test_")) {
  throw new Error(
    `CLERK_SECRET_KEY must start with sk_test_ for e2e tests. ` +
      `Create a separate Clerk dev instance for testing.`,
  );
}

const clerk = createClerkClient({
  secretKey: clerkSecretKey,
  publishableKey: clerkPublishableKey,
});

/**
 * Service-role Supabase client for test setup and teardown. Bypasses RLS so
 * fixtures can be created/deleted regardless of the currently signed-in user.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: { persistSession: false },
  },
);

/** Prefix for test data so cleanup can target it precisely. */
export const TEST_PREFIX = "__e2e_test__";

export const TEST_PASSWORD = "__e2e_test__pw_Aa1!";

export interface TestUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  /** Raw Clerk session object — used for authCookiesFor. */
  session: unknown;
}

/**
 * Create a fresh Clerk test user and a session JWT for them. The JWT is
 * minted via the Clerk Backend API; Supabase third-party auth validates it
 * the same way it validates a real browser session, so RLS-protected
 * queries see the Clerk user id as `auth.jwt() ->> 'sub'`.
 */
export async function createTestUser(email?: string): Promise<TestUser> {
  const targetEmail = email ?? `${TEST_PREFIX}${randomUUID()}@example.com`;

  const user = await clerk.users.createUser({
    emailAddress: [targetEmail],
    password: TEST_PASSWORD,
    skipPasswordChecks: true,
    publicMetadata: { e2e_test: true },
  });

  const session = await clerk.sessions.createSession({ userId: user.id });
  const token = await clerk.sessions.getToken(session.id);

  return {
    id: user.id,
    email: targetEmail,
    password: TEST_PASSWORD,
    accessToken: token.jwt,
    refreshToken: "",
    session,
  };
}

/**
 * Build the Clerk session cookie a Next.js + @clerk/nextjs app expects, so
 * Playwright contexts can drive the app as if a real browser signed in.
 * Clerk's `__session` cookie carries the JWT directly.
 */
export function authCookiesFor(user: TestUser) {
  return [
    {
      name: "__session",
      value: user.accessToken,
      url: "http://localhost:3000",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ];
}

/**
 * Build the cookie header value for a signed-in user so plain `fetch` can
 * hit authenticated Next.js routes.
 */
export function authCookieHeader(user: TestUser): string {
  return `__session=${user.accessToken}`;
}

/** Fetch an app route as a given test user. */
export function authedFetch(
  path: string,
  user: TestUser,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${user.accessToken}`);
  headers.set("cookie", authCookieHeader(user));
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(`http://localhost:3000${path}`, { ...init, headers });
}

/**
 * Delete every Clerk user whose email starts with TEST_PREFIX, along with
 * their dependent rows (user_profile, campaigns, chats, api_usage). FK
 * cascades drop everything else.
 */
export async function cleanupTestUsers(): Promise<void> {
  const list = await clerk.users.getUserList({ limit: 200 });
  const targets = list.data.filter((u) =>
    (u.emailAddresses[0]?.emailAddress ?? "").startsWith(TEST_PREFIX),
  );
  if (!targets.length) return;
  const ids = targets.map((u) => u.id);

  // Delete in dependency order. campaigns cascades to campaign_people/orgs/
  // signals, tracking_configs (-> snapshots/changes), email_drafts, sent_emails,
  // sequences (-> sequence_steps/enrollments). user_profile and the other
  // direct-owner tables are independent.
  await supabase.from("api_usage").delete().in("user_id", ids);
  await supabase.from("chats").delete().in("user_id", ids);
  await supabase.from("user_settings").delete().in("user_id", ids);
  await supabase.from("email_drafts").delete().in("user_id", ids);
  await supabase.from("sent_emails").delete().in("user_id", ids);
  await supabase.from("sequences").delete().in("user_id", ids);
  await supabase.from("campaigns").delete().in("user_id", ids);
  await supabase.from("user_profile").delete().in("user_id", ids);
  await supabase.from("email_skill_attachments").delete().in("scope_id", ids);

  for (const u of targets) {
    await clerk.users.deleteUser(u.id);
  }
}

// Module-scoped default owner for fixtures so existing test call sites don't
// have to thread `userId` through every createTestCampaign() call. Each test
// file's `beforeAll` should set this to the signed-in test user's id.
let DEFAULT_OWNER_ID: string | null = null;
export function setDefaultTestOwner(userId: string | null): void {
  DEFAULT_OWNER_ID = userId;
}

/**
 * Create a campaign for testing and return its ID.
 * Defaults to `DEFAULT_OWNER_ID` (set via `setDefaultTestOwner`) so strict
 * RLS lets the signed-in test user see it. Pass `userId` to override.
 */
export async function createTestCampaign(
  name?: string,
  userId?: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      name: name || `${TEST_PREFIX} Campaign ${Date.now()}`,
      status: "discovery",
      icp: { industry: "testing", targetTitles: ["QA Engineer"] },
      offering: { description: "Test offering" },
      positioning: {},
      search_criteria: {},
      user_id: userId ?? DEFAULT_OWNER_ID,
    })
    .select("id")
    .single();

  if (error)
    throw new Error(`Failed to create test campaign: ${error.message}`);
  return data.id;
}

/** Create a test organization and return its ID. */
export async function createTestOrganization(
  overrides?: Partial<{
    name: string;
    domain: string;
    url: string;
    industry: string;
  }>,
): Promise<string> {
  const domain =
    overrides?.domain || `${TEST_PREFIX.replace(/_/g, "")}-${Date.now()}.test`;
  const { data, error } = await supabase
    .from("organizations")
    .insert({
      name: overrides?.name || `${TEST_PREFIX} Org ${Date.now()}`,
      domain,
      url: overrides?.url || `https://${domain}`,
      industry: overrides?.industry || "testing",
      source: "e2e_test",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create test org: ${error.message}`);
  return data.id;
}

/** Create a test person and return its ID. */
export async function createTestPerson(
  organizationId?: string,
  overrides?: Partial<{
    name: string;
    linkedin_url: string;
    work_email: string;
    title: string;
  }>,
): Promise<string> {
  const { data, error } = await supabase
    .from("people")
    .insert({
      name: overrides?.name || `${TEST_PREFIX} Person ${Date.now()}`,
      linkedin_url:
        overrides?.linkedin_url ||
        `https://linkedin.com/in/${TEST_PREFIX.replace(/_/g, "")}-${Date.now()}`,
      work_email: overrides?.work_email || null,
      title: overrides?.title || "Test Engineer",
      organization_id: organizationId || null,
      source: "e2e_test",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create test person: ${error.message}`);
  return data.id;
}

/** Link an organization to a campaign. */
export async function linkOrgToCampaign(
  orgId: string,
  campaignId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("campaign_organizations")
    .insert({ campaign_id: campaignId, organization_id: orgId })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to link org: ${error.message}`);
  return data.id;
}

/** Link a person to a campaign. */
export async function linkPersonToCampaign(
  personId: string,
  campaignId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("campaign_people")
    .insert({ campaign_id: campaignId, person_id: personId })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to link person: ${error.message}`);
  return data.id;
}

/** Create a test chat and return its ID. */
export async function createTestChat(
  overrides?: Partial<{
    title: string;
    campaign_id: string;
    messages: unknown[];
    user_id: string;
  }>,
): Promise<string> {
  const { data, error } = await supabase
    .from("chats")
    .insert({
      title: overrides?.title || `${TEST_PREFIX} Chat ${Date.now()}`,
      campaign_id: overrides?.campaign_id || null,
      user_id: overrides?.user_id ?? DEFAULT_OWNER_ID,
      messages: overrides?.messages || [
        {
          role: "user",
          parts: [{ type: "text", text: "Hello, this is a test message" }],
        },
        {
          role: "assistant",
          parts: [
            { type: "text", text: "Hi! I am an AI assistant. How can I help?" },
          ],
        },
      ],
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create test chat: ${error.message}`);
  return data.id;
}

/**
 * Create a test sequence (needs an existing campaign). Cascades delete via
 * the campaign, so no separate cleanup is needed as long as the campaign is
 * cleaned up via cleanupTestData / cleanupTestUsers.
 */
export async function createTestSequence(
  campaignId: string,
  overrides?: Partial<{ name: string; status: string; user_id: string }>,
): Promise<string> {
  const { data, error } = await supabase
    .from("sequences")
    .insert({
      name: overrides?.name || `${TEST_PREFIX} Sequence ${Date.now()}`,
      campaign_id: campaignId,
      user_id: overrides?.user_id ?? DEFAULT_OWNER_ID,
      status: overrides?.status || "draft",
    })
    .select("id")
    .single();

  if (error)
    throw new Error(`Failed to create test sequence: ${error.message}`);
  return data.id;
}

/**
 * Clean up ALL test data created during E2E tests.
 * Deletes in dependency order to avoid FK violations.
 */
export async function cleanupTestData(): Promise<void> {
  const { data: testCampaigns } = await supabase
    .from("campaigns")
    .select("id")
    .like("name", `${TEST_PREFIX}%`);

  const campaignIds = (testCampaigns || []).map((c) => c.id);

  if (campaignIds.length > 0) {
    await supabase
      .from("campaign_people")
      .delete()
      .in("campaign_id", campaignIds);

    await supabase
      .from("campaign_organizations")
      .delete()
      .in("campaign_id", campaignIds);

    await supabase.from("campaigns").delete().in("id", campaignIds);
  }

  await supabase.from("people").delete().eq("source", "e2e_test");
  await supabase.from("organizations").delete().eq("source", "e2e_test");
  await supabase.from("chats").delete().like("title", `${TEST_PREFIX}%`);
  await supabase
    .from("api_usage")
    .delete()
    .like("operation", `${TEST_PREFIX}%`);
}
