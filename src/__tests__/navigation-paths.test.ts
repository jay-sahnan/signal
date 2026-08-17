import { describe, expect, it } from "vitest";

import { isNavigablePath } from "@/lib/navigation";

describe("isNavigablePath", () => {
  it("accepts app routes with query strings", () => {
    expect(isNavigablePath("/outreach/review?sequence=abc")).toBe(true);
    expect(isNavigablePath("/campaigns/123")).toBe(true);
    expect(isNavigablePath("/settings")).toBe(true);
    expect(isNavigablePath("/")).toBe(true);
  });

  // The path comes out of model output and lands in router.push and an
  // <a href>; anything that could leave the app is rejected outright.
  it("rejects anything that could leave the app", () => {
    expect(isNavigablePath("https://evil.example")).toBe(false);
    expect(isNavigablePath("//evil.example/outreach")).toBe(false);
    expect(isNavigablePath("javascript:alert(1)")).toBe(false);
    expect(isNavigablePath("/outreach/review?x=<script>")).toBe(false);
  });

  it("rejects paths the app does not serve", () => {
    expect(isNavigablePath("/tmp/out.csv")).toBe(false);
    expect(isNavigablePath("/outreachy")).toBe(false);
    expect(isNavigablePath("/api/chat")).toBe(false);
  });
});
