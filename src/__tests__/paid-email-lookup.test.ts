import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
  holds: vi.fn(),
  session: vi.fn(),
  mx: vi.fn(),
  person: {
    id: "person",
    name: "Ada Lovelace",
    work_email: null as string | null,
    personal_email: null as string | null,
    organization_id: "org",
    work_email_source: null as string | null,
    work_email_verification: null as string | null,
  },
  db: { from: vi.fn() },
}));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => true }));
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid }));
vi.mock("@/lib/tools/ownership", async (original) => ({
  ...(await original<object>()),
  toolSession: h.session,
  callerHoldsPerson: h.holds,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/lib/services/email-pattern", async (original) => ({
  ...(await original<object>()),
  mxCheck: h.mx,
}));
vi.mock("@/lib/services/email-provider", async (original) => ({
  ...(await original<object>()),
  getEmailProvider: () => null,
}));
vi.mock("@/lib/services/exa-service", () => ({
  ExaService: class {
    search = async () => ({ results: [] });
  },
}));
import { findEmailForPerson } from "@/lib/tools/email-tools";
import { runWithIdentity } from "@/lib/auth/identity";
const key = "22222222-2222-4222-8222-222222222222";
const lookup = (opts = {}) =>
  runWithIdentity({ userId: "owner", source: "mcp" }, () =>
    findEmailForPerson("person", { operationKey: key, ...opts }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.person.work_email = null;
  h.person.personal_email = null;
  h.person.work_email_source = null;
  h.person.work_email_verification = null;
  h.session.mockResolvedValue({ userId: "owner", supabase: h.db });
  h.holds.mockResolvedValue(true);
  h.paid.mockResolvedValue({
    email: "replayed@example.com",
    personId: "person",
  });
  h.db.from.mockImplementation((table: string) => ({
    select: () => ({
      eq: () => ({
        single: async () => ({
          data:
            table === "people"
              ? h.person
              : { name: "Company", domain: "example.com" },
        }),
      }),
    }),
  }));
});
it("returns an existing address without reserving credits or calling a provider", async () => {
  h.person.work_email = "stored@example.com";
  expect(await lookup()).toMatchObject({ email: "stored@example.com" });
  expect(h.paid).not.toHaveBeenCalled();
  expect(h.mx).not.toHaveBeenCalled();
});
it("reserves before discovery and carries the durable key", async () => {
  expect(await lookup()).toMatchObject({ email: "replayed@example.com" });
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({
      key,
      kind: "email.lookup",
      identity: { userId: "owner", source: "mcp" },
      request: { personId: "person", revalidate: false, verify: false },
    }),
    expect.any(Function),
  );
  expect(h.mx).not.toHaveBeenCalled();
});
it("blocks provider work when the wallet refuses a lookup", async () => {
  h.paid.mockRejectedValue(new Error("Insufficient credits"));
  await expect(lookup()).rejects.toThrow("Insufficient credits");
  expect(h.mx).not.toHaveBeenCalled();
});
it("authorizes even cached email reads in hosted mode", async () => {
  h.person.work_email = "stored@example.com";
  h.holds.mockResolvedValue(false);
  await expect(lookup()).rejects.toThrow("Person not found");
  expect(h.paid).not.toHaveBeenCalled();
});
it("uses the verification rate for explicit revalidation", async () => {
  await lookup({ revalidate: true });
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "email.verify" }),
    expect.any(Function),
  );
});
it("does not open another charge inside an already reserved operation", async () => {
  h.mx.mockRejectedValue(new Error("provider boundary reached"));
  await expect(
    runWithIdentity(
      { userId: "owner", source: "mcp", operationId: "reserved" },
      () => findEmailForPerson("person"),
    ),
  ).rejects.toThrow("provider boundary reached");
  expect(h.paid).not.toHaveBeenCalled();
});
it("uses validated preflight once, so a later read failure cannot settle as success", async () => {
  h.paid.mockImplementation(async (_request, work) => {
    h.db.from.mockImplementation(() => {
      throw new Error("database unavailable");
    });
    return runWithIdentity(
      { userId: "owner", source: "mcp", operationId: "reserved" },
      work,
    );
  });
  h.mx.mockRejectedValue(new Error("provider boundary reached"));
  await expect(lookup()).rejects.toThrow("provider boundary reached");
  expect(h.mx).toHaveBeenCalledWith("example.com");
  expect(h.db.from).toHaveBeenCalledTimes(2);
});
it("throws on a hosted contact read failure before any reservation", async () => {
  h.db.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: null, error: { message: "unavailable" } }),
      }),
    }),
  });
  await expect(lookup()).rejects.toThrow("Could not load contact");
  expect(h.paid).not.toHaveBeenCalled();
  expect(h.mx).not.toHaveBeenCalled();
});
