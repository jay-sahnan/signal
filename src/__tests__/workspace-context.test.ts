// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({ rpc }) }));
import { isHostedMode, resolveWorkspace } from "@/lib/auth/workspace";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe("hosted workspace resolution", () => {
  it("leaves existing self-host deployments unchanged", () => {
    vi.stubEnv("SIGNAL_DEPLOYMENT_MODE", "");
    expect(isHostedMode()).toBe(false);
  });
  it("rejects an invalid mode rather than disabling billing", () => {
    vi.stubEnv("SIGNAL_DEPLOYMENT_MODE", "hostde");
    expect(() => isHostedMode()).toThrow("SIGNAL_DEPLOYMENT_MODE");
  });
  it("resolves only the authenticated identity, without caching membership", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    rpc.mockResolvedValueOnce({ data: id, error: null });
    expect(await resolveWorkspace("user_a")).toBe(id);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "revoked" } });
    await expect(resolveWorkspace("user_a")).rejects.toThrow(
      "Workspace unavailable",
    );
    expect(rpc).toHaveBeenCalledWith("ensure_workspace", {
      p_user_id: "user_a",
    });
  });
  it("refuses anonymous and malformed results", async () => {
    await expect(resolveWorkspace("")).rejects.toThrow("Identity required");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: "", error: null });
    await expect(resolveWorkspace("user_a")).rejects.toThrow(
      "Workspace unavailable",
    );
  });
});
