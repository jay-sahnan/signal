/**
 * Deploy a signal function to Browserbase Functions via the bb CLI.
 *
 * Usage:
 *   npx tsx scripts/deploy-signal-function.ts <slug>
 *
 * Example:
 *   npx tsx scripts/deploy-signal-function.ts pricing-changes
 *
 * Requirements:
 *   - BROWSERBASE_API_KEY in env (the bb CLI picks this up automatically)
 *   - bb CLI available (installed as a dev dep or via npx)
 *
 * The printed function ID should be recorded on the signal row (Phase 2 adds
 * the signals.function_id column; until then, note it manually).
 */
import { config as loadEnv } from "dotenv";
// Mimic Next.js-style loading: .env.local takes precedence over .env
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env" });
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: npx tsx scripts/deploy-signal-function.ts <slug>");
    process.exit(1);
  }

  const fnDir = join(process.cwd(), "browserbase-functions", slug);
  if (!existsSync(join(fnDir, "index.ts"))) {
    console.error(`No function source at ${fnDir}/index.ts`);
    process.exit(1);
  }

  if (!process.env.BROWSERBASE_API_KEY) {
    console.error("BROWSERBASE_API_KEY is not set");
    process.exit(1);
  }

  console.log(`Deploying ${slug} from ${fnDir} ...`);
  const result = spawnSync("bb", ["functions", "publish", "index.ts"], {
    cwd: fnDir,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(
      `bb functions publish failed with exit code ${result.status}`,
    );
    process.exit(result.status ?? 1);
  }

  console.log(
    `Deployed ${slug}. Copy the function ID from the bb output above ` +
      `(Phase 2 will persist it via the signals.function_id column).`,
  );
}

main();
