import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  hosted: true,
  auth: vi.fn(),
  resolve: vi.fn(),
  client: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth, clerkClient: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({
  isHostedMode: () => h.hosted,
  resolveWorkspace: h.resolve,
}));
vi.mock("@/lib/auth/supabase-jwt", () => ({ signSupabaseJwt: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: h.client }));
import { WorkspaceBootstrap } from "@/components/workspace-bootstrap";
import { createClient } from "@/lib/supabase/server";
import { runWithIdentity } from "@/lib/auth/identity";
beforeEach(() => {
  vi.resetAllMocks();
  h.hosted = true;
  h.auth.mockResolvedValue({
    userId: "user",
    getToken: vi.fn(),
    sessionId: "session",
  });
  h.resolve.mockResolvedValue("workspace");
});
it("provisions an authenticated workspace before rendering client data queries", async () => {
  expect(await WorkspaceBootstrap({ children: "content" })).toMatchObject({
    props: { children: "content", initialUser: "user" },
  });
  expect(h.resolve).toHaveBeenCalledWith("user");
});
it("allows anonymous login pages without provisioning", async () => {
  h.auth.mockResolvedValue({ userId: null });
  expect(await WorkspaceBootstrap({ children: "login" })).toMatchObject({
    props: { children: "login", initialUser: null },
  });
  expect(h.resolve).not.toHaveBeenCalled();
});
it("blocks rendering when workspace membership is revoked", async () => {
  h.resolve.mockRejectedValue(new Error("Workspace unavailable"));
  await expect(
    WorkspaceBootstrap({ children: "content" }),
  ).resolves.toMatchObject({
    props: { initialUser: "user", initialReady: false },
  });
});
it("provisions authenticated API clients before creating a database client", async () => {
  await createClient();
  expect(h.resolve).toHaveBeenCalledWith("user");
  expect(h.resolve.mock.invocationCallOrder[0]).toBeLessThan(
    h.client.mock.invocationCallOrder[0],
  );
});
it("rejects an injected workspace that disagrees with trusted membership", async () => {
  await expect(
    runWithIdentity(
      { userId: "user", workspaceId: "other", source: "job" },
      createClient,
    ),
  ).rejects.toThrow("Workspace context mismatch");
  expect(h.client).not.toHaveBeenCalled();
});
it("preserves self-hosted access without provisioning workspaces", async () => {
  h.hosted = false;
  await WorkspaceBootstrap({ children: "content" });
  await createClient();
  expect(h.resolve).not.toHaveBeenCalled();
});

import { POST } from "@/app/api/workspace/route";
it("bootstraps the server-verified user without accepting a workspace argument", async () => {
  expect((await POST()).status).toBe(200);
  expect(h.resolve).toHaveBeenCalledWith("user");
});
it("rejects anonymous bootstrap requests", async () => {
  h.auth.mockResolvedValue({ userId: null });
  expect((await POST()).status).toBe(401);
  expect(h.resolve).not.toHaveBeenCalled();
});
