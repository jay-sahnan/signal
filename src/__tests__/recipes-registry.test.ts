import { describe, expect, it } from "vitest";

import {
  RECIPES,
  getRecipe,
  hasRecipe,
  listRecipeSlugs,
} from "@/lib/signals/recipes";

describe("recipes registry", () => {
  it("returns a defined recipe for a known slug", () => {
    const recipe = getRecipe("pricing-changes");
    expect(recipe).toBeDefined();
    expect(recipe.slug).toBe("pricing-changes");
    expect(Array.isArray(recipe.steps)).toBe(true);
  });

  it("throws a descriptive error for an unknown slug", () => {
    expect(() => getRecipe("nonexistent")).toThrow(
      /No recipe registered with slug "nonexistent"/,
    );
    expect(() => getRecipe("nonexistent")).toThrow(/Known slugs:/);
  });

  it("keeps registry keys in sync with each recipe's own slug", () => {
    for (const [key, recipe] of Object.entries(RECIPES)) {
      expect(recipe.slug).toBe(key);
    }
  });

  it("hasRecipe matches listRecipeSlugs for every registered slug", () => {
    const slugs = listRecipeSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(hasRecipe(slug)).toBe(true);
    }
    expect(hasRecipe("definitely-not-a-recipe")).toBe(false);
  });
});
