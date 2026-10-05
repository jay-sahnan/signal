import { expect, it } from "vitest";
import { builtinRecipe } from "@/lib/signals/recipes";
it("never interprets a customer slug as platform executable code", () => {
  expect(
    builtinRecipe({ slug: "pricing-changes", is_builtin: false }),
  ).toBeNull();
  expect(
    builtinRecipe({ slug: "pricing-changes", is_builtin: true })?.slug,
  ).toBe("pricing-changes");
  expect(builtinRecipe({ slug: "unknown", is_builtin: true })).toBeNull();
  expect(builtinRecipe({ slug: "__proto__", is_builtin: true })).toBeNull();
});
