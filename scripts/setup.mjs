#!/usr/bin/env node
// Signal interactive setup. See docs/setup.md for the manual path.

import {
  constants as fsConstants,
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, exit, argv } from "node:process";
import { execSync, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const ENV_PATH = join(ROOT, ".env.local");
const ENV_EXAMPLE = join(ROOT, ".env.example");
const NON_INTERACTIVE = argv.includes("--non-interactive");
const RESET = argv.includes("--reset");

const rl = createInterface({ input, output });
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

const log = {
  header: (m) =>
    console.log(`\n${colors.bold}${colors.cyan}${m}${colors.reset}`),
  info: (m) => console.log(`${colors.dim}${m}${colors.reset}`),
  ok: (m) => console.log(`${colors.green}✓ ${m}${colors.reset}`),
  warn: (m) => console.log(`${colors.yellow}! ${m}${colors.reset}`),
  fail: (m) => console.log(`${colors.red}✗ ${m}${colors.reset}`),
  plain: (m) => console.log(m),
};

async function ask(q, { secret = false } = {}) {
  if (NON_INTERACTIVE) return "";
  const answer = await rl.question(`  ${q}: `);
  if (secret) process.stdout.write("\x1b[1A\x1b[2K"); // scrub line
  return answer.trim();
}

async function confirm(q, defaultYes = false) {
  if (NON_INTERACTIVE) return defaultYes;
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await rl.question(`  ${q} ${hint}: `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith("y");
}

function has(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args, { check = true, stdio = "inherit" } = {}) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio });
  if (check && result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed with exit ${result.status}`,
    );
  }
  return result;
}

function preflight() {
  log.header("Preflight");
  let failed = false;

  const node = process.versions.node.split(".")[0];
  if (Number(node) < 20) {
    log.fail(
      `Node ${process.versions.node} — need 20+. See https://nodejs.org.`,
    );
    failed = true;
  } else {
    log.ok(`Node ${process.versions.node}`);
  }

  if (!has("pnpm")) {
    log.fail(
      "pnpm not found. Run `corepack enable` (Node 20+ ships with corepack) and re-run this script.",
    );
    failed = true;
  } else {
    log.ok("pnpm available");
  }

  if (!has("docker")) {
    log.warn(
      "docker not found — local Supabase won't work. Install Docker Desktop.",
    );
  } else {
    log.ok("docker available");
  }

  if (!has("supabase")) {
    log.warn(
      "supabase CLI not found — you'll need it for `supabase start`. Install: brew install supabase/tap/supabase",
    );
  } else {
    log.ok("supabase CLI available");
  }

  if (failed) {
    log.fail("Preflight blockers above. Fix and re-run.");
    exit(1);
  }
}

