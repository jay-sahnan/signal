import type { Tool } from "ai";
import { allTools } from "@/lib/tools";

const RECIPE_TOOL_ALLOWLIST = new Set<string>([
  "extractWebContent",
  "fetchSitemap",
  "scrapeJobListings",
  "scrapeJobListingsBatch",
  "enrichCompany",
  "enrichContact",
  "getGoogleReviews",
  "fetchGitHubStargazers",
  "searchGitHubRepos",
]);

export function getRecipeTool(name: string): Tool<unknown, unknown> {
  if (!RECIPE_TOOL_ALLOWLIST.has(name)) {
    throw new Error(
      `Tool "${name}" is not in the recipe allowlist. Allowed: ${[...RECIPE_TOOL_ALLOWLIST].join(", ")}`,
    );
  }
  const tools = allTools as Record<string, Tool<unknown, unknown>>;
  const tool = tools[name];
  if (!tool) {
    throw new Error(
      `Tool "${name}" is in the allowlist but not exported from allTools`,
    );
  }
  return tool;
}

export function recipeToolNames(): string[] {
  return [...RECIPE_TOOL_ALLOWLIST];
}
