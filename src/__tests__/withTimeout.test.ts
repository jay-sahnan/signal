import { describe, expect, it } from "vitest";
import { withTimeout } from "@/lib/utils/timeout";

describe("withTimeout", () => {
  it("resolves with the promise value when it settles before the timeout", async () => {
    const fast = new Promise<string>((resolve) => {
      setTimeout(() => resolve("ok"), 10);
    });

    await expect(withTimeout(fast, 200, "fast-op")).resolves.toBe("ok");
  });

  it("rejects with a labeled error when the promise exceeds the timeout", async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve("too-late"), 200);
    });

    await expect(withTimeout(slow, 20, "slow-op")).rejects.toThrow(
      /slow-op timed out after/,
    );
  });
});
