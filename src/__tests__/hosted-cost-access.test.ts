import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ query: vi.fn(), spend: vi.fn(), hosted: true }));
vi.mock("@/lib/auth/workspace", () => ({ isHostedMode: () => h.hosted }));
vi.mock("@/lib/services/real-spend", () => ({ fetchRealSpend: h.spend }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAndUser: async () => ({
    user: { id: "customer" },
    supabase: { from: h.query },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ from: h.query }),
}));
import { GET } from "@/app/api/settings/costs/route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("denies hosted customers before any platform-spend request", async () => {
  vi.stubEnv("SIGNAL_OPERATOR_USER_IDS", "operator");
  expect(
    (await GET(new Request("https://signal.test/api/settings/costs"))).status,
  ).toBe(403);
  expect(h.query).not.toHaveBeenCalled();
  expect(h.spend).not.toHaveBeenCalled();
});
it("fails closed when the operator allowlist is empty", async () => {
  vi.stubEnv("SIGNAL_OPERATOR_USER_IDS", "");
  expect(
    (await GET(new Request("https://signal.test/api/settings/costs"))).status,
  ).toBe(403);
  expect(h.spend).not.toHaveBeenCalled();
});
