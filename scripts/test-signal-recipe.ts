/**
 * Dry-run a signal recipe against a real organization.
 *
 * Usage:
 *   npx tsx scripts/test-signal-recipe.ts <recipe-slug> <organization-id> [campaign-id]
 *
 * Example:
 *   npx tsx scripts/test-signal-recipe.ts pricing-changes 123e4567-e89b-12d3-a456-426614174000
 *
 * Reads company + domain from the organizations table. Uses a fake
 * signalId if not provided, so the "history" step returns empty on first run.
 */
import "dotenv/config";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { runRecipe } from "@/lib/signals/runner";
import { getRecipe, listRecipeSlugs } from "@/lib/signals/recipes";

async function main() {
  const [slug, organizationId, campaignId] = process.argv.slice(2);
  if (!slug || !organizationId) {
    console.error(
      `usage: npx tsx scripts/test-signal-recipe.ts <recipe-slug> <organization-id> [campaign-id]`,
    );
    console.error(`recipes available: ${listRecipeSlugs().join(", ")}`);
    process.exit(1);
  }

  const recipe = getRecipe(slug);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "missing NEXT_PUBLIC_SUPABASE_URL or publishable key in .env",
    );
    process.exit(1);
  }
  const supabase = createSupabaseClient(
    supabaseUrl,
    supabaseKey,
  ) as unknown as Awaited<
    ReturnType<typeof import("@/lib/supabase/server").createClient>
  >;

  const { data: org, error } = await supabase
    .from("organizations")
    .select("id, name, domain, url")
    .eq("id", organizationId)
    .maybeSingle();

  if (error || !org) {
    console.error(`organization not found: ${organizationId}`, error);
    process.exit(1);
  }

  const signalId = `recipe-${slug}-dryrun`;
  console.log(`\nRecipe:  ${slug}`);
  console.log(`Company: ${org.name} (${org.domain ?? "no domain"})\n`);

  const { output, steps } = await runRecipe({
    recipe,
    context: {
      signalId,
      organizationId: org.id,
      campaignId: campaignId ?? "dryrun",
      company: {
        name: org.name as string,
        domain: org.domain as string | null,
        website: org.url as string | null,
      },
    },
    supabaseClient: supabase,
    onStep: (step, result) => {
      const preview =
        typeof result === "string"
          ? result.slice(0, 200)
          : JSON.stringify(result).slice(0, 200);
      console.log(
        `  [${step.kind}:${step.id}] ${preview}${preview.length >= 200 ? "..." : ""}`,
      );
    },
  });

  console.log(`\n--- SignalOutput ---`);
  console.log(JSON.stringify(output, null, 2));
  console.log(`\n--- step keys ---`);
  console.log(Object.keys(steps).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
