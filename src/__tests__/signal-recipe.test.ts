import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/cost-tracker", () => ({
  trackUsage: vi.fn(),
  PRICING: {},
}));

import { resolvePath, renderTemplate, resolveArgs } from "@/lib/signals/paths";
import { structuralDiff } from "@/lib/signals/diff";

describe("resolvePath", () => {
  it("reads nested keys", () => {
    expect(resolvePath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });
  it("reads array indices", () => {
    expect(resolvePath({ xs: [10, 20, 30] }, "xs.1")).toBe(20);
    expect(resolvePath({ xs: [10, 20, 30] }, "xs[1]")).toBe(20);
  });
  it("returns undefined for missing keys", () => {
    expect(resolvePath({ a: 1 }, "a.b.c")).toBeUndefined();
  });
  it("returns root when path is empty", () => {
    expect(resolvePath({ a: 1 }, "")).toEqual({ a: 1 });
  });
});

describe("renderTemplate", () => {
  it("substitutes single mustache", () => {
    expect(renderTemplate("Hello {{ name }}", { name: "World" })).toBe(
      "Hello World",
    );
  });
  it("substitutes nested paths", () => {
    expect(
      renderTemplate("{{ ctx.org.domain }}", {
        ctx: { org: { domain: "stripe.com" } },
      }),
    ).toBe("stripe.com");
  });
  it("replaces missing values with empty string", () => {
    expect(renderTemplate("a{{ missing }}b", {})).toBe("ab");
  });
});

describe("resolveArgs", () => {
  it("resolves whole-string templates to their underlying value type", () => {
    const out = resolveArgs(
      { count: "{{ n }}", obj: "{{ payload }}" },
      { n: 5, payload: { a: 1 } },
    );
    expect(out.count).toBe(5);
    expect(out.obj).toEqual({ a: 1 });
  });
  it("renders partial templates as strings", () => {
    const out = resolveArgs(
      { url: "https://{{ d }}/pricing" },
      { d: "stripe.com" },
    );
    expect(out.url).toBe("https://stripe.com/pricing");
  });
  it("recurses into nested objects and arrays", () => {
    const out = resolveArgs(
      { filters: [{ domain: "{{ d }}" }] },
      { d: "stripe.com" },
    );
    expect(out).toEqual({ filters: [{ domain: "stripe.com" }] });
  });
});

describe("structuralDiff", () => {
  it("reports no change for deep-equal values", () => {
    const diff = structuralDiff({ a: 1 }, { a: 1 });
    expect(diff.changed).toBe(false);
  });
  it("describes scalar changes", () => {
    const diff = structuralDiff(29, 39);
    expect(diff.changed).toBe(true);
    expect(diff.description).toContain("29");
    expect(diff.description).toContain("39");
  });
  it("keyed array diff detects added and changed tiers", () => {
    const before = [
      { name: "Starter", price: "$29/mo" },
      { name: "Pro", price: "$99/mo" },
    ];
    const after = [
      { name: "Starter", price: "$39/mo" }, // changed
      { name: "Pro", price: "$99/mo" }, // same
      { name: "Business", price: "$199/mo" }, // added
    ];
    const diff = structuralDiff(before, after, "name");
    expect(diff.changed).toBe(true);
    expect(diff.description).toMatch(/added 1/);
    expect(diff.description).toMatch(/changed 1/);
    expect(diff.description).toMatch(/Business/);
    expect(diff.description).toMatch(/Starter/);
  });
  it("keyed array diff detects removed tiers", () => {
    const before = [{ name: "Starter" }, { name: "Legacy" }];
    const after = [{ name: "Starter" }];
    const diff = structuralDiff(before, after, "name");
    expect(diff.changed).toBe(true);
    expect(diff.description).toMatch(/removed 1/);
    expect(diff.description).toMatch(/Legacy/);
  });
  it("null baseline yields first-observed diff", () => {
    const diff = structuralDiff(null, [{ name: "Starter" }]);
    expect(diff.changed).toBe(true);
    expect(diff.description).toMatch(/First observed/);
  });
});
