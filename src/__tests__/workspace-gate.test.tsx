import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const h = vi.hoisted(() => ({
  userId: "new-user" as string | null,
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => h }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, userId: h.userId }),
}));
import { WorkspaceGate } from "@/components/workspace-gate";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  h.userId = "new-user";
  vi.clearAllMocks();
});
it("waits for verified provisioning before mounting a newly signed-in user's data UI", async () => {
  let resolve!: (value: unknown) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    ),
  );
  const view = render(
    <WorkspaceGate initialUser={null}>Private data</WorkspaceGate>,
  );
  expect(screen.queryByText("Private data")).toBeNull();
  resolve({ ok: true, json: async () => ({ ready: true }) });
  await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  expect(screen.queryByText("Private data")).toBeNull();
  view.rerender(
    <WorkspaceGate initialUser="new-user">Private data</WorkspaceGate>,
  );
  expect(screen.getByText("Private data")).toBeTruthy();
});
it("keeps a previous account's ready state from exposing the next account's UI", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  render(
    <WorkspaceGate initialUser="previous-user">Private data</WorkspaceGate>,
  );
  expect(screen.queryByText("Private data")).toBeNull();
});
it("fails visibly without mounting data components when provisioning is denied", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  render(<WorkspaceGate initialUser={null}>Private data</WorkspaceGate>);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Workspace unavailable",
  );
  expect(screen.queryByText("Private data")).toBeNull();
});

it("allows recovery when the server refresh stalls without exposing stale data", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ready: true }) }),
  );
  render(<WorkspaceGate initialUser="old-user">Private data</WorkspaceGate>);
  await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Private data")).toBeNull();
});
