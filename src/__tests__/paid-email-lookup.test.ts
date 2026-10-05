import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  paid: vi.fn(),
  existing: vi.fn(),
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
vi.mock("@/lib/billing/paid-action", () => ({ executePaidAction: h.paid, hasPaidAction: h.existing }));
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
  h.existing.mockResolvedValue(false);
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

it.each(["work_email", "personal_email"] as const)(
  "replays the original paid result even when %s has since been saved",
  async (field) => {
    h.person[field] = "stored@example.com";
    h.existing.mockResolvedValue(true);
    expect(await lookup()).toMatchObject({ email: "replayed@example.com" });
    expect(h.existing.mock.calls[0][0]).toEqual(h.paid.mock.calls[0][0]);
    expect(h.mx).not.toHaveBeenCalled();
  },
);
it("cannot report a cached address as success for unresolved billing", async () => {
  h.person.work_email = "stored@example.com";
  h.existing.mockResolvedValue(true);
  h.paid.mockRejectedValue(new Error("Unresolved"));
  await expect(lookup()).rejects.toThrow("Unresolved");
});
it("checks the original verification action even after an address becomes trusted", async () => {
  h.person.work_email = "stored@example.com";
  h.person.work_email_verification = "deliverable";
  h.existing.mockResolvedValue(true);
  await lookup({ revalidate: true });
  expect(h.paid).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "email.verify" }), expect.any(Function),
  );
});

it("replays settled email work without depending on the current company read", async () => {
  h.existing.mockResolvedValue(true);
  const normal = h.db.from.getMockImplementation()!;
  h.db.from.mockImplementation((table: string) => {
    if (table === "organizations") throw new Error("company read unavailable");
    return normal(table);
  });
  expect(await lookup()).toMatchObject({ email: "replayed@example.com" });
  expect(h.db.from).not.toHaveBeenCalledWith("organizations");
  expect(h.mx).not.toHaveBeenCalled();
});
it("still researches an unstarted reservation when contact data has become cached", async () => {
  h.existing.mockResolvedValue(true);
  h.person.work_email = "stored@example.com";
  h.paid.mockImplementation(async (_input, work) => runWithIdentity(
    { userId: "owner", source: "mcp", operationId: "reserved" }, work,
  ));
  h.mx.mockRejectedValue(new Error("provider boundary reached"));
  await expect(lookup()).rejects.toThrow("provider boundary reached");
  expect(h.mx).toHaveBeenCalledWith("example.com");
  expect(h.paid).toHaveBeenCalledTimes(1);
});
