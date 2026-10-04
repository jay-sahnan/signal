import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@clerk/nextjs/server", async (original) => ({
  ...(await original<typeof import("@clerk/nextjs/server")>()),
  clerkMiddleware: (callback: unknown) => callback,
}));
import { proxy } from "@/proxy";
it("lets the scheduler reach its own secret guard while protecting other billing routes", async () => {
  const protect = vi.fn();
  const middleware = proxy as unknown as (
    auth: { protect: typeof protect },
    request: NextRequest,
  ) => Promise<void>;
  await middleware(
    { protect },
    new NextRequest("https://signal.test/api/billing/reconcile"),
  );
  expect(protect).not.toHaveBeenCalled();
  await middleware(
    { protect },
    new NextRequest("https://signal.test/api/billing/status"),
  );
  expect(protect).toHaveBeenCalledTimes(1);
});
