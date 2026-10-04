import { beforeEach, expect, it, vi } from "vitest";
type Extra = { authInfo?: { extra?: { userId?: string } } };
const h = vi.hoisted(() => ({
  hosted: true,
  resolve: vi.fn(),
  execute: vi.fn(),
  call: null as null | ((input: unknown, extra: Extra) => Promise<unknown>),
}));
vi.mock("mcp-handler", () => ({
  createMcpHandler: (setup: (server: object) => void) => {
    setup({
      tool: (
        _name: string,
        _description: string,
        _schema: unknown,
        callback: typeof h.call,
      ) => {
        h.call = callback;
      },
    });
    return vi.fn();
  },
  withMcpAuth: (handler: unknown) => handler,
}));
vi.mock("@/lib/auth/workspace", () => ({
  isHostedMode: () => h.hosted,
  resolveWorkspace: h.resolve,
}));
vi.mock("@/lib/mcp/auth", () => ({ verifyMcpBearer: vi.fn() }));
vi.mock("@/lib/mcp/config", () => ({ mcpConfigError: () => null }));
vi.mock("@/lib/mcp/registry", () => ({
  mcpToolList: () => [
    {
      name: "test",
      description: "test",
      inputSchema: { shape: {} },
      execute: h.execute,
    },
  ],
  toMcpResult: (result: unknown) => ({ content: result }),
}));
import "@/app/api/mcp/[transport]/route";
import { getCurrentIdentity } from "@/lib/auth/identity";
beforeEach(() => {
  vi.clearAllMocks();
  h.hosted = true;
  h.resolve.mockResolvedValue("trusted-workspace");
  h.execute.mockImplementation(async () => getCurrentIdentity());
});
it("uses the authenticated user's workspace, ignoring forged tool context", async () => {
  const result = await h.call!(
    { workspaceId: "foreign", userId: "foreign" },
    { authInfo: { extra: { userId: "owner" } } },
  );
  expect(result).toEqual({
    content: {
      userId: "owner",
      source: "mcp",
      workspaceId: "trusted-workspace",
    },
  });
  expect(h.resolve).toHaveBeenCalledWith("owner");
});
it("rejects unavailable or revoked workspaces before invoking a tool", async () => {
  h.resolve.mockRejectedValue(new Error("Workspace unavailable"));
  expect(
    await h.call!({}, { authInfo: { extra: { userId: "owner" } } }),
  ).toMatchObject({ isError: true });
  expect(h.execute).not.toHaveBeenCalled();
});
it("rejects anonymous calls before workspace resolution", async () => {
  expect(await h.call!({}, {})).toMatchObject({ isError: true });
  expect(h.resolve).not.toHaveBeenCalled();
  expect(h.execute).not.toHaveBeenCalled();
});
it("preserves self-hosted tool access without workspace provisioning", async () => {
  h.hosted = false;
  expect(
    await h.call!({}, { authInfo: { extra: { userId: "owner" } } }),
  ).toMatchObject({ content: { userId: "owner", source: "mcp" } });
  expect(h.resolve).not.toHaveBeenCalled();
});
