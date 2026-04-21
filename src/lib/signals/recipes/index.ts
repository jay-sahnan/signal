import type { SignalRecipe } from "../types";
// One import per recipe file. Add a new line here whenever you add a
// file under src/lib/signals/recipes/.
import { pricingChangesRecipe } from "./pricing-changes";

/**
 * Registry of all signal recipes, keyed by the recipe's own `slug`.
 *
 * We key with string literals (not `[recipe.slug]`) so TypeScript can
 * preserve the literal slug union in the resulting type. Each entry is
 * validated at compile time to be a `SignalRecipe`, and the runtime
 * assertion below guarantees the literal key matches the recipe's own
 * `slug` field — so contributors can't desync the two.
 */
export const RECIPES = {
  "pricing-changes": pricingChangesRecipe,
} as const satisfies Record<string, SignalRecipe>;

// Runtime sanity check: each registry key must equal the recipe's slug.
// Cheap to run at module load; catches drift between the literal key
// above and the `slug` field inside the recipe file.
for (const [key, recipe] of Object.entries(RECIPES)) {
  if (recipe.slug !== key) {
    throw new Error(
      `Recipe registry key "${key}" does not match recipe.slug "${recipe.slug}". Fix src/lib/signals/recipes/index.ts.`,
    );
  }
}

export type RecipeSlug = keyof typeof RECIPES;

export function getRecipe(slug: RecipeSlug): SignalRecipe;
export function getRecipe(slug: string): SignalRecipe;
export function getRecipe(slug: string): SignalRecipe {
  const recipe = (RECIPES as Record<string, SignalRecipe>)[slug];
  if (!recipe) {
    const known = Object.keys(RECIPES).join(", ") || "(none registered)";
    throw new Error(
      `No recipe registered with slug "${slug}". Known slugs: ${known}.`,
    );
  }
  return recipe;
}

export function hasRecipe(slug: string): slug is RecipeSlug {
  return slug in RECIPES;
}

export function listRecipeSlugs(): RecipeSlug[] {
  return Object.keys(RECIPES) as RecipeSlug[];
}