function readEnvLocal() {
  try {
    return readFileSync(ENV_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}

function writeEnvLocal(content) {
  writeFileSync(ENV_PATH, content, { mode: 0o600 });
}

function setEnvKey(content, key, value) {
  if (!value) return content;
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) return content.replace(re, line);
  return content.trimEnd() + "\n" + line + "\n";
}

async function bootstrapEnv() {
  log.header("Env file");
  if (RESET) {
    copyFileSync(ENV_EXAMPLE, ENV_PATH);
    log.warn(".env.local reset — overwritten from .env.example.");
    return;
  }
  try {
    copyFileSync(ENV_EXAMPLE, ENV_PATH, fsConstants.COPYFILE_EXCL);
    log.ok(".env.local created from .env.example");
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    log.ok(".env.local already exists — will update in place.");
  }
}

async function promptRequired() {
  log.header("Required keys");
  log.info("Leave blank to keep the existing value in .env.local.");

  let content = readEnvLocal();

  const supaUrl = await ask("Supabase URL (https://...supabase.co)");
  const supaPub = await ask(
    "Supabase publishable/anon key (starts with eyJ or sb_)",
  );
  const supaService = await ask("Supabase service_role key (secret)", {
    secret: true,
  });
  const anthropic = await ask("Anthropic API key (sk-ant-api...)", {
    secret: true,
  });

  content = setEnvKey(content, "NEXT_PUBLIC_SUPABASE_URL", supaUrl);
  content = setEnvKey(content, "SUPABASE_URL", supaUrl);
  content = setEnvKey(
    content,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY",
    supaPub,
  );
  content = setEnvKey(content, "SUPABASE_ANON_KEY", supaPub);
  content = setEnvKey(content, "SUPABASE_SERVICE_ROLE_KEY", supaService);
  content = setEnvKey(content, "ANTHROPIC_API_KEY", anthropic);

  writeEnvLocal(content);
  log.ok("Required keys written.");
}

async function promptClerk() {
  log.header("Clerk (auth)");
  log.info("Signal uses Clerk for sign-in/sign-up. Pick an option:");
  log.plain("  [1] I already have a Clerk app  → paste keys");
  log.plain(
    "  [2] Set up Clerk now            → opens dashboard, walks through",
  );
  log.plain("  [3] Skip — Keyless mode         → ephemeral dev app, dashboard");
  log.plain(
    "                                    will be empty (see warning later)",
  );

  // Default to [2] — the only option that produces a fully working dashboard.
  // [3] (Keyless) leaves the dashboard empty until they finish Clerk setup.
  const choice = (await ask("Choose [1/2/3] (default 2)")).trim() || "2";

  if (choice === "3") {
    let content = readEnvLocal();
    content = setEnvKey(content, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    content = setEnvKey(content, "CLERK_SECRET_KEY", "");
    content = setEnvKey(content, "CLERK_FRONTEND_API_DOMAIN", "");
    writeEnvLocal(content);
    log.warn(
      "Keyless mode: sign-in works on first `pnpm dev` but the dashboard\n" +
        "  will be empty until you fill in the Clerk env vars. A banner in the\n" +
        "  app reminds you. Re-run `pnpm setup` when ready.",
    );
    return;
  }

  if (choice === "2") {
    const url = "https://dashboard.clerk.com/sign-up";
    log.info(`Opening ${url} in your browser...`);
    try {
      execSync(
        process.platform === "darwin"
          ? `open "${url}"`
          : process.platform === "win32"
            ? `start "" "${url}"`
            : `xdg-open "${url}"`,
        { stdio: "ignore" },
      );
    } catch {
      log.info(`(Couldn't open browser — visit ${url} manually.)`);
    }
    log.plain("");
    log.plain("  In the Clerk dashboard:");
    log.plain("    1. Sign up + create an application (any name).");
    log.plain(
      "    2. Configure → API Keys → copy the publishable + secret keys.",
    );
    log.plain("    3. Configure → Integrations → Supabase → Activate.");
    log.plain(
      "    4. Copy the Frontend API domain (e.g. your-app.clerk.accounts.dev).",
    );
    log.plain("");
    await ask("[after creating the app] Press Enter to continue");
  }

  // Options [1] and [2] both end here, collecting the three values.
  const pubKey = await askValidated(
    "Clerk publishable key (pk_test_… or pk_live_…)",
    /^pk_(test|live)_[\w-]+$/,
  );
  const secretKey = await askValidated(
    "Clerk secret key (sk_test_… or sk_live_…)",
    /^sk_(test|live)_[\w-]+$/,
    { secret: true },
  );
  const domain = await askValidated(
    "Clerk Frontend API domain (e.g. your-app.clerk.accounts.dev)",
    /^[\w.-]+\.clerk\.accounts\.dev$|^clerk\.[\w.-]+$/,
  );

  let content = readEnvLocal();
  content = setEnvKey(content, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", pubKey);
  content = setEnvKey(content, "CLERK_SECRET_KEY", secretKey);
  content = setEnvKey(content, "CLERK_FRONTEND_API_DOMAIN", domain);
  writeEnvLocal(content);
  log.ok("Clerk keys written to .env.local.");

  // Enable third-party Clerk auth in supabase/config.toml. Stays disabled
  // by default so `supabase start` works on a fresh clone — flip it now
  // that the user has supplied a real Clerk Frontend API domain.
  enableSupabaseClerkAuth();

  // Hosted Supabase needs a manual Clerk-third-party-auth step in the
  // Supabase dashboard. Local Supabase reads the env var via config.toml.
  const supaUrl = (content.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m) || [])[1];
  if (
    supaUrl &&
    !supaUrl.includes("127.0.0.1") &&
    !supaUrl.includes("localhost")
  ) {
    const ref = supaUrl.match(/https:\/\/([^.]+)\./)?.[1] ?? "<your-ref>";
    const supaUrl2 = `https://supabase.com/dashboard/project/${ref}/auth/providers`;
    log.warn(
      `Hosted Supabase needs one more click. Visit:\n  ${supaUrl2}\n` +
        `  Add Clerk as a third-party auth provider with domain "${domain}".`,
    );
  }
}

function enableSupabaseClerkAuth() {
  const path = join(ROOT, "supabase", "config.toml");
  let original;
  try {
    original = readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  // Match the [auth.third_party.clerk] block's `enabled = false` line and
  // flip it. Anchored to the block heading so we don't rewrite other
  // disabled providers (firebase, auth0, aws_cognito).
  const updated = original.replace(
    /(\[auth\.third_party\.clerk\][\s\S]*?enabled\s*=\s*)false/,
    "$1true",
  );
  if (updated === original) {
    log.warn(
      "Couldn't auto-enable Clerk in supabase/config.toml — flip\n" +
        "  `enabled = false` to `true` under [auth.third_party.clerk] manually.",
    );
    return;
  }
  writeFileSync(path, updated);
  log.ok("Enabled Clerk third-party auth in supabase/config.toml.");
}

async function askValidated(label, regex, opts = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const value = (await ask(label, opts)).trim();
    if (!value) {
      log.warn("Empty value — try again or rerun setup later.");
      continue;
    }
    if (regex.test(value)) return value;
    log.warn("Format looks off — try again.");
  }
  // Fall through: accept whatever they typed last on the third try.
  log.warn("Saving anyway — couldn't validate format after 3 tries.");
  return (await ask(label, opts)).trim();
}

async function promptOptional() {
  log.header("Optional integrations");
  log.info(
    "Say no to anything you don't have a key for. Features that need it will fail gracefully.",
  );

  let content = readEnvLocal();

  const groups = [
    {
      name: "Browserbase (web scraping, YC scraper, hiring signals)",
      prompts: [
        ["BROWSERBASE_API_KEY", "Browserbase API key"],
        ["BROWSERBASE_PROJECT_ID", "Browserbase project ID"],
      ],
    },
    {
      name: "AgentMail (outbound email + tracking)",
      prompts: [
        ["AGENTMAIL_API_KEY", "AgentMail API key"],
        ["AGENTMAIL_WEBHOOK_SECRET", "AgentMail webhook secret (whsec_...)"],
      ],
    },
    {
      name: "QStash (scheduled signal runs)",
      prompts: [
        ["QSTASH_TOKEN", "QStash token"],
        ["QSTASH_CURRENT_SIGNING_KEY", "QStash current signing key"],
        ["QSTASH_NEXT_SIGNING_KEY", "QStash next signing key"],
      ],
    },
    {
      name: "Exa (neural web search)",
      prompts: [["EXA_API_KEY", "Exa API key"]],
    },
    {
      name: "Google Places (location enrichment)",
      prompts: [["GOOGLE_API_KEY", "Google API key"]],
    },
    {
      name: "Apify (LinkedIn + X enrichment)",
      prompts: [["APIFY_API_TOKEN", "Apify API token"]],
    },
    {
      name: "GitHub signals (commit activity, releases)",
      prompts: [["GITHUB_TOKEN", "GitHub personal access token"]],
    },
  ];

  for (const group of groups) {
    if (!(await confirm(`Enable ${group.name}?`, false))) continue;
    for (const [key, label] of group.prompts) {
      const value = await ask(label, { secret: true });
      content = setEnvKey(content, key, value);
    }
  }

  writeEnvLocal(content);
  log.ok("Optional keys written.");
}

function installDeps() {
  log.header("Dependencies");
  if (existsSync(join(ROOT, "node_modules"))) {
    log.ok("node_modules already present — skipping install.");
    return;
  }
  run("pnpm", ["install"]);
  log.ok("Dependencies installed.");
}

async function startSupabase() {
  log.header("Supabase");
  if (!has("supabase")) {
    log.warn(
      "supabase CLI missing — skipping DB setup. Run `supabase start && supabase db reset` manually later.",
    );
    return;
  }
  if (!(await confirm("Start local Supabase and apply migrations?", true)))
    return;
  try {
    run("supabase", ["start"]);
    run("supabase", ["db", "reset", "--no-seed"]);
    log.ok("Supabase up, schema applied.");
    await writeLocalSupabaseKeys();
  } catch (e) {
    log.fail(`Supabase setup failed: ${e.message}`);
    log.info("See docs/setup.md for the manual path.");
  }
}

/**
 * After `supabase start`, if the user didn't supply a hosted Supabase URL
 * earlier, auto-populate .env.local with the local URL + keys. The user
 * will still need to sign up at /signup on first run — local Supabase has
 * `enable_confirmations = false` so no email is sent, signup is instant.
 */
async function writeLocalSupabaseKeys() {
  const existing = readEnvLocal();
  const urlMatch = existing.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
  if (urlMatch && urlMatch[1].trim()) {
    log.info(
      "Hosted Supabase URL already set in .env.local — leaving env untouched.",
    );
    return;
  }

  const result = spawnSync("supabase", ["status", "-o", "env"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    log.warn(
      "Could not read `supabase status` — populate .env.local manually.",
    );
    return;
  }

  const status = String(result.stdout);
  const pick = (key) => {
    const m = status.match(new RegExp(`^${key}="(.+)"$`, "m"));
    return m ? m[1] : "";
  };
  const apiUrl = pick("API_URL");
  const anonKey = pick("ANON_KEY");
  const serviceRoleKey = pick("SERVICE_ROLE_KEY");

  if (!apiUrl || !anonKey || !serviceRoleKey) {
    log.warn(
      "`supabase status` output missing expected keys — populate .env.local manually.",
    );
    return;
  }

  let content = existing;
  content = setEnvKey(content, "NEXT_PUBLIC_SUPABASE_URL", apiUrl);
  content = setEnvKey(content, "SUPABASE_URL", apiUrl);
  content = setEnvKey(
    content,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY",
    anonKey,
  );
  content = setEnvKey(content, "SUPABASE_ANON_KEY", anonKey);
  content = setEnvKey(content, "SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);
  writeEnvLocal(content);
  log.ok("Wrote local Supabase URL/keys into .env.local.");
}

function typecheck() {
  log.header("Typecheck");
  const result = run("npx", ["tsc", "--noEmit"], { check: false });
  if (result.status === 0) log.ok("Clean typecheck.");
  else log.warn("Typecheck had errors — investigate before opening a PR.");
}

function summary() {
  log.header("Done");
  const env = readEnvLocal();
  const isKeyless = !/^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=.+$/m.test(env);

  log.plain("Next:");
  log.plain(
    `  ${colors.bold}pnpm dev${colors.reset}   # http://localhost:3000`,
  );
  log.plain(`  ${colors.bold}pnpm test${colors.reset}  # unit tests`);
  log.plain("");

  if (isKeyless) {
    log.warn(
      "You picked Keyless mode. Sign-in works, but the dashboard will be\n" +
        "  empty until you finish Clerk setup. To fix:\n" +
        "    pnpm setup            # rerun, pick option [2]\n" +
        "  or paste these into .env.local manually:\n" +
        "    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…\n" +
        "    CLERK_SECRET_KEY=sk_test_…\n" +
        "    CLERK_FRONTEND_API_DOMAIN=your-app.clerk.accounts.dev",
    );
  } else {
    log.info(
      "Visit http://localhost:3000 — Clerk's themed sign-in form is ready.\n" +
        "Free tier covers 10k MAU. See docs/setup.md if anything didn't work.",
    );
  }
}

async function main() {
  try {
    preflight();
    await bootstrapEnv();
    await promptRequired();
    await promptClerk();
    await promptOptional();
    installDeps();
    await startSupabase();
    typecheck();
    summary();
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  log.fail(e.message);
  exit(1);
});
